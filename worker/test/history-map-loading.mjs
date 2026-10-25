import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.HISTORY_MAP_LOADING_BASE || "http://localhost:8788";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;

const fixture = {
  roads:[["大安區", "信義路", 25.033, 121.565, true]],
  items:[["測試派工", "none"]],
  days:{ "2026-09-30":[[0, 0, 830]] }
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];

async function withMap({ width, height, holdLeaflet = false, leafletFailures = 0, historyDelay = 0, historyFailures = 0 }) {
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport:{ width, height } });
  const page = await context.newPage();
  const counts = { leaflet:0, history:0 };
  let failedLeaflets = leafletFailures, failedHistories = historyFailures;
  // A held Leaflet request waits for the test to release it, so a slow page load cannot finish the map before the pending checks.
  let releaseLeaflet;
  const leafletHeld = new Promise(resolve => releaseLeaflet = resolve);
  await page.route("**/leaflet.min.js", async route => {
    counts.leaflet++;
    if (failedLeaflets > 0) { failedLeaflets--; return route.abort("failed"); }
    if (holdLeaflet) await leafletHeld;
    return route.continue();
  });
  await page.route("**/history-2026.json", async route => {
    counts.history++;
    if (failedHistories > 0) {
      failedHistories--;
      return route.fulfill({ status:503, contentType:"application/json", body:"{}" });
    }
    if (historyDelay) await pause(historyDelay);
    return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify(fixture) });
  });
  await page.route("https://wmts.nlsc.gov.tw/**", route => route.fulfill({ status:204, body:"" }));
  await page.goto(`${base}/#map`, { waitUntil:"domcontentloaded" });
  await page.locator("#tline:not([hidden])").waitFor({ state:"visible" });
  if (holdLeaflet || leafletFailures) {
    assert.equal(counts.leaflet, 1, "the map has started its Leaflet request");
    assert.equal(await page.locator("#map").evaluate(el => el.classList.contains("leaflet-container")), false, "the delayed or failed Leaflet request keeps the map pending");
  }
  return { browser, context, page, counts, releaseLeaflet };
}

async function record(name, run) {
  try {
    const details = await run();
    results.push({ name, status:"passed", ...details });
  } catch (error) {
    results.push({ name, status:"failed", error:String(error) });
    throw error;
  }
}

async function close({ browser, context }) {
  await context.close();
  await browser.close();
}

