// A double tap on +1 must add one vote. The second tap must not read the optimistic state and remove it.
// Run against a local Worker: BASE=http://localhost:8788 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/vote-double-tap.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const runId = crypto.randomUUID().slice(0, 8);

const post = async (path, headers, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const visitor = (await post("/api/visitor", {}, {})).body;
const owner = visitor.id.split(".")[0];
const key = `vote-${runId}`;
const id = `${owner}:${key}`;
const title = `連點投票測試 ${runId}`;
const item = { title, body: `連點 +1 只能算一票 ${runId}`, createdAt: new Date().toISOString(),
  author: owner, dept: "1999 待分派", tags: [], photos: [], notes: [] };
const contact = { name: "投票測試", phone: "0912000000", email: "vote@example.com", realName: false };
const created = await post("/api/db", { "x-visitor": visitor.id },
  { op: "create-report", path: `reports/${owner}`, data: { key, item, contact } });
assert.equal(created.status, 200, `created the test case: ${created.body.error || "ok"}`);

const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
let writes = 0;
page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/api/db")) writes++; });
// Keep the write in flight so the test always covers the time between the two taps, as on a slow phone network.
await page.route("**/api/db", async route => {
  if (route.request().method() === "POST") await new Promise(r => setTimeout(r, 500));
  await route.continue();
});
const vote = () => page.locator(`[data-vote="${id}"]`);
const count = async () => +(await vote().innerText()).match(/\+1\s+(\d+)/)[1];
const pressed = () => vote().getAttribute("aria-pressed");

try {
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
  await page.goto(BASE + "/#issues", { waitUntil: "domcontentloaded" });
  await vote().waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await pressed(), "false", "the new case starts unvoted");
  assert.equal(await count(), 0, "the new case starts at +1 0");

  writes = 0;
  await vote().dblclick();
  await page.waitForFunction(id => document.querySelector(`[data-vote="${id}"]`)?.getAttribute("aria-pressed") === "true", id);
  await page.waitForTimeout(900);
  assert.equal(writes, 1, `a double tap sends one vote write: ${writes}`);
  assert.equal(await pressed(), "true", "a double tap leaves the vote on");
  assert.equal(await count(), 1, "a double tap adds one vote");

  await page.reload({ waitUntil: "domcontentloaded" });
  await vote().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(id => document.querySelector(`[data-vote="${id}"]`)?.getAttribute("aria-pressed") === "true", id, { timeout: 15000 });
  assert.equal(await count(), 1, "the server kept the double-tap vote");

  writes = 0;
  await vote().click();
  await page.waitForFunction(id => document.querySelector(`[data-vote="${id}"]`)?.getAttribute("aria-pressed") === "false", id);
  await page.waitForTimeout(900);
  assert.equal(writes, 1, `one tap after the write sends one undo write: ${writes}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await vote().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(id => document.querySelector(`[data-vote="${id}"]`)?.getAttribute("aria-pressed") === "false", id, { timeout: 15000 });
  assert.equal(await count(), 0, "one later tap still removes the vote");

  assert.deepEqual(errors, [], "no page errors");
  console.log("OK double tap adds one vote; a later single tap still removes it");
} finally {
  await context.close();
  await browser.close();
  await post("/api/db", { "x-admin": "1" }, { op: "delete", path: `triage/${id}` }).catch(() => {});
  await post("/api/db", { "x-admin": "1" }, { op: "delete", path: `reports/${owner}` }).catch(() => {});
  await post("/api/db", { "x-admin": "1" }, { op: "delete", path: `votes/${owner}` }).catch(() => {});
}
