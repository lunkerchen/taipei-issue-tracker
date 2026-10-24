import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.REPORT_SENDING_BASE || "http://localhost:8981";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:390, height:844 } });
const page = await context.newPage();
let releaseCreate, markCreateStarted;
const createGate = new Promise(resolve => { releaseCreate = resolve; });
const createStarted = new Promise(resolve => { markCreateStarted = resolve; });
let visitorToken = "", created = null;

try {
  await page.route("**/api/sample", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({
    title:"送出路燈通報", dept:"工務局", tags:["路燈"], category:"", district:"大安區", address:"信義路測試點",
    reason:"測試固定分類", duplicate_of:null, duplicate_reason:"", spam:false, outside_taipei:false, too_vague:false
  }) }));
  await page.route("**/api/health", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ai:true }) }));
  await page.route("**/api/geocode*", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ lat:null }) }));
  await page.route("**/api/db", async route => {
    const req = route.request(), body = req.method() === "POST" && req.postDataJSON();
    if (body && body.op === "create-report") {
      created = body;
      markCreateStarted();
      await createGate;
    }
    await route.continue();
  });

  await page.goto(base, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  visitorToken = await page.evaluate(() => localStorage.getItem("tit-visitor"));
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#cName").fill("合成測試市民");
  await page.locator("#cPhone").fill("0912345678");
  await page.locator("#cEmail").fill("citizen@example.com");
  await page.locator("#newText").fill("A 送出路燈故障，夜間行人危險");
  await page.locator("#agree").check();
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  await page.locator('#dupBox [data-dup="new"]').click();

  await createStarted;
  assert.equal(await page.locator("#newStatus").innerText(), "送出中…", "a held report request shows a sending status");
  assert.equal(await page.locator("#submitBtn").isDisabled(), true, "the form cannot be submitted twice while sending");
  assert.equal(await page.locator("#cancelBtn").isDisabled(), true, "the form cannot be cancelled while sending");

  releaseCreate();
  await page.waitForFunction(() => document.querySelector("#newBox").hidden, null, { timeout:10000 });
  assert.equal(await page.locator("#newStatus").innerText(), "", "the sending status is cleared after success");
  assert.ok(created, "the report was sent");
  console.log("OK: a report shows a sending status while the request is in flight");
} finally {
  if (created && visitorToken) {
    await fetch(`${base}/api/db`, { method:"POST", headers:{ "content-type":"application/json", "x-visitor":visitorToken },
      body:JSON.stringify({ op:"delete", path:`reports/${visitorToken.split(".")[0]}`, data:{} }) }).catch(() => {});
  }
  await context.close();
  await browser.close();
}
