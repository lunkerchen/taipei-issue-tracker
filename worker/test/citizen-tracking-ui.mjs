// Runs only against the isolated local Worker started by browser.mjs.
// Run: PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright npm_config_offline=true BROWSER_TEST_PORT=8887 node worker/test/browser.mjs citizen-tracking-ui.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = (process.env.BASE || "http://127.0.0.1:8887").replace(/\/$/, "");
const baseUrl = new URL(BASE);
assert.equal(baseUrl.protocol, "http:", "fixtures may only use local HTTP");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname), "fixtures may only be written to a local Worker");

const ADMIN = { "x-admin":"1" };
const runId = randomUUID().replaceAll("-", "").slice(0, 10);
const post = (path, headers = {}, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});
const dbWrite = (headers, op, path, data) => post("/api/db", headers, { op, path, data });
const deleteFixture = path => dbWrite(ADMIN, "delete", path, {}).catch(() => {});
const freshEvents = (type, to, by) => [{ t:new Date().toISOString(), type, to, by }];

const mint = async () => {
  const response = await post("/api/visitor");
  assert.equal(response.status, 200, "mint a local visitor identity");
  const { id:token } = await response.json();
  return { token, id:token.split(".")[0] };
};

const actor = await mint();
const fixturePaths = new Set([`reports/${actor.id}`]);
const cases = {};
const reporters = await Promise.all(Array.from({ length:5 }, () => mint()));
let newReportTitle = "";
let createdThroughUi = [];
let holdOwnNoteResponse = false;
let releaseOwnNoteResponse = () => {};
const ownNoteResponseGate = new Promise(resolve => { releaseOwnNoteResponse = resolve; });
let ownNoteSavedResolve = () => {};
const ownNoteSaved = new Promise(resolve => { ownNoteSavedResolve = resolve; });

const createCase = async (name, creator, dept = "環保局") => {
  const key = `track-${name}-${runId}`;
  const target = `${creator.id}:${key}`;
  const title = `追蹤回歸 ${name} ${runId}`;
  const body = `本機隔離 Worker 合成案件 ${name} ${runId}，用於市民案件追蹤 browser test。`;
  const item = { title, body, author:creator.id, createdAt:new Date().toISOString(), dept, district:"大安區", tags:["道路"], photos:[], notes:[] };
  const response = await dbWrite({ "x-visitor":creator.token }, "create-report", `reports/${creator.id}`, {
    key, item, contact:{ name:"本機合成測試者", phone:"0912000000", email:`${key}@example.invalid`, realName:false }
  });
  assert.equal(response.status, 200, `create local fixture ${name}`);
  const saved = await response.json();
  fixturePaths.add(`reports/${creator.id}`);
  cases[name] = { key, target, title, body, owner:creator.id, n:saved.data?.items?.[key]?.n };
  return cases[name];
};

