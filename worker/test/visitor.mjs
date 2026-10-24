// Run: node worker/test/visitor.mjs. Exercise the shim's real initialization across fresh tabs.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../build.mjs", import.meta.url), "utf8");
// build.mjs stores this code inside a template string; decode its escaped backslashes.
const code = src.slice(src.indexOf("let visitorStorageBlocked ="), src.indexOf("// seq:")).replaceAll("\\\\", "\\");
const start = new Function("store", "req", "navigator", `${code}; return visitor;`);
const tokens = ["1".repeat(16) + "." + "a".repeat(64), "2".repeat(16) + "." + "b".repeat(64)];
const values = new Map();
const store = { get: k => values.get(k), set: (k, v) => values.set(k, v) };
let queue = Promise.resolve(), requests = 0;
const navigator = { locks: { request: (name, callback) => {
  assert.equal(name, "tit-visitor");
  const pending = queue.then(callback);
  queue = pending.catch(() => {});
  return pending;
} } };
const req = async () => {
  const id = tokens[requests++];
  await new Promise(resolve => setTimeout(resolve, 20));
  return { ok: true, json: async () => ({ id }) };
};
const [a, b] = await Promise.all([start(store, req, navigator), start(store, req, navigator)]);
assert.equal(a, tokens[0]);
assert.equal(b, a, "both fresh tabs keep the same visitor identity");
assert.equal(requests, 1, "the second tab reuses the token minted under the lock");
assert.equal(await start(store, req, navigator), a, "reload retains the identity");
assert.equal(requests, 1, "an existing token does not mint another identity");
assert.equal(await start(store, req, {}), a, "browsers without Web Locks still reuse an existing token");

values.clear();
assert.equal(await start(store, async () => { throw new Error("offline"); }, navigator), null);
assert.equal(await start(store, req, navigator), tokens[1], "a later tab can recover after identity initialization failed");
assert.equal(await start({ get: () => null, set: () => {} }, async () => ({ ok: true, json: async () => ({ id: tokens[0] }) }), navigator), null,
  "a tab cannot report under an identity that the browser cannot keep");
values.clear();
const diagnose = new Function("store", "req", "navigator", `${code}; return visitor.then(token => ({ token, blocked: visitorStorageBlocked }));`);
assert.deepEqual(await diagnose(store, async () => ({ ok: false, status: 429 }), navigator), { token: null, blocked: false },
  "rate limiting is not misreported as blocked storage");
assert.deepEqual(await diagnose(store, async () => ({ ok: true, json: async () => ({}) }), navigator), { token: null, blocked: false },
  "an invalid identity response is not misreported as blocked storage");
assert.equal(values.size, 0, "failed identity responses do not pollute browser storage");
console.log("OK");
