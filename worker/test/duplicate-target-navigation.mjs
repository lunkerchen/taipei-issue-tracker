// Browser regression for duplicate report success and failure paths.
// Run against a local Worker on port 8809 with a separate --persist-to directory.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.DUPLICATE_NAV_BASE || "http://localhost:8809";
const evidenceDir = process.env.DUPLICATE_NAV_EVIDENCE_DIR;
const adminToken = "1"; // demo mode: any x-admin value is admin
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
const report = async (owner, key, title, body, dept) => {
  const saved = await post("/api/contact", { "x-visitor":owner.token }, { item:key, name:"合成測試", phone:"0912000000",
    email:"synthetic@example.com", realName:false });
  assert.equal(saved.status, 200, `contact for ${key}`);
  return write({ "x-visitor":owner.token }, "update", `reports/${owner.id}`, {
    items:{ [key]:{ author:owner.id, title, body, dept, tags:["交通號誌"], district:"大安區", createdAt:new Date().toISOString() } }
  });
};
const adminHeaders = { "x-admin":adminToken };
const deleteDoc = async (path, headers = adminHeaders) => json(await post("/api/db", headers, { op:"delete", path }));

const own = await createVisitor();
const firstOwner = await createVisitor();
const secondOwner = await createVisitor();
const thirdOwner = await createVisitor();
const fourthOwner = await createVisitor();
const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const ownKey = `my-${runId}`;
const firstKey = `other-a-${runId}`;
const secondKey = `other-b-${runId}`;
const thirdKey = `other-c-${runId}`;
const fourthKey = `other-d-${runId}`;
const ownId = `${own.id}:${ownKey}`;
const first = { id:`${firstOwner.id}:${firstKey}`, title:`合成外部案件甲 ${runId}`, dept:"工務局新工處" };
const second = { id:`${secondOwner.id}:${secondKey}`, title:`合成外部案件乙 ${runId}`, dept:"交通局" };
const third = { id:`${thirdOwner.id}:${thirdKey}`, title:`合成外部案件丙 ${runId}`, dept:"環保局" };
const fourth = { id:`${fourthOwner.id}:${fourthKey}`, title:`合成外部案件丁 ${runId}`, dept:"交通局" };
const sortOwners = await Promise.all(Array.from({ length:36 }, () => createVisitor()));
const sortCases = sortOwners.map((owner, index) => {
  const key = `sort-${runId}-${index}`;
  return { owner, key, id:`${owner.id}:${key}`, title:`合成排序案件 ${runId} ${index}`, dept:"交通局" };
});
const ownedDocs = [
  `reports/${own.id}`, `reports/${firstOwner.id}`, `reports/${secondOwner.id}`, `reports/${thirdOwner.id}`, `reports/${fourthOwner.id}`,
  ...sortOwners.map(owner => `reports/${owner.id}`),
  `votes/${own.id}`, `addenda/${own.id}`, `triage/${second.id}`
];

