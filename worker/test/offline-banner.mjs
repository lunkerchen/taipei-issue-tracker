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
  await page.goto(`${BASE}/#issues`, { waitUntil: "domcontentloaded" });
  await page.locator("#list [data-open]").first().waitFor({ state: "visible", timeout: 15000 });

  await page.evaluate(() => dispatchEvent(new Event("offline")));
  await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some(el => el.textContent.includes("連線中斷")), null, { timeout: 6000 });

  await page.evaluate(() => dispatchEvent(new Event("online")));
  await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some(el => el.textContent.includes("連線中斷") && !el.hidden), null, { timeout: 3000 });

  assert.deepEqual(errors, [], "no page errors");
  console.log("OK online event clears the connection banner");
} finally {
  await browser?.close();
}
