// Run against a local Worker: BASE=http://localhost:8805 node worker/test/report-contact.mjs (reads ADMIN_TOKEN from worker/.dev.vars)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// Only the token admin reads contacts; the token-free demo admin gets 403
const base = process.env.BASE || "http://localhost:8805", admin = process.env.ADMIN_TOKEN || /^ADMIN_TOKEN=(.*)$/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))[1];
const post = (path, headers, body) => fetch(base + path, {
  method: "POST", headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
});
const mint = async () => {
  const response = await post("/api/visitor", {}, {});
  assert.equal(response.status, 200);
  const { id: token } = await response.json();
  return { token, id: token.split(".")[0] };
};
const person = await mint(), tag = randomUUID();
const contact = { name: "合成聯絡人", phone: "0900000000", email: "citizen@example.com", realName: false };
const makeItem = (body, extra = {}) => ({ title: "合成路燈通報", body, author: person.id, createdAt: new Date().toISOString(), ...extra });
const create = (key, item, details = contact) => post("/api/db", { "x-visitor": person.token }, {
  op: "create-report", path: `reports/${person.id}`, data: { key, item, contact: details }
});
const readContact = async key => {
  const response = await fetch(`${base}/api/contact?id=${encodeURIComponent(`${person.id}:${key}`)}`, {
    headers: { "x-admin": admin }, signal: AbortSignal.timeout(8000)
  });
  assert.equal(response.status, 200);
  return (await response.json()).contact;
};
const snapshot = async () => (await (await fetch(base + "/api/db")).json());

assert.equal((await create("bad-contact", makeItem("invalid contact " + tag), { ...contact, phone: "123" })).status, 400);
assert.equal(await readContact("bad-contact"), null);
assert.equal((await snapshot()).reports[person.id], undefined, "invalid contact does not create a public case");
const { email: _omitted, ...withoutEmail } = contact;
const missing = await post("/api/db", { "x-visitor": person.token }, { op: "create-report", path: `reports/${person.id}`, data: { key: "no-contact", item: makeItem("no contact " + tag) } });
assert.equal(missing.status, 400, "a report without contact is refused");
assert.equal((await snapshot()).reports[person.id], undefined, "a missing contact does not create a public case");
for (const [key, details] of [["null-contact", null], ["no-email", withoutEmail], ["bad-email", { ...contact, email: "not-an-email" }], ["double-dot", { ...contact, email: "a@b..com" }], ["leading-hyphen", { ...contact, email: "a@-b.com" }], ["trailing-hyphen", { ...contact, email: "a@b-.com" }], ["trailing-dot", { ...contact, email: "a@b.com." }], ["long-email", { ...contact, email: "a".repeat(250) + "@x.co" }], ["blank-email", { ...contact, email: "  " }]]) {
  assert.equal((await create(key, makeItem(key + " " + tag), details)).status, 400, key + " is refused");
  assert.equal(await readContact(key), null, key + " leaves no private contact");
  assert.equal((await snapshot()).reports[person.id], undefined, key + " does not create a public case");
}

const first = makeItem("unique contact test " + tag);
const accepted = await create("accepted", first);
assert.equal(accepted.status, 200);
assert.equal((await accepted.json()).created, true);
const saved = await readContact("accepted");
assert.equal(saved.name, contact.name);
assert.equal(saved.phone, contact.phone);
assert.equal(saved.email, contact.email);
const retry = await create("accepted", first, { ...contact, name: "不應覆寫" });
assert.equal(retry.status, 200);
assert.equal((await retry.json()).created, false);
assert.deepEqual(await readContact("accepted"), saved, "a retry cannot replace the first saved contact");
assert.equal((await create("duplicate", first)).status, 409);
assert.equal(await readContact("duplicate"), null, "a refused duplicate leaves no private contact");
assert.equal((await create("backdated", makeItem("backdated " + tag, { createdAt: "2020-01-01T00:00:00Z" }))).status, 400);
assert.equal(await readContact("backdated"), null);
// valid fields (create-report rejects a body over 2000 characters first), but the doc is over 32 KB
assert.equal((await create("oversize", makeItem("oversize " + tag, { tags: Array(20).fill("x".repeat(1700)) }))).status, 413);
assert.equal(await readContact("oversize"), null);
for (const key of ["second", "third"]) assert.equal((await create(key, makeItem(key + " " + tag))).status, 200);
assert.equal((await create("quota", makeItem("quota " + tag))).status, 429);
assert.equal(await readContact("quota"), null, "a quota refusal leaves no private contact");

const stranger = await mint();
const denied = await fetch(`${base}/api/contact?id=${person.id}:accepted`, { headers: { "x-visitor": stranger.token } });
assert.equal(denied.status, 403);
assert.ok(!JSON.stringify(await snapshot()).includes(contact.phone), "private contact stays out of the public snapshot");
assert.ok(!JSON.stringify(await snapshot()).includes(contact.email), "private email stays out of the public snapshot");
console.log("OK: accepted report and contact save together; duplicate, quota, validation and size refusals leave no contact; retries keep the first contact private.");
