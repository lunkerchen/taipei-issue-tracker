// Attach the GPT Image demo photos to the seed cases (demo-01 … demo-57).
// Usage: node scripts/demo-photos.mjs <dir with demo-XX.png>
//   1. converts each PNG to a 1280x960 JPEG (sips), 2. uploads it to R2 as demo/demo-XX.jpg (wrangler, remote),
//   3. adds photos:["demo/demo-XX.jpg"] to worker/data.json, 4. with ADMIN and BASE set, writes the same into the live Hub.
// Re-running is safe: existing uploads are overwritten with the same bytes and photos are set, not appended.
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const dir = process.argv[2];
assert.ok(dir && existsSync(dir), "usage: node scripts/demo-photos.mjs <dir>");
const worker = fileURLToPath(new URL("../worker/", import.meta.url));
const dataPath = join(worker, "data.json");
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const items = data.reports["demo-seed"].items;
const tmp = mkdtempSync(join(tmpdir(), "demo-photos-"));

const done = [];
for (const key of Object.keys(items).sort()) {
  const png = join(dir, key + ".png");
  if (!existsSync(png)) { console.log("skip (no image)", key); continue; }
  const jpg = join(tmp, key + ".jpg");
  // Busy scenes (branches, leaves) can pass 650 KB at quality 80, so step the quality down
  for (const q of ["80", "70", "60"]) {
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", q, "-z", "960", "1280", png, "--out", jpg], { stdio: "ignore" });
    if (readFileSync(jpg).length < 650 * 1024) break;
  }
  assert.ok(readFileSync(jpg).length < 650 * 1024, key + " jpeg too large");
  execFileSync("npx", ["wrangler", "r2", "object", "put", `taipei-issue-photos/demo/${key}.jpg`, "--file", jpg, "--content-type", "image/jpeg", "--remote"],
    { cwd: worker, stdio: "ignore", timeout: 120000 });
  items[key].photos = [`demo/${key}.jpg`];
  done.push(key);
  console.log("uploaded", key);
}
writeFileSync(dataPath, JSON.stringify(data));
console.log(`${done.length} photos attached in worker/data.json`);

const { ADMIN, BASE } = process.env;
if (!ADMIN || !BASE) process.exit(0);
// Live Hub: read the current demo-seed doc, set photos on the same items, write it back (admin skips the doc size cap)
const live = (await (await fetch(BASE + "/api/db", { signal: AbortSignal.timeout(15000) })).json()).reports["demo-seed"];
for (const key of done) if (live.items[key]) live.items[key].photos = [`demo/${key}.jpg`];
for (let k = 0; ; k++) {
  try {
    const r = await fetch(BASE + "/api/db", { method: "POST", headers: { "content-type": "application/json", "x-admin": ADMIN },
      body: JSON.stringify({ op: "set", path: "reports/demo-seed", data: live }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    console.log("live Hub updated"); break;
  } catch (e) { if (k) throw e; await new Promise(res => setTimeout(res, 1000)); }
}
