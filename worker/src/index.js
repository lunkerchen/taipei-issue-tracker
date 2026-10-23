// Serves the demo page (static assets) and proxies its two AI prompts to the Claude API.
const MODELS = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5" };
// ponytail: the page builds the prompt, so this is a capped proxy: prefix check, length/token caps and a per-IP rate limit bound abuse.
// Move prompt building into the Worker if the endpoint gets abused.
const PREFIXES = ["你是台北市 1999 陳情分派員", "你是台北市政府的工程師"];
const err = (status, error) => Response.json({ error }, { status });

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
    const { pathname } = new URL(req.url);
    if (pathname === "/api/health") return Response.json({ ai: !!env.ANTHROPIC_API_KEY });
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
