// Run against a local Worker: BASE=http://127.0.0.1:8971 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/visitor-token.mjs
// A stored token with a bad signature has the right shape but the Worker refuses it, so the page used to look writable and every write failed with 403.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://127.0.0.1:8971").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const pattern = /^[\da-f]{16}\.[\da-f]{64}$/;
const forged = "3".repeat(16) + "." + "a".repeat(64);
const visitor = headers => fetch(BASE + "/api/visitor", { method: "POST", headers, signal: AbortSignal.timeout(8000) });

const minted = await visitor();
assert.equal(minted.status, 200);
const { id: token } = await minted.json();
assert.match(token, pattern);
const echoed = await visitor({ "x-visitor": token });
assert.equal(echoed.status, 200);
assert.equal((await echoed.json()).id, token, "a correctly signed token keeps its identity");
const renewed = await visitor({ "x-visitor": forged });
assert.equal(renewed.status, 200);
const renewedToken = (await renewed.json()).id;
assert.match(renewedToken, pattern);
assert.notEqual(renewedToken, forged, "a forged token gets a new identity");

const browser = await chromium.launch();
let cleanup;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Seed the forged token once, like a browser that already has one; the page's own token must survive a reload.
  await context.addInitScript(bad => {
    try { if (!localStorage.getItem("tit-visitor")) localStorage.setItem("tit-visitor", bad); } catch {}
  }, forged);
  const page = await context.newPage();
  await page.goto(BASE + "/#issues");
  await page.waitForSelector("#list [data-vote]");
  await page.waitForFunction(bad => localStorage.getItem("tit-visitor") !== bad, forged, { timeout: 10000 });
  const stored = await page.evaluate(() => localStorage.getItem("tit-visitor"));
  assert.match(stored, pattern, "the page stores a well-formed replacement token");
  assert.notEqual(stored, forged, "the forged token is replaced before the page turns writable");
  assert.equal(await page.locator("#who").innerText(), "", "the page does not show read-only mode");
  const vote = page.locator("#list [data-vote]").first();
  assert.equal(await vote.isDisabled(), false, "the vote button is enabled");
  const issueId = await vote.getAttribute("data-vote");
  await vote.click();
  await page.waitForFunction(id => document.querySelector(`[data-vote="${CSS.escape(id)}"]`)?.getAttribute("aria-pressed") === "true", issueId, { timeout: 10000 });
  const id = stored.split(".")[0];
  cleanup = id;
  const votes = async () => (await (await fetch(BASE + "/api/db")).json()).votes[id]?.issues || {};
  for (let i = 0; i < 20 && !(await votes())[issueId]; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal((await votes())[issueId], true, "the vote is saved under the renewed identity");
  assert.ok(!(await page.locator("#toast").innerText()).includes("無法儲存"), "no failure toast");
  await page.reload();
  await page.waitForSelector("#list [data-vote]");
  await page.waitForFunction(tokenValue => localStorage.getItem("tit-visitor") === tokenValue, stored, { timeout: 10000 });
  await page.waitForFunction(id => document.querySelector(`[data-vote="${CSS.escape(id)}"]`)?.getAttribute("aria-pressed") === "true", issueId, { timeout: 10000 });
  console.log("OK");
} finally {
  if (cleanup) {
    await fetch(BASE + "/api/db", {
      method: "POST", headers: { "content-type": "application/json", "x-admin": "1" },
      body: JSON.stringify({ op: "set", path: `votes/${cleanup}`, data: null }), signal: AbortSignal.timeout(8000)
    }).catch(() => {});
  }
  await browser.close();
}
