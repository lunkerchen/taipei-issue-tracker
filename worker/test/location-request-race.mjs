import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8808";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
await context.addInitScript(() => {
  window.__geoRequests = [];
  Object.defineProperty(navigator, "geolocation", { configurable:true, value:{
    getCurrentPosition(success, error, options) { window.__geoRequests.push({ success, error, options }); },
    watchPosition() { return 1; }, clearWatch() {}
  } });
});

const page = await context.newPage();
const pageErrors = [];
let writes = 0;
page.on("pageerror", error => pageErrors.push(error.message));
await page.route("**/api/db", async route => {
  if (route.request().method() === "POST") {
    writes++;
    return route.fulfill({ status:200, contentType:"application/json", body:"{}" });
  }
  return route.continue();
});
const visitorId = "a1b2c3d4e5f60718";
const visitorToken = `${visitorId}.${"b".repeat(64)}`;
await page.route("**/api/visitor", route => route.fulfill({
  status:200, contentType:"application/json", body:JSON.stringify({ id:visitorToken })
}));

async function gpsRequest() {
  const request = await page.evaluate(() => window.__geoRequests.length);
  await page.locator("#gpsBtn").click();
  await page.waitForFunction(n => window.__geoRequests.length === n + 1, request);
  return request;
}

async function resolveGPS(request, coords) {
  await page.evaluate(({ request, coords }) => window.__geoRequests[request].success({
    coords:{ latitude:coords.lat, longitude:coords.lng, accuracy:coords.accuracy ?? 35,
      altitude:null, altitudeAccuracy:null, heading:null, speed:null }, timestamp:Date.now()
  }), { request, coords });
}

async function rejectGPS(request, code = 1) {
  await page.evaluate(({ request, code }) => window.__geoRequests[request].error({ code }), { request, code });
}

async function openPickerMap() {
  if (await page.locator("#pickMap").isHidden()) await page.locator("#pinBtn").click();
  await page.waitForFunction(() => document.querySelector("#pickMap").classList.contains("leaflet-container"));
}

async function pickAt(lat, lng) {
  await page.evaluate(({ lat, lng }) => pickLM.fire("click", { latlng:L.latLng(lat, lng) }), { lat, lng });
  await page.waitForFunction(({ lat, lng }) => picked?.loc === "pin" && picked.lat === +lat.toFixed(5) && picked.lng === +lng.toFixed(5), { lat, lng });
}

async function currentLocation() {
  return page.evaluate(() => ({ picked:picked ? { ...picked } : null, status:document.querySelector("#locStatus").textContent,
    clearHidden:document.querySelector("#clrLoc").hidden, mapHidden:document.querySelector("#pickMap").hidden }));
}

