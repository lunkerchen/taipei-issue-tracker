import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});

const visitor = await (await post("/api/visitor")).json();
const [visitorId] = visitor.id.split(".");
const key = "mine-hidden-case";
const id = `${visitorId}:${key}`;
const title = `我的隱藏案件測試 ${crypto.randomUUID().slice(0, 8)}`;
const own = { title, body:`本機合成我的陳情測試 ${crypto.randomUUID()}`,
  createdAt:new Date().toISOString(), author:visitorId, dept:"1999 待分派", tags:[], photos:[], notes:[] };
assert.equal((await post("/api/contact", { "x-visitor":visitor.id }, { item:key, name:"回歸測試", phone:"0912000000",
  email:"test@example.com", realName:false })).status, 200, "save contact before creating a case");
assert.equal((await post("/api/db", { "x-visitor":visitor.id },
  { op:"update", path:`reports/${visitorId}`, data:{ items:{ [key]:own } } })).status, 200,
  "create a private test case");

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
const openMine = async () => {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), visitor.id);
  await page.goto(BASE, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await page.locator('#nav button[data-view="mine"]').click();
  return { context, page, errors };
};
try {
  const first = await openMine();
  try {
    await first.page.locator("#list .title").filter({ hasText:title }).waitFor({ state:"visible", timeout:15000 });

    assert.equal((await post("/api/db", { "x-admin":"1" },
      { op:"set", path:`triage/${id}`, data:{ hidden:true, status:"open", events:[] } })).status, 200,
      "hide the private test case");
    const empty = first.page.locator("#list .empty");
    await empty.waitFor({ state:"visible", timeout:15000 });
    await first.page.waitForFunction(() => document.querySelector("#list .empty")?.textContent.includes("未公開"), null, { timeout:15000 });
    const text = await empty.textContent();
    assert.ok(!text.includes("你還沒有送出陳情"), "the live update does not claim the citizen sent nothing");
    assert.equal((await (await fetch(BASE + "/api/mine", { headers:{ "x-visitor":visitor.id } })).json()).hidden, 1,
      "the owner-only count reports the hidden case");
    assert.deepEqual(first.errors, [], "no page errors");
    console.log(`390 OK live hide: ${text.trim()}`);
  } finally {
    await first.context.close();
  }

  const second = await openMine();
  try {
    const empty = second.page.locator("#list .empty");
    await empty.waitFor({ state:"visible", timeout:15000 });
    await second.page.waitForFunction(() => document.querySelector("#list .empty")?.textContent.includes("未公開"), null, { timeout:15000 });
    assert.deepEqual(second.errors, [], "no page errors");
    console.log(`390 OK after reload: ${(await empty.textContent()).trim()}`);
  } finally {
    await second.context.close();
  }

  const other = await (await post("/api/visitor")).json();
  const third = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const page = await third.newPage();
  await page.addInitScript(token => localStorage.setItem("tit-visitor", token), other.id);
  await page.goto(BASE, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);
  await page.locator('#nav button[data-view="mine"]').click();
  const empty = page.locator("#list .empty");
  await empty.waitFor({ state:"visible", timeout:15000 });
  assert.ok((await empty.textContent()).includes("你還沒有送出陳情"), "a visitor with no reports still gets the first-report message");
  await third.close();
  console.log("390 OK a visitor with no reports keeps the first-report message");
  console.log("OK my reports distinguishes a hidden case from no reports");
} finally {
  await browser.close();
  await post("/api/db", { "x-admin":"1" }, { op:"delete", path:`triage/${id}` }).catch(() => {});
  await post("/api/db", { "x-admin":"1" }, { op:"delete", path:`reports/${visitorId}` }).catch(() => {});
}
