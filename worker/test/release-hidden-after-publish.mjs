// Hiding a case after its release was published must remove it from the public release notes.
// Run against a local Worker: BASE=http://localhost:8788 node worker/test/release-hidden-after-publish.mjs
import assert from "node:assert/strict";

const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const admin = { "content-type": "application/json", "x-admin": "1" };
const runId = Date.now().toString(36);
const post = async (path, body, headers = { "content-type": "application/json" }) => {
  const r = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const snapshot = async headers => (await (await fetch(BASE + "/api/db", { headers, signal: AbortSignal.timeout(10000) })).json());
const releases = snap => snap.releases || {};
const releaseBody = snap => releases(snap)[tag]?.body || "";
const has = (text, n) => new RegExp(`#${n}(?!\\d)`).test(text);

const token = (await post("/api/visitor", {}, {})).body.id, owner = token.split(".")[0];
const keyA = `relafter-a-${runId}`, keyB = `relafter-b-${runId}`;
const idA = `${owner}:${keyA}`, idB = `${owner}:${keyB}`;
const tag = `v2099.${runId}`;
const titleA = `發布後隱藏測試 ${runId}`, titleB = `發布後保留測試 ${runId}`;
const contact = { name: "發布測試", phone: "0912000000", email: "release@example.com", realName: false };
const item = title => ({ title, body: `${title} 的內容`, createdAt: new Date().toISOString(),
  author: owner, dept: "環保局", district: "大安區", tags: [], photos: [], notes: [] });
const hide = (id, hidden) => post("/api/db", { op: "set", path: `triage/${id}`,
  data: { status: "fixed", hidden, events: [{ t: new Date().toISOString(), type: "status", to: "fixed", by: "qa" }] } }, admin);

let nA, nB;
try {
  const a = await post("/api/db", { op: "create-report", path: `reports/${owner}`, data: { key: keyA, item: item(titleA), contact } },
    { "content-type": "application/json", "x-visitor": token });
  const b = await post("/api/db", { op: "create-report", path: `reports/${owner}`, data: { key: keyB, item: item(titleB), contact } },
    { "content-type": "application/json", "x-visitor": token });
  assert.equal(a.status, 200, `created A: ${a.body.error || "ok"}`);
  assert.equal(b.status, 200, `created B: ${b.body.error || "ok"}`);
  nA = a.body.data.items[keyA].n;
  nB = b.body.data.items[keyB].n;
  assert.ok(Number.isInteger(nA) && Number.isInteger(nB) && nA !== nB, "both cases have numbers");
  assert.equal((await hide(idA, false)).status, 200, "fixed A");
  assert.equal((await hide(idB, false)).status, 200, "fixed B");

  const body = [
    "## 本週修好的問題",
    `- #${nA} ${titleA}（大安區，環保局，直接修復）`,
    `- #${nB} ${titleB}（大安區，環保局，直接修復）`,
    `- #${nA}0 不是案件的編號`
  ].join("\n");
  const wrote = await post("/api/db", { op: "set", path: `releases/${tag}`,
    data: { tag, title: `台北市 ${tag}：本週修好 2 件`, body, createdAt: new Date().toISOString(), fixed: [nA, nB] } }, admin);
  assert.equal(wrote.status, 200, `published the release: ${wrote.body.error || "ok"}`);

  let pub = await snapshot();
  assert.ok(has(releaseBody(pub), nA), "a published release names the visible case A");
  assert.deepEqual(releases(pub)[tag]?.fixed, [nA, nB], "the public release lists both cases before the hide");

  assert.equal((await hide(idA, true)).status, 200, "hid A after the release");
  pub = await snapshot();
  const afterHide = releases(pub)[tag];
  assert.ok(afterHide, "the release is still public");
  assert.ok(!has(afterHide.body, nA), "the hidden case number is gone from the public release body");
  assert.ok(!afterHide.body.includes(titleA), "the hidden case title is gone from the public release body");
  assert.ok(has(afterHide.body, nB) && afterHide.body.includes(titleB), "the visible case B stays in the release");
  assert.ok(afterHide.body.includes(`#${nA}0 不是案件的編號`), "a longer number that starts with the hidden number is not removed");
  assert.equal(afterHide.title, `台北市 ${tag}：本週修好 1 件`, "the release title counts only the visible case");
  assert.deepEqual(afterHide.fixed, [nB], "the public fixed list drops the hidden case");

  const adminPub = releases(await snapshot({ "x-admin": "1" }))[tag];
  assert.ok(has(adminPub.body, nA), "the administrator still sees the stored release");

  assert.equal((await hide(idA, false)).status, 200, "released A again");
  pub = await snapshot();
  assert.ok(has(releaseBody(pub), nA), "the release names A again after it is public");
  assert.equal(releases(pub)[tag]?.title, `台北市 ${tag}：本週修好 2 件`, "the title count returns");

  assert.equal((await hide(idB, true)).status, 200, "hid B too");
  pub = await snapshot();
  assert.equal(releases(pub)[tag]?.title, `台北市 ${tag}：本週修好 1 件`, "only case A remains in the count");
  assert.ok(!has(releaseBody(pub), nB) && has(releaseBody(pub), nA), "only the hidden case B is gone");

  assert.equal((await hide(idA, true)).status, 200, "hid A as well");
  pub = await snapshot();
  assert.equal(releases(pub)[tag]?.title, `台北市 ${tag}：本週修好 0 件`, "no fixed case remains in the count");
  assert.ok(!has(releaseBody(pub), nA) && !has(releaseBody(pub), nB), "no hidden case number remains");
  assert.deepEqual(releases(pub)[tag]?.fixed, [], "the public fixed list is empty");

  console.log("OK hiding a case after publication removes it from the public release notes");
} finally {
  await post("/api/db", { op: "delete", path: `releases/${tag}` }, admin).catch(() => {});
  for (const id of [idA, idB]) await post("/api/db", { op: "delete", path: `triage/${id}` }, admin).catch(() => {});
  await post("/api/db", { op: "delete", path: `reports/${owner}` }, admin).catch(() => {});
}
