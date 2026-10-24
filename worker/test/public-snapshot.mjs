// The admin-only demo snapshot must not be in the visitor database snapshot.
// Run against a local Worker: BASE=http://127.0.0.1:8941 node worker/test/public-snapshot.mjs
import assert from "node:assert/strict";

const BASE = (process.env.BASE || "http://127.0.0.1:8941").replace(/\/$/, "");
const ADMIN = "1", headers = { "content-type": "application/json", "x-admin": ADMIN };
const runId = Date.now().toString(36);
const doc = { at: new Date().toISOString(), triage: { [`hidden-${runId}`]: { status: "fixed", hidden: true } },
  releases: ["seed-release"], reports: ["demo-seed"], votes: { admin: { "hidden-${runId}": true } } };
const write = op => fetch(`${BASE}/api/db`, { method: "POST", headers, body: JSON.stringify({ op, path: "demo/snapshot", ...(op === "set" ? { data: doc } : {}) }) });
const snap = async h => (await fetch(`${BASE}/api/db`, { headers: h })).json();

try {
  assert.equal((await write("set")).status, 200, "admin saves the demo snapshot");
  const pub = await snap();
  assert.equal(pub.demo?.snapshot, undefined, "visitor snapshot has no demo.snapshot");
  assert.ok(!JSON.stringify(pub).includes(`hidden-${runId}`), "visitor snapshot does not mention hidden triage ids");
  const admin = await snap({ "x-admin": ADMIN });
  assert.equal(admin.demo?.snapshot?.triage?.[`hidden-${runId}`]?.hidden, true, "admin still gets the demo snapshot");
  console.log("demo snapshot stays admin-only");
} finally {
  await write("delete").catch(() => {});
}
