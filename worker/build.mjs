// Builds public/index.html: the artifact page plus a window.claude stand-in.
// State lives in the Worker's Hub Durable Object: the shim loads GET /api/db, applies pushes from /api/ws, and writes via POST /api/db.
// AI calls go to the Worker's /api/sample. ?admin=<token> sends x-admin so the presenter gets the bureau controls (merge, draft release).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const page = readFileSync(here("../taipei-issues.html"), "utf8");

const shim = `<script>
(() => {
let DATA = {};
const subs = [];
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const docSnap = (id, d) => ({ id, exists: d !== undefined, data: () => clone(d) });
const colSnap = c => ({ docs: Object.entries(DATA[c] || {}).map(([id, d]) => docSnap(id, d)), metadata: { fromCache: false } });
const fire = () => setTimeout(() => subs.forEach(s => s.run()));
// Every request: 8 s timeout, one retry on network error / 5xx
const req = async (url, init = {}) => {
  let last;
  for (let k = 0; k < 2; k++) {
    try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) }); if (r.status < 500) return r; last = new Error(url + " " + r.status); }
    catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 500));
  }
  throw last;
};
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
// Admin token moves from ?admin=<token> to sessionStorage and is stripped from the URL bar, so the projector never shows it.
const adminToken = (() => {
  const q = new URLSearchParams(location.search), t = q.get("admin");
  if (t === null) { try { return sessionStorage.getItem("admin") || ""; } catch { return ""; } }
  try { sessionStorage.setItem("admin", t); } catch {}
  q.delete("admin"); history.replaceState(null, "", location.pathname + (q.size ? "?" + q : "") + location.hash);
  return t;
})();

// Visitor identity: "<id>.<signature>" from the Worker, kept in localStorage; the page only sees the id.
const visitor = (async () => {
  let t = store.get("tit-visitor");
  if (!/^[\\da-f]{16}\\.[\\da-f]{64}$/.test(t || "")) {
    try { t = (await (await req("/api/visitor", { method: "POST" })).json()).id; store.set("tit-visitor", t); } catch { t = null; }
  }
  return t;
})();

const load = async () => { const r = await req("/api/db"); if (!r.ok) throw new Error("db " + r.status); DATA = await r.json(); };
const ready = load(); ready.catch(() => {});
const apply = (path, d) => { const [c, id] = path.split("/"); if (d === null) { if (DATA[c]) delete DATA[c][id]; } else (DATA[c] ||= {})[id] = d; fire(); };
const connect = () => {
  const ws = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/api/ws");
  ws.onmessage = e => { try { const m = JSON.parse(e.data); apply(m.path, m.data); } catch {} };
  // Dropped: wait 2 s, reconnect, and refetch everything that was missed meanwhile
  ws.onclose = () => setTimeout(() => { connect(); load().then(fire, () => {}); }, 2000);
};
connect();

const write = async (op, path, data) => {
  await ready;
  const h = { "content-type": "application/json" };
  if (adminToken) h["x-admin"] = adminToken;
  const v = await visitor; if (v) h["x-visitor"] = v;
  const r = await req("/api/db", { method: "POST", headers: h, body: JSON.stringify({ op, path, data }) });
  if (!r.ok) throw new Error("write " + r.status);
  apply(path, (await r.json()).data); // own write shows at once; the broadcast echo is idempotent
};
const ref = (c, id) => ({
  get: async () => { await ready; return docSnap(id, (DATA[c] || {})[id]); },
  set: d => write("set", c + "/" + id, clone(d)),
  update: d => write("update", c + "/" + id, clone(d)),
  delete: () => write("delete", c + "/" + id),
  // ponytail: no lock here, so two admins editing one case can overwrite each other; a real lock needs a lock row in the Hub DO.
  acquire: async () => ({ acquired: true }),
  onSnapshot(cb, err) { subs.push({ run: () => cb(docSnap(id, (DATA[c] || {})[id])) }); ready.then(fire, () => err && err(new Error("db unavailable"))); },
});
const db = {
  doc: p => { const [c, id] = p.split("/"); return ref(c, id); },
  collection: c => ({ doc: id => ref(c, id), get: async () => { await ready; return colSnap(c); }, onSnapshot(cb, err) { subs.push({ run: () => cb(colSnap(c)) }); ready.then(fire, () => err && err(new Error("db unavailable"))); } }),
};
const user = { id: async () => ((await visitor) || "").split(".")[0] || null, canEdit: async () => !!adminToken };
const sample = { async json(prompt, { modelTier, signal } = {}) {
  const r = await fetch("/api/sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, tier: modelTier || "default" }), signal });
  if (r.ok) return r.json();
  const e = new Error("sample " + r.status); if (r.status === 502) e.code = "upstream_error"; throw e;
} };
const geocode = async q => { try { const j = await (await req("/api/geocode?q=" + encodeURIComponent(q))).json(); return j.lat == null ? null : { lat: j.lat, lng: j.lng }; } catch { return null; } };
const news = async () => { try { return (await (await req("/api/news")).json()).items || []; } catch { return []; } };
const ai = fetch("/api/health", { signal: AbortSignal.timeout(5000) }).then(r => r.json()).then(j => j.ai).catch(() => false);
window.claude = { use: async n => n === "sample" ? ((await ai) ? sample : null) : ({ db, user, geocode, news })[n] ?? null };
})();
</script>`;

mkdirSync(here("public"), { recursive: true });
writeFileSync(here("public/index.html"), `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>台北市 Issue Tracker</title></head><body style="margin:0">
<div style="font:13px system-ui;padding:6px 12px;background:#fff3cd;color:#664d03">展示版：資料為模擬資料，所有訪客共用、即時同步。</div>
${shim}${page}</body></html>`);
console.log("built public/index.html");
