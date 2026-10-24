// The search field finds a case by number, and an input method editor does not filter on pre-edit text.
// Run against a local Worker: BASE=http://localhost:8788 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/search-input.mjs
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
const key = `search-${runId}`;
const id = `${owner}:${key}`;
const title = `搜尋編號測試 ${runId}`;
const item = { title, body: `這是一筆用於搜尋測試的陳情 ${runId}`, createdAt: new Date().toISOString(),
  author: owner, dept: "1999 待分派", tags: [], photos: [], notes: [] };
const contact = { name: "搜尋測試", phone: "0912000000", email: "search@example.com", realName: false };
const created = await post("/api/db", { "x-visitor": visitor.id },
  { op: "create-report", path: `reports/${owner}`, data: { key, item, contact } });
assert.equal(created.status, 200, `created the test case: ${created.body.error || "ok"}`);
const n = created.body.data?.items?.[key]?.n;
assert.ok(Number.isInteger(n) && n > 0, `the new case has a number: ${n}`);

const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const card = page.locator(`#list [data-open="${id}"]`);
const empty = page.locator("#list .empty");
const rows = page.locator("#list .issue");
const search = async q => {
  await page.locator("#q").fill(q);
  await page.waitForTimeout(150);
};
const expectCard = async (q, why) => {
  await search(q);
  await card.waitFor({ state: "visible", timeout: 5000 });
  assert.ok(!(await empty.count()) || !(await empty.isVisible()), `${why}: no false empty state`);
};

try {
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
  await page.goto(BASE + "/#issues", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await card.waitFor({ state: "visible", timeout: 20000 });
  const base = await rows.count();
  assert.ok(base >= 1, `the list loaded its cases: ${base}`);

  await expectCard(`#${n}`, `#${n} finds the case`);
  assert.equal(await rows.count(), 1, "a numbered search shows only the matching case");
  await expectCard(String(n), `${n} finds the case`);
  await expectCard(`＃${n}`, `full-width ＃${n} finds the case`);
  await expectCard(`#  ${n}`, `a spaced # ${n} finds the case`);

  await search(`#${n}999999`);
  await empty.waitFor({ state: "visible", timeout: 5000 });
  assert.ok((await empty.innerText()).includes("沒有符合條件的案件"), "an unknown number shows the empty state");

  await expectCard(runId, "a text search still finds the case by title");

  const cdp = await context.newCDPSession(page);
  await search("");
  await page.waitForFunction(base => document.querySelectorAll("#list .issue").length === base, base, { timeout: 5000 });
  await page.locator("#q").click();
  await cdp.send("Input.imeSetComposition", { text: "ㄊ", selectionStart: 1, selectionEnd: 1 });
  await page.waitForTimeout(300);
  assert.equal(await rows.count(), base, "pre-edit IME text does not filter the list");
  assert.ok(!(await empty.count()) || !(await empty.isVisible()), "pre-edit IME text does not show an empty result");
  await cdp.send("Input.imeSetComposition", { text: "ㄊㄞˊ", selectionStart: 3, selectionEnd: 3 });
  await page.waitForTimeout(300);
  assert.equal(await rows.count(), base, "the second pre-edit does not filter the list");
  await cdp.send("Input.insertText", { text: "台" });
  await page.waitForFunction(() => document.querySelector("#q")?.value === "台", null, { timeout: 5000 });
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#q").inputValue(), "台", "the composed text is in the field");

  await search("");
  await page.waitForFunction(base => document.querySelectorAll("#list .issue").length === base, base, { timeout: 5000 });
  assert.deepEqual(errors, [], "no page errors");
  console.log(`OK #${n} search: number, #number, full-width number, unknown number and IME composition`);
} finally {
  await context.close();
  await browser.close();
  await post("/api/db", { "x-admin": "1" }, { op: "delete", path: `triage/${id}` }).catch(() => {});
  await post("/api/db", { "x-admin": "1" }, { op: "delete", path: `reports/${owner}` }).catch(() => {});
}
