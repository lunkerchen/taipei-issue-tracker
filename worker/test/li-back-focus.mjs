// Browser regression: Returning from Li detail preserves keyboard focus on that Li button.
// Run against `wrangler dev`:
//   BASE=http://localhost:8903 node worker/test/li-back-focus.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(playwrightPath);

const BASE = process.env.BASE || "http://localhost:8903";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile 390x844", width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
try {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));

    await page.goto(BASE + "/#map");
    await page.waitForSelector(".leaflet-districts-pane path");

    // Open 大安區
    await page.evaluate(() => openDistrict("大安區"));
    await page.waitForFunction(() => document.querySelectorAll("#liList button[data-li]").length > 0);

    // Pick first Li from list
    const targetLi = await page.evaluate(() => {
      const btn = document.querySelector("#liList button[data-li]");
      btn.focus();
      return btn.getAttribute("data-li");
    });
    assert.ok(targetLi, "Found a Li button in the list");

    // Press Enter to activate the Li button via keyboard
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.getElementById("liDetail").hidden);

    // Focus #liBack and press Enter via keyboard
    await page.evaluate(() => document.getElementById("liBack").focus());
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.getElementById("liPanel").hidden && document.getElementById("liDetail").hidden);

    const activeInfo = await page.evaluate(() => ({
      tagName: document.activeElement ? document.activeElement.tagName : "NONE",
      dataLi: document.activeElement?.getAttribute("data-li") || null,
      id: document.activeElement?.id || null,
    }));

    assert.equal(
      activeInfo.dataLi,
      targetLi,
      `[${vp.name}] Expected focus to return to Li button with data-li="${targetLi}", but active element is <${activeInfo.tagName} id="${activeInfo.id}" data-li="${activeInfo.dataLi}">`
    );

    assert.deepEqual(errors, [], `[${vp.name}] no page errors`);
    console.log(`PASS [${vp.name}] focus returned to Li button: ${targetLi}`);
    await page.close();
  }
  console.log("OK li-back-focus passed all viewports");
} finally {
  await browser.close();
}
