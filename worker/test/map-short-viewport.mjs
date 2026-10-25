import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
try {
  for (const viewport of [{ width:320, height:568 }, { width:640, height:400 }, { width:512, height:384 }, { width:390, height:844 }]) {
    const context = await browser.newContext({ viewport, isMobile:true, hasTouch:true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(BASE + "/#map", { waitUntil:"domcontentloaded" });
      await page.waitForSelector(".leaflet-tooltip.dlabel", { timeout:20000 });
      await page.waitForTimeout(1500);
      const m = await page.evaluate(() => {
        const box = document.querySelector(".mapbox").getBoundingClientRect();
        const labels = [...document.querySelectorAll(".leaflet-tooltip.dlabel")].filter(el => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return s.display !== "none" && s.visibility !== "hidden" && r.width > 0;
        }).map(el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height }; });
        let pairs = 0;
        for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i], b = labels[j];
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) pairs++;
        }
        return { h:box.height, labels:labels.length, pairs };
      });
      assert.ok(m.h >= 300, `${viewport.width}x${viewport.height}: the map is at least 300px tall, got ${Math.round(m.h)}`);
      assert.equal(m.labels, 12, "the map shows all 12 district labels");
      assert.ok(m.pairs <= 8, `${viewport.width}x${viewport.height}: the district labels rarely overlap, got ${m.pairs} pairs`);
      // A district stays tappable on the smaller map: use the path element so a report pin cannot take the click.
      await page.evaluate(() => document.querySelector(".leaflet-districts-pane path").dispatchEvent(new MouseEvent("click", { bubbles:true })));
      await page.locator("#distBack").waitFor({ state:"visible", timeout:10000 });
      const title = (await page.locator("#liTitle").textContent()).trim();
      assert.ok(title, "a district opens from the map");
      await page.locator("#distBack").click();
      await page.locator("#distBack").waitFor({ state:"hidden" });
      assert.deepEqual(errors, [], "no page errors");
      console.log(`${viewport.width}x${viewport.height} OK map=${Math.round(m.h)} labels=${m.labels} overlaps=${m.pairs} district=${title}`);
    } finally {
      await context.close();
    }
  }
  console.log("OK short viewports keep the district map tall and usable");
} finally {
  await browser.close();
}