try {
  for (const viewport of [{ width:1440, height:1000 }, { width:390, height:844 }]) {
    await record(`queued-history-shows-after-leaflet-${viewport.width}`, async () => {
      const run = await withMap({ ...viewport, holdLeaflet:true });
      try {
        await run.page.locator("#histOn").click();
        assert.equal(await run.page.locator("#histOn").isChecked(), true, "the user's history selection stays checked while the map loads");
        assert.match(await run.page.locator("#histCount").innerText(), /地圖載入中/, "the pending selection has a visible loading state");
        run.releaseLeaflet();
        await run.page.locator("#histRow").waitFor({ state:"visible", timeout:15000 });
        await run.page.waitForFunction(() => document.querySelector("#histCount").textContent === "1 件派工");
        assert.equal(await run.page.locator("#histOn").isChecked(), true);
        assert.equal(await run.page.locator("#histDate").innerText(), "2026/9/30（三）");
        assert.equal(run.counts.history, 1, "one history request supplies the selected view");
        return { viewport, leafletRequests:run.counts.leaflet, historyRequests:run.counts.history };
      } finally { await close(run); }
    });
  }

  await record("cancel-during-leaflet-load-does-not-open-history", async () => {
    const run = await withMap({ width:390, height:844, holdLeaflet:true });
    try {
      await run.page.locator("#histOn").click();
      await run.page.locator("#histOn").click();
      run.releaseLeaflet();
      await run.page.locator("#map.leaflet-container").waitFor({ state:"attached", timeout:15000 });
      await pause(250);
      assert.equal(await run.page.locator("#histOn").isChecked(), false);
      assert.equal(await run.page.locator("#histRow").isHidden(), true);
      assert.equal(run.counts.history, 0, "a cancelled pending selection does not fetch history later");
      return { leafletRequests:run.counts.leaflet, historyRequests:run.counts.history };
    } finally { await close(run); }
  });

  await record("live-cancels-pending-history-data", async () => {
    const run = await withMap({ width:1440, height:1000, historyDelay:700 });
    try {
      await run.page.locator("#map.leaflet-container").waitFor({ state:"attached", timeout:15000 });
      await run.page.locator("#histOn").click();
      await run.page.waitForFunction(() => /歷史資料載入中/.test(document.querySelector("#histCount").textContent));
      await pause(50);
      assert.equal(run.counts.history, 1);
      await run.page.locator("#liveBtn").click();
      await pause(800);
      assert.equal(await run.page.locator("#histOn").isChecked(), false);
      assert.equal(await run.page.locator("#liveBox").isVisible(), true);
      assert.equal(await run.page.locator("#histRow").isHidden(), true, "a late history response cannot reopen the history view after Live");
      assert.equal(run.counts.history, 1);
      return { leafletRequests:run.counts.leaflet, historyRequests:run.counts.history };
    } finally { await close(run); }
  });

  await record("new-report-cancels-pending-history-data", async () => {
    const run = await withMap({ width:390, height:844, historyDelay:700 });
    try {
      await run.page.locator("#map.leaflet-container").waitFor({ state:"attached", timeout:15000 });
      await run.page.locator("#histOn").click();
      await run.page.waitForFunction(() => /歷史資料載入中/.test(document.querySelector("#histCount").textContent));
      await pause(50);
      assert.equal(run.counts.history, 1);
      await run.page.locator("#reportBtn").click();
      await run.page.locator("#newBox").waitFor({ state:"visible" });
      await pause(800);
      assert.equal(await run.page.locator("#histOn").isChecked(), false);
      assert.equal(await run.page.locator("#histRow").isHidden(), true, "a late history response cannot reopen the history view after a new report");
      assert.equal(run.counts.history, 1);
      return { leafletRequests:run.counts.leaflet, historyRequests:run.counts.history };
    } finally { await close(run); }
  });

  await record("rapid-reselect-shares-in-flight-history-request", async () => {
    const run = await withMap({ width:390, height:844, historyDelay:700 });
    try {
      await run.page.locator("#histOn").click();
      await run.page.waitForFunction(() => /歷史資料載入中/.test(document.querySelector("#histCount").textContent));
      await pause(50);
      assert.equal(run.counts.history, 1, "the first selection has one in-flight history request");
      await run.page.locator("#histOn").click();
      await run.page.locator("#histOn").click();
      await run.page.locator("#histRow").waitFor({ state:"visible", timeout:15000 });
      assert.equal(await run.page.locator("#histCount").innerText(), "1 件派工");
      assert.equal(await run.page.locator("#histOn").isChecked(), true);
      assert.equal(run.counts.history, 1, "reselecting shares the in-flight request and applies the latest intent");
      return { leafletRequests:run.counts.leaflet, historyRequests:run.counts.history };
    } finally { await close(run); }
  });

  await record("history-failure-explains-and-allows-retry", async () => {
    const run = await withMap({ width:1440, height:1000, historyFailures:2 });
    try {
      await run.page.locator("#histOn").click();
      await run.page.waitForFunction(() => /歷史資料載入失敗/.test(document.querySelector("#histCount").textContent));
      assert.equal(await run.page.locator("#histOn").isChecked(), false, "failed history loading returns the map to Live");
      assert.equal(await run.page.locator("#histRow").isHidden(), true);
      await run.page.locator("#histOn").click();
      await run.page.locator("#histRow").waitFor({ state:"visible", timeout:15000 });
      assert.equal(await run.page.locator("#histCount").innerText(), "1 件派工");
      assert.equal(run.counts.history, 3, "two failed transport attempts are followed by one user retry");
      return { leafletRequests:run.counts.leaflet, historyRequests:run.counts.history };
    } finally { await close(run); }
  });

  await record("leaflet-failure-explains-and-retry-keeps-history-intent", async () => {
    const run = await withMap({ width:390, height:844, leafletFailures:1 });
    try {
      await run.page.locator("#histOn").click();
      await run.page.locator("#mapRetry").waitFor({ state:"visible", timeout:15000 });
      assert.match(await run.page.locator("#mapMsg").innerText(), /地圖載入失敗/);
      assert.equal(await run.page.locator("#histOn").isChecked(), true, "the user's selection survives a retryable map failure");
      await run.page.locator("#mapRetry").click();
      await run.page.locator("#histRow").waitFor({ state:"visible", timeout:15000 });
      await run.page.waitForFunction(() => document.querySelector("#histCount").textContent === "1 件派工");
      assert.equal(run.counts.leaflet, 2, "the Retry button makes a second Leaflet request");
      assert.equal(run.counts.history, 1, "history loads once after Leaflet recovers");
      return { leafletRequests:run.counts.leaflet, historyRequests:run.counts.history };
    } finally { await close(run); }
  });

  console.log(JSON.stringify({ ok:true, base, results }));
} catch (error) {
  console.log(JSON.stringify({ ok:false, base, results }));
  throw error;
}
