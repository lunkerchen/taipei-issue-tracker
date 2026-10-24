import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.ADDENDUM_LABEL_BASE || "http://localhost:8983";
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
const admin = { "x-admin":"1" };
const mine = await mint(), other = await mint(), tag = randomUUID(), key = "addendum-label";
const target = `${mine.id}:${key}`;
const contact = { name:"合成市民", phone:"0900000000", email:"citizen@example.com", realName:false };
assert.equal((await post("/api/db", { "x-visitor":mine.token }, { op:"create-report", path:`reports/${mine.id}`,
  data:{ key, contact, item:{ title:"補充標籤測試", body:"補充標籤測試 " + tag, author:mine.id, createdAt:new Date().toISOString() } } })).status, 200);
for (const [who, text] of [[mine, "自己的補充"], [other, "別人的補充"]]) {
  const response = await post("/api/db", { "x-visitor":who.token }, { op:"append-addendum", path:`addenda/${who.id}`,
    data:{ id:randomUUID(), target, text, photos:[] } });
  assert.equal(response.status, 200, "seed addendum " + text);
}

const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:390, height:844 } });
await context.addInitScript(token => localStorage.setItem("tit-visitor", token), mine.token);
const page = await context.newPage();
try {
  await page.goto(base + "/#mine", { waitUntil:"domcontentloaded" });
  const card = page.locator(`[data-open="${target}"]`);
  await card.waitFor({ state:"visible", timeout:30000 });
  await card.click();
  await page.waitForFunction(target => {
    const card = document.querySelector(`[data-open="${CSS.escape(target)}"]`)?.closest(".issue");
    return card && card.querySelectorAll(".addl").length >= 2;
  }, target, { timeout:10000 });
  const labels = await page.locator(".addl").evaluateAll(nodes => nodes.map(n => ({ meta:n.querySelector(".meta").textContent, body:n.querySelector(".body")?.textContent || "" })));
  const own = labels.find(x => x.body === "自己的補充"), foreign = labels.find(x => x.body === "別人的補充");
  assert.ok(own, "own addendum is shown");
  assert.match(own.meta, /^市民補充/, "own addendum is labelled as a citizen addition, not another citizen's");
  assert.ok(foreign, "another visitor's addendum is shown");
  assert.match(foreign.meta, /^其他市民補充/, "another visitor's addendum is still labelled separately");
  assert.match(await page.locator("form.addnote").innerText(), /新增補充/, "own additions count toward the note limit, so the form is still available below 10");
  console.log("OK: own addendum is labelled as a citizen addition and another visitor's stays separate");
} finally {
  await context.close();
  await browser.close();
  for (const path of [`reports/${mine.id}`, `addenda/${mine.id}`, `addenda/${other.id}`])
    await post("/api/db", admin, { op:"delete", path, data:{} }).catch(() => {});
}
