import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE || "http://localhost:8788";

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath:process.env.CHROME_EXECUTABLE_PATH } : {}) });
const open = async hash => {
  const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE + hash, { waitUntil:"domcontentloaded" });
  return { context, page, errors };
};
const detail = page => page.locator('.issue .detail [data-share="demo-07"], .issue .detail [data-share="demo-03"]').first();
try {
  const a = await open("#issue/demo-07");
  try {
    await detail(a.page).waitFor({ state:"visible", timeout:15000 });
    assert.equal(new URL(a.page.url()).hash, "#issue/demo-07");
    await a.page.locator("#tabClosed").click();
    await a.page.waitForFunction(() => location.hash === "#issues");
    await detail(a.page).waitFor({ state:"detached", timeout:5000 });
    assert.deepEqual(a.errors, [], "no page errors");
    console.log("OK open case closes and the URL returns to the list");
  } finally { await a.context.close(); }

  const b = await open("#issues");
  try {
    await b.page.locator("#list .title").first().waitFor({ state:"visible", timeout:15000 });
    await b.page.locator("#tabClosed").click();
    await b.page.waitForFunction(() => document.querySelector("#tabClosed").getAttribute("aria-pressed") === "true");
    await b.page.reload({ waitUntil:"domcontentloaded" });
    await b.page.waitForFunction(() => document.querySelector("#list .title")?.getBoundingClientRect().height > 0, null, { timeout:15000 });
    assert.equal(await b.page.locator("#tabClosed").getAttribute("aria-pressed"), "false", "#issues opens the default tab");
    assert.equal(await b.page.locator(".issue .detail").count(), 0, "the reload has no open case");
    assert.deepEqual(b.errors, [], "no page errors");
    console.log("OK the list URL has no stale case after a reload");
  } finally { await b.context.close(); }

  const c = await open("#issue/demo-03");
  try {
    await c.page.locator('.issue .detail [data-share="demo-03"]').waitFor({ state:"visible", timeout:15000 });
    assert.equal(await c.page.locator("#tabClosed").getAttribute("aria-pressed"), "true");
    await c.page.locator("#tabClosed").click();
    await c.page.waitForTimeout(300);
    assert.ok(await c.page.locator('.issue .detail [data-share="demo-03"]').isVisible(), "a tab click keeps a case that belongs to that tab");
    assert.equal(new URL(c.page.url()).hash, "#issue/demo-03");
    await c.page.locator("#tabOpen").click();
    await c.page.waitForFunction(() => location.hash === "#issues");
    await c.page.locator('.issue .detail [data-share="demo-03"]').waitFor({ state:"detached", timeout:5000 });
    assert.deepEqual(c.errors, [], "no page errors");
    console.log("OK a matching tab keeps the detail; the other tab closes it");
  } finally { await c.context.close(); }
  console.log("OK the open case and the tab keep the URL in sync");
} finally {
  await browser.close();
}
