// Run against a local Worker: BASE=http://localhost:9028 PLAYWRIGHT_MODULE=... node worker/test/pr-merge-feedback.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:9028";
// The cleanup reads /api/contact, which needs the real key; the browser part uses the token-free ?admin demo.
const ADMIN = process.env.ADMIN_TOKEN || /^ADMIN_TOKEN=(.*)$/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))[1];
const prefix = `qa-pr-${randomUUID().slice(0, 8)}`;
const owner = randomBytes(8).toString("hex");
const now = new Date().toISOString();
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});
const db = (op, path, data) => post("/api/db", { "x-admin":ADMIN }, data === undefined ? { op, path } : { op, path, data });
const snapshot = async () => (await fetch(BASE + "/api/db", { headers:{ "x-admin":ADMIN } })).json();
const contactOf = async id => (await (await fetch(`${BASE}/api/contact?id=${encodeURIComponent(id)}`, {
  headers:{ "x-admin":ADMIN }, signal:AbortSignal.timeout(10000)
})).json()).contact;
const waitFor = async (check, message, timeout = 15000) => {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value; } catch (e) { last = e; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(message + (last ? ` (${last.message})` : ""));
};

const cases = {
  long: { key:`${prefix}-long`, title:`${prefix} 長標題案件` },
  merge: { key:`${prefix}-merge`, title:`${prefix} 桌面合併案件`, pr:88101 },
  fixed: { key:`${prefix}-fixed`, title:`${prefix} 桌面修復案件` },
  closed: { key:`${prefix}-closed`, title:`${prefix} 已修復分頁合併案件`, pr:88103 },
  mobile: { key:`${prefix}-mobile`, title:`${prefix} 手機合併案件`, pr:88102 },
};
const idOf = key => `${owner}:${key}`;
const item = (title, n) => ({ title, body:`pr merge feedback test ${prefix}`, author:owner,
  createdAt:new Date(Date.now() + n).toISOString(), dept:"環境保護局", tags:[], photos:[], notes:[], district:"中正區", category:"" });

async function cleanup() {
  for (const c of Object.values(cases)) await db("delete", `triage/${idOf(c.key)}`).catch(() => {});
  await db("delete", `reports/${owner}`).catch(() => {});
  // Seeding with the admin header never creates a contacts row (only create-report does), so assert none is left.
  const left = await snapshot();
  assert.equal(left.reports?.[owner], undefined, "test reports are deleted");
  for (const c of Object.values(cases)) {
    assert.equal(left.triage?.[idOf(c.key)], undefined, `triage ${c.key} is deleted`);
    assert.equal(await contactOf(idOf(c.key)), null, `no contact is stored for ${c.key}`);
  }
}

async function openApp(browser, viewport, hash, titles = []) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${BASE}/?admin#${hash}`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => !document.getElementById("navAdmin").hidden, null, { timeout:20000 });
  if (hash === "issues" && titles.length) await page.waitForFunction(wanted => wanted.every(title =>
    [...document.querySelectorAll("#list .issue")].some(x => x.textContent.includes(title))), titles, { timeout:20000 });
  return { context, page, errors };
}

const cardFor = (page, title) => page.locator("#list .issue").filter({ hasText:title });
const toastText = page => page.locator("#toast").innerText();

