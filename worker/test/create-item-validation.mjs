// create-report must reject item fields that the client would silently drop.
// Run: BASE=http://localhost:8788 node worker/test/create-item-validation.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://localhost:8788";
const post = (path, headers, body) => fetch(BASE + path, {
  method:"POST", headers:{ "content-type":"application/json", ...headers },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(10000)
});
const admin = { "x-admin":"1" };
const visitor = async () => {
  const response = await post("/api/visitor", {}, {});
  assert.equal(response.status, 200, "mint a visitor");
  const { id } = await response.json();
  return { token:id, id:id.split(".")[0] };
};
const snapshot = async () => (await fetch(BASE + "/api/db", { signal:AbortSignal.timeout(10000) })).json();
const contact = { name:"驗證測試", phone:"0912000000", email:"item@example.com", realName:false };
const now = () => new Date().toISOString();
const create = (who, key, item) => post("/api/db", { "x-visitor":who.token }, { op:"create-report", path:`reports/${who.id}`,
  data:{ key, item:{ author:who.id, createdAt:now(), district:"大安區", dept:"1999 待分派", ...item }, contact } });
const baseItem = { title:"欄位驗證", body:`內容 ${crypto.randomUUID()}` };

const V = await visitor(), key = suffix => `item-${suffix}-${Date.now().toString(36)}`;
const bad = [
  ["number title", { title:123, body:"內容" }],
  ["empty title", { title:"   ", body:"內容" }],
  ["long title", { title:"W".repeat(201), body:"內容" }],
  ["number body", { title:"標題", body:456 }],
  ["empty body", { title:"標題", body:"  " }],
  ["long body", { title:"標題", body:"A".repeat(2001) }],
  ["string tags", { title:"標題", body:"內容", tags:"交通號誌" }],
  ["number in tags", { title:"標題", body:"內容", tags:[1] }]
];
for (const [name, item] of bad) {
  const response = await create(V, key(name.replace(/\W+/g, "-")), item);
  assert.equal(response.status, 400, `${name} is refused`);
  assert.equal((await response.json()).error, "bad_item", `${name} reports bad_item`);
}
assert.equal((await snapshot()).reports?.[V.id], undefined, "refused items are not stored");

const W = await visitor(), boundaryKey = key("boundary");
const boundaryTitle = "T".repeat(200), boundaryBody = (crypto.randomUUID() + "B".repeat(2000)).slice(0, 2000);
const first = await create(W, boundaryKey, { title:boundaryTitle, body:boundaryBody, tags:["交通號誌"] });
assert.equal(first.status, 200, "boundary lengths are accepted");
assert.equal((await first.json()).created, true, "the boundary case is created");
const retry = await create(W, boundaryKey, { title:42, body:42 });
assert.equal(retry.status, 200, "a retry of an existing key stays idempotent");
assert.equal((await retry.json()).created, false, "the retry does not create a second case");

assert.equal((await create(W, key("no-tags"), baseItem)).status, 200, "tags are optional");
assert.equal((await create(W, key("empty-tags"), { ...baseItem, body:`內容 ${crypto.randomUUID()}`, tags:[] })).status, 200, "an empty tags array is accepted");

const saved = (await snapshot()).reports?.[W.id]?.items || {};
assert.equal(saved[boundaryKey]?.title.length, 200, "the 200-character title is stored intact");
assert.equal(saved[boundaryKey]?.body.length, 2000, "the 2000-character body is stored intact");

for (const who of [V, W]) await post("/api/db", admin, { op:"delete", path:`reports/${who.id}` });
console.log("create-item-validation: ok");