try {
  await page.goto(base, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector("#navReport").hidden);
  await page.locator('#nav button[data-view="map"]').waitFor();
  await page.locator('#nav button[data-view="map"]').click();
  await page.waitForFunction(() => !document.querySelector("#v-map").hidden);
  await page.locator("#reportBtn").click();
  await page.waitForFunction(() => !document.querySelector("#newBox").hidden);

  const manualCoords = { lat:25.04632, lng:121.51875 };
  const manualRequest = await gpsRequest();
  await openPickerMap();
  await pickAt(manualCoords.lat, manualCoords.lng);
  const manualBeforeLateGPS = await currentLocation();
  await resolveGPS(manualRequest, { lat:25.0475, lng:121.5311 });
  await page.waitForTimeout(50);
  const manualAfterLateGPS = await currentLocation();
  assert.deepEqual(manualAfterLateGPS, manualBeforeLateGPS, "late GPS success cannot replace a manual pin or its status");

  await page.locator("#pinBtn").click();
  await page.waitForFunction(() => document.querySelector("#pickMap").hidden);
  await page.evaluate(() => {
    window.__loadLeafletOriginal = loadLeaflet;
    loadLeaflet = () => new Promise(resolve => { window.__releaseLeaflet = resolve; });
  });
  const coarseRequest = await gpsRequest();
  await resolveGPS(coarseRequest, { lat:25.0475, lng:121.5311, accuracy:350 });
  await page.waitForFunction(() => window.__releaseLeaflet && !document.querySelector("#pickMap").hidden);
  await page.locator("#clrLoc").click({ force:true });
  const clearDuringMapLoad = await currentLocation();
  await page.evaluate(() => window.__releaseLeaflet());
  await page.waitForTimeout(50);
  assert.deepEqual(await currentLocation(), clearDuringMapLoad, "a coarse GPS map load cannot restore a prompt after the location is cleared");
  await page.evaluate(() => { loadLeaflet = window.__loadLeafletOriginal; delete window.__loadLeafletOriginal; delete window.__releaseLeaflet; });

  await pickAt(manualCoords.lat, manualCoords.lng);
  const clearRequest = await gpsRequest();
  await page.locator("#clrLoc").click();
  const clearBeforeLateGPS = await currentLocation();
  assert.equal(clearBeforeLateGPS.picked, null);
  await resolveGPS(clearRequest, { lat:25.0475, lng:121.5311 });
  await page.waitForTimeout(50);
  assert.deepEqual(await currentLocation(), clearBeforeLateGPS, "late GPS success cannot restore a cleared pin or status");

  const olderRequest = await gpsRequest();
  const newerRequest = await gpsRequest();
  await resolveGPS(newerRequest, { lat:25.0375, lng:121.5637 });
  const newerLocation = await currentLocation();
  await resolveGPS(olderRequest, { lat:25.045, lng:121.531 });
  await page.waitForTimeout(50);
  assert.deepEqual(await currentLocation(), newerLocation, "an older GPS request cannot replace a newer request result");

  const olderErrorRequest = await gpsRequest();
  const currentRequest = await gpsRequest();
  await rejectGPS(olderErrorRequest);
  assert.equal((await currentLocation()).status, "定位中…", "an older GPS error cannot replace the current request status");
  await resolveGPS(currentRequest, { lat:25.0375, lng:121.5637 });
  const currentGPSLocation = await currentLocation();
  assert.deepEqual(currentGPSLocation.picked, { lat:25.0375, lng:121.5637, loc:"gps" }, "the current GPS success still sets the selected location");
  assert.equal(currentGPSLocation.status, "已使用你的位置", "the current GPS success still sets its status");

  const cancelledRequest = await gpsRequest();
  await page.locator("#cancelBtn").click({ force:true });
  await page.waitForFunction(() => document.querySelector("#newBox").hidden);
  await page.locator("#reportBtn").click();
  await page.waitForFunction(() => !document.querySelector("#newBox").hidden);
  const reopenedBeforeLateGPS = await currentLocation();
  await resolveGPS(cancelledRequest, { lat:25.0475, lng:121.5311 });
  await page.waitForTimeout(50);
  assert.deepEqual(await currentLocation(), reopenedBeforeLateGPS, "a callback from a cancelled form cannot change a reopened form");

  let releaseReverse, markReverseStarted;
  const reverseGate = new Promise(resolve => { releaseReverse = resolve; });
  const reverseStarted = new Promise(resolve => { markReverseStarted = resolve; });
  let markReverseFinished;
  const reverseFinished = new Promise(resolve => { markReverseFinished = resolve; });
  await page.route("**/api/geocode*", async route => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("lat")) return route.continue();
    markReverseStarted();
    await reverseGate;
    await route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ lat:25.04632, lng:121.51875, address:"過期反查地址", district:"大安區" }) });
    markReverseFinished();
  });
  await page.evaluate(({ lat, lng }) => {
    askReport({ lat, lng });
    const marker = askM;
    marker.confirmed = true;
    mainLM.closePopup();
    reportAt(marker.getLatLng(), "長按", marker.geo, marker);
  }, manualCoords);
  await Promise.race([reverseStarted, new Promise((_, reject) => setTimeout(() => reject(new Error("reverse-geocode request did not reach the browser route")), 5000))]);
  await page.waitForFunction(() => !document.querySelector("#newBox").hidden);
  await openPickerMap();
  await pickAt(manualCoords.lat, manualCoords.lng);
  const manualBeforeLateReverse = await currentLocation();
  releaseReverse();
  await Promise.race([reverseFinished, new Promise((_, reject) => setTimeout(() => reject(new Error("reverse-geocode response did not finish")), 5000))]);
  await page.waitForTimeout(50);
  assert.deepEqual(await currentLocation(), manualBeforeLateReverse, "a late reverse-geocode result cannot overwrite a newer pick at the same coordinates");

  assert.equal(writes, 0, "the regression run performs no database writes");
  assert.deepEqual(pageErrors, [], "the page has no runtime errors");
  console.log(JSON.stringify({
    base, manualPreserved:true, coarseClearPreserved:true, clearPreserved:true, newestRequestPreserved:true,
    staleErrorIgnored:true, cancelledSuccessIgnored:true, lateReverseIgnored:true, writes, pageErrors
  }, null, 2));
} finally {
  await browser.close();
}
