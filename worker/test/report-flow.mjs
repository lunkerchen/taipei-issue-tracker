import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.REPORT_FLOW_BASE || "http://localhost:8788";
const evidenceDir = process.env.REPORT_FLOW_EVIDENCE_DIR;
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:390, height:844 } });
const page = await context.newPage();
let sampleCount = 0, releaseFirst, markFirst;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const firstStarted = new Promise(resolve => { markFirst = resolve; });
const creates = [];
let legacyContactWrites = 0;
let visitorToken = "", reportPath = "";

try {
  await page.route("**/api/sample", async route => {
    const n = sampleCount++;
    if (n === 0) { markFirst(); await firstGate; }
    await route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({
      title:`分類 ${n + 1}`, dept:"交通局", tags:["交通號誌"], category:"", district:"大安區", address:"信義路測試點",
      reason:"測試固定分類", duplicate_of:null, duplicate_reason:"", spam:false, outside_taipei:false, too_vague:false
    }) });
  });
  await page.route("**/api/contact", route => {
    if (route.request().method() === "POST") legacyContactWrites++;
    return route.fulfill({ status:200, contentType:"application/json", body:"{}" });
  });
  await page.route("**/api/health", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ai:true }) }));
  await page.route("**/api/geocode*", route => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ lat:null }) }));
  await page.route("**/api/db", async route => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      if (body.op === "create-report") {
        creates.push(body);
        if (creates.length === 1) {
          const response = await route.fetch();
          assert.equal(response.status(), 200, "first request persisted before its response was lost");
          await route.abort("failed");
          return;
        }
        if (creates.length === 2) {
          await route.fulfill({ status:503, contentType:"application/json", body:JSON.stringify({ error:"upstream_error" }) });
          return;
        }
      }
    }
    await route.continue();
  });

  await page.goto(base, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  visitorToken = await page.evaluate(() => localStorage.getItem("tit-visitor"));
  const visitorId = visitorToken.split(".")[0];
  reportPath = `reports/${visitorId}`;
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  assert.equal(await page.locator("#submitBtn").innerText(), "預覽通報");
  assert.equal(await page.locator("#cancelBtn").innerText(), "取消");
  assert.equal(await page.locator("#q").getAttribute("placeholder"), "搜尋標題、內容或行政區");
  await page.locator("#cancelBtn").click();
  assert.equal(await page.evaluate(() => document.activeElement.id), "navReport", "cancel restores focus to the form opener");
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#cName").fill("合成測試市民");
  await page.locator("#cPhone").fill("0912345678");
  await page.locator("#newText").fill("A 交通號誌故障，行人無法安全通過");
  await page.locator("#submitBtn").click();
  assert.equal(sampleCount, 0, "no preview before the citizen agrees to the privacy notice and terms");
  await page.locator("#agree").check();
  assert.equal(await page.locator("#cEmail").getAttribute("aria-required"), "true");
  assert.equal(await page.locator("#cEmail").getAttribute("type"), "text", "the page owns the email check, not the browser");
  for (const bad of ["", "not-an-email", "a@b", "a b@c.co"]) {
    await page.locator("#cEmail").fill(bad);
    await page.locator("#submitBtn").click();
    assert.equal(await page.locator("#cEmail").getAttribute("aria-invalid"), "true", `email "${bad}" is marked invalid`);
    assert.equal(await page.locator("#newStatus").innerText(), "請填寫 Email（用來通知處理進度）");
    assert.equal(await page.evaluate(() => document.activeElement.id), "cEmail", "the email error moves focus to the field");
  }
  assert.equal(sampleCount, 0, "no preview while the email is missing or malformed");
  await page.locator("#cEmail").fill(" citizen@example.com ");
  assert.equal(await page.locator("#cEmail").getAttribute("aria-invalid"), null, "typing clears the email error mark");

  await page.locator("#newText").fill("A 交通號誌故障，行人無法安全通過");
  await page.locator("#submitBtn").click();
  await firstStarted;
  await page.locator("#newText").fill("B 路口號誌故障，行人無法安全通過");
  releaseFirst();
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#dupBox").isHidden(), true, "late classification cannot show a stale preview");

  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  assert.match(await page.locator("#dupBox").innerText(), /分類 2/);
  await page.locator("#newText").fill("C 已直接編輯的通報內容足夠長");
  assert.equal(await page.locator("#dupBox").isHidden(), true, "editing text dismisses the preview");
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  await page.locator("#newDistrict").selectOption("大安區");
  assert.equal(await page.locator("#dupBox").isHidden(), true, "changing district dismisses the preview");
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  await page.locator("#cName").fill("另一位合成市民");
  assert.equal(await page.locator("#dupBox").isHidden(), true, "changing contact details dismisses the preview");
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  await page.locator("#cEmail").fill("  other@example.com  ");
  assert.equal(await page.locator("#dupBox").isHidden(), true, "changing the email dismisses the preview");
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  await page.evaluate(() => setPicked(25.033, 121.565, "gps"));
  assert.equal(await page.locator("#dupBox").isHidden(), true, "changing location dismisses the preview");

  await page.locator("#newText").fill("燈壞了");
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  await page.locator('#dupBox [data-dup="new"]').click();
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("連不上伺服器"));
  assert.equal(creates.length, 2, "write was attempted and the simulated retry failed");

  const initial = creates[0];
  assert.equal(legacyContactWrites, 0, "the form never saves an orphan contact before creation succeeds");
  assert.equal(initial.data.contact.name, "另一位合成市民", "contact travels inside the atomic report creation request");
  assert.equal(initial.data.contact.phone, "0912345678");
  assert.equal(initial.data.contact.email, "other@example.com", "the trimmed email travels inside the same request");
  assert.ok(!JSON.stringify(initial.data.item).includes("example.com"), "the email is absent from the public report item");
  assert.equal(initial.data.item.body.replace(/[\s\p{P}\p{S}]/gu, "").length, 3, "the test report is short enough to bypass duplicate text detection");
  assert.deepEqual(creates[1], initial, "automatic retry keeps the same attempt ID and payload");
  const append = await fetch(`${base}/api/db`, { method:"POST", headers:{ "content-type":"application/json", "x-visitor":visitorToken },
    body:JSON.stringify({ op:"append-note", path:reportPath, data:{ key:initial.data.key, id:crypto.randomUUID(), text:"重試前補充", photos:[] } }) });
  assert.equal(append.status, 200, "test addition is stored before the manual retry");

  const oldAttemptAt = await page.evaluate(() => {
    const timestamp = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    reportAttempt.item.createdAt = timestamp;
    return timestamp;
  });
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  await page.locator('#dupBox [data-dup="new"]').click();
  await page.waitForFunction(() => document.querySelector("#newBox").hidden);
  assert.equal(creates.length, 3, "manual re-preview uses the existing attempt");
  const withoutCreatedAt = body => {
    const copy = structuredClone(body);
    delete copy.data.item.createdAt;
    return copy;
  };
  assert.deepEqual(withoutCreatedAt(creates[2]), withoutCreatedAt(initial), "manual re-preview keeps the same report ID and payload");
  assert.ok(new Date(creates[2].data.item.createdAt) > new Date(oldAttemptAt), "manual retry refreshes a stale attempt timestamp");

  const snapshot = await (await fetch(`${base}/api/db`)).json();
  const saved = snapshot.reports?.[visitorId]?.items?.[initial.data.key];
  assert.ok(saved, "the report exists");
  assert.deepEqual(Object.keys(snapshot.reports?.[visitorId]?.items || {}), [initial.data.key], "the short report retry did not create a second item");
  assert.equal(saved.createdAt, initial.data.item.createdAt, "create-if-absent preserves the original timestamp");
  assert.equal(saved.notes?.[0]?.text, "重試前補充", "idempotent retry preserves a supplement added after the first write");
  if (evidenceDir) {
    await page.waitForFunction(() => !document.querySelector("#toast").textContent, null, { timeout:10000 });
    await mkdir(evidenceDir, { recursive:true });
    await page.screenshot({ path:`${evidenceDir}/report-flow-success.png`, fullPage:true });
  }
  console.log("OK report preview invalidation, async race, and idempotent retry");
} finally {
  if (visitorToken && reportPath) {
    await fetch(`${base}/api/db`, { method:"POST", headers:{ "content-type":"application/json", "x-visitor":visitorToken },
      body:JSON.stringify({ op:"delete", path:reportPath, data:{} }) }).catch(() => {});
  }
  await context.close();
  await browser.close();
}
