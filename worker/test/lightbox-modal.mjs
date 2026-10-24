// The photo lightbox must trap keyboard focus, lock background scrolling, and announce the photo count.
// Run: BASE=http://127.0.0.1:9008 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/lightbox-modal.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});
const write = (headers, path, data) => post("/api/db", headers, { op:"update", path, data });

const visitor = await (await post("/api/visitor", {})).json();
const [visitorId] = visitor.id.split(".");
const runId = crypto.randomUUID().slice(0, 8), key = "lightbox";
const id = `${visitorId}:${key}`, title = `燈箱焦點測試 ${runId}`;
const photos = [1, 2, 3].map(n => `${visitorId}/lightbox-${n}.jpg`);
assert.equal((await write({ "x-visitor":visitor.id }, `reports/${visitorId}`, { items:{ [key]:{
  title, body:`燈箱 modal 回歸 ${runId}`, createdAt:new Date().toISOString(), author:visitorId,
  dept:"1999 待分派", tags:[], photos, notes:[]
} } })).status, 200, "seed a case with three photos");
assert.equal((await write({ "x-admin":"1" }, `triage/${id}`, { status:"open" })).status, 200, "seed triage");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
try {
  for (const viewport of [{ width:1280, height:900 }, { width:390, height:844 }]) {
    const mobile = viewport.width < 500;
    const context = await browser.newContext({ viewport, isMobile:mobile, hasTouch:mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
    await page.goto(BASE + "/#issues", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden, null, { timeout:15000 });
    const titleButton = page.locator("#list button.title").filter({ hasText:title });
    await titleButton.waitFor({ state:"visible", timeout:15000 });
    await titleButton.click();
    const photoLinks = page.locator(`.issue:has(button.title:text-is("${title}")) .photos a`);
    await page.waitForFunction(t => {
      const b = [...document.querySelectorAll("#list button.title")].find(x => x.textContent.trim() === t);
      return !!b && b.closest(".issue").querySelectorAll(".photos a").length === 3;
    }, title);
    await photoLinks.first().click();
    await page.waitForFunction(() => document.getElementById("lb").open);
    await page.waitForTimeout(150);

    assert.equal(await page.locator("#lbCt").getAttribute("role"), "status", `${viewport.width}: the counter is a live region`);
    assert.equal(await page.locator("#lbCt").getAttribute("aria-live"), "polite", `${viewport.width}: the counter politely announces changes`);
    assert.equal((await page.locator("#lbCt").textContent()).trim(), "1 / 3", `${viewport.width}: the counter starts at the first photo`);

    // Tab and Shift+Tab must stay on the three controls, never on BODY.
    const seen = [];
    for (let n = 0; n < 6; n++) {
      await page.keyboard.press("Tab");
      seen.push(await page.evaluate(() => document.activeElement.id || document.activeElement.tagName));
    }
    assert.deepEqual(seen, ["lbNext", "lbClose", "lbPrev", "lbNext", "lbClose", "lbPrev"], `${viewport.width}: Tab wraps inside the lightbox`);
    await page.locator("#lbPrev").focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "lbClose", `${viewport.width}: Shift+Tab wraps backwards`);
    await page.locator("#lbClose").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "lbPrev", `${viewport.width}: Tab wraps forwards`);

    // Mouse wheel and a one-finger swipe must not move the case list behind the dialog.
    const before = await page.evaluate(() => scrollY);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => scrollY), before, `${viewport.width}: the wheel does not scroll the page behind the lightbox`);
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type:"touchStart", touchPoints:[{ x:195, y:600 }] });
      for (let y = 560; y >= 240; y -= 40) await cdp.send("Input.dispatchTouchEvent", { type:"touchMove", touchPoints:[{ x:195, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type:"touchEnd", touchPoints:[] });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => scrollY), before, "390: a touch swipe does not scroll the page behind the lightbox");
    }

    await page.locator("#lbNext").click();
    await page.waitForFunction(() => document.getElementById("lbCt").textContent.trim() === "2 / 3");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("lb").open);
    assert.equal(await page.evaluate(() => !!document.activeElement.closest(".photos")), true, `${viewport.width}: closing returns focus to the photo`);
    assert.deepEqual(errors, [], `${viewport.width}: no page errors`);
    await context.close();
    console.log(viewport.width + " OK");
  }
  console.log("OK lightbox modal focus, scroll lock, and live counter");
} finally {
  await browser.close();
}
