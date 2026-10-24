import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://127.0.0.1:8912";

const post = async (path, body, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null), text: await res.text().catch(() => "") };
};

const getVisitor = async () => {
  const res = await post("/api/visitor", {});
  assert.equal(res.status, 200);
  const [id] = res.json.id.split(".");
  return { token: res.json.id, id };
};

const run = async () => {
  const visitor = await getVisitor();
  const headers = { "x-visitor": visitor.token };

  // 1. Invalid votes schema: issues not an object (string, array, null)
  let res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: "not-an-object" } }, headers);
  assert.equal(res.status, 400, "votes: issues as string should return 400");
  assert.equal(res.json?.error, "bad_item");

  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: ["demo-01"] } }, headers);
  assert.equal(res.status, 400, "votes: issues as array should return 400");
  assert.equal(res.json?.error, "bad_item");

  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: null } }, headers);
  assert.equal(res.status, 400, "votes: issues as null should return 400");
  assert.equal(res.json?.error, "bad_item");

  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: "raw-string" }, headers);
  assert.equal(res.status, 400, "votes: data not object should return 400");
  assert.equal(res.json?.error, "bad_item");

  // 2. Invalid votes values: not a boolean
  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: { "demo-01": 123 } } }, headers);
  assert.equal(res.status, 400, "votes: non-boolean value should return 400");
  assert.equal(res.json?.error, "bad_item");

  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: { "demo-01": "true" } } }, headers);
  assert.equal(res.status, 400, "votes: string 'true' should return 400");
  assert.equal(res.json?.error, "bad_item");

  // 3. Invalid votes keys: not a valid CASE_ID (e.g. prototype pollution or invalid format)
  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: { "constructor": true } } }, headers);
  assert.equal(res.status, 400, "votes: constructor key should return 400");
  assert.equal(res.json?.error, "bad_item");

  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: { "prototype": true } } }, headers);
  assert.equal(res.status, 400, "votes: prototype key should return 400");
  assert.equal(res.json?.error, "bad_item");

  // Note: JSON.stringify drops __proto__ in object literals; send literal raw string to test __proto__
  const rawProto = `{"op":"set","path":"votes/${visitor.id}","data":{"issues":{"__proto__":true}}}`;
  const protoFetch = await fetch(`${BASE}/api/db`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawProto
  });
  assert.equal(protoFetch.status, 400, "votes: __proto__ raw key should return 400");

  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: { "": true } } }, headers);
  assert.equal(res.status, 400, "votes: empty key should return 400");
  assert.equal(res.json?.error, "bad_item");

  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: { "has spaces in id": true } } }, headers);
  assert.equal(res.status, 400, "votes: space in key should return 400");
  assert.equal(res.json?.error, "bad_item");

  // 4. Valid votes write: set and update
  res = await post("/api/db", { op: "set", path: `votes/${visitor.id}`, data: { issues: { "demo-01": true } } }, headers);
  assert.equal(res.status, 200, "valid votes set should succeed");

  res = await post("/api/db", { op: "update", path: `votes/${visitor.id}`, data: { issues: { "demo-02": true } } }, headers);
  assert.equal(res.status, 200, "valid votes update should succeed");

  // 5. Addenda sanitization in public snapshot (publicDoc)
  // Even if a legacy or direct set/update reached addenda/<id>, publicDoc must filter out
  // items with non-string or over-length text, invalid photos, or foreign photo keys.
  res = await post("/api/db", {
    op: "set",
    path: `addenda/${visitor.id}`,
    data: {
      items: {
        valid_item: {
          target: "demo-01",
          text: "合法文字補充",
          photos: [],
          t: new Date().toISOString()
        },
        oversized_text: {
          target: "demo-01",
          text: "X".repeat(501),
          photos: [],
          t: new Date().toISOString()
        },
        foreign_photo: {
          target: "demo-01",
          text: "非法照片路徑",
          photos: ["other-visitor/malicious.jpg"],
          t: new Date().toISOString()
        },
        non_string_text: {
          target: "demo-01",
          text: 12345,
          photos: [],
          t: new Date().toISOString()
        }
      }
    }
  }, headers);
  assert.equal(res.status, 200, "raw set on addenda succeeded");

  // Inspect public GET /api/db snapshot
  const snapRes = await fetch(`${BASE}/api/db`);
  assert.equal(snapRes.status, 200);
  const snap = await snapRes.json();
  const visitorAddenda = snap.addenda?.[visitor.id]?.items || {};

  assert.ok(visitorAddenda.valid_item, "valid_item should be present in publicDoc");
  assert.equal(visitorAddenda.oversized_text, undefined, "oversized_text should be excluded from publicDoc");
  assert.equal(visitorAddenda.foreign_photo, undefined, "foreign_photo should be excluded from publicDoc");
  assert.equal(visitorAddenda.non_string_text, undefined, "non_string_text should be excluded from publicDoc");

  console.log("OK visitor-doc-schema");
};

run();
