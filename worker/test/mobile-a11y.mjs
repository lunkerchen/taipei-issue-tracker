import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8788";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);

const rect = (page, selector) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height };
}, selector);

const overlayTop = page => page.evaluate(() => {
  const tops = [".ticker:not([hidden])", ".citizen .nav"].map(sel => document.querySelector(sel)?.getBoundingClientRect().top).filter(v => Number.isFinite(v));
  return tops.length ? Math.min(...tops) : innerHeight;
});

const hitInside = (page, selector) => page.evaluate(sel => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}, selector);

async function openForm(page) {
  if (await page.locator("#newBox").isVisible()) return;
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
}

async function openIssues(page) {
  await page.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => {
    const t = document.querySelector("#list")?.textContent || "";
    return !t.includes("正在載入陳情案件");
  });
}

try {
  for (const viewport of [{ width:320, height:568 }, { width:390, height:844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const tag = `${viewport.width}x${viewport.height}`;
    await openIssues(page);

    // H1: tabbing through the form must not leave the focused control under the fixed bars.
    await openForm(page);
    await page.locator("#newText").focus();
    let reachedCancel = false;
    for (let i = 0; i < 30 && !reachedCancel; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        if (el.closest(".vh") || r.width <= 1 || r.height <= 1) return { id:"", skip:true };
        const bars = Math.min(...[".ticker:not([hidden])", ".citizen .nav"].map(sel => document.querySelector(sel)?.getBoundingClientRect().top ?? Infinity));
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { id:el.id || el.dataset.dup || el.textContent.trim().slice(0, 12), top:r.top, bottom:r.bottom, bars, hitOk:!!hit && (hit === el || el.contains(hit)) };
      });
      if (!info || info.skip) continue;
      assert.ok(info.bottom <= info.bars + 1, `${tag} focused ${info.id} bottom ${info.bottom} above fixed bars ${info.bars}`);
      assert.ok(info.hitOk, `${tag} focused ${info.id} is clickable at its centre`);
      if (info.id === "cancelBtn") reachedCancel = true;
    }
    assert.ok(reachedCancel, `${tag} Tab reached the cancel button`);

    // H2: the duplicate repair action gets centred above the fixed bars from a fresh scroll position.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => showDup({ dup:{ n:1, title:"測試案件", reason:"" } }, "相同內容", false));
    await page.locator("[data-dup=add]").waitFor({ state:"visible" });
    await page.waitForTimeout(80);
    {
      const r = await rect(page, "[data-dup=add]"), bars = await overlayTop(page);
      assert.ok(r.top >= 0 && r.bottom <= bars + 1, `${tag} duplicate action bottom ${r.bottom} above fixed bars ${bars}`);
      assert.ok(await hitInside(page, "[data-dup=add]"), `${tag} duplicate action is clickable`);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.dup), "add", `${tag} duplicate action has focus`);
    }

    // M1: the error appears next to the field, inside the viewport above the bars.
    await page.locator("#cancelBtn").click();
    await openForm(page);
    await page.locator("#agree").check();
    await page.locator("#submitBtn").click();
    await page.locator("#formErr").waitFor({ state:"visible" });
    {
      const r = await rect(page, "#formErr"), bars = await overlayTop(page);
      assert.equal(await page.locator("#formErr").textContent(), "請描述你遇到的問題");
      assert.ok(r.top >= 0 && r.bottom <= bars + 1, `${tag} text error visible above bars (${r.top}-${r.bottom}, bars ${bars})`);
      assert.equal(await page.locator("#newText").getAttribute("aria-invalid"), "true");
      assert.equal(await page.locator("#newText").getAttribute("aria-errormessage"), "formErr");
      assert.equal(await page.evaluate(() => document.querySelector("#formErr").previousElementSibling?.id), "newText");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "newText");
    }
    await page.locator("#newText").fill("路燈不亮，已經三天");
    assert.equal(await page.locator("#newText").getAttribute("aria-invalid"), null, `${tag} typing clears the error`);
    await page.locator("#cName").fill("測試");
    await page.locator("#cPhone").fill("123");
    await page.locator("#cEmail").fill("test@example.com");
    await page.locator("#submitBtn").click();
    await page.locator("#formErr").waitFor({ state:"visible" });
    {
      const r = await rect(page, "#formErr"), bars = await overlayTop(page);
      assert.equal(await page.locator("#formErr").textContent(), "請填寫手機號碼（09 開頭共 10 碼）");
      assert.ok(r.top >= 0 && r.bottom <= bars + 1, `${tag} phone error visible above bars`);
      assert.equal(await page.locator("#cPhone").getAttribute("aria-invalid"), "true");
      assert.equal(await page.evaluate(() => document.querySelector("#formErr").previousElementSibling?.classList.contains("row")), true);
    }

    // M2: a close control is visible as soon as the privacy dialog opens, and the backdrop closes it.
    await page.locator("[data-doc=privacy]").first().click();
    await page.locator("#privacy[open]").waitFor();
    {
      const r = await rect(page, "#privacy .doc-close button");
      const viewportBottom = await page.evaluate(() => innerHeight);
      assert.ok(r.top >= 0 && r.bottom <= viewportBottom, `${tag} dialog close visible without scrolling`);
      assert.ok(await hitInside(page, "#privacy .doc-close button"), `${tag} dialog close is clickable`);
    }
    await page.locator("#privacy .doc-close button").click();
    assert.equal(await page.locator("#privacy").getAttribute("open"), null, `${tag} close button closes the dialog`);
    await page.locator("[data-doc=privacy]").first().click();
    await page.locator("#privacy[open]").waitFor();
    await page.mouse.click(4, 4);
    await page.waitForFunction(() => !document.querySelector("#privacy[open]"), null, { timeout:2000 }).catch(() => {});
    assert.equal(await page.locator("#privacy").getAttribute("open"), null, `${tag} backdrop click closes the dialog`);

    await context.close();
  }

  const reduced = await browser.newContext({ viewport:{ width:390, height:844 }, reducedMotion:"reduce" });
  const rp = await reduced.newPage();
  await openIssues(rp);
  assert.equal(await rp.evaluate(() => motionBehavior()), "auto", "reduced motion disables smooth scrolling");
  await reduced.close();
  console.log("mobile-a11y: ok");
} finally {
  await browser.close();
}
