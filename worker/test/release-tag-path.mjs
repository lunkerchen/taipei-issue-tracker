// Release tags are v<year>.<week>, and the dot must pass /api/db path validation.
// Run against a local Worker: BASE=http://localhost:8941 ADMIN_TOKEN=<local token> node worker/test/release-tag-path.mjs
import assert from "node:assert/strict";

const BASE = (process.env.BASE || "http://127.0.0.1:8941").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
assert.ok(ADMIN_TOKEN, "Set ADMIN_TOKEN to the local Worker's test token");
const headers = { "content-type": "application/json", "x-admin": ADMIN_TOKEN };
const runId = Date.now().toString(36);
const docs = [`v2099.${runId}`, `v2099.${runId}.1`];

const write = async (op, path, data) => {
  const response = await fetch(`${BASE}/api/db`, { method:"POST", headers, body:JSON.stringify({ op, path, ...(data === undefined ? {} : { data }) }), signal:AbortSignal.timeout(10000) });
  return { status:response.status, body:await response.json() };
};

try {
  for (const tag of docs) {
    const saved = await write("set", `releases/${tag}`, { tag, title:`test ${tag}`, body:"## test", createdAt:new Date().toISOString(), fixed:[] });
    assert.equal(saved.status, 200, `release tag ${tag} must be accepted`);
    assert.equal(saved.body.data.tag, tag);
  }
  for (const path of ["releases/.", "releases/..", "releases/a/b", "releases/v1/x"]) {
    const rejected = await write("set", path, { tag:"x" });
    assert.equal(rejected.status, 400, `${path} must stay rejected`);
  }
  const snapshot = await (await fetch(`${BASE}/api/db`)).json();
  for (const tag of docs) assert.equal(snapshot.releases?.[tag]?.title, `test ${tag}`, "saved release is in the snapshot");
  console.log("release tag path OK");
} finally {
  for (const tag of docs) await write("delete", `releases/${tag}`);
}
