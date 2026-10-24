import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.TITLE_TRUNCATE_BASE || "http://localhost:8985";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:390, height:844 } });
const page = await context.newPage();
let visitorToken = "", created = false;

try {
  await page.route("**/api/health", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ai:false }) }));
  await page.route("**/api/geocode*", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ lat:null }) }));
  await page.route("**/api/sample", route => route.fulfill({ status:500, contentType:"application/json", body:"{}" }));
  await page.goto(base, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  visitorToken = await page.evaluate(() => localStorage.getItem("tit-visitor"));
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#cName").fill("合成測試市民");
  await page.locator("#cPhone").fill("0912345678");
  await page.locator("#cEmail").fill("citizen@example.com");
  await page.locator("#agree").check();

  const maskedText = "a".repeat(38) + "0912-345-678";
  await page.locator("#newText").fill(maskedText);
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  const maskedTitle = await page.locator("#dupDetails dd").first().innerText();
  assert.equal(maskedTitle, "a".repeat(38), "the fallback title does not end with a partial mask marker");
  assert.doesNotMatch(maskedTitle, /［已/, "the mask marker is not cut");

  const emojiText = "b".repeat(39) + "😀";
  await page.locator("#newText").fill(emojiText);
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  const emojiTitle = await page.locator("#dupDetails dd").first().innerText();
  assert.equal(emojiTitle, emojiText, "the fallback title keeps a complete emoji at the cut");
  assert.ok(!/\p{Surrogate}/u.test(emojiTitle), "the fallback title has no lone surrogate");

  await page.locator('#dupBox [data-dup="new"]').click();
  await page.waitForFunction(() => document.querySelector("#newBox").hidden, null, { timeout:10000 });
  created = true;
  const snapshot = await (await fetch(base + "/api/db")).json(), visitorId = visitorToken.split(".")[0];
  const item = Object.values(snapshot.reports[visitorId].items).find(x => x.body === emojiText);
  assert.ok(item, "the report was stored");
  assert.equal(item.title, emojiText, "the stored title keeps the complete emoji");
  assert.ok(!/\p{Surrogate}/u.test(item.title), "the stored title has no lone surrogate");
  console.log("OK: fallback titles cut by code point and never split the mask marker");
} finally {
  if (created && visitorToken) {
    await fetch(base + "/api/db", { method:"POST", headers:{ "content-type":"application/json", "x-admin":"1" },
      body:JSON.stringify({ op:"delete", path:`reports/${visitorToken.split(".")[0]}`, data:{} }) }).catch(() => {});
  }
  await context.close();
  await browser.close();
}
