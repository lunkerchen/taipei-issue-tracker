// A double click on a case title opens the detail. The second click must not close it again.
// Run against a local Worker: BASE=http://localhost:8788 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/case-title-double-click.mjs
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
const key = `title-${runId}`;
const id = `${owner}:${key}`;
const title = `連點標題測試 ${runId}`;
const item = { title, body: `連點標題只能開啟一次 ${runId}`, createdAt: new Date().toISOString(),
  author: owner, dept: "1999 待分派", tags: [], photos: [], notes: [] };
const contact = { name: "標題測試", phone: "0912000000", email: "title@example.com", realName: false };
const created = await post("/api/db", { "x-visitor": visitor.id },
  { op: "create-report", path: `reports/${owner}`, data: { key, item, contact } });
assert.equal(created.status, 200, `created the test case: ${created.body.error || "ok"}`);

const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const heading = () => page.locator(`[data-open="${id}"]`);
const detail = () => page.locator(`.issue:has([data-open="${id}"]) .detail`);

try {
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
  await page.goto(BASE + "/#issues", { waitUntil: "domcontentloaded" });
  await heading().waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await heading().getAttribute("aria-expanded"), "false", "the case starts closed");

  await heading().dblclick();
  await page.waitForTimeout(500);
  assert.equal(await heading().getAttribute("aria-expanded"), "true", "a double click leaves the detail open");
  assert.equal(await detail().count(), 1, "the double click shows one detail");
  assert.equal(new URL(page.url()).hash, `#issue/${encodeURIComponent(id)}`, "the URL points at the open case");

  await heading().click();
  await page.waitForTimeout(300);
  assert.equal(await heading().getAttribute("aria-expanded"), "false", "one later click closes the detail");
  assert.equal(await detail().count(), 0, "the later click hides the detail");
  assert.equal(new URL(page.url()).hash, "#issues", "the URL returns to the list");

  assert.deepEqual(errors, [], "no page errors");
  console.log("OK double click opens one detail; one later click closes it");
} finally {
  await context.close();
  await browser.close();
  await post("/api/db", { "x-admin": "1" }, { op: "delete", path: `triage/${id}` }).catch(() => {});
  await post("/api/db", { "x-admin": "1" }, { op: "delete", path: `reports/${owner}` }).catch(() => {});
}
