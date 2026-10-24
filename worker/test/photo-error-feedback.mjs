// Photo errors must show next to the picker and must clear after a later valid photo.
// Run: BASE=http://127.0.0.1:9009 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/photo-error-feedback.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
try {
  for (const viewport of [{ width:390, height:844 }, { width:320, height:568 }]) {
    const context = await browser.newContext({ viewport, isMobile:true, hasTouch:true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(BASE + "/#issues", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden, null, { timeout:15000 });
    await page.locator("#navReport").click();
    await page.locator("#newBox").waitFor({ state:"visible" });
    await page.locator("#photoLbl").scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);

    await page.locator("#photoIn").setInputFiles({ name:"notes-renamed.jpg", mimeType:"image/jpeg", buffer:Buffer.from("not an image") });
    await page.waitForFunction(() => document.querySelector("#photoStatus")?.textContent.includes("無法讀取"), null, { timeout:10000 });
    const bad = await page.evaluate(() => {
      const s = document.querySelector("#photoStatus"), l = document.querySelector("#photoLbl");
      const sr = s.getBoundingClientRect(), lr = l.getBoundingClientRect();
      return { text:s.textContent, top:Math.round(sr.top), bottom:Math.round(sr.bottom), labelBottom:Math.round(lr.bottom),
        viewport:innerHeight, overall:document.querySelector("#newStatus").textContent };
    });
    assert.ok(bad.top >= 0 && bad.bottom <= bad.viewport, `${viewport.width}: the photo error is in the viewport, got ${JSON.stringify(bad)}`);
    assert.ok(bad.top - bad.labelBottom < 120, `${viewport.width}: the photo error is next to the picker, got ${JSON.stringify(bad)}`);
    assert.equal(bad.overall.includes("無法讀取"), false, `${viewport.width}: the error is not left in the page-bottom status`);

    await page.locator("#photoIn").setInputFiles({ name:"valid.png", mimeType:"image/png", buffer:PNG });
    await page.locator("#photoPrev img").waitFor({ state:"visible", timeout:10000 });
    await page.waitForFunction(() => !document.querySelector("#photoStatus").textContent.trim(), null, { timeout:10000 });
    assert.equal(await page.locator("#photoStatus").textContent(), "", `${viewport.width}: a later valid photo clears the old error`);
    assert.deepEqual(errors, [], `${viewport.width}: no page errors`);
    await context.close();
    console.log(viewport.width + " OK");
  }
  console.log("OK photo errors are beside the picker and clear after a valid pick");
} finally {
  await browser.close();
}
