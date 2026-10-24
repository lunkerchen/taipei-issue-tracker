import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8908";

function parseRgb(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function relLum([r, g, b]) {
  const [sR, sG, sB] = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
}

function contrast(rgb1, rgb2) {
  const l1 = relLum(rgb1);
  const l2 = relLum(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {})
});

try {
  // Test 1: Dark Mode in 1440x900
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto(BASE + "/#map", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-control-zoom-in", { timeout: 15000 });
    await page.waitForSelector(".leaflet-tooltip.dlabel", { timeout: 15000 });

    const data = await page.evaluate(() => {
      const zoomIn = document.querySelector(".leaflet-control-zoom-in");
      const zoomInStyle = getComputedStyle(zoomIn);
      const label = document.querySelector(".leaflet-tooltip.dlabel");
      const labelStyle = getComputedStyle(label);
      return {
        themeAttr: document.documentElement.dataset.theme,
        zoomBg: zoomInStyle.backgroundColor,
        zoomColor: zoomInStyle.color,
        labelColor: labelStyle.color,
        labelTextShadow: labelStyle.textShadow
      };
    });

    assert.equal(data.themeAttr, "dark", "theme is dark");

    const zoomBgRgb = parseRgb(data.zoomBg);
    const zoomFgRgb = parseRgb(data.zoomColor);
    assert.ok(zoomBgRgb, `valid zoom bg rgb: ${data.zoomBg}`);
    assert.ok(zoomFgRgb, `valid zoom fg rgb: ${data.zoomColor}`);

    // Zoom button background must NOT be white in dark mode (e.g. rgb(255, 255, 255))
    const isWhite = zoomBgRgb[0] > 240 && zoomBgRgb[1] > 240 && zoomBgRgb[2] > 240;
    assert.ok(!isWhite, `zoom background is dark/non-white in dark mode, got ${data.zoomBg}`);

    const zoomContrastRatio = contrast(zoomBgRgb, zoomFgRgb);
    assert.ok(
      zoomContrastRatio >= 4.5,
      `zoom button text contrast against its background is >= 4.5:1, got ${zoomContrastRatio.toFixed(2)}:1`
    );

    // District label color check in dark mode: color should be light var(--fg) (#f0f6fc)
    const labelFgRgb = parseRgb(data.labelColor);
    assert.ok(labelFgRgb, `valid label color rgb: ${data.labelColor}`);
    assert.ok(labelFgRgb[0] > 200 && labelFgRgb[1] > 200 && labelFgRgb[2] > 200, `district label is light text in dark mode, got ${data.labelColor}`);

    // Pickbox (report location modal) zoom buttons also styled in dark mode
    await page.evaluate(() => {
      document.querySelector("#reportBtn")?.click() || document.querySelector("#newBtn")?.click();
      document.querySelector("#pinBtn")?.click();
    });
    await page.waitForSelector(".pickbox .leaflet-control-zoom-in", { timeout: 10000 });
    const pickboxZoomBg = await page.evaluate(() => {
      const btn = document.querySelector(".pickbox .leaflet-control-zoom-in");
      return getComputedStyle(btn).backgroundColor;
    });
    const pickboxBgRgb = parseRgb(pickboxZoomBg);
    const isPickboxWhite = pickboxBgRgb[0] > 240 && pickboxBgRgb[1] > 240 && pickboxBgRgb[2] > 240;
    assert.ok(!isPickboxWhite, `pickbox zoom background is dark/non-white in dark mode, got ${pickboxZoomBg}`);

    await context.close();
  }

  // Test 2: Light Mode check (ensure light mode appearance is preserved)
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.goto(BASE + "/#map", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-control-zoom-in", { timeout: 15000 });
    await page.waitForSelector(".leaflet-tooltip.dlabel", { timeout: 15000 });

    const lightData = await page.evaluate(() => {
      const zoomIn = document.querySelector(".leaflet-control-zoom-in");
      const zoomInStyle = getComputedStyle(zoomIn);
      const label = document.querySelector(".leaflet-tooltip.dlabel");
      const labelStyle = getComputedStyle(label);
      return {
        themeAttr: document.documentElement.dataset.theme,
        zoomBg: zoomInStyle.backgroundColor,
        zoomColor: zoomInStyle.color,
        labelColor: labelStyle.color
      };
    });

    assert.equal(lightData.themeAttr, "light", "theme is light");
    const zoomBgRgb = parseRgb(lightData.zoomBg);
    const zoomFgRgb = parseRgb(lightData.zoomColor);
    // Light mode zoom button is white (#ffffff)
    const isWhite = zoomBgRgb[0] > 240 && zoomBgRgb[1] > 240 && zoomBgRgb[2] > 240;
    assert.ok(isWhite, `zoom background is white in light mode, got ${lightData.zoomBg}`);
    const contrastRatio = contrast(zoomBgRgb, zoomFgRgb);
    assert.ok(contrastRatio >= 4.5, `light mode zoom contrast >= 4.5:1, got ${contrastRatio.toFixed(2)}:1`);

    // Light mode label color is dark (#1f2328)
    const labelFgRgb = parseRgb(lightData.labelColor);
    assert.ok(labelFgRgb[0] < 50 && labelFgRgb[1] < 50 && labelFgRgb[2] < 50, `district label is dark in light mode, got ${lightData.labelColor}`);

    await context.close();
  }

  console.log("PASS: dark-map-controls");
} finally {
  await browser.close();
}
