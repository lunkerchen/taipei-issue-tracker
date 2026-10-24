import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.NOTE_LIMIT_BASE || "http://localhost:8984";
const post = (path, headers, body) => fetch(base + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  body:JSON.stringify(body), signal:AbortSignal.timeout(8000)
});
const mint = async () => {
  const response = await post("/api/visitor", {}, {});
  assert.equal(response.status, 200);
  const { id: token } = await response.json();
  return { token, id: token.split(".")[0] };
};
const contact = { name:"合成市民", phone:"0900000000", email:"citizen@example.com", realName:false };
const seed = async (person, key, count, tag) => {
  assert.equal((await post("/api/db", { "x-visitor":person.token }, { op:"create-report", path:`reports/${person.id}`,
    data:{ key, contact, item:{ title:"補充上限測試", body:"補充上限測試 " + tag, author:person.id, createdAt:new Date().toISOString() } } })).status, 200);
  for (let n = 1; n <= count; n++) {
    const response = await post("/api/db", { "x-visitor":person.token }, { op:"append-note", path:`reports/${person.id}`,
      data:{ key, id:randomUUID(), text:`既有補充 ${n}`, photos:[] } });
    assert.equal(response.status, 200, `seed note ${n}`);
  }
  return `${person.id}:${key}`;
};
const addNote = (person, key, text) => post("/api/db", { "x-visitor":person.token }, { op:"append-note", path:`reports/${person.id}`,
  data:{ key, id:randomUUID(), text, photos:[] } });
const notes = async person => (await (await fetch(base + "/api/db")).json()).reports[person.id].items[person.key].notes;

const person = await mint(), stalePerson = await mint(), tag = randomUUID();
const key = "note-limit-live", staleKey = "note-limit-stale";
const target = await seed(person, key, 9, tag);
const staleTarget = await seed(stalePerson, staleKey, 9, tag + "-stale");
person.key = key; stalePerson.key = staleKey;

const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
let liveContext, staleContext;
try {
  liveContext = await browser.newContext({ viewport:{ width:390, height:844 } });
  await liveContext.addInitScript(token => localStorage.setItem("tit-visitor", token), person.token);
  const live = await liveContext.newPage();
  await live.goto(base + "/#mine", { waitUntil:"domcontentloaded" });
  await live.locator(`[data-open="${target}"]`).waitFor({ state:"visible", timeout:30000 });
  await live.locator(`[data-open="${target}"]`).click();
  const liveForm = live.locator(`[data-note="${target}"]`);
  await liveForm.waitFor({ state:"visible" });
  assert.match(await liveForm.innerText(), /目前已 9 則/, "the form tells the citizen how many additions the case has");
  await liveForm.locator("textarea").fill("我正在輸入的補充草稿");
  assert.equal((await addNote(person, key, "第十則補充")).status, 200);

  await live.waitForFunction(target => {
    const form = document.querySelector(`[data-note="${CSS.escape(target)}"]`);
    return form && form.querySelector("textarea")?.readOnly === true;
  }, target, { timeout:10000 });
  assert.equal(await live.locator(`[data-note="${target}"] textarea`).inputValue(), "我正在輸入的補充草稿", "the draft survives the live update that reaches the limit");
  assert.match(await live.locator(`[data-note="${target}"] .note`).innerText(), /已達 10 則補充上限/, "the limit is explained");
  assert.equal(await live.locator(`[data-note="${target}"] button[type=submit]`).isDisabled(), true, "the full case cannot be submitted again");
  assert.equal(await live.locator(".addl").count(), 10, "all ten additions are shown");

  staleContext = await browser.newContext({ viewport:{ width:390, height:844 } });
  await staleContext.addInitScript(token => localStorage.setItem("tit-visitor", token), stalePerson.token);
  const stale = await staleContext.newPage();
  await stale.routeWebSocket("**/api/ws*", () => {});
  await stale.goto(base + "/#mine", { waitUntil:"domcontentloaded" });
  await stale.locator(`[data-open="${staleTarget}"]`).waitFor({ state:"visible", timeout:30000 });
  await stale.locator(`[data-open="${staleTarget}"]`).click();
  const staleForm = stale.locator(`[data-note="${staleTarget}"]`);
  await staleForm.waitFor({ state:"visible" });
  await staleForm.locator("textarea").fill("來不及更新的草稿");
  assert.equal((await addNote(stalePerson, staleKey, "另一個分頁送出的第十則")).status, 200);
  await stale.waitForTimeout(500);
  assert.match(await staleForm.innerText(), /目前已 9 則/, "the stale tab still shows the old count");
  await staleForm.locator("button[type=submit]").click();
  await stale.waitForFunction(target => document.querySelector(`[data-note="${CSS.escape(target)}"] .note`)?.textContent.includes("已達 10 則補充上限"), staleTarget, { timeout:10000 });
  assert.equal(await stale.locator(`[data-note="${staleTarget}"] textarea`).inputValue(), "來不及更新的草稿", "the rejected draft stays in the form");
  assert.equal(await stale.locator(`[data-note="${staleTarget}"] textarea`).getAttribute("readonly"), "", "the textarea stays readable for copying");
  assert.doesNotMatch(await staleForm.innerText(), /請再試一次|送出失敗/, "a full case does not ask the citizen to retry");
  assert.match(await stale.locator("#toast").innerText(), /已達 10 則補充上限/);
  assert.equal((await notes(stalePerson)).length, 10);
  assert.equal((await notes(person)).length, 10);
  console.log("OK: note limit keeps drafts, explains the limit, and does not ask for an impossible retry");
} finally {
  await liveContext?.close();
  await staleContext?.close();
  await browser.close();
  for (const p of [person, stalePerson])
    await post("/api/db", { "x-admin":"1" }, { op:"delete", path:`reports/${p.id}`, data:{} }).catch(() => {});
}
