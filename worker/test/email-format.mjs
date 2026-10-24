import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";

const browser = await chromium.launch({ headless:true });

try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const page = await context.newPage();
  let sampleCalls = 0;
  await page.route("**/api/health", route => route.fulfill({ json:{ ai:true } }));
  await page.route("**/api/sample", route => {
    sampleCalls++;
    return route.fulfill({ json:{ title:"道路號誌故障", dept:"交通局", tags:["交通號誌"], category:"", district:"大安區",
      address:"信義路測試地點", reason:"測試 Email 格式", duplicate_of:null, duplicate_reason:"",
      spam:false, outside_taipei:false, too_vague:false } });
  });

  await page.goto(BASE, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#cName").fill("格式測試市民");
  await page.locator("#cPhone").fill("0912345678");
  await page.locator("#newText").fill("A 路口號誌故障，行人無法安全通過");
  await page.locator("#agree").check();

  for (const bad of ["a@b..com", "a@-b.com", "a@b-.com", "a@b.com.", "a@b", "a b@c.co"]) {
    await page.locator("#cEmail").fill(bad);
    await page.locator("#submitBtn").click();
    assert.equal(await page.locator("#cEmail").getAttribute("aria-invalid"), "true", `email "${bad}" is marked invalid`);
    assert.equal(await page.locator("#formErr").innerText(), "請填寫有效的 Email（本站不會寄送通知）");
    assert.equal(await page.evaluate(() => document.activeElement.id), "cEmail", `"${bad}" moves focus to the email field`);
  }
  assert.equal(sampleCalls, 0, "no preview for a malformed email");

  await page.locator("#cEmail").fill("citizen@example.com");
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  assert.match(await page.locator("#dupBox").innerText(), /確認送出前，請看一下 1999 的分類結果/);
  assert.equal(await page.locator("#cEmail").getAttribute("aria-invalid"), null, "a valid email clears the error mark");
  assert.equal(sampleCalls, 1, "a valid email reaches the preview");

  console.log("OK email format: domain labels with empty parts or edge hyphens are refused by the page");
} finally {
  await browser.close();
}
