// A plain visitor update/set must not create a report without a saved contact for that case key.
// Run against a local Worker: BASE=http://localhost:8989 node report-contact-bypass.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://localhost:8788";
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});
const write = (token, op, path, data) => post("/api/db", { "x-visitor":token }, { op, path, data });
const adminWrite = (op, path, data) => post("/api/db", { "x-admin":"1" }, { op, path, data });
const visitor = async () => {
  const response = await post("/api/visitor", {}, {});
  assert.equal(response.status, 200, "mint a visitor");
  const { id } = await response.json();
  return { token:id, id:id.split(".")[0] };
};
const snapshot = async () => (await fetch(BASE + "/api/db", { signal:AbortSignal.timeout(10000) })).json();
const now = () => new Date().toISOString();
const contact = item => ({ item, name:"測試市民", phone:"0912000000", email:"bypass@example.com", realName:false });

const V = await visitor(), key = "no-contact-" + Date.now().toString(36);
const item = { title:"沒有聯絡資料的通報", body:`旁路測試 ${crypto.randomUUID()}`, createdAt:now(), author:V.id };

const first = await write(V.token, "update", `reports/${V.id}`, { items:{ [key]:item } });
assert.equal(first.status, 400, "plain update without contact is refused");
assert.equal((await first.json()).error, "bad_contact", "the refusal names the missing contact");

let snap = await snapshot();
assert.equal(snap.reports?.[V.id]?.items?.[key], undefined, "a refused write stores nothing");

assert.equal((await post("/api/contact", { "x-visitor":V.token }, contact("some-other-key"))).status, 200, "save contact for another key");
assert.equal((await write(V.token, "update", `reports/${V.id}`, { items:{ [key]:item } })).status, 400,
  "a contact for another case key does not count");

assert.equal((await post("/api/contact", { "x-visitor":V.token }, contact(key))).status, 200, "save contact for this case");
assert.equal((await write(V.token, "update", `reports/${V.id}`, { items:{ [key]:item } })).status, 200,
  "plain update after saving contact succeeds");
snap = await snapshot();
assert.equal(snap.reports?.[V.id]?.items?.[key]?.title, item.title, "the accepted case is stored");

const W = await visitor(), wkey = "set-no-contact-" + Date.now().toString(36);
assert.equal((await write(W.token, "set", `reports/${W.id}`, { items:{ [wkey]:{ title:"set 無聯絡", body:`旁路 ${crypto.randomUUID()}`, createdAt:now() } } })).status, 400,
  "plain set without contact is refused");

const adminPath = `reports/admin-bypass-${Date.now().toString(36)}`;
assert.equal((await adminWrite("set", adminPath, { items:{} })).status, 200, "admin set without contact still works");

const R = await visitor(), rkey = "create-report-check";
assert.equal((await post("/api/db", { "x-visitor":R.token }, { op:"create-report", path:`reports/${R.id}`, data:{
  key:rkey, item:{ title:"正常通報", body:`建立流程 ${crypto.randomUUID()}`, createdAt:now(), author:R.id },
  contact:{ name:"正常市民", phone:"0912000000", email:"create@example.com", realName:false }
} })).status, 200, "create-report with contact still succeeds");

for (const path of [`reports/${V.id}`, `reports/${W.id}`, `reports/${R.id}`, adminPath]) await adminWrite("delete", path);
console.log("report-contact-bypass: ok");
