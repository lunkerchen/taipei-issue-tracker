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
const va = write({ "x-visitor": A.token }, "update", `votes/${A.id}`, { issues: { "smoke-a": true } });
const vb = write({ "x-visitor": A.token }, "update", `votes/${A.id}`, { issues: { "smoke-b": true } });
assert.deepEqual((await Promise.all([va, vb])).map(x => x.status), [200, 200], "concurrent votes accepted");
let voteState = (await (await fetch(BASE + "/api/db")).json()).votes[A.id].issues;
assert.equal(voteState["smoke-a"], true, "first concurrent vote kept");
assert.equal(voteState["smoke-b"], true, "second concurrent vote kept");
assert.equal((await write({ "x-visitor": A.token }, "update", `votes/${A.id}`, { issues: { "smoke-a": false } })).status, 200, "vote cancellation accepted");
voteState = (await (await fetch(BASE + "/api/db")).json()).votes[A.id].issues;
assert.equal(voteState["smoke-a"], false, "cancelled vote is false");
assert.equal(voteState["smoke-b"], true, "other vote stays true after cancellation");

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

// anti-flood on new reports: one per write, fresh createdAt, 3 per visitor per 10 min, no copy of a recent report
const F = await visitor(), G = await visitor(), tag = Date.now().toString(36), now = () => new Date().toISOString();
const R = await visitor(), reportKey = "retry-case", originalReport = { title: "原始通報", body: `重試建案 ${tag}`, createdAt: now(), author: R.id };
const createReport = (headers, item = originalReport) => write(headers, "create-report", `reports/${R.id}`, { key: reportKey, item });
assert.equal((await createReport({ "x-visitor": F.token })).status, 403, "another visitor cannot create in this report document");
assert.equal((await createReport({ "x-admin": admin })).status, 403, "create-report requires the citizen identity");
assert.equal((await createReport({ "x-visitor": R.token }, { ...originalReport, author: F.id })).status, 400, "report author must match the visitor");
const creations = await Promise.all([createReport({ "x-visitor": R.token }), createReport({ "x-visitor": R.token })]);
assert.deepEqual(creations.map(r => r.status), [200, 200], "concurrent retries succeed");
const creationResults = await Promise.all(creations.map(r => r.json()));
assert.deepEqual(creationResults.map(r => r.created).sort(), [false, true], "exactly one request creates the case");
const retryNote = { key: reportKey, id: "10000000-0000-4000-8000-000000000001", text: "重試前已有補充", photos: [] };
const noteBeforeRetry = await write({ "x-visitor": R.token }, "append-note", `reports/${R.id}`, retryNote);
assert.equal(noteBeforeRetry.status, 200);
const noteBeforeRetryResult = await noteBeforeRetry.json();
const retryResult = await (await createReport({ "x-visitor": R.token }, { ...originalReport, title: "不應覆寫" })).json();
assert.equal(retryResult.created, false);
assert.equal(retryResult.seq, noteBeforeRetryResult.seq, "an existing report retry does not write or consume another sequence");
assert.equal(retryResult.data.items[reportKey].title, originalReport.title, "retry preserves the original report");
assert.equal(retryResult.data.items[reportKey].notes[0].text, retryNote.text, "retry preserves additions that arrived after creation");
assert.equal((await write({ "x-admin": admin }, "delete", `reports/${R.id}`)).status, 200);
const K = await visitor();
const createKey = (key, createdAt = now()) => write({ "x-visitor": K.token }, "create-report", `reports/${K.id}`, {
  key, item: { author: K.id, title: "邊界測試", body: `繼承屬性測試 ${tag} ${key}`, createdAt }
});
assert.equal((await createKey("constructor", "2020-01-01T00:00:00Z")).status, 400, "inherited property names do not bypass creation time checks");
for (const key of ["constructor", "__proto__", "toString"]) assert.equal((await createKey(key)).status, 200, "fresh inherited-name report " + key);
assert.equal((await createKey("hasOwnProperty")).status, 429, "inherited-name reports count toward the visitor quota");
assert.equal((await write({ "x-admin": admin }, "delete", `reports/${K.id}`)).status, 200);
const rep = (who, key, body, createdAt = now()) => write({ "x-visitor": who.token }, "update", `reports/${who.id}`, { items: { [key]: { title: "t", body, createdAt } } });
assert.equal((await write({ "x-visitor": F.token }, "update", `reports/${F.id}`, { items: { a: { body: "x1", createdAt: now() }, b: { body: "x2", createdAt: now() } } })).status, 400, "two new reports in one write");
assert.equal((await rep(F, "old", "backdated " + tag, "2026-01-01T00:00:00Z")).status, 400, "backdated createdAt");
for (let i = 1; i <= 3; i++) assert.equal((await rep(F, "r" + i, `路燈不亮 ${tag} 第${i}件`)).status, 200, "report " + i);
assert.equal((await rep(F, "r4", `路燈不亮 ${tag} 第4件`)).status, 429, "4th report in 10 min");
assert.equal((await rep(G, "copy", `路燈不亮${tag}第1件！`)).status, 409, "copy of a recent report");
assert.equal((await rep(G, "own", `人行道破損 ${tag}`)).status, 200, "G's own report");
assert.equal((await write({ "x-visitor": G.token }, "update", `addenda/${G.id}`, { items: { s1: { target: "x", t: now(), text: "補充", photos: [] } } })).status, 200, "own addenda");
assert.equal((await write({ "x-visitor": G.token }, "update", `addenda/${F.id}`, { items: {} })).status, 403, "someone else's addenda");
const target = `${F.id}:r1`;
assert.equal((await write({ "x-visitor": F.token }, "update", `reports/${F.id}`, { items: { r1: {
  author:F.id, title:"可公開目標案件", body:`公開目標 ${tag}`, createdAt:now()
} } })).status, 200, "target report has its owner's identity and public fields");
const appendAddendum = (headers, data) => write(headers, "append-addendum", `addenda/${G.id}`, data);
const addendum = { id:"00000000-0000-4000-8000-000000000021", target, text:"相同案件的新現場照片", photos:[`${G.id}/smoke.jpg`] };
assert.equal((await appendAddendum({}, addendum)).status, 403, "anonymous addendum refused");
assert.equal((await write({ "x-admin": admin }, "append-addendum", `addenda/${G.id}`, addendum)).status, 403, "admin cannot use citizen addendum operation");
assert.equal((await write({ "x-visitor": G.token }, "append-addendum", `addenda/${F.id}`, addendum)).status, 403, "another visitor cannot append to this addenda document");
assert.equal((await appendAddendum({ "x-visitor": G.token }, { ...addendum, id:"bad-id" })).status, 400, "bad addendum id");
assert.equal((await appendAddendum({ "x-visitor": G.token }, { ...addendum, target:"missing-report" })).status, 404, "missing target report refused");
assert.equal((await appendAddendum({ "x-visitor": G.token }, { ...addendum, target:"demo-seed:bad-key" })).status, 404, "malformed target report refused");
assert.equal((await appendAddendum({ "x-visitor": G.token }, { ...addendum, text:"x".repeat(501) })).status, 400, "addendum text limit");
assert.equal((await appendAddendum({ "x-visitor": G.token }, { ...addendum, photos:Array(4).fill(`${G.id}/smoke.jpg`) })).status, 400, "addendum photo count limit");
assert.equal((await appendAddendum({ "x-visitor": G.token }, { ...addendum, photos:[`${F.id}/foreign.jpg`] })).status, 400, "foreign addendum photo refused");
assert.equal((await appendAddendum({ "x-visitor": G.token }, { ...addendum, text:"  ", photos:[] })).status, 400, "empty addendum refused");
assert.equal((await write({ "x-admin": admin }, "set", `triage/${target}`, { hidden:true })).status, 200, "hide the target for the visibility check");
assert.equal((await appendAddendum({ "x-visitor": G.token }, { ...addendum, id:"00000000-0000-4000-8000-000000000022" })).status, 404, "hidden target refused");
assert.equal((await write({ "x-admin": admin }, "delete", `triage/${target}`)).status, 200, "restore public target");
const firstAddendumResponse = await appendAddendum({ "x-visitor": G.token }, addendum);
assert.equal(firstAddendumResponse.status, 200, "addendum created");
const firstAddendum = await firstAddendumResponse.json();
assert.equal(firstAddendum.created, true);
const retryAddendumResponse = await appendAddendum({ "x-visitor": G.token }, addendum);
assert.equal(retryAddendumResponse.status, 200, "same addendum retry succeeds");
const retryAddendum = await retryAddendumResponse.json();
assert.equal(retryAddendum.created, false, "same-id retry does not create another addendum");
assert.equal(retryAddendum.seq, firstAddendum.seq, "same-id retry does not consume another sequence");
assert.equal(retryAddendum.data.items.s1.target, "x", "existing addendum target remains unchanged");
assert.equal(retryAddendum.data.items.s1.text, "補充", "existing addendum text remains unchanged");
assert.deepEqual(retryAddendum.data.items[addendum.id], firstAddendum.data.items[addendum.id], "retry returns the original addendum");
const concurrentAddendum = { ...addendum, id:"00000000-0000-4000-8000-000000000023", text:"同 ID 同時送出只能建立一次", photos:[] };
const concurrentAddenda = await Promise.all([
  appendAddendum({ "x-visitor": G.token }, concurrentAddendum),
  appendAddendum({ "x-visitor": G.token }, concurrentAddendum)
]);
assert.deepEqual(concurrentAddenda.map(x => x.status), [200, 200], "same-id concurrent retries both succeed");
const concurrentResults = await Promise.all(concurrentAddenda.map(x => x.json()));
assert.deepEqual(concurrentResults.map(x => x.created).sort(), [false, true], "concurrent retries create one addendum");
assert.equal(concurrentResults[0].seq, concurrentResults[1].seq, "the idempotent concurrent retry does not consume another sequence");
assert.equal((await appendAddendum({ "x-visitor": G.token }, { ...addendum, text:"同 ID 不可覆寫" })).status, 409, "changed content under a used id is refused");
const savedAddenda = (await (await fetch(BASE + "/api/db")).json()).addenda[G.id].items;
assert.equal(Object.keys(savedAddenda).filter(k => k === addendum.id).length, 1, "one addendum id is stored");
assert.equal(savedAddenda[addendum.id].text, addendum.text, "idempotency conflict keeps the first text");
const N = await visitor(), Nkey = "note-case", Nitem = { title: "原案件", body: `補充回歸測試 ${tag}`, createdAt: now(), author: N.id, department: "測試局處" };
assert.equal((await write({ "x-visitor": N.token }, "update", `reports/${N.id}`, { items: { [Nkey]: Nitem } })).status, 200, "note test report");
const appendNote = (headers, note) => write(headers, "append-note", `reports/${N.id}`, { key: Nkey, ...note });
const noteA = { id: "00000000-0000-4000-8000-000000000001", text: "同時補充甲", photos: [] };
const noteB = { id: "00000000-0000-4000-8000-000000000002", text: "同時補充乙", photos: [`${N.id}/smoke.jpg`] };
assert.equal((await appendNote({}, noteA)).status, 403, "anonymous note refused");
assert.equal((await write({ "x-visitor": F.token }, "append-note", `reports/${N.id}`, { key: Nkey, ...noteA })).status, 403, "another visitor cannot append");
assert.equal((await write({ "x-admin": admin }, "append-note", `reports/${N.id}`, { key: Nkey, ...noteA })).status, 403, "admin cannot use citizen note operation");
assert.equal((await appendNote({ "x-visitor": N.token }, { ...noteA, id: "bad-id" })).status, 400, "bad note id");
assert.equal((await appendNote({ "x-visitor": N.token }, { ...noteA, text: "x".repeat(501) })).status, 400, "note text limit");
assert.equal((await appendNote({ "x-visitor": N.token }, { ...noteA, photos: Array(4).fill(`${N.id}/smoke.jpg`) })).status, 400, "note photo count limit");
assert.equal((await appendNote({ "x-visitor": N.token }, { ...noteA, photos: [`${F.id}/foreign.jpg`] })).status, 400, "foreign photo key refused");
assert.equal((await appendNote({ "x-visitor": N.token }, { ...noteA, text: "  ", photos: [] })).status, 400, "empty note refused");
const concurrentNotes = await Promise.all([appendNote({ "x-visitor": N.token }, noteA), appendNote({ "x-visitor": N.token }, noteB)]);
assert.deepEqual(concurrentNotes.map(x => x.status), [200, 200], "concurrent notes accepted");
const noteSnapshot = async () => (await (await fetch(BASE + "/api/db")).json()).reports[N.id].items[Nkey];
let savedNotes = await noteSnapshot();
assert.equal(savedNotes.notes.length, 2, "both concurrent notes kept");
assert.deepEqual(new Set(savedNotes.notes.map(x => x.text)), new Set([noteA.text, noteB.text]));
for (const [k, v] of Object.entries(Nitem)) assert.deepEqual(savedNotes[k], v, "original report field " + k + " kept");
for (let i = 0; i < 8; i++) assert.equal((await appendNote({ "x-visitor": N.token }, { id: `00000000-0000-4000-8000-${String(i + 3).padStart(12, "0")}`, text: `第 ${i + 3} 則補充`, photos: [] })).status, 200, "note " + (i + 3));
assert.equal((await appendNote({ "x-visitor": N.token }, noteA)).status, 200, "same note id retry is successful");
assert.equal((await appendNote({ "x-visitor": N.token }, { id: "00000000-0000-4000-8000-000000000011", text: "第 11 則補充", photos: [] })).status, 400, "11th note refused");
savedNotes = await noteSnapshot();
assert.equal(savedNotes.notes.length, 10, "note retry does not duplicate and limit stays at ten");
assert.equal(savedNotes.notes.filter(x => x.id === noteA.id).length, 1, "retry id is stored once");
for (const [k, v] of Object.entries(Nitem)) assert.deepEqual(savedNotes[k], v, "original report field " + k + " remains after appends");
for (const w of [F, G]) assert.equal((await write({ "x-admin": admin }, "delete", `reports/${w.id}`)).status, 200);
assert.equal((await write({ "x-admin": admin }, "delete", `reports/${N.id}`)).status, 200);
assert.equal((await write({ "x-admin": admin }, "delete", `addenda/${G.id}`)).status, 200);

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
