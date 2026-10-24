// Serves the demo page (static assets), proxies its two AI prompts to the Claude API, and fronts the shared Hub database.
export { Hub } from "./hub.js";
const MODELS = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5" };
// ponytail: the page builds the prompt, so this is a capped proxy: prefix check, length/token caps and a per-IP rate limit bound abuse.
// Move prompt building into the Worker if the endpoint gets abused.
const PREFIXES = ["你是台北市 1999 陳情分派員", "你是台北市政府的工程師"];
const err = (status, error) => Response.json({ error }, { status });
const PATH = /^[\w:-]{1,80}\/[\w:-]{1,80}$/, BODY_MAX = 40000;
const enc = new TextEncoder();
const hub = env => env.HUB.get(env.HUB.idFromName("main"));
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sign = async (secret, id) => hex(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), enc.encode(id)));
// Constant-time compare: hash both sides to equal length first
const same = async (a, b) => crypto.subtle.timingSafeEqual(...await Promise.all([a, b].map(s => crypto.subtle.digest("SHA-256", enc.encode(s)))));
// "<id>.<sig>" -> id, or null when missing / forged
async function visitorId(env, h) {
  const m = /^([\da-f]{16})\.([\da-f]{64})$/.exec(h || "");
  return m && env.VISITOR_SECRET && await same(await sign(env.VISITOR_SECRET, m[1]), m[2]) ? m[1] : null;
}
const reply = r => r.error ? err(r.status, r.error) : Response.json(r);

async function writeDb(req, env) {
  const h = req.headers, adminHdr = h.get("x-admin");
  const admin = !!(adminHdr && env.ADMIN_TOKEN && await same(env.ADMIN_TOKEN, adminHdr));
  const id = admin ? null : await visitorId(env, h.get("x-visitor"));
  if (!admin && !id) return err(403, "forbidden");
  // Per verified visitor id (a venue shares one IP); admin is unlimited
  if (!admin && !(await env.WRITE_LIMITER.limit({ key: id })).success) return err(429, "rate_limited");
  const text = await req.text();
  let b;
  try { if (text.length > BODY_MAX) return err(413, "too_large"); b = JSON.parse(text); } catch { return err(400, "bad_json"); }
  const { op, path, data } = b || {};
  if (!["set", "update", "delete"].includes(op) || typeof path !== "string" || !PATH.test(path)) return err(400, "bad_request");
  if (!admin && path !== `reports/${id}` && path !== `votes/${id}`) return err(403, "forbidden");
  return reply(await hub(env).write(op, path, data, admin));
}

// Photos: upload by a signed visitor or the admin, read by anyone. JPEG only; the browser already resized and re-encoded it,
// and stripJpeg() drops metadata segments again so a direct API upload cannot publish EXIF/GPS either.
const PHOTO_KEY = /^(?:[\da-f]{16}|admin|demo)\/[\w-]{1,64}\.jpg$/, PHOTO_MAX = 700 * 1024;
// Read at most `max` bytes, cancelling the stream as soon as it is exceeded (no Content-Length needed)
async function readCapped(body, max) {
  const parts = [], reader = body.getReader(); let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((n += value.length) > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// Strict baseline-JPEG check that also drops metadata. Accepts what canvas.toBlob("image/jpeg") writes and nothing looser:
// SOI, then segments each introduced by exactly one 0xFF (no fill bytes), APP1–APP15 and COM removed, one SOS, then
// entropy data where 0xFF is only ever followed by 0x00 or RST0–7, ending in EOI as the last two bytes. Anything else -> null.
// Rejecting instead of repairing means no later APP segment, fill-byte trick or truncation can carry EXIF/GPS through.
const SEG_OK = new Set([0xe0, 0xdb, 0xc0, 0xc4, 0xdd, 0xee]); // APP0, DQT, SOF0 (baseline), DHT, DRI, APP14
function stripJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const keep = [b.subarray(0, 2)]; let i = 2;
  for (;;) {
    if (i + 4 > b.length || b[i] !== 0xff) return null;
    const mk = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    const end = i + 2 + len;
    if (mk === 0xda) { // start of scan: header, then entropy-coded data to EOI
      for (let j = end; j < b.length; j++) {
        if (b[j] !== 0xff) continue;
        const n = b[j + 1];
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { j++; continue; }
        if (n === 0xd9 && j + 2 === b.length) { keep.push(b.subarray(i)); break; }
        return null;
      }
      if (keep.at(-1)[1] !== 0xda) return null; // no EOI
      break;
    }
    const meta = (mk >= 0xe1 && mk <= 0xef && mk !== 0xee) || mk === 0xfe;
    if (!meta && !SEG_OK.has(mk)) return null;
    if (!meta) keep.push(b.subarray(i, end));
    i = end;
  }
  const out = new Uint8Array(keep.reduce((s, p) => s + p.length, 0)); let o = 0;
  for (const p of keep) { out.set(p, o); o += p.length; }
  return out;
}
async function photo(req, env, key) {
  if (req.method === "GET" || req.method === "HEAD") {
    if (!PHOTO_KEY.test(key)) return err(404, "not_found");
    const o = await env.PHOTOS.get(key);
    if (!o) return err(404, "not_found");
    return new Response(req.method === "HEAD" ? null : o.body, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'", etag: o.httpEtag } });
  }
  if (req.method !== "POST" || key) return err(405, "method_not_allowed");
  const h = req.headers, adminHdr = h.get("x-admin");
  const admin = !!(adminHdr && env.ADMIN_TOKEN && await same(env.ADMIN_TOKEN, adminHdr));
  const id = admin ? "admin" : await visitorId(env, h.get("x-visitor"));
  if (!id) return err(403, "forbidden");
  if (!admin && !(await env.PHOTO_LIMITER.limit({ key: id })).success) return err(429, "rate_limited");
  if (+(h.get("content-length") || 0) > PHOTO_MAX || !req.body) return err(413, "too_large");
  const raw = await readCapped(req.body, PHOTO_MAX);
  if (!raw) return err(413, "too_large");
  const b = stripJpeg(raw); // trust the bytes, not the declared type
  if (!b) return err(415, "unsupported_type");
  const k = `${id}/${crypto.randomUUID()}.jpg`;
  await env.PHOTOS.put(k, b, { httpMetadata: { contentType: "image/jpeg" } });
  return Response.json({ key: k });
}

async function claude(env, model, prompt) {
  for (let k = 0; ; k++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(45000),
    });
    // Retry once on overload / rate limit / server error
    if ((r.status === 429 || r.status >= 500) && k === 0) { await new Promise(res => setTimeout(res, 1000)); continue; }
    if (!r.ok) throw new Error("upstream " + r.status);
    const text = (await r.json()).content?.find(c => c.type === "text")?.text || "";
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  }
}