let browser;
try {
  await Promise.all([
    report(own, ownKey, `合成自己的案件 ${runId}`, `我的陳情入口 ${runId}`, "衛生局"),
    report(firstOwner, firstKey, first.title, `合成公開案件內容甲 ${runId}`, first.dept),
    report(secondOwner, secondKey, second.title, `合成公開案件內容乙 ${runId}`, second.dept),
    report(thirdOwner, thirdKey, third.title, `合成公開案件內容丙 ${runId}`, third.dept),
    report(fourthOwner, fourthKey, fourth.title, `合成公開案件內容丁 ${runId}`, fourth.dept)
  ]);
  await new Promise(resolve => setTimeout(resolve, 10));
  await Promise.all(sortCases.map(item => report(item.owner, item.key, item.title, `合成排序案件內容 ${runId} ${item.key}`, item.dept)));

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
      if (delayedVoteWrite && body?.path === `votes/${own.id}`) {
        const gate = delayedVoteWrite;
        delayedVoteWrite = null;
        gate.started();
        await gate.releasePromise;
      }
      if (voteFailuresRemaining && body?.path === `votes/${own.id}`) {
        voteFailuresRemaining--;
        return route.fulfill({ status:503, contentType:"application/json", body:JSON.stringify({ error:"synthetic_vote_failure" }) });
      }
    }
    return route.continue();
  });

  await page.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(id => localStorage.getItem("tit-visitor") === id, own.token);
  await page.locator('#nav [data-view="mine"]').waitFor({ state:"visible" });
  await page.waitForFunction(id => [...document.querySelectorAll("#list [data-open]")].some(el => el.dataset.open === id), ownId);
  const listedSyntheticCases = await page.locator("#list [data-open]").evaluateAll(nodes => nodes.map(node => node.dataset.open));
  assert.equal(await page.locator("#sort").inputValue(), "votes", "the navigation scenario uses the default vote sort");
  assert.ok(sortCases.filter(item => listedSyntheticCases.includes(item.id)).length >= 35, "the vote sort has at least 35 synthetic cases ahead of the older target");

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
    await page.locator("#cEmail").fill("citizen@example.com");
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
  const withDelayedAdditionAndVote = async (duringAddition, duringVote) => {
    let markStarted, releaseWrite;
    const additionGate = {
      startedPromise:new Promise(resolve => { markStarted = resolve; }),
      releasePromise:new Promise(resolve => { releaseWrite = resolve; }),
      started:() => markStarted(),
      release:() => releaseWrite()
    };
    let markVoteStarted, releaseVoteWrite;
    const voteGate = {
      startedPromise:new Promise(resolve => { markVoteStarted = resolve; }),
      releasePromise:new Promise(resolve => { releaseVoteWrite = resolve; }),
      started:() => markVoteStarted(),
      release:() => releaseVoteWrite()
    };
    delayedAdditionWrite = additionGate; delayedVoteWrite = voteGate;
    const savedAddition = page.waitForResponse(response => response.url().endsWith("/api/db") &&
      response.request().method() === "POST" && response.request().postDataJSON()?.path === `addenda/${own.id}` && response.ok(), { timeout:10000 });
    const savedVote = page.waitForResponse(response => response.url().endsWith("/api/db") &&
      response.request().method() === "POST" && response.request().postDataJSON()?.path === `votes/${own.id}` && response.ok(), { timeout:10000 });
    try {
      await page.locator('#dupBox [data-dup="add"]').click();
      await additionGate.startedPromise;
      await duringAddition();
      additionGate.release();
      await savedAddition;
      await voteGate.startedPromise;
      await duringVote();
    } finally {
      additionGate.release(); voteGate.release();
      delayedAdditionWrite = null; delayedVoteWrite = null;
    }
    await Promise.all([savedAddition, savedVote]);
  };
  const withDelayedSupplementVote = async duringVote => {
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
      await page.locator('#dupBox [data-dup="add"]').click();
      await gate.startedPromise;
      await duringVote();
    } finally {
      gate.release();
      delayedVoteWrite = null;
    }
    await savedVote;
  };
  const withDelayedSupplementVoteFailure = async duringVote => {
    let markStarted, releaseWrite;
    const gate = {
      startedPromise:new Promise(resolve => { markStarted = resolve; }),
      releasePromise:new Promise(resolve => { releaseWrite = resolve; }),
      started:() => markStarted(),
      release:() => releaseWrite()
    };
    delayedVoteWrite = gate;
    try {
      await page.locator('#dupBox [data-dup="add"]').click();
      await gate.startedPromise;
      await duringVote();
    } finally {
      gate.release();
      delayedVoteWrite = null;
    }
    await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("+1 尚未成功"));
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
  const delayedVoteAdditionText = `${additionText} 自動 +1 等待中改稿`;
  await withDelayedAdditionAndVote(
    async () => page.locator("#newText").fill(delayedAdditionText),
    async () => {
      assert.equal(await page.locator("#newBox").isVisible(), true, "the supplement form stays open until its automatic +1 is acknowledged");
      assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "the supplement stays on My reports while its automatic +1 is pending");
      await page.locator("#newText").fill(delayedVoteAdditionText);
    }
  );
  assert.equal(await page.locator("#newBox").isVisible(), true, "an edited draft stays open after the addition succeeds");
  assert.equal(await page.locator("#newText").inputValue(), delayedVoteAdditionText, "a delayed automatic +1 keeps edits made while it was pending");
  assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "an edited delayed addition does not redirect from My reports");
  assert.ok((await page.locator("#newStatus").innerText()).includes("保留"), "the status says the edited report remains");
  snapshot = await (await fetch(base + "/api/db")).json();
  assert.ok(Object.values(snapshot.addenda?.[own.id]?.items || {}).some(item => item.target === first.id && item.text === additionText), "the delayed addition saved the reviewed text");
  assert.equal(snapshot.votes?.[own.id]?.issues?.[first.id], true, "the delayed automatic +1 was acknowledged after the addition");

  await page.locator('#nav [data-view="issues"]').click();
  await page.locator("#q").fill("");
  await page.locator("#deptFilter").selectOption("");
  await page.locator("#msFilter").selectOption("");
  const orderBeforeVote = await page.locator("#list [data-open]").evaluateAll(nodes => nodes.map(node => node.dataset.open));
  const targetIndexBeforeVote = orderBeforeVote.indexOf(third.id);
  const latestSyntheticIndex = Math.max(...sortCases.map(item => orderBeforeVote.indexOf(item.id)));
  assert.ok(targetIndexBeforeVote > latestSyntheticIndex, "the unvoted supplement target starts below 35+ newer synthetic cases");
  await setMismatchedFilters(third);
  const sortedAdditionText = `合成未投票目標排序導向 ${runId}`;
  await page.locator("#newText").fill(sortedAdditionText);
  nextDuplicate = third;
  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup="add"]').waitFor({ state:"visible" });
  let viewBeforeVoteAck = "";
  let formVisibleBeforeVoteAck = false;
  await withDelayedSupplementVote(async () => {
    viewBeforeVoteAck = await page.locator('#nav button[aria-current="page"]').getAttribute("data-view");
    formVisibleBeforeVoteAck = await page.locator("#newBox").isVisible();
    const beforeAck = await (await fetch(base + "/api/db")).json();
    assert.ok(Object.values(beforeAck.addenda?.[own.id]?.items || {}).some(item => item.target === third.id && item.text === sortedAdditionText), "the synthetic supplement is saved before its automatic +1 acknowledgement");
    assert.notEqual(beforeAck.votes?.[own.id]?.issues?.[third.id], true, "the target has no prior +1 before this delayed acknowledgement");
  });
  await page.waitForFunction(() => document.querySelector("#newBox").hidden && document.querySelector('#nav [data-view="issues"]').getAttribute("aria-current") === "page");
  assert.equal(viewBeforeVoteAck, "mine", "the first supplement waits on My reports for its automatic +1 acknowledgement");
  assert.equal(formVisibleBeforeVoteAck, true, "the first supplement form stays open until its automatic +1 acknowledgement");
  assert.equal(await page.locator("#q").inputValue(), "", "successful addition clears the search");
  assert.equal(await page.locator("#deptFilter").inputValue(), "", "successful addition clears the department filter");
  assert.equal(await page.locator("#msFilter").inputValue(), "", "successful addition clears the milestone filter");
  assert.equal(await page.locator("#tabOpen").getAttribute("aria-pressed"), "true", "open target selects the open tab");
  const thirdCard = await targetVisible(third);
  assert.ok((await thirdCard.innerText()).includes(sortedAdditionText), "the first successful addition is visible in the expanded target after vote sorting updates");
  const orderAfterVote = await page.locator("#list [data-open]").evaluateAll(nodes => nodes.map(node => node.dataset.open));
  const targetIndexAfterVote = orderAfterVote.indexOf(third.id);
  const earliestSyntheticIndexAfterVote = Math.min(...sortCases.map(item => orderAfterVote.indexOf(item.id)));
  assert.ok(targetIndexAfterVote < earliestSyntheticIndexAfterVote, "the +1 snapshot sorts the target above the 35+ synthetic zero-vote cases");
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive:true });
    await page.screenshot({ path:`${evidenceDir}/supplement-open-target.png` });
  }
  snapshot = await (await fetch(base + "/api/db")).json();
  assert.ok(Object.values(snapshot.addenda?.[own.id]?.items || {}).some(item => item.target === third.id && item.text === sortedAdditionText), "the local Worker saved the synthetic addition");
  assert.equal(snapshot.votes?.[own.id]?.issues?.[third.id], true, "the local Worker saved the automatic +1");

  await page.locator('#nav [data-view="mine"]').click();
  await setMismatchedFilters(fourth);
  const partialAdditionText = `合成補充先存但 +1 失敗 ${runId}`;
  await previewDuplicate(fourth, partialAdditionText);
  nextDuplicate = fourth;
  voteFailuresRemaining = 2;
  const editedAfterPartialAddition = `${partialAdditionText} 等待 +1 時編輯`;
  await withDelayedSupplementVoteFailure(async () => {
    const beforeFailure = await (await fetch(base + "/api/db")).json();
    assert.ok(Object.values(beforeFailure.addenda?.[own.id]?.items || {}).some(item => item.target === fourth.id && item.text === partialAdditionText), "the supplement is saved before the delayed automatic +1 fails");
    assert.notEqual(beforeFailure.votes?.[own.id]?.issues?.[fourth.id], true, "the target is unvoted before the delayed automatic +1 fails");
    await page.locator("#newText").fill(editedAfterPartialAddition);
  });
  assert.equal(voteFailuresRemaining, 0, "both automatic +1 attempts failed after the supplement was saved");
  assert.equal(await page.locator("#newBox").isVisible(), true, "an edited draft stays open after the automatic +1 fails");
  assert.equal(await page.locator("#newText").inputValue(), editedAfterPartialAddition, "automatic +1 failure keeps edits made while it was pending");
  assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "an edited supplement stays on My reports after the automatic +1 fails");
  assert.ok((await page.locator("#newStatus").innerText()).includes("補充已送出；目前修改中的內容已保留"), "the form status confirms the saved supplement and retained edits");
  assert.ok((await page.locator("#toast").innerText()).includes("+1 尚未成功"), "the notice reports the partial success");
  assert.ok((await page.locator("#toast").innerText()).includes("已補充到 #"), "the notice confirms the supplement was saved");
  snapshot = await (await fetch(base + "/api/db")).json();
  assert.ok(Object.values(snapshot.addenda?.[own.id]?.items || {}).some(item => item.target === fourth.id && item.text === partialAdditionText), "the local Worker kept the supplement after the automatic +1 failed");
  assert.notEqual(snapshot.votes?.[own.id]?.issues?.[fourth.id], true, "the local Worker has no +1 for the failed automatic vote");

  await previewDuplicate(fourth, `合成等待原 +1 後再補充 ${runId}`);
  const pendingVoteSupplementText = `合成原 +1 等待中補充 ${runId}`;
  const savedPendingVoteSupplement = page.waitForResponse(response => response.url().endsWith("/api/db") &&
    response.request().method() === "POST" && response.request().postDataJSON()?.path === `addenda/${own.id}` && response.ok(), { timeout:10000 });
  await withDelayedVote(async () => {
    await previewDuplicate(fourth, pendingVoteSupplementText);
    await page.locator('#dupBox [data-dup="add"]').click();
    await savedPendingVoteSupplement;
    const whileVotePending = await (await fetch(base + "/api/db")).json();
    assert.ok(Object.values(whileVotePending.addenda?.[own.id]?.items || {}).some(item => item.target === fourth.id && item.text === pendingVoteSupplementText), "the supplement saves while the earlier +1 is still pending");
    assert.notEqual(whileVotePending.votes?.[own.id]?.issues?.[fourth.id], true, "the earlier +1 has not reached the Worker before its delayed acknowledgement");
    assert.equal(await page.locator('#nav [data-view="mine"]').getAttribute("aria-current"), "page", "supplement waits on My reports for an earlier pending +1");
    assert.equal(await page.locator("#newBox").isVisible(), true, "the supplement form stays open until the earlier +1 is acknowledged");
  });
  await page.waitForFunction(() => document.querySelector("#newBox").hidden && document.querySelector('#nav [data-view="issues"]').getAttribute("aria-current") === "page");
  const fourthCard = await targetVisible(fourth);
  assert.ok((await fourthCard.innerText()).includes(pendingVoteSupplementText), "the supplement is visible in the target after the earlier +1 acknowledgement");
  snapshot = await (await fetch(base + "/api/db")).json();
  assert.equal(snapshot.votes?.[own.id]?.issues?.[fourth.id], true, "the earlier +1 is acknowledged before the supplement redirects");
  if (evidenceDir) await page.screenshot({ path:`${evidenceDir}/supplement-pending-vote-target.png` });

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
