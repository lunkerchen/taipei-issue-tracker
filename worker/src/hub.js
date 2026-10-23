// The one shared database: a SQLite-backed Durable Object that stores every document, fans writes out over hibernating
// WebSockets, and also owns the geocode/news caches so the 1 req/s Nominatim throttle is global.
// ponytail: a single instance serves every visitor; fine for a demo room, shard by collection before thousands of live sockets.
import { DurableObject } from "cloudflare:workers";
import seed from "../data.json";

const DOC_MAX = 32 * 1024, ITEMS_MAX = 20;
const TAIPEI_VIEWBOX = "121.45,25.22,121.67,24.95"; // left,top,right,bottom
const NOMINATIM_UA = "taipei-issue-tracker (labanchen@gmail.com)";
const GOOGLE_NEWS = "https://news.google.com/rss/search?q=" + encodeURIComponent("臺北") + "&hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
const PTT = "https://www.ptt.cc/bbs/Taipei/index.html";
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Same one-level-deep merge as the page's artifact runtime uses for update()
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(o[k]) ? { ...o[k], ...v } : v; return o; };

// Every outbound fetch: 8 s timeout, one retry on network error / 5xx / 429
async function get(url, headers) {
  let last;
  for (let k = 0; k < 2; k++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (r.ok) return r;
      last = new Error("upstream " + r.status);
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) { last = e; }
    await sleep(500);
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

async function googleNews() {
  const xml = await (await get(GOOGLE_NEWS)).text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, x]) => {
    const source = clean(tag(x, "source")) || "Google News";
    const title = clean(tag(x, "title")).replace(new RegExp(" - " + source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "");
    const t = Date.parse(tag(x, "pubDate"));
    return { title, url: clean(tag(x, "link"), 2000), source, time: t ? new Date(t).toISOString() : "", t: t || 0 };
  }).filter(i => i.title && /^https?:\/\//.test(i.url)).sort((a, b) => b.t - a.t).slice(0, 15).map(({ t, ...i }) => i);
}

async function pttNews() {
  const html = (await (await get(PTT)).text()).split("r-list-sep")[0]; // drop pinned posts below the separator
  return html.split('class="r-ent"').slice(1).map(x => {
    const m = /<div class="title">\s*<a href="([^"]+)">([^<]*)<\/a>/.exec(x);
    return m && { title: clean(m[2]), url: "https://www.ptt.cc" + m[1], source: "PTT Taipei", time: clean((/class="date">\s*([^<]*)</.exec(x) || [])[1] || "") };
  }).filter(i => i && i.title).reverse().slice(0, 15); // the index lists oldest first
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.pending = 0; this.chain = Promise.resolve(); this.lastGeo = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY)");
      // Seed once; the meta row stops an emptied database from reseeding itself
      if (!this.sql.exec("SELECT 1 FROM meta WHERE k = 'seeded'").toArray().length) {
        for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) this.sql.exec("INSERT OR REPLACE INTO docs VALUES (?, ?)", `${c}/${id}`, JSON.stringify(d));
        this.sql.exec("INSERT INTO meta VALUES ('seeded')");
      }
    });
  }

  snapshot() {
    const out = {};
    for (const { path, data } of this.sql.exec("SELECT path, data FROM docs")) { const [c, id] = path.split("/"); (out[c] ||= {})[id] = JSON.parse(data); }
    return out;
  }

  // The Worker has already checked who may write where; this checks the data and applies it.
  write(op, path, data, admin) {
    const row = this.sql.exec("SELECT data FROM docs WHERE path = ?", path).toArray()[0];
    let doc = null;
    if (op !== "delete") {
      if (!isObj(data)) return { status: 400, error: "bad_data" };
      doc = op === "update" ? merge(row ? JSON.parse(row.data) : {}, data) : data;
      // ponytail: admin skips the size caps so seeding big demo docs works; visitors are capped.
      if (!admin) {
        if (new TextEncoder().encode(JSON.stringify(doc)).length > DOC_MAX) return { status: 413, error: "too_large" };
        if (isObj(doc.items) && Object.keys(doc.items).length > ITEMS_MAX) return { status: 400, error: "too_many_items" };
      }
      this.sql.exec("INSERT OR REPLACE INTO docs VALUES (?, ?)", path, JSON.stringify(doc));
    } else this.sql.exec("DELETE FROM docs WHERE path = ?", path);
    const msg = JSON.stringify({ path, data: doc });
    for (const ws of this.ctx.getWebSockets()) try { ws.send(msg); } catch {}
    return { status: 200, data: doc };
  }

  fetch(req) {
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
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
  async geocode(q) {
    const key = "geo:" + q.toLowerCase();
    const hit = this.cacheGet(key);
    if (hit) return hit;
    if (this.pending >= 5) return { error: "busy", status: 429 };
    this.pending++;
    const run = this.chain.then(async () => {
      const again = this.cacheGet(key);
      if (again) return again;
      await sleep(Math.max(0, this.lastGeo + 1100 - Date.now()));
      this.lastGeo = Date.now();
      const u = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "tw", viewbox: TAIPEI_VIEWBOX, bounded: "1", q });
      const r = (await (await get(u, { "user-agent": NOMINATIM_UA, "accept-language": "zh-TW" })).json())[0];
      const out = r ? { lat: +r.lat, lng: +r.lon } : { lat: null };
      this.cachePut(key, out, 7 * 864e5);
      return out;
    });
    this.chain = run.catch(() => {});
    try { return await run; } catch { return { error: "upstream_error", status: 502 }; } finally { this.pending--; }
  }

  async news() {
    const hit = this.cacheGet("news");
    if (hit) return hit;
    const [g, p] = await Promise.allSettled([googleNews(), pttNews()]);
    if (g.status === "rejected" && p.status === "rejected") return { error: "upstream_error", status: 502 };
    const out = { items: [...(g.value || []), ...(p.value || [])] };
    this.cachePut("news", out, g.status === p.status ? 10 * 60e3 : 60e3); // one source down: retry sooner than 10 min
    return out;
  }
}
