// Run against a local Worker: BASE=http://127.0.0.1:8972 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/load-failure-status.mjs
// When GET /api/db fails, the admin console used to show an all-zero healthy dashboard and the map a normal empty city.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://127.0.0.1:8972").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const failDb = route => route.request().method() === "GET"
  ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "qa" }) })
  : route.continue();

const browser = await chromium.launch();
try {
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route("**/api/db", failDb);
    await page.goto(BASE + "/?admin#admin");
    const notice = page.locator("#admLoad");
    await notice.waitFor({ state: "visible" });
    assert.match(await notice.innerText(), /連線中斷，無法載入後台資料/, "admin console says that data did not load");
    assert.equal((await page.locator("#admKpi").innerText()).trim(), "", "no all-zero KPI dashboard");
    assert.equal((await page.locator("#admQueues").innerText()).trim(), "", "no healthy-looking empty queues");
    assert.equal(await page.locator("#admCat").innerText(), "", "no healthy-looking empty chart");
    await page.close();
    console.log("admin failure status OK");
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("**/api/db", failDb);
    await page.goto(BASE + "/");
    const note = page.locator("#dataNote");
    await note.waitFor({ state: "visible" });
    assert.match(await note.innerText(), /無法載入陳情資料/, "map home says that report data did not load");
    assert.equal(await page.locator("#dataNoteRetry").isVisible(), true, "the map failure has a retry");
    await page.locator("[data-view=issues]").click();
    await page.waitForSelector("#list .empty");
    assert.match(await page.locator("#list").innerText(), /連線中斷，請重新整理頁面/, "the list still shows its connection error");
    await page.unroute("**/api/db", failDb);
    await page.locator("[data-view=map]").click();
    await page.locator("#dataNoteRetry").click();
    await page.locator("[data-view=issues]").click();
    await page.waitForSelector("#list [data-vote]", { timeout: 15000 });
    assert.equal(await note.isHidden(), true, "the map note clears after a successful reload");
    await page.close();
    console.log("map failure status OK");
  }
  console.log("OK");
} finally {
  await browser.close();
}
