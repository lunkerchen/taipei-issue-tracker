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
const key = "popup-edge-case";
const title = `北側彈窗測試 ${crypto.randomUUID().slice(0, 8)}`;
const lat = 25.165 + Math.random() * 0.02, lng = 121.552;
assert.ok(lat < 25.19);
const own = { title, body:`本機合成彈窗邊界測試 ${crypto.randomUUID()}`,
  createdAt:new Date().toISOString(), author:visitorId, dept:"1999 待分派", tags:[],
  photos:[`${visitorId}/edge-1.jpg`, `${visitorId}/edge-2.jpg`], notes:[],
  lat:+lat.toFixed(5), lng, district:"士林區", category:"" };
assert.equal((await post("/api/db", { "x-visitor":visitor.id },
  { op:"update", path:`reports/${visitorId}`, data:{ items:{ [key]:own } } })).status, 200,
  "create a private test case with photos near the north edge");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
try {
  for (const viewport of [{ width:390, height:844 }, { width:320, height:568 }]) {
    const context = await browser.newContext({ viewport, isMobile:true, hasTouch:true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
    try {
      await page.goto(BASE, { waitUntil:"domcontentloaded" });
      await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
      await page.waitForTimeout(3500);
      await page.locator("#layerAll").click();
      await page.waitForTimeout(1200);

      // The seeded case is north of every demo case, so the top visible marker is a tall, photo pop-up.
      const icons = await page.locator(".leaflet-marker-icon").evaluateAll(es => es
        .map(el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height }; })
        .filter(r => r.y > 0 && r.y < innerHeight).sort((a, b) => a.y - b.y));
      assert.ok(icons.length, "the map shows report markers");
      const top = icons[0];
      await page.mouse.click(top.x + top.w / 2, top.y + top.h / 2);
      const popup = page.locator(".leaflet-popup");
      await popup.waitFor({ state:"visible", timeout:10000 });
      await page.locator(".leaflet-popup .head b").filter({ hasText:/\S/ }).waitFor();
      await page.waitForTimeout(500);

      const box = await popup.boundingBox();
      const close = await page.locator(".leaflet-popup-close-button").boundingBox();
      assert.ok(box.y >= 0, `the pop-up top is visible, y=${box.y}`);
      assert.ok(box.y + box.height <= viewport.height, `the pop-up bottom is visible, bottom=${box.y + box.height}`);
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, `the pop-up is inside the viewport, x=${box.x} w=${box.width}`);
      assert.ok(close.y >= 0 && close.y + close.height <= viewport.height, `the close button is visible, y=${close.y}`);
      assert.ok(await popup.locator(".photos img").first().isVisible(), "the north-edge case has a photo pop-up");
      const title = await popup.locator(".head b").textContent();
      assert.ok(title.trim(), "the pop-up has a title");
      assert.deepEqual(errors, [], "no page errors");
      console.log(`${viewport.width} OK popup top=${Math.round(box.y)} bottom=${Math.round(box.y + box.height)} map=${viewport.width}x${viewport.height}`);
    } finally {
      await context.close();
    }
  }
  console.log("OK north-edge popups stay inside the phone viewport and close button");
} finally {
  await browser.close();
  await post("/api/db", { "x-visitor":visitor.id }, { op:"delete", path:`reports/${visitorId}` }).catch(() => {});
}
