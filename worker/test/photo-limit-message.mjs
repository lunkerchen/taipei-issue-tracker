import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PHOTO_LIMIT_BASE || "http://localhost:8982";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:390, height:844 } });
const page = await context.newPage();

try {
  await page.goto(base, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });

  const small = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"); g.fillStyle = "#36c"; g.fillRect(0, 0, 64, 64);
    return c.toDataURL("image/jpeg", .8).split(",")[1];
  });
  const file = n => ({ name:`photo-${n}.jpg`, mimeType:"image/jpeg", buffer:Buffer.from(small, "base64") });
  await page.locator("#photoIn").setInputFiles([file(1), file(2), file(3), file(4)]);
  await page.waitForFunction(() => document.querySelectorAll("#photoPrev figure").length === 3, null, { timeout:10000 });
  assert.equal(await page.locator("#photoStatus").innerText(), "最多 3 張照片，其餘未加入", "the fourth photo is reported, not silently dropped");

  while (await page.locator("[data-rmshot]").count()) await page.locator("[data-rmshot]").first().click();
  assert.equal(await page.locator("#photoPrev figure").count(), 0);

  const noise = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = c.height = 2000;
    const g = c.getContext("2d"), img = g.createImageData(2000, 2000);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = Math.random() * 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = Math.random() * 255; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 1).split(",")[1];
  });
  await page.locator("#photoIn").setInputFiles({ name:"too-large.jpg", mimeType:"image/jpeg", buffer:Buffer.from(noise, "base64") });
  await page.waitForFunction(() => document.querySelector("#photoStatus").textContent.includes("照片太大"), null, { timeout:20000 });
  assert.equal(await page.locator("#photoPrev figure").count(), 0, "a photo that stays too large after compression is not added");
  assert.match(await page.locator("#photoStatus").innerText(), /照片太大/);
  console.log("OK: photo limit and oversized-photo failures have explicit messages");
} finally {
  await context.close();
  await browser.close();
}
