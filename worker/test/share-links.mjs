import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

const BASE = (process.env.BASE || "http://127.0.0.1:8789").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "share-links-local-admin";
const modulePath = process.env.PLAYWRIGHT_MODULE || "playwright";
const require = createRequire(import.meta.url);
const { chromium } = require(modulePath);
const artifactDir = process.env.ARTIFACT_DIR;
const runId = Date.now().toString(36);
// Real reports use a signed 16-hex visitor id as owner; fixtures must match so the public view accepts them.
const docId = Array.from({ length: 16 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const ids = { open: `${docId}:open`, fixed: `${docId}:fixed`, hidden: `${docId}:hidden`, hideWhileCopy: `${docId}:hide-while-copy` };
const titles = {
  open: `Share link open ${runId}`,
  fixed: `Share link fixed ${runId}`,
  hidden: `Share link hidden ${runId}`,
  hideWhileCopy: `Share link hide while copy ${runId}`
};
const genericUnavailable = "找不到這個公開案件；連結可能已失效或案件目前無法公開。你可以從下方列表重新搜尋。";
const headers = { "content-type": "application/json", "x-admin": ADMIN_TOKEN };

async function dbWrite(op, path, data) {
  const response = await fetch(`${BASE}/api/db`, {
    method: "POST",
    headers,
    body: JSON.stringify({ op, path, ...(data === undefined ? {} : { data }) }),
    signal: AbortSignal.timeout(10000)
  });
  assert.equal(response.status, 200, `${op} ${path} should succeed`);
  return response.json();
}

async function assertExpanded(page, id, title) {
  await page.waitForFunction(({ wantedId, wantedTitle }) => {
    const button = [...document.querySelectorAll("#list [data-open]")].find(el => el.dataset.open === wantedId);
    return button?.textContent.trim() === wantedTitle && button.getAttribute("aria-expanded") === "true";
  }, { wantedId: id, wantedTitle: title });
}

async function openPage(context, hash) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/${hash}`, { waitUntil: "domcontentloaded" });
  return page;
}

const now = new Date().toISOString();
const items = Object.fromEntries(Object.entries(ids).map(([kind, id]) => [id.slice(docId.length + 1), {
  title: titles[kind], body: `Share link fixture ${kind} ${runId}`, createdAt: now,
  author: docId, dept: "交通局", district: "信義區"
}]));

await dbWrite("set", `reports/${docId}`, { items });
await dbWrite("set", `triage/${ids.open}`, { status: "open" });
await dbWrite("set", `triage/${ids.fixed}`, { status: "fixed" });
await dbWrite("set", `triage/${ids.hidden}`, { status: "open", hidden: true });
await dbWrite("set", `triage/${ids.hideWhileCopy}`, { status: "open" });

let browser;
const contexts = [];
const pageErrors = [];
const context = async options => {
  const ctx = await browser.newContext(options);
  contexts.push(ctx);
  return ctx;
};
const delayedClipboardContext = async () => {
  const ctx = await context();
  await ctx.addInitScript(() => {
    let rejectWrite;
    const pendingWrite = new Promise((_, reject) => { rejectWrite = reject; });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => pendingWrite }
    });
    window.rejectClipboardWrite = () => rejectWrite(new Error("clipboard_denied"));
  });
  return ctx;
};
const rejectClipboard = page => page.evaluate(async () => {
  window.rejectClipboardWrite();
  await new Promise(resolve => setTimeout(resolve, 0));
});

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox"]
  });

  // An admin tab starts with both an admin token and unrelated private query data.
  const senderContext = await context();
  await senderContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const sender = await senderContext.newPage();
  await sender.setViewportSize({ width: 390, height: 844 });
  sender.on("pageerror", error => pageErrors.push(error.message));
  await sender.goto(`${BASE}/?admin=${encodeURIComponent(ADMIN_TOKEN)}&private=do-not-share#issue/${encodeURIComponent(ids.open)}`, { waitUntil: "domcontentloaded" });
  await assertExpanded(sender, ids.open, titles.open);
  await sender.locator("#list [data-share]").click();
  await sender.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已複製案件連結"));
  const copied = await sender.evaluate(() => navigator.clipboard.readText());
  const copiedUrl = new URL(copied);
  assert.equal(copiedUrl.search, "", "copied public links omit every query parameter");
  assert.equal(copiedUrl.hash, `#issue/${encodeURIComponent(ids.open)}`, "copied link uses the stable issue ID");
  assert.ok(!copied.includes(ADMIN_TOKEN), "copied link does not contain the admin token");
  assert.ok(!copied.includes("do-not-share"), "copied link does not contain private query data");

  // A fresh browser context can open the copied public link and keep it after refresh.
  const receiverContext = await context();
  const receiver = await openPage(receiverContext, copiedUrl.hash);
  receiver.on("pageerror", error => pageErrors.push(error.message));
  await assertExpanded(receiver, ids.open, titles.open);
  await receiver.reload({ waitUntil: "domcontentloaded" });
  await assertExpanded(receiver, ids.open, titles.open);

  // Fixed cases open on the repaired tab. Missing and hidden cases have the same public message.
  await receiver.goto(`${BASE}/#issue/${encodeURIComponent(ids.fixed)}`, { waitUntil: "domcontentloaded" });
  await assertExpanded(receiver, ids.fixed, titles.fixed);
  assert.equal(await receiver.locator("#tabClosed").getAttribute("aria-pressed"), "true", "fixed case opens the repaired tab");

  const unavailable = [];
  for (const id of [`${docId}:missing`, ids.hidden]) {
    await receiver.goto(`${BASE}/#issue/${encodeURIComponent(id)}`, { waitUntil: "domcontentloaded" });
    await receiver.locator("#shareNotice").waitFor({ state: "visible" });
    const message = await receiver.locator("#shareNotice").textContent();
    unavailable.push(message);
    assert.equal(await receiver.locator(`#list [data-open="${ids.hidden}"]`).count(), 0, "hidden case content is not rendered to a public viewer");
    assert.ok(!(await receiver.locator("body").innerText()).includes(titles.hidden), "hidden case title is not leaked");
    assert.equal(await receiver.locator('#nav [data-view="issues"]').getAttribute("aria-current"), "page", "the viewer can return to the issue list");
  }
  assert.deepEqual(unavailable, [genericUnavailable, genericUnavailable], "missing and hidden cases use one non-disclosing recovery message");

  // A delayed clipboard rejection after a sort re-render must show the current manual link.
  const delayedContext = await delayedClipboardContext();
  const delayed = await openPage(delayedContext, `#issue/${encodeURIComponent(ids.open)}`);
  delayed.on("pageerror", error => pageErrors.push(error.message));
  await assertExpanded(delayed, ids.open, titles.open);
  await delayed.locator("#list [data-share]").click();
  await delayed.locator("#sort").selectOption("new");
  await rejectClipboard(delayed);
  const manual = delayed.locator("#list [data-share-url]");
  await manual.waitFor({ state: "visible" });
  assert.equal(await manual.inputValue(), `${BASE}/#issue/${encodeURIComponent(ids.open)}`);
  assert.equal(await manual.getAttribute("readonly"), "");
  assert.equal(await manual.evaluate(el => el === document.activeElement && el.selectionStart === 0 && el.selectionEnd === el.value.length), true, "the delayed fallback is focused and selected");
  assert.match(await delayed.locator("[data-share-status]").textContent(), /無法自動複製/);

  // A pending rejection must not restore a link after the case closes or its page is left.
  const collapsedContext = await delayedClipboardContext();
  const collapsed = await openPage(collapsedContext, `#issue/${encodeURIComponent(ids.open)}`);
  await assertExpanded(collapsed, ids.open, titles.open);
  await collapsed.locator("#list [data-share]").click();
  await collapsed.locator(`[data-open="${ids.open}"]`).click();
  await collapsed.locator(`[data-open="${ids.open}"]`).waitFor({ state: "visible" });
  await rejectClipboard(collapsed);
  assert.equal(await collapsed.locator("#list [data-share-url]").count(), 0, "a closed case has no manual fallback");

  const awayContext = await delayedClipboardContext();
  const away = await openPage(awayContext, `#issue/${encodeURIComponent(ids.open)}`);
  await assertExpanded(away, ids.open, titles.open);
  await away.locator("#list [data-share]").click();
  await away.locator('#nav [data-view="map"]').click();
  await away.locator('#nav [data-view="map"]').waitFor({ state: "visible" });
  await rejectClipboard(away);
  assert.equal(await away.locator("#list [data-share-url]").evaluate(el => el.hidden && !el.value), true, "leaving the issue page does not reveal a fallback");

  // A live privacy change removes the target before rejection; the hidden case stays undisclosed.
  const hiddenRaceContext = await delayedClipboardContext();
  const hiddenRace = await openPage(hiddenRaceContext, `#issue/${encodeURIComponent(ids.hideWhileCopy)}`);
  await assertExpanded(hiddenRace, ids.hideWhileCopy, titles.hideWhileCopy);
  await hiddenRace.locator("#list [data-share]").click();
  await dbWrite("update", `triage/${ids.hideWhileCopy}`, { hidden: true });
  await hiddenRace.waitForFunction(id => ![...document.querySelectorAll("#list [data-open]")].some(el => el.dataset.open === id), ids.hideWhileCopy);
  await rejectClipboard(hiddenRace);
  assert.ok(!(await hiddenRace.locator("body").innerText()).includes(titles.hideWhileCopy), "hiding a pending target does not reveal case content");
  assert.equal(await hiddenRace.locator("#list [data-share-url]").count(), 0, "a hidden case has no manual fallback");

  // Keyboard activation keeps focus on the issue button while opening the detail.
  // Back returns to the issues list; Forward reopens the case.
  const historyContext = await context();
  const historyPage = await openPage(historyContext, "#insights");
  historyPage.on("pageerror", error => pageErrors.push(error.message));
  await historyPage.locator('#nav [data-view="issues"]').click();
  await historyPage.locator(`[data-open="${ids.open}"]`).waitFor({ state: "visible" });
  const keyboardTarget = historyPage.locator(`[data-open="${ids.open}"]`);
  await keyboardTarget.focus();
  await keyboardTarget.press("Enter");
  assert.equal(new URL(historyPage.url()).hash, `#issue/${encodeURIComponent(ids.open)}`);
  assert.equal(await keyboardTarget.evaluate(el => el === document.activeElement), true, "keyboard activation restores focus to the expanded issue");
  await historyPage.goBack();
  await historyPage.waitForFunction(() => location.hash === "#issues");
  await historyPage.goForward();
  await assertExpanded(historyPage, ids.open, titles.open);

  // A share route reached while filters are active clears them, including on Back/Forward traversal.
  await historyPage.locator('#nav [data-view="insights"]').click();
  await historyPage.locator('#nav [data-view="issues"]').click();
  await historyPage.locator("#q").fill(`no-match-${runId}`);
  await historyPage.evaluate(id => {
    window.history.pushState(null, "", `#issue/${encodeURIComponent(id)}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, ids.open);
  await assertExpanded(historyPage, ids.open, titles.open);
  assert.equal(await historyPage.locator("#q").inputValue(), "", "share route clears the search filter");
  await historyPage.goBack();
  await historyPage.waitForFunction(() => location.hash === "#issues");
  assert.equal(await historyPage.locator(`[data-open="${ids.open}"]`).getAttribute("aria-expanded"), "false", "Back closes the shared target");
  await historyPage.goForward();
  await assertExpanded(historyPage, ids.open, titles.open);

  // Unknown hashes return to the device's normal home and explain the fallback.
  await receiver.goto(`${BASE}/#unknown-share-route`, { waitUntil: "domcontentloaded" });
  await receiver.locator("#shareNotice").waitFor({ state: "visible" });
  assert.match(await receiver.locator("#shareNotice").textContent(), /無法辨識這個連結/);

  if (pageErrors.length) assert.deepEqual(pageErrors, [], "the app should not raise browser page errors");
  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    await receiver.screenshot({ path: join(artifactDir, "share-link-unknown-route.png"), fullPage: true });
    await writeFile(join(artifactDir, "share-links-results.txt"), [
      "PASS: stable ID copied without query parameters or admin token",
      "PASS: independent context and reload open the target case",
      "PASS: fixed case opens on the repaired tab",
      "PASS: missing and hidden cases share the same recovery message",
      "PASS: delayed clipboard rejection after a sort re-render shows a selected manual link",
      "PASS: collapsed, hidden, or off-page targets do not reveal a manual fallback",
      "PASS: keyboard opening preserves focus; Back and Forward restore the correct view and issue target",
      "PASS: unknown hash shows a friendly fallback",
      `Browser: ${basename(process.env.CHROME_EXECUTABLE_PATH || "playwright chromium")}`
    ].join("\n") + "\n");
  }
  console.log("OK share links: copy, independent contexts, refresh, fixed, hidden, missing, delayed clipboard fallback, collapse/privacy/page guards, filters, focus, history, unknown hash");
} finally {
  await Promise.allSettled(contexts.map(ctx => ctx.close()));
  if (browser) await browser.close();
  for (const id of Object.values(ids)) await dbWrite("delete", `triage/${id}`);
  await dbWrite("delete", `reports/${docId}`);
}
