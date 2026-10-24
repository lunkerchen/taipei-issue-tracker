// Transparent PNG uploaded as photo must be composited on white before JPEG conversion,
// not converted over a transparent canvas (which JPEG encodes as solid pitch black).
//
// Run:
//   BASE=http://127.0.0.1:8921 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/photo-transparent-bg.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://127.0.0.1:8921";

// 100x100 PNG with transparent background and red center square
function makeTransparentPngDataUrl() {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 100, 100);
  ctx.fillStyle = "rgba(255, 0, 0, 1)";
  ctx.fillRect(30, 30, 40, 40);
  return canvas.toDataURL("image/png");
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: "networkidle" });

  await page.waitForFunction(
    () => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden,
    null,
    { timeout: 15000 }
  );
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state: "visible" });

  const dataUrl = await page.evaluate(makeTransparentPngDataUrl);
  const base64 = dataUrl.split(",")[1];
  const buffer = Buffer.from(base64, "base64");

  await page.locator("#photoIn").setInputFiles({
    name: "transparent-graphic.png",
    mimeType: "image/png",
    buffer
  });

  await page.waitForFunction(() => document.querySelectorAll("#photoPrev img").length > 0, null, { timeout: 10000 });

  const pixel = await page.evaluate(async () => {
    const img = document.querySelector("#photoPrev img");
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // Sample a background pixel at (5, 5) which was transparent in the source PNG
    const p = ctx.getImageData(5, 5, 1, 1).data;
    return { r: p[0], g: p[1], b: p[2], a: p[3] };
  });

  console.log("Composited background pixel:", pixel);

  // Background must be white (near 255, 255, 255 due to JPEG compression), NOT black (0, 0, 0)
  assert.ok(
    pixel.r > 240 && pixel.g > 240 && pixel.b > 240,
    `Expected white background for transparent PNG (>240, >240, >240), got (${pixel.r}, ${pixel.g}, ${pixel.b})`
  );

  console.log("photo-transparent-bg: PASS");
} finally {
  if (browser) await browser.close();
}
