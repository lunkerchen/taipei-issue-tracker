// Two tabs, one identity: tab A's vote write fails after tab B already saved the same vote.
// The failed tab must keep the newer server state, not roll back to its own stale pre-write value.
// Run against a local Worker: BASE=http://localhost:8787 node worker/test/vote-failure-resync.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASE = (process.env.BASE || "http://localhost:8787").replace(/\/$/, "");
const adminHeaders = { "content-type": "application/json", "x-admin": "1" };
let browser, owner;

const pressed = (page, id) => page.evaluate(id => document.querySelector(`[data-vote="${CSS.escape(id)}"]`)?.getAttribute("aria-pressed"), id);
const toastText = page => page.evaluate(() => document.getElementById("toast").textContent);
const failVotes = async (page, before) => {
  let release;
  const gate = new Promise(r => release = r);
  await page.route("**/api/db", async route => {
    const req = route.request();
    if (req.method() === "POST" && (req.postData() || "").includes('"votes/')) {
      await gate;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "synthetic outage" }) });
    }
    return route.continue();
  });
  return { release: async () => { release(); if (before) await before(); } };
};

try {
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tabA = await context.newPage(), tabB = await context.newPage();
  for (const page of [tabA, tabB]) {
    await page.goto(`${BASE}/#issues`, { waitUntil: "domcontentloaded" });
    await page.locator("#list [data-vote]").first().waitFor({ timeout: 15000 });
  }
  const [idA, idB] = await tabA.evaluate(() => [...document.querySelectorAll("#list [data-vote]")].slice(0, 2).map(x => x.dataset.vote));
  assert.ok(idA && idB, "two open cases are on screen");
  const meA = await tabA.evaluate(() => me), meB = await tabB.evaluate(() => me);
  assert.equal(meA, meB, "both tabs share one visitor identity");
  owner = meA;
  assert.equal(await pressed(tabA, idA), "false", "the shared identity has not voted yet on the first case");

  // Tab A's write is held, then fails; tab B saves the same vote in the meantime.
  const held = await failVotes(tabA);
  await tabA.locator(`[data-vote="${idA}"]`).click();
  assert.equal(await pressed(tabA, idA), "true", "tab A shows its optimistic vote");
  await tabB.locator(`[data-vote="${idA}"]`).click();
  await tabB.waitForFunction(id => document.querySelector(`[data-vote="${CSS.escape(id)}"]`)?.getAttribute("aria-pressed") === "true", idA, { timeout: 8000 });
  await tabA.waitForFunction(id => document.querySelector(`[data-vote="${CSS.escape(id)}"]`)?.getAttribute("aria-pressed") === "true", idA, { timeout: 8000 });
  await held.release(async () => {
    await tabA.waitForFunction(() => document.getElementById("toast").textContent.includes("連不上伺服器"), null, { timeout: 8000 });
  });
  await tabA.waitForFunction(id => !pendingVoteWrites.has(id), idA, { timeout: 8000 });
  assert.equal(await pressed(tabA, idA), "true", "the failed tab keeps the newer saved vote");
  const snap = await (await fetch(`${BASE}/api/db`)).json();
  assert.equal(snap.votes?.[owner]?.issues?.[idA], true, "the server saved the vote from the other tab");

  // Without a concurrent save, a failed write still rolls back to the previous value.
  const heldB = await failVotes(tabB);
  await tabB.locator(`[data-vote="${idB}"]`).click();
  assert.equal(await pressed(tabB, idB), "true", "tab B shows its optimistic vote");
  await heldB.release(async () => {
    await tabB.waitForFunction(() => document.getElementById("toast").textContent.includes("連不上伺服器"), null, { timeout: 8000 });
  });
  await tabB.waitForFunction(id => !pendingVoteWrites.has(id), idB, { timeout: 8000 });
  assert.equal(await pressed(tabB, idB), "false", "a failed write alone rolls the button back");
  assert.equal((await (await fetch(`${BASE}/api/db`)).json()).votes?.[owner]?.issues?.[idB], undefined, "the failed vote is not stored");

  assert.ok((await toastText(tabB)).includes("連不上伺服器"), "the notice stays visible");
  console.log("failed votes resync with the newer saved state");
} finally {
  try {
    if (owner) await fetch(`${BASE}/api/db`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ op: "delete", path: `votes/${owner}` }) });
    if (browser) await browser.close();
  } catch {}
}
