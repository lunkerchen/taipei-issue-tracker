// Builds data/history-2026.json from data.taipei's 1999 dispatch records, Jan–Sep 2026 (ROC 115).
// Privacy: the source has house numbers and floors; only district + road leave this script.
// Roads are geocoded once into data/history-roads.json (rerun skips known roads). Run: node scripts/fetch-1999-history.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const at = p => fileURLToPath(new URL("../data/" + p, import.meta.url));
const MONTHS = { 1:"8aec2bb2-b334-4572-9cbe-b0dfd3aae8fa", 2:"7a92a9b9-3898-40a4-b1df-6986cb62a9eb", 3:"8e11e7c2-9c8d-4143-a557-11997fdab5fa",
  4:"131e3e00-790d-472d-bd2c-326c62268d4e", 5:"9b2d0333-e8ee-4055-915b-d06ba67b0879", 6:"5b68c8f3-59f8-402d-adb3-1105b0b248f4",
  7:"2369db47-8e7e-487c-a198-a93ad63f7e7c", 8:"8d3af146-6112-4836-bfa4-28e0cf4b2237", 9:"5b51c017-392f-4ce1-94eb-703e9badb9b8" };
const UA = "taipei-issue-tracker (labanchen@gmail.com)";
const DISTRICTS = "中正區 大同區 中山區 松山區 大安區 萬華區 信義區 士林區 北投區 內湖區 南港區 文山區".split(" ");
const CENTER = { "中正區":[25.0324,121.5198], "大同區":[25.0633,121.5130], "中山區":[25.0685,121.5333], "松山區":[25.0497,121.5780],
  "大安區":[25.0268,121.5435], "萬華區":[25.0286,121.4979], "信義區":[25.0330,121.5654], "士林區":[25.0922,121.5246],
  "北投區":[25.1321,121.5017], "內湖區":[25.0830,121.5887], "南港區":[25.0548,121.6066], "文山區":[24.9897,121.5701] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The page's own city boundary (TAIPEI_RING in taipei-issues.html), so a point the map would call "outside Taipei" never ships
const RING = JSON.parse(/const TAIPEI_RING = (\[\[.*?\]\]);/.exec(readFileSync(fileURLToPath(new URL("../taipei-issues.html", import.meta.url)), "utf8"))[1]);
const inRing = (la, ln) => { let c = false; for (let i = 0, j = RING.length - 1; i < RING.length; j = i++) { const [yi, xi] = RING[i], [yj, xj] = RING[j]; if ((yi > la) !== (yj > la) && ln < (xj - xi) * (la - yi) / (yj - yi) + xi) c = !c; } return c; };

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r; }
    catch (e) { if (i >= tries) throw e; console.warn("  retry", i, e.message); await sleep(3000 * i); }
  }
}
// Jan–Mar come as Big5, Apr–Sep as UTF-8 with BOM
function decode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); }
  catch { return new TextDecoder("big5").decode(buf); }
}
// ponytail: line-based CSV; quoted fields may hold commas (split outside quotes) but never newlines in this dataset
const cells = l => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
const parse = text => text.trim().split(/\r?\n/).slice(1).map(cells).filter(r => r.length === 5)
  .map(([id, item, addr, date, time]) => ({ id, item, addr, date, time }));

// Item name -> 1999 main category id. Matched against data/1999-categories.json sub names, 與↔及 and （派工） ignored.
const cats = JSON.parse(readFileSync(at("1999-categories.json"), "utf8")).categories;
const norm = s => s.replace(/（派工）/g, "").replace(/[()（）]/g, "").replace(/與/g, "及").replace(/汙/g, "污").replace(/\s/g, "");
const subMain = new Map(cats.flatMap(c => c.subs.map(s => [norm(s.name), c.id])));
const FIX = { "大型廢棄物清運聯繫": "TYPEA-AC0100" }; // the only name that differs beyond punctuation
const canonItem = s => s.includes("河濱公園") ? "河濱公園自行車道及堤外便道破損、散落物、油漬及樹倒" : s; // one item arrives in three encodings
const mainOf = name => FIX[name] || subMain.get(norm(name));

// 中正區臺北市中正區龍福里007鄰南昌路一段３１巷… -> 南昌路一段. The road is what sits between the last district/village/
// neighbourhood/number/punctuation mark and the first 路/街/大道. "參考地址：" (landmark cases) points at the real address.
function road(addr) {
  const a = addr.slice(3).split(/參考地址[：:]/).pop().replace(/[臺台]?北[市巿]|[臺台]北/g, "").replace(/[臺台][灣湾]省?/g, " ").replace(/[东罗岛]/g, c => ({ 东:"東", 罗:"羅", 岛:"島" })[c]);
  const m = /(路|街|大道)([一二三四五六七八九十]段)?/.exec(a);
  if (!m) return null;
  const head = a.slice(0, m.index), cut = Math.max(...[...head.matchAll(/[區区里裡鄰,，；;：:)）(（號\d０-９\s、\/／?？\-－]/g)].map(x => x.index), -1);
  const name = head.slice(cut + 1);
  return name.length >= 1 && name.length <= 8 ? name + m[0] : null;
}

