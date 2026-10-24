import assert from "node:assert/strict";

const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightModule);
const base = process.env.REPORT_ERROR_FOCUS_BASE || "http://localhost:8813";
const visitorId = "a".repeat(16);
const token = `${visitorId}.${"b".repeat(64)}`;
const classification = {
  title:"路口標線褪色", dept:"交通局", tags:["道路"], category:"", district:"大安區", address:"",
  reason:"合成測試分類", duplicate_of:null, duplicate_reason:"", spam:false, outside_taipei:false, too_vague:false
};
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function makeHarness({ writeStatuses = [200], photoStatus = 200, holdFirstWrite = false } = {}) {
  const context = await browser.newContext({ viewport:{ width:640, height:900 }, locale:"zh-TW" });
  const page = await context.newPage();
  const apiWrites = [], reportWrites = [], photos = [], pageErrors = [];
  const writeStarted = deferred(), writeGate = deferred();
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) apiWrites.push({ method, path:url.pathname, mocked:true });
    if (url.pathname === "/api/visitor" && method === "POST")
      return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ id:token }) });
    if (url.pathname === "/api/health" && method === "GET")
      return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ai:true }) });
    if (url.pathname === "/api/db" && method === "GET")
      return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ _seq:0 }) });
    if (url.pathname === "/api/db" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(body.op, "create-report", "only mocked report creation is allowed in this browser test");
      reportWrites.push(body);
      writeStarted.resolve();
      if (holdFirstWrite && reportWrites.length === 1) await writeGate.promise;
      const status = writeStatuses[Math.min(reportWrites.length - 1, writeStatuses.length - 1)] ?? 200;
      if (status !== 200) return route.fulfill({ status, contentType:"application/json", body:JSON.stringify({ error:"mock_report_rejected" }) });
      const document = { items:{ [body.data.key]:body.data.item } };
      return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ok:true, created:true, seq:reportWrites.length, data:document }) });
    }
    if (url.pathname === "/api/sample" && method === "POST")
      return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify(classification) });
    if (url.pathname === "/api/photo" && method === "POST") {
      photos.push({ mocked:true, status:photoStatus });
      return route.fulfill({ status:photoStatus, contentType:"application/json", body:JSON.stringify(photoStatus === 200 ? { key:`${visitorId}/mock-photo.jpg` } : { error:"mock_photo_rejected" }) });
    }
    if (["GET", "HEAD", "OPTIONS"].includes(method))
      return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({}) });
    return route.fulfill({ status:405, contentType:"application/json", body:JSON.stringify({ error:"unmocked_write_blocked" }) });
  });
  await page.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(expected => localStorage.getItem("tit-visitor") === expected && typeof canWrite !== "undefined" && canWrite && me === expected.slice(0, 16) && !document.querySelector("#navReport").hidden, token);
  return { context, page, apiWrites, reportWrites, photos, pageErrors, writeStarted:writeStarted.promise, releaseWrite:writeGate.resolve };
}

async function openForm(page) {
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
}

async function fillForm(page, suffix = "A") {
  await page.locator("#cName").fill(`合成市民${suffix}`);
  await page.locator("#cPhone").fill("0912345678");
  await page.locator("#cEmail").fill("citizen@example.com");
  await page.locator("#newText").fill("大安區和平東路測試草稿：路口標線褪色，行人過街不清楚。");
  await page.locator("#agree").check();
}

async function previewAndConfirmByKeyboard(page) {
  await page.locator("#submitBtn").focus();
  await page.keyboard.press("Enter");
  await page.locator('#dupBox [data-dup="new"]').waitFor({ state:"visible" });
  await page.waitForFunction(() => document.activeElement.matches('#dupBox [data-dup="new"]'));
  await page.keyboard.press("Enter");
}

async function assertMockedOnly(harness) {
  assert.ok(harness.apiWrites.every(write => write.mocked), "every API write is intercepted by the test");
  assert.deepEqual(harness.apiWrites.filter(write => !["/api/visitor", "/api/db", "/api/sample", "/api/photo"].includes(write.path)), [], "no other API write is allowed");
  assert.deepEqual(harness.pageErrors, [], "the page has no uncaught errors");
}

