import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8913";

const launchOptions = { headless: true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);

const sampleNews = [
  { title: "北市府加強防汛整備 各抽水站完成試運轉", url: "https://example.com/1", source: "台北市政府", time: "2026-10-24T08:00:00Z" },
  { title: "大巨蛋周邊道路改善工程完工 改善塞車瓶頸", url: "https://example.com/2", source: "自由時報", time: "2026-10-24T09:00:00Z" },
  { title: "捷運信義線東延段最新進度公布 預計年底完工", url: "", source: "中央社", time: "2026-10-24T10:00:00Z" }
];

try {
  // Test 1: Desktop & mobile viewports
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const isMobile = viewport.width < 768;
    const context = await browser.newContext({
      viewport,
      isMobile,
      hasTouch: isMobile
    });
    const page = await context.newPage();
    const tag = `${viewport.width}x${viewport.height}`;

    // Mock news API to reliably return sample items
    await page.route("**/api/news", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: sampleNews })
    }));

    await page.goto(`${BASE}/#issues`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.querySelector("#ticker").hidden);

    // Verify pause/resume button exists
    const btn = page.locator("#tkPause");
    await btn.waitFor({ state: "visible", timeout: 5000 });
    assert.equal(await btn.getAttribute("aria-pressed"), "false", `${tag} initially aria-pressed is false`);
    assert.equal(await btn.getAttribute("aria-label"), "暫停新聞跑馬燈", `${tag} initial aria-label is 暫停新聞跑馬燈`);

    // Verify touch target size (at least 44x44 or minimum touch rules)
    const box = await btn.boundingBox();
    assert.ok(box, `${tag} button has bounding box`);
    assert.ok(box.width >= 43.5 && box.height >= 43.5, `${tag} button touch target >= 44px, got ${box.width}x${box.height}`);

    // Verify keyboard reachable
    await page.evaluate(() => document.activeElement?.blur());
    await btn.focus();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "tkPause", `${tag} keyboard can focus tkPause`);

    // In normal motion (desktop / mobile without reduced-motion), verify marquee moves then pauses
    const track = page.locator(".tk-track");
    await track.waitFor({ state: "visible", timeout: 3000 });

    // Click pause button
    await btn.click();
    assert.equal(await btn.getAttribute("aria-pressed"), "true", `${tag} aria-pressed becomes true after click`);
    assert.equal(await btn.getAttribute("aria-label"), "繼續播放新聞跑馬燈", `${tag} aria-label updates to 繼續播放新聞跑馬燈`);

    // Check localStorage saved
    const saved = await page.evaluate(() => localStorage.getItem("tit-ticker-paused"));
    assert.equal(saved, "1", `${tag} saved pause state in localStorage`);

    // Verify position does not change over 2 seconds while paused
    const getPos = () => page.evaluate(() => {
      const t = document.querySelector(".tk-track");
      if (!t) return null;
      return window.getComputedStyle(t).transform;
    });

    const pos1 = await getPos();
    await page.waitForTimeout(2000);
    const pos2 = await getPos();
    assert.equal(pos1, pos2, `${tag} marquee position does not change over 2 seconds when paused`);

    // Reload page and verify still paused
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.querySelector("#ticker").hidden);
    const btnReloaded = page.locator("#tkPause");
    await btnReloaded.waitFor({ state: "visible", timeout: 5000 });
    assert.equal(await btnReloaded.getAttribute("aria-pressed"), "true", `${tag} after reload aria-pressed is still true`);
    assert.equal(await btnReloaded.getAttribute("aria-label"), "繼續播放新聞跑馬燈", `${tag} after reload aria-label is 繼續播放新聞跑馬燈`);

    const posAfterReload1 = await getPos();
    await page.waitForTimeout(2000);
    const posAfterReload2 = await getPos();
    assert.equal(posAfterReload1, posAfterReload2, `${tag} marquee position still frozen after reload`);

    // Resume playback
    await btnReloaded.click();
    assert.equal(await btnReloaded.getAttribute("aria-pressed"), "false", `${tag} resumed aria-pressed is false`);
    assert.equal(await btnReloaded.getAttribute("aria-label"), "暫停新聞跑馬燈", `${tag} resumed aria-label is 暫停新聞跑馬燈`);
    assert.equal(await page.evaluate(() => localStorage.getItem("tit-ticker-paused")), null, `${tag} localStorage cleared or 0`);

    await context.close();
  }

  // Test 2: Reduced motion mode
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce"
    });
    const page = await context.newPage();

    await page.route("**/api/news", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: sampleNews })
    }));

    await page.goto(`${BASE}/#issues`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.querySelector("#ticker").hidden);

    const btn = page.locator("#tkPause");
    await btn.waitFor({ state: "visible", timeout: 5000 });

    // Under reduced motion, items rotate statically. Pause it.
    await btn.click();
    assert.equal(await btn.getAttribute("aria-pressed"), "true", "reduced-motion aria-pressed is true");

    const getHeadline = () => page.evaluate(() => document.querySelector("#tkView")?.textContent?.trim() || "");
    const headlineInitial = await getHeadline();

    // In reduced-motion mode rotation is every 5 seconds. Wait 6 seconds and ensure unchanged.
    await page.waitForTimeout(6000);
    const headlineAfter6s = await getHeadline();
    assert.equal(headlineInitial, headlineAfter6s, "reduced-motion static rotation remains unchanged for 6 seconds while paused");

    // Resume and wait 6 seconds to verify it rotates
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(0, 0);
    await btn.click();
    assert.equal(await btn.getAttribute("aria-pressed"), "false", "reduced-motion resumed aria-pressed is false");
    // Move mouse away and remove focus so :hover / :focus-within don't hold the headline
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(0, 0);
    // Wait slightly more than 5s for rotation
    await page.waitForTimeout(5500);
    const headlineRotated = await getHeadline();
    assert.notEqual(headlineInitial, headlineRotated, "reduced-motion resumed static rotation advances headline after 5s");

    await context.close();
  }

  console.log("OK ticker-pause passed all checks");
} finally {
  await browser.close();
}