const roadsFile = at("history-roads.json"), known = existsSync(roadsFile) ? JSON.parse(readFileSync(roadsFile, "utf8")) : {};
let last = 0;
async function geocode(district, rd) {
  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "tw", bounded: "1",
    viewbox: "121.45,25.22,121.67,24.95", q: `臺北市${district}${rd}` });
  for (let i = 0; i < 2; i++) {
    await sleep(Math.max(0, last + 1100 - Date.now())); last = Date.now();
    try { const r = await fetch(url, { headers: { "User-Agent": UA, "accept-language": "zh-TW" }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error("HTTP " + r.status); const h = (await r.json())[0]; return h ? [+(+h.lat).toFixed(5), +(+h.lon).toFixed(5)] : null; }
    catch (e) { console.warn("  nominatim", e.message); }
  }
  return null;
}

const rows = [];
for (const [m, rid] of Object.entries(MONTHS)) {
  const text = decode(new Uint8Array(await (await get(`https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=${rid}`)).arrayBuffer()));
  const got = parse(text); rows.push(...got); console.log(`month ${m}: ${got.length}`);
}
// The source repeats a few 案件編號 (same case listed twice); keep the first
const seen = new Set(), uniq = rows.filter(r => !seen.has(r.id) && seen.add(r.id));
const inTaipei = uniq.filter(r => DISTRICTS.includes(r.addr.slice(0, 3)));
console.log(`rows ${rows.length}, duplicate ids dropped ${rows.length - uniq.length}, outside Taipei dropped ${uniq.length - inTaipei.length}`);

const keyOf = r => { const rd = road(r.addr); return r.addr.slice(0, 3) + "|" + (rd || ""); };
const DRY = process.env.DRY || ""; // DRY=1: no geocoding, nothing written; DRY=/path/x.json writes the ungeocoded result there
const need = DRY ? [] : [...new Set(inTaipei.map(keyOf))].filter(k => !known[k]);
if (DRY) for (const k of new Set(inTaipei.map(keyOf))) known[k] ||= [...CENTER[k.split("|")[0]], "district"];
console.log(`roads to geocode: ${need.length} (~${Math.ceil(need.length * 1.15 / 60)} min)`);
let done = 0;
for (const k of need) {
  const [d, rd] = k.split("|");
  const c = rd ? await geocode(d, rd) : null;
  // ponytail: road centroid from Nominatim; misses and hits far from the district fall back to its centre (loc "district")
  const ok = c && Math.hypot(c[0] - CENTER[d][0], c[1] - CENTER[d][1]) < 0.08;
  known[k] = ok ? [...c, "road"] : [...CENTER[d], "district"];
  if (++done % 50 === 0) { writeFileSync(roadsFile, JSON.stringify(known)); console.log(`  ${done}/${need.length}`); }
}
if (!DRY) writeFileSync(roadsFile, JSON.stringify(known));

const roadKeys = [...new Set(inTaipei.map(keyOf))].sort(), roadIdx = new Map(roadKeys.map((k, i) => [k, i]));
const itemNames = [...new Set(inTaipei.map(r => canonItem(r.item)))].sort(), itemIdx = new Map(itemNames.map((n, i) => [n, i]));
const days = {};
for (const r of inTaipei.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
  const day = `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`;
  (days[day] ||= []).push([roadIdx.get(keyOf(r)), itemIdx.get(canonItem(r.item)), +r.time.slice(0, 4)]);
}
const out = {
  source: "臺北市政府1999派工資料（data.taipei）", range: ["2026-01-01", "2026-09-30"],
  // a cached road hit outside the city boundary (e.g. 北新路三段 is in 新店) falls back to its district centre
  roads: roadKeys.map(k => { const [d, rd] = k.split("|"), [la, ln, how] = known[k], ok = how === "road" && inRing(la, ln);
    return ok ? [d, rd, la, ln, 1] : [d, rd, ...CENTER[d], 0]; }),
  items: itemNames.map(n => [n, mainOf(n) || ""]), days,
};

// Checks: every day present, counts add up, every item mapped, coords near Taipei, no house numbers in the output
const total = Object.values(days).reduce((s, d) => s + d.length, 0);
assert.equal(total, inTaipei.length);
for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2026, 8, 30); t += 864e5) assert.ok(days[new Date(t).toISOString().slice(0, 10)], "day " + new Date(t).toISOString().slice(0, 10));
for (const [n, c] of out.items) assert.ok(c, "unmapped item " + n);
for (const [, , la, ln] of out.roads) assert.ok(inRing(la, ln), "inside the Taipei boundary");
const json = JSON.stringify(out);
assert.ok(!/號|樓|巷|弄/.test(JSON.stringify(out.roads)), "no house-level detail");
if (!DRY || DRY.endsWith(".json")) writeFileSync(DRY || at("history-2026.json"), json); // DRY=/path/x.json writes there for inspection
console.log(`wrote ${total} cases, ${out.roads.length} roads (${out.roads.filter(r => r[4]).length} geocoded), ${(json.length / 1e6).toFixed(2)} MB`);
