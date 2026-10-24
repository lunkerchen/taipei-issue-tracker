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
const key = "map-keyboard-case";
const title = `鍵盤地圖測試 ${crypto.randomUUID().slice(0, 8)}`;
const own = { title, body:`本機合成鍵盤焦點測試 ${crypto.randomUUID()}`,
  createdAt:new Date().toISOString(), author:visitorId, dept:"1999 待分派", tags:[], photos:[], notes:[],
  lat:25.033, lng:121.5654, district:"大安區", category:"" };
assert.equal((await post("/api/db", { "x-visitor":visitor.id },
  { op:"update", path:`reports/${visitorId}`, data:{ items:{ [key]:own } } })).status, 200,
  "create a private test case on the city map");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
const active = page => page.evaluate(() => {
  const el = document.activeElement;
  return { tag:el?.tagName, aria:el?.getAttribute?.("aria-label"), open:el?.dataset?.open || "" };
});
try {
  const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
  try {
    await page.goto(BASE, { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
    await page.waitForSelector(".leaflet-control-zoom-in", { timeout:15000 });
    const zoom = await page.locator(".leaflet-control-zoom-in").evaluate(el => ({ title:el.title, aria:el.getAttribute("aria-label") }));
    assert.deepEqual(zoom, { title:"放大地圖", aria:"放大地圖" }, "the zoom-in control has a Chinese name");
    const zoomOut = await page.locator(".leaflet-control-zoom-out").evaluate(el => ({ title:el.title, aria:el.getAttribute("aria-label") }));
    assert.deepEqual(zoomOut, { title:"縮小地圖", aria:"縮小地圖" }, "the zoom-out control has a Chinese name");

    await page.waitForSelector('.leaflet-districts-pane path[tabindex="0"]', { timeout:15000 });
    await page.waitForTimeout(2500);

    await page.locator("#layerAll").click();
    await page.waitForTimeout(800);
    const marker = page.locator(`.leaflet-marker-icon[aria-label*="${title}"]`);
    await marker.waitFor({ state:"visible", timeout:10000 });
    assert.equal(await marker.getAttribute("tabindex"), "0", "the marker is in the tab order");
    assert.equal(await marker.getAttribute("role"), "button", "the marker has a button role");
    assert.match(await marker.getAttribute("aria-label"), new RegExp(`^${title}，.+，\\+1 \\d+$`), "the marker name includes the title, status and votes");

    await marker.focus();
    await page.keyboard.press("Enter");
    const popup = page.locator(".leaflet-popup");
    await popup.waitFor({ state:"visible", timeout:5000 });
    const close = page.locator(".leaflet-popup-close-button");
    assert.equal(await close.getAttribute("aria-label"), "關閉彈窗", "the popup close button has a Chinese name");
    await close.focus();
    await page.keyboard.press("Enter");
    await popup.waitFor({ state:"hidden", timeout:5000 });
    const backOnMarker = await active(page);
    assert.equal(backOnMarker.aria, await marker.getAttribute("aria-label"), "closing the pop-up returns focus to its marker");

    await marker.focus();
    await page.keyboard.press("Enter");
    await popup.waitFor({ state:"visible", timeout:5000 });
    await page.locator(".leaflet-popup [data-go]").click();
    await page.waitForFunction(() => location.hash.startsWith("#issue/"));
    const detail = await active(page);
    assert.ok(detail.open, "opening a case from the pop-up focuses its title");
    assert.equal(detail.tag, "BUTTON", "the focused element is the case title button");

    await page.locator('#nav [data-view="map"]').click();
    await page.waitForFunction(() => location.hash === "#map");
    const path = page.locator('.leaflet-districts-pane path[tabindex="0"]').first();
    await path.waitFor({ state:"visible", timeout:10000 });
    const district = await path.getAttribute("aria-label");
    assert.match(district, /，開啟里列表$/);
    await path.focus();
    await page.keyboard.press("Enter");
    await page.locator("#distBack").waitFor({ state:"visible", timeout:5000 });
    await page.locator("#distBack").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#distBack").hidden);
    const returned = await active(page);
    assert.equal(returned.tag, "path", "returning to the city focuses the district again");
    assert.equal(returned.aria, district, "the focused district is the one that was open");
    assert.ok(await page.evaluate(() => document.querySelector("#map").getBoundingClientRect().top < innerHeight), "the map is back in view");
    assert.deepEqual(errors, [], "no page errors");
    console.log("1280 OK marker and district keyboard paths keep focus");
  } finally {
    await context.close();
  }

  const phone = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const p = await phone.newPage();
  const phoneErrors = [];
  p.on("pageerror", e => phoneErrors.push(e.message));
  await p.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
  try {
    await p.goto(BASE, { waitUntil:"domcontentloaded" });
    await p.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
    await p.waitForTimeout(3500);
    await p.locator("#layerAll").click();
    await p.waitForTimeout(800);
    const marker = p.locator(`.leaflet-marker-icon[aria-label*="${title}"]`);
    await marker.waitFor({ state:"visible", timeout:10000 });
    await marker.evaluate(el => el.click());
    await p.locator(".leaflet-popup [data-go]").waitFor({ state:"visible", timeout:5000 });
    await p.locator(".leaflet-popup [data-go]").click();
    await p.waitForFunction(() => location.hash.startsWith("#issue/"));
    const detail = await active(p);
    assert.ok(detail.open, "on a phone the case title also receives focus");
    assert.deepEqual(phoneErrors, [], "no page errors on the phone");
    console.log("390 OK opening a case from the map focuses its title");
  } finally {
    await phone.close();
  }
  console.log("OK map keyboard paths, Chinese control names, and focus returns");
} finally {
  await browser.close();
  await post("/api/db", { "x-visitor":visitor.id }, { op:"delete", path:`reports/${visitorId}` }).catch(() => {});
}