let browser, cleaned = false;
try {
  const items = {};
  Object.values(cases).forEach((c, n) => items[c.key] = item(c.title, n));
  const seededResponse = await db("update", `reports/${owner}`, { items });
  assert.equal(seededResponse.status, 200, "seed reports with administrator access");
  for (const c of [cases.merge, cases.closed, cases.mobile]) {
    const events = [{ t:now, type:"opened" }, { t:now, type:"pr", n:c.pr, title:`${prefix} 既有修繕單`, by:"環境保護局" }];
    if (c === cases.closed) events.push({ t:now, type:"status", to:"fixed" });
    const response = await db("set", `triage/${idOf(c.key)}`, { status:c === cases.closed ? "fixed" : "progress", events });
    assert.equal(response.status, 200, `seed triage for ${c.key}`);
  }

  browser = await chromium.launch({ headless:true,
    ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });

  // Desktop: title limit, duplicate click, merge, fixed, and the closed tab.
  {
    const { context, page, errors } = await openApp(browser, { width:1280, height:900 }, "admin");
    await page.locator('#nav [data-view="issues"]').click();
    await page.waitForFunction(title => [...document.querySelectorAll("#list .issue")].some(x => x.textContent.includes(title)),
      cases.long.title, { timeout:20000 });

    const card = cardFor(page, cases.long.title);
    await card.locator("button.title").click();
    const input = card.locator('.detail input[id^="pr-"]');
    await input.waitFor();
    assert.equal(await input.getAttribute("maxlength"), "80", "Q12-05: the PR title input has maxlength 80");
    const long = (prefix + "-").padEnd(225, "A");
    assert.equal(long.length, 225, "the paste text is 225 characters");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin:BASE });
    await page.evaluate(text => navigator.clipboard.writeText(text), long);
    await input.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
    const pasted = await input.inputValue();
    assert.equal(pasted.length, 80, "Q12-05: a 225-character paste leaves 80 characters");
    assert.equal(pasted, long.slice(0, 80), "Q12-05: the visible title is the first 80 characters");
    await card.locator("[data-pr]").click();
    const prEvent = await waitFor(async () => {
      const events = ((await snapshot()).triage?.[idOf(cases.long.key)]?.events || []).filter(e => e.type === "pr");
      return events.length ? events[0] : null;
    }, "Q12-05: the PR event is stored");
    assert.equal(prEvent.title.length, 80, "Q12-05: the stored title length is 80");
    assert.equal(prEvent.title, pasted, "Q12-05: the stored title equals the visible input");
    await page.waitForFunction(() => document.getElementById("toast").textContent.includes("已建立 PR"), null, { timeout:15000 });
    const createdToast = await toastText(page);
    assert.match(createdToast, /已建立 PR #\d+/, "Q12-06: success is announced");
    const createdN = Number(/已建立 PR #(\d+)/.exec(createdToast)[1]);
    assert.equal(prEvent.n, createdN, "Q12-06: the toast names the stored PR");
    assert.equal(await input.inputValue(), "", "Q12-06: the input is cleared after success");

    // Re-renders keep the cleared field empty, and a second click with it does nothing.
    await page.waitForTimeout(800);
    assert.equal(await input.inputValue(), "", "Q12-06: a re-render does not restore the old title");
    await card.locator("[data-pr]").click();
    await page.waitForTimeout(1200);
    const afterSecond = ((await snapshot()).triage?.[idOf(cases.long.key)]?.events || []).filter(e => e.type === "pr");
    assert.equal(afterSecond.length, 1, "Q12-06: a second click with an empty input creates no PR");

    await page.locator('#nav [data-view="pulls"]').click();
    await page.waitForSelector("#prList .row-item", { timeout:15000 });
    assert.equal(await page.locator("#prList .row-item").filter({ hasText:pasted.slice(0, 40) }).count(), 1,
      "Q12-06: the Pull requests page shows one entry");
    await page.locator('#nav [data-view="issues"]').click();
    await page.waitForFunction(title => [...document.querySelectorAll("#list .issue")].some(x => x.textContent.includes(title)),
      cases.merge.title, { timeout:15000 });

    // Merge from the Open list closes the detail and returns the URL to the list.
    const mergeCard = cardFor(page, cases.merge.title);
    await mergeCard.locator("button.title").click();
    await page.waitForFunction(() => location.hash.startsWith("#issue/"), null, { timeout:15000 });
    await mergeCard.locator("[data-merge]").click();
    await page.waitForFunction(() => document.getElementById("toast").textContent.includes("合併"), null, { timeout:15000 });
    assert.match(await toastText(page), new RegExp(`已合併 PR #${cases.merge.pr}，案件標記為已修復`), "Q12-07: merge shows a toast");
    await page.waitForFunction(() => location.hash === "#issues", null, { timeout:15000 });
    await page.waitForFunction(title => ![...document.querySelectorAll("#list .issue")].some(x => x.textContent.includes(title)),
      cases.merge.title, { timeout:15000 });
    const mergeTriage = (await snapshot()).triage?.[idOf(cases.merge.key)];
    assert.equal(mergeTriage.status, "fixed", "Q12-07: the merge marks the case fixed");
    assert.ok(mergeTriage.events.some(e => e.type === "merged" && e.pr === cases.merge.pr), "Q12-07: the merge event is stored");

    // Mark fixed from the Open list.
    const fixedCard = cardFor(page, cases.fixed.title);
    await fixedCard.locator("button.title").click();
    await page.waitForFunction(() => location.hash.startsWith("#issue/"), null, { timeout:15000 });
    await fixedCard.locator('[data-status="fixed"]').click();
    await page.waitForFunction(() => document.getElementById("toast").textContent.includes("已標記為已修復"), null, { timeout:15000 });
    assert.equal(await toastText(page), "已標記為已修復", "Q12-07: fixed shows a toast");
    await page.waitForFunction(() => location.hash === "#issues", null, { timeout:15000 });
    await page.waitForFunction(title => ![...document.querySelectorAll("#list .issue")].some(x => x.textContent.includes(title)),
      cases.fixed.title, { timeout:15000 });
    assert.equal((await snapshot()).triage?.[idOf(cases.fixed.key)]?.status, "fixed", "Q12-07: the status is fixed");

    // On the Closed tab the detail stays open; the toast still appears.
    await page.locator("#tabClosed").click();
    await page.waitForFunction(title => [...document.querySelectorAll("#list .issue")].some(x => x.textContent.includes(title)),
      cases.closed.title, { timeout:15000 });
    const closedCard = cardFor(page, cases.closed.title);
    await closedCard.locator("button.title").click();
    await page.waitForFunction(() => location.hash.startsWith("#issue/"), null, { timeout:15000 });
    const closedHash = await page.evaluate(() => location.hash);
    await closedCard.locator("[data-merge]").click();
    await page.waitForFunction(() => document.getElementById("toast").textContent.includes("合併"), null, { timeout:15000 });
    assert.match(await toastText(page), new RegExp(`已合併 PR #${cases.closed.pr}`), "closed tab: merge still shows a toast");
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => location.hash), closedHash, "closed tab: the detail hash stays");
    assert.equal(await closedCard.locator(".detail").count(), 1, "closed tab: the detail stays open");

    await context.close();
    assert.deepEqual(errors, [], "desktop: no page errors");
  }

  // Phone: the same merge case leaves the Open list and returns to the list URL.
  {
    const { context, page, errors } = await openApp(browser, { width:390, height:844 }, "issues", [cases.mobile.title]);
    const card = cardFor(page, cases.mobile.title);
    await card.locator("button.title").click();
    await page.waitForFunction(() => location.hash.startsWith("#issue/"), null, { timeout:15000 });
    await card.locator("[data-merge]").click();
    await page.waitForFunction(() => document.getElementById("toast").textContent.includes("合併"), null, { timeout:15000 });
    assert.match(await toastText(page), new RegExp(`已合併 PR #${cases.mobile.pr}，案件標記為已修復`), "phone: merge shows a toast");
    await page.waitForFunction(() => location.hash === "#issues", null, { timeout:15000 });
    await page.waitForFunction(title => ![...document.querySelectorAll("#list .issue")].some(x => x.textContent.includes(title)),
      cases.mobile.title, { timeout:15000 });
    assert.equal((await snapshot()).triage?.[idOf(cases.mobile.key)]?.status, "fixed", "phone: the merge marks the case fixed");
    await context.close();
    assert.deepEqual(errors, [], "phone: no page errors");
  }

  await browser.close();
  browser = null;
  await cleanup();
  cleaned = true;
  console.log("OK: PR title stops at 80 and clears after success; a second click adds no PR; merge/fixed toast and return the list URL to #issues.");
} finally {
  await browser?.close();
  if (!cleaned) await cleanup().catch(e => console.error("cleanup failed:", e.message));
}
