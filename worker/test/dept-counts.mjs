// The number in each department option must equal the rows that option shows under the current tab and search.
// Run against a local Worker: BASE=http://localhost:8788 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/dept-counts.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const admin = { "content-type": "application/json", "x-admin": "1" };
const runId = Date.now().toString(36);
const post = async (path, body, headers = { "content-type": "application/json" }) => {
  const r = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const token = (await post("/api/visitor", {}, {})).body.id, owner = token.split(".")[0];
const contact = { name: "局處計數", phone: "0912000000", email: "dept@example.com", realName: false };
const ids = [];
const create = async (suffix, status) => {
  const key = `dept-${suffix}-${runId}`, title = `局處計數 ${suffix} ${runId}`;
  const saved = await post("/api/db", { op: "create-report", path: `reports/${owner}`,
    data: { key, item: { title, body: `${title} 的內容`, createdAt: new Date().toISOString(),
      author: owner, dept: "1999 待分派", tags: [], photos: [], notes: [] }, contact } },
    { "content-type": "application/json", "x-visitor": token });
  assert.equal(saved.status, 200, `created ${suffix}: ${saved.body.error || "ok"}`);
  const id = `${owner}:${key}`;
  ids.push(id);
  const tri = await post("/api/db", { op: "set", path: `triage/${id}`,
    data: { status, dept: "警察局", events: status === "fixed" ? [{ t: new Date().toISOString(), type: "status", to: "fixed", by: "qa" }] : [] } }, admin);
  assert.equal(tri.status, 200, `set ${suffix} to ${status} in 警察局`);
  return title;
};
const openTitle = await create("open", "open"), fixedTitle = await create("fixed", "fixed");

const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const labels = () => page.$$eval("#deptFilter option", els => els.filter(e => e.value)
  .map(e => ({ dept: e.value, text: e.textContent.trim() })));
const rows = () => page.locator("#list > .issue").count();
const ready = () => page.waitForFunction(() => typeof issues !== "undefined" && issues.length &&
  document.querySelectorAll("#deptFilter option").length > 1 && !document.querySelector("#list .empty"), null, { timeout: 20000 });

async function verifyCounts(where) {
  const options = await labels();
  assert.ok(options.length > 1, `${where}: department options are present`);
  for (const option of options) {
    const m = option.text.match(/（(\d+)）$/);
    assert.ok(m, `${where}: ${option.text} shows a count`);
    const n = Number(m[1]);
    await page.selectOption("#deptFilter", option.dept);
    assert.equal(await rows(), n, `${where}: ${option.text} shows ${n} rows`);
  }
  await page.selectOption("#deptFilter", "");
  assert.deepEqual((await labels()).map(x => x.text), options.map(x => x.text), `${where}: a selected department does not change the counts`);
}

try {
  await page.addInitScript(t => localStorage.setItem("tit-visitor", t), token);
  await page.goto(BASE + "/#issues", { waitUntil: "domcontentloaded" });
  await ready();
  await verifyCounts("open");

  await page.locator("#tabClosed").click();
  await page.waitForFunction(() => document.querySelector("#tabClosed").getAttribute("aria-pressed") === "true");
  await ready();
  await verifyCounts("fixed");

  await page.locator("#tabOpen").click();
  await page.waitForFunction(() => document.querySelector("#tabOpen").getAttribute("aria-pressed") === "true");
  await ready();
  const beforeSearch = (await labels()).find(x => x.dept === "警察局");
  assert.ok(beforeSearch, "警察局 is listed on the open tab");

  await page.fill("#q", runId);
  await page.waitForFunction(runId => document.querySelector("#q").value === runId &&
    [...document.querySelectorAll("#deptFilter option")].some(o => o.value === "警察局"), runId);
  const searched = await labels();
  assert.equal(searched.find(x => x.dept === "警察局")?.text, "警察局（1）", "the search narrows the 警察局 count");
  assert.ok(searched.every(x => /（1）$/.test(x.text)), "every remaining count matches the one case");
  await page.selectOption("#deptFilter", "警察局");
  assert.equal(await rows(), 1, "the search count opens one row");
  assert.ok((await page.locator("#list > .issue").first().innerText()).includes(openTitle), "the row is the matching open case");

  await page.fill("#q", "");
  await page.waitForFunction(() => !document.querySelector("#q").value);
  assert.equal((await labels()).find(x => x.dept === "警察局")?.text, beforeSearch.text, "clearing the search restores the count");

  await page.locator("#tabClosed").click();
  await page.waitForFunction(() => document.querySelector("#tabClosed").getAttribute("aria-pressed") === "true");
  await page.fill("#q", runId);
  await page.waitForFunction(runId => document.querySelector("#q").value === runId &&
    [...document.querySelectorAll("#deptFilter option")].some(o => o.value === "警察局"), runId);
  assert.equal((await labels()).find(x => x.dept === "警察局")?.text, "警察局（1）", "the fixed tab counts only the fixed match");
  await page.selectOption("#deptFilter", "警察局");
  assert.equal(await rows(), 1, "the fixed count opens one row");
  assert.ok((await page.locator("#list > .issue").first().innerText()).includes(fixedTitle), "the row is the matching fixed case");

  const noMatch = `no-match-${runId}`;
  await page.fill("#q", noMatch);
  await page.waitForFunction(term => document.querySelector("#q").value === term &&
    document.querySelector("#deptFilter").value === "警察局", noMatch);
  assert.equal((await labels()).find(x => x.dept === "警察局")?.text, "警察局（0）", "a selected department stays listed with zero rows");
  assert.equal(await rows(), 0, "the zero count shows no rows and keeps the filter selected");

  assert.deepEqual(errors, [], "no page errors");
  console.log("OK department counts match the rows under both tabs and a search");
} finally {
  await context.close();
  await browser.close();
  for (const id of ids) await post("/api/db", { op: "delete", path: `triage/${id}` }, admin).catch(() => {});
  await post("/api/db", { op: "delete", path: `reports/${owner}` }, admin).catch(() => {});
}
