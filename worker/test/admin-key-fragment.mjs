// Run against a local Worker: BASE=http://localhost:8788 PLAYWRIGHT_MODULE=<playwright> node worker/test/admin-key-fragment.mjs
// The admin key goes in the URL fragment (#admin=<key>), which the browser never sends, so no request URL (and no Workers log) holds it.
// A key in ?admin= is ignored: that tab is the demo admin. Reads ADMIN_TOKEN from worker/.dev.vars.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN || /^ADMIN_TOKEN=(.*)$/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))[1];
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {});

const open = async path => {
  const page = await (await browser.newContext()).newPage(), urls = [];
  page.on("request", r => urls.push(r.url()));
  const db = page.waitForRequest(r => new URL(r.url()).pathname === "/api/db");
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  return { page, urls, admin: (await db).headers()["x-admin"] };
};

try {
  const key = await open("/#admin=" + encodeURIComponent(token));
  assert.equal(key.admin, token, "#admin=<key> sends the key in x-admin");
  await key.page.waitForLoadState("networkidle").catch(() => {});
  assert.ok(!key.urls.some(u => u.includes(token)), "no request URL holds the key");
  assert.ok(!key.page.url().includes(token), "the address bar drops the key");
  assert.equal(await key.page.evaluate(() => sessionStorage.getItem("admin")), token, "the tab keeps the key in sessionStorage");

  const query = await open("/?admin=" + encodeURIComponent(token));
  assert.equal(query.admin, "1", "a key in ?admin= is ignored (demo admin)");
  assert.ok(!query.page.url().includes(token), "the address bar drops ?admin=");
  console.log("OK: #admin=<key> keeps the key out of request URLs; ?admin=<key> is only the demo admin");
} finally { await browser.close(); }
