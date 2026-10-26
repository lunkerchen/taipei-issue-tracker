// Builds public/index.html: the artifact page plus a window.claude stand-in.
// State lives in the Worker's Hub Durable Object: the shim loads GET /api/db, applies pushes from /api/ws, and writes via POST /api/db.
// AI calls go to the Worker's /api/sample. ?admin sends x-admin so the presenter gets the bureau controls (merge, draft release); no token is checked.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const page = readFileSync(here("../taipei-issues.html"), "utf8");
// The artifact keeps its own title, but the Worker page already emits one in <head>.
const workerPage = page.replace(/^<title\b[^>]*>[\s\S]*?<\/title>\s*/i, "");

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
    try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) }); if (r.status < 500) return r; last = Object.assign(new Error(url + " " + r.status), { status: r.status }); }
    catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 500));
  }
  throw last;
};
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
// Demo mode, no token: ?admin turns the 局處後台 on and ?citizen turns it off; the choice stays in sessionStorage for this tab.
const adminToken = (() => {
  const q = new URLSearchParams(location.search), on = q.has("admin"), off = q.has("citizen");
  if (!on && !off) { try { return sessionStorage.getItem("admin") || ""; } catch { return ""; } }
  try { on ? sessionStorage.setItem("admin", "1") : sessionStorage.removeItem("admin"); } catch {}
  q.delete("admin"); q.delete("citizen"); history.replaceState(null, "", location.pathname + (q.size ? "?" + q : "") + location.hash);
  return on ? "1" : "";
})();

// Visitor identity: "<id>.<signature>" from the Worker, kept in localStorage; the page only sees the id.
let visitorStorageBlocked = false;
const visitorToken = /^[\\da-f]{16}\\.[\\da-f]{64}$/;
const getVisitor = async () => {
  const t = store.get("tit-visitor"), valid = visitorToken.test(t || "");
  // Confirm the stored token with the Worker: an unsigned or forged token looks valid but every write returns 403.
  // If the Worker cannot answer, keep a well-formed stored token so an offline reload stays usable.
  try {
    const response = await req("/api/visitor", { method: "POST", headers: valid ? { "x-visitor": t } : {} });
    if (!response.ok) return valid ? t : null;
    const next = (await response.json()).id;
    if (!visitorToken.test(next || "")) return valid ? t : null;
    if (next !== t) {
      store.set("tit-visitor", next);
      if (store.get("tit-visitor") !== next) { visitorStorageBlocked = true; return null; }
    }
    return next;
  } catch { return valid ? t : null; }
};
// Serialize first use across tabs, then re-read storage under the lock so all tabs keep the same identity.
const visitor = navigator.locks?.request ? navigator.locks.request("tit-visitor", getVisitor) : getVisitor();

