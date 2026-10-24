// The one shared database: a SQLite-backed Durable Object that stores every document, fans writes out over hibernating
// WebSockets, and also owns the geocode/news caches so the 1 req/s Nominatim throttle is global.
// ponytail: a single instance serves every visitor; fine for a demo room, shard by collection before thousands of live sockets.
import { DurableObject } from "cloudflare:workers";
import seed from "../data.json";
import offices from "../../data/offices.json";

const DOC_MAX = 32 * 1024, ITEMS_MAX = 20, ADMIN_DOC_MAX = 256 * 1024;
const REPORT_ITEM = /^[\w-]{1,64}$/, NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_ID = /^[\da-f]{16}$/;
export const CASE_ID = /^(?:[\da-f]{16}:[\w-]{1,64}|[\w-]{1,64})$/;
const PHOTO_KEY = /^(?:[\da-f]{16}|admin|demo)\/[\w-]{1,64}\.jpg$/;
export const validEmail = e => {
  if (e.length > 254) return false;
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@") || /\s/.test(e)) return false;
  const domain = e.slice(at + 1); // shared with index.js; the page uses the same rule
  return domain.includes(".") && domain.split(".").every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
};
// Anti-flood for new reports (visitors only). Visitor ids are cheap to mint, so the per-IP cap is the real wall;
// ponytail: a venue shares one IP, so IP_10MIN is generous. Add Turnstile if a real flood gets past it.
const MIN = 60e3, PER_VISITOR_10MIN = 3, PER_VISITOR_DAY = 10, PER_IP_10MIN = 60, SKEW = 10 * MIN, DUP_WINDOW = 30 * MIN;
const norm = s => String(s || "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
const TAIPEI_VIEWBOX = "121.45,25.22,121.67,24.95"; // left,top,right,bottom
const NOMINATIM_UA = "taipei-issue-tracker (labanchen@gmail.com)";
// Bing, not Google News: Google answers Cloudflare's egress IPs with a 503 "Sorry" bot page.
const BING_NEWS = "https://www.bing.com/news/search?q=" + encodeURIComponent("臺北") + "&format=rss&setlang=zh-TW&cc=TW";
const PTT = "https://www.ptt.cc/bbs/Taipei/index.html";
// Threads has no open search: a hand-picked list of 台北 posts (picked 2026-10-24, read only). Edit by hand to refresh;
// time is the post date, decoded from the post code (id >> 23 = ms since 2011-08-24).
const THREADS = [
  { title: "台北市的自來水真的不能直接燒水喝嗎", url: "https://www.threads.com/@rouninnmew__/post/De19teMmqwD", source: "Threads", time: "2026-10-23T16:15:30Z" },
  { title: "桃園台北通勤，下雨天遲到被老闆問：你怎麼不搭機捷？", url: "https://www.threads.com/@vos_non_scitis/post/Dexyji9n5ay", source: "Threads", time: "2026-10-22T01:21:04Z" },
  { title: "信義區深夜遇陌生男子搭訕、尾隨，提醒大家注意安全", url: "https://www.threads.com/@ariellhsu_/post/DesOwlGEv3X", source: "Threads", time: "2026-10-19T21:32:04Z" }
];
// Not news: buy/sell/giveaway posts, surveys and board notices
const PTT_SKIP = /^\[(?:交易|贈送|徵求|販售|出售|收購|二手|問卷|公告|徵人|廣告|租屋|分租)\]/;
export const isObj = v => v && typeof v === "object" && !Array.isArray(v);
// A case number is a positive integer below 1e6; the page uses the same range.
const caseNo = v => Number.isInteger(v) && v >= 1 && v < 1e6;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Progress notices: an email to the reporter when the token admin changes a case's status or department, opens a 修繕單
// or merges one. At most NOTICE_DAY per case per 24 h; changes over the cap go into the next allowed notice.
const NOTICE_DAY = 5, SITE = "https://taipei-issue-tracker.labanchen.workers.dev";
const STATUS_ZH = { open: "待處理", progress: "處理中", fixed: "已修復" };
const escHtml = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// The send_email binding is RPC, so no AbortSignal: race a 10 s timer. One retry, only on errors where nothing was sent
// (a timed-out send may still arrive, so it is not retried).
async function mail(env, msg) {
  for (let k = 0; ; k++) {
    try { return await Promise.race([env.EMAIL.send(msg), sleep(10e3).then(() => { throw Object.assign(new Error("timeout"), { code: "E_TIMEOUT" }); })]); }
    catch (e) { if (k || !["E_RATE_LIMIT_EXCEEDED", "E_INTERNAL_SERVER_ERROR"].includes(e.code)) throw e; await sleep(1000); }
  }
}
// Same one-level-deep merge as the page's artifact runtime uses for update()
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(o[k]) ? { ...o[k], ...v } : v; return o; };

