// Run only against the isolated local Worker started by browser.mjs.
// Run: PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright npm_config_offline=true BROWSER_TEST_PORT=8886 node worker/test/browser.mjs citizen-progress-card.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = (process.env.BASE || "http://127.0.0.1:8886").replace(/\/$/, "");
const baseUrl = new URL(BASE);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname), "fixtures may only be written to a local Worker");

const ADMIN = { "x-admin":"1" };
const id = randomUUID();
const keys = { progress:`progress-${id.slice(0, 10)}`, empty:`empty-${id.slice(0, 10)}`, merged:`merged-${id.slice(0, 10)}` };
const titles = { progress:`進度卡回歸 ${id.slice(0, 8)}`, empty:`沒有後續紀錄 ${id.slice(0, 8)}`, merged:`修繕完成回歸 ${id.slice(0, 8)}` };
const atDaysAgo = days => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const post = (path, headers = {}, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});
const dbWrite = (headers, op, path, data) => post("/api/db", headers, { op, path, data });
const mint = async () => {
  const response = await post("/api/visitor");
  assert.equal(response.status, 200, "mint a local visitor identity");
  const { id:token } = await response.json();
  return { token, owner:token.split(".")[0] };
};
const createCase = async (visitor, key, title, createdAt, dept) => {
  const response = await dbWrite({ "x-visitor":visitor.token }, "create-report", `reports/${visitor.owner}`, {
    key,
    contact:{ name:"合成測試者", phone:"0912000000", email:`${key}@example.invalid`, realName:false },
    item:{ title, body:`這是隔離 Worker 的合成測試案件：${title}。`, createdAt, author:visitor.owner,
      dept, district:"大安區", tags:["道路"], photos:[], notes:[] }
  });
  assert.equal(response.status, 200, `create the local test case ${key}`);
};
const deleteDoc = path => dbWrite(ADMIN, "delete", path, {}).catch(() => {});
const fmtDate = date => new Intl.DateTimeFormat("zh-TW", {
  year:"numeric", month:"long", day:"numeric", timeZone:"Asia/Taipei"
}).format(new Date(date));

const owner = await mint(), supplementer = await mint();
const target = `${owner.owner}:${keys.progress}`, emptyTarget = `${owner.owner}:${keys.empty}`, mergedTarget = `${owner.owner}:${keys.merged}`;
const latestHandling = atDaysAgo(10), mergedHandling = atDaysAgo(2);
const noteText = `市民補充 ${id.slice(0, 8)}`;
const addendumText = `另一位市民補充 ${id.slice(0, 8)}`;

await createCase(owner, keys.progress, titles.progress, new Date().toISOString(), "工務局新工處");
await createCase(owner, keys.empty, titles.empty, new Date().toISOString(), "環保局");
await createCase(owner, keys.merged, titles.merged, new Date().toISOString(), "工務局新工處");
assert.equal((await dbWrite(ADMIN, "set", `triage/${target}`, {
  status:"progress", dept:"工務局新工處", events:[
    { t:atDaysAgo(20), type:"opened", by:"市民" },
    { t:atDaysAgo(16), type:"labeled", dept:"工務局新工處", by:"taipei-bot" },
    { t:atDaysAgo(14), type:"status", to:"progress", by:"工務局新工處" },
    { t:latestHandling, type:"pr", n:987654, title:"人行道修補", by:"工務局新工處" }
  ]
})).status, 200, "seed handling history in the local admin fixture");
assert.equal((await dbWrite(ADMIN, "set", `triage/${mergedTarget}`, {
  status:"fixed", dept:"工務局新工處", events:[
    { t:atDaysAgo(6), type:"opened", by:"市民" },
    { t:atDaysAgo(5), type:"status", to:"progress", by:"工務局新工處" },
    { t:atDaysAgo(3), type:"pr", n:987655, title:"路面修補", by:"工務局新工處" },
    { t:mergedHandling, type:"merged", pr:987655, by:"工務局新工處" }
  ]
})).status, 200, "seed a completed repair item");
// The second case intentionally has no triage document or post-opening event.
assert.equal((await dbWrite({ "x-visitor":owner.token }, "append-note", `reports/${owner.owner}`, {
  key:keys.progress, id:randomUUID(), text:noteText, photos:[]
})).status, 200, "append a recent note to the first case");
assert.equal((await dbWrite({ "x-visitor":supplementer.token }, "append-addendum", `addenda/${supplementer.owner}`, {
  id:randomUUID(), target, text:addendumText, photos:[]
})).status, 200, "append a recent addition from another citizen");

