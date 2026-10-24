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
// SOI, APP0 (JFIF), APP1 "Exif" with a fake GPS payload, SOS + data, EOI
const app0 = [0xff, 0xe0, 0, 6, 0x4a, 0x46, 0x49, 0x46], exif = [0xff, 0xe1, 0, 10, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50], sos = [0xff, 0xda, 0, 4, 1, 2, 9, 9, 0xff, 0xd9];
// minimal DQT / SOF0 / DHT so the structure check passes; SOS header is 8 bytes (1 component)
const dqt = [0xff, 0xdb, 0, 3, 0], sof = [0xff, 0xc0, 0, 3, 8], dht = [0xff, 0xc4, 0, 3, 0];
const scan = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 9, 9, 0xff, 0xd9];
const jfif = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
const jpg = new Uint8Array([0xff, 0xd8, ...app0, ...exif, ...dqt, ...sof, ...dht, ...scan]), clean = new Uint8Array([0xff, 0xd8, ...jfif, ...dqt, ...sof, ...dht, ...scan]);
const up = (headers, body) => fetch(BASE + "/api/photo", { method: "POST", headers: { "content-type": "image/jpeg", ...headers }, body, signal: AbortSignal.timeout(8000) });
const pr = await up({ "x-visitor": A.token }, jpg);
assert.equal(pr.status, 200, "photo upload");
const { key } = await pr.json();
assert.match(key, new RegExp(`^${A.id}/[\\w-]+\\.jpg$`), "photo key in own folder");
const got = await fetch(BASE + "/api/photo/" + key);
assert.equal(got.status, 200); assert.equal(got.headers.get("content-type"), "image/jpeg"); assert.equal(got.headers.get("x-content-type-options"), "nosniff");
assert.deepEqual(new Uint8Array(await got.arrayBuffer()), clean, "EXIF segment stripped, APP0 replaced by a bare JFIF header");
assert.equal((await up({ "x-visitor": A.token }, new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).status, 415, "webp refused (JPEG only)");
assert.equal((await up({ "x-visitor": A.token }, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 99]))).status, 415, "truncated jpeg refused");
const C = await visitor(); // separate visitor: these extra uploads would push A past the 10-photos-per-minute limit
for (const [bad, why] of [
  [[0xff, 0xd8, 0xff, 0xda, 0xff, 0xff], "SOS with no header / EOI"],
  [[0xff, 0xd8, ...app0, ...sos.slice(0, 8)], "no EOI"],
  [[0xff, 0xd8, 0xff, 0xff, 0xe1, 0, 4, 0, 0, ...sos], "fill byte before a marker"],
  [[0xff, 0xd8, ...app0, 0xff, 0xda, 0, 4, 1, 2, 0xff, 0xe1, 0, 4, 9, 9, 0xff, 0xd9], "APP1 after SOS"],
  [[0xff, 0xd8, ...app0, 0xff, 0xc2, 0, 2, ...sos], "progressive SOF2"],
  [[0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9], "SOS without tables"],
]) assert.equal((await up({ "x-visitor": C.token }, new Uint8Array(bad))).status, 415, why);
// no Content-Length (streamed): still capped
const big = new ReadableStream({ start(c) { for (let i = 0; i < 12; i++) c.enqueue(new Uint8Array(64 * 1024).fill(0xff)); c.close(); } });
const sr = await fetch(BASE + "/api/photo", { method: "POST", headers: { "content-type": "image/jpeg", "x-visitor": A.token }, body: big, duplex: "half", signal: AbortSignal.timeout(8000) });
assert.equal(sr.status, 413, "streamed oversize refused");
assert.equal((await up({ "x-visitor": A.token }, new TextEncoder().encode("<svg onload=alert(1)>"))).status, 415, "non-image refused");
assert.equal((await up({}, jpg)).status, 403, "anonymous upload refused");
assert.equal((await up({ "x-visitor": forged }, jpg)).status, 403, "forged visitor refused");
assert.equal((await up({ "x-visitor": A.token }, new Uint8Array(701 * 1024).fill(0xff))).status, 413, "oversize refused");
assert.equal((await fetch(BASE + "/api/photo/../hub.js")).status, 404, "bad key");
assert.equal((await fetch(BASE + "/api/photo/" + A.id + "/nope.jpg")).status, 404, "missing photo");

// Reporter contact: visitor saves its own, only the admin reads it, and it never shows up in /api/db
const CV = await visitor(), cbody = { item: "smoke-1", name: "測試員", phone: "0912-000-111", realName: false };
assert.equal((await post("/api/contact", {}, cbody)).status, 403, "anonymous contact");
assert.equal((await post("/api/contact", { "x-visitor": CV.token }, { ...cbody, phone: "12345" })).status, 400, "bad phone");
assert.equal((await post("/api/contact", { "x-visitor": CV.token }, { ...cbody, name: "" })).status, 400, "empty name");
assert.equal((await post("/api/contact", { "x-visitor": CV.token }, cbody)).status, 200, "save contact");
const cget = h => fetch(`${BASE}/api/contact?id=${CV.id}:smoke-1`, { headers: h, signal: AbortSignal.timeout(8000) });
assert.equal((await cget({ "x-visitor": CV.token })).status, 403, "visitor cannot read contacts");
assert.deepEqual((await (await cget({ "x-admin": admin })).json()).contact.phone, "0912000111", "admin reads contact");
assert.ok(!(await (await fetch(BASE + "/api/db")).text()).includes("0912000111"), "contact not in public snapshot");

wa.ws.close(); wb.ws.close();
console.log("OK");
