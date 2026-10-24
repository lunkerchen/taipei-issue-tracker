import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8788";
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport:{ width:390, height:844 } });
const page = await context.newPage();

try {
  await page.goto(`${base}/#issues`, { waitUntil:"domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("tit-visitor") && !document.querySelector("#navReport").hidden);

  await page.evaluate(() => {
    window.__live = [];
    window.__statusInserts = [];
    const record = (kind, el) => { if (el?.nodeType === 1) window.__live.push({ kind, role:el.getAttribute("role") || "", text:el.textContent }); };
    new MutationObserver(records => records.forEach(m => {
      if (m.type === "childList") {
        for (const n of m.addedNodes) {
          record("insert", n);
          if (n.nodeType === 1 && n.getAttribute("role") === "status") window.__statusInserts.push(n);
        }
        record("text", m.target);
      } else if (m.type === "characterData") {
        record("text", m.target.parentElement);
      }
    })).observe(document.body, { subtree:true, childList:true, characterData:true });
  });

  await context.setOffline(true);
  // The banner text is unique; a hidden data note also mentions 連線中斷.
  let bannerVisible = false;
  for (let i = 0; i < 24 && !bannerVisible; i++) {
    await page.waitForTimeout(500);
    bannerVisible = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="status"]')].find(n => n.textContent.includes("重新連線中"));
      return !!el && !el.hidden;
    });
  }
  assert.ok(bannerVisible, "the offline banner becomes visible");

  const inserted = await page.evaluate(() => {
    const events = window.__live;
    const first = events.find(e => e.kind === "insert" && e.role === "status");
    const banner = [...document.querySelectorAll('[role="status"]')].find(el => el.textContent.includes("重新連線中"));
    return { first, bannerIsInserted: !!banner && window.__statusInserts.includes(banner), events };
  });
  assert.ok(inserted.first, "the offline banner is inserted as a status region");
  assert.equal(inserted.first.text, "", "the status region exists before its text");
  assert.ok(inserted.bannerIsInserted, "the visible banner is the status node inserted with empty text");
  assert.ok(inserted.events.some(e => e.kind === "text" && e.role === "status" && e.text.includes("重新連線中")),
    "the banner text is added inside the existing live region");

  await context.setOffline(false);
  let bannerHidden = false;
  for (let i = 0; i < 10 && !bannerHidden; i++) {
    await page.waitForTimeout(500);
    bannerHidden = await page.evaluate(() => {
      const banner = [...document.querySelectorAll('[role="status"]')].find(el => el.textContent.includes("重新連線中"));
      return !banner;
    });
  }
  assert.ok(bannerHidden, "reconnecting hides the banner and clears its text");
  console.log("offline-live-region: ok");
} finally {
  await browser.close();
}
