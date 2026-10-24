// Browser regression for phone masking in report previews, report writes and own-report additions.
// Run against the default `wrangler dev --port 8788`. PLAYWRIGHT_MODULE and CHROME_EXECUTABLE_PATH are optional.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PHONE_MASK_BASE || "http://localhost:8788";
const evidenceDir = process.env.PHONE_MASK_EVIDENCE_DIR;
const browserOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) browserOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(browserOptions);
const context = await browser.newContext({ viewport:{ width:390, height:844 } });
const page = await context.newPage();
let visitorId = "", visitorToken = "";
let seq = 0, data = { reports:{}, triage:{}, votes:{}, pullRequests:{}, milestones:{} };
let prompt = "", contact = null, reportWrite = null, noteWrite = null;
const json = (body, status = 200) => ({ status, contentType:"application/json", body:JSON.stringify(body) });

try {
  await page.route("**/api/health", route => route.fulfill(json({ ai:true })));
  await page.route("**/api/sample", async route => {
    prompt = route.request().postDataJSON().prompt;
    await route.fulfill(json({
      title:"路燈閃爍", dept:"交通局", tags:["交通號誌"], category:"", district:"大安區", address:"信義路四段 200 號",
      reason:"測試固定分類", duplicate_of:null, duplicate_reason:"", spam:false, outside_taipei:false, too_vague:false
    }));
  });
  await page.route("**/api/contact", async route => {
    if (route.request().method() === "POST") {
      contact = route.request().postDataJSON();
      return route.fulfill(json({ saved:true }));
    }
    return route.fulfill(json({ error:"not_found" }, 404));
  });
  await page.route("**/api/geocode*", route => route.fulfill(json({ lat:null })));
  await page.route("**/api/db", async route => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill(json({ _seq:seq, ...data }));
    const body = req.postDataJSON();
    if (body.op === "create-report") {
      reportWrite = body;
      const doc = data.reports[visitorId] ||= { items:{} };
      doc.items[body.data.key] = body.data.item;
      seq++;
      return route.fulfill(json({ data:doc, seq, created:true }));
    }
    if (body.op === "append-note") {
      noteWrite = body;
      const doc = data.reports[visitorId], item = doc.items[body.data.key];
      item.notes ||= [];
      item.notes.push({ id:body.data.id, text:body.data.text, photos:body.data.photos, t:new Date().toISOString() });
      seq++;
      return route.fulfill(json({ data:doc, seq }));
    }
    return route.fulfill(json({ data:{}, seq:++seq }));
  });
  await page.route("**/api/news", route => route.fulfill(json({ items:[] })));

  await page.goto(base, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  visitorToken = await page.evaluate(() => localStorage.getItem("tit-visitor"));
  visitorId = visitorToken.split(".")[0];
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#cName").fill("合成測試市民");
  await page.locator("#cPhone").fill("0912000111");
  await page.locator("#cEmail").fill("citizen@example.com");
  const reportText = "信義路四段 200 號前，路燈閃爍。電話：０９１２ ／ ３４５ ／ ６７８，Email report@example.com，身分證 A123456789。";
  const maskedReport = "信義路四段 200 號前，路燈閃爍。電話：［已遮蔽］，Email ［已遮蔽］，身分證 ［已遮蔽］。";
  await page.locator("#newText").fill(reportText);
  await page.locator("#agree").check();
  await page.locator("#submitBtn").click();
  await page.locator('#dupBox [data-dup="new"]').waitFor({ state:"visible" });
  assert.ok(prompt.includes(maskedReport), "Claude receives the masked report text");
  assert.ok(!prompt.includes("０９１２ ／ ３４５ ／ ６７８") && !prompt.includes("report@example.com") && !prompt.includes("A123456789"), "Claude does not receive report PII");
  await page.locator('#dupBox [data-dup="new"]').click();
  await page.waitForFunction(() => document.querySelector("#newBox").hidden);
  assert.equal(reportWrite?.data.item.body, maskedReport, "the public report body stays masked");
  const contactData = reportWrite?.data?.contact ?? contact;
  assert.ok(contactData, "the report flow sends contact data through its private field");
  assert.deepEqual({ name:contactData.name, phone:contactData.phone, email:contactData.email, realName:contactData.realName },
    { name:"合成測試市民", phone:"0912000111", email:"citizen@example.com", realName:false }, "contact field keeps the supplied private values");

  await page.locator('#list form[data-note]').waitFor({ state:"visible" });
  const noteText = "補充：電話 0912 / 345 / 678，舊格式 0912--345--678，換行格式 0912\r\n345\r\n678，國際格式 00886 / 912 / 345 / 678，市話 02 / 2720 / 8889，國碼市話 +886-2-2720-8889，破折號 0912–345–678，Email note@example.com，身分證 B234567890。";
  const maskedNote = "補充：電話 ［已遮蔽］，舊格式 ［已遮蔽］，換行格式 ［已遮蔽］，國際格式 ［已遮蔽］，市話 ［已遮蔽］，國碼市話 ［已遮蔽］，破折號 ［已遮蔽］，Email ［已遮蔽］，身分證 ［已遮蔽］。";
  const note = page.locator('#list form[data-note]');
  await note.locator("textarea").fill(noteText);
  await note.locator('button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("已補充"));
  assert.equal(noteWrite?.op, "append-note");
  assert.equal(noteWrite?.data.text, maskedNote, "the own-report append payload stays masked");
  assert.ok(!JSON.stringify(reportWrite?.data?.item || {}).includes("0912000111"), "the private contact phone is absent from the public report item");
  assert.ok(!JSON.stringify(noteWrite?.data || {}).includes("0912000111"), "the private contact phone is absent from the append payload");
  assert.ok(!JSON.stringify(reportWrite?.data?.item || {}).includes("citizen@example.com"), "the private contact email is absent from the public report item");
  assert.ok(!JSON.stringify(noteWrite?.data || {}).includes("citizen@example.com"), "the private contact email is absent from the append payload");
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive:true });
    await page.screenshot({ path:`${evidenceDir}/phone-mask.png`, fullPage:true });
  }
  console.log("OK report preview, public report body, private contact field and own-report addition masking");
} finally {
  await context.close();
  await browser.close();
}
