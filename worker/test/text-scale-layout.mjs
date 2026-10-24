import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8788";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);

const measure = page => page.evaluate(() => {
  const box = el => { const r = el.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height }; };
  const nav = document.querySelector("#nav"), tick = document.querySelector("#ticker");
  const cards = [...document.querySelectorAll("#list .issue")];
  const last = cards.at(-1);
  const lab = tick.querySelector(".lab");
  const root = getComputedStyle(document.documentElement);
  return {
    innerW:innerWidth, innerH:innerHeight, docW:document.documentElement.scrollWidth,
    scrollY, maxScroll:document.documentElement.scrollHeight - innerHeight,
    nav:box(nav), navVar:parseFloat(root.getPropertyValue("--navh")) || 0,
    tick:tick.hidden ? null : box(tick), tkhVar:parseFloat(root.getPropertyValue("--tkh")) || 0,
    labH:lab && lab.getClientRects().length ? lab.getBoundingClientRect().height : 0,
    tabs:[...nav.querySelectorAll("button")].filter(b => b.getClientRects().length).map(box),
    wrapPad:parseFloat(getComputedStyle(document.querySelector("#wrap")).paddingBottom) || 0,
    last:last ? box(last) : null,
  };
});

try {
  for (const viewport of [{ width:390, height:844 }, { width:320, height:568 }]) {
    const context = await browser.newContext({ viewport, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
    const page = await context.newPage();
    const tag = `${viewport.width}x${viewport.height}`;
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));

    await page.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => {
      const t = document.querySelector("#list")?.textContent || "";
      return !t.includes("正在載入陳情案件");
    });
    await page.evaluate(() => {
      newsItems = [{ title:"測試新聞：放大字級時底部工具列不應蓋住內容", url:"", source:"test", date:"" }];
      drawTicker();
    });
    await page.locator("#ticker").waitFor({ state:"visible" });
    await page.waitForTimeout(120);

    for (const mode of ["normal", "200%"]) {
      if (mode === "200%") {
        await page.addStyleTag({ content:"html{-webkit-text-size-adjust:200%;text-size-adjust:200%}" });
        await page.waitForTimeout(250);
      }
      let m = await measure(page);
      const label = `${tag} ${mode}`;
      assert.equal(m.innerW, viewport.width, `${label} layout viewport stays ${viewport.width} (got ${m.innerW})`);
      assert.ok(m.docW <= viewport.width + 1, `${label} no horizontal overflow (document ${m.docW})`);
      assert.ok(m.nav.height >= 56, `${label} nav has a usable height`);
      assert.ok(m.nav.bottom <= m.innerH + 1 && m.nav.top >= 0, `${label} nav is on screen`);
      for (const tab of m.tabs) {
        assert.ok(tab.left >= -1 && tab.right <= viewport.width + 1, `${label} tab [${tab.left.toFixed(1)}, ${tab.right.toFixed(1)}] fits the screen`);
      }
      assert.ok(m.tick, `${label} ticker is visible`);
      assert.ok(m.tick.bottom <= m.nav.top + 1, `${label} ticker sits above the nav (ticker ${m.tick.bottom.toFixed(1)}, nav ${m.nav.top.toFixed(1)})`);
      assert.ok(m.tick.height >= m.labH, `${label} ticker label is not clipped (bar ${m.tick.height.toFixed(1)}, label ${m.labH.toFixed(1)})`);
      assert.ok(Math.abs(m.navVar - m.nav.height) <= 1, `${label} --navh ${m.navVar} matches nav ${m.nav.height.toFixed(1)}`);
      assert.ok(Math.abs(m.tkhVar - m.tick.height) <= 1, `${label} --tkh ${m.tkhVar} matches ticker ${m.tick.height.toFixed(1)}`);
      assert.ok(m.wrapPad >= m.nav.height + m.tick.height, `${label} content padding ${m.wrapPad.toFixed(1)} clears both bars`);

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);
      m = await measure(page);
      assert.ok(m.maxScroll > 200, `${label} page scrolls`);
      assert.ok(m.last, `${label} has issue cards`);
      assert.ok(m.last.bottom <= m.tick.top + 1, `${label} last card ends above the ticker (card ${m.last.bottom.toFixed(1)}, ticker ${m.tick.top.toFixed(1)})`);

      // A control placed under the fixed bars must scroll above them when it gets keyboard focus.
      const focused = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll("#list [data-open]")].filter(b => b.getClientRects().length);
        const target = buttons[Math.floor(buttons.length / 2)];
        document.activeElement?.blur();
        const tick = document.querySelector("#ticker").getBoundingClientRect();
        window.scrollTo(0, target.getBoundingClientRect().top + scrollY - (tick.top + 20));
        const placed = target.getBoundingClientRect().top;
        target.focus();
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
          const live = document.querySelector(`[data-open="${CSS.escape(target.dataset.open)}"]`);
          const r = live.getBoundingClientRect(), t = document.querySelector("#ticker").getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.bottom - 2, innerHeight - 1));
          resolve({ placed, top:r.top, bottom:r.bottom, tickTop:t.top, hitOk:!!hit && (hit === live || live.contains(hit)),
            scrollPad:parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0 });
        })));
      });
      assert.ok(focused.placed > focused.tickTop, `${label} focus check starts under the ticker`);
      assert.ok(focused.bottom <= focused.tickTop + 1, `${label} focused card stays above the ticker (bottom ${focused.bottom.toFixed(1)}, ticker ${focused.tickTop.toFixed(1)})`);
      assert.ok(focused.hitOk, `${label} focused card is not covered`);
      assert.ok(focused.scrollPad >= m.nav.height + m.tick.height, `${label} scroll padding ${focused.scrollPad} covers both bars`);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(80);
      console.log(`${label} nav=${m.nav.height.toFixed(1)} ticker=${m.tick.height.toFixed(1)} pad=${m.wrapPad.toFixed(1)} last=${m.last.bottom.toFixed(1)}/${m.tick.top.toFixed(1)}`);
    }
    assert.deepEqual(errors, [], `${tag} no page errors`);
    await context.close();
  }
  console.log("OK mobile 200% text keeps the layout and the bottom bars usable");
} finally {
  await browser.close();
}
