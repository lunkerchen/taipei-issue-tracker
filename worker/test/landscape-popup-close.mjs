// A landscape phone has a short map and a wide viewport. With 200% text the pop-up is taller than the map,
// so the phone cap must apply by map height too; otherwise the close button is clipped above the map.
// Run against a local Worker: BASE=http://localhost:8787 node worker/test/landscape-popup-close.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8787";
const VIEWPORT = { width: 844, height: 390 };
const post = (path, headers, body) => fetch(BASE + path, {
  method: "POST", headers: { "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000)
});

const visitor = await (await post("/api/visitor")).json();
const [visitorId] = visitor.id.split(".");
const key = "landscape-popup-case";
const title = `橫向彈窗測試 ${crypto.randomUUID().slice(0, 8)}`;
const lat = 25.165 + Math.random() * 0.02;
const own = { title, body: `本機合成橫向彈窗測試 ${crypto.randomUUID()}`,
  createdAt: new Date().toISOString(), author: visitorId, dept: "1999 待分派", tags: [],
  photos: [`${visitorId}/landscape-1.jpg`, `${visitorId}/landscape-2.jpg`], notes: [],
  lat: +lat.toFixed(5), lng: 121.552, district: "士林區", category: "" };
assert.equal((await post("/api/db", { "x-visitor": visitor.id },
  { op: "update", path: `reports/${visitorId}`, data: { items: { [key]: own } } })).status, 200,
  "create a photo case near the north edge");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(token => {
    localStorage.setItem("tit-visitor", token);
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "html{-webkit-text-size-adjust:200%;text-size-adjust:200%}";
      document.head.append(style);
    });
  }, visitor.id);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await page.waitForTimeout(3500);
  await page.locator("#layerAll").click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector("#map").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);

  const icons = await page.locator(".leaflet-marker-icon").evaluateAll(es => es
    .map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })
    .filter(r => r.y > 0 && r.y < innerHeight).sort((a, b) => a.y - b.y));
  assert.ok(icons.length, "the map shows report markers");
  const top = icons[0];
  await page.mouse.click(top.x + top.w / 2, top.y + top.h / 2);
  const popup = page.locator(".leaflet-popup");
  await popup.waitFor({ state: "visible", timeout: 10000 });
  await popup.locator(".photos img").first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);

  const map = await page.locator(".mapbox").first().boundingBox();
  const box = await popup.boundingBox();
  const close = await page.locator(".leaflet-popup-close-button").boundingBox();
  assert.ok(close, "the pop-up has a close button");
  assert.ok(close.y >= map.y - 1, `the close button is not above the map, close=${close.y} map=${map.y}`);
  assert.ok(close.y + close.height <= map.y + map.height + 1,
    `the close button is inside the map, close=${close.y + close.height} mapBottom=${map.y + map.height}`);
  assert.ok(box.height <= map.height + 1, `the pop-up fits the short map, popup=${box.height} map=${map.height}`);
  const hitClose = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".leaflet-popup-close-button"),
    [close.x + close.width / 2, close.y + close.height / 2]);
  assert.equal(hitClose, true, "a tap on the close button reaches the close button, not the page behind the map");

  await page.locator(".leaflet-popup-close-button").click();
  await popup.waitFor({ state: "hidden", timeout: 5000 });
  assert.deepEqual(errors, [], "no page errors");
  console.log(`844x390 @200% OK popup=${Math.round(box.height)} map=${Math.round(map.height)} close inside`);
} finally {
  await browser.close();
  await post("/api/db", { "x-visitor": visitor.id }, { op: "delete", path: `reports/${visitorId}` }).catch(() => {});
}
