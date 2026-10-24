// Run: node worker/test/relative-time.mjs. Check the page's real ago() against fixed offsets.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../../taipei-issues.html", import.meta.url), "utf8");
const start = src.indexOf("const ago = iso");
const end = src.indexOf("};", start) + 2;
assert.ok(start > 0 && end > start, "ago() is in the page source");
const code = src.slice(start, end).replace(/^const ago =/, "return");
const ago = new Function(code)();

const now = Date.now();
const at = ms => ago(new Date(now - ms).toISOString());
const minutes = n => n * 60000;

assert.equal(at(30000), "1 分鐘前", "less than a minute shows 1 minute");
assert.equal(at(minutes(90)), "1 小時前", "90 minutes shows 1 hour, not 2");
assert.equal(at(minutes(23 * 60 + 40)), "23 小時前", "23h40m shows 23 hours, not 24");
assert.equal(at(minutes(36 * 60)), "1 天前", "36 hours shows 1 day, not 2");
assert.equal(at(minutes(48 * 60)), "2 天前", "48 hours shows 2 days");
assert.equal(at(minutes(5 * 24 * 60)), "5 天前", "5 days shows 5 days");
console.log("OK relative time shows complete units");
