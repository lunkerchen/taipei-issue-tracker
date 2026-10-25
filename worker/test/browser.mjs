// Runs each Playwright test against its own fresh `wrangler dev` (empty state, fresh rate limits).
// Run: node worker/test/browser.mjs [--shard=1/4] [test file names...]
// No names: every test in this folder that uses Playwright. Set PLAYWRIGHT_MODULE and CHROME_EXECUTABLE_PATH as for one test.
import { spawn } from "node:child_process";
import { mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const PORT = +(process.env.BROWSER_TEST_PORT || 8877), URL_ = `http://127.0.0.1:${PORT}`;
const WRANGLER = ["npx", "--yes", "wrangler@4.151.3"];
const shardArg = process.argv.find(a => a.startsWith("--shard="));
const [shard, shards] = shardArg ? shardArg.slice(8).split("/").map(Number) : [1, 1];
const named = process.argv.slice(2).filter(a => !a.startsWith("--"));
// Left out of the default run until rewritten. Name a file to run it anyway.
const SKIP = { "map-long-press.mjs": "its history section still targets the timeline canvas, which f16dc1e replaced with pins" };
const files = (named.length ? named : readdirSync(here).filter(f => /\.[cm]?js$/.test(f) && f !== "browser.mjs" && !SKIP[f] && readFileSync(join(here, f), "utf8").includes("playwright")).sort())
  .filter((_, i) => i % shards === shard - 1);
if (!named.length) for (const [f, why] of Object.entries(SKIP)) console.log(`SKIP ${f}: ${why}`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const up = async () => { try { return (await fetch(URL_ + "/api/db", { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
const exit = child => new Promise(r => child.exitCode !== null ? r(child.exitCode) : child.once("exit", code => r(code)));

if (await up()) throw new Error(`port ${PORT} is already in use; set BROWSER_TEST_PORT`);
const failed = [];
for (const file of files) {
  const state = mkdtempSync(join(tmpdir(), "taipei-ci-")), log = join(state, "wrangler.log"), out = openSync(log, "w");
  // detached: own process group, so one kill stops npx, wrangler and workerd together
  const worker = spawn(WRANGLER[0], [...WRANGLER.slice(1), "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--var", "VISITOR_SECRET:ci", "--persist-to", join(state, "data")],
    { cwd: join(here, ".."), detached: true, stdio: ["ignore", out, out], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  let ok = false, started = Date.now();
  for (let i = 0; i < 90 && !(ok = await up()); i++) await sleep(1000);
  if (ok) {
    // Each test reads BASE or its own *_BASE name; give all of them this Worker
    const env = { ...process.env, BASE: URL_ };
    for (const [, name] of readFileSync(join(here, file), "utf8").matchAll(/process\.env\.([A-Z_]*BASE)\b/g)) env[name] = URL_;
    const test = spawn("node", [join(here, file)], { env, stdio: "inherit" });
    const timer = setTimeout(() => test.kill("SIGKILL"), 300_000);
    ok = await exit(test) === 0;
    clearTimeout(timer);
  }
  try { process.kill(-worker.pid, "SIGTERM"); } catch {}
  await exit(worker);
  console.log(`${ok ? "PASS" : "FAIL"} ${file} (${Math.round((Date.now() - started) / 1000)} s)`);
  if (!ok) { failed.push(file); console.log(readFileSync(log, "utf8").split("\n").slice(-30).join("\n")); }
  rmSync(state, { recursive: true, force: true });
  for (let i = 0; i < 50 && await up(); i++) await sleep(200);
}
console.log(`${files.length - failed.length}/${files.length} passed${failed.length ? "; failed: " + failed.join(", ") : ""}`);
process.exit(failed.length ? 1 : 0);
