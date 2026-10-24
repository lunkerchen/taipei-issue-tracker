// A live hide must not silently discard a half-written addendum.
// Run: BASE=http://127.0.0.1:9006 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/orphan-draft.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});
const write = (headers, op, path, data) => post("/api/db", headers, { op, path, data });

const visitor = await (await post("/api/visitor", {})).json();
const [visitorId] = visitor.id.split(".");
const runId = crypto.randomUUID().slice(0, 8), key = "orphan-draft";
const id = `${visitorId}:${key}`;
const title = `草稿保留測試 ${runId}`;
const draft = `未送出的補充草稿 ${runId}：今天又更嚴重了`;
assert.equal((await write({ "x-visitor":visitor.id }, "update", `reports/${visitorId}`, { items:{ [key]:{
  title, body:`管理員隱藏案件時，未送出的補充不能無提示消失。${runId}`, createdAt:new Date().toISOString(),
  author:visitorId, dept:"1999 待分派", tags:[], photos:[], notes:[]
} } })).status, 200, "seed an own case");
assert.equal((await write({ "x-admin":"1" }, "update", `triage/${id}`, { status:"open" })).status, 200, "seed triage");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
const pageErrors = [];
try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 } });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
  await page.goto(BASE + "/#issues", { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  const titleButton = page.locator("#list button.title").filter({ hasText:title });
  await titleButton.waitFor({ state:"visible", timeout:10000 });
  await titleButton.click();
  const note = page.locator(`textarea[id="note-${id}"]`);
  await note.waitFor({ state:"visible" });
  await note.fill(draft);

  // An admin hides the case from another session; the visitor's open detail disappears.
  assert.equal((await write({ "x-admin":"1" }, "update", `triage/${id}`, { hidden:true })).status, 200, "hide the case");
  await page.waitForFunction(t => ![...document.querySelectorAll("#list button.title")].some(b => b.textContent.trim() === t), title, { timeout:10000 });
  await page.locator("#draftBox").waitFor({ state:"visible", timeout:10000 });
  assert.equal(await page.locator(`textarea[id="note-${id}"]`).count(), 0, "the inaccessible addendum form is gone");
  assert.equal(await page.locator("#draftList textarea").inputValue(), draft, "the unsent text is kept in the rescue area");
  assert.match(await page.locator("#toast").textContent(), /草稿已保留/, "the visitor is told the draft was kept");
  assert.match(await page.locator("#draftList").textContent(), new RegExp(title), "the rescue area names the case");

  // Releasing the case restores the draft into the addendum form.
  assert.equal((await write({ "x-admin":"1" }, "update", `triage/${id}`, { hidden:false })).status, 200, "release the case");
  await page.waitForFunction(t => [...document.querySelectorAll("#list button.title")].some(b => b.textContent.trim() === t), title, { timeout:10000 });
  assert.equal(await page.locator(`textarea[id="note-${id}"]`).inputValue(), draft, "the draft returns when the case is public again");
  assert.equal(await page.locator("#draftBox").isHidden(), true, "the rescue area hides once the case is back");

  // Hiding again brings the rescue area back, and discarding really clears it.
  assert.equal((await write({ "x-admin":"1" }, "update", `triage/${id}`, { hidden:true })).status, 200, "hide again");
  await page.locator("#draftBox").waitFor({ state:"visible", timeout:10000 });
  await page.locator("#draftList [data-draft-drop]").click();
  await page.locator("#draftBox").waitFor({ state:"hidden" });
  assert.equal((await write({ "x-admin":"1" }, "update", `triage/${id}`, { hidden:false })).status, 200, "release again");
  await page.waitForFunction(t => [...document.querySelectorAll("#list button.title")].some(b => b.textContent.trim() === t), title, { timeout:10000 });
  assert.equal(await page.locator(`textarea[id="note-${id}"]`).inputValue(), "", "a discarded draft does not come back");
  assert.deepEqual(pageErrors, [], "no page errors");
  console.log("OK orphan draft is kept, announced, restored, and discardable");
} finally {
  await browser.close();
}
