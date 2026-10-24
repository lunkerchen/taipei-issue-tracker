// An open case can leave the list from under the reader: a search filter, or an admin in another tab hiding or fixing it.
// The detail must close, the #issue URL must not survive, the reader must get a notice, and keyboard focus must not fall to BODY.
// Run against a local Worker: BASE=http://localhost:8787 node worker/test/stale-open-detail.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASE = (process.env.BASE || "http://localhost:8787").replace(/\/$/, "");
const runId = Date.now().toString(36);
const adminHeaders = { "content-type": "application/json", "x-admin": "1" };
const post = async (path, body, headers = { "content-type": "application/json" }) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: r.status, body: await r.json() };
};
const token = (await post("/api/visitor", {})).body.id, owner = token.split(".")[0];
const keys = { keep: `keep-${runId}`, hide: `hide-${runId}`, fix: `fix-${runId}` };
const titles = { keep: `KEEP CASE ${runId}`, hide: `HIDE CASE ${runId}`, fix: `FIX CASE ${runId}` };
const item = (key, title) => ({ id: key, n: 1, title, body: `body of ${title}`, createdAt: new Date().toISOString(),
  dept: "環保局", district: "大安區", tags: ["噪音"], author: owner, status: "open", photos: [], notes: [] });
const contact = { name: "合成市民", phone: "0912345678", email: "citizen@example.com", realName: false };
const id = name => `${owner}:${keys[name]}`;
const enc = name => encodeURIComponent(id(name));
const write = (path, data) => post("/api/db", { op: "set", path, data }, adminHeaders);
let browser;

const state = page => page.evaluate(() => ({
  hash: location.hash,
  toast: document.getElementById("toast").textContent,
  active: document.activeElement === document.body ? "BODY" : document.activeElement?.id || document.activeElement?.dataset?.open || document.activeElement?.dataset?.share || document.activeElement?.tagName,
  inList: document.getElementById("list").contains(document.activeElement),
}));
const waitClosed = (page, name) => page.waitForFunction(([sel, hash]) =>
  !document.querySelector(sel) && location.hash === hash, [`[data-open="${id(name)}"]`, "#issues"], { timeout: 10000 });

try {
  for (const name of Object.keys(keys)) {
    const saved = await post("/api/db", { op: "create-report", path: `reports/${owner}`,
      data: { key: keys[name], item: item(keys[name], titles[name]), contact } }, { "content-type": "application/json", "x-visitor": token });
    assert.equal(saved.status, 200, `create ${name}`);
  }

  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));

  // A filter that removes the open case: close the detail, drop the stale #issue URL, keep the search box focused.
  await page.goto(`${BASE}/#issue/${enc("keep")}`, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-open="${id("keep")}"]`).waitFor({ timeout: 15000 });
  await page.waitForFunction(id => document.querySelector(`[data-open="${CSS.escape(id)}"]`)?.getAttribute("aria-expanded") === "true", id("keep"), { timeout: 15000 });
  await page.fill("#q", `HIDE CASE ${runId}`);
  await waitClosed(page, "keep");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("篩選"), null, { timeout: 5000 });
  let s = await state(page);
  assert.equal(s.active, "q", "the search box keeps focus after the filtered case closes");
  assert.match(s.toast, /這件案件已不符合目前的篩選，詳情已收起。/, `filter notice, got "${s.toast}"`);
  await page.fill("#q", "");
  await page.locator(`[data-open="${id("hide")}"]`).waitFor({ timeout: 10000 });

  // An admin in another tab hides the open case: no stale #issue URL, no focus dropped to BODY.
  await page.locator(`[data-open="${id("hide")}"]`).click();
  await page.locator(`[data-share="${id("hide")}"]`).focus();
  assert.equal((await state(page)).active, id("hide"), "focus starts on the open case's share button");
  assert.equal((await write(`triage/${id("hide")}`, { status: "open", hidden: true, events: [] })).status, 200, "admin hides the case");
  await waitClosed(page, "hide");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("無法公開"), null, { timeout: 8000 });
  s = await state(page);
  assert.equal(s.inList, true, "focus stays inside the list after the hidden case closes");
  assert.notEqual(s.active, "BODY", "focus does not fall to BODY");
  assert.ok(s.active !== id("hide"), "focus does not stay on the removed case");
  assert.match(s.toast, /這件案件目前無法公開，詳情已收起。/, `hide notice, got "${s.toast}"`);

  // An admin fixes the open case: the open tab drops it, so the detail closes with a fix notice.
  await page.locator(`[data-open="${id("fix")}"]`).click();
  await page.locator(`[data-share="${id("fix")}"]`).focus();
  assert.equal((await write(`triage/${id("fix")}`, { status: "fixed", events: [{ t: new Date().toISOString(), type: "status", to: "fixed", by: "qa" }] })).status, 200, "admin fixes the case");
  await waitClosed(page, "fix");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("已修復"), null, { timeout: 8000 });
  s = await state(page);
  assert.equal(s.inList, true, "focus stays inside the list after the fixed case closes");
  assert.notEqual(s.active, "BODY", "focus does not fall to BODY after a remote fix");
  assert.match(s.toast, /這件案件已改為已修復，詳情已收起。/, `fix notice, got "${s.toast}"`);

  // A shared case link that still exists must open on reload and must not be closed by the stale check.
  await page.goto(`${BASE}/#issue/${enc("keep")}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(id => document.querySelector(`[data-open="${CSS.escape(id)}"]`)?.getAttribute("aria-expanded") === "true", id("keep"), { timeout: 15000 });
  s = await state(page);
  assert.equal(s.hash, `#issue/${enc("keep")}`, "a live shared link keeps its #issue URL");
  assert.equal(s.toast, "", "a live shared link shows no stale notice");
  assert.deepEqual(errors, [], "no page errors");

  console.log("stale open details close cleanly");
} finally {
  try {
    for (const name of Object.keys(keys)) await fetch(`${BASE}/api/db`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ op: "delete", path: `triage/${id(name)}` }) });
    await fetch(`${BASE}/api/db`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ op: "delete", path: `reports/${owner}` }) });
    if (browser) await browser.close();
  } catch {}
}
