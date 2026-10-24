// Smoke test against `wrangler dev` (default http://localhost:8787); reads ADMIN_TOKEN from worker/.dev.vars. Run: node test/smoke.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const BASE = process.env.BASE || "http://localhost:8787";
const admin = process.env.ADMIN_TOKEN || /^ADMIN_TOKEN=(.*)$/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))[1];
const post = (path, headers, body) => fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(8000) });
const write = (headers, op, path, data) => post("/api/db", headers, { op, path, data });
const visitor = async () => { const { id } = await (await post("/api/visitor")).json(); return { token: id, id: id.split(".")[0] }; };
// Opens a WebSocket; next(pred) resolves with the first received message matching pred, or rejects after 1 s
const open = () => new Promise((res, rej) => {
  const ws = new WebSocket(BASE.replace("http", "ws") + "/api/ws"), msgs = [], waiters = [];
  ws.onmessage = e => { msgs.push(JSON.parse(e.data)); waiters.splice(0).forEach(w => w()); };
  ws.onopen = () => res({ ws, next: pred => new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("no matching ws message within 1s")), 1000);
    const check = () => { const m = msgs.find(pred); if (m) { clearTimeout(t); ok(m); } else waiters.push(check); };
    check();
  }) });
  ws.onerror = () => rej(new Error("ws error"));
});

const [A, B] = [await visitor(), await visitor()];
const [wa, wb] = [await open(), await open()];

const snap = await (await fetch(BASE + "/api/db")).json();
assert.ok(snap.categories && snap.reports, "GET /api/db returns the seeded collections");

// A writes votes/<A>; B (and A) receive it
let r = await write({ "x-visitor": A.token }, "set", `votes/${A.id}`, { issues: { smoke: true } });
assert.equal(r.status, 200, "A can write own votes");
const m = await wb.next(x => x.path === `votes/${A.id}`);
assert.deepEqual(m.data, { issues: { smoke: true } });
await wa.next(x => x.path === `votes/${A.id}`);

// forged / missing / foreign visitor, wrong admin token -> 403
const forged = A.id + "." + "0".repeat(64);
assert.equal((await write({ "x-visitor": forged }, "set", `votes/${A.id}`, { issues: {} })).status, 403, "forged signature");
assert.equal((await write({}, "set", `votes/${A.id}`, { issues: {} })).status, 403, "no visitor header");
assert.equal((await write({ "x-visitor": A.token }, "set", `votes/${B.id}`, { issues: {} })).status, 403, "A writing B's votes");
assert.equal((await write({ "x-visitor": A.token }, "set", "triage/x", { status: "open" })).status, 403, "visitor writing triage/x");
assert.equal((await write({ "x-admin": "wrong" }, "set", "triage/x", {})).status, 403, "wrong admin token");
assert.equal((await write({ "x-visitor": A.token }, "set", "bad path/x", {})).status, 400, "bad path");

// limits
const items = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i, { title: "t" }]));
assert.equal((await write({ "x-visitor": A.token }, "set", `reports/${A.id}`, { items })).status, 400, "21 items");
assert.equal((await write({ "x-visitor": A.token }, "set", `reports/${A.id}`, { items: { a: "x".repeat(33000) } })).status, 413, "over 32KB");

// admin writes anywhere; B receives; then clean up
r = await write({ "x-admin": admin }, "set", "triage/smoke-x", { status: "open" });
assert.equal(r.status, 200, "admin write");
await wb.next(x => x.path === "triage/smoke-x" && x.data?.status === "open");
assert.equal((await write({ "x-admin": admin }, "delete", "triage/smoke-x")).status, 200);
await wb.next(x => x.path === "triage/smoke-x" && x.data === null);
assert.equal((await write({ "x-visitor": A.token }, "delete", `votes/${A.id}`)).status, 200);

// per-visitor write limit (20/min): B hits 429 while A and admin still write
let hit = 0;
for (let i = 0; i < 25 && !hit; i++) if ((await write({ "x-visitor": B.token }, "set", `votes/${B.id}`, { issues: {} })).status === 429) hit = i + 1;
assert.ok(hit > 0 && hit <= 21, "visitor B rate limited at " + hit);
assert.equal((await write({ "x-visitor": A.token }, "set", `votes/${A.id}`, { issues: {} })).status, 200, "A unaffected by B's limit");
assert.equal((await write({ "x-admin": admin }, "delete", `votes/${B.id}`)).status, 200, "admin not limited");
await write({ "x-admin": admin }, "delete", `votes/${A.id}`);

// photos: visitor uploads a JPEG into its own folder, anyone reads it; wrong type / no identity / bad key refused
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const up = (headers, body) => fetch(BASE + "/api/photo", { method: "POST", headers: { "content-type": "image/jpeg", ...headers }, body, signal: AbortSignal.timeout(8000) });
const pr = await up({ "x-visitor": A.token }, jpg);
assert.equal(pr.status, 200, "photo upload");
const { key } = await pr.json();
assert.match(key, new RegExp(`^${A.id}/[\\w-]+\\.jpg$`), "photo key in own folder");
const got = await fetch(BASE + "/api/photo/" + key);
assert.equal(got.status, 200); assert.equal(got.headers.get("content-type"), "image/jpeg"); assert.equal(got.headers.get("x-content-type-options"), "nosniff");
assert.deepEqual(new Uint8Array(await got.arrayBuffer()), jpg, "photo bytes round-trip");
assert.equal((await up({ "x-visitor": A.token }, new TextEncoder().encode("<svg onload=alert(1)>"))).status, 415, "non-image refused");
assert.equal((await up({}, jpg)).status, 403, "anonymous upload refused");
assert.equal((await up({ "x-visitor": forged }, jpg)).status, 403, "forged visitor refused");
assert.equal((await up({ "x-visitor": A.token }, new Uint8Array(701 * 1024).fill(0xff))).status, 413, "oversize refused");
assert.equal((await fetch(BASE + "/api/photo/../hub.js")).status, 404, "bad key");
assert.equal((await fetch(BASE + "/api/photo/" + A.id + "/nope.jpg")).status, 404, "missing photo");

wa.ws.close(); wb.ws.close();
console.log("OK");