export default {
  async fetch(req, env) {
    const { pathname, searchParams } = new URL(req.url);
    if (pathname === "/api/health") return Response.json({ ai: !!env.ANTHROPIC_API_KEY });
    if (pathname === "/api/db") {
      if (req.method === "GET") return Response.json(await hub(env).snapshot(), { headers: { "cache-control": "no-store" } });
      return req.method === "POST" ? writeDb(req, env) : err(405, "method_not_allowed");
    }
    if (pathname === "/api/ws") return hub(env).fetch(req);
    if (pathname === "/api/visitor") {
      if (req.method !== "POST") return err(405, "method_not_allowed");
      if (!env.VISITOR_SECRET) return err(503, "no_secret");
      if (!(await env.VISITOR_LIMITER.limit({ key: req.headers.get("cf-connecting-ip") || "unknown" })).success) return err(429, "rate_limited");
      const id = hex(crypto.getRandomValues(new Uint8Array(8)));
      return Response.json({ id: `${id}.${await sign(env.VISITOR_SECRET, id)}` });
    }
    if (pathname === "/api/geocode") {
      const lat = +searchParams.get("lat"), lng = +searchParams.get("lng");
      // Reverse lookup only inside the Taipei box, so the cache cannot be filled with arbitrary points
      if (searchParams.has("lat")) return lat >= 24.95 && lat <= 25.22 && lng >= 121.45 && lng <= 121.67 ? reply(await hub(env).reverse(lat, lng)) : err(400, "bad_request");
      const q = (searchParams.get("q") || "").trim();
      if (!q || q.length > 100) return err(400, "bad_request");
      return reply(await hub(env).geocode(q));
    }
    if (pathname === "/api/news") return reply(await hub(env).news());
    if (pathname === "/api/photo" || pathname.startsWith("/api/photo/")) return photo(req, env, pathname.slice(11));
    if (pathname !== "/api/sample") return err(404, "not_found");
    if (req.method !== "POST") return err(405, "method_not_allowed");
    if (!env.ANTHROPIC_API_KEY) return err(503, "no_key");
    const { success } = await env.LIMITER.limit({ key: req.headers.get("cf-connecting-ip") || "unknown" });
    if (!success) return err(429, "rate_limited");
    let body;
    try { body = await req.json(); } catch { return err(400, "bad_json"); }
    const { prompt, tier } = body || {};
    if (typeof prompt !== "string" || prompt.length > 16000 || !PREFIXES.some(p => prompt.startsWith(p)) || !MODELS[tier]) return err(400, "bad_request");
    try { return Response.json(await claude(env, MODELS[tier], prompt)); }
    catch (e) { return err(502, "upstream_error"); }
  },
};
