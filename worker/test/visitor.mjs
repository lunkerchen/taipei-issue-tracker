// Run: node worker/test/visitor.mjs. Exercise the shim's real initialization across fresh tabs.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../build.mjs", import.meta.url), "utf8");
// build.mjs stores this code inside a template string; decode its escaped backslashes.
const code = src.slice(src.indexOf("let visitorStorageBlocked ="), src.indexOf("// seq:")).replaceAll("\\\\", "\\");
const start = new Function("store", "req", "navigator", `${code}; return visitor;`);
const tokens = ["1".repeat(16) + "." + "a".repeat(64), "2".repeat(16) + "." + "b".repeat(64), "3".repeat(16) + "." + "d".repeat(64)];
const values = new Map();
const store = { get: k => values.get(k), set: (k, v) => values.set(k, v) };
let queue = Promise.resolve(), minted = 0, calls = 0;
const navigator = { locks: { request: (name, callback) => {
  assert.equal(name, "tit-visitor");
  const pending = queue.then(callback);
  queue = pending.catch(() => {});
  return pending;
} } };
// Mirrors /api/visitor: a correctly signed token is echoed, anything else gets a new token.
const signed = new Set();
const req = async (_url, init = {}) => {
  calls++;
  const supplied = init.headers?.["x-visitor"];
  await new Promise(resolve => setTimeout(resolve, 20));
  if (supplied && signed.has(supplied)) return { ok: true, json: async () => ({ id: supplied }) };
  const id = tokens[minted++];
  signed.add(id);
  return { ok: true, json: async () => ({ id }) };
};
const [a, b] = await Promise.all([start(store, req, navigator), start(store, req, navigator)]);
assert.equal(a, tokens[0]);
assert.equal(b, a, "both fresh tabs keep the same visitor identity");
assert.equal(minted, 1, "the second tab reuses the token minted under the lock");
assert.equal(await start(store, req, navigator), a, "reload retains the identity");
assert.equal(minted, 1, "an existing token does not mint another identity");
assert.equal(await start(store, req, {}), a, "browsers without Web Locks still reuse an existing token");
assert.ok(calls > 3, "every load confirms the stored token with the Worker");

values.clear();
assert.equal(await start(store, async () => { throw new Error("offline"); }, navigator), null);
assert.equal(await start(store, req, navigator), tokens[1], "a later tab can recover after identity initialization failed");
assert.equal(await start({ get: () => null, set: () => {} }, async () => ({ ok: true, json: async () => ({ id: tokens[0] }) }), navigator), null,
  "a tab cannot report under an identity that the browser cannot keep");

// A token with a bad signature has the right shape, but the Worker refuses it, so every write would return 403.
const forged = "4".repeat(16) + "." + "e".repeat(64);
values.set("tit-visitor", forged);
const renewed = await start(store, req, navigator);
assert.notEqual(renewed, forged, "a forged token is replaced before the page turns writable");
assert.equal(renewed, tokens[2]);
assert.equal(values.get("tit-visitor"), renewed, "the renewed token is kept in this browser");

values.set("tit-visitor", tokens[0]);
assert.equal(await start(store, async () => { throw new Error("offline"); }, navigator), tokens[0],
  "an offline reload keeps a well-formed stored token instead of going read-only");
assert.equal(await start(store, async () => ({ ok: false, status: 429 }), navigator), tokens[0],
  "a rate-limited confirmation keeps the stored token");

values.clear();
const diagnose = new Function("store", "req", "navigator", `${code}; return visitor.then(token => ({ token, blocked: visitorStorageBlocked }));`);
assert.deepEqual(await diagnose(store, async () => ({ ok: false, status: 429 }), navigator), { token: null, blocked: false },
  "rate limiting is not misreported as blocked storage");
assert.deepEqual(await diagnose(store, async () => ({ ok: true, json: async () => ({}) }), navigator), { token: null, blocked: false },
  "an invalid identity response is not misreported as blocked storage");
assert.equal(values.size, 0, "failed identity responses do not pollute browser storage");
console.log("OK");
