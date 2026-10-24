// Q12-03: a case gets its number once, when the Worker creates it, so citizens and staff see the same # and
// releasing or hiding an unrelated case never renumbers it.
// Run against a local Worker: BASE=http://localhost:9034 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/stable-case-number.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = (process.env.BASE || "http://localhost:9034").replace(/\/$/, "");
const ADMIN = "1";
const runId = Date.now().toString(36);

const post = async (path, headers, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const admin = { "x-admin": ADMIN };
const mint = async () => (await post("/api/visitor", {}, {})).body.id;
const snapshot = async (headers = admin) => (await fetch(BASE + "/api/db", { headers, signal: AbortSignal.timeout(10000) })).json();
const maxNumber = snap => Math.max(0, ...Object.values(snap.reports || {}).flatMap(d => Object.values(d.items || {})).map(i => Number(i?.n) || 0),
  ...Object.values(snap.triage || {}).flatMap(t => (t.events || []).filter(e => e.type === "pr").map(e => Number(e.n) || 0)));
const maxNumberExcept = (snap, owner, key) => Math.max(0,
  ...Object.entries(snap.reports || {}).flatMap(([id, d]) => Object.entries(d.items || {})
    .filter(([k]) => !(id === owner && k === key)).map(([, i]) => Number(i?.n) || 0)),
  ...Object.values(snap.triage || {}).flatMap(t => (t.events || []).filter(e => e.type === "pr").map(e => Number(e.n) || 0)));

const tokenA = await mint(), tokenB = await mint();
const ownerA = tokenA.split(".")[0], ownerB = tokenB.split(".")[0];
const keys = { aNormal: `stable-a-${runId}`, aFlagged: `stable-af-${runId}`, aLate: `stable-al-${runId}`, bNormal: `stable-b-${runId}`, bLate: `stable-bl-${runId}` };
const titles = { aNormal: `穩定編號甲 ${runId}`, aFlagged: `穩定編號待審 ${runId}`, aLate: `穩定編號甲後 ${runId}`, bNormal: `穩定編號乙 ${runId}`, bLate: `穩定編號乙後 ${runId}` };
const ids = { aNormal: `${ownerA}:${keys.aNormal}`, aFlagged: `${ownerA}:${keys.aFlagged}`, aLate: `${ownerA}:${keys.aLate}`, bNormal: `${ownerB}:${keys.bNormal}`, bLate: `${ownerB}:${keys.bLate}` };
const contact = { name: "編號測試", phone: "0912000000", email: "numbers@example.com", realName: false };
const item = (author, title, flagged = false) => ({ title, body: `穩定案件編號測試 ${title}`, createdAt: new Date().toISOString(),
  author, dept: "1999 待分派", tags: [], photos: [], notes: [], ...(flagged ? { flagged: true } : {}) });
const create = (token, owner, key, title, flagged = false) =>
  post("/api/db", { "x-visitor": token }, { op: "create-report", path: `reports/${owner}`, data: { key, item: item(owner, title, flagged), contact } });

const before = maxNumber(await snapshot());
let browser;
const written = [];

try {
  for (const [token, owner, key, title, flagged] of [
    [tokenA, ownerA, keys.aNormal, titles.aNormal, false],
    [tokenA, ownerA, keys.aFlagged, titles.aFlagged, true],
    [tokenB, ownerB, keys.bNormal, titles.bNormal, false]
  ]) {
    const saved = await create(token, owner, key, title, flagged);
    assert.equal(saved.status, 200, `created ${key}: ${saved.body.error || "ok"}`);
    assert.equal(saved.body.created, true, `${key} reports created:true`);
    const responseN = saved.body.data.items[key].n;
    assert.ok(Number.isInteger(responseN) && responseN >= 1 && responseN < 1e6, `the write response carries a stored number for ${key}: ${responseN}`);
  }
  written.push(`reports/${ownerA}`, `reports/${ownerB}`);

  const stored = async () => {
    const snap = await snapshot(), out = {};
    for (const [name, owner, key] of [["aNormal", ownerA, keys.aNormal], ["aFlagged", ownerA, keys.aFlagged], ["bNormal", ownerB, keys.bNormal]])
      out[name] = snap.reports?.[owner]?.items?.[key]?.n;
    return out;
  };
  let n = {};
  for (let k = 0; k < 60; k++) {
    n = await stored();
    if (["aNormal", "aFlagged", "bNormal"].every(name => Number.isInteger(n[name]) && n[name] > 0 && n[name] < 1e6)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  for (const name of ["aNormal", "aFlagged", "bNormal"])
    assert.ok(Number.isInteger(n[name]) && n[name] > 0 && n[name] < 1e6, `${name} got a stored number: ${n[name]}`);
  assert.equal(new Set(Object.values(n)).size, 3, `three cases have distinct numbers: ${JSON.stringify(n)}`);
  for (const name of ["aNormal", "aFlagged", "bNormal"]) assert.ok(n[name] > before, `${name} #${n[name]} is above the old issue/PR max ${before}`);
  console.log(`stored: aNormal=#${n.aNormal} aFlagged=#${n.aFlagged} bNormal=#${n.bNormal} (old max #${before})`);

  // A late case must start above every issue and PR number in use at its creation.
  assert.equal((await create(tokenB, ownerB, keys.bLate, titles.bLate)).status, 200, "created bLate");
  const lateSnap = await snapshot(), bLate = lateSnap.reports[ownerB].items[keys.bLate]?.n;
  const lateMax = maxNumberExcept(lateSnap, ownerB, keys.bLate);
  assert.ok(Number.isInteger(bLate) && bLate > lateMax, `bLate #${bLate} is above every existing issue/PR number #${lateMax}`);
  console.log(`late case: #${bLate} > existing max #${lateMax}`);

  // A visitor cannot choose a number through the generic update path, and an existing case keeps its stored number.
  const planted = 424242;
  const generic = await post("/api/db", { "x-visitor": tokenA }, { op: "update", path: `reports/${ownerA}`,
    data: { items: { [keys.aLate]: { ...item(ownerA, titles.aLate), n: planted } } } });
  assert.equal(generic.status, 200, `generic update accepted: ${generic.body.error || "ok"}`);
  const afterGeneric = await snapshot(), aLate = afterGeneric.reports[ownerA].items[keys.aLate]?.n;
  assert.ok(Number.isInteger(aLate) && aLate > 0 && aLate < 1e6, `the Worker numbered the generic new item: ${aLate}`);
  assert.notEqual(aLate, planted, "a visitor-supplied number is ignored");
  assert.ok(aLate > maxNumberExcept(afterGeneric, ownerA, keys.aLate), `the generic new item #${aLate} is above every existing number`);
  assert.equal(afterGeneric.reports[ownerA].items[keys.aNormal].n, n.aNormal, "an existing case keeps its stored number after a visitor update");
  console.log(`generic write: planted #${planted} became #${aLate}; aNormal stays #${n.aNormal}`);

  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
  const errors = [];
  const open = async (token, hash) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    if (token) await page.addInitScript(t => localStorage.setItem("tit-visitor", t), token);
    await page.goto(`${BASE}/${hash}`, { waitUntil: "domcontentloaded" });
    return { context, page };
  };
  const shown = async (page, title) => {
    await page.locator("#q").fill(title);
    const row = page.locator("#list .issue").filter({ has: page.locator(".title", { hasText: title }) }).first();
    await row.waitFor({ state: "visible", timeout: 20000 });
    const text = (await row.locator(".meta").first().innerText()).trim();
    const m = /^#(\d+)/.exec(text);
    assert.ok(m, `the list shows a # for ${title}: ${text}`);
    return Number(m[1]);
  };

  const staff = await open(null, "?admin#issues");
  const citizenA = await open(tokenA, "?citizen#issues");
  const citizenB = await open(tokenB, "?citizen#issues");
  try {
    // Same number for staff and for the owner in the citizen view.
    assert.equal(await shown(staff.page, titles.aNormal), n.aNormal, "admin sees A's stored number");
    assert.equal(await shown(citizenA.page, titles.aNormal), n.aNormal, "A's citizen view sees the same number");
    assert.equal(await shown(staff.page, titles.bNormal), n.bNormal, "admin sees B's stored number");
    assert.equal(await shown(citizenB.page, titles.bNormal), n.bNormal, "B's citizen view sees the same number");
    assert.notEqual(n.aNormal, n.bNormal, "two visitors' cases have distinct numbers");

    // The flagged case is not public yet: admin sees it, A's citizen view does not.
    assert.equal(await shown(staff.page, titles.aFlagged), n.aFlagged, "admin sees the flagged case number");
    await citizenA.page.locator("#q").fill(titles.aFlagged);
    await citizenA.page.waitForFunction(t => typeof issues !== "undefined" && !issues.some(i => i.title === t), titles.aFlagged, { timeout: 15000 });
    assert.equal(await citizenA.page.locator("#list .issue").filter({ has: citizenA.page.locator(".title", { hasText: titles.aFlagged }) }).count(), 0,
      "the flagged case is hidden from the owner until released");

    // Release the unrelated flagged case: A's normal case must keep its number in both views.
    const triagePath = `triage/${ids.aFlagged}`;
    assert.equal((await post("/api/db", admin, { op: "set", path: triagePath, data: { status: "open", hidden: false, events: [] } })).status, 200, "released the flagged case");
    written.push(triagePath);
    const released = await shown(citizenA.page, titles.aFlagged);
    assert.equal(released, n.aFlagged, "A's citizen view sees the same number after release");
    assert.equal(await shown(staff.page, titles.aFlagged), n.aFlagged, "admin keeps the same number after release");
    assert.equal(await shown(citizenA.page, titles.aNormal), n.aNormal, "A's normal case keeps its number after release (citizen)");
    assert.equal(await shown(staff.page, titles.aNormal), n.aNormal, "A's normal case keeps its number after release (admin)");

    // Hide it again: A's normal case still keeps its number.
    assert.equal((await post("/api/db", admin, { op: "set", path: triagePath, data: { status: "open", hidden: true, events: [] } })).status, 200, "hid the flagged case again");
    await citizenA.page.locator("#q").fill(titles.aNormal);
    await citizenA.page.waitForFunction(t => typeof issues !== "undefined" && !issues.some(i => i.title === t), titles.aFlagged, { timeout: 15000 });
    assert.equal(await shown(citizenA.page, titles.aNormal), n.aNormal, "A's normal case keeps its number after hiding (citizen)");
    assert.equal(await shown(staff.page, titles.aNormal), n.aNormal, "A's normal case keeps its number after hiding (admin)");
    assert.equal(await shown(staff.page, titles.aFlagged), n.aFlagged, "admin keeps the flagged number after hiding");

    // Reload and a fresh snapshot: the stored numbers do not move.
    await citizenA.page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await shown(citizenA.page, titles.aNormal), n.aNormal, "A's number survives a reload");
    const fresh = await snapshot(), again = await stored();
    assert.deepEqual(again, n, "a new snapshot returns the same stored numbers");
    assert.equal(fresh.reports[ownerA].items[keys.aFlagged].n, n.aFlagged, "the flagged case keeps its stored number in a new snapshot");
    assert.equal(await shown(staff.page, titles.aNormal), n.aNormal, "admin still shows the same number");

    assert.deepEqual(errors, [], "no page errors");
    console.log("stable case numbers OK");
  } finally {
    for (const { context } of [staff, citizenA, citizenB]) await context.close().catch(() => {});
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const path of new Set(written)) await post("/api/db", admin, { op: "delete", path }).catch(() => {});
}
