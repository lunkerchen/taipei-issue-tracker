// Browser regression for duplicate report success and failure paths.
// Run against a local Worker on port 8809 with a separate --persist-to directory.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.DUPLICATE_NAV_BASE || "http://localhost:8809";
const evidenceDir = process.env.DUPLICATE_NAV_EVIDENCE_DIR;
const adminToken = process.env.DUPLICATE_NAV_ADMIN_TOKEN;
if (!adminToken) throw new Error("Set DUPLICATE_NAV_ADMIN_TOKEN to the local synthetic Worker ADMIN_TOKEN.");
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;

const json = async response => {
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${response.url} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
};
const post = (path, headers, body) => fetch(base + path, { method:"POST", headers:{ "content-type":"application/json", ...headers }, body:JSON.stringify(body) });
const createVisitor = async () => {
  const { id:token } = await json(await post("/api/visitor", {}, {}));
  return { token, id:token.split(".")[0] };
};
const write = async (headers, op, path, data) => json(await post("/api/db", headers, { op, path, data }));
const report = (owner, key, title, body, dept) => write({ "x-visitor":owner.token }, "update", `reports/${owner.id}`, {
  items:{ [key]:{ author:owner.id, title, body, dept, tags:["交通號誌"], district:"大安區", createdAt:new Date().toISOString() } }
});
const adminHeaders = { "x-admin":adminToken };
const deleteDoc = async (path, headers = adminHeaders) => json(await post("/api/db", headers, { op:"delete", path }));

const own = await createVisitor();
const firstOwner = await createVisitor();
const secondOwner = await createVisitor();
const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const ownKey = `my-${runId}`;
const firstKey = `other-a-${runId}`;
const secondKey = `other-b-${runId}`;
const ownId = `${own.id}:${ownKey}`;
const first = { id:`${firstOwner.id}:${firstKey}`, title:`合成外部案件甲 ${runId}`, dept:"工務局新工處" };
const second = { id:`${secondOwner.id}:${secondKey}`, title:`合成外部案件乙 ${runId}`, dept:"交通局" };
const ownedDocs = [
  `reports/${own.id}`, `reports/${firstOwner.id}`, `reports/${secondOwner.id}`,
  `votes/${own.id}`, `addenda/${own.id}`, `triage/${second.id}`
];

