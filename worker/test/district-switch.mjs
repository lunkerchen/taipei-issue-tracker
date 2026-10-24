// Browser regression: clicking a district while a 里 page is open must close that page and show only the new 里 list.
// Run against `wrangler dev` (default http://localhost:8787): node worker/test/district-switch.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8787";
// District paths are drawn in the order of the features in the boundary file.
const order = JSON.parse(readFileSync(new URL("../../data/districts.geojson", import.meta.url), "utf8")).features.map(f => f.properties.district);
const browser = await chromium.launch({ headless:true });

for (const viewport of [{ width:1280, height:900 }, { width:390, height:844 }]) {
  const page = await browser.newPage({ viewport });
  await page.goto(base + "/#map");
  await page.waitForSelector(".leaflet-districts-pane path");
  // A DOM click reaches Leaflet's handler even when the path is off screen or dimmed.
  const clickDistrict = d => page.locator(".leaflet-districts-pane path").nth(order.indexOf(d)).dispatchEvent("click");
  const state = () => page.evaluate(() => ({
    title:document.getElementById("liTitle").textContent, list:!document.getElementById("liPanel").hidden,
    detail:!document.getElementById("liDetail").hidden, inli:document.getElementById("v-map").classList.contains("inli")
  }));

  for (const second of ["士林區", "內湖區"]) { // another district, then the same one again
    await clickDistrict("內湖區");
    await page.locator("#liList button").first().click();
    await page.waitForFunction(() => !document.getElementById("liDetail").hidden);
    await clickDistrict(second);
    await page.waitForFunction(d => document.getElementById("liTitle").textContent === d, second);
    assert.deepEqual(await state(), { title:second, list:true, detail:false, inli:false }, `${viewport.width}px: 內湖區 里 page → ${second}`);
    await page.locator("#distBack").click();
  }
  await page.close();
}
await browser.close();
console.log("OK district switch closes the open 里 page");
