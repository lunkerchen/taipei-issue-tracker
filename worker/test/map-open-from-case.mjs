import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});

const visitor = await (await post("/api/visitor")).json();
const [visitorId] = visitor.id.split(".");
const key = "map-open-case";
const title = `在地圖上開啟測試 ${crypto.randomUUID().slice(0, 8)}`;
const lat = 25.033, lng = 121.5654;
const own = { title, body:`本機合成地圖入口測試 ${crypto.randomUUID()}`,
  createdAt:new Date().toISOString(), author:visitorId, dept:"1999 待分派", tags:[], photos:[], notes:[],
  lat, lng, district:"信義區", category:"" };
assert.equal((await post("/api/db", { "x-visitor":visitor.id },
  { op:"update", path:`reports/${visitorId}`, data:{ items:{ [key]:own } } })).status, 200,
  "create a private test case with a location");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
try {
  for (const viewport of [{ width:1280, height:900, keyboard:true }, { width:390, height:844, keyboard:false }]) {
    const context = await browser.newContext({ viewport, isMobile:!viewport.keyboard, hasTouch:!viewport.keyboard });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
    try {
      await page.goto(BASE, { waitUntil:"domcontentloaded" });
      await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);

      await page.locator('#nav [data-view="issues"]').click();
      const card = page.locator("#list button.title").filter({ hasText:title });
      await card.waitFor({ state:"visible", timeout:10000 });
      await card.click();
      const button = page.locator(`[data-openmap]`);
      await button.waitFor({ state:"visible", timeout:10000 });

      if (viewport.keyboard) {
        await button.focus();
        await page.keyboard.press("Enter");
      } else {
        await button.click();
      }

      await page.locator("#v-map").waitFor({ state:"visible" });
      const popup = page.locator(".leaflet-popup-content").filter({ hasText:title });
      await popup.waitFor({ state:"visible", timeout:20000 });
      assert.equal(new URL(page.url()).hash, "#map", "the map view becomes the current route");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "map", "focus moves to the map");
      assert.equal(await page.locator('input[data-layer="none"]').isChecked(), true,
        "the case category layer is turned on so its pin shows");
      assert.equal(await popup.locator("[data-go]").isVisible(), true, "the open pop-up has the detail link");
      const mapTop = await page.locator("#map").evaluate(el => el.getBoundingClientRect().top);
      assert.ok(mapTop >= 0 && mapTop < viewport.height * .6, `the map is in view on open, top=${mapTop}`);
      assert.deepEqual(errors, [], "no page errors");
      console.log(`${viewport.width} OK`);
    } finally {
      await context.close();
    }
  }
  console.log("OK case detail opens the map at the case point, opens its pop-up, and moves focus");
} finally {
  await browser.close();
}
