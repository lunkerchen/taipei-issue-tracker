import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8788";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:390, height:844 } });
const page = await context.newPage();
const adminHeaders = { "content-type":"application/json", "x-admin":"1" };
const runId = `focus-${Date.now().toString(36)}`;
let owner, caseId;

const activeId = () => page.evaluate(() => {
  const el = document.activeElement;
  return { id:el?.id || "", open:el?.dataset?.open || "", tag:el?.tagName || "" };
});

try {
  await page.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor"));
  const token = await page.evaluate(() => localStorage.getItem("tit-visitor"));
  owner = token.split(".")[0];
  caseId = `${owner}:${runId}`;
  const created = await fetch(`${base}/api/db`, {
    method:"POST", headers:{ "content-type":"application/json", "x-visitor":token },
    body:JSON.stringify({ op:"create-report", path:`reports/${owner}`, data:{
      key:runId,
      item:{ author:owner, createdAt:new Date().toISOString(), title:`焦點測試 ${runId}`, body:"補充焦點", district:"大安區",
        dept:"環保局", tags:["噪音"], status:"open", photos:[], notes:[] },
      contact:{ name:"合成市民", phone:"0912345678", email:"synthetic@example.com", realName:false }
    } })
  });
  assert.equal(created.status, 200, "seed case is created");

  await page.locator("#q").fill(runId);
  await page.waitForFunction(t => [...document.querySelectorAll("#list .title")].some(b => b.textContent.includes(t)), runId);
  await page.locator("#list .title").first().click();
  const note = page.locator(`textarea[id="note-${caseId}"]`);
  await note.waitFor({ state:"visible" });
  await note.fill("補充焦點測試內容");

  // A note submit by keyboard must keep focus in the note form, not drop it to body.
  const submit = page.locator(`[data-note="${caseId}"] button[type=submit]`);
  await submit.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#list")?.textContent.includes("補充焦點測試內容"));
  await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body);
  assert.equal((await activeId()).id, `note-${caseId}`, "note submit returns focus to the note form");

  // Admin status actions re-render the row; focus must move to the case title.
  await page.goto(`${base}/?admin=1#issues`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector("#navAdmin:not([hidden])"));
  await page.locator("#q").fill(runId);
  await page.waitForFunction(t => [...document.querySelectorAll("#list .title")].some(b => b.textContent.includes(t)), runId);
  await page.locator("#list .title").first().click();
  const progress = page.locator(`[data-status="progress"][data-id="${caseId}"]`);
  await progress.waitFor({ state:"visible" });
  await progress.focus();
  await page.keyboard.press("Enter");
  await page.locator(`[data-status="fixed"][data-id="${caseId}"]`).waitFor({ state:"visible" });
  await page.waitForFunction(id => document.activeElement?.dataset?.open === id, caseId, { timeout:3000 }).catch(() => {});
  assert.equal((await activeId()).open, caseId, "status change keeps focus on the case title");

  const reopen = page.locator(`[data-status="open"][data-id="${caseId}"]`);
  await reopen.focus();
  await page.keyboard.press("Enter");
  await page.locator(`[data-status="progress"][data-id="${caseId}"]`).waitFor({ state:"visible" });
  await page.waitForFunction(id => document.activeElement?.dataset?.open === id, caseId, { timeout:3000 }).catch(() => {});
  assert.equal((await activeId()).open, caseId, "reopening keeps focus on the case title");

  console.log("action-focus: ok");
} finally {
  if (caseId) {
    for (const path of [`triage/${caseId}`, `reports/${owner}`]) {
      await fetch(`${base}/api/db`, { method:"POST", headers:adminHeaders, body:JSON.stringify({ op:"delete", path }) }).catch(() => {});
    }
  }
  await browser.close();
}
