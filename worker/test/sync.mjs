// Out-of-order delivery check for the shim's seq logic in build.mjs. Run: node test/sync.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const src = readFileSync(new URL("../build.mjs", import.meta.url), "utf8");
const code = src.slice(src.indexOf("const pathSeq = {};"), src.indexOf("// ready is replaced"));
const replies = [];
const make = new Function("req", "fire", `let DATA = {}; ${code}; return { apply, load, data: () => DATA };`);
const s = make(async () => { const body = replies.shift(); return { ok: true, json: async () => body }; }, () => {});

replies.push({ _seq: 20, reports: { a: { v: 20 } } });
await s.load();
s.apply("reports/a", { v: 12 }, 12); // late write reply already covered by the snapshot
assert.equal(s.data().reports.a.v, 20);
replies.push({ _seq: 10, reports: { a: { v: 10 } } });
await s.load(); // older snapshot finishing late
assert.equal(s.data().reports.a.v, 20);
s.apply("reports/b", { v: 25 }, 25); // live update newer than the next snapshot
replies.push({ _seq: 22, reports: { a: { v: 21 } } });
await s.load();
assert.deepEqual(s.data().reports, { a: { v: 21 }, b: { v: 25 } });
s.apply("reports/b", null, 26); // delete
s.apply("reports/b", { v: 24 }, 24); // stale write must not resurrect it
assert.equal(s.data().reports.b, undefined);
console.log("OK");
