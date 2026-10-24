// Builds public/index.html: the artifact page plus a window.claude stand-in.
// State lives in the Worker's Hub Durable Object: the shim loads GET /api/db, applies pushes from /api/ws, and writes via POST /api/db.
// AI calls go to the Worker's /api/sample. ?admin=<token> sends x-admin so the presenter gets the bureau controls (merge, draft release).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
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

// seq: the Hub numbers every write. baseSeq is the seq of the snapshot DATA came from; pathSeq holds paths updated
// after it. Anything at or below max(baseSeq, pathSeq[path]) is already reflected, so late replies, late socket
// messages and older snapshots can never roll data back.
const pathSeq = {};
let baseSeq = -1;
const put = (path, d) => { const [c, id] = path.split("/"); if (d === null) { if (DATA[c]) delete DATA[c][id]; } else (DATA[c] ||= {})[id] = d; };
const apply = (path, d, seq) => { if (!(seq > Math.max(baseSeq, pathSeq[path] || 0))) return; pathSeq[path] = seq; put(path, d); fire(); };
const load = async () => {
  const r = await req("/api/db"); if (!r.ok) throw new Error("db " + r.status);
  const { _seq = 0, ...fresh } = await r.json(), old = DATA;
  if (_seq < baseSeq) return; // an older snapshot finished after a newer one
  DATA = fresh; baseSeq = _seq;
  for (const [path, s] of Object.entries(pathSeq)) {
    if (s > _seq) { const [c, id] = path.split("/"); put(path, old[c]?.[id] ?? null); } else delete pathSeq[path];
  }
};
// ready is replaced on every reload, so a failed first load recovers once the socket reconnects
let ready = load(); ready.catch(() => {});
// Banner while the live socket is down; shown only after 3 s so a quick reconnect does not flash it
let offTimer = null, banner;
const offline = on => {
  if (!on) { clearTimeout(offTimer); offTimer = null; if (banner) banner.hidden = true; return; }
  if (offTimer || (banner && !banner.hidden)) return; // reconnect attempts every 2 s must not restart the 3 s wait
  offTimer = setTimeout(() => { offTimer = null;
    if (!banner) { banner = document.createElement("div"); banner.setAttribute("role", "status"); banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:3000;padding:8px 12px;background:#9a6700;color:#fff;font:14px system-ui;text-align:center"; banner.textContent = "連線中斷，重新連線中…地圖與列表暫停更新"; document.body.append(banner); }
    banner.hidden = false;
  }, 3000);
};
addEventListener("offline", () => offline(true));
const connect = () => {
  const ws = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/api/ws");
  ws.onmessage = e => { try { const m = JSON.parse(e.data); apply(m.path, m.data, m.seq); } catch {} };
  // Refetch on every open: covers writes between the first snapshot and this socket, and anything missed while dropped
  ws.onopen = () => { offline(false); ready = load(); ready.then(fire, () => {}); };
  ws.onclose = () => { offline(true); setTimeout(connect, 2000); };
};
connect();

const write = async (op, path, data) => {
  await ready;
  const h = { "content-type": "application/json" };
  if (adminToken) h["x-admin"] = adminToken;
  const v = await visitor; if (v) h["x-visitor"] = v;
  const r = await req("/api/db", { method: "POST", headers: h, body: JSON.stringify({ op, path, data }) });
  if (!r.ok) throw Object.assign(new Error("write " + r.status), { status: r.status });
  const j = await r.json(); apply(path, j.data, j.seq); // own write shows at once; the broadcast echo is ignored by seq
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
  updateCreates: true, // the Hub's update() creates a missing doc
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
const revgeo = async (lat, lng) => { try { const j = await (await req("/api/geocode?lat=" + lat + "&lng=" + lng)).json(); return j.address ? j : null; } catch { return null; } };
// 1999 dispatch history (Jan–Sep 2026), a static file of about 1.8 MB: loaded once, on first use
let histP = null;
const hist = () => histP ||= (async () => { for (let i = 0; i < 2; i++) try { const r = await fetch("/history-2026.json", { signal: AbortSignal.timeout(30000) }); if (r.ok) return await r.json(); } catch {} histP = null; return null; })();
// Report photos: one JPEG/WebP blob in, its R2 key out (20 s timeout, one retry on network error / 5xx)
const photo = async blob => {
  const h = { "content-type": blob.type || "image/jpeg" };
  if (adminToken) h["x-admin"] = adminToken;
  const v = await visitor; if (v) h["x-visitor"] = v;
  let last;
  for (let k = 0; k < 2; k++) {
    try {
      const r = await fetch("/api/photo", { method: "POST", headers: h, body: blob, signal: AbortSignal.timeout(20000) });
      if (r.ok) return (await r.json()).key;
      last = Object.assign(new Error("photo " + r.status), { status: r.status });
      if (r.status < 500) break;
    } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 800));
  }
  throw last;
};
photo.url = key => "/api/photo/" + key;
window.claude = { use: async n => n === "sample" ? ((await ai) ? sample : null) : ({ db, user, geocode, revgeo, news, history: hist, photo })[n] ?? null };
})();
</script>`;

mkdirSync(here("public"), { recursive: true });
if (existsSync(here("../data/history-2026.json"))) copyFileSync(here("../data/history-2026.json"), here("public/history-2026.json"));
writeFileSync(here("public/index.html"), `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>台北市 Issue Tracker</title></head><body style="margin:0">
<div style="font:13px system-ui;padding:6px 12px;background:#fff3cd;color:#664d03">展示版：資料為模擬資料，所有訪客共用、即時同步。</div>
${shim}${page}</body></html>`);
console.log("built public/index.html");
