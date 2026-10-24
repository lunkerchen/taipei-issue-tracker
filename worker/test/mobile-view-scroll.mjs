// On phones a tab switch must show the map at the top, and the location picker must not open under the fixed bars.
// Run: BASE=http://127.0.0.1:9007 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/mobile-view-scroll.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
try {
  for (const viewport of [{ width:390, height:844 }, { width:320, height:568 }]) {
    const context = await browser.newContext({ viewport, isMobile:true, hasTouch:true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(BASE + "/#issues", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden, null, { timeout:15000 });
    await page.locator("#list button.title").first().waitFor({ state:"visible", timeout:15000 });

    // A long list leaves the page scrolled; the map tab must start at the map.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => scrollY) > 200, `${viewport.width}: the list is scrolled before the tab switch`);
    await page.locator('#nav [data-view="map"]').click();
    await page.waitForFunction(() => location.hash === "#map" && !document.querySelector("#v-map").hidden);
    await page.waitForTimeout(400);
    const mapBox = await page.evaluate(() => {
      const r = document.querySelector("#map").getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: innerHeight, scrollY: Math.round(scrollY) };
    });
    assert.ok(mapBox.top >= 0 && mapBox.top < mapBox.viewport * 0.6,
      `${viewport.width}: the map is near the top after a tab switch, got ${JSON.stringify(mapBox)}`);
    assert.ok(mapBox.bottom > 0, `${viewport.width}: the map is visible`);

    // The location picker opens below the fold on a phone; it must scroll above the fixed tab bar.
    await page.locator('#nav [data-view="issues"]').click();
    await page.locator("#list button.title").first().waitFor({ state:"visible", timeout:15000 });
    await page.locator("#navReport").click();
    await page.locator("#newBox").waitFor({ state:"visible" });
    await page.evaluate(() => {
      const b = document.getElementById("pinBtn");
      window.scrollTo(0, Math.max(0, b.getBoundingClientRect().top + scrollY - (innerHeight - 157)));
    });
    await page.waitForTimeout(80);
    const before = await page.evaluate(() => document.getElementById("pinBtn").getBoundingClientRect().top);
    assert.ok(before > 0 && before < viewport.height - 40, `${viewport.width}: the pin button is near the bottom, got ${before}`);
    await page.locator("#pinBtn").click();
    await page.locator("#pickMap").waitFor({ state:"visible" });
    await page.waitForTimeout(900);
    const pick = await page.evaluate(() => {
      const r = document.querySelector("#pickMap").getBoundingClientRect();
      const nav = document.querySelector("#nav").getBoundingClientRect();
      const ticker = document.querySelector(".ticker");
      const tr = ticker && ticker.getClientRects().length ? ticker.getBoundingClientRect() : null;
      const limit = Math.min(innerHeight, nav.top, tr && tr.height > 0 ? tr.top : innerHeight);
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), limit: Math.round(limit), viewport: innerHeight };
    });
    assert.ok(pick.top >= 0 && pick.bottom <= pick.limit + 1,
      `${viewport.width}: the pick map clears the fixed bars, got ${JSON.stringify(pick)}`);
    assert.deepEqual(errors, [], `${viewport.width}: no page errors`);
    await context.close();
    console.log(viewport.width + " OK");
  }
  console.log("OK mobile tab and pick map scroll");
} finally {
  await browser.close();
}
