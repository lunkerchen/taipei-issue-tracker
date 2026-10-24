import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8788";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);

try {
  const keyboardContext = await browser.newContext({ viewport:{ width:390, height:844 } });
  const keyboardPage = await keyboardContext.newPage();
  await keyboardPage.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await keyboardPage.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await keyboardPage.evaluate(() => document.activeElement?.blur());
  await keyboardPage.keyboard.press("c");
  await keyboardPage.locator("#newBox").waitFor({ state:"visible" });
  await keyboardPage.keyboard.press("Escape");
  await keyboardPage.locator("#newBox").waitFor({ state:"hidden" });
  await keyboardPage.waitForFunction(() => document.activeElement?.id === "navReport", null, { timeout:3000 }).catch(() => {});
  assert.equal(await keyboardPage.evaluate(() => document.activeElement?.id), "navReport", "Escape after the c shortcut returns focus to 通報");
  await keyboardContext.close();

  const narrowContext = await browser.newContext({ viewport:{ width:320, height:568 } });
  const narrowPage = await narrowContext.newPage();
  await narrowPage.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await narrowPage.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await narrowPage.locator("#navReport").click();
  await narrowPage.locator("#newBox").waitFor({ state:"visible" });
  await narrowPage.waitForTimeout(250);
  const layout = await narrowPage.evaluate(() => {
    const box = document.querySelector("#newBox").getBoundingClientRect();
    const label = document.querySelector('label[for="newText"]').getBoundingClientRect();
    const text = document.querySelector("#newText").getBoundingClientRect();
    return { boxTop:box.top, labelTop:label.top, textTop:text.top, textBottom:text.bottom, active:document.activeElement?.id, viewport:innerHeight };
  });
  assert.ok(layout.boxTop >= -1, `the form starts inside the viewport (top ${layout.boxTop})`);
  assert.ok(layout.labelTop >= 0, `the description heading is visible (top ${layout.labelTop})`);
  assert.equal(layout.active, "newText", "the description still has focus");
  assert.ok(layout.textTop >= 0 && layout.textBottom <= layout.viewport, "the focused description is visible");
  await narrowContext.close();

  console.log("form-open-focus: ok");
} finally {
  await browser.close();
}
