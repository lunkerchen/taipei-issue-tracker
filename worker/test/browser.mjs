// Runs each Playwright test against its own fresh `wrangler dev` (empty state, fresh rate limits).
// Run: node worker/test/browser.mjs [--shard=1/4] [test file names...]
// No names: every test in this folder that uses Playwright. Set PLAYWRIGHT_MODULE and CHROME_EXECUTABLE_PATH as for one test.
import { spawn } from "node:child_process";
import { mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const PORT = +(process.env.BROWSER_TEST_PORT || 8877), URL_ = `http://127.0.0.1:${PORT}`;
const WRANGLER = ["npx", "--yes", "wrangler@4.151.3"];
const flags = process.argv.slice(2).filter(a => a.startsWith("--")), named = process.argv.slice(2).filter(a => !a.startsWith("--"));
const shardMatch = flags.length === 1 && flags[0].match(/^--shard=(\d+)\/(\d+)$/);
if (flags.length && !shardMatch) throw new Error(`unknown flags: ${flags.join(" ")}; use --shard=<n>/<total>`);
const [shard, shards] = shardMatch ? [+shardMatch[1], +shardMatch[2]] : [1, 1];
if (!(Number.isSafeInteger(shard) && Number.isSafeInteger(shards) && shard >= 1 && shard <= shards)) throw new Error(`bad --shard: ${flags[0]}`);
// Left out of the default run until rewritten. Name a file to run it anyway.
const SKIP = { "map-long-press.mjs": "its history section still targets the timeline canvas, which f16dc1e replaced with pins" };
const files = (named.length ? named : readdirSync(here).filter(f => /\.[cm]?js$/.test(f) && f !== "browser.mjs" && !SKIP[f] && readFileSync(join(here, f), "utf8").includes("playwright")).sort())
  .filter((_, i) => i % shards === shard - 1);
if (!named.length) for (const [f, why] of Object.entries(SKIP)) console.log(`SKIP ${f}: ${why}`);
if (!files.length) throw new Error("no tests to run");

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Any HTTP answer means something listens on the port; only a refused connection means it is free
const listening = async () => { try { await fetch(URL_, { redirect: "manual", signal: AbortSignal.timeout(2000) }); return true; } catch (e) { return e.cause?.code !== "ECONNREFUSED"; } };
const ready = async () => { try { return (await fetch(URL_ + "/api/db", { redirect: "manual", signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
const running = child => child.exitCode === null && child.signalCode === null;
const exited = (child, ms) => new Promise(r => { if (!running(child)) return r(true); const t = setTimeout(() => r(false), ms); child.once("exit", () => { clearTimeout(t); r(true); }); });
// Each child leads its own process group (detached), so this also stops workerd and Chromium, even after the leader exits
const stop = async child => {
  const kill = signal => { try { process.kill(-child.pid, signal); } catch {} }; // ESRCH: the group is already gone
  kill("SIGTERM");
  await exited(child, 10_000);
  kill("SIGKILL");
  await exited(child, 10_000);
};
// Ctrl-C reaches only this runner, not the detached groups: stop them and remove the temporary state here
let current = [], currentState = null;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  for (const child of current) try { process.kill(-child.pid, "SIGKILL"); } catch {}
  if (currentState) rmSync(currentState, { recursive: true, force: true });
  process.exit(130);
});
const portFree = async () => { for (let i = 0; i < 50; i++) { if (!await listening()) return; await sleep(200); } throw new Error(`port ${PORT} is still in use; set BROWSER_TEST_PORT`); };

const failed = [];
for (const file of files) {
  await portFree();
  const state = mkdtempSync(join(tmpdir(), "taipei-ci-")), log = join(state, "wrangler.log"), out = openSync(log, "w");
  const worker = spawn(WRANGLER[0], [...WRANGLER.slice(1), "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--var", "VISITOR_SECRET:ci", "--persist-to", join(state, "data")],
    { cwd: join(here, ".."), detached: true, stdio: ["ignore", out, out], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  current = [worker]; currentState = state;
  let ok = false, started = Date.now();
  // Ready only when our own Worker says it listens on this URL and still runs, so another server on the port cannot pass
  const ours = () => running(worker) && stripVTControlCharacters(readFileSync(log, "utf8")).includes(`Ready on ${URL_}`);
  for (let i = 0; i < 90 && running(worker) && !(ok = ours() && await ready()); i++) await sleep(1000);
  ok &&= running(worker);
  if (ok) {
    // Each test reads BASE or its own *_BASE name; give all of them this Worker
    const env = { ...process.env, BASE: URL_ };
    for (const [, name] of readFileSync(join(here, file), "utf8").matchAll(/process\.env\.([A-Z_]*BASE)\b/g)) env[name] = URL_;
    const test = spawn("node", [join(here, file)], { env, stdio: "inherit", detached: true });
    current.push(test);
    ok = await exited(test, 300_000) && test.exitCode === 0;
    await stop(test);
  }
  await stop(worker);
  console.log(`${ok ? "PASS" : "FAIL"} ${file} (${Math.round((Date.now() - started) / 1000)} s)`);
  if (!ok) { failed.push(file); console.log(readFileSync(log, "utf8").split("\n").slice(-30).join("\n")); }
  rmSync(state, { recursive: true, force: true });
  current = []; currentState = null;
}
console.log(`${files.length - failed.length}/${files.length} passed${failed.length ? "; failed: " + failed.join(", ") : ""}`);
process.exit(failed.length ? 1 : 0);
