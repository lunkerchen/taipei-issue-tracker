// Local dev only: lets `wrangler dev` run AI classification through Codex CLI instead of the Claude API.
// Run: node scripts/codex-proxy.mjs   then put AI_PROXY_URL=http://127.0.0.1:8799 in worker/.dev.vars
// POST { prompt } -> { text } (Codex's last message). Listens on 127.0.0.1 only.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = +(process.env.PORT || 8799), MODEL = process.env.CODEX_MODEL || "gpt-6-luna", TIMEOUT = 90_000;

function codex(prompt) {
  const dir = mkdtempSync(join(tmpdir(), "codex-proxy-")), out = join(dir, "last.txt");
  return new Promise((resolve, reject) => {
    const p = spawn("codex", ["exec", "-m", MODEL, "-c", "model_reasoning_effort=low", "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "-o", out, "-"],
      { cwd: dir, stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    const kill = setTimeout(() => p.kill("SIGKILL"), TIMEOUT);
    p.stderr.on("data", d => err = (err + d).slice(-2000));
    p.on("error", reject);
    p.on("close", code => {
      clearTimeout(kill);
      try { code === 0 ? resolve(readFileSync(out, "utf8")) : reject(new Error(`codex exit ${code}: ${err}`)); }
      catch (e) { reject(e); } finally { rmSync(dir, { recursive: true, force: true }); }
    });
    p.stdin.end(prompt);
  });
}

createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  let body = "";
  for await (const c of req) { body += c; if (body.length > 64_000) { res.writeHead(413).end(); return; } }
  try {
    const { prompt } = JSON.parse(body), t = Date.now();
    const text = await codex(String(prompt));
    console.log(`ok ${Date.now() - t}ms`);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text }));
  } catch (e) {
    console.error(e.message);
    res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: "codex_failed" }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`codex proxy on http://127.0.0.1:${PORT} (model ${MODEL})`));