let browser;
try {
  await Promise.all([
    report(own, ownKey, `合成自己的案件 ${runId}`, `我的陳情入口 ${runId}`, "衛生局"),
    report(firstOwner, firstKey, first.title, `合成公開案件內容甲 ${runId}`, first.dept),
    report(secondOwner, secondKey, second.title, `合成公開案件內容乙 ${runId}`, second.dept)
  ]);

  browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const page = await context.newPage();
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), own.token);

  let additionFailuresRemaining = 0, voteFailuresRemaining = 0, delayedAdditionWrite = null, delayedVoteWrite = null;
  let nextDuplicate = null;
  await page.route("**/api/health", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ai:true }) }));
  await page.route("**/api/news", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ items:[] }) }));
  await page.route("**/api/geocode**", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ lat:null }) }));
  await page.route("**/api/sample", async route => {
    const target = nextDuplicate;
    nextDuplicate = null;
    assert.ok(target, "the test selected a duplicate target before preview");
    const prompt = route.request().postDataJSON()?.prompt || "";
    assert.ok(prompt.includes(target.title), `AI prompt includes ${target.title}`);
    const line = prompt.split("\n").find(text => text.startsWith("#") && text.includes(target.title));
    const number = line && Number(line.slice(1).split(" ", 1)[0]);
    assert.ok(Number.isInteger(number) && number > 0, `AI prompt has the numbered line for ${target.title}`);
    return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({
      title:"合成分類結果", dept:target.dept, tags:["交通號誌"], category:"", district:"大安區", address:"", reason:"瀏覽器回歸測試",
      duplicate_of:number, duplicate_reason:"合成案件導向測試", spam:false, outside_taipei:false, too_vague:false
    }) });
  });
  await page.route("**/api/db", async route => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      if (additionFailuresRemaining && body?.path === `addenda/${own.id}`) {
        additionFailuresRemaining--;
        return route.fulfill({ status:503, contentType:"application/json", body:JSON.stringify({ error:"synthetic_write_failure" }) });
      }
      if (delayedAdditionWrite && body?.path === `addenda/${own.id}`) {
        const gate = delayedAdditionWrite;
        delayedAdditionWrite = null;
        gate.started();
        await gate.releasePromise;
      }
      if (voteFailuresRemaining && body?.path === `votes/${own.id}`) {
        voteFailuresRemaining--;
        return route.fulfill({ status:503, contentType:"application/json", body:JSON.stringify({ error:"synthetic_vote_failure" }) });
      }
      if (delayedVoteWrite && body?.path === `votes/${own.id}`) {
        const gate = delayedVoteWrite;
        delayedVoteWrite = null;
        gate.started();
        await gate.releasePromise;
      }
    }
    return route.continue();
  });

  await page.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(id => localStorage.getItem("tit-visitor") === id, own.token);
  await page.locator('#nav [data-view="mine"]').waitFor({ state:"visible" });
  await page.waitForFunction(id => [...document.querySelectorAll("#list [data-open]")].some(el => el.dataset.open === id), ownId);

  const setMismatchedFilters = async target => {
    if (await page.locator('#nav [data-view="issues"]').getAttribute("aria-current") !== "page")
      await page.locator('#nav [data-view="issues"]').click();
    await page.locator("#q").fill(`不符合目標的搜尋 ${runId}`);
    const wrongDept = target === first ? "交通局" : "工務局新工處";
    await page.locator("#deptFilter").selectOption(wrongDept);
    await page.locator("#msFilter").selectOption("flood-prep");
    assert.equal(await page.locator("#q").inputValue(), `不符合目標的搜尋 ${runId}`);
    assert.equal(await page.locator("#deptFilter").inputValue(), wrongDept);
    assert.equal(await page.locator("#msFilter").inputValue(), "flood-prep");
    await page.locator('#nav [data-view="mine"]').click();
    assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "filters are carried into My reports");
    assert.equal(await page.locator("#q").inputValue(), `不符合目標的搜尋 ${runId}`);
    assert.equal(await page.locator("#deptFilter").inputValue(), wrongDept);
    assert.equal(await page.locator("#msFilter").inputValue(), "flood-prep");
  };
  const previewDuplicate = async (target, text) => {
    await page.locator("#navReport").click();
    await page.locator("#newBox").waitFor({ state:"visible" });
    await page.locator("#cName").fill("合成回歸測試市民");
    await page.locator("#cPhone").fill("0912345678");
    await page.locator("#newText").fill(text);
    await page.locator("#agree").check();
    nextDuplicate = target;
    await page.locator("#submitBtn").click();
    await page.locator('#dupBox [data-dup="add"]').waitFor({ state:"visible" });
    assert.ok((await page.locator("#dupBox").innerText()).includes(target.title), "duplicate preview names the public target");
  };
  const targetVisible = async target => {
    const button = page.locator(`#list [data-open="${target.id}"]`);
    await button.waitFor({ state:"visible" });
    assert.equal(await button.getAttribute("aria-expanded"), "true", "target details are expanded");
    const box = button.locator("xpath=ancestor::div[contains(@class,'issue')]");
    const rect = await box.boundingBox();
    if (!(rect && rect.y < 900 && rect.y + rect.height > 0)) {
      const geometry = await page.evaluate(() => ({ scrollY:window.scrollY, innerHeight, pageHeight:document.documentElement.scrollHeight }));
      if (evidenceDir) {
        await mkdir(evidenceDir, { recursive:true });
        await page.screenshot({ path:`${evidenceDir}/target-position-debug.png` });
      }
      assert.fail(`target card is outside the viewport: ${JSON.stringify({ rect, geometry })}`);
    }
    return box;
  };
  const withDelayedVote = async duringWrite => {
    let markStarted, releaseWrite;
    const gate = {
      startedPromise:new Promise(resolve => { markStarted = resolve; }),
      releasePromise:new Promise(resolve => { releaseWrite = resolve; }),
      started:() => markStarted(),
      release:() => releaseWrite()
    };
    delayedVoteWrite = gate;
    const savedVote = page.waitForResponse(response => response.url().endsWith("/api/db") &&
      response.request().method() === "POST" && response.request().postDataJSON()?.path === `votes/${own.id}` && response.ok(), { timeout:10000 });
    try {
      await page.locator('#dupBox [data-dup="vote"]').click();
      await gate.startedPromise;
      await duringWrite();
    } finally {
      gate.release();
      delayedVoteWrite = null;
    }
    await savedVote;
  };
  const withDelayedAddition = async duringWrite => {
    let markStarted, releaseWrite;
    const gate = {
      startedPromise:new Promise(resolve => { markStarted = resolve; }),
      releasePromise:new Promise(resolve => { releaseWrite = resolve; }),
      started:() => markStarted(),
      release:() => releaseWrite()
    };
    delayedAdditionWrite = gate;
    const savedAddition = page.waitForResponse(response => response.url().endsWith("/api/db") &&
      response.request().method() === "POST" && response.request().postDataJSON()?.path === `addenda/${own.id}` && response.ok(), { timeout:10000 });
    try {
      await page.locator('#dupBox [data-dup="add"]').click();
      await gate.startedPromise;
      await duringWrite();
    } finally {
      gate.release();
      delayedAdditionWrite = null;
    }
    await savedAddition;
  };

  await setMismatchedFilters(first);
  await previewDuplicate(first, "取消後仍留在我的陳情");
  await page.locator("#cancelBtn").click();
  assert.equal(await page.locator("#newBox").isHidden(), true, "cancel closes the form");
  assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "cancel stays on My reports");
  let snapshot = await (await fetch(base + "/api/db")).json();
  assert.equal(snapshot.addenda?.[own.id], undefined, "cancel does not add a note");
  assert.equal(snapshot.votes?.[own.id]?.issues?.[first.id], undefined, "cancel does not vote");

  const additionText = "合成補充草稿保留測試";
  await previewDuplicate(first, additionText);
  additionFailuresRemaining = 2;
  const additionFailure = page.waitForResponse(response => response.request().method() === "POST" &&
    response.url().endsWith("/api/db") && response.request().postDataJSON()?.path === `addenda/${own.id}` && response.status() === 503, { timeout:5000 });
  await page.locator('#dupBox [data-dup="add"]').click();
  await additionFailure;
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("連不上伺服器"));
  assert.equal(additionFailuresRemaining, 0, "both write attempts failed before the form kept its draft");
  assert.equal(await page.locator("#newBox").isVisible(), true, "a failed addition keeps the form open");
  assert.equal(await page.locator("#newText").inputValue(), additionText, "a failed addition keeps the draft text");
  assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "a failed addition stays on My reports");
  snapshot = await (await fetch(base + "/api/db")).json();
  assert.equal(snapshot.addenda?.[own.id], undefined, "the simulated failed write stores no addition");

  nextDuplicate = first;
  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup="add"]').waitFor({ state:"visible" });
  const delayedAdditionText = `${additionText} 寫入期間修改`;
  await withDelayedAddition(async () => {
    await page.locator("#newText").fill(delayedAdditionText);
  });
  assert.equal(await page.locator("#newBox").isVisible(), true, "an edited draft stays open after the addition succeeds");
  assert.equal(await page.locator("#newText").inputValue(), delayedAdditionText, "a delayed addition keeps edits made while it was pending");
  assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "an edited delayed addition does not redirect from My reports");
  assert.ok((await page.locator("#newStatus").innerText()).includes("保留"), "the status says the edited report remains");
  snapshot = await (await fetch(base + "/api/db")).json();
  assert.ok(Object.values(snapshot.addenda?.[own.id]?.items || {}).some(item => item.target === first.id && item.text === additionText), "the delayed addition saved the reviewed text");

  nextDuplicate = first;
  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup="add"]').waitFor({ state:"visible" });
  await page.locator('#dupBox [data-dup="add"]').click();
  await page.waitForFunction(() => document.querySelector("#newBox").hidden && document.querySelector('#nav [data-view="issues"]').getAttribute("aria-current") === "page");
  assert.equal(await page.locator("#q").inputValue(), "", "successful addition clears the search");
  assert.equal(await page.locator("#deptFilter").inputValue(), "", "successful addition clears the department filter");
  assert.equal(await page.locator("#msFilter").inputValue(), "", "successful addition clears the milestone filter");
  assert.equal(await page.locator("#tabOpen").getAttribute("aria-pressed"), "true", "open target selects the open tab");
  const firstCard = await targetVisible(first);
  assert.ok((await firstCard.innerText()).includes(additionText), "the saved addition is visible in the expanded target");
  assert.ok((await firstCard.innerText()).includes(delayedAdditionText), "the new draft is visible after its own successful addition");
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive:true });
    await page.screenshot({ path:`${evidenceDir}/supplement-open-target.png` });
  }
  snapshot = await (await fetch(base + "/api/db")).json();
  assert.ok(Object.values(snapshot.addenda?.[own.id]?.items || {}).some(item => item.target === first.id && item.text === additionText), "the local Worker saved the synthetic addition");
  assert.equal(snapshot.votes?.[own.id]?.issues?.[first.id], true, "a successful addition also gives the target +1");

  await page.locator('#nav [data-view="mine"]').click();
  await setMismatchedFilters(second);
  const voteText = "合成只加一草稿保留測試";
  await previewDuplicate(second, voteText);
  voteFailuresRemaining = 2;
  await page.locator('#dupBox [data-dup="vote"]').click();
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("連不上伺服器"));
  assert.equal(voteFailuresRemaining, 0, "both vote attempts failed before the form kept its draft");
  assert.equal(await page.locator("#newBox").isVisible(), true, "a failed +1 keeps the form open");
  assert.equal(await page.locator("#newText").inputValue(), voteText, "a failed +1 keeps the draft text");
  assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "a failed +1 stays on My reports");

  nextDuplicate = second;
  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup="vote"]').waitFor({ state:"visible" });
  const editedVoteDraft = `${voteText} 等待中改稿`;
  await withDelayedVote(async () => {
    assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "a pending vote stays on My reports");
    await page.locator("#newText").fill(editedVoteDraft);
  });
  assert.equal(await page.locator("#newBox").isVisible(), true, "an edited draft stays open after the vote succeeds");
  assert.equal(await page.locator("#newText").inputValue(), editedVoteDraft, "a delayed vote keeps edits made while it was pending");
  assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "an edited delayed vote does not redirect from My reports");
  assert.ok((await page.locator("#toast").innerText()).includes("保留"), "the notice says the edited report remains");

  nextDuplicate = second;
  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup="vote"]').waitFor({ state:"visible" });
  const reopenedDraft = `等待中取消後新開通報 ${runId}`;
  await withDelayedVote(async () => {
    await page.locator("#cancelBtn").click();
    assert.equal(await page.locator("#newBox").isHidden(), true, "cancel closes the report form while a vote is pending");
    await page.locator("#navReport").click();
    await page.locator("#newBox").waitFor({ state:"visible" });
    await page.locator("#newText").fill(reopenedDraft);
  });
  assert.equal(await page.locator("#newBox").isVisible(), true, "a newly opened report stays open after the old vote succeeds");
  assert.equal(await page.locator("#newText").inputValue(), reopenedDraft, "a delayed old vote keeps the new report draft");
  assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "cancel and reopen do not redirect from My reports");
  assert.ok((await page.locator("#toast").innerText()).includes("保留"), "the notice says the new report remains");

  nextDuplicate = second;
  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup="vote"]').waitFor({ state:"visible" });
  await withDelayedVote(async () => {
    await page.locator("#cancelBtn").click();
    assert.equal(await page.locator("#newBox").isHidden(), true, "cancel leaves the form closed while the vote is pending");
  });
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("通報表單已取消"));
  assert.equal(await page.locator("#newBox").isHidden(), true, "a canceled form stays closed after the vote succeeds");
  assert.equal(await page.locator("#newText").inputValue(), reopenedDraft, "cancel keeps the report draft");
  assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "a canceled delayed vote stays on My reports");

  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#newText").fill(`固定案件導向回歸 ${runId}`);
  nextDuplicate = second;
  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup="vote"]').waitFor({ state:"visible" });
  await write(adminHeaders, "update", `triage/${second.id}`, { status:"fixed" });
  await page.waitForFunction(id => all.some(i => i.id === id && i.status === "fixed"), second.id);
  await page.locator('#dupBox [data-dup="vote"]').click();
  await page.waitForFunction(() => document.querySelector("#newBox").hidden && document.querySelector('#nav [data-view="issues"]').getAttribute("aria-current") === "page");
  assert.equal(await page.locator("#q").inputValue(), "", "successful +1 clears the search");
  assert.equal(await page.locator("#deptFilter").inputValue(), "", "successful +1 clears the department filter");
  assert.equal(await page.locator("#msFilter").inputValue(), "", "successful +1 clears the milestone filter");
  assert.equal(await page.locator("#tabClosed").getAttribute("aria-pressed"), "true", "fixed target selects the fixed tab");
  await targetVisible(second);
  snapshot = await (await fetch(base + "/api/db")).json();
  assert.equal(snapshot.votes?.[own.id]?.issues?.[second.id], true, "the local Worker saved the synthetic +1");
  if (evidenceDir) {
    await page.waitForFunction(() => !document.querySelector("#toast").textContent, null, { timeout:7000 });
    await page.screenshot({ path:`${evidenceDir}/vote-fixed-target.png` });
  }

  await context.close();
  console.log("OK duplicate navigation, filter clearing, status tabs, cancel, failed writes, and delayed-write draft retention");
} finally {
  if (browser) await browser.close();
  await Promise.all(ownedDocs.map(path => deleteDoc(path)));
}