// Keep each visitor below the Worker’s three-report per-visitor limit. Every fixture uses a fresh timestamp and a unique body.
try {
  const ownCase = await createCase("sent", actor, "工務局新工處");
  const names = ["vote", "supplement", "fixed", "baseline", "status", "hidden", "offscreen", ...Array.from({ length:8 }, (_, i) => `extra${i + 1}`)];
  for (let i = 0; i < names.length; i++) {
    const creator = reporters[Math.floor(i / 3)];
    assert.ok(creator, "the fixture reporter pool covers all test cases");
    const item = await createCase(names[i], creator, i % 2 ? "環保局" : "工務局新工處");
    if (["fixed", "status"].includes(names[i])) {
      const status = names[i] === "fixed" ? "fixed" : "open";
      const events = names[i] === "fixed" ? freshEvents("status", "fixed", "工務局新工處") : [];
      assert.equal((await dbWrite(ADMIN, "set", `triage/${item.target}`, { status, dept:"工務局新工處", events })).status, 200,
        `seed ${names[i]} triage`);
      fixturePaths.add(`triage/${item.target}`);
    }
  }
  for (const name of ["sent", "hidden", "offscreen"]) fixturePaths.add(`triage/${cases[name].target}`);

  const participated = ["fixed", "status", "hidden", "offscreen", ...names.filter(name => name.startsWith("extra"))];
  const voteMap = Object.fromEntries(participated.map(name => [cases[name].target, true]));
  assert.equal((await dbWrite({ "x-visitor":actor.token }, "set", `votes/${actor.id}`, { issues:voteMap })).status, 200,
    "seed the local visitor’s existing participation votes");
  fixturePaths.add(`votes/${actor.id}`);
  const baselineAddendum = `初始基線補充 ${runId}`;
  assert.equal((await dbWrite({ "x-visitor":actor.token }, "append-addendum", `addenda/${actor.id}`, {
    id:randomUUID(), target:cases.baseline.target, text:baselineAddendum, photos:[]
  })).status, 200, "seed an own addendum before the page starts");
  fixturePaths.add(`addenda/${actor.id}`);

  const browser = await chromium.launch({ headless:true });
  let context;
  const errors = [];
  try {
    context = await browser.newContext({ viewport:{ width:390, height:540 } });
    await context.addInitScript(token => localStorage.setItem("tit-visitor", token), actor.token);
    // Delay only the addenda listener callbacks. Reports, triage, votes and all writes still use the real local Worker.
    await context.addInitScript(() => {
      Object.defineProperty(window, "claude", {
        configurable:true,
        get() { return undefined; },
        set(value) {
          const use = value.use.bind(value);
          value.use = async name => {
            const api = await use(name);
            if (name !== "db" || !api) return api;
            const collection = api.collection.bind(api);
            api.collection = name => {
              const ref = collection(name);
              if (name !== "addenda") return ref;
              const subscribe = ref.onSnapshot.bind(ref);
              ref.onSnapshot = (callback, onError) => {
                let released = false;
                const queued = [];
                return subscribe((snapshot) => {
                  if (released) return callback(snapshot);
                  queued.push(snapshot);
                  window.__trackingAddendaDelayed = true;
                  window.__releaseTrackingAddenda ||= () => {
                    if (released) return;
                    released = true;
                    window.__trackingAddendaReleased = true;
                    for (const pending of queued.splice(0)) callback(pending);
                  };
                }, onError);
              };
              return ref;
            };
            return api;
          };
          Object.defineProperty(window, "claude", { value, writable:true, configurable:true });
        }
      });
    });
    await context.route("**/api/news", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ items:[] }) }));
    await context.route("**/api/health", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ai:true }) }));
    await context.route("**/api/geocode*", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ lat:null }) }));
    let duplicateNumber = null;
    await context.route("**/api/sample", route => {
      const prompt = route.request().postDataJSON()?.prompt || "";
      const duplicate = duplicateNumber && prompt.includes(`#${duplicateNumber} ${cases.supplement.title}`);
      return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({
        title:newReportTitle || `通報成功 ${runId}`, dept:"環保局", tags:["垃圾"], category:"", district:"大安區", address:"", reason:"本機測試分類",
        duplicate_of:duplicate ? duplicateNumber : null, duplicate_reason:duplicate ? "隔離 Worker 合成測試" : "",
        spam:false, outside_taipei:false, too_vague:false
      }) });
    });
    await context.route("**/api/db", async route => {
      const request = route.request();
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        if (holdOwnNoteResponse && body?.op === "append-note" && body.path === `reports/${actor.id}`) {
          const response = await route.fetch(); // the write broadcasts over WS before the browser sees its response
          assert.equal(response.status(), 200, "the own note is stored before its response is held");
          ownNoteSavedResolve();
          await ownNoteResponseGate;
          return route.fulfill({ response });
        }
        if (body?.op === "create-report" && body.data?.item?.title?.startsWith(`通報成功 ${runId}`)) createdThroughUi.push(body);
      }
      return route.continue();
    });

    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${BASE}/#mine`, { waitUntil:"domcontentloaded" });
    const ownRow = () => page.locator(`#list [data-open="${cases.sent.target}"]`);
    await ownRow().waitFor({ state:"visible", timeout:30000 });
    assert.equal(await page.locator("#mineSent").getAttribute("aria-pressed"), "true", "#mine opens on 我送出");
    assert.equal(await page.locator("#mineParticipated").getAttribute("aria-pressed"), "false", "我參與 is not selected by default");
    assert.equal(await page.locator(`#list [data-open="${cases.vote.target}"]`).count(), 0, "another citizen’s case is not in 我送出");

    await page.locator("#mineParticipated").click();
    const rowFor = id => page.locator(`#list [data-open="${id}"]`).locator("xpath=ancestor::div[contains(@class,'issue')]");
    await rowFor(cases.status.target).waitFor({ state:"visible", timeout:15000 });
    await rowFor(cases.fixed.target).waitFor({ state:"visible", timeout:15000 });
    await page.waitForFunction(() => window.__trackingAddendaDelayed === true, null, { timeout:10000 });

    // A real other-admin status update arrives while the addenda initial snapshot is held.
    const interimAt = new Date().toISOString();
    assert.equal((await dbWrite(ADMIN, "update", `triage/${cases.status.target}`, {
      status:"progress", dept:"工務局新工處", events:[{ t:interimAt, type:"status", to:"progress", by:"工務局新工處" }]
    })).status, 200, "another local admin advances the case during initial snapshot loading");
    await page.waitForFunction(target => {
      const title = document.querySelector(`[data-open="${CSS.escape(target)}"]`);
      return title?.closest(".issue")?.innerText.includes("處理中");
    }, cases.status.target, { timeout:10000 });
    assert.equal(await rowFor(cases.status.target).locator(".progress-unread").count(), 0,
      "progress arriving before all four initial collection snapshots is absorbed into the starting baseline");
    await page.evaluate(() => window.__releaseTrackingAddenda?.());
    await page.waitForFunction(() => window.__trackingAddendaReleased === true, null, { timeout:10000 });
    await page.waitForTimeout(150);
    await rowFor(cases.baseline.target).waitFor({ state:"visible", timeout:10000 });
    assert.equal(await page.locator("#list .progress-unread").count(), 0,
      "an addendum already present in the delayed initial snapshot is not reported as new");
    assert.equal(await page.locator("#mineParticipated").getAttribute("aria-pressed"), "true");
    assert.ok(await page.locator("#list").innerText().then(text => text.includes(cases.fixed.title)), "a fixed case remains in 我參與");

    // A different visitor’s +1 changes only the vote count; it must not look like case progress.
    assert.equal((await dbWrite({ "x-visitor":reporters[0].token }, "set", `votes/${reporters[0].id}`, {
      issues:{ [cases.baseline.target]:true }
    })).status, 200, "another visitor adds a vote to the tracked case");
    fixturePaths.add(`votes/${reporters[0].id}`);
    await page.waitForFunction(target => document.querySelector(`[data-vote="${CSS.escape(target)}"]`)?.getAttribute("aria-label") === "+1，目前 1",
      cases.baseline.target, { timeout:10000 });
    assert.equal(await rowFor(cases.baseline.target).locator(".progress-unread").count(), 0,
      "another visitor’s vote count does not create unread progress");

    // A +1 starts participation. Cancelling the only participation removes the case from 我參與.
    await page.locator('#nav [data-view="issues"]').click();
    await page.locator("#q").fill(cases.vote.title);
    const voteRow = rowFor(cases.vote.target);
    const voteButton = voteRow.locator(`[data-vote="${cases.vote.target}"]`);
    await voteButton.waitFor({ state:"visible", timeout:15000 });
    const addVoteResponse = page.waitForResponse(response => {
      const request = response.request();
      return request.method() === "POST" && request.url().endsWith("/api/db") &&
        request.postDataJSON()?.path === `votes/${actor.id}` && response.ok();
    });
    await voteButton.click();
    await page.waitForFunction(target => document.querySelector(`[data-vote="${CSS.escape(target)}"]`)?.getAttribute("aria-pressed") === "true", cases.vote.target);
    await addVoteResponse;
    assert.equal(await rowFor(cases.vote.target).locator(".progress-unread").count(), 0, "a successful +1 is immediately considered read");
    await page.locator('#nav [data-view="mine"]').click();
    await page.locator("#mineParticipated").click();
    const participatingVoteRow = rowFor(cases.vote.target);
    await participatingVoteRow.waitFor({ state:"visible", timeout:10000 });
    const cancelVoteResponse = page.waitForResponse(response => {
      const request = response.request();
      return request.method() === "POST" && request.url().endsWith("/api/db") &&
        request.postDataJSON()?.path === `votes/${actor.id}` && response.ok();
    });
    await participatingVoteRow.locator(`[data-vote="${cases.vote.target}"]`).click();
    await cancelVoteResponse;
    await page.waitForFunction(target => !document.querySelector(`[data-open="${CSS.escape(target)}"]`), cases.vote.target, { timeout:10000 });
    const cancelFocus = await page.evaluate(() => ({
      isBody:document.activeElement === document.body,
      isList:document.querySelector("#list").contains(document.activeElement),
      isMineTab:document.activeElement?.id === "mineParticipated"
    }));
    assert.ok(!cancelFocus.isBody && (cancelFocus.isList || cancelFocus.isMineTab),
      "removing the cancelled vote row leaves focus on the remaining list or participation tab");

    // The actual form appends a supplement to a voted case. Cancelling its +1 must leave it in 我參與.
    await page.locator('#nav [data-view="issues"]').click();
    await page.locator("#q").fill(cases.supplement.title);
    const supplementVote = page.locator(`#list [data-vote="${cases.supplement.target}"]`);
    await supplementVote.waitFor({ state:"visible", timeout:15000 });
    await supplementVote.click();
    await page.waitForFunction(target => document.querySelector(`[data-vote="${CSS.escape(target)}"]`)?.getAttribute("aria-pressed") === "true", cases.supplement.target);
    await page.locator('#nav [data-view="mine"]').click();
    await page.locator("#mineParticipated").click();
    await rowFor(cases.supplement.target).waitFor({ state:"visible", timeout:10000 });
    await page.locator("#navReport").click();
    await page.locator("#newText").fill(`我補充現場狀況 ${runId}，這是本機 Worker 的合成內容。`);
    await page.locator("#cName").fill("本機合成測試者");
    await page.locator("#cPhone").fill("0912000000");
    await page.locator("#cEmail").fill(`addendum-${runId}@example.invalid`);
    await page.locator("#agree").check();
    duplicateNumber = cases.supplement.n;
    await page.locator("#submitBtn").click();
    await page.locator('#dupBox [data-dup="add"]').waitFor({ state:"visible", timeout:15000 });
    await page.locator('#dupBox [data-dup="add"]').click();
    await page.waitForFunction(() => document.querySelector("#newBox").hidden === true, null, { timeout:15000 });
    assert.equal(createdThroughUi.length, 0, "the supplement journey did not create a new report");
    assert.equal((await (await fetch(`${BASE}/api/db`)).json()).addenda?.[actor.id]?.items &&
      Object.values((await (await fetch(`${BASE}/api/db`)).json()).addenda?.[actor.id]?.items || {}).some(x => x.target === cases.supplement.target), true,
    "the real addendum form saved the actor’s supplement to the local Worker");
    await page.locator(`#list [data-open="${cases.supplement.target}"]`).click(); // close the detail opened by successful supplement
    await page.locator('#nav [data-view="mine"]').click();
    await page.locator("#mineParticipated").click();
    await rowFor(cases.supplement.target).waitFor({ state:"visible", timeout:10000 });
    assert.equal(await rowFor(cases.supplement.target).locator(".progress-unread").count(), 0,
      "the submitter’s own successful supplement is considered read");
    const supplementVoteAfterAddendum = rowFor(cases.supplement.target).locator(`[data-vote="${cases.supplement.target}"]`);
    await supplementVoteAfterAddendum.click();
    await page.waitForFunction(target => document.querySelector(`[data-vote="${CSS.escape(target)}"]`)?.getAttribute("aria-pressed") === "false", cases.supplement.target);
    await rowFor(cases.supplement.target).waitFor({ state:"visible", timeout:10000 });
    assert.ok(await rowFor(cases.supplement.target).innerText().then(text => text.includes(cases.supplement.title)),
      "the case stays in 我參與 after its +1 is cancelled because the visitor has an addendum");

    // A later status change is unread until its expanded details are visible, then stays read after a reload.
    const laterAt = new Date().toISOString();
    assert.equal((await dbWrite(ADMIN, "update", `triage/${cases.status.target}`, {
      status:"fixed", dept:"工務局新工處", events:[
        { t:interimAt, type:"status", to:"progress", by:"工務局新工處" },
        { t:laterAt, type:"status", to:"fixed", by:"工務局新工處" }
      ]
    })).status, 200, "a different admin changes the case to fixed");
    await rowFor(cases.status.target).locator(".progress-unread").waitFor({ state:"visible", timeout:15000 });
    assert.match(await rowFor(cases.status.target).innerText(), /已修復/, "the changed status is shown in 我參與");
    const statusTitle = page.locator(`#list [data-open="${cases.status.target}"]`);
    await statusTitle.click();
    const statusDetail = rowFor(cases.status.target).locator(".detail");
    await statusDetail.waitFor({ state:"visible" });
    assert.match(await statusDetail.locator(".progress-status").innerText(), /已修復/);
    await rowFor(cases.status.target).locator(".progress-unread").waitFor({ state:"detached", timeout:10000 });
    await statusTitle.click();
    await page.waitForFunction(target => document.querySelector(`[data-open="${CSS.escape(target)}"]`)?.getAttribute("aria-expanded") === "false", cases.status.target);
    await page.evaluate(() => window.history.replaceState(null, "", `${location.pathname}#mine`));
    await page.reload({ waitUntil:"domcontentloaded" });
    await ownRow().waitFor({ state:"visible", timeout:20000 });
    assert.equal(await page.locator("#mineSent").getAttribute("aria-pressed"), "true", "a full reload restores #mine’s sent default");
    await page.waitForFunction(() => window.__trackingAddendaDelayed === true, null, { timeout:10000 });
    await page.evaluate(() => window.__releaseTrackingAddenda?.());
    await page.waitForFunction(() => window.__trackingAddendaReleased === true, null, { timeout:10000 });
    await page.locator("#mineParticipated").click();
    await rowFor(cases.status.target).waitFor({ state:"visible", timeout:10000 });
    assert.equal(await rowFor(cases.status.target).locator(".progress-unread").count(), 0,
      "the read version persists in this visitor’s local storage across reload");
    await rowFor(cases.fixed.target).waitFor({ state:"visible", timeout:10000 });

    // Expanded offscreen details stay unread until the reader brings them into the visible viewport.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const scroll = await page.evaluate(() => ({ y:scrollY, height:document.body.scrollHeight, viewport:innerHeight }));
    assert.ok(scroll.height > scroll.viewport + 100, "the participant list is long enough to place an expanded case offscreen");
    const offscreenAt = new Date().toISOString();
    assert.equal((await dbWrite(ADMIN, "update", `triage/${cases.offscreen.target}`, {
      status:"progress", dept:"環保局", events:freshEvents("status", "progress", "環保局").map(e => ({ ...e, t:offscreenAt }))
    })).status, 200, "another admin updates the offscreen case");
    await rowFor(cases.offscreen.target).locator(".progress-unread").waitFor({ state:"visible", timeout:15000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(target => {
      const button = document.querySelector(`[data-open="${CSS.escape(target)}"]`);
      button?.dispatchEvent(new MouseEvent("click", { bubbles:true, detail:1 }));
    }, cases.offscreen.target);
    await page.waitForFunction(target => document.querySelector(`[data-open="${CSS.escape(target)}"]`)?.getAttribute("aria-expanded") === "true", cases.offscreen.target);
    const offscreenDetail = rowFor(cases.offscreen.target).locator(".detail");
    const offscreenBounds = await offscreenDetail.boundingBox();
    assert.ok(offscreenBounds && (offscreenBounds.y > 540 || offscreenBounds.y + offscreenBounds.height < 0),
      "the expanded detail is outside the visible viewport");
    assert.equal(await rowFor(cases.offscreen.target).locator(".progress-unread").count(), 1,
      "expanding an offscreen case does not mark it read");
    await offscreenDetail.scrollIntoViewIfNeeded();
    await rowFor(cases.offscreen.target).locator(".progress-unread").waitFor({ state:"detached", timeout:10000 });

    // Hidden public cases leave the participated list and are absent from the public database snapshot.
    assert.equal((await dbWrite(ADMIN, "update", `triage/${cases.hidden.target}`, { hidden:true })).status, 200,
      "admin hides a participated case");
    await page.waitForFunction(target => !document.querySelector(`[data-open="${CSS.escape(target)}"]`), cases.hidden.target, { timeout:15000 });
    assert.ok(!await page.locator("#list").innerText().then(text => text.includes(cases.hidden.title)), "hidden case title is removed from the UI");
    const publicSnapshot = await (await fetch(`${BASE}/api/db`)).json();
    assert.equal(publicSnapshot.reports?.[cases.hidden.owner]?.items?.[cases.hidden.key], undefined, "public API omits the hidden report");
    assert.equal(publicSnapshot.triage?.[cases.hidden.target], undefined, "public API omits hidden triage data");

    // Hold an own-note response after the real write and WS broadcast. A remote status update then arrives while
    // the details are collapsed; the later own response may mark only its note version read.
    await page.locator("#mineSent").click();
    const ownTitle = page.locator(`#list [data-open="${cases.sent.target}"]`);
    await ownTitle.waitFor({ state:"visible", timeout:10000 });
    await ownTitle.click();
    const sentRow = rowFor(cases.sent.target);
    const ownNote = `本人補充延遲回應 ${runId}`;
    const ownNoteForm = sentRow.locator("form.addnote");
    await ownNoteForm.locator("textarea").fill(ownNote);
    const noteResponse = page.waitForResponse(response => {
      const request = response.request();
      return request.method() === "POST" && request.url().endsWith("/api/db") && request.postDataJSON()?.op === "append-note";
    });
    holdOwnNoteResponse = true;
    await ownNoteForm.locator('button[type="submit"]').click();
    await ownNoteSaved;
    await page.waitForFunction(text => [...document.querySelectorAll("#list .addl .body")].some(x => x.textContent === text), ownNote,
      { timeout:10000 });
    await ownTitle.click();
    await page.waitForFunction(target => document.querySelector(`[data-open="${CSS.escape(target)}"]`)?.getAttribute("aria-expanded") === "false", cases.sent.target);
    const remoteNoteRaceAt = new Date().toISOString();
    assert.equal((await dbWrite(ADMIN, "update", `triage/${cases.sent.target}`, {
      status:"progress", dept:"工務局新工處", events:freshEvents("status", "progress", "工務局新工處").map(e => ({ ...e, t:remoteNoteRaceAt }))
    })).status, 200, "admin changes status while the own-note response is pending");
    await page.waitForFunction(target => {
      const row = document.querySelector(`[data-open="${CSS.escape(target)}"]`)?.closest(".issue");
      return row?.innerText.includes("處理中") && row.querySelector(".progress-unread");
    }, cases.sent.target, { timeout:15000 });
    releaseOwnNoteResponse();
    const ownNoteResponse = await noteResponse;
    assert.equal(ownNoteResponse.status(), 200, "the held own-note response succeeds");
    holdOwnNoteResponse = false;
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "已補充", null, { timeout:5000 });
    assert.equal(await sentRow.locator(".progress-unread").count(), 1,
      "the own-note success response does not mark the remote status update read");
    const ownSnapshot = await (await fetch(`${BASE}/api/db`)).json();
    const savedOwnNotes = ownSnapshot.reports?.[actor.id]?.items?.[cases.sent.key]?.notes || [];
    assert.equal(savedOwnNotes.filter(note => note.text === ownNote).length, 1,
      "the WS update before the HTTP response does not duplicate the own note");
    await ownTitle.click();
    await sentRow.locator(".progress-unread").waitFor({ state:"detached", timeout:10000 });
    assert.equal(await sentRow.locator(".addl .body").filter({ hasText:ownNote }).count(), 1,
      "the submitted own note appears once when details are opened");
    await ownTitle.click();

    // Creating a report from 我參與 returns to 我送出 and opens the newly created case.
    await page.locator("#mineParticipated").click();
    assert.equal(await page.locator("#mineParticipated").getAttribute("aria-pressed"), "true",
      "the new-report journey starts from 我參與");
    await page.locator("#navReport").click();
    const reportBody = `通報成功 ${runId}，工務局附近的路燈持續故障，夜間行人看不清楚。`;
    newReportTitle = `通報成功 ${runId}`;
    duplicateNumber = null;
    await page.locator("#newText").fill(reportBody);
    await page.locator("#cName").fill("本機合成測試者");
    await page.locator("#cPhone").fill("0912000000");
    await page.locator("#cEmail").fill(`report-${runId}@example.invalid`);
    await page.locator("#agree").check();
    await page.locator("#newDistrict").selectOption("大安區");
    await page.locator("#submitBtn").click();
    await page.locator('#dupBox [data-dup="new"]').waitFor({ state:"visible", timeout:15000 });
    await page.locator('#dupBox [data-dup="new"]').click();
    await page.waitForFunction(() => document.querySelector("#newBox").hidden === true, null, { timeout:20000 });
    assert.equal(createdThroughUi.length, 1, "the UI sent exactly one create-report request");
    const uiKey = createdThroughUi[0].data.key;
    const uiTarget = `${actor.id}:${uiKey}`;
    fixturePaths.add(`reports/${actor.id}`);
    await page.waitForFunction(target => {
      const button = document.querySelector(`[data-open="${CSS.escape(target)}"]`);
      return document.querySelector("#mineSent")?.getAttribute("aria-pressed") === "true" &&
        button?.getAttribute("aria-expanded") === "true";
    }, uiTarget, { timeout:15000 });
    assert.ok(await page.locator(`#list [data-open="${uiTarget}"]`).innerText().then(text => text.includes(newReportTitle)),
      "the successful report is visible and expanded under 我送出");
    assert.deepEqual(errors, [], "the browser produced no page errors");
    console.log("OK citizen tracking: sent/participated tabs, vote cancellation, addenda, fixed cases, snapshot baseline, read state, hidden cases, report return, and unavailable storage");
  } finally {
    await context?.close();
    await browser.close();
  }

  const blockedBrowser = await chromium.launch({ headless:true });
  try {
    const blockedContext = await blockedBrowser.newContext({ viewport:{ width:390, height:540 } });
    const blockedErrors = [];
    await blockedContext.addInitScript(() => Object.defineProperty(window, "localStorage", {
      configurable:true, get() { throw new DOMException("blocked storage", "SecurityError"); }
    }));
    await blockedContext.route("**/api/news", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ items:[] }) }));
    await blockedContext.route("**/api/health", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ai:true }) }));
    await blockedContext.route("**/api/sample", route => route.fulfill({ status:200, contentType:"application/json", body:"{}" }));
    const blockedPage = await blockedContext.newPage();
    blockedPage.on("pageerror", error => blockedErrors.push(error.message));
    await blockedPage.goto(`${BASE}/#mine`, { waitUntil:"domcontentloaded" });
    await blockedPage.locator("#main").waitFor({ state:"visible", timeout:20000 });
    await blockedPage.waitForFunction(() => document.querySelector("#who")?.textContent.includes("無法保留你的通報身分"), null, { timeout:15000 });
    await blockedPage.locator('#nav [data-view="issues"]').click();
    const blockedTarget = blockedPage.locator(`#list [data-open="${cases.vote.target}"]`);
    await blockedTarget.waitFor({ state:"visible", timeout:15000 }); // public read-only visitor has no +1 identity
    await blockedPage.waitForFunction(() => progressTrackingReady && progressSnapshotsReady(), null, { timeout:15000 });
    fixturePaths.add(`triage/${cases.vote.target}`);
    assert.equal((await dbWrite(ADMIN, "update", `triage/${cases.vote.target}`, {
      status:"progress", dept:"環保局", events:freshEvents("status", "progress", "環保局")
    })).status, 200, "admin updates a public case while local storage is unavailable");
    const blockedRow = blockedTarget.locator("xpath=ancestor::div[contains(@class,'issue')]");
    await blockedRow.locator(".progress-unread").waitFor({ state:"visible", timeout:15000 });
    await blockedTarget.click();
    await blockedRow.locator(".detail").waitFor({ state:"visible" });
    await blockedRow.locator(".progress-unread").waitFor({ state:"detached", timeout:10000 });
    assert.deepEqual(blockedErrors, [], "unavailable local storage does not crash the page");
    await blockedContext.close();
  } finally {
    await blockedBrowser.close();
  }
} finally {
  // All writes above go only to browser.mjs’s temporary Worker; remove the fixture documents there before it stops.
  for (const path of fixturePaths) await deleteFixture(path);
}
