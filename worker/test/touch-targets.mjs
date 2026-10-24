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
const key = "touch-target-case";
const title = `觸控目標測試 ${crypto.randomUUID().slice(0, 8)}`;
const own = { title, body:`本機合成觸控目標測試 ${crypto.randomUUID()}`,
  createdAt:new Date().toISOString(), author:visitorId, dept:"1999 待分派", tags:[], photos:[], notes:[],
  lat:25.033, lng:121.5654, district:"大安區", category:"" };
assert.equal((await post("/api/db", { "x-visitor":visitor.id },
  { op:"update", path:`reports/${visitorId}`, data:{ items:{ [key]:own } } })).status, 200,
  "create a private test case on the city map");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
  try {
    await page.goto(BASE, { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
    await page.waitForSelector(".leaflet-control-zoom-in", { timeout:15000 });
    await page.waitForTimeout(2500);

    const measure = async (locator, name) => {
      await locator.waitFor({ state:"visible", timeout:10000 });
      const box = await locator.boundingBox();
      assert.ok(box, `${name} has a box`);
      assert.ok(box.width >= 43.5 && box.height >= 43.5, `${name} is at least 44x44, got ${Math.round(box.width)}x${Math.round(box.height)}`);
      return box;
    };

    await measure(page.locator(".leaflet-control-zoom-in"), "zoom in");
    await measure(page.locator(".leaflet-control-zoom-out"), "zoom out");
    await measure(page.locator("#layerAll"), "select all layers");

    await page.locator("#layerAll").click();
    await page.waitForTimeout(800);
    const popup = page.locator(".leaflet-popup");
    const marked = await page.evaluate(t => {
      for (const r of markers.values()) if (r.i.title === t) { r.m.getElement()?.setAttribute("data-test-marker", "1"); return true; }
      return false;
    }, title);
    assert.ok(marked, "the seeded case has a marker on the map");
    const marker = page.locator('[data-test-marker="1"]');
    await marker.waitFor({ state:"visible", timeout:10000 });
    await marker.evaluate(el => el.click());
    await popup.waitFor({ state:"visible", timeout:5000 });
    const close = await measure(page.locator(".leaflet-popup-close-button"), "pop-up close");
    await measure(page.locator(".leaflet-popup .btn"), "view details");
    await page.waitForTimeout(300);

    await page.locator(".leaflet-popup-close-button").click();
    await popup.waitFor({ state:"hidden", timeout:5000 });

    const path = page.locator(".leaflet-districts-pane path").first();
    await path.waitFor({ state:"visible", timeout:10000 });
    await path.evaluate(el => el.dispatchEvent(new MouseEvent("click", { bubbles:true })));
    await page.locator("#distBack").waitFor({ state:"visible", timeout:5000 });
    const back = await measure(page.locator("#distBack"), "back to city");

    await page.keyboard.press("c");
    await page.locator("#newBox").waitFor({ state:"visible", timeout:5000 });
    await measure(page.locator("#photoLbl"), "add photo");
    await page.locator("#photoIn").setInputFiles({ name:"photo.png", mimeType:"image/png",
      buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwJfHiCY0liH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBejLBS1qruaIAAAAASUVORK5CYII=", "base64") });
    await page.locator(".phprev button").waitFor({ state:"visible", timeout:10000 });
    await measure(page.locator(".phprev button"), "remove photo");

    assert.ok(close.x + close.width <= 390, "the close button is inside the screen");
    assert.deepEqual(errors, [], "no page errors");
    console.log("390 OK all measured touch targets are at least 44x44");
  } finally {
    await context.close();
  }
  console.log("OK photo, pop-up, map, and district controls have 44px touch targets");
} finally {
  await browser.close();
  await post("/api/db", { "x-visitor":visitor.id }, { op:"delete", path:`reports/${visitorId}` }).catch(() => {});
}
