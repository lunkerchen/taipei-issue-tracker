import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  body:JSON.stringify(body), signal:AbortSignal.timeout(10000)
});
const mint = async () => {
  const { id } = await (await post("/api/visitor", {}, {})).json();
  return { token:id, id:id.split(".")[0] };
};

const owner = await mint(), marker = randomUUID(), key = "dup-" + randomUUID();
const body = `重複補充聯絡測試 ${marker} 路燈不亮`;
const ownerContact = { name:"原通報人", phone:"0911111111", email:"owner@example.com", realName:false };
const created = await post("/api/db", { "x-visitor":owner.token }, {
  op:"create-report", path:`reports/${owner.id}`,
  data:{ key, contact:ownerContact, item:{ title:"重複補充聯絡測試", body, author:owner.id, createdAt:new Date().toISOString(),
    dept:"1999 待分派", tags:[], photos:[], notes:[] } }
});
assert.equal(created.status, 200, "the original report is created");
assert.equal((await created.json()).created, true);
const caseId = `${owner.id}:${key}`;

const supplementerContact = { name:"補充測試市民", phone:"0922333444", email:"supplement@example.com" };
const browser = await chromium.launch({ headless:true });
let supplementer = "";

try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  supplementer = await page.evaluate(() => localStorage.getItem("tit-visitor").split(".")[0]);
  await page.locator("#navReport").click();
  await page.locator("#newBox").waitFor({ state:"visible" });
  await page.locator("#cName").fill(supplementerContact.name);
  await page.locator("#cPhone").fill(supplementerContact.phone);
  await page.locator("#cEmail").fill(supplementerContact.email);
  await page.locator("#newText").fill(body);
  await page.locator("#agree").check();
  await page.locator("#submitBtn").click();
  await page.locator("#dupBox").waitFor({ state:"visible" });
  assert.match(await page.locator("#dupBox").innerText(), /確認送出前，請看一下 1999 的分類結果/);
  await page.locator('[data-dup="new"]').click();
  await page.locator('[data-dup="add"]').waitFor({ state:"visible", timeout:15000 });

  const dupText = await page.locator("#dupBox").innerText();
  assert.ok(dupText.includes("「補充到」會保存你的聯絡資料；「只按 +1」不會"),
    "the duplicate prompt says which action saves contact");

  await page.locator('[data-dup="add"]').click();
  await page.locator("#newBox").waitFor({ state:"hidden", timeout:15000 });

  const snapshot = await (await fetch(BASE + "/api/db")).json();
  const addenda = Object.entries(snapshot.addenda?.[supplementer]?.items || {})
    .find(([, item]) => item.target === caseId);
  assert.ok(addenda, "the supplement is stored under the supplementer");
  const [addendumId] = addenda;

  const contactResponse = await fetch(`${BASE}/api/contact?id=${encodeURIComponent(`${supplementer}:${addendumId}`)}`, {
    headers:{ "x-admin":"1" }, signal:AbortSignal.timeout(10000)
  });
  assert.equal(contactResponse.status, 200);
  const saved = (await contactResponse.json()).contact;
  assert.ok(saved, "the supplementer contact is saved with the addendum");
  assert.equal(saved.name, supplementerContact.name);
  assert.equal(saved.phone, supplementerContact.phone);
  assert.equal(saved.email, supplementerContact.email);

  const admin = await context.newPage();
  await admin.goto(BASE + "/?admin#issues", { waitUntil:"domcontentloaded" });
  await admin.waitForFunction(() => !document.querySelector("#navReport").hidden);
  await admin.locator(`.title`, { hasText:"重複補充聯絡測試" }).first().click();
  const contactButton = admin.locator(`[data-contact="${supplementer}:${addendumId}"]`);
  await contactButton.waitFor({ state:"visible", timeout:15000 });
  await contactButton.click();
  const note = admin.locator(".addl").filter({ hasText:"補充測試市民" }).first();
  await note.waitFor({ state:"visible", timeout:10000 });
  assert.match(await note.innerText(), /0922333444.*supplement@example\.com/);

  console.log("OK supplement contact: joining a duplicate saves the contact and the admin can read it");
} finally {
  await browser.close();
  await fetch(`${BASE}/api/db`, { method:"POST", headers:{ "content-type":"application/json", "x-admin":"1" },
    body:JSON.stringify({ op:"delete", path:`reports/${owner.id}` }) }).catch(() => {});
  const snapshot = await (await fetch(BASE + "/api/db")).json().catch(() => ({}));
  for (const person of [owner.id, supplementer]) {
    if (snapshot.addenda?.[person]) await fetch(`${BASE}/api/db`, { method:"POST", headers:{ "content-type":"application/json", "x-admin":"1" },
      body:JSON.stringify({ op:"delete", path:`addenda/${person}` }) }).catch(() => {});
    if (snapshot.votes?.[person]) await fetch(`${BASE}/api/db`, { method:"POST", headers:{ "content-type":"application/json", "x-admin":"1" },
      body:JSON.stringify({ op:"delete", path:`votes/${person}` }) }).catch(() => {});
  }
}
