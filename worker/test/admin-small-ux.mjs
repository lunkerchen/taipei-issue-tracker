// Admin small UX fixes: long contact text, active nav tab, Open count vs KPI, search placeholder.
// Run against a dedicated local Worker: BASE=http://localhost:9030 node worker/test/admin-small-ux.mjs
// The private contact row cannot be deleted through /api/db, so the cleanup also resets the local demo data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = (process.env.BASE || "http://localhost:9030").replace(/\/$/, "");
// Reading contacts needs the real admin key (worker/.dev.vars); the token-free ?admin demo gets 403.
const ADMIN = process.env.ADMIN_TOKEN || /^ADMIN_TOKEN=(.*)$/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))[1];
// The page keeps the #admin=<key> in this tab's sessionStorage and clears the hash. Then a full load of #admin opens
// the admin view like ?admin#admin did; a same-page hash change would scroll to the #admin element instead.
const openAdmin = async page => {
  await page.goto(BASE + "/#admin=" + encodeURIComponent(ADMIN), { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => !location.hash.includes("admin="));
  await page.goto("about:blank");
  await page.goto(BASE + "/#admin", { waitUntil:"domcontentloaded" });
};
const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  body:JSON.stringify(body), signal:AbortSignal.timeout(10000)
});
const dbPost = (headers, body) => post("/api/db", headers, body);
const adminHeaders = { "x-admin":ADMIN };

const mint = async () => {
  const r = await post("/api/visitor", {}, {});
  assert.equal(r.status, 200, "mint a visitor identity");
  const { id:token } = await r.json();
  return { token, owner:token.split(".")[0] };
};
const ownerA = await mint(), ownerB = await mint();
const keys = { long:"long-contact", hide:"hide-me", hidden:"hidden-seed", flagged:"flagged-seed", fix:"fix-me" };
const title = name => `QA small UX ${name} ${runId}`;
const longEmail = "a".repeat(120) + "@" + "b".repeat(54) + "." + "b".repeat(53) + ".com"; // 233 characters; domain labels stay within 63
assert.equal(longEmail.length, 233, "the long contact email has 233 characters");
const item = name => ({ title:title(name), body:`本機合成小型後台 UX 測試 ${runId}`, createdAt:new Date().toISOString(),
  author:ownerB.owner, dept:"工務局", district:"大安區", tags:[], photos:[], notes:[] });
const contact = { name:"合成聯絡人", phone:"0912345678", email:longEmail, realName:false };
const created = [];

