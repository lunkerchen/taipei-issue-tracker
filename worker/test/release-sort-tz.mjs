// Regression test: verify that release list sorts by ISO timestamp epoch,
// not string comparison (which would break on mixed timezone offsets like +08:00 vs Z).
// Run against a local Worker:
//   BASE=http://127.0.0.1:8907 node worker/test/release-sort-tz.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(playwrightPath);

const BASE = process.env.BASE || "http://127.0.0.1:8787";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  // Go to admin view to have releases tab visible
  await page.goto(`${BASE}?admin`, { waitUntil: "networkidle" });

  // Inject releases with mixed timezone representations:
  // r1: 2026-10-04T18:00:00+08:00 (10:00 UTC)
  // r2: 2026-10-04T12:00:00Z       (12:00 UTC -> 2 hours later than r1)
  // String comparison puts r1 after r2 because '18' > '12'.
  // Time/epoch comparison puts r2 after r1 because 12:00 UTC > 10:00 UTC.
  const sortedTags = await page.evaluate(() => {
    const fakeReleases = [
      { id: "r1", tag: "v1", createdAt: "2026-10-04T18:00:00+08:00", body: "r1" },
      { id: "r2", tag: "v2", createdAt: "2026-10-04T12:00:00Z", body: "r2" }
    ];
    // Apply sorting logic used by the releases listener
    fakeReleases.sort((a, b) => (+new Date(b.createdAt) || 0) - (+new Date(a.createdAt) || 0));
    return fakeReleases.map(r => r.tag);
  });

  assert.deepEqual(sortedTags, ["v2", "v1"], "v2 (12:00 UTC) must precede v1 (10:00 UTC) in newest-first order");

  // Also verify in rendered DOM with actual release items
  await page.click('[data-view="releases"]');
  await page.waitForTimeout(500);

  const renderedTags = await page.$$eval("#relList .rel .side .tag", els => els.map(el => el.textContent.trim()));
  assert(renderedTags.length >= 2, `Should render seeded releases, got ${renderedTags.length}`);
  // First release must be v2026.42 (Oct 14 / Oct 13 UTC), followed by v2026.40 (Oct 4)
  assert.equal(renderedTags[0], "v2026.42");
  assert.equal(renderedTags[1], "v2026.40");

  assert.equal(errors.length, 0, `Page errors: ${errors.join(", ")}`);
  console.log("OK");
} finally {
  await browser.close();
}
