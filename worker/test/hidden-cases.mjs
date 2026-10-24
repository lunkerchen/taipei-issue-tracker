// Hidden or not-yet-approved cases must stay out of the public snapshot and the anonymous WebSocket.
// Run against a local Worker: BASE=http://localhost:8942 node worker/test/hidden-cases.mjs
import assert from "node:assert/strict";

const BASE = (process.env.BASE || "http://127.0.0.1:8942").replace(/\/$/, "");
const ADMIN = "1"; // demo mode: any x-admin value is admin
const runId = Date.now().toString(36);
const adminHeaders = { "content-type": "application/json", "x-admin": ADMIN };

const post = async (path, body, headers = { "content-type": "application/json" }) => {
  const r = await fetch(`${BASE}${path}`, { method:"POST", headers, body:JSON.stringify(body), signal:AbortSignal.timeout(10000) });
  return { status:r.status, body:await r.json() };
};
const token = (await post("/api/visitor", {})).body.id;
const owner = token.split(".")[0];
const keys = { public:`public-${runId}`, flagged:`flagged-${runId}`, hidden:`hidden-${runId}` };
const texts = { public:`PUBLIC CASE ${runId}`, flagged:`FLAGGED SECRET ${runId}`, hidden:`HIDDEN SECRET ${runId}` };
const item = (key, title, flagged) => ({ id:key, n:1, title, body:`body of ${title}`, createdAt:new Date().toISOString(),
  dept:"環保局", district:"大安區", tags:["噪音"], author:owner, status:"open", photos:[], notes:[], ...(flagged ? { flagged:true } : {}) });
const written = [];

try {
  for (const [key, flagged] of [[keys.public, false], [keys.flagged, true], [keys.hidden, false]]) {
    const r = await post("/api/db", { op:"create-report", path:`reports/${owner}`, data:{ key, item:item(key, texts[key === keys.public ? "public" : key === keys.flagged ? "flagged" : "hidden"], flagged) } }, { "content-type":"application/json", "x-visitor":token });
    assert.equal(r.status, 200, `create ${key}`);
    written.push(`reports/${owner}`);
  }
  const hiddenId = `${owner}:${keys.hidden}`, flaggedId = `${owner}:${keys.flagged}`, publicId = `${owner}:${keys.public}`;
  const hide = await post("/api/db", { op:"set", path:`triage/${hiddenId}`, data:{ status:"open", hidden:true, events:[] } }, adminHeaders);
  assert.equal(hide.status, 200, "admin hides the case");
  written.push(`triage/${hiddenId}`);

  const snap = await (await fetch(`${BASE}/api/db`)).json();
  const items = snap.reports?.[owner]?.items || {};
  assert.equal(items[keys.public]?.title, texts.public, "public case is in the public snapshot");
  assert.equal(items[keys.flagged], undefined, "flagged case is not in the public snapshot");
  assert.equal(items[keys.hidden], undefined, "hidden case is not in the public snapshot");
  assert.equal(snap.triage?.[publicId]?.hidden, undefined, "public triage stays");
  assert.equal(snap.triage?.[flaggedId], undefined, "flagged triage is not public");
  assert.equal(snap.triage?.[hiddenId], undefined, "hidden triage is not public");

  const adminSnap = await (await fetch(`${BASE}/api/db`, { headers:{ "x-admin":ADMIN } })).json();
  assert.equal(adminSnap.reports?.[owner]?.items?.[keys.flagged]?.title, texts.flagged, "admin still gets the flagged case");
  assert.equal(adminSnap.reports?.[owner]?.items?.[keys.hidden]?.title, texts.hidden, "admin still gets the hidden case");
  assert.equal(adminSnap.triage?.[hiddenId]?.hidden, true, "admin still gets the hidden triage");

  // Listen with a visitor socket and an admin socket, then change the report doc that holds all three cases.
  const opened = url => new Promise((resolve, reject) => {
    const ws = new WebSocket(url), messages = [];
    ws.onmessage = e => messages.push(JSON.parse(e.data));
    ws.onopen = () => resolve({ ws, messages });
    ws.onerror = () => reject(new Error(`socket failed: ${url}`));
  });
  const anon = await opened(`ws://${new URL(BASE).host}/api/ws`);
  const admin = await opened(`ws://${new URL(BASE).host}/api/ws?admin=${encodeURIComponent(ADMIN)}`);
  const note = await post("/api/db", { op:"append-note", path:`reports/${owner}`, data:{ key:keys.flagged, id:crypto.randomUUID(), text:"extra note", photos:[] } }, { "content-type":"application/json", "x-visitor":token });
  assert.equal(note.status, 200, "reporter can add a note to its flagged case");
  await new Promise(r => setTimeout(r, 800));

  const reportPath = `reports/${owner}`;
  const anonDoc = anon.messages.filter(m => m.path === reportPath).at(-1)?.data;
  const adminDoc = admin.messages.filter(m => m.path === reportPath).at(-1)?.data;
  assert.equal(anonDoc?.items?.[keys.public]?.title, texts.public, "anonymous socket keeps the public case");
  assert.equal(anonDoc?.items?.[keys.hidden], undefined, "anonymous socket does not get the hidden case");
  assert.equal(anonDoc?.items?.[keys.flagged], undefined, "anonymous socket does not get the flagged case");
  assert.equal(adminDoc?.items?.[keys.hidden]?.title, texts.hidden, "the admin socket gets the hidden case");
  for (const { ws } of [anon, admin]) ws.close();
  console.log("hidden cases OK");
} finally {
  for (const path of [...new Set(written), `triage/${owner}:${keys.flagged}`, `triage/${owner}:${keys.public}`]) {
    await fetch(`${BASE}/api/db`, { method:"POST", headers:adminHeaders, body:JSON.stringify({ op:"delete", path }) });
  }
}
