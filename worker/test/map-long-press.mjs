import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8791";
const evidenceDir = process.env.MAP_LONG_PRESS_EVIDENCE_DIR;
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const phone = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
const page = await phone.newPage();
const cdp = await phone.newCDPSession(page);
const reportPopup = page.locator("#map .leaflet-popup").filter({ has:page.locator("[data-askok]") });
const comparisons = [];

await page.route("**/api/geocode*", route => route.fulfill({ json:{ lat:null } }));
await page.route("**/api/db", async route => {
  if (route.request().method() !== "POST") return route.continue();
  return route.fulfill({ status:500, json:{ error:"test_writes_disabled" } });
});

const askPopupCount = () => reportPopup.count();
const mapPoint = async (selector, fx = .5, fy = .5) => {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `${selector} has a visible map area`);
  return { x:box.x + box.width * fx, y:box.y + box.height * fy };
};
const targetAt = point => page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  const classes = el && typeof el.className === "string" ? el.className : el?.className?.baseVal || "";
  return { tag:el?.tagName || "", classes };
}, point);
const sendTouch = (type, points = []) => cdp.send("Input.dispatchTouchEvent", {
  type, touchPoints:points.map(({ x, y, id = 0 }) => ({ x, y, id, radiusX:4, radiusY:4, force:.7 }))
});
const touchAt = async (point, duration = 1350) => {
  await sendTouch("touchStart", [point]);
  await page.waitForTimeout(duration);
  await sendTouch("touchEnd");
};
const mapCenter = () => page.evaluate(() => { const p = mainLM.getCenter(); return [p.lat, p.lng]; });
const mapCoordinatesAt = point => page.evaluate(({ x, y }) => {
  const rect = document.querySelector("#map").getBoundingClientRect();
  const p = mainLM.containerPointToLatLng(L.point(x - rect.left, y - rect.top));
  return [p.lat, p.lng];
}, point);
const caseMarkerPoint = markerId => page.evaluate(id => {
  const record = markers.get(id), path = record?.m?.getElement?.();
  if (!path) return { id, visible:false };
  const rect = path.getBoundingClientRect();
  if (!rect.width || !rect.height) return { id, visible:false };
  const point = { x:Math.round(rect.left + rect.width / 2), y:Math.round(rect.top + rect.height / 2) };
  const target = document.elementFromPoint(point.x, point.y);
  return {
    id, visible:true, title:record.i.title, markerCoordinates:[record.i.lat, record.i.lng],
    point, targetIsPath:target === path || path.contains(target), targetClass:path.getAttribute("class")
  };
}, markerId);
const popupCoordinates = async () => {
  const text = await reportPopup.locator(".leaflet-popup-content").innerText();
  const match = text.match(/座標\s+(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  assert.ok(match, `report popup shows coordinates: ${text}`);
  return [Number(match[1]), Number(match[2])];
};
const assertNear = (actual, expected, message) => {
  const twoPixels = .0002;
  assert.ok(Math.abs(actual[0] - expected[0]) < twoPixels && Math.abs(actual[1] - expected[1]) < twoPixels,
    `${message} (within about two map pixels, including popup coordinate rounding): expected ${expected.join(", ")}, got ${actual.join(", ")}`);
};
const assertMatchesContextmenu = (actual, expected, message) => {
  const round = coords => coords.map(value => Number(value.toFixed(5)));
  assert.deepEqual(round(actual), round(expected), `${message}: expected ${round(expected).join(", ")}, got ${round(actual).join(", ")}`);
};
const closeReportPopup = async () => {
  if (await askPopupCount()) {
    await page.locator("#map [data-askno]").click();
    await reportPopup.waitFor({ state:"detached" });
    return;
  }
  const closeButton = page.locator("#map .leaflet-popup-close-button");
  if (await closeButton.count()) await closeButton.click();
};
// A tap in a trial can open the district under it, which hides the layer list. Go back to the city view and wait for its fly-out.
const backToCity = async () => {
  if (!await page.locator("#distBack").isVisible()) return;
  await page.evaluate(() => new Promise(done => { mainLM.once("moveend", done); setTimeout(done, 3000); document.querySelector("#distBack").click(); }));
};
const toggleTapHold = enabled => page.evaluate(value => {
  if (!mainLM.tapHold) throw new Error("Leaflet did not install its tapHold handler");
  if (value && !mainLM.tapHold.enabled()) mainLM.tapHold.enable();
  if (!value && mainLM.tapHold.enabled()) mainLM.tapHold.disable();
  window.__mapContextmenuEvents = [];
}, enabled);
const trial = async (target, targetSpec, tapHold) => {
  await closeReportPopup();
  await toggleTapHold(tapHold);
  if (targetSpec.markerId) {
    await page.evaluate(() => mainLM.setView([25.0478, 121.5319], 13, { animate:false }));
    await page.waitForFunction(id => {
      const record = markers.get(id), rect = record?.m?.getElement?.()?.getBoundingClientRect();
      return !!rect && rect.width > 0 && rect.height > 0 && mainLM.hasLayer(record.m);
    }, targetSpec.markerId, { timeout:10000 });
  }
  const markerPoint = targetSpec.markerId ? await caseMarkerPoint(targetSpec.markerId) : null;
  if (targetSpec.markerId) {
    assert.ok(markerPoint.visible, `${target} is an application-rendered issue marker path`);
    assert.ok(markerPoint.targetIsPath, `${target} touch point hits that issue's marker`);
  }
  const point = markerPoint?.point || await mapPoint(targetSpec.selector, targetSpec.fx ?? .5, targetSpec.fy ?? .5);
  const domTarget = await targetAt(point);
  await touchAt(point);
  await page.waitForTimeout(150);
  const result = {
    target, tapHold, domTarget, targetPoint:point,
    ...(markerPoint ? {
      markerId:markerPoint.id, markerCoordinates:markerPoint.markerCoordinates,
      targetIsPath:markerPoint.targetIsPath, targetClass:markerPoint.targetClass
    } : {}),
    contextmenus:await page.evaluate(() => window.__mapContextmenuEvents.length),
    contextmenuCoordinates:await page.evaluate(() => window.__mapContextmenuEvents.map(([lat,lng]) => [lat,lng])),
    reportPopupCount:await askPopupCount(),
    popupCount:await page.locator("#map .leaflet-popup").count(),
    popupText:await page.locator("#map .leaflet-popup-content").allInnerTexts()
  };
  assert.ok(result.contextmenus <= 1, `${target} creates at most one map contextmenu with tapHold=${tapHold}`);
  assert.ok(result.reportPopupCount <= 1, `${target} creates at most one report popup with tapHold=${tapHold}`);
  assert.ok(result.popupCount <= 1, `${target} creates at most one popup with tapHold=${tapHold}`);
  if (result.reportPopupCount) {
    result.reportPopupCoordinates = await popupCoordinates();
    if (markerPoint) await saveScreenshot("real-case-marker-long-press.png");
    await closeReportPopup();
  }
  return result;
};
const waitNoReportPopup = async message => {
  await page.waitForTimeout(250);
  assert.equal(await askPopupCount(), 0, message);
};
const saveScreenshot = async name => {
  if (!evidenceDir) return;
  await mkdir(evidenceDir, { recursive:true });
  await page.screenshot({ path:`${evidenceDir}/${name}` });
};

try {
  await page.goto(`${base}/#map`, { waitUntil:"domcontentloaded" });
  await page.locator("#map.leaflet-container").waitFor({ state:"visible", timeout:30000 });
  await page.locator("#tline").waitFor({ state:"visible", timeout:15000 });
  await page.waitForFunction(() => !document.querySelector("#mapMsg")?.textContent);
  await page.waitForFunction(() => gotReports && gotTriage, null, { timeout:30000 });
  for (const layer of await page.locator("#mapLayers input[type=checkbox]").all()) {
    if (await layer.isChecked()) await layer.uncheck();
  }
  await page.evaluate(() => {
    mainLM.setView([25.0478, 121.5319], 13);
    window.__mapContextmenuEvents = [];
    mainLM.on("contextmenu", e => window.__mapContextmenuEvents.push([e.latlng.lat, e.latlng.lng]));
  });

  // Prove the page's default map options work before any test toggles tapHold.
  const blankTarget = { selector:"#map", fx:.35, fy:.25 };
  const defaultPoint = await mapPoint(blankTarget.selector, blankTarget.fx, blankTarget.fy);
  assert.ok(await page.evaluate(coords => inTaipei(coords[0], coords[1]), await mapCoordinatesAt(defaultPoint)),
    "the untouched default-state long-press point is inside Taipei City");
  await touchAt(defaultPoint);
  await reportPopup.locator("[data-askok]").waitFor({ state:"visible", timeout:3000 });
  const defaultContextmenuEvents = await page.evaluate(() => window.__mapContextmenuEvents.map(([lat,lng]) => [lat,lng]));
  const defaultPageLongPress = {
    contextmenus:defaultContextmenuEvents.length,
    contextmenuCoordinates:defaultContextmenuEvents,
    reportPopupCount:await askPopupCount(),
    popupCount:await page.locator("#map .leaflet-popup").count(),
    popupText:await page.locator("#map .leaflet-popup-content").allInnerTexts(),
    reportPopupCoordinates:await popupCoordinates()
  };
  assert.equal(defaultPageLongPress.contextmenus, 1, "the default map options fire one contextmenu on a mobile long press");
  assert.equal(defaultPageLongPress.reportPopupCount, 1, "the default map options open one direct-report prompt before tapHold is toggled");
  assert.equal(defaultPageLongPress.popupCount, 1, "the default mobile long press opens exactly one popup");
  assert.ok(defaultPageLongPress.popupText[0].includes("要在這裡通報嗎？"), "the default popup is the direct-report prompt");
  assertMatchesContextmenu(defaultPageLongPress.reportPopupCoordinates, defaultPageLongPress.contextmenuCoordinates[0],
    "the default popup uses its contextmenu coordinates");
  await saveScreenshot("default-long-press.png");
  await closeReportPopup();

  // Same targets and browser session: disable Leaflet's handler to measure the old behavior, then enable it.
  const blankPair = [];
  blankPair.push(await trial("blank basemap", blankTarget, false));
  blankPair.push(await trial("blank basemap", blankTarget, true));
  comparisons.push(...blankPair);

  // Use demo-01, which is rendered by the app's actual issue-marker path and detail popup.
  const caseMarkerId = "demo-01";
  const caseMarker = await page.evaluate(id => {
    const record = markers.get(id);
    return record && { key:record.key, title:record.i.title, coordinates:[record.i.lat, record.i.lng] };
  }, caseMarkerId);
  assert.ok(caseMarker, `the seeded issue ${caseMarkerId} is loaded from the app's report data`);
  await backToCity();
  const caseLayer = page.locator(`#mapLayers input[data-layer="${caseMarker.key}"]`);
  // Checking the layer scrolls the page down to the list; put the map back where the page had it.
  const scrolled = await page.evaluate(() => scrollY);
  await caseLayer.check();
  await page.evaluate(y => window.scrollTo(0, y), scrolled);
  // No zoom animation: a tap during it leaves the popup half-panned above the map.
  await page.evaluate(() => mainLM.setView([25.0478, 121.5319], 13, { animate:false }));
  await page.waitForFunction(id => {
    const record = markers.get(id), path = record?.m?.getElement?.();
    const rect = path?.getBoundingClientRect();
    return !!rect && rect.width > 0 && rect.height > 0 && mainLM.hasLayer(record.m);
  }, caseMarkerId, { timeout:10000 });
  const shortPoint = await caseMarkerPoint(caseMarkerId);
  assert.ok(shortPoint.targetIsPath, "the short tap lands on the real issue's interactive marker");
  await toggleTapHold(true);
  await page.touchscreen.tap(shortPoint.point.x, shortPoint.point.y);
  await page.locator("#map .leaflet-popup").waitFor({ state:"visible", timeout:3000 });
  // The taller pin popup pans the map to fit; let the pan end before anything reads or clicks the popup.
  await page.waitForFunction(() => !mainLM._panAnim?._inProgress);
  const caseShortTap = {
    markerId:caseMarkerId,
    markerCoordinates:shortPoint.markerCoordinates,
    targetPoint:shortPoint.point,
    targetIsPath:shortPoint.targetIsPath,
    targetClass:shortPoint.targetClass,
    contextmenus:await page.evaluate(() => window.__mapContextmenuEvents.length),
    reportPopupCount:await askPopupCount(),
    popupCount:await page.locator("#map .leaflet-popup").count(),
    popupText:await page.locator("#map .leaflet-popup-content").allInnerTexts()
  };
  assert.equal(caseShortTap.contextmenus, 0, "a short tap on a real case marker does not fire contextmenu");
  assert.equal(caseShortTap.reportPopupCount, 0, "a short tap on a real case marker does not open the report prompt");
  assert.equal(caseShortTap.popupCount, 1, "a short tap on a real case marker opens one detail popup");
  assert.ok(caseShortTap.popupText[0].includes(caseMarker.title), "a short tap on a real case marker keeps its case details");
  await closeReportPopup();

  const caseMarkerTarget = { markerId:caseMarkerId };
  const caseMarkerPair = [];
  caseMarkerPair.push(await trial("live case marker", caseMarkerTarget, false));
  caseMarkerPair.push(await trial("live case marker", caseMarkerTarget, true));
  comparisons.push(...caseMarkerPair);
  assert.equal(await caseLayer.isChecked(), true, "the tested real issue marker layer stays selected for the path comparison");
  await backToCity();
  await caseLayer.uncheck();

  await page.evaluate(() => { window.__mapContextmenuEvents = []; });
  let point = await mapPoint("#map", .35, .25);
  await sendTouch("touchStart", [point]);
  await page.waitForTimeout(150);
  await sendTouch("touchEnd");
  await waitNoReportPopup("a short tap does not open the report popup");
  assert.equal(await page.evaluate(() => window.__mapContextmenuEvents.length), 0, "a short tap does not fire contextmenu");
  point = await mapPoint("#map");
  await sendTouch("touchStart", [{ x:point.x - 80, y:point.y, id:1 }]);
  await page.waitForTimeout(150);
  await sendTouch("touchMove", [{ x:point.x + 80, y:point.y, id:1 }]);
  await page.waitForTimeout(1150);
  await sendTouch("touchEnd");
  await waitNoReportPopup("a map drag does not become a long press");
  assert.equal(await page.evaluate(() => window.__mapContextmenuEvents.length), 0, "a map drag does not fire contextmenu");
  point = await mapPoint("#map");
  await sendTouch("touchStart", [{ x:point.x - 16, y:point.y, id:1 }, { x:point.x + 16, y:point.y, id:2 }]);
  await page.waitForTimeout(1300);
  await sendTouch("touchEnd");
  await waitNoReportPopup("a multi-touch gesture does not become a long press");
  assert.equal(await page.evaluate(() => window.__mapContextmenuEvents.length), 0, "a multi-touch gesture does not fire contextmenu");

  // The timeline renders to canvas. Compare native behavior with Leaflet tapHold at the same canvas point.
  await backToCity();
  await page.locator("#mapLayers input[type=checkbox]").first().check();
  await page.locator("#histOn").check();
  await page.waitForFunction(() => /件派工$/.test(document.querySelector("#histCount").textContent), null, { timeout:30000 });
  await page.waitForFunction(() => [...document.querySelectorAll("#map canvas")].some(canvas => {
    const r = canvas.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }), null, { timeout:10000 });
  const canvasSpec = { selector:"#map canvas" };
  point = await mapPoint(canvasSpec.selector);
  const canvasTarget = await targetAt(point);
  const canvasCoversPoint = await page.evaluate(({ x, y }) => [...document.querySelectorAll("#map canvas")].some(canvas => {
    const r = canvas.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }), point);
  assert.ok(canvasCoversPoint, `history canvas covers the touch point; target was ${JSON.stringify(canvasTarget)}`);
  const canvasPair = [];
  canvasPair.push(await trial("history canvas", canvasSpec, false));
  canvasPair.push(await trial("history canvas", canvasSpec, true));
  comparisons.push(...canvasPair);
  assert.equal(await page.locator("#histOn").isChecked(), true, "history mode stays selected during map touches");

  const baselineTargets = ["blank basemap", "live case marker", "history canvas"];
  const improvement = baselineTargets.some(target => {
    const before = comparisons.find(item => item.target === target && !item.tapHold);
    const after = comparisons.find(item => item.target === target && item.tapHold);
    return before && after && before.reportPopupCount === 0 && after.reportPopupCount === 1;
  });
  const noDoublePopup = comparisons.filter(item => item.tapHold)
    .every(item => item.contextmenus <= 1 && item.reportPopupCount <= 1 && item.popupCount <= 1);
  const reportTargetsOpenOnce = ["blank basemap", "live case marker", "history canvas"].every(target => {
    const item = comparisons.find(candidate => candidate.target === target && candidate.tapHold);
    return item && item.contextmenus === 1 && item.reportPopupCount === 1 && item.popupCount === 1 &&
      item.popupText.some(text => text.includes("要在這裡通報嗎？"));
  });
  const caseMarkerLongPress = caseMarkerPair.find(item => item.tapHold);
  const caseMarkerBaseline = caseMarkerPair.find(item => !item.tapHold);
  const caseMarkerLongPressWorks = caseMarkerBaseline && caseMarkerBaseline.reportPopupCount === 0 &&
    caseMarkerLongPress && caseMarkerLongPress.contextmenus === 1 && caseMarkerLongPress.reportPopupCount === 1 &&
    caseMarkerLongPress.popupCount === 1 && caseMarkerLongPress.popupText.some(text => text.includes("要在這裡通報嗎？"));
  if (caseMarkerLongPressWorks) {
    assert.equal(caseMarkerLongPress.markerId, caseMarkerBaseline.markerId,
      "the tapHold off/on comparison uses the same real issue marker");
    assert.deepEqual(caseMarkerLongPress.markerCoordinates, caseMarkerBaseline.markerCoordinates,
      "the tapHold off/on comparison uses the same issue coordinates");
    assert.equal(caseMarkerLongPress.contextmenuCoordinates.length, 1, "the real marker long press has one contextmenu coordinate");
    assertMatchesContextmenu(caseMarkerLongPress.reportPopupCoordinates, caseMarkerLongPress.contextmenuCoordinates[0],
      "the real marker report popup uses its contextmenu coordinates");
  }
  const touchEvidence = { defaultPageLongPress, caseShortTap, comparisons, improvement, noDoublePopup, reportTargetsOpenOnce, caseMarkerLongPressWorks, historyCanvasCoversPoint:canvasCoversPoint, canvasTouchTarget:canvasTarget };
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive:true });
    await writeFile(`${evidenceDir}/tap-hold-comparison.json`, JSON.stringify(touchEvidence, null, 2));
  }
  assert.ok(improvement, "tapHold enables a report popup on a target that failed before it was enabled");
  assert.ok(noDoublePopup, "tapHold creates no more than one contextmenu or popup per touch");
  assert.ok(reportTargetsOpenOnce, "blank basemap, a real issue marker, and history canvas each open one report popup");
  assert.ok(caseMarkerLongPressWorks, "a real issue marker long press opens one report prompt only when tapHold is enabled");
  point = await mapPoint("#map");
  const historyTouchCoordinates = await mapCoordinatesAt(point);
  await touchAt(point);
  await reportPopup.waitFor({ state:"visible", timeout:3000 });
  if (improvement) await saveScreenshot("history-long-press.png");
  const historyPopupCoordinates = await popupCoordinates();
  assertNear(historyPopupCoordinates, historyTouchCoordinates, "history long press uses the touched location");
  assert.equal(await page.locator("#map [data-askok]").count(), 1, "the history gesture opens the location-confirmation popup");
  await page.locator("#map [data-askok]").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  const confirmedCoordinates = await page.evaluate(() => [picked.lat, picked.lng]);
  assert.deepEqual(confirmedCoordinates, historyPopupCoordinates, "confirming the popup selects its displayed coordinates");
  assert.ok((await page.locator("#locStatus").innerText()).includes(`${historyPopupCoordinates[0].toFixed(5)}, ${historyPopupCoordinates[1].toFixed(5)}`),
    "the selected location status matches the displayed coordinates");
  await page.locator("#nav button[data-view=map]").click();
  await page.locator("#map.leaflet-container").waitFor({ state:"visible" });
  if (await page.locator("#histOn").isChecked()) await page.locator("#histOn").uncheck();

  await page.evaluate(() => mainLM.setView([24.96, 121.66], 13));
  const outsideCenter = await mapCenter();
  assert.equal(await page.evaluate(([lat, lng]) => inTaipei(lat, lng), outsideCenter), false, "the tested point is outside Taipei City");
  point = await mapPoint("#map");
  await touchAt(point);
  await waitNoReportPopup("an outside Taipei long press does not open a report popup");
  assert.match(await page.locator("#toast").innerText(), /不在台北市範圍內/, "an outside long press is rejected");
  assert.equal(await page.locator("#newBox").isVisible(), false, "an outside long press does not open the report form");

  await page.waitForFunction(() => !document.querySelector("#toast")?.textContent);
  await page.evaluate(() => mainLM.setView([25.0478, 121.5319], 13));
  await page.setViewportSize({ width:844, height:390 });
  await page.waitForFunction(() => matchMedia("(orientation: landscape)").matches);
  await page.waitForTimeout(250);
  point = await mapPoint("#map");
  const landscapeTouchCoordinates = await mapCoordinatesAt(point);
  await touchAt(point);
  await reportPopup.waitFor({ state:"visible", timeout:3000 });
  assertNear(await popupCoordinates(), landscapeTouchCoordinates, "landscape long press has no map-position offset");
  await saveScreenshot("landscape-long-press.png");
  await closeReportPopup();

  await page.locator("#reportBtn").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#pinBtn").click();
  await page.locator("#pickMap.leaflet-container").waitFor({ state:"visible", timeout:15000 });
  point = await mapPoint("#pickMap");
  await sendTouch("touchStart", [point]);
  await page.waitForTimeout(150);
  await sendTouch("touchEnd");
  await page.locator("#pickMap .leaflet-marker-icon.pin-wrap").waitFor({ state:"visible" });
  assert.match(await page.locator("#locStatus").innerText(), /已標記位置/, "a short tap still sets the small-map pin");
  const smallMapPicked = await page.evaluate(() => [picked.lat, picked.lng]);
  const smallMapPin = await page.evaluate(() => { const p = pinM.getLatLng(); return [p.lat, p.lng]; });
  assertNear(smallMapPicked, smallMapPin, "short taps still set the small-map pin at the selected point");

  const desktop = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const desktopPage = await desktop.newPage();
  let desktopContextmenus = 0;
  await desktopPage.route("**/api/geocode*", route => route.fulfill({ json:{ lat:null } }));
  await desktopPage.goto(`${base}/#map`, { waitUntil:"domcontentloaded" });
  await desktopPage.locator("#map.leaflet-container").waitFor({ state:"visible", timeout:30000 });
  await desktopPage.waitForFunction(() => !document.querySelector("#mapMsg")?.textContent);
  await desktopPage.evaluate(() => { window.__contextmenus = 0; mainLM.on("contextmenu", () => window.__contextmenus++); });
  const desktopBox = await desktopPage.locator("#map").boundingBox();
  assert.ok(desktopBox && desktopBox.width > 0 && desktopBox.height > 0, "desktop map is visible");
  await desktopPage.mouse.click(desktopBox.x + desktopBox.width / 2, desktopBox.y + desktopBox.height / 2, { button:"right" });
  await desktopPage.locator("#map .leaflet-popup [data-askok]").waitFor({ state:"visible", timeout:3000 });
  desktopContextmenus = await desktopPage.evaluate(() => window.__contextmenus);
  assert.equal(desktopContextmenus, 1, "one desktop right click opens one report popup");
  const desktopPopupText = await desktopPage.locator("#map .leaflet-popup-content").innerText();
  assert.ok(desktopPopupText.includes("要在這裡通報嗎？"), "the desktop right-click popup is the direct-report prompt");
  await desktopPage.waitForTimeout(250);
  if (evidenceDir) await desktopPage.screenshot({ path:`${evidenceDir}/desktop-right-click.png` });
  await desktop.close();

  if (evidenceDir) await writeFile(`${evidenceDir}/tap-hold-comparison.json`, JSON.stringify({ ...touchEvidence, reportTargetsOpenOnce, desktopContextmenus, desktopPopupText }, null, 2));
  console.log(JSON.stringify({ ok:true, defaultPageLongPress, caseShortTap, improvement, noDoublePopup, reportTargetsOpenOnce, caseMarkerLongPressWorks, comparisons, desktopContextmenus, desktopPopupText }));
} finally {
  await phone.close();
  await browser.close();
}
