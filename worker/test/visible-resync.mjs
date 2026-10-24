// Half-open WebSocket resync check: when a tab returns to visible after > 15s without messages,
// it must reconnect and resync without clearing active form drafts.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://localhost:8914").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const launchOptions = { headless: true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));

try {
  // Capture WebSocket instances to simulate silent drop / half-open state
  await page.addInitScript(() => {
    const OrigWS = window.WebSocket;
    window.__wsInstances = [];
    window.WebSocket = function(...args) {
      const ws = new OrigWS(...args);
      window.__wsInstances.push(ws);
      return ws;
    };
    window.WebSocket.prototype = OrigWS.prototype;
  });

  await page.goto(`${BASE}/#issues`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#list [data-open]").length > 0, null, { timeout: 15000 });

  // Open report form and fill draft
  await page.locator("#navReport").click();
  await page.locator("#newText").fill("草稿保留測試：半開連線背景恢復");
  await page.locator("#cName").fill("市民測試");
  await page.locator("#cPhone").fill("0912345678");
  await page.locator("#cEmail").fill("test@example.com");

  const countBefore = await page.evaluate(() => document.querySelectorAll("#list [data-open]").length);

  // Silently drop incoming WebSocket messages (simulate half-open socket where server drops or network dies silently)
  await page.evaluate(() => {
    const ws = window.__wsInstances[0];
    if (ws) ws.onmessage = () => {};
  });

  // Another visitor creates a report via API
  const visRes = await fetch(`${BASE}/api/visitor`, { method: "POST" });
  const { id: token } = await visRes.json();
  const visId = token.split(".")[0];
  const key = "resync-" + Date.now();
  const res = await fetch(`${BASE}/api/db`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-visitor": token },
    body: JSON.stringify({
      op: "create-report",
      path: `reports/${visId}`,
      data: {
        key,
        item: {
          title: "背景切換後同步案件 " + key,
          body: "測試內容 " + key,
          author: visId,
          createdAt: new Date().toISOString()
        },
        contact: {
          name: "外部市民",
          phone: "0987654321",
          email: "external@example.com",
          realName: false
        }
      }
    })
  });
  assert.equal(res.status, 200, "API create-report succeeded");

  // Wait a second: because WS is half-open, count must NOT update yet
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => document.querySelectorAll("#list [data-open]").length), countBefore, "count unchanged while WS is blocked");

  // Simulate tab returning to visible after > 15s
  await page.evaluate(() => {
    const realNow = Date.now;
    Date.now = () => realNow() + 20000;
    Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // Verify new case appears in the list
  await page.waitForFunction(want => document.querySelectorAll("#list [data-open]").length === want, countBefore + 1, { timeout: 15000 });

  // Verify active drafts are NOT cleared
  assert.equal(await page.locator("#newText").inputValue(), "草稿保留測試：半開連線背景恢復");
  assert.equal(await page.locator("#cName").inputValue(), "市民測試");
  assert.equal(await page.locator("#cPhone").inputValue(), "0912345678");
  assert.equal(await page.locator("#cEmail").inputValue(), "test@example.com");

  assert.deepEqual(errors, [], "no page errors");
  console.log("visible-resync: ok");
} finally {
  await browser.close();
}