// seq: the Hub numbers every write. baseSeq is the seq of the snapshot DATA came from; pathSeq holds paths updated
// after it. Anything at or below max(baseSeq, pathSeq[path]) is already reflected, so late replies, late socket
// messages and older snapshots can never roll data back.
const pathSeq = {};
let baseSeq = -1;
const put = (path, d) => { const [c, id] = path.split("/"); if (d === null) { if (DATA[c]) delete DATA[c][id]; } else (DATA[c] ||= {})[id] = d; };
const apply = (path, d, seq) => { if (!(seq > Math.max(baseSeq, pathSeq[path] || 0))) return; pathSeq[path] = seq; put(path, d); fire(); };
const load = async () => {
  const r = await req("/api/db", adminToken ? { headers: { "x-admin": adminToken } } : undefined); if (!r.ok) throw new Error("db " + r.status);
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
const OFFLINE_MSG = "連線中斷，重新連線中…地圖與列表暫停更新";
const offline = on => {
  if (!on) { clearTimeout(offTimer); offTimer = null; if (banner) { banner.hidden = true; banner.textContent = ""; } return; }
  if (offTimer || (banner && !banner.hidden)) return; // reconnect attempts every 2 s must not restart the 3 s wait
  offTimer = setTimeout(() => { offTimer = null;
    if (!banner) { banner = document.createElement("div"); banner.setAttribute("role", "status"); banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:3000;padding:8px 12px;background:#9a6700;color:#fff;font:14px system-ui;text-align:center"; document.body.append(banner); }
    banner.textContent = ""; banner.hidden = false;
    // Insert the text after the empty live region is visible, or assistive technology can miss it.
    requestAnimationFrame(() => { if (banner && !banner.hidden && !banner.textContent) banner.textContent = OFFLINE_MSG; });
  }, 3000);
};
addEventListener("offline", () => offline(true));
// A short network drop can leave the socket open; clear the banner when the network returns.
let live = null;
addEventListener("online", () => { if (live && live.readyState === WebSocket.OPEN) offline(false); });
let lastMsgAt = Date.now();
const connect = () => {
  const ws = live = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/api/ws" + (adminToken ? "?admin=" + encodeURIComponent(adminToken) : ""));
  ws.onmessage = e => { lastMsgAt = Date.now(); try { const m = JSON.parse(e.data); apply(m.path, m.data, m.seq); } catch {} };
  // Refetch on every open: covers writes between the first snapshot and this socket, and anything missed while dropped
  ws.onopen = () => { lastMsgAt = Date.now(); offline(false); ready = load(); ready.then(fire, () => {}); };
  ws.onclose = () => { offline(true); setTimeout(connect, 2000); };
};
connect();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastMsgAt > 15000) {
    if (live) try { live.close(); } catch {} else connect();
  }
});

