// Run against a local Worker: BASE=http://127.0.0.1:9005 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/route-history.mjs
// A case opened from the list must add a history entry, so Back returns to the list with its search.
// A successful case click must also clear an old "case not found" notice.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const launchOptions = { headless: true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));

const rowsReady = () => page.waitForFunction(() => document.querySelectorAll("#list [data-open]").length > 0, null, { timeout: 15000 });
const hashIs = hash => page.waitForFunction(want => location.hash === want, hash, { timeout: 15000 });

try {
  // Arrive from the map, as in the reported flow: map -> issues -> case.
  await page.goto(`${BASE}/#map`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor"));
  await page.locator('#nav [data-view="issues"]').click();
  await hashIs("#issues");
  await rowsReady();

  await page.locator("#q").fill("路");
  await page.waitForFunction(() => document.querySelector("#q").value === "路" && document.querySelectorAll("#list [data-open]").length > 0, null, { timeout: 15000 });
  const id = await page.evaluate(() => document.querySelector("#list [data-open]").dataset.open);
  await page.evaluate(() => document.querySelector("#list [data-open]").click());
  await hashIs(`#issue/${encodeURIComponent(id)}`);
  await page.waitForSelector("#list .detail", { state: "visible", timeout: 15000 });

  await page.goBack();
  await hashIs("#issues");
  assert.equal(await page.locator("#q").inputValue(), "路", "Back keeps the search filter");
  assert.equal(await page.locator("#list .detail").count(), 0, "Back closes the case detail");
  assert.equal(await page.evaluate(id => document.querySelector(`[data-open="${CSS.escape(id)}"]`)?.getAttribute("aria-expanded"), id), "false",
    "Back collapses the case");

  // A stale "case not found" notice must go away after a valid case opens.
  await page.goto(`${BASE}/#issue/nope-123`, { waitUntil: "domcontentloaded" });
  await page.locator("#shareNotice").waitFor({ state: "visible", timeout: 15000 });
  assert.match(await page.locator("#shareNotice").textContent(), /找不到這個公開案件/);
  await rowsReady();
  await page.evaluate(() => document.querySelector("#list [data-open]").click());
  await page.waitForFunction(() => location.hash.startsWith("#issue/"), null, { timeout: 15000 });
  await page.waitForSelector("#list .detail", { state: "visible", timeout: 15000 });
  const notice = await page.locator("#shareNotice").evaluate(el => ({ hidden: el.hidden, text: el.textContent.trim() }));
  assert.ok(notice.hidden && notice.text === "", `the old notice is cleared, got ${JSON.stringify(notice)}`);

  assert.deepEqual(errors, [], "no page errors");
  console.log("route-history: ok");
} finally {
  await browser.close();
}
