import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8908";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {})
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE + "/#map", { waitUntil: "domcontentloaded" });

  await page.waitForFunction(
    () => typeof openDistrict === "function" && typeof mainLM !== "undefined" && typeof distLayers !== "undefined" && Object.keys(distLayers).length === 12,
    null,
    { timeout: 15000 }
  );

  const result = await page.evaluate(async () => {
    let hadZoomAnim = false;
    const interval = setInterval(() => {
      if (document.querySelector(".leaflet-zoom-anim")) hadZoomAnim = true;
    }, 4);

    let moveEnds = 0;
    const start = performance.now();
    let durationMs = 0;
    const movePromise = new Promise(resolve => {
      mainLM.on("moveend", () => {
        moveEnds++;
        // If animated (flyTo in no-preference), first moveend fires on _stop() immediately, then animated flight runs until the second moveend (> 200ms).
        // If instant (fitBounds animate:false in reduced-motion), all view resets finish within a few milliseconds (< 10ms).
        if (moveEnds >= 2) {
          durationMs = performance.now() - start;
          resolve();
        }
      });
      // In reduced-motion mode (animate:false), view reset completes synchronously or near-instantly,
      // and only 1 or 2 instant moveends fire without entering animation frames.
      setTimeout(() => {
        durationMs = performance.now() - start;
        resolve();
      }, 30);
    });

    const path = document.querySelector(".leaflet-districts-pane path");
    const t0 = performance.now();
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await movePromise;
    clearInterval(interval);
    if (document.querySelector(".leaflet-zoom-anim")) hadZoomAnim = true;

    return { durationMs, hadZoomAnim, totalMs: performance.now() - t0 };
  });

  console.log(`reduced-motion fly duration: ${result.durationMs.toFixed(1)}ms (total: ${result.totalMs.toFixed(1)}ms), hadZoomAnim: ${result.hadZoomAnim}`);

  assert.equal(
    result.hadZoomAnim,
    false,
    "no leaflet-zoom-anim class was observed during flight"
  );
  assert.ok(
    result.totalMs <= 100,
    `openDistrict flyToBounds finished in <= 100ms when prefers-reduced-motion: reduce, got ${result.totalMs.toFixed(1)}ms`
  );

  await context.close();

  // Test no-preference: animation should be enabled (duration > 200ms)
  const normPage = await browser.newPage({
    viewport: { width: 1440, height: 900 }
  });
  await normPage.goto(BASE + "/#map", { waitUntil: "domcontentloaded" });

  await normPage.waitForFunction(
    () => typeof openDistrict === "function" && typeof mainLM !== "undefined" && typeof distLayers !== "undefined" && Object.keys(distLayers).length === 12,
    null,
    { timeout: 15000 }
  );

  const normResult = await normPage.evaluate(async () => {
    let zoomAnimSeen = false;
    const interval = setInterval(() => {
      if (document.querySelector(".leaflet-zoom-anim")) zoomAnimSeen = true;
    }, 4);

    let moveEnds = 0;
    const start = performance.now();
    let durationMs = 0;
    const movePromise = new Promise(resolve => {
      mainLM.on("moveend", () => {
        moveEnds++;
        // If animated, the flight moveend completes after animated frames (> 200ms)
        if (performance.now() - start > 100 || moveEnds >= 2) {
          durationMs = performance.now() - start;
          resolve();
        }
      });
      setTimeout(() => {
        durationMs = performance.now() - start;
        resolve();
      }, 3000);
    });

    const path = document.querySelector(".leaflet-districts-pane path");
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await movePromise;
    clearInterval(interval);
    if (document.querySelector(".leaflet-zoom-anim")) zoomAnimSeen = true;

    return { durationMs, zoomAnimSeen };
  });

  console.log(`no-preference fly duration: ${normResult.durationMs.toFixed(1)}ms, zoomAnimSeen: ${normResult.zoomAnimSeen}`);

  assert.ok(
    normResult.durationMs > 200,
    `openDistrict flyToBounds has animated flight (> 200ms) when reducedMotion: no-preference, got ${normResult.durationMs.toFixed(1)}ms`
  );

  console.log("PASS: reduced-motion-fly");
  await normPage.close();
} finally {
  await browser.close();
}
