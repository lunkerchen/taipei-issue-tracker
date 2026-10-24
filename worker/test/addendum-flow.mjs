import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";
const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});
const write = (token, op, path, data) => post("/api/db", { "x-visitor":token }, { op, path, data });

const snapshot = await (await fetch(BASE + "/api/db")).json();
const publicTarget = Object.entries(snapshot.reports?.["demo-seed"]?.items || {}).map(([id, item]) => ({
  id, item, triage:snapshot.triage?.[id] || {}
})).find(({ item, triage }) => (triage.status || "open") !== "fixed" && triage.hidden !== true &&
  !(item.flagged === true && triage.hidden !== false));
assert.ok(publicTarget, "the local seed has an open public case");

const visitor = await (await post("/api/visitor")).json();
const [visitorId] = visitor.id.split(".");
const mineKey = "addendum-flow-own-case";
assert.equal((await post("/api/contact", { "x-visitor":visitor.id }, { item:mineKey, name:"回歸測試", phone:"0912000000",
  email:"addendum@example.com", realName:false })).status, 200, "save contact before creating a case");
const own = { title:"補充流程測試者自己的案件", body:`本機瀏覽器回歸 ${crypto.randomUUID()}`,
  createdAt:new Date().toISOString(), author:visitorId, dept:"1999 待分派", tags:[], photos:[], notes:[] };
assert.equal((await write(visitor.id, "update", `reports/${visitorId}`, { items:{ [mineKey]:own } })).status, 200,
  "create a private test case so the browser can start in My reports");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
const page = await context.newPage();
await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);

let photoCount = 0, holdPhoto = false, releasePhoto;
let photoStartedResolve;
let photoStarted = new Promise(resolve => { photoStartedResolve = resolve; });
let holdAddendumResponse = false, releaseAddendum;
let addendumStartedResolve;
let addendumStarted = new Promise(resolve => { addendumStartedResolve = resolve; });
const addendumWrites = [];
let loseFirstResponse = true;
let sampleCalls = 0;

