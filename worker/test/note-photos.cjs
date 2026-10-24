// Browser regression for own-case notes. All writes are mocked; no local case data is changed.
// Run with PLAYWRIGHT_MODULE=/path/to/playwright BASE=http://localhost:8788 node worker/test/note-photos.cjs
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASE = process.env.BASE || "http://localhost:8788";
const visitorId = "a1b2c3d4e5f60718";
const visitorToken = `${visitorId}.${"b".repeat(64)}`;
const key = "note-photo-regression";
const tag = "NOTE-PHOTO-REGRESSION";
const now = new Date().toISOString();

async function png(page, label, color) {
  const encoded = await page.evaluate(async ({ label, color }) => {
    const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 60;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 80, 60);
    ctx.fillStyle = "white"; ctx.font = "12px sans-serif"; ctx.fillText(label, 4, 30);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, { label, color });
  return { name: `${label}.png`, mimeType: "image/png", buffer: Buffer.from(encoded, "base64") };
}

(async () => {
  const data = await (await fetch(`${BASE}/api/db`)).json();
  data.reports = { [visitorId]: { items: { [key]: {
    title: tag, body: "瀏覽器回歸用合成案件", createdAt: now, author: visitorId,
    dept: "1999 待分派", tags: [], photos: [], notes: []
  } } } };
  data.triage = {};
  data.addenda = {};
  data.votes = {};
  data._seq = 0;

  let seq = 0, writeMode = "ok", photoMode = "ok", photoCount = 0;
  let holdStarted, releaseHold;
  const held = new Promise(resolve => { holdStarted = resolve; });
  const writeRequests = [], photoRequests = [];
  const browser = await chromium.launch({ headless:true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const page = await context.newPage();
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitorToken);

  await page.route("**/api/health", route => route.fulfill({ json:{ ai:false } }));
  await page.route("**/api/visitor", route => route.fulfill({ json:{ id:visitorToken } }));
  await page.route("**/api/db", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json:data });
    const req = route.request(), body = req.postDataJSON(), headers = req.headers();
    assert.equal(body.op, "append-note", "note submit uses the narrow append operation");
    writeRequests.push({ note:body.data, admin:headers["x-admin"], visitor:headers["x-visitor"] });
    if (writeMode === "fail") return route.fulfill({ status:503, body:"temporary failure" });
    const doc = data.reports[visitorId], item = doc.items[key];
    item.notes.push({ id:body.data.id, text:body.data.text, photos:body.data.photos, t:new Date().toISOString() });
    seq++;
    return route.fulfill({ json:{ data:doc, seq } });
  });
  await page.route("**/api/photo", async route => {
    const req = route.request(), headers = req.headers();
    if (req.method() !== "POST") return route.fulfill({ status:404 });
    photoRequests.push({ admin:headers["x-admin"], visitor:headers["x-visitor"] });
    photoCount++;
    if (photoMode === "hold") {
      photoMode = "ok"; holdStarted();
      await new Promise(resolve => { releaseHold = resolve; });
    } else if (photoMode === "fail-after-one" && photoCount > 1) {
      return route.fulfill({ status:503, body:"temporary photo failure" });
    }
    return route.fulfill({ json:{ key:`${visitorId}/note-${photoCount}.jpg` } });
  });

  try {
    await page.goto(`${BASE}/?admin=browser-regression#issues`, { waitUntil:"domcontentloaded" });
    const title = page.locator("#list button.title").filter({ hasText:tag });
    await title.waitFor({ state:"visible", timeout:15000 });
    await title.click();
    const form = page.locator("#list form.addnote");
    await form.waitFor({ state:"visible" });
    const noteA = "照片延遲時，文字和照片應同一則送出。";
    const firstPhoto = await png(page, "first", "#ad3434");
    photoMode = "hold"; photoCount = 0;
    await form.locator("textarea").fill(noteA);
    await form.locator("input[data-notepic]").setInputFiles(firstPhoto);
    await held;
    await page.waitForFunction(() => document.querySelector("form.addnote button[type=submit]")?.disabled === true);
    assert.match(await form.locator(".status").innerText(), /照片上傳中/);
    assert.equal(await form.locator("input[data-notepic]").isDisabled(), true);

    await page.locator("#sort").evaluate(el => el.dispatchEvent(new Event("input", { bubbles:true })));
    assert.equal(await form.locator("textarea").inputValue(), noteA, "live render keeps draft text during upload");
    assert.equal(await form.locator("button[type=submit]").isDisabled(), true, "live render keeps submit disabled during upload");
    await page.evaluate(() => document.querySelector("form.addnote").dispatchEvent(new Event("submit", { bubbles:true, cancelable:true })));
    assert.equal(writeRequests.length, 0, "a submit event during upload cannot append an empty-photo note");
    releaseHold();
    await form.locator(".phprev img").waitFor({ state:"visible", timeout:10000 });
    assert.equal(await form.locator("button[type=submit]").isDisabled(), false);
    await form.locator("button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("form.addnote textarea")?.value === "");
    assert.equal(writeRequests[0].note.text, noteA);
    assert.equal(writeRequests[0].note.photos.length, 1, "photo and text are sent in one note");

    const noteB = "部分照片失敗時，草稿與成功照片應保留。";
    const secondPhoto = await png(page, "second", "#2467a6");
    const thirdPhoto = await png(page, "third", "#39834b");
    await form.locator("textarea").fill(noteB);
    photoMode = "fail-after-one"; photoCount = 0;
    await form.locator("input[data-notepic]").setInputFiles([secondPhoto, thirdPhoto]);
    await page.getByText(/已保留 1 張，1 張尚未上傳/, { exact:false }).waitFor({ state:"visible", timeout:10000 });
    assert.equal(await form.locator("textarea").inputValue(), noteB, "upload failure preserves note text");
    assert.equal(await form.locator(".phprev img").count(), 1, "successful partial upload remains in the form");
    assert.equal(writeRequests.length, 1, "failed upload does not submit the note");

    photoMode = "ok"; photoCount = 0;
    await form.locator("input[data-notepic]").setInputFiles(thirdPhoto);
    await page.waitForFunction(() => document.querySelectorAll("form.addnote .phprev img").length === 2);
    writeMode = "fail";
    await form.locator("button[type=submit]").click();
    await page.getByText("送出失敗，補充內容已保留，請再試一次。", { exact:true }).waitFor({ state:"visible", timeout:10000 });
    assert.equal(await form.locator("textarea").inputValue(), noteB, "write failure preserves text");
    assert.equal(await form.locator(".phprev img").count(), 2, "write failure preserves uploaded photos");
    const failedWrites = writeRequests.filter(x => x.note.text === noteB);
    assert.equal(failedWrites.length, 2, "shim retries the failed write once");
    assert.equal(failedWrites[0].note.id, failedWrites[1].note.id, "shim retry keeps the note UUID");

    writeMode = "ok";
    await form.locator("button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("form.addnote textarea")?.value === "");
    const retriedWrites = writeRequests.filter(x => x.note.text === noteB);
    assert.equal(retriedWrites.at(-1).note.id, failedWrites[0].note.id, "manual retry reuses the same note UUID");
    assert.notEqual(retriedWrites.at(-1).note.id, writeRequests[0].note.id, "changed text and photos use a new UUID");
    assert.equal(retriedWrites.at(-1).note.photos.length, 2);

    for (const request of photoRequests) {
      assert.equal(request.admin, undefined, "own-case note photos do not use the admin photo identity");
      assert.equal(request.visitor, visitorToken, "own-case note photos use the case owner's visitor identity");
    }
    for (const request of writeRequests) {
      assert.equal(request.admin, undefined, "own-case note append does not use the admin identity");
      assert.equal(request.visitor, visitorToken, "own-case note append uses the case owner's visitor identity");
    }
    console.log("OK: pending uploads block submit, partial errors survive re-render, retries keep one UUID, and admin-owned tabs upload notes as the citizen.");
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