try {
  const retry = await makeHarness({ writeStatuses:[503, 503, 200] });
  try {
    await openForm(retry.page);
    await fillForm(retry.page);
    await previewAndConfirmByKeyboard(retry.page);
    await retry.page.waitForFunction(() => document.querySelector("#toast").textContent.includes("目前連不上伺服器"), null, { timeout:10000 });
    await retry.page.waitForFunction(() => document.activeElement.id === "submitBtn", null, { timeout:3000 });
    assert.equal(await retry.page.locator("#newStatus").innerText(), "目前連不上伺服器，請稍後再試（你輸入的內容已保留）");
    assert.equal(await retry.page.locator("#newStatus").getAttribute("role"), "status", "the form exposes the error in its live status region");
    assert.equal(await retry.page.locator("#toast").getAttribute("aria-hidden"), "true", "the same error is not announced twice");
    assert.equal(await retry.page.locator("#newText").inputValue(), "大安區和平東路測試草稿：路口標線褪色，行人過街不清楚。");
    assert.equal(await retry.page.locator("#dupBox").isHidden(), true);
    assert.equal(retry.reportWrites.length, 2, "a 503 is mocked twice by the app retry limit");

    await retry.page.keyboard.press("Enter");
    await retry.page.locator('#dupBox [data-dup="new"]').waitFor({ state:"visible" });
    await retry.page.waitForFunction(() => document.activeElement.matches('#dupBox [data-dup="new"]'));
    await retry.page.keyboard.press("Enter");
    await retry.page.waitForFunction(() => document.querySelector("#newBox").hidden, null, { timeout:5000 });
    assert.equal(await retry.page.evaluate(() => document.activeElement.id), "navReport", "success keeps the existing opener focus behavior");
    assert.equal(retry.reportWrites.length, 3, "keyboard retry succeeds after the mocked 503 responses");
    await assertMockedOnly(retry);
  } finally { await retry.context.close(); }

  const badRequest = await makeHarness({ writeStatuses:[400] });
  try {
    await openForm(badRequest.page);
    await fillForm(badRequest.page, "B");
    await previewAndConfirmByKeyboard(badRequest.page);
    await badRequest.page.waitForFunction(() => document.querySelector("#toast").textContent === "無法儲存，請稍後再試", null, { timeout:8000 });
    await badRequest.page.waitForFunction(() => document.activeElement.id === "submitBtn", null, { timeout:3000 });
    assert.equal(await badRequest.page.locator("#newStatus").innerText(), "無法儲存，請稍後再試");
    assert.equal(await badRequest.page.locator("#newText").inputValue(), "大安區和平東路測試草稿：路口標線褪色，行人過街不清楚。");
    assert.equal(badRequest.reportWrites.length, 1, "a 400 response is handled without a network retry");
    await badRequest.page.locator("#cancelBtn").click();
    assert.equal(await badRequest.page.evaluate(() => document.activeElement.id), "navReport", "cancel keeps the existing opener focus behavior");
    await assertMockedOnly(badRequest);
  } finally { await badRequest.context.close(); }

  const photoFailure = await makeHarness({ photoStatus:400 });
  try {
    await openForm(photoFailure.page);
    await fillForm(photoFailure.page, "C");
    await photoFailure.page.locator("#photoRow").waitFor({ state:"visible" });
    const png = Buffer.from(await photoFailure.page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      canvas.getContext("2d").fillRect(0, 0, 1, 1);
      return canvas.toDataURL("image/png").split(",")[1];
    }), "base64");
    await photoFailure.page.locator("#photoIn").setInputFiles({ name:"pixel.png", mimeType:"image/png", buffer:png });
    await photoFailure.page.locator("#photoPrev figure").waitFor({ state:"visible", timeout:5000 });
    await previewAndConfirmByKeyboard(photoFailure.page);
    await photoFailure.page.waitForFunction(() => document.querySelector("#newStatus").textContent === "照片上傳失敗，請稍後再試", null, { timeout:8000 });
    await photoFailure.page.waitForFunction(() => document.activeElement.id === "submitBtn", null, { timeout:3000 });
    assert.equal(photoFailure.photos.length, 1, "the photo upload request is mocked");
    assert.equal(photoFailure.reportWrites.length, 0, "the failed photo blocks report creation");
    assert.equal(await photoFailure.page.locator("#newStatus").getAttribute("role"), "status");
    assert.equal(await photoFailure.page.locator("#newText").inputValue(), "大安區和平東路測試草稿：路口標線褪色，行人過街不清楚。");
    await assertMockedOnly(photoFailure);
  } finally { await photoFailure.context.close(); }

  const movedFocus = await makeHarness({ writeStatuses:[503, 503], holdFirstWrite:true });
  try {
    await openForm(movedFocus.page);
    await fillForm(movedFocus.page, "D");
    await previewAndConfirmByKeyboard(movedFocus.page);
    await movedFocus.writeStarted;
    await movedFocus.page.locator("#cName").focus();
    movedFocus.releaseWrite();
    await movedFocus.page.waitForFunction(() => document.querySelector("#toast").textContent.includes("目前連不上伺服器"), null, { timeout:10000 });
    assert.equal(await movedFocus.page.evaluate(() => document.activeElement.id), "cName", "the failure does not steal focus from another valid field");
    assert.equal(await movedFocus.page.locator("#cName").inputValue(), "合成市民D");
    assert.equal(await movedFocus.page.locator("#newText").inputValue(), "大安區和平東路測試草稿：路口標線褪色，行人過街不清楚。");
    await assertMockedOnly(movedFocus);
  } finally { await movedFocus.context.close(); }

  const editedDraft = await makeHarness({ writeStatuses:[503, 503], holdFirstWrite:true });
  try {
    await openForm(editedDraft.page);
    await fillForm(editedDraft.page, "E");
    await previewAndConfirmByKeyboard(editedDraft.page);
    await editedDraft.writeStarted;
    await editedDraft.page.locator("#newText").fill("使用者正在編輯的新通報草稿");
    await editedDraft.page.evaluate(() => document.activeElement.blur());
    editedDraft.releaseWrite();
    await editedDraft.page.waitForFunction(() => document.querySelector("#toast").textContent.includes("目前連不上伺服器"), null, { timeout:10000 });
    assert.equal(await editedDraft.page.evaluate(() => document.activeElement.tagName), "BODY", "editing the draft prevents the failure from restoring stale focus");
    assert.equal(await editedDraft.page.locator("#newText").inputValue(), "使用者正在編輯的新通報草稿");
    await assertMockedOnly(editedDraft);
  } finally { await editedDraft.context.close(); }

  console.log("OK keyboard retry focus, 503 and 400 report failures, photo failure, valid-field and edited-draft focus guards, and existing cancel/success focus");
} finally { await browser.close(); }