const write = async (op, path, data, visitorOnly = false) => {
  await ready;
  const h = { "content-type": "application/json" };
  if (adminToken && !visitorOnly) h["x-admin"] = adminToken;
  const v = await visitor; if (v) h["x-visitor"] = v;
  const r = await req("/api/db", { method: "POST", headers: h, body: JSON.stringify({ op, path, data }) });
  if (!r.ok) throw Object.assign(new Error("write " + r.status), { status: r.status, error: (await r.json().catch(() => ({}))).error });
  const j = await r.json(); apply(path, j.data, j.seq); // own write shows at once; the broadcast echo is ignored by seq
  return j;
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
  appendNote: (path, key, note) => write("append-note", path, { key, ...clone(note) }, true),
  appendAddendum: (path, addendum) => write("append-addendum", path, clone(addendum), true),
  createReport: (path, key, item, contact) => write("create-report", path, { key, item: clone(item), ...(contact ? { contact: clone(contact) } : {}) }, true),
  doc: p => { const [c, id] = p.split("/"); return ref(c, id); },
  collection: c => ({ doc: id => ref(c, id), get: async () => { await ready; return colSnap(c); }, onSnapshot(cb, err) { subs.push({ run: () => cb(colSnap(c)) }); ready.then(fire, () => err && err(new Error("db unavailable"))); } }),
};
const user = { id: async () => ((await visitor) || "").split(".")[0] || null, canEdit: async () => !!adminToken,
  storageBlocked: async () => { await visitor; return visitorStorageBlocked; },
  // Hidden cases stay out of the public snapshot; this owner-only count lets 我的陳情 explain an empty list.
  hiddenMine: async () => {
    const v = await visitor; if (!v) return 0;
    try { const r = await req("/api/mine", { headers: { "x-visitor": v } }); return r.ok ? (await r.json()).hidden || 0 : 0; } catch { return 0; }
  } };
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
const photo = async (blob, visitorOnly = false) => {
  const h = { "content-type": blob.type || "image/jpeg" };
  if (adminToken && !visitorOnly) h["x-admin"] = adminToken;
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
// Reporter contact: save(item, {name, phone, email, realName}) for your own report; get(id) works for the admin only
const contactReq = async (url, init = {}, visitorOnly = false) => {
  const h = { ...(init.headers || {}) };
  if (adminToken && !visitorOnly) h["x-admin"] = adminToken;
  const v = await visitor; if (v) h["x-visitor"] = v;
  let last;
  for (let k = 0; k < 2; k++) {
    try {
      const r = await fetch(url, { ...init, headers: h, signal: AbortSignal.timeout(8000) });
      if (r.ok) return await r.json();
      last = Object.assign(new Error("contact " + r.status), { status: r.status });
      if (r.status < 500) break;
    } catch (e) { last = e; }
  }
  throw last;
};
const contact = {
  save: (item, c) => contactReq("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item, ...c }) }, true),
  get: async id => (await contactReq("/api/contact?id=" + encodeURIComponent(id))).contact
};
// Admin only: put the database back to the seed data, then reload this page's copy at once
const seedReset = async () => {
  const r = await fetch("/api/reset", { method: "POST", headers: { "x-admin": adminToken }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Object.assign(new Error("reset " + r.status), { status: r.status });
  const out = await r.json();
  // The reset already succeeded; a failed reload must not turn it into a reported failure.
  ready = load();
  try { await ready; fire(); } catch {}
  return out;
};
window.claude = { use: async n => n === "sample" ? ((await ai) ? sample : null) : ({ db, user, geocode, revgeo, news, history: hist, photo, contact, seedReset: adminToken ? seedReset : null })[n] ?? null };
})();
</script>`;

mkdirSync(here("public"), { recursive: true });
// Share card: og:image needs an absolute URL, so the live site address is fixed here
const SITE = "https://taipei-issue-tracker.labanchen.workers.dev", SITE_URL = `${SITE}/`;
const SITE_NAME = "台北市，你給我聽好了｜非官方示範";
const TITLE = "台北市，你給我聽好了｜市民 1999 通報地圖（非官方示範）";
const DESC = "個人開發的非官方示範網站，與臺北市政府及 1999 官方網站無關。本站通報不會轉交臺北市政府或 1999；公開案件與分派均為模擬。地圖時間軸與月報引用 data.taipei 的歷史派工資料。";
const WEBSITE_ID = `${SITE_URL}#website`, WEBPAGE_ID = `${SITE_URL}#webpage`, APPLICATION_ID = `${SITE_URL}#application`;
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: SITE_URL,
      name: SITE_NAME,
      description: DESC,
      inLanguage: "zh-Hant"
    },
    {
      "@type": "WebPage",
      "@id": WEBPAGE_ID,
      url: SITE_URL,
      name: TITLE,
      description: DESC,
      isPartOf: { "@id": WEBSITE_ID },
      mainEntity: { "@id": APPLICATION_ID },
      inLanguage: "zh-Hant"
    },
    {
      "@type": "WebApplication",
      "@id": APPLICATION_ID,
      url: SITE_URL,
      name: TITLE,
      description: DESC,
      isPartOf: { "@id": WEBSITE_ID },
      browserRequirements: "需要支援 JavaScript 的現代瀏覽器。",
      isAccessibleForFree: true,
      inLanguage: "zh-Hant"
    }
  ]
};
const jsonLd = JSON.stringify(structuredData, null, 2).replace(/</g, "\\u003c");
copyFileSync(here("../docs/og.jpg"), here("public/og.jpg"));
for (const f of ["history-2026.json", "districts.geojson", "li.geojson", "li-contacts.json", "councilors.json"]) if (existsSync(here("../data/" + f))) copyFileSync(here("../data/" + f), here("public/" + f));
writeFileSync(here("public/index.html"), `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title>
<meta name="description" content="${DESC}"><link rel="canonical" href="${SITE_URL}"><meta property="og:type" content="website"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:title" content="${TITLE}"><meta property="og:description" content="${DESC}">
<meta property="og:url" content="${SITE_URL}"><meta property="og:image" content="${SITE}/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${TITLE}"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${jsonLd}</script></head><body style="margin:0">
<div id="demo-notice" style="font:13px system-ui;padding:6px 12px;background:#fff3cd;color:#664d03">非官方示範：本站通報為模擬案件，不會轉交市府。所有訪客共用、即時同步。</div>
${shim}${workerPage}</body></html>`);
console.log("built public/index.html");
