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
      const q = (searchParams.get("q") || "").trim();
      if (!q || q.length > 100) return err(400, "bad_request");
      return reply(await hub(env).geocode(q));
    }
    if (pathname === "/api/news") return reply(await hub(env).news());
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
