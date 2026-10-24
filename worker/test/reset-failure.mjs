// A failed reset must not leave the status stuck at "重設中…".
// Run against a local Worker: BASE=http://127.0.0.1:8941 node worker/test/reset-failure.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/Users/lunker/.local/lib/node_modules/playwright");

const BASE = (process.env.BASE || "http://127.0.0.1:8941").replace(/\/$/, "");
const ADMIN = "1", headers = { "content-type": "application/json", "x-admin": ADMIN };
const post = async (path, body, h = headers) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: r.status, body: await r.json() };
};
const token = (await post("/api/visitor", {})).body.id, owner = token.split(".")[0];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const newPage = async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/?admin#admin`);
  await page.locator("#seedBtn").waitFor({ state: "visible", timeout: 15000 });
  return page;
};
try {
  // 1) The whole seed reset fails.
  let page = await newPage();
  await page.route("**/api/reset", route => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"qa"}' }));
  await page.locator("#seedBtn").click();
  await page.locator("#seedBtn").click();
  await page.waitForFunction(() => !document.querySelector("#snapStatus").textContent.includes("重設中…"), null, { timeout: 5000 });
  let status = await page.locator("#snapStatus").textContent();
  assert.match(status, /重設沒有完成/, "seed reset failure explains what happened");
  assert.equal(await page.locator("#seedBtn").isEnabled(), true, "seed button is usable again");
  assert.match(await page.locator("#toast").textContent(), /連不上伺服器/, "the toast still explains the network error");
  await page.close();

  // 2) The snapshot reset fails halfway through its writes.
  page = await newPage();
  await page.locator("#snapBtn").click();
  await page.locator("#snapStatus").filter({ hasText: "已儲存快照" }).waitFor({ timeout: 15000 });
  const key = `reset-fail-${Date.now().toString(36)}`;
  assert.equal((await post("/api/db", { op: "create-report", path: `reports/${owner}`, data: { key,
    item: { id: key, n: 1, title: `RESET FAIL ${key}`, body: "body", createdAt: new Date().toISOString(), dept: "環保局",
      district: "大安區", tags: [], author: owner, status: "open", photos: [], notes: [] },
    contact: { name: "合成市民", phone: "0912345678", email: "citizen@example.com", realName: false } } },
    { "content-type": "application/json", "x-visitor": token })).status, 200, "new report after the snapshot");
  await page.waitForTimeout(800);
  await page.route("**/api/db", route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"qa"}' }) : route.continue());
  await page.locator("#resetBtn").click();
  await page.locator("#resetBtn").click();
  await page.waitForFunction(() => !document.querySelector("#snapStatus").textContent.includes("重設中…"), null, { timeout: 5000 });
  status = await page.locator("#snapStatus").textContent();
  assert.match(status, /重設沒有完成/, "snapshot reset failure explains what happened");
  assert.equal(await page.locator("#resetBtn").isEnabled(), true, "snapshot reset button is usable again");
  await page.close();
  console.log("reset failures clear their status");
} finally {
  await browser.close();
  await fetch(`${BASE}/api/db`, { method: "POST", headers, body: JSON.stringify({ op: "delete", path: `reports/${owner}` }) }).catch(() => {});
  await fetch(`${BASE}/api/db`, { method: "POST", headers, body: JSON.stringify({ op: "delete", path: "demo/snapshot" }) }).catch(() => {});
}
