// Long unbroken tokens must wrap inside report cards and the admin queue instead of overlapping controls.
// Run: BASE=http://localhost:8788 PLAYWRIGHT_MODULE=... node worker/test/long-token-wrap.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});

const token = (await (await post("/api/visitor", {}, {})).json()).id, id = token.split(".")[0];
const key = "long-" + Date.now().toString(36), marker = "overflow" + crypto.randomUUID().slice(0, 8), now = new Date().toISOString();
const created = await post("/api/db", { "x-visitor":token }, { op:"create-report", path:`reports/${id}`, data:{
  key,
  item:{ author:id, title:"W".repeat(200), body:"A".repeat(1900) + " " + marker, createdAt:now, district:"大安區", dept:"1999 待分派",
    address:"Z".repeat(100), notes:[{ t:now, text:"N".repeat(500) }] },
  contact:{ name:"長字串測試", phone:"0912000000", email:"long@example.com", realName:false }
} });
assert.equal(created.status, 200, "seed a report with unbroken tokens");

const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const measureCard = () => {
  const card = [...document.querySelectorAll(".issue")].find(c => (c.querySelector(".title")?.textContent || "").trim().length > 100);
  if (!card) return { missing:true };
  const rect = el => el.getBoundingClientRect();
  const title = card.querySelector(".title"), vote = card.querySelector(".vote");
  const tr = rect(title), vr = rect(vote), cr = rect(card);
  const bodies = [...card.querySelectorAll(".body")], metas = [...card.querySelectorAll(".meta")];
  return {
    vw:innerWidth, docW:document.documentElement.scrollWidth,
    cardRight:cr.right, cardWidth:cr.width, titleRight:tr.right, titleWidth:tr.width,
    titleScroll:title.scrollWidth, titleClient:title.clientWidth,
    overlap:tr.right > vr.left + 1 && tr.left < vr.right - 1 && tr.bottom > vr.top + 1 && tr.top < vr.bottom - 1,
    bodyCount:bodies.length, bodyOverflow:bodies.filter(b => b.scrollWidth > b.clientWidth + 1).length,
    metaOverflow:metas.filter(m => m.scrollWidth > m.clientWidth + 1).length
  };
};

try {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const context = await browser.newContext({ viewport:{ width, height } });
    const page = await context.newPage();
    await page.goto(BASE + "/#issues", { waitUntil:"networkidle" });
    await page.fill("#q", marker);
    await page.waitForFunction(() => document.querySelectorAll(".issue").length === 1, null, { timeout:10000 });
    const row = await page.evaluate(measureCard);
    assert.ok(!row.missing, `long report is visible at ${width}px`);
    assert.ok(row.docW <= row.vw + 1, `no page overflow at ${width}px (${row.docW} <= ${row.vw})`);
    assert.ok(row.titleRight <= row.cardRight + 1, `title stays inside the card at ${width}px (${row.titleRight} <= ${row.cardRight})`);
    assert.ok(row.titleScroll <= row.titleClient + 1, `title text wraps at ${width}px (${row.titleScroll} <= ${row.titleClient})`);
    assert.ok(!row.overlap, `title does not overlap +1 at ${width}px`);

    await page.locator(".issue .title").first().click();
    await page.waitForSelector(".issue .detail .body", { timeout:10000 });
    const detail = await page.evaluate(measureCard);
    assert.ok(detail.bodyCount >= 2, `report body and note render at ${width}px`);
    assert.equal(detail.bodyOverflow, 0, `body and note text wrap at ${width}px`);
    assert.equal(detail.metaOverflow, 0, `address and metadata wrap at ${width}px`);
    await context.close();
  }

  const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const page = await context.newPage();
  await page.goto(BASE + "/?admin#admin", { waitUntil:"networkidle" });
  await page.waitForFunction(() => [...document.querySelectorAll(".row-item .title")].some(b => b.textContent.trim().length > 100), null, { timeout:10000 });
  const queue = await page.evaluate(() => {
    const title = [...document.querySelectorAll(".row-item .title")].find(b => b.textContent.trim().length > 100);
    const row = title.closest(".row-item"), grow = title.closest(".grow");
    const tr = title.getBoundingClientRect(), rr = row.getBoundingClientRect(), gr = grow.getBoundingClientRect();
    return { vw:innerWidth, docW:document.documentElement.scrollWidth, titleRight:tr.right, rowRight:rr.right,
      growWidth:gr.width, growScroll:grow.scrollWidth, growClient:grow.clientWidth };
  });
  assert.ok(queue.docW <= queue.vw + 1, `admin console has no page overflow (${queue.docW} <= ${queue.vw})`);
  assert.ok(queue.titleRight <= queue.rowRight + 1, `admin queue title stays inside its row (${queue.titleRight} <= ${queue.rowRight})`);
  assert.ok(queue.growScroll <= queue.growClient + 1, `admin queue title wraps (${queue.growScroll} <= ${queue.growClient})`);
  await context.close();
} finally {
  await browser.close();
  await post("/api/db", { "x-admin":"1" }, { op:"delete", path:`reports/${id}` });
}
console.log("long-token-wrap: ok");
