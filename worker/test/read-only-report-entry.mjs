// Browser regression for read-only report entry points. Every browser write is intercepted.
// Run with PLAYWRIGHT_MODULE=/path/to/playwright BASE=http://localhost:8812 node worker/test/read-only-report-entry.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8812";
const widths = [1280, 640, 390];
const visitorId = "a1b2c3d4e5f60718";
const visitorToken = `${visitorId}.${"b".repeat(64)}`;
const dbFixture = {
  _seq: 0,
  reports: {}, triage: {}, votes: {}, milestones: {}, releases: {},
  categories: {}, stats: {}, addenda: {}
};
const writes = [];
const pageErrors = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {})
});

async function makePage(scenario, width, admin = false) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    isMobile: width === 390,
    hasTouch: width === 390,
    deviceScaleFactor: width === 640 ? 2 : 1
  });
  if (scenario === "storage-blocked") {
    await context.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "tit-visitor") throw new DOMException("Storage is blocked", "QuotaExceededError");
        return setItem.call(this, key, value);
      };
    });
  }
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" && request.method() !== "HEAD" && request.method() !== "OPTIONS") {
      writes.push({ scenario, width, method: request.method(), path: url.pathname, mocked: true });
      if (url.pathname === "/api/visitor") {
        if (scenario === "visitor-403") return route.fulfill({ status: 403, json: { error: "visitor_refused" } });
        if (scenario === "visitor-429") return route.fulfill({ status: 429, json: { error: "rate_limited" } });
        if (scenario === "invalid-token") return route.fulfill({ json: { id: "invalid-token" } });
        return route.fulfill({ json: { id: visitorToken } });
      }
      return route.fulfill({ status: 503, json: { error: "browser_regression_write_blocked" } });
    }
    if (url.pathname === "/api/db") return route.fulfill({ json: dbFixture });
    if (url.pathname === "/api/health") return route.fulfill({ json: { ai: false } });
    if (url.pathname === "/api/news") return route.fulfill({ json: { items: [] } });
    if (url.pathname === "/api/geocode") return route.fulfill({ json: { lat: null } });
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(String(error)));
  const query = admin ? "?admin=mock-admin-token" : "";
  await page.goto(`${base}/${query}#issues`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(expectedWritable => {
    const writable = typeof canWrite !== "undefined" && canWrite;
    const who = document.querySelector("#who").textContent;
    const settled = expectedWritable
      ? !document.querySelector("#newBtn").hidden
      : /唯讀檢視|瀏覽器無法保留/.test(who);
    return writable === expectedWritable && settled && document.querySelector("#navReport").hidden === !expectedWritable;
  }, scenario === "writable-visitor" || scenario === "writable-admin");
  return { context, page };
}

try {
  for (const scenario of ["storage-blocked", "visitor-403", "visitor-429", "invalid-token"]) {
    for (const width of widths) {
      const { context, page } = await makePage(scenario, width);
      try {
        const initial = await page.evaluate(() => ({
          canWrite,
          who: document.querySelector("#who").textContent,
          entries: ["newBtn", "navReport", "reportBtn", "lpHint"].map(id => {
            const element = document.getElementById(id);
            return { id, hidden: element.hidden, display: getComputedStyle(element).display, rects: element.getClientRects().length };
          }),
          formHidden: document.querySelector("#newBox").hidden
        }));
        assert.equal(initial.canWrite, false, `${scenario} at ${width}px stays read-only`);
        assert.equal(initial.formHidden, true, `${scenario} at ${width}px starts with a closed form`);
        for (const entry of initial.entries) {
          assert.equal(entry.hidden, true, `${entry.id} has hidden=true for ${scenario} at ${width}px`);
          assert.equal(entry.display, "none", `${entry.id} is not displayed for ${scenario} at ${width}px`);
          assert.equal(entry.rects, 0, `${entry.id} has no visible layout box for ${scenario} at ${width}px`);
        }
        if (scenario === "storage-blocked") assert.match(initial.who, /瀏覽器無法保留/);
        else assert.equal(initial.who, "唯讀檢視");

        await page.locator('#nav [data-view="map"]').click();
        await page.waitForFunction(() => !document.querySelector("#v-map").hidden);
        const tabTargets = [];
        await page.evaluate(() => document.activeElement.blur());
        for (let index = 0; index < 100; index++) {
          await page.keyboard.press("Tab");
          const target = await page.evaluate(() => document.activeElement.id);
          if (["newBtn", "navReport", "reportBtn", "lpHint"].includes(target)) tabTargets.push(target);
        }
        assert.deepEqual(tabTargets, [], `no read-only report entry is reachable by Tab at ${width}px`);

        const attempted = await page.evaluate(() => {
          document.querySelector("#newBtn").onclick();
          document.querySelector("#navReport").onclick();
          document.querySelector("#reportBtn").onclick();
          reportAt({ lat: 25.05, lng: 121.55 }, "定位", null);
          askReport({ lat: 25.05, lng: 121.55 });
          return {
            formHidden: document.querySelector("#newBox").hidden,
            askMarker: askM,
            focusedId: document.activeElement.id,
            canWrite
          };
        });
        assert.equal(attempted.canWrite, false);
        assert.equal(attempted.formHidden, true, `direct entry handlers cannot open the form for ${scenario}`);
        assert.equal(attempted.askMarker, null, `long press does not create a report prompt for ${scenario}`);
        assert.notEqual(attempted.focusedId, "newText", `read-only entry handlers cannot focus the report form for ${scenario}`);
      } finally {
        await context.close();
      }
    }
  }

  for (const [scenario, admin] of [["writable-visitor", false], ["writable-admin", true]]) {
    for (const width of widths) {
      const { context, page } = await makePage(scenario, width, admin);
      try {
        assert.equal(await page.evaluate(() => canWrite), true, `${scenario} retains write access at ${width}px`);
        assert.equal(await page.locator("#newBtn").evaluate(element => element.hidden), false);
        if (scenario === "writable-visitor") {
          assert.equal(await page.locator("#navReport").isVisible(), true, `visitor nav entry remains visible at ${width}px`);
          await page.locator("#navReport").click();
        } else {
          await page.locator("#newBtn").click();
        }
        await page.locator("#newBox").waitFor({ state: "visible" });
        assert.equal(await page.evaluate(() => document.activeElement.id), "newText");
        await page.locator("#cancelBtn").click();
        await page.locator('#nav [data-view="map"]').click();
        assert.equal(await page.locator("#reportBtn").isVisible(), true, `${scenario} map entry remains visible at ${width}px`);
        await page.locator("#reportBtn").click();
        await page.locator("#newBox").waitFor({ state: "visible" });
      } finally {
        await context.close();
      }
    }
  }

  assert.ok(writes.length > 0, "the browser exercised mocked visitor writes");
  assert.ok(writes.every(write => write.mocked), "every browser write was intercepted and mocked");
  assert.ok(!writes.some(write => write.path !== "/api/visitor"), "report attempts made no write beyond mocked visitor issuance");
  assert.deepEqual(pageErrors, [], "browser pages had no uncaught errors");
  console.log(`OK: ${widths.length * 4} read-only viewport cases hide and protect all report entries; ${widths.length * 2} writable visitor and administrator cases still open reports; ${writes.length} writes mocked.`);
} finally {
  await browser.close();
}
