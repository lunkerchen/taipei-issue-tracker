// Unit check for Hub.notify() when sends overlap and fail: runs the real hub.js on node:sqlite with a send stub
// whose replies the test controls. No Worker needed. Run: node worker/test/notice-undo.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("../src/hub.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "").replace("export class Hub", "class Hub").replace(/^export /gm, "");
const Hub = new Function("DurableObject", "seed", "offices", `${src}\nreturn Hub;`)(class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }, {}, { updated: "x", offices: [] });

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...a) {
  const st = db.prepare(q);
  if (/^\s*select/i.test(q)) { const rows = st.all(...a); return Object.assign(rows[Symbol.iterator](), { toArray: () => rows }); }
  st.run(...a); return { toArray: () => [] };
} };
const sends = [], waits = [];
const env = { NOTICE_FROM: "notice@example.com", EMAIL: { send: msg => new Promise((ok, no) => sends.push({ msg, ok, no })) } };
const ctx = { storage: { sql, transactionSync: f => f() }, blockConcurrencyWhile: f => f(), waitUntil: p => waits.push(p), getWebSockets: () => [] };
const hub = new Hub(ctx, env);
const target = "0123456789abcdef:case", fail = Object.assign(new Error("x"), { code: "E_DELIVERY_FAILED" });
hub.sql.exec("INSERT INTO docs VALUES (?, ?)", "reports/0123456789abcdef", JSON.stringify({ items: { case: { title: "路燈", dept: "工務局" } } }));
hub.contactPut(target, { name: "合成", email: "a@example.com" });

let doc = { status: "open" };
const save = patch => { const old = doc; doc = { ...doc, ...patch }; hub.notify(target, old, doc, []); };
const settle = () => Promise.allSettled(waits.splice(0));
const told = () => JSON.parse(hub.sql.exec("SELECT v FROM notices WHERE k = ?", target).toArray()[0].v).told;
const lines = i => sends[i].msg.text.split("\n").filter(l => l.startsWith("・")).join(" ");

// A (progress) is still in flight; B (fixed) and C (progress again) are sent; then A fails
save({ status: "progress" }); save({ status: "fixed" }); sends[1].ok({}); save({ status: "progress" }); sends[2].ok({});
sends[0].no(fail); await settle();
assert.equal(told().status, "progress", "A's failure does not undo C, which told the same value later");
save({ milestone: "m" });
assert.equal(sends.length, 3, "nothing to resend: the reporter knows 處理中");

// D (status open) is in flight; E (department) is sent; D fails, so the next save resends only D's change
save({ status: "open" }); save({ dept: "環保局" }); sends[4].ok({}); sends[3].no(fail); await settle();
assert.equal(told().status, "progress", "D's status is undone");
assert.equal(told().dept, "環保局", "E's department stays told");
save({ milestone: "m2" }); sends[5].ok({}); await settle();
assert.equal(lines(5), "・狀態改為「待處理」", "the next notice repeats only D's change");

// More than 10 added events in one save still count
const many = [...Array(10)].map((_, i) => ({ t: "2026-10-24T00:00:0" + i + "Z", type: "milestone" }));
{ const old = doc; doc = { ...doc }; hub.notify(target, old, doc, [...many, { t: "2026-10-24T00:01:00Z", type: "pr", n: 7, title: "換燈" }]); }
assert.match(lines(6), /已開立修繕單 #7：換燈/);
sends[6].ok({}); await settle();
console.log("OK: overlapping sends undo only their own fields; a later notice is kept; the 11th added event still notifies.");
