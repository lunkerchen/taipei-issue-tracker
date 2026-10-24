// The one shared database: a SQLite-backed Durable Object that stores every document, fans writes out over hibernating
// WebSockets, and also owns the geocode/news caches so the 1 req/s Nominatim throttle is global.
// ponytail: a single instance serves every visitor; fine for a demo room, shard by collection before thousands of live sockets.
import { DurableObject } from "cloudflare:workers";
import seed from "../data.json";

const DOC_MAX = 32 * 1024, ITEMS_MAX = 20;
const TAIPEI_VIEWBOX = "121.45,25.22,121.67,24.95"; // left,top,right,bottom
const NOMINATIM_UA = "taipei-issue-tracker (labanchen@gmail.com)";
// Bing, not Google News: Google answers Cloudflare's egress IPs with a 503 "Sorry" bot page.
const BING_NEWS = "https://www.bing.com/news/search?q=" + encodeURIComponent("臺北") + "&format=rss&setlang=zh-TW&cc=TW";
const PTT = "https://www.ptt.cc/bbs/Taipei/index.html";
// Threads has no open search: a hand-picked list of 台北 posts (picked 2026-10-24, read only). Edit by hand to refresh.
const THREADS = [
  { title: "台北市的自來水真的不能直接燒水喝嗎", url: "https://www.threads.com/@rouninnmew__/post/De19teMmqwD", source: "Threads" },
  { title: "桃園台北通勤，下雨天遲到被老闆問：你怎麼不搭機捷？", url: "https://www.threads.com/@vos_non_scitis/post/Dexyji9n5ay", source: "Threads" },
  { title: "信義區深夜遇陌生男子搭訕、尾隨，提醒大家注意安全", url: "https://www.threads.com/@ariellhsu_/post/DesOwlGEv3X", source: "Threads" }
];
// Not news: buy/sell/giveaway posts, surveys and board notices
const PTT_SKIP = /^\[(?:交易|贈送|徵求|販售|出售|收購|二手|問卷|公告|徵人|廣告|租屋|分租)\]/;
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
    this.sql = ctx.storage.sql;
    this.pending = 0; this.chain = Promise.resolve(); this.lastGeo = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY)");
      // Reporter name/phone: kept out of docs, so snapshot() and the socket never send them; only the admin route reads them
      this.sql.exec("CREATE TABLE IF NOT EXISTS contacts (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS counter (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
      this.seq = this.sql.exec("SELECT v FROM counter WHERE k = 'seq'").toArray()[0]?.v || 0;
      // Seed once; the meta row stops an emptied database from reseeding itself
      if (!this.sql.exec("SELECT 1 FROM meta WHERE k = 'seeded'").toArray().length) {
        for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) this.sql.exec("INSERT OR REPLACE INTO docs VALUES (?, ?)", `${c}/${id}`, JSON.stringify(d));
        this.sql.exec("INSERT INTO meta VALUES ('seeded')");
      }
    });
  }

  // seq orders writes so clients can drop stale data; the snapshot carries the seq it reflects
  snapshot() {
    const out = { _seq: this.seq };
    for (const { path, data } of this.sql.exec("SELECT path, data FROM docs")) { const [c, id] = path.split("/"); (out[c] ||= {})[id] = JSON.parse(data); }
    return out;
  }

  contactPut(k, v) { this.sql.exec("INSERT OR REPLACE INTO contacts VALUES (?, ?)", k, JSON.stringify(v)); return { ok: true }; }
  contactGet(k) { const r = this.sql.exec("SELECT v FROM contacts WHERE k = ?", k).toArray()[0]; return { contact: r ? JSON.parse(r.v) : null }; }

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
    this.seq++; this.sql.exec("INSERT OR REPLACE INTO counter VALUES ('seq', ?)", this.seq);
    const msg = JSON.stringify({ path, data: doc, seq: this.seq });
    for (const ws of this.ctx.getWebSockets()) try { ws.send(msg); } catch {}
    return { status: 200, data: doc, seq: this.seq };
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
