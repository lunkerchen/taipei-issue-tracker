// Run against a local Worker: BASE=http://127.0.0.1:8973 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/share-case-scroll.mjs
// A shared case used to scroll into view, then vote counts arrived and re-sorted the list, leaving the card above the viewport.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const BASE = (process.env.BASE || "http://127.0.0.1:8973").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const snapshot = await (await fetch(BASE + "/api/db")).json();
const counts = {};
for (const v of Object.values(snapshot.votes || {})) for (const [id, on] of Object.entries(v.issues || {})) if (on === true) counts[id] = (counts[id] || 0) + 1;
const shared = "demo-02", votes = counts[shared] || 0;
assert.ok(votes > 0, "the shared case needs +1 counts to reproduce the re-sort");

const measure = page => page.evaluate(id => {
  const open = document.querySelector(`[data-open="${CSS.escape(id)}"]`);
  const card = open?.closest(".issue") || open;
  if (!card) return null;
  const r = card.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), viewport: innerHeight };
}, shared);

const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE + "/#issue/" + shared);
    for (const phase of ["load", "reload"]) {
      if (phase === "reload") await page.reload();
      await page.waitForSelector(`[data-open="${shared}"]`, { timeout: 15000 });
      await page.waitForFunction(([id, n]) => document.querySelector(`[data-vote="${CSS.escape(id)}"] span`)?.textContent.trim() === String(n), [shared, votes], { timeout: 15000 });
      await page.waitForTimeout(150);
      const box = await measure(page);
      assert.ok(box, `${viewport.width} ${phase}: the shared case is expanded`);
      assert.ok(box.top >= 0 && box.top < box.viewport && box.bottom > 0,
        `${viewport.width} ${phase}: the shared case is in the viewport, got ${JSON.stringify(box)}`);
    }
    await page.close();
    console.log(viewport.width + " OK");
  }
  console.log("OK");
} finally {
  await browser.close();
}
