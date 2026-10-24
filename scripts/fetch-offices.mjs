// Builds data/offices.json: every Taipei city councilor's council office and every 里辦公處, with office phones.
// Sources: 臺北市議會「現任議員」pages and each 區公所's「里辦公處一覽表」(office phone as published, plus the 里長 mobile the 區公所 lists).
// The Hub loads the file into its offices table (not sent to the page). Run: node scripts/fetch-offices.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const UA = "taipei-issue-tracker (labanchen@gmail.com)";
const TCC = "https://www.tcc.gov.tw/";
// Each 區公所's 里辦公處一覽表, taken from its SiteMap.aspx (2026-10-24)
const VILLAGES = {
  "中正區": "https://zzdo.gov.taipei/News.aspx?n=D7F52863BB7C9EA7&sms=D982815F3A372FF5",
  "大同區": "https://dtdo.gov.taipei/News.aspx?n=24EBC28C14D1E722&sms=D982815F3A372FF5",
  "中山區": "https://zsdo.gov.taipei/News.aspx?n=03E7616C2B3C7FA9&sms=D982815F3A372FF5",
  "松山區": "https://ssdo.gov.taipei/News.aspx?n=2F3A749E649959D8&sms=D982815F3A372FF5",
  "大安區": "https://dado.gov.taipei/News.aspx?n=BE0A98AD330074FB&sms=D982815F3A372FF5",
  "萬華區": "https://whdo.gov.taipei/News.aspx?n=398B18EC2B34D6FC&sms=D982815F3A372FF5",
  "信義區": "https://xydo.gov.taipei/News.aspx?n=C4427217A87391ED&sms=D982815F3A372FF5",
  "士林區": "https://sldo.gov.taipei/cp.aspx?n=F6BA2E4C0798CCED",
  "北投區": "https://btdo.gov.taipei/News.aspx?n=4FDEF1663661489A&sms=D982815F3A372FF5",
  "內湖區": "https://nhdo.gov.taipei/News.aspx?n=94345724DC4D2B23&sms=D982815F3A372FF5",
  "南港區": "https://ngdo.gov.taipei/News.aspx?n=CA34CE9927E7842A&sms=D982815F3A372FF5",
  "文山區": "https://wsdo.gov.taipei/News.aspx?n=7EC9858EC57D2A51&sms=D982815F3A372FF5"
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
    catch (e) { if (i >= tries) throw e; console.warn("  retry", i, url, e.message); await sleep(2000 * i); }
  }
}
const ent = s => s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) =>
  ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)));
const text = h => ent(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const rows = html => [...html.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/<tr[\s\S]*?<\/tr>/g)]
  .map(([r]) => [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => text(c[1]))).filter(r => r.length);
// 士林 has no mobile column: its phone cell holds "<office> <mobile>", split on the 09 prefix
const nums = s => s.split(/[\s、,，]+/).filter(t => /^[\d#-]{6,}$/.test(t));
const split = s => ({ phone: nums(s).filter(t => !/^09/.test(t)).join("、"), mobile: nums(s).filter(t => /^09/.test(t)).join("、") });

async function villages() {
  const out = [];
  for (const [district, url] of Object.entries(VILLAGES)) {
    const [head, ...body] = rows(await get(url + "&PageSize=200"));
    const col = re => head.findIndex(h => re.test(h));
    const [v, name, phone, mobile, addr] = [col(/里別/), col(/^里長(\s*姓名)?$/), col(/電話/), col(/^里長手機$/), col(/地址/)];
    assert(v >= 0 && name >= 0 && phone >= 0 && addr >= 0, district + " columns: " + head);
    for (const r of body) {
      const village = r[v].endsWith("里") ? r[v] : r[v] + "里";
      const tel = mobile >= 0 ? { phone: r[phone], mobile: nums(r[mobile]).join("、") } : split(r[phone]);
      out.push({ id: `village:${district}${village}`, kind: "village", district, area: village, name: r[name], ...tel, address: r[addr], source: url });
    }
    console.log(district, body.length);
    await sleep(500);
  }
  return out;
}

async function councilors() {
  const ids = [...new Set([...(await get(TCC + "cp.aspx?n=13898")).matchAll(/Councilor_Content\.aspx\?n=13898&s=(\d+)/g)].map(m => m[1]))];
  const out = [];
  for (const s of ids) {
    const url = `${TCC}Councilor_Content.aspx?n=13898&s=${s}`;
    const lines = ent((await get(url)).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n"))
      .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    // Labels are spaced out ("電 話"); the value is the next line
    const field = label => { const i = lines.findIndex(l => l.replace(/[\s　]/g, "") === label); return i >= 0 ? lines[i + 1] : ""; };
    const term = lines.find(l => /^第.+屆臺北市議員/.test(l)) || "";
    const area = (/\/\s*(.+)$/.exec(term) || [])[1] || "";
    out.push({ id: `councilor:${s}`, kind: "councilor", district: (/（(.+)）/.exec(area) || [])[1] || "", area: area.replace(/\s*（.+）/, ""),
      name: field("姓名"), party: field("黨籍"), phone: field("電話"), fax: field("傳真"), address: field("通訊處"), email: field("電子信箱"), source: url });
    await sleep(300);
  }
  console.log("議員", out.length);
  return out;
}

const all = [...await councilors(), ...await villages()];
// The smallest checks that fail if a page layout changes: 12 districts' 456 里, every row named and reachable by some number
assert.equal(all.filter(o => o.kind === "village").length, 456);
for (const o of all) assert(o.name && (o.phone || o.mobile), "missing name/phone: " + JSON.stringify(o));
const file = fileURLToPath(new URL("../data/offices.json", import.meta.url));
writeFileSync(file, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), offices: all }, null, 1) + "\n");
console.log(all.length, "offices written to data/offices.json");