// Every outbound fetch: 8 s timeout, one retry on network error / 5xx / 429
async function get(url, headers, gap = 500) {
  let last;
  for (let k = 0; k < 2; k++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (r.ok) return r;
      last = new Error("upstream " + r.status);
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) { last = e; }
    await sleep(gap);
  }
  throw last;
}

const ent = s => s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()];
  if (named) return named;
  try { return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)); } catch { return m; }
});
const clean = (s, n = 120) => ent(s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]*>/g, "")).trim().slice(0, n);
const tag = (x, t) => (new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(x) || [])[1] || "";

// Bing wraps each link in apiclick.aspx?url=<article>; unwrap it so the ticker links straight to the article.
const unwrap = u => { try { return new URL(u).searchParams.get("url") || u; } catch { return u; } };
async function bingNews() {
  const xml = await (await get(BING_NEWS, { "user-agent": NOMINATIM_UA })).text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, x]) => {
    const source = clean(tag(x, "News:Source")) || "Bing News";
    const title = clean(tag(x, "title"));
    const t = Date.parse(tag(x, "pubDate"));
    return { title, url: unwrap(clean(tag(x, "link"), 2000)), source, time: t ? new Date(t).toISOString() : "", t: t || 0 };
  }).filter(i => i.title && /^https?:\/\//.test(i.url)).sort((a, b) => b.t - a.t).slice(0, 15).map(({ t, ...i }) => i);
}

