import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";

const browser = await chromium.launch({ headless:true });

try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });

  const placeholder = await page.locator("#cEmail").getAttribute("placeholder");
  assert.ok(placeholder.includes("不寄"), `email placeholder says the site sends no notice: ${placeholder}`);
  assert.ok(!placeholder.includes("接收處理進度通知"), `email placeholder does not promise progress notices: ${placeholder}`);

  const contactText = await page.locator("#contactBox").innerText();
  assert.ok(contactText.includes("本站目前不會寄送 Email 通知"), "the contact fieldset says the site sends no email notice");
  assert.ok(contactText.includes("我的陳情"), "the contact fieldset says where to read progress");

  await page.locator("#cName").fill("文案測試市民");
  await page.locator("#cPhone").fill("0912345678");
  await page.locator("#newText").fill("A 路口號誌故障，行人無法安全通過");
  await page.locator("#agree").check();
  await page.locator("#submitBtn").click();
  const status = await page.locator("#formErr").innerText();
  assert.equal(status, "請填寫有效的 Email（本站不會寄送通知）");
  assert.ok(!status.includes("通知處理進度"), "the email error does not promise progress notices");

  await page.locator("[data-doc=privacy]").first().click();
  await page.locator("#privacy").waitFor({ state:"visible" });
  const privacy = await page.locator("#privacy").innerText();
  assert.ok(privacy.includes("本站目前不會寄送 Email 或簡訊通知處理進度"),
    "the privacy notice says the site sends no email or text message notices");
  assert.ok(!privacy.includes("通知你案件處理進度"), "the privacy purpose does not promise progress notices");

  console.log("OK email copy: form, error message and privacy notice say the site sends no progress notices");
} finally {
  await browser.close();
}
