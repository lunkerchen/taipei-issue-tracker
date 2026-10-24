// A hidden case must not appear in the public release notes. The public case next to it must appear.
// Run against a local Worker: BASE=http://127.0.0.1:8941 node worker/test/release-hidden.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/Users/lunker/.local/lib/node_modules/playwright");

const BASE = (process.env.BASE || "http://127.0.0.1:8941").replace(/\/$/, "");
const ADMIN = "1";
const runId = Date.now().toString(36);
const adminHeaders = { "content-type": "application/json", "x-admin": ADMIN };
const post = async (path, body, headers = { "content-type": "application/json" }) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: r.status, body: await r.json() };
};
const write = (path, data) => post("/api/db", { op: "set", path, data }, adminHeaders);
const remove = path => post("/api/db", { op: "delete", path }, adminHeaders);
const token = (await post("/api/visitor", {})).body.id, owner = token.split(".")[0];
const keys = { public: `relpub-${runId}`, hidden: `relhid-${runId}` };
const texts = { public: `PUBLIC RELEASE CASE ${runId}`, hidden: `HIDDEN RELEASE SECRET ${runId}` };
const item = (key, title) => ({ id: key, n: 1, title, body: `body of ${title}`, createdAt: new Date().toISOString(),
  dept: "環保局", district: "大安區", tags: ["噪音"], author: owner, status: "open", photos: [], notes: [] });
const contact = { name: "合成市民", phone: "0912345678", email: "citizen@example.com", realName: false };
const id = name => `${owner}:${keys[name]}`;
const fix = (name, hidden) => write(`triage/${id(name)}`, { status: "fixed", ...(hidden ? { hidden: true } : {}),
  events: [{ t: new Date().toISOString(), type: "status", to: "fixed", by: "qa" }] });
const releases = async headers => Object.values((await (await fetch(`${BASE}/api/db`, { headers })).json()).releases || {});
const before = new Set((await releases()).map(r => r.tag));
let browser;

try {
  for (const [name, key] of Object.entries(keys)) {
    const saved = await post("/api/db", { op: "create-report", path: `reports/${owner}`,
      data: { key, item: item(key, texts[name]), contact } }, { "content-type": "application/json", "x-visitor": token });
    assert.equal(saved.status, 200, `create ${name} (${saved.body.error || "ok"})`);
  }
  assert.equal((await fix("public", false)).status, 200, "fix the public case");
  assert.equal((await fix("hidden", true)).status, 200, "fix the hidden case");

  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/?admin#releases`);
  // Wait until the admin model has both cases and their triage; the issue list is not in the DOM on the releases view.
  await page.waitForFunction(runId => typeof issues !== "undefined" &&
    issues.filter(i => i.title.includes(runId) && i.status === "fixed").length === 2 &&
    issues.some(i => i.title.startsWith("HIDDEN") && i.title.includes(runId) && hiddenFor(i)),
  runId, { timeout: 15000 });
  await page.locator("#relBtn").click();
  await page.locator("#relStatus").filter({ hasText: "已發布" }).waitFor({ timeout: 20000 });

  const added = (await releases()).filter(r => !before.has(r.tag));
  assert.equal(added.length, 1, "one release was added");
  assert.ok(added[0].body.includes(texts.public), "the public case is in the release body");
  assert.ok(!added[0].body.includes(texts.hidden), "the hidden case is not in the release body");
  assert.ok(!added[0].title.includes(texts.hidden), "the hidden title is absent from the release title");

  const pub = await releases();
  assert.ok(pub.every(r => !r.body.includes(texts.hidden)), "no public release mentions the hidden case");
  console.log("hidden cases stay out of release notes");
} finally {
  try {
    for (const r of await releases(adminHeaders)) if (!before.has(r.tag) && (r.body || "").includes(runId)) await remove(`releases/${r.tag}`);
    for (const name of Object.keys(keys)) await remove(`triage/${id(name)}`);
    await remove(`reports/${owner}`);
    if (browser) await browser.close();
  } catch {}
}
