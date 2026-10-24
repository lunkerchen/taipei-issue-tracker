import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8788";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
const page = await context.newPage();
const adminHeaders = { "content-type":"application/json", "x-admin":"1" };
const runId = `semantics-${Date.now().toString(36)}`;
let token, owner, createdId, seededId;

try {
  await page.route("**/api/sample", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({
    title:`語意測試 ${runId}`, dept:"工務局", tags:["噪音"], category:"", district:"大安區", address:"",
    reason:"測試固定分類", duplicate_of:null, duplicate_reason:"", spam:false, outside_taipei:false, too_vague:false
  }) }));
  await page.route("**/api/geocode*", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ lat:null }) }));

  await page.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor"));
  token = await page.evaluate(() => localStorage.getItem("tit-visitor"));
  owner = token.split(".")[0];

  assert.equal(await page.locator("main").count(), 1, "the page has exactly one main landmark");
  assert.equal(await page.locator("main#main #v-issues").count(), 1, "the views live inside main");
  assert.equal(await page.locator("main #demoTools").count(), 1, "the demo tools stay in main");
  assert.equal(await page.locator("main #privacy").count(), 0, "dialogs stay outside main");

  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.className), "skip", "Tab reaches the skip link first");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "main", "the skip link moves focus to main");

  await page.locator("#newBtn").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  assert.equal(await page.locator("#newForm").getAttribute("aria-label"), "新增陳情", "the report form has an accessible name");

  await page.locator("#newText").fill(`語意測試 ${runId} 人行道磚塊鬆動`);
  await page.locator("#cName").fill("合成市民");
  await page.locator("#cPhone").fill("0912345678");
  await page.locator("#cEmail").fill("synthetic@example.com");
  await page.locator("#agree").check();
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  const previewHeading = page.locator('#dupBox [role="heading"][aria-level="3"]');
  assert.match(await previewHeading.innerText(), /確認送出前/, "the preview starts with a level 3 heading");

  await page.locator("[data-dup=new]").click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已送出陳情"), null, { timeout:15000 });
  assert.equal(await page.locator("#toast").getAttribute("role"), "status", "the success message is a live status");
  createdId = await page.evaluate(() => document.activeElement?.dataset?.open || "");
  assert.match(createdId, new RegExp(`^${owner}:`), "focus lands on the case that was just filed");

  seededId = `${owner}:${runId}`;
  const seeded = await fetch(`${base}/api/db`, {
    method:"POST", headers:{ "content-type":"application/json", "x-visitor":token },
    body:JSON.stringify({ op:"create-report", path:`reports/${owner}`, data:{
      key:runId,
      item:{ author:owner, createdAt:new Date().toISOString(), title:`地圖語意 ${runId}`, body:"小地圖語意測試", district:"大安區",
        dept:"工務局", tags:["噪音"], status:"open", lat:25.033, lng:121.565, photos:[], notes:[] },
      contact:{ name:"合成市民", phone:"0912345678", email:"synthetic@example.com", realName:false }
    } })
  });
  assert.equal(seeded.status, 200, "the map case is seeded");

  await page.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(t => [...document.querySelectorAll("#list .title")].some(b => b.textContent.includes(t)), runId);
  await page.locator("#q").fill(runId);
  await page.locator("#list .title").first().click();
  const minimap = page.locator('#list .minimap[role="group"]').first();
  await minimap.waitFor({ state:"visible" });
  assert.equal(await minimap.getAttribute("aria-label"), "陳情位置地圖（唯讀）", "the read-only map is a named group");
  assert.equal(await page.locator('#list [role="img"] a').count(), 0, "no interactive links sit inside an image role");

  console.log("a11y-semantics: ok");
} finally {
  for (const id of [createdId, seededId]) {
    if (!id) continue;
    await fetch(`${base}/api/db`, { method:"POST", headers:adminHeaders, body:JSON.stringify({ op:"delete", path:`triage/${id}` }) }).catch(() => {});
  }
  if (owner) await fetch(`${base}/api/db`, { method:"POST", headers:adminHeaders, body:JSON.stringify({ op:"delete", path:`reports/${owner}` }) }).catch(() => {});
  await browser.close();
}