const counts = page => page.evaluate(() => {
  const firstNumber = text => {
    const m = String(text || "").match(/\d+/);
    return m ? Number(m[0]) : NaN;
  };
  const tab = firstNumber(document.querySelector("#tabOpen")?.textContent);
  const cell = [...document.querySelectorAll("#admKpi > div")].find(d => d.querySelector("span")?.textContent.trim() === "未結案件");
  const kpi = firstNumber(cell?.querySelector("b")?.textContent);
  return { tab, kpi };
});
const waitCounts = async (page, expected) => page.waitForFunction(expected => {
  const n = s => { const m = String(s || "").match(/\d+/); return m ? Number(m[0]) : NaN; };
  const tab = n(document.querySelector("#tabOpen")?.textContent);
  const cell = [...document.querySelectorAll("#admKpi > div")].find(d => d.querySelector("span")?.textContent.trim() === "未結案件");
  const kpi = n(cell?.querySelector("b")?.textContent);
  return Number.isFinite(tab) && Number.isFinite(kpi) && (expected === null || (tab === expected && kpi === expected));
}, expected, { timeout:20000 });
const activeNav = page => page.evaluate(() => {
  const nav = document.querySelector("#nav"), b = nav?.querySelector('[aria-current="page"]');
  if (!b) return null;
  const r = b.getBoundingClientRect(), n = nav.getBoundingClientRect();
  return { view:b.dataset.view, left:r.left, right:r.right, navLeft:n.left, navRight:n.right, scrollLeft:nav.scrollLeft,
    innerWidth:innerWidth, scrollY:scrollY, docWidth:document.documentElement.scrollWidth };
});
const measureContact = (page, email) => page.evaluate(email => {
  const span = [...document.querySelectorAll("#list .detail .admin span.note")].find(s => s.textContent.includes("聯絡人"));
  if (!span) throw new Error("the contact span is in the admin block");
  if (!span.textContent.includes(email)) throw new Error(`the contact span shows the ${email.length}-character email`);
  const admin = span.closest(".admin"), detail = span.closest(".detail");
  const r = span.getBoundingClientRect(), a = admin.getBoundingClientRect(), d = detail.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(span).lineHeight) || 20;
  return { rects:span.getClientRects().length, width:r.width, height:r.height, line,
    right:r.right, adminRight:a.right, adminWidth:a.width, detailRight:d.right, detailWidth:d.width };
}, email);
const openContact = async page => {
  // Admin keeps its controls on the Issues view; the admin console itself has no full case list.
  await page.locator('#nav [data-view="issues"]').click();
  await page.locator("#q").waitFor({ state:"visible" });
  await page.locator("#q").fill(title("long contact"));
  const row = page.locator("#list .issue").filter({ has: page.locator(".title", { hasText:title("long contact") }) });
  await row.locator(".title").click();
  const button = row.locator("[data-contact]");
  await button.waitFor({ state:"visible" });
  await button.click();
  const span = row.locator(".detail .admin span.note", { hasText:"聯絡人" });
  await span.waitFor({ state:"visible", timeout:10000 });
  return span;
};

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
const errors = [];
try {
  assert.equal((await post("/api/db", { "x-visitor":ownerA.token }, { op:"create-report", path:`reports/${ownerA.owner}`,
    data:{ key:keys.long, item:{ ...item("long contact"), author:ownerA.owner }, contact } })).status, 200, "create the long-contact case");
  created.push(`reports/${ownerA.owner}`, `triage/${ownerA.owner}:${keys.long}`);
  const items = {
    [keys.hide]:item("hide me"),
    [keys.hidden]:item("hidden seed"),
    [keys.flagged]:{ ...item("flagged seed"), flagged:true },
    [keys.fix]:item("fix me"),
  };
  assert.equal((await dbPost(adminHeaders, { op:"update", path:`reports/${ownerB.owner}`, data:{ items } })).status, 200,
    "create the hidden, flagged, hide and fix cases");
  created.push(`reports/${ownerB.owner}`);
  for (const key of Object.keys(items)) created.push(`triage/${ownerB.owner}:${key}`);
  assert.equal((await dbPost(adminHeaders, { op:"set", path:`triage/${ownerB.owner}:${keys.hidden}`,
    data:{ status:"open", hidden:true, events:[] } })).status, 200, "seed a hidden case");

  // 390px: the admin nav scrolls to the active tab, and contact text wraps inside the detail.
  {
    const context = await browser.newContext({ viewport:{ width:390, height:844 } });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await openAdmin(page);
    await page.locator("#navAdmin").waitFor({ state:"visible", timeout:20000 });
    await waitCounts(page, null);

    let nav = await activeNav(page);
    assert.equal(nav?.view, "admin", "the admin tab is active after ?admin#admin loads");
    assert.ok(nav.left >= 0 && nav.right <= nav.innerWidth + 0.5, `the active admin tab is inside the 390px viewport, got ${nav.left}-${nav.right}`);
    assert.ok(nav.scrollLeft > 0, `#nav scrolls to the active admin tab, got scrollLeft ${nav.scrollLeft}`);
    assert.equal(nav.docWidth, 390, `the page stays 390px wide, got ${nav.docWidth}`);
    const scrollY = nav.scrollY;

    await page.locator('#nav [data-view="code"]').click();
    await page.waitForFunction(() => document.querySelector('#nav [aria-current="page"]')?.dataset.view === "code");
    await page.locator("#navAdmin").click();
    await page.waitForFunction(() => document.querySelector('#nav [aria-current="page"]')?.dataset.view === "admin");
    nav = await activeNav(page);
    assert.ok(nav.left >= 0 && nav.right <= nav.innerWidth + 0.5, `the active admin tab stays inside the viewport after switching, got ${nav.left}-${nav.right}`);
    assert.ok(nav.scrollLeft > 0, `#nav keeps the active admin tab in view, got scrollLeft ${nav.scrollLeft}`);
    assert.equal(nav.scrollY, scrollY, "switching views does not scroll the page vertically");
    assert.equal(nav.docWidth, 390, `the page stays 390px wide after switching, got ${nav.docWidth}`);
    assert.equal(await page.locator("#q").getAttribute("placeholder"), "搜尋標題或內容", "the admin search hint has no is:issue");

    // A live re-render keeps the active tab in the nav, but must not pull a scrolled page back to the top.
    const jump = await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      if (max < 200) return null;
      window.scrollTo(0, Math.min(600, max));
      const before = scrollY;
      render();
      return { before, after:scrollY };
    });
    assert.ok(jump === null || jump.after === jump.before,
      `a re-render keeps the page scroll position, got ${jump?.before} to ${jump?.after}`);
    console.log(`re-render scroll OK ${jump ? `${jump.before}->${jump.after}` : "page too short"}`);

    await openContact(page);
    let m = await measureContact(page, longEmail);
    assert.ok(m.right <= Math.min(m.adminRight, m.detailRight) + 1,
      `390px: contact text ends at ${m.right}, inside admin ${m.adminRight} and detail ${m.detailRight}`);
    assert.ok(m.rects > 1 || m.height > m.line * 1.5, `390px: the long email wraps, rects ${m.rects} height ${m.height} line ${m.line}`);
    console.log(`390px contact OK width=${m.width.toFixed(1)} height=${m.height.toFixed(1)} rects=${m.rects}`);

    // Counts: Open tab and 未結案件 KPI agree before and after hiding, and both drop together after a fix.
    await page.locator("#q").fill("");
    await waitCounts(page, null);
    let before = await counts(page);
    assert.equal(before.tab, before.kpi, `the Open tab (${before.tab}) matches the KPI (${before.kpi})`);
    assert.equal((await dbPost(adminHeaders, { op:"set", path:`triage/${ownerB.owner}:${keys.hide}`,
      data:{ status:"open", hidden:true, events:[] } })).status, 200, "hide one case");
    await page.waitForFunction(t => [...document.querySelectorAll("#list .issue")].some(el =>
      el.textContent.includes(t) && el.querySelector(".labels")?.textContent.includes("已隱藏")), title("hide me"), { timeout:15000 });
    let hidden = await counts(page);
    assert.equal(hidden.tab, before.tab, "hiding a case does not change the Open tab count");
    assert.equal(hidden.kpi, before.kpi, "hiding a case does not change the KPI");
    assert.equal(hidden.tab, hidden.kpi, `after hiding, the Open tab (${hidden.tab}) matches the KPI (${hidden.kpi})`);
    assert.equal((await dbPost(adminHeaders, { op:"set", path:`triage/${ownerB.owner}:${keys.fix}`,
      data:{ status:"fixed", events:[{ t:new Date().toISOString(), type:"status", to:"fixed" }] } })).status, 200, "fix one case");
    await waitCounts(page, before.tab - 1);
    const fixed = await counts(page);
    assert.equal(fixed.tab, before.tab - 1, "fixing a case decrements the Open tab by one");
    assert.equal(fixed.kpi, before.kpi - 1, "fixing a case decrements the KPI by one");
    console.log(`counts OK before=${before.tab}/${before.kpi} hidden=${hidden.tab}/${hidden.kpi} fixed=${fixed.tab}/${fixed.kpi}`);
    await context.close();
  }

  // 1280px: the same contact text stays inside its container.
  {
    const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await openAdmin(page);
    await page.locator("#navAdmin").waitFor({ state:"visible", timeout:20000 });
    await waitCounts(page, null);
    await openContact(page);
    const m = await measureContact(page, longEmail);
    assert.ok(m.right <= Math.min(m.adminRight, m.detailRight) + 1,
      `1280px: contact text ends at ${m.right}, inside admin ${m.adminRight} and detail ${m.detailRight}`);
    assert.ok(m.rects > 1 || m.height > m.line * 1.5, `1280px: the long email wraps, rects ${m.rects} height ${m.height} line ${m.line}`);
    console.log(`1280px contact OK width=${m.width.toFixed(1)} height=${m.height.toFixed(1)} rects=${m.rects}`);
    await context.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  console.log("OK admin small UX: nav, contact wrapping, counts and placeholder");
} finally {
  await browser.close();
  for (const path of [...new Set(created)]) await dbPost(adminHeaders, { op:"delete", path }).catch(() => {});
  // The contacts table has no delete route; resetting the local demo database removes the private contact row.
  await post("/api/reset", adminHeaders, {}).catch(() => {});
}