try {
  await page.route("**/api/health", route => route.fulfill({ json:{ ai:true } }));
  await page.route("**/api/sample", route => {
    sampleCalls++;
    return route.fulfill({ json:{ title:"道路號誌故障", dept:"交通局", tags:["交通號誌"], category:"", district:"大安區",
      address:"信義路測試地點", reason:"測試重複分派", duplicate_of:publicTarget.item.n,
      duplicate_reason:"同一案件", spam:false, outside_taipei:false, too_vague:false } });
  });
  await page.route("**/api/photo", async route => {
    if (route.request().method() !== "POST") return route.continue();
    photoCount++;
    if (!holdPhoto) return route.continue();
    holdPhoto = false;
    const response = await route.fetch();
    photoStartedResolve();
    await new Promise(resolve => { releasePhoto = resolve; });
    return route.fulfill({ response });
  });
  await page.route("**/api/db", async route => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const body = request.postDataJSON();
    if (body.op !== "append-addendum") return route.continue();
    addendumWrites.push(body.data);
    if (holdAddendumResponse) {
      holdAddendumResponse = false;
      const response = await route.fetch();
      addendumStartedResolve();
      await new Promise(resolve => { releaseAddendum = resolve; });
      return route.fulfill({ response });
    }
    if (!loseFirstResponse) return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 200, "the server accepts the first addendum before the response is lost");
    if (addendumWrites.length === 1) return route.abort("failed");
    loseFirstResponse = false;
    return route.fulfill({ status:503, contentType:"application/json", body:JSON.stringify({ error:"upstream_error" }) });
  });

  await page.goto(BASE, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await page.locator('#nav [data-view="mine"]').click();
  await page.locator("#list button.title").filter({ hasText:own.title }).waitFor({ state:"visible" });
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#agree").check();
  await page.locator("#cName").fill("本機合成測試者");
  await page.locator("#cPhone").fill("0912345678");
  await page.locator("#cEmail").fill("citizen@example.com");

  const png = async (label, color) => {
    const data = await page.evaluate(async ({ label, color }) => {
      const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 60;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 80, 60);
      ctx.fillStyle = "white"; ctx.font = "12px sans-serif"; ctx.fillText(label, 4, 30);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }, { label, color });
    return { name:`${label}.png`, mimeType:"image/png", buffer:Buffer.from(data, "base64") };
  };
  const previewDuplicate = async text => {
    await page.locator("#newText").fill(text);
    await page.locator("#submitBtn").click();
    await page.locator("#dupBox [data-dup=add]").waitFor({ state:"visible", timeout:10000 });
  };
  const addPhoto = async (label, color) => {
    await page.locator("#photoIn").setInputFiles(await png(label, color));
    await page.locator("#photoPrev img").last().waitFor({ state:"visible", timeout:10000 });
  };

  // An edit while a photo request is pending invalidates the preview and prevents a stale write.
  await addPhoto("edited-draft", "#ad3434");
  await previewDuplicate("補充照片上傳期間修改文字，不能送出舊草稿");
  holdPhoto = true;
  photoStarted = new Promise(resolve => { photoStartedResolve = resolve; });
  await page.locator('#dupBox [data-dup="add"]').click();
  await photoStarted;
  await page.locator("#newText").fill("改過的新草稿應保留在表單裡");
  releasePhoto();
  await page.getByText("內容已更新，請重新預覽通報", { exact:true }).waitFor({ state:"visible", timeout:10000 });
  assert.equal(addendumWrites.length, 0, "editing during upload prevents the stale addendum write");
  assert.equal(await page.locator("#newText").inputValue(), "改過的新草稿應保留在表單裡");

  // Cancel during the next photo upload. The late upload response cannot write or clear the draft.
  await addPhoto("cancelled-draft", "#2467a6");
  await previewDuplicate("取消中的補充不能在背景寫入");
  holdPhoto = true;
  photoStarted = new Promise(resolve => { photoStartedResolve = resolve; });
  await page.locator('#dupBox [data-dup="add"]').click();
  await photoStarted;
  await page.locator("#cancelBtn").click();
  await page.locator("#newBox").waitFor({ state:"hidden" });
  releasePhoto();
  await page.waitForFunction(() => !document.querySelector("#submitBtn").disabled);
  assert.equal(addendumWrites.length, 0, "cancel during upload prevents the addendum write");
  assert.equal(await page.locator("#newText").inputValue(), "取消中的補充不能在背景寫入", "cancel keeps the current draft text");

  // Reopen from My reports and lose both the first response and the shim's automatic retry response.
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#newText").fill("路口號誌故障補充現場照片，車流仍受阻");
  await addPhoto("same-attempt", "#39834b");
  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup="add"]').waitFor({ state:"visible", timeout:10000 });
  const photosBeforeUpload = photoCount;
  await page.locator('#dupBox [data-dup="add"]').click();
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("連不上伺服器"), null, { timeout:12000 });
  assert.equal(photoCount, photosBeforeUpload + 1, "the initial supplement uploads the selected photo once");
  const uploadedPhotoCount = photoCount;
  assert.equal(addendumWrites.length, 2, "the shim made one automatic retry after the first response was lost");
  assert.deepEqual(addendumWrites[1], addendumWrites[0], "automatic retry uses the same attempt id and uploaded photo keys");
  assert.equal(photoCount, uploadedPhotoCount, "the addendum write retry does not upload the photo again");

  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup=add]').waitFor({ state:"visible", timeout:10000 });
  holdAddendumResponse = true;
  addendumStarted = new Promise(resolve => { addendumStartedResolve = resolve; });
  await page.locator('#dupBox [data-dup="add"]').click();
  await addendumStarted;
  await page.locator("#newText").fill("寫入等待時的新草稿必須保留");
  assert.equal(await page.locator("#cancelBtn").isDisabled(), true, "cancel is locked while the server write is in flight");
  releaseAddendum();
  await page.getByText("補充已送出；目前修改中的內容已保留", { exact:true }).waitFor({ state:"visible", timeout:10000 });
  assert.equal(addendumWrites.length, 3, "a manual re-preview retries the same addendum");
  assert.deepEqual(addendumWrites[2], addendumWrites[0], "manual retry uses the same addendum id and photo keys");
  assert.equal(photoCount, uploadedPhotoCount, "manual retry does not upload the same photo again");
  assert.equal(await page.locator("#newBox").isVisible(), true, "success does not clear the edited draft");
  assert.equal(await page.locator("#newText").inputValue(), "寫入等待時的新草稿必須保留");

  const saved = (await (await fetch(BASE + "/api/db")).json()).addenda?.[visitorId]?.items || {};
  const matches = Object.values(saved).filter(item => item.target === publicTarget.id && item.text === addendumWrites[0].text);
  assert.equal(matches.length, 1, "the lost response and both retries leave one stored addition");
  assert.deepEqual(matches[0].photos, addendumWrites[0].photos, "the stored addition keeps the first uploaded photo keys");
  assert.ok(sampleCalls >= 4, "edit, cancel, and retry each used a fresh preview");

  if (EVIDENCE_DIR) {
    await mkdir(EVIDENCE_DIR, { recursive:true });
    await page.screenshot({ path:`${EVIDENCE_DIR}/addendum-flow-success.png`, fullPage:true });
  }
  console.log("OK addendum edit/cancel guards, automatic and manual retry idempotency, and photo reuse");
} finally {
  await context.close();
  await browser.close();
}
