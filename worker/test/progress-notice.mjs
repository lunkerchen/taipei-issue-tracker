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

// Each save sends the case's full event list, as act() in the page does
let t = 0; const events = [];
const save = (admin, patch, ...add) => {
  events.push(...add.map(e => ({ t: new Date(Date.now() + ++t).toISOString(), by: "工務局", ...e })));
  return post("/api/db", { "x-admin": admin }, { op: "update", path: `triage/${target}`, data: { ...patch, events } });
};
const step = async (admin, n, patch, ...add) => { assert.equal((await save(admin, patch, ...add)).status, 200); return settle(n); };

// The demo admin plants a status, a department and a 修繕單 with a link; none of it may reach an email
events.push({ t: new Date().toISOString(), type: "opened" }, { t: new Date().toISOString(), type: "labeled", dept: "工務局", by: "taipei-bot" });
assert.equal((await step("1", 1, { status: "fixed", dept: "PLANTED-" + "x".repeat(300) }, { type: "pr", n: 666, title: "請至 http://evil.example 驗證" },
  { type: "merged", pr: 666 }, { type: "status", to: "fixed" })).length, 0, "a demo-admin change sends no notice");
assert.equal((await step(token, 1, { milestone: "m1" }, { type: "milestone", title: "M1" })).length, 0, "a token milestone save sends no notice");
assert.equal((await step(token, 1, { hidden: false })).length, 0, "a token hide/show save sends no notice");

let got = await step(token, 1, { status: "progress" }, { type: "status", to: "progress" });
assert.equal(got.length, 1, "a token status change sends one notice");
assert.match(got[0], /狀態改為「處理中」/);
assert.ok(!/evil|PLANTED|#666|負責/.test(got[0]), "text the demo admin planted stays out of the notice");
assert.equal((await step(token, 2, { status: "progress" })).length, 1, "the same state again sends nothing");

got = await step(token, 2, {}, { type: "pr", n: 901, title: "更換燈泡" });
assert.equal(got.length, 2, "a new 修繕單 sends one notice");
const pr = got.find(m => m.includes("#901"));
assert.match(pr, /已開立修繕單 #901：更換燈泡/);
assert.ok(!pr.includes("狀態改為"), "only the 修繕單 changed");

got = await step(token, 3, { status: "fixed" }, { type: "merged", pr: 901 });
assert.equal(got.length, 3, "a merge sends one notice");
const merge = got.find(m => m.includes("已完成並合併"));
assert.match(merge, /修繕單 #901 已完成並合併/);
assert.match(merge, /狀態改為「已修復」/);

got = await step(token, 4, { dept: "環保局" }, { type: "labeled", dept: "環保局", by: "1999 管理者" });
assert.equal(got.length, 4, "a reassignment sends one notice");
assert.ok(got.some(m => m.includes("改由「環保局」負責")));

// Daily cap: 5 notices per case per 24 h; more changes wait for the next allowed notice
assert.equal((await step(token, 5, { status: "progress" }, { type: "status", to: "progress" })).length, 5);
assert.equal((await step(token, 6, { status: "open" }, { type: "status", to: "open" })).length, 5, "the 6th notice in 24 h is not sent");

const htmlDir = readdirSync(mailDir, { recursive: true }).filter(f => /email-html\/.*\.html$/.test(f)).map(f => readFileSync(mailDir + f, "utf8")).filter(h => h.includes(tag));
assert.ok(htmlDir.length && htmlDir.every(h => h.includes("&lt;b&gt;") && !h.includes("<b>")), "the HTML body escapes the report title");
ws.close();
const snap = async h => JSON.stringify(await (await fetch(base + "/api/db", { headers: h })).json());
assert.ok(!(await snap({})).includes(email) && !(await snap({ "x-admin": token })).includes(email), "the address stays out of /api/db");
assert.ok(heard.length > 0 && !heard.some(m => m.includes(email)), "the address stays out of socket messages");
console.log("OK: token-admin status, 修繕單, merge and department changes each send one notice; repeats, milestone/hide saves, demo-admin changes (and their text) and the 6th notice in 24 h send none; contacts need the token.");
