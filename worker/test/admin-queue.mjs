import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";
const ADMIN = process.env.ADMIN_TOKEN || "1";
const prefix = `qa-queue-${crypto.randomUUID().slice(0, 8)}`;
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});
const dbPost = (headers, body) => post("/api/db", headers, body);

const visitorA = await (await post("/api/visitor")).json();
const visitorB = await (await post("/api/visitor")).json();
const [idA] = visitorA.id.split("."), [idB] = visitorB.id.split(".");
const old = new Date(Date.now() - 40 * 864e5).toISOString(), now = new Date().toISOString();
const item = (title, author, createdAt, extra = {}) => ({ title, body:`本機合成後台佇列測試 ${prefix}`, createdAt, author,
  dept:"1999 待分派", tags:[], photos:[], notes:[], lat:25.03, lng:121.56, district:"中正區", category:"", ...extra });
const unassigned = {};
for (let n = 0; n < 22; n++) unassigned[`qa-${n}`] = item(`${prefix} 待分派 ${n}`, idA, old);
const review = {
  "flag-a": item(`${prefix} 待審 A`, idB, now, { dept:"環境保護局", flagged:true }),
  "flag-b": item(`${prefix} 待審 B`, idB, now, { dept:"環境保護局", flagged:true }),
};
assert.equal((await dbPost({ "x-admin":ADMIN }, { op:"update", path:`reports/${idA}`, data:{ items:unassigned } })).status, 200,
  "create 22 unassigned cases");
assert.equal((await dbPost({ "x-admin":ADMIN }, { op:"update", path:`reports/${idB}`, data:{ items:review } })).status, 200,
  "create 2 flagged cases");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
try {
  const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE + "/?admin#admin", { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#admQueues .row-item").length > 0, null, { timeout:20000 });
  const queue = title => page.locator("#admQueues section").filter({ has: page.locator(".boxhead b", { hasText:title }) });
  const countRows = title => queue(title).locator(".row-item").count();
  const headerCount = async title => Number((await queue(title).locator(".cnt").innerText()).trim());
  const waitRows = (title, n) => page.waitForFunction(({ title, n }) => {
    const sec = [...document.querySelectorAll("#admQueues section")].find(s => s.querySelector(".boxhead b")?.textContent.trim() === title);
    return !!sec && sec.querySelectorAll(".row-item").length === n;
  }, { title, n }, { timeout:15000 });

  // Q12-02: every case in a queue is reachable, not only the first 20.
  for (const title of ["待分派", "逾期未結"]) {
    const total = await headerCount(title);
    assert.ok(total > 20, `${title} has more than 20 cases, got ${total}`);
    assert.equal(await countRows(title), 20, `${title} starts with 20 rows`);
    for (let n = 0; n < 8; n++) {
      const more = queue(title).locator("[data-more]");
      if (!(await more.count())) break;
      await more.click();
      await page.waitForTimeout(150);
    }
    assert.equal(await countRows(title), total, `${title} shows all ${total} cases after 顯示更多`);
    assert.equal(await queue(title).locator("[data-more]").count(), 0, `${title} has no hidden rows left`);
    assert.ok(await queue(title).locator(".row-item .title", { hasText:prefix }).count(), `${title} includes the test cases`);
    console.log(`${title} OK rows=${total}`);
  }

  // Q12-01: a quick second click after a row leaves must not change the next case.
  assert.equal(await countRows("待審核"), 2, "the review queue has the 2 flagged cases");
  const firstRelease = queue("待審核").locator('button[data-hide="false"]').first();
  await firstRelease.scrollIntoViewIfNeeded();
  const box = await firstRelease.boundingBox();
  assert.ok(box, "the first 放行 button has a box");
  const point = { x:box.x + box.width / 2, y:box.y + box.height / 2 };
  const started = Date.now();
  await page.mouse.click(point.x, point.y);
  await waitRows("待審核", 1);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 800, `the replacement row is ready inside the guard window, got ${elapsed}ms`);
  const nextRelease = queue("待審核").locator('button[data-hide="false"]').first();
  const nextBox = await nextRelease.boundingBox();
  assert.ok(nextBox, "the replacement row has a 放行 button");
  assert.ok(Math.abs(nextBox.y - box.y) < 3, `the replacement button is at the same height, got ${nextBox.y} vs ${box.y}`);
  await page.mouse.click(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
  await page.waitForTimeout(900);
  assert.equal(await countRows("待審核"), 1, "the quick second click does not release the next case");
  const remainTitle = (await queue("待審核").locator(".row-item .title").first().innerText()).trim();
  assert.match(remainTitle, /待審 B/, "the second test case is still in review");
  // The guard is not a permanent block: a deliberate click after it works.
  await queue("待審核").locator('button[data-hide="false"]').first().click();
  await waitRows("待審核", 0);
  assert.deepEqual(errors, [], "no page errors");
  console.log(`待審核 OK first=${elapsed}ms rows=1 then rows=0 after a deliberate click`);
  await context.close();
  console.log("OK admin queues show every case and ignore a quick click on the replacement row");
} finally {
  await browser.close();
  for (const path of [`reports/${idA}`, `reports/${idB}`, `triage/${idB}:flag-a`, `triage/${idB}:flag-b`])
    await dbPost({ "x-admin":ADMIN }, { op:"delete", path }).catch(() => {});
}
