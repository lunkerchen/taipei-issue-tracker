// Run against a local Worker that simulates email (wrangler dev from worker/, with NOTICE_FROM set):
//   npx wrangler dev --port 8806 --persist-to <tmpdir> --var NOTICE_FROM:notice@example.com
//   BASE=http://localhost:8806 node worker/test/progress-notice.mjs
// Reads ADMIN_TOKEN from worker/.dev.vars. Simulated emails are files under worker/.wrangler/tmp/email/.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.BASE || "http://localhost:8806";
const token = process.env.ADMIN_TOKEN || /^ADMIN_TOKEN=(.*)$/m.exec(readFileSync(fileURLToPath(new URL("../.dev.vars", import.meta.url)), "utf8"))[1];
const mailDir = fileURLToPath(new URL("../.wrangler/tmp/email/", import.meta.url));
const post = (path, headers, body) => fetch(base + path, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
});
const tag = randomUUID(), email = `notice-${tag.slice(0, 8)}@example.com`;
// Simulated text bodies that belong to this run
const mails = () => !existsSync(mailDir) ? [] : readdirSync(mailDir, { recursive: true }).filter(f => /email-text\/.*\.txt$/.test(f))
  .map(f => readFileSync(mailDir + f, "utf8")).filter(t => t.includes(tag));
const settle = async n => { for (let k = 0; k < 30 && mails().length < n; k++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 500)); return mails(); };

const { id: visitor } = await (await post("/api/visitor", {}, {})).json(), id = visitor.split(".")[0], target = `${id}:case`;
const created = await post("/api/db", { "x-visitor": visitor }, { op: "create-report", path: `reports/${id}`, data: { key: "case",
  item: { title: `路燈 <b> 不亮 ${tag}`, body: "notice test " + tag, author: id, createdAt: new Date().toISOString(), dept: "工務局" },
  contact: { name: "合成聯絡人", phone: "0900000000", email, realName: false } } });
assert.equal(created.status, 200);

// Contacts: the token-free demo admin is refused, the token admin reads them
const readContact = admin => fetch(`${base}/api/contact?id=${encodeURIComponent(target)}`, { headers: { "x-admin": admin }, signal: AbortSignal.timeout(8000) });
assert.equal((await readContact("1")).status, 403, "demo admin cannot read contacts");
assert.equal((await readContact(token + "x")).status, 403, "a wrong token cannot read contacts");
assert.equal((await (await readContact(token)).json()).contact.email, email);

// Every socket message stays free of the address
const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/ws?admin"), heard = [];
ws.onmessage = e => heard.push(String(e.data));
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });

let t = 0;
const triage = (admin, status, events, extra = {}) => post("/api/db", { "x-admin": admin }, { op: "update", path: `triage/${target}`,
  data: { status, events: events.map(e => ({ t: new Date(Date.now() + ++t).toISOString(), by: "工務局", ...e })), ...extra } });

assert.equal((await triage("1", "progress", [{ type: "status", to: "progress" }])).status, 200);
assert.equal((await settle(1)).length, 0, "a demo-admin change sends no notice");

const opened = [{ type: "opened" }, { type: "labeled", dept: "工務局", by: "taipei-bot" }];
const progress = [...opened, { type: "status", to: "progress" }];
assert.equal((await triage(token, "progress", progress)).status, 200);
let got = await settle(1);
assert.equal(got.length, 1, "a status change sends one notice");
assert.match(got[0], /狀態改為「處理中」/);
assert.ok(!got[0].includes("工務局」負責"), "the first labeled event is not a department change");
assert.equal((await triage(token, "progress", progress)).status, 200);
assert.equal((await settle(2)).length, 1, "the same state again sends nothing");

const fixed = [...progress, { type: "pr", n: 901, title: "更換燈泡" }, { type: "merged", pr: 901 }];
assert.equal((await triage(token, "fixed", fixed)).status, 200);
got = await settle(2);
assert.equal(got.length, 2, "a 修繕單 merge sends one notice");
const merge = got.find(m => m.includes("#901"));
assert.match(merge, /已開立修繕單 #901：更換燈泡/);
assert.match(merge, /修繕單 #901 已完成並合併/);
assert.match(merge, /狀態改為「已修復」/);

const moved = [...fixed, { type: "labeled", dept: "環保局", by: "1999 管理者" }];
assert.equal((await triage(token, "fixed", moved, { dept: "環保局" })).status, 200);
got = await settle(3);
assert.equal(got.length, 3, "a reassignment sends one notice");
assert.ok(got.some(m => m.includes("改由「環保局」負責")));

// Daily cap: 5 notices per case per 24 h; more changes wait for the next allowed notice
for (const [n, s] of [[4, "open"], [5, "progress"], [5, "open"]]) {
  assert.equal((await triage(token, s, [...moved, { type: "status", to: s }])).status, 200);
  assert.equal((await settle(n)).length, n, `after "${s}": ${n} notices`);
}

const htmlDir = readdirSync(mailDir, { recursive: true }).filter(f => /email-html\/.*\.html$/.test(f)).map(f => readFileSync(mailDir + f, "utf8")).filter(h => h.includes(tag));
assert.ok(htmlDir.length && htmlDir.every(h => h.includes("&lt;b&gt;") && !h.includes("<b>")), "the HTML body escapes the report title");
ws.close();
const snap = async h => JSON.stringify(await (await fetch(base + "/api/db", { headers: h })).json());
assert.ok(!(await snap({})).includes(email) && !(await snap({ "x-admin": token })).includes(email), "the address stays out of /api/db");
assert.ok(heard.length > 0 && !heard.some(m => m.includes(email)), "the address stays out of socket messages");
console.log("OK: token-admin status, 修繕單, merge and department changes each send one notice; repeats, demo-admin changes and the 6th notice in 24 h send none; contacts need the token.");
