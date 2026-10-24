// Run: BASE=http://127.0.0.1:8789 node worker/test/join-vote.mjs
// The district join form must not close, or drop its draft, when the +1 write fails.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://127.0.0.1:8789").replace(/\/$/, "");
const modulePath = process.env.PLAYWRIGHT_MODULE || "playwright";
const require = createRequire(import.meta.url);
const { chromium } = require(modulePath);

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${BASE}/#map`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof openDistrict === "function", null, { timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => openDistrict("中正區"));
  await page.locator("#hotList [data-join]").first().waitFor({ state: "visible", timeout: 15000 });

  await page.route("**/api/db", route => {
    const req = route.request(), body = req.postData() || "";
    if (req.method() === "POST" && body.includes('"votes/')) return route.abort("failed");
    return route.continue();
  });
  await page.locator("#hotList [data-join]").first().click();
  await page.locator("#newText").fill("我也有看到，這是我要保留的補充內容");
  await page.evaluate(() => document.getElementById("joinVote").click());
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("連不上伺服器"), null, { timeout: 8000 });
  const failed = await page.evaluate(() => ({
    boxHidden: document.getElementById("newBox").hidden,
    joinHidden: document.getElementById("joinBox").hidden,
    text: document.getElementById("newText").value,
  }));
  assert.equal(failed.boxHidden, false, "failed +1 keeps the join form open");
  assert.equal(failed.joinHidden, false, "failed +1 keeps join mode");
  assert.equal(failed.text, "我也有看到，這是我要保留的補充內容", "failed +1 keeps the draft");

  await page.unroute("**/api/db");
  await page.evaluate(() => document.getElementById("joinVote").click());
  await page.waitForFunction(() => document.getElementById("toast").textContent.startsWith("已幫"), null, { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById("newBox").hidden === true, null, { timeout: 3000 });
  assert.deepEqual(errors, [], "no page errors");
  console.log("OK join +1 keeps the draft on failure and closes on success");
} finally {
  await browser?.close();
}