if (process.env.CITIZEN_PROGRESS_FIXTURE_ONLY === "1") {
  for (const path of [`reports/${owner.owner}`, `addenda/${supplementer.owner}`, `triage/${target}`, `triage/${emptyTarget}`, `triage/${mergedTarget}`])
    await deleteDoc(path);
  console.log("OK local progress card fixture: three cases, old handling event, recent note/addendum, and merged repair item");
  process.exit(0);
}

const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:375, height:812 }, isMobile:true, hasTouch:true });
await context.addInitScript(token => localStorage.setItem("tit-visitor", token), owner.token);
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));

try {
  await page.goto(`${BASE}/#mine`, { waitUntil:"domcontentloaded" });
  const progressTitle = page.locator(`#list [data-open="${target}"]`);
  await progressTitle.waitFor({ state:"visible", timeout:30000 });
  await progressTitle.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(target => document.querySelector(`[data-open="${CSS.escape(target)}"]`)?.getAttribute("aria-expanded") === "true", target);
  const progressDetail = progressTitle.locator("xpath=ancestor::div[contains(@class,'issue')]").locator(".detail");
  const progressCard = progressDetail.locator(".progress-card");
  await progressCard.waitFor({ state:"visible", timeout:10000 });

  const heading = progressCard.getByRole("heading");
  await heading.waitFor({ state:"visible" });
  assert.match((await heading.innerText()).trim(), /^處理進度/, "the citizen progress card has a clear heading");
  assert.match(await progressCard.innerText(), /示範紀錄/, "the card identifies its example handling information as a demo");
  assert.match(await progressCard.locator(".progress-status").innerText(), /處理中/, "the card explains the current status in citizen language");
  assert.match(await progressCard.locator(".progress-dept").innerText(), /工務局新工處/, "the card names the example responsible department");
  const latestText = await progressCard.locator(".progress-latest").innerText();
  assert.match(latestText, /人行道修補|修繕單/, "the card summarizes the latest handling activity");
  assert.ok(latestText.includes(fmtDate(latestHandling)), `the handling date is ${fmtDate(latestHandling)}, even after recent citizen additions; got: ${latestText}`);
  assert.ok(!latestText.includes(noteText) && !latestText.includes(addendumText), "citizen additions remain separate from the latest handling activity");
  assert.match(await progressCard.locator(".progress-idle").innerText(), /\d+ 天前/, "the handling age still reflects the old event after recent additions");
  assert.doesNotMatch(await progressCard.innerText(), /\bETA\b|預計|預估/, "the card does not invent an estimated completion date");

  const timeline = progressDetail.locator(".tl");
  await timeline.waitFor({ state:"visible" });
  assert.ok(await timeline.locator(".ev").count() >= 4, "the detailed event timeline remains available below the card");
  assert.ok((await progressDetail.locator(".addl").allInnerTexts()).some(text => text.includes(noteText)), "the reporter's note remains separate");
  assert.ok((await progressDetail.locator(".addl").allInnerTexts()).some(text => text.includes(addendumText)), "another citizen's addition remains separate");
  assert.match(await progressDetail.locator(".tl .pr .pill").innerText(), /尚未完成/, "an open repair item uses citizen language");
  const progressIssue = progressTitle.locator("xpath=ancestor::div[contains(@class,'issue')]");
  assert.doesNotMatch(await progressIssue.innerText(), /\b(?:Open|Merged|Closes|stale)\b/, "the whole citizen case card does not expose engineering status terms");

  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive:true });
    await progressDetail.screenshot({ path:`${process.env.ARTIFACT_DIR}/citizen-progress-card-375.png`, animations:"disabled" });
  }

  const focused = await page.evaluate(() => ({
    activeIsExpandedCase:document.activeElement?.matches("[data-open]") && document.activeElement.getAttribute("aria-expanded") === "true",
    innerWidth, documentWidth:document.documentElement.scrollWidth,
    cardRight:document.querySelector(".progress-card")?.getBoundingClientRect().right
  }));
  assert.ok(focused.activeIsExpandedCase, "keyboard activation keeps focus on the expanded case control");
  assert.ok(focused.documentWidth <= 375, `375px: no horizontal overflow (document ${focused.documentWidth})`);
  assert.ok(focused.cardRight <= 376, `375px: progress card fits in the viewport (right edge ${focused.cardRight})`);

  await page.addStyleTag({ content:"html{-webkit-text-size-adjust:200%;text-size-adjust:200%}" });
  await page.waitForTimeout(100);
  const zoomed = await page.evaluate(() => ({ innerWidth, documentWidth:document.documentElement.scrollWidth,
    cardRight:document.querySelector(".progress-card")?.getBoundingClientRect().right }));
  assert.equal(zoomed.innerWidth, 375, "text scaling keeps the 375px layout viewport");
  assert.ok(zoomed.documentWidth <= 375, `200% text: no horizontal overflow (document ${zoomed.documentWidth})`);
  assert.ok(zoomed.cardRight <= 376, `200% text: progress card fits in the viewport (right edge ${zoomed.cardRight})`);

  const emptyTitle = page.locator(`#list [data-open="${emptyTarget}"]`);
  await emptyTitle.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(target => document.querySelector(`[data-open="${CSS.escape(target)}"]`)?.getAttribute("aria-expanded") === "true", emptyTarget);
  const emptyDetail = emptyTitle.locator("xpath=ancestor::div[contains(@class,'issue')]").locator(".detail");
  const emptyCard = emptyDetail.locator(".progress-card");
  await emptyCard.waitFor({ state:"visible", timeout:10000 });
  assert.equal((await emptyCard.locator(".progress-latest").innerText()).trim(), "尚無後續處理紀錄",
    "a case with only its opening event shows the no-follow-up fallback");

  const mergedTitle = page.locator(`#list [data-open="${mergedTarget}"]`);
  await mergedTitle.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(target => document.querySelector(`[data-open="${CSS.escape(target)}"]`)?.getAttribute("aria-expanded") === "true", mergedTarget);
  const mergedDetail = mergedTitle.locator("xpath=ancestor::div[contains(@class,'issue')]").locator(".detail");
  const mergedCard = mergedDetail.locator(".progress-card");
  await mergedCard.waitFor({ state:"visible", timeout:10000 });
  assert.match(await mergedDetail.locator(".tl .pr .pill").innerText(), /修繕單已完成/, "a merged repair item uses citizen wording");
  assert.doesNotMatch(await mergedTitle.locator("xpath=ancestor::div[contains(@class,'issue')]").innerText(),
    /\b(?:Open|Merged|Closes|stale)\b/, "the citizen view does not expose the merged engineering terms");

  // The demo admin keeps the existing engineering details in the full event timeline.
  await page.goto(`${BASE}/?admin#admin`, { waitUntil:"domcontentloaded" });
  await page.locator("#navAdmin").waitFor({ state:"visible", timeout:20000 });
  await page.locator('#nav [data-view="issues"]').click();
  await page.locator("#q").fill(titles.progress);
  const adminTitle = page.locator(`#list [data-open="${target}"]`);
  await adminTitle.waitFor({ state:"visible", timeout:10000 });
  await adminTitle.click();
  const adminDetail = adminTitle.locator("xpath=ancestor::div[contains(@class,'issue')]").locator(".detail");
  const adminTimeline = adminDetail.locator(".tl");
  await adminTimeline.waitFor({ state:"visible" });
  const adminTimelineText = await adminTimeline.innerText();
  assert.match(adminTimelineText, /Open/, "the admin timeline keeps the pull request Open label");
  assert.match(adminTimelineText, /Closes #\d+/, "the admin timeline keeps the pull request's Closes reference");
  assert.match(adminTimelineText, /stale/, "the admin timeline still marks an old case as stale after notes and addenda");
  await page.locator("#tabClosed").click();
  await page.locator("#q").fill(titles.merged);
  const adminMergedTitle = page.locator(`#list [data-open="${mergedTarget}"]`);
  await adminMergedTitle.waitFor({ state:"visible", timeout:10000 });
  await adminMergedTitle.click();
  const adminMergedTimeline = adminMergedTitle.locator("xpath=ancestor::div[contains(@class,'issue')]").locator(".detail .tl");
  await adminMergedTimeline.waitFor({ state:"visible" });
  assert.match(await adminMergedTimeline.innerText(), /Merged/, "the admin timeline keeps the Merged label");

  assert.deepEqual(errors, [], "the browser produced no page errors");
  console.log("OK citizen progress card separates handling date from notes/addenda, preserves fallback, language, timeline, focus, and narrow layout");
} finally {
  await context.close();
  await browser.close();
  for (const path of [
    `reports/${owner.owner}`, `addenda/${supplementer.owner}`,
    `triage/${target}`, `triage/${emptyTarget}`, `triage/${mergedTarget}`
  ]) await deleteDoc(path);
}