async function pttNews() {
  const html = (await (await get(PTT)).text()).split("r-list-sep")[0]; // drop pinned posts below the separator
  return html.split('class="r-ent"').slice(1).map(x => {
    const m = /<div class="title">\s*<a href="([^"]+)">([^<]*)<\/a>/.exec(x);
    return m && { title: clean(m[2]).replace(/^(?:(?:Fw|Re):\s*)+/i, ""), url: "https://www.ptt.cc" + m[1], source: "PTT Taipei", time: clean((/class="date">\s*([^<]*)</.exec(x) || [])[1] || "") };
  }).filter(i => i && i.title && !PTT_SKIP.test(i.title)).reverse().slice(0, 15); // the index lists oldest first
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.pending = 0; this.chain = Promise.resolve(); this.lastGeo = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY)");
      // Reporter name/phone/email: kept out of docs, so snapshot() and the socket never send them; only the admin route reads them
      this.sql.exec("CREATE TABLE IF NOT EXISTS quota (who TEXT NOT NULL, ip TEXT NOT NULL, t INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS contacts (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
      // Per case: the state the last notice reported and its send times (no email address here)
      this.sql.exec("CREATE TABLE IF NOT EXISTS notices (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS counter (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
      this.seq = this.sql.exec("SELECT v FROM counter WHERE k = 'seq'").toArray()[0]?.v || 0;
      // Councilor and 里辦公處 phone book (data/offices.json); not in docs, so snapshot() and the socket never send it.
      // Reloaded whenever the file's updated date changes. ponytail: no route reads it yet; add an admin one when a feature needs it.
      this.sql.exec("CREATE TABLE IF NOT EXISTS offices (id TEXT PRIMARY KEY, kind TEXT NOT NULL, district TEXT NOT NULL, area TEXT NOT NULL, data TEXT NOT NULL)");
      const stamp = "offices:" + offices.updated;
      if (!this.sql.exec("SELECT 1 FROM meta WHERE k = ?", stamp).toArray().length) {
        this.sql.exec("DELETE FROM offices");
        for (const o of offices.offices) this.sql.exec("INSERT INTO offices VALUES (?, ?, ?, ?, ?)", o.id, o.kind, o.district, o.area, JSON.stringify(o));
        this.sql.exec("DELETE FROM meta WHERE k LIKE 'offices:%'");
        this.sql.exec("INSERT INTO meta VALUES (?)", stamp);
      }
      // Seed once; the meta row stops an emptied database from reseeding itself
      if (!this.sql.exec("SELECT 1 FROM meta WHERE k = 'seeded'").toArray().length) {
        for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) this.sql.exec("INSERT OR REPLACE INTO docs VALUES (?, ?)", `${c}/${id}`, JSON.stringify(d));
        this.sql.exec("INSERT INTO meta VALUES ('seeded')");
      }
    });
  }

  // seq orders writes so clients can drop stale data; the snapshot carries the seq it reflects.
  // Visitors only get docs they may see: hidden or not-yet-approved cases stay out of the public snapshot.
  snapshot(admin = false) {
    const out = { _seq: this.seq };
    for (const { path, data } of this.sql.exec("SELECT path, data FROM docs")) {
      const doc = JSON.parse(data), visible = admin ? doc : this.publicDoc(path, doc);
      if (visible === null) continue;
      const [c, id] = path.split("/"); (out[c] ||= {})[id] = visible;
    }
    return out;
  }

  // Admin "重設模擬資料": every doc, contact and quota row goes back to worker/data.json. Open pages get each change
  // (null for a removed doc) with one new seq. ponytail: citizen photos stay in R2 as orphans; sweep R2 if storage matters.
  resetSeed() {
    const old = this.sql.exec("SELECT path FROM docs").toArray().map(r => r.path);
    this.sql.exec("DELETE FROM docs"); this.sql.exec("DELETE FROM contacts"); this.sql.exec("DELETE FROM quota"); this.sql.exec("DELETE FROM notices");
    const docs = Object.entries(seed).flatMap(([c, ds]) => Object.entries(ds).map(([id, d]) => [`${c}/${id}`, d]));
    for (const [path, d] of docs) this.sql.exec("INSERT INTO docs VALUES (?, ?)", path, JSON.stringify(d));
    this.seq++; this.sql.exec("INSERT OR REPLACE INTO counter VALUES ('seq', ?)", this.seq);
    const kept = new Set(docs.map(([path]) => path));
    for (const ws of this.ctx.getWebSockets()) {
      const admin = ws.deserializeAttachment()?.admin === true;
      try {
        for (const path of old) if (!kept.has(path)) ws.send(JSON.stringify({ path, data: null, seq: this.seq }));
        for (const [path, d] of docs) ws.send(JSON.stringify({ path, data: admin ? d : this.publicDoc(path, d), seq: this.seq }));
      } catch {}
    }
    return { ok: true, docs: docs.length, removed: old.filter(p => !kept.has(p)).length, seq: this.seq };
  }

  contactPut(k, v) { this.sql.exec("INSERT OR REPLACE INTO contacts VALUES (?, ?)", k, JSON.stringify(v)); return { ok: true }; }
  contactGet(k) { const r = this.sql.exec("SELECT v FROM contacts WHERE k = ?", k).toArray()[0]; return { contact: r ? JSON.parse(r.v) : null }; }

  // After a token-admin triage write: email the reporter what token-admin writes changed since the last notice. Off until
  // NOTICE_FROM is set; demo-seed cases have no contact, so they never send. Only this write's own changes count: status and
  // department from old doc -> new doc, 修繕單 events from `added`. So text that the token-free demo admin put in the doc never
  // reaches an email, also when a stale tab sends back events that a demo admin has since changed.
  // notices row: told = what the reporter was last told, set = the state token-admin writes made, times = send times.
  // ponytail: "重設到快照" re-sets triage docs through this path too, so a restore can send a "status went back" notice.
  notify(target, oldDoc, triage, added) {
    if (!this.env.EMAIL || !this.env.NOTICE_FROM || !isObj(triage)) return;
    const contact = this.contactGet(target).contact, colon = target.indexOf(":");
    if (!contact?.email || colon < 0) return;
    const report = this.sql.exec("SELECT data FROM docs WHERE path = ?", `reports/${target.slice(0, colon)}`).toArray()[0];
    const item = report && JSON.parse(report.data).items?.[target.slice(colon + 1)];
    if (!isObj(item) || typeof item.title !== "string") return;
    const key = e => `${e.type}:${e.n ?? e.pr}@${e.t}`, one = (v, n) => String(v || "").replace(/\s+/g, " ").slice(0, n);
    const row = this.sql.exec("SELECT v FROM notices WHERE k = ?", target).toArray()[0];
    const base = { status: "open", dept: one(item.dept, 30), prs: [], merged: [] };
    const last = row ? JSON.parse(row.v) : { told: base, set: base, times: [] }, told = last.told;
    const set = { ...last.set, prs: [...last.set.prs], merged: [...last.set.merged] };
    if (triage.status !== oldDoc?.status && STATUS_ZH[triage.status]) set.status = triage.status;
    if (typeof triage.dept === "string" && triage.dept !== oldDoc?.dept) set.dept = one(triage.dept, 30);
    const has = (a, k) => a.some(x => x.k === k);
    for (const e of added.filter(isObj)) { // has(): a retried write must not list a 修繕單 twice
      if (e.type === "pr" && Number.isFinite(e.n) && !has(set.prs, key(e))) set.prs.push({ k: key(e), n: e.n, title: one(e.title, 80) });
      if (e.type === "merged" && Number.isFinite(e.pr) && !has(set.merged, key(e))) set.merged.push({ k: key(e), n: e.pr });
    }
    const lines = [
      ...set.prs.filter(p => !has(told.prs, p.k)).map(p => `已開立修繕單 #${p.n}：${p.title}`),
      ...set.merged.filter(p => !has(told.merged, p.k)).map(p => `修繕單 #${p.n} 已完成並合併`),
      ...(set.status !== told.status ? [`狀態改為「${STATUS_ZH[set.status]}」`] : []),
      ...(set.dept !== told.dept ? [`改由「${set.dept}」負責`] : [])];
    const save = v => this.sql.exec("INSERT OR REPLACE INTO notices VALUES (?, ?)", target, JSON.stringify(v));
    const stamp = Date.now(), times = last.times.filter(t => t > stamp - 864e5);
    // Nothing new since the last notice (dedupe), or over the daily cap: keep `set`, so the next notice includes it
    if (!lines.length || times.length >= NOTICE_DAY) return save({ ...last, set, times });
    // told.by: which notice told each field, so a failed notice undoes only the fields that it told itself
    const id = crypto.randomUUID(), by = { ...told.by };
    for (const f of ["status", "dept"]) if (set[f] !== told[f]) by[f] = id;
    save({ told: { ...set, by }, set, times: [...times, stamp] });
    const title = one(item.title, 60);
    const text = [`${contact.name} 您好：`, "", `你通報的「${title}」有新進度：`, ...lines.map(l => "・" + l), "",
      `案件頁面：${SITE}/#issue/${encodeURIComponent(target)}`, "",
      "這是示範專案的自動通知，不是臺北市政府或 1999 的官方通知，請勿直接回覆。有問題請寫信到 labanchen@gmail.com。"].join("\n");
    // Errors log the case and the error code only, never the address or the message. A send that surely failed (not a
    // timeout, which may still arrive) is undone, so the next notice repeats these changes and the cap is not used up.
    this.ctx.waitUntil(mail(this.env, { to: contact.email, from: { email: this.env.NOTICE_FROM, name: "台北市民 1999 通報地圖（示範）" },
      subject: `陳情進度更新：${title}`, text, html: escHtml(text).replace(/\n/g, "<br>") }).catch(e => {
      console.error("notice_failed", target, e.code || "error");
      const cur = JSON.parse(this.sql.exec("SELECT v FROM notices WHERE k = ?", target).toArray()[0]?.v || "null");
      if (e.code === "E_TIMEOUT" || !cur) return;
      // Undo only what this notice told; a notice that was sent meanwhile keeps what it told
      const t = cur.told, i = cur.times.indexOf(stamp);
      if (i >= 0) cur.times.splice(i, 1);
      for (const f of ["status", "dept"]) if (t.by?.[f] === id) { t[f] = told[f]; t.by[f] = told.by?.[f]; }
      for (const f of ["prs", "merged"]) t[f] = t[f].filter(p => has(told[f], p.k) || !has(set[f], p.k));
      save(cur);
    }));
  }

  publicCase(target) {
    if (typeof target !== "string" || target.length > 140 || !CASE_ID.test(target)) return false;
    const colon = target.indexOf(":"), owner = colon < 0 ? "demo-seed" : target.slice(0, colon), key = colon < 0 ? target : target.slice(colon + 1);
    if (colon >= 0 && !VISITOR_ID.test(owner)) return false;
    const report = this.sql.exec("SELECT data FROM docs WHERE path = ?", `reports/${owner}`).toArray()[0];
    const item = report && JSON.parse(report.data).items?.[key];
    if (!isObj(item) || !REPORT_ITEM.test(key) || typeof item.title !== "string" || typeof item.body !== "string" || !Number.isFinite(Date.parse(item.createdAt))) return false;
    if (owner !== "demo-seed" && item.author !== owner) return false;
    const triage = this.sql.exec("SELECT data FROM docs WHERE path = ?", `triage/${target}`).toArray()[0];
    const status = triage ? JSON.parse(triage.data) : {};
    return status.hidden !== true && !(item.flagged === true && status.hidden !== false);
  }

  // Hidden items never reach the public snapshot, so the owner gets a count to explain an empty 我的陳情 list.
  hiddenCount(owner) {
    if (typeof owner !== "string" || !VISITOR_ID.test(owner)) return 0;
    const row = this.sql.exec("SELECT data FROM docs WHERE path = ?", `reports/${owner}`).toArray()[0];
    const items = row && JSON.parse(row.data).items;
    if (!isObj(items)) return 0;
    let n = 0;
    for (const [key, item] of Object.entries(items)) {
      if (!isObj(item) || item.author !== owner) continue;
      const t = this.sql.exec("SELECT data FROM docs WHERE path = ?", `triage/${owner}:${key}`).toArray()[0];
      const triage = t ? JSON.parse(t.data) : {};
      if (triage.hidden === true || (item.flagged === true && triage.hidden !== false)) n++;
    }
    return n;
  }

  // Numbers are assigned once, when a case is created, and never recomputed from what a viewer can see.
  // Start above every stored issue number and PR number so the two kinds never collide.
  // ponytail: scans every reports and triage doc; fine for a demo-sized database.
  nextCaseNumber() {
    let max = 0;
    for (const r of this.sql.exec("SELECT data FROM docs WHERE path LIKE 'reports/%'").toArray()) {
      const items = JSON.parse(r.data).items;
      if (isObj(items)) for (const x of Object.values(items)) if (isObj(x) && caseNo(x.n)) max = Math.max(max, x.n);
    }
    for (const r of this.sql.exec("SELECT data FROM docs WHERE path LIKE 'triage/%'").toArray()) {
      const events = JSON.parse(r.data).events;
      if (Array.isArray(events)) for (const e of events) if (isObj(e) && e.type === "pr" && caseNo(e.n)) max = Math.max(max, e.n);
    }
    return Math.min(999999, max + 1);
  }

  // Release notes name cases by number; a case hidden after the release still must not reach visitors.
  // Cached per seq: every doc write bumps seq, and a snapshot calls this once per release doc.
  hiddenCaseNumbers() {
    if (this.hiddenCache?.seq === this.seq) return this.hiddenCache.out;
    const out = new Set();
    for (const r of this.sql.exec("SELECT path, data FROM docs WHERE path LIKE 'reports/%'").toArray()) {
      const owner = r.path.slice(8), items = JSON.parse(r.data).items;
      if (!isObj(items)) continue;
      for (const [key, item] of Object.entries(items))
        if (isObj(item) && caseNo(item.n) && !this.publicCase(owner === "demo-seed" ? key : `${owner}:${key}`)) out.add(item.n);
    }
    this.hiddenCache = { seq: this.seq, out };
    return out;
  }

  // A doc as a visitor may see it. null removes the doc from their snapshot; reports and addenda keep only public entries.
  publicDoc(path, doc) {
    if (path === "demo/snapshot") return null; // admin-only demo tooling; it lists hidden triage ids and the admin's votes
    if (path.startsWith("reports/")) {
      if (!isObj(doc) || !isObj(doc.items)) return {};
      const owner = path.slice(8), items = {};
      for (const [key, item] of Object.entries(doc.items)) if (this.publicCase(owner === "demo-seed" ? key : `${owner}:${key}`)) items[key] = item;
      return { ...doc, items };
    }
    if (path.startsWith("triage/")) return this.publicCase(path.slice(7)) ? doc : null;
    if (path.startsWith("addenda/")) {
      if (!isObj(doc) || !isObj(doc.items)) return {};
      const owner = path.slice("addenda/".length);
      const items = {};
      for (const [id, addendum] of Object.entries(doc.items)) {
        if (!isObj(addendum) || !this.publicCase(addendum.target)) continue;
        if (typeof addendum.text !== "string" || addendum.text.length > 500) continue;
        const photos = Array.isArray(addendum.photos) ? addendum.photos : [];
        if (photos.length > 3 || photos.some(k => typeof k !== "string" || !PHOTO_KEY.test(k) || !k.startsWith(owner + "/"))) continue;
        items[id] = addendum;
      }
      return { ...doc, items };
    }
    if (path.startsWith("releases/")) {
      if (!isObj(doc)) return doc;
      const hidden = this.hiddenCaseNumbers();
      if (!hidden.size) return doc;
      const ref = new RegExp(`#(?:${[...hidden].join("|")})(?!\\d)`);
      const fixed = Array.isArray(doc.fixed) ? doc.fixed.filter(n => !hidden.has(n)) : null;
      const count = fixed ? `本週修好 ${fixed.length} 件` : null;
      const clean = s => String(s ?? "").split("\n").filter(line => !ref.test(line)).join("\n")
        .replace(/本週修好\s*\d+\s*件/g, count ?? "$&");
      const out = { ...doc, body: clean(doc.body) };
      if (typeof doc.title === "string") out.title = clean(doc.title);
      if (fixed) out.fixed = fixed;
      return out;
    }
    return doc;
  }

  // The Worker has already checked who may write where; this checks the data and applies it.
  // New report items in a visitor write: at most one per write, fresh createdAt, not a copy of a recent report, within quota.
  // needContact is false only for create-report, which saves the contact in the same transaction.
  floodCheck(path, oldDoc, doc, ip, needContact = true) {
    if (!path.startsWith("reports/")) return null;
    const old = isObj(oldDoc?.items) ? oldDoc.items : {}, items = isObj(doc.items) ? doc.items : {};
    // A visitor may not choose a number: an existing case keeps its stored n, and a new case is numbered below.
    for (const [k, x] of Object.entries(items)) {
      if (!isObj(x)) continue;
      const prev = old[k];
      if (isObj(prev) && caseNo(prev.n)) x.n = prev.n; else delete x.n;
    }
    const fresh = Object.keys(items).filter(k => !Object.hasOwn(old, k));
    if (!fresh.length) return null;
    if (fresh.length > 1) return { status: 400, error: "one_report_per_write" };
    const it = items[fresh[0]], now = Date.now(), t = Date.parse(it?.createdAt);
    if (!(Math.abs(now - t) <= SKEW)) return { status: 400, error: "bad_created_at" };
    const who = path.slice(8), n = (sql, ...a) => this.sql.exec(sql, ...a).toArray()[0].c;
    this.sql.exec("DELETE FROM quota WHERE t < ?", now - 24 * 60 * MIN);
    if (n("SELECT COUNT(*) c FROM quota WHERE who = ? AND t > ?", who, now - 10 * MIN) >= PER_VISITOR_10MIN ||
        n("SELECT COUNT(*) c FROM quota WHERE who = ? AND t > ?", who, now - 24 * 60 * MIN) >= PER_VISITOR_DAY ||
        n("SELECT COUNT(*) c FROM quota WHERE ip = ? AND t > ?", ip, now - 10 * MIN) >= PER_IP_10MIN) return { status: 429, error: "report_quota" };
    // ponytail: scans every reports doc; fine for a demo-sized database, index body hashes if it grows
    const body = norm(it.body);
    if (body.length >= 4) for (const r of this.sql.exec("SELECT data FROM docs WHERE path LIKE 'reports/%'").toArray())
      for (const x of Object.values(JSON.parse(r.data).items || {}))
        if (x && x !== it && now - Date.parse(x.createdAt) < DUP_WINDOW && norm(x.body) === body) return { status: 409, error: "duplicate_report" };
    if (needContact && !this.sql.exec("SELECT 1 FROM contacts WHERE k = ?", `${who}:${fresh[0]}`).toArray().length) return { status: 400, error: "bad_contact" };
    this.sql.exec("INSERT INTO quota VALUES (?, ?, ?)", who, ip, now);
    if (isObj(it)) it.n = this.nextCaseNumber();
    return null;
  }

  // trusted: the writer sent the real ADMIN_TOKEN, not just the demo x-admin; only its triage writes send notices
  write(op, path, data, admin, ip = "", trusted = false) {
    const row = this.sql.exec("SELECT data FROM docs WHERE path = ?", path).toArray()[0];
    // A triage write lists the events it appends in `added` (never stored). Notices trust that list, not the events array.
    let added = [];
    if (path.startsWith("triage/") && isObj(data) && Object.hasOwn(data, "added")) ({ added, ...data } = data);
    const creating = op === "create-report";
    let reportContact = null, contactKey = null;
    if (creating) {
      if (admin || !path.startsWith("reports/") || !isObj(data) || !REPORT_ITEM.test(data.key || "") || !isObj(data.item) || data.item.author !== path.slice(8))
        return { status: 400, error: "bad_request" };
      const current = row ? JSON.parse(row.data) : {};
      if (isObj(current.items) && Object.hasOwn(current.items, data.key)) return { status: 200, data: current, seq: this.seq, created: false };
      // Contact is required: a missing or null contact is a bad_contact, so every new case has a reachable reporter.
      // Plain update/set writes skip this check because floodCheck requires an already saved contact for fresh items.
      const c = data.contact;
      const name = typeof c?.name === "string" ? c.name.trim() : "";
      const phone = typeof c?.phone === "string" ? c.phone.replace(/[\s-]/g, "") : "";
      const email = typeof c?.email === "string" ? c.email.trim() : "";
      if (!isObj(c) || !name || name.length > 30 || !/^09\d{8}$/.test(phone) || !validEmail(email) || typeof c.realName !== "boolean")
        return { status: 400, error: "bad_contact" };
      // The client drops an item with a bad title, body or tags, so reject it here instead of storing an invisible case.
      const it = data.item;
      if (typeof it.title !== "string" || !it.title.trim() || it.title.length > 200 ||
          typeof it.body !== "string" || !it.body.trim() || it.body.length > 2000 ||
          (it.tags !== undefined && (!Array.isArray(it.tags) || !it.tags.every(tag => typeof tag === "string"))))
        return { status: 400, error: "bad_item" };
      // notify() reads `email` from here for progress notices; only the token admin's /api/contact reads the row back
      reportContact = { name, phone, email, realName: c.realName, t: new Date().toISOString() };
      contactKey = `${path.slice(8)}:${data.key}`;
      // The case number is permanent and assigned here, once; a number the client sent is ignored.
      data.item.n = this.nextCaseNumber();
      data = { items: { [data.key]: data.item } }; op = "update";
    }
    let doc = null;
    if (op === "append-note") {
      if (admin || !path.startsWith("reports/") || !isObj(data) || !REPORT_ITEM.test(data.key || "") || !NOTE_ID.test(data.id || "")) return { status: 400, error: "bad_request" };
      if (!row) return { status: 404, error: "not_found" };
      const owner = path.slice(8), current = JSON.parse(row.data), item = current.items?.[data.key];
      if (!isObj(current.items) || !isObj(item) || item.author !== owner) return { status: 404, error: "not_found" };
      if (item.notes !== undefined && !Array.isArray(item.notes)) return { status: 400, error: "bad_data" };
      const notes = item.notes || [];
      if (notes.some(n => isObj(n) && n.id === data.id)) return { status: 200, data: current, seq: this.seq };
      const text = typeof data.text === "string" ? data.text.trim() : "", photos = data.photos;
      if (typeof data.text !== "string" || data.text.length > 500 || !Array.isArray(photos) || photos.length > 3 ||
          photos.some(k => typeof k !== "string" || !PHOTO_KEY.test(k) || !k.startsWith(owner + "/")) || (!text && !photos.length))
        return { status: 400, error: "bad_note" };
      if (notes.length >= 10) return { status: 400, error: "note_limit" };
      doc = { ...current, items: { ...current.items, [data.key]: { ...item, notes: [...notes, { id: data.id, t: new Date().toISOString(), text, photos }] } } };
      if (new TextEncoder().encode(JSON.stringify(doc)).length > DOC_MAX) return { status: 413, error: "too_large" };
      this.sql.exec("INSERT OR REPLACE INTO docs VALUES (?, ?)", path, JSON.stringify(doc));
    } else if (op === "append-addendum") {
      if (admin || !path.startsWith("addenda/") || path !== `addenda/${path.slice(8)}` || !VISITOR_ID.test(path.slice(8)) ||
          !isObj(data) || !NOTE_ID.test(data.id || "")) return { status: 400, error: "bad_request" };
      const owner = path.slice(8), current = row ? JSON.parse(row.data) : {}, items = isObj(current.items) ? current.items : {};
      const text = typeof data.text === "string" ? data.text : "", photos = data.photos;
      if (typeof data.target !== "string" || data.target.length > 140 || typeof data.text !== "string" || text.length > 500 ||
          !Array.isArray(photos) || photos.length > 3 ||
          photos.some(k => typeof k !== "string" || !PHOTO_KEY.test(k) || !k.startsWith(owner + "/")) || (!text.trim() && !photos.length))
        return { status: 400, error: "bad_addendum" };
      const old = items[data.id];
      if (old !== undefined) {
        const same = isObj(old) && old.target === data.target && old.text === text && Array.isArray(old.photos) &&
          old.photos.length === photos.length && old.photos.every((k, i) => k === photos[i]);
        return same ? { status: 200, data: current, seq: this.seq, created: false } : { status: 409, error: "idempotency_conflict" };
      }
      if (!this.publicCase(data.target)) return { status: 404, error: "not_found" };
      if (Object.keys(items).length >= ITEMS_MAX) return { status: 400, error: "too_many_items" };
      const addendum = { target:data.target, t:new Date().toISOString(), text, photos:[...photos] };
      doc = { ...current, items:{ ...items, [data.id]:addendum } };
      if (new TextEncoder().encode(JSON.stringify(doc)).length > DOC_MAX) return { status: 413, error: "too_large" };
      this.sql.exec("INSERT OR REPLACE INTO docs VALUES (?, ?)", path, JSON.stringify(doc));
    } else if (op !== "delete") {
      if (!isObj(data)) return { status: 400, error: "bad_data" };
      doc = op === "update" ? merge(row ? JSON.parse(row.data) : {}, data) : data;
      // ponytail: admin gets a looser cap so seeding big demo docs works; the demo admin has no token, so it is still capped.
      if (admin && new TextEncoder().encode(JSON.stringify(doc)).length > ADMIN_DOC_MAX) return { status: 413, error: "too_large" };
      if (!admin) {
        if (new TextEncoder().encode(JSON.stringify(doc)).length > DOC_MAX) return { status: 413, error: "too_large" };
        if (isObj(doc.items) && Object.keys(doc.items).length > ITEMS_MAX) return { status: 400, error: "too_many_items" };
      }
      const failure = this.ctx.storage.transactionSync(() => {
        if (!admin) { const f = this.floodCheck(path, row && JSON.parse(row.data), doc, ip, !reportContact); if (f) return f; }
        this.sql.exec("INSERT OR REPLACE INTO docs VALUES (?, ?)", path, JSON.stringify(doc));
        if (reportContact) this.contactPut(contactKey, reportContact);
        return null;
      });
      if (failure) return failure;
    } else this.sql.exec("DELETE FROM docs WHERE path = ?", path);
    this.seq++; this.sql.exec("INSERT OR REPLACE INTO counter VALUES ('seq', ?)", this.seq);
    // A triage change can hide or reveal a case, so visitors also need the owner's report doc re-filtered;
    // otherwise deleting the triage doc would make the still-cached report item visible again.
    let reportPath = null, reportPublic = null;
    if (path.startsWith("triage/")) {
      const target = path.slice(7), colon = target.indexOf(":");
      reportPath = `reports/${colon < 0 ? "demo-seed" : target.slice(0, colon)}`;
      const row = this.sql.exec("SELECT data FROM docs WHERE path = ?", reportPath).toArray()[0];
      if (row) reportPublic = this.publicDoc(reportPath, JSON.parse(row.data));
    }
    for (const ws of this.ctx.getWebSockets()) {
      const adminSocket = ws.deserializeAttachment()?.admin === true;
      try {
        if (reportPath && reportPublic && !adminSocket) ws.send(JSON.stringify({ path: reportPath, data: reportPublic, seq: this.seq }));
        const data = adminSocket || doc === null ? doc : this.publicDoc(path, doc);
        ws.send(JSON.stringify({ path, data, seq: this.seq }));
      } catch {}
    }
    if (trusted && doc && path.startsWith("triage/")) this.notify(path.slice(7), row && JSON.parse(row.data), doc, Array.isArray(added) ? added : []);
    return { status: 200, data: doc, seq: this.seq, ...(creating || op === "append-addendum" ? { created: true } : {}) };
  }

  async fetch(req) {
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    // Demo mode: the admin page adds ?admin; any socket with it gets the admin view, no token needed.
    server.serializeAttachment({ admin: new URL(req.url).searchParams.has("admin") });
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage() {} // read-only socket: clients write through POST /api/db
  webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code); } catch {} }

  cacheGet(k) {
    const r = this.sql.exec("SELECT v FROM cache WHERE k = ? AND exp > ?", k, Date.now()).toArray()[0];
    return r && JSON.parse(r.v);
  }
  cachePut(k, v, ttlMs) { this.sql.exec("INSERT OR REPLACE INTO cache VALUES (?, ?, ?)", k, JSON.stringify(v), Date.now() + ttlMs); }

  // Nominatim allows 1 req/s: cache misses queue behind one chain and wait out the gap; more than 5 waiting are refused.
  // ponytail: cached in DO storage, not the Cache API, because caches.default is a no-op on *.workers.dev.
  geocode(q) {
    const u = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "tw", viewbox: TAIPEI_VIEWBOX, bounded: "1", q });
    return this.nominatim("geo:" + q.toLowerCase(), u, j => j[0] ? { lat: +j[0].lat, lng: +j[0].lon } : { lat: null });
  }
  // Reverse lookup for a long-pressed spot. Rounded to ~10 m so nearby presses share one cache entry.
  reverse(lat, lng) {
    const la = lat.toFixed(4), ln = lng.toFixed(4);
    const u = "https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({ format: "jsonv2", lat: la, lon: ln, zoom: "18", addressdetails: "1" });
    return this.nominatim(`rev:${la},${ln}`, u, j => {
      const a = j.address || {}, district = a.suburb || a.city_district || "";
      const street = a.road ? a.road + (a.house_number ? a.house_number.replace(/號?$/, "號") : "") : "";
      const address = (a.city || "") + district + (street || j.name || "");
      return { address: address.slice(0, 100) || null, district };
    });
  }
  async nominatim(key, u, shape) {
    const hit = this.cacheGet(key);
    if (hit) return hit;
    if (this.pending >= 5) return { error: "busy", status: 429 };
    this.pending++;
    const run = this.chain.then(async () => {
      const again = this.cacheGet(key);
      if (again) return again;
      await sleep(Math.max(0, this.lastGeo + 1100 - Date.now()));
      // lastGeo is stamped after the last attempt (retries included) ends, so the next query always waits a full gap
      let j;
      try { j = await (await get(u, { "user-agent": NOMINATIM_UA, "accept-language": "zh-TW" }, 1100)).json(); } finally { this.lastGeo = Date.now(); }
      const out = shape(j);
      this.cachePut(key, out, 7 * 864e5);
      return out;
    });
    this.chain = run.catch(() => {});
    try { return await run; } catch { return { error: "upstream_error", status: 502 }; } finally { this.pending--; }
  }

  async news() {
    const hit = this.cacheGet("news3");
    if (hit) return hit;
    const [g, p] = await Promise.allSettled([bingNews(), pttNews()]);
    const out = { items: [...THREADS, ...(g.value || []), ...(p.value || [])] };
    if (!out.items.length) return { error: "upstream_error", status: 502 };
    // A source that failed or came back empty (bot page, changed markup) counts as down: retry in 1 min, not 10
    const up = r => r.status === "fulfilled" && r.value.length > 0;
    this.cachePut("news3", out, up(g) && up(p) ? 10 * 60e3 : 60e3);
    return out;
  }
}
