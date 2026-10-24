// The 食住行育樂醫 filter on the district page must also filter the 里 counts, the 里 list and the 里 page.
// Run against a local Worker with the seed data: BASE=http://localhost:8788 PLAYWRIGHT_MODULE=/Users/lunker/.local/lib/node_modules/playwright node worker/test/district-aspect.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = (process.env.BASE || "http://localhost:8788").replace(/\/$/, "");
const order = JSON.parse(readFileSync(new URL("../../data/districts.geojson", import.meta.url), "utf8")).features.map(f => f.properties.district);
const district = "士林區";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));

try {
  await page.goto(base + "/#map");
  await page.waitForSelector(".leaflet-districts-pane path");
  await page.locator(".leaflet-districts-pane path").nth(order.indexOf(district)).dispatchEvent("click");
  await page.waitForFunction(d => document.querySelector("#liTitle")?.textContent === d, district);
  await page.locator("#liList button").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator('#distAspects [data-asp="行"]').waitFor({ state: "visible", timeout: 20000 });

  const baseSnap = await page.evaluate(d => {
    const counts = {}, byAsp = {};
    for (const i of issues) {
      if (i.status === "fixed" || !inTaipei(i.lat, i.lng)) continue;
      const x = liAt(i.lat, i.lng);
      if (!x || x.district !== d) continue;
      counts[x.li] = (counts[x.li] || 0) + 1;
      const a = aspectOf(i) || "";
      byAsp[a] = (byAsp[a] || 0) + 1;
    }
    return { total: Object.values(counts).reduce((n, v) => n + v, 0), counts, byAsp };
  }, district);
  assert.ok(baseSnap.total >= 2, `the seed has unfinished reports in ${district}: ${baseSnap.total}`);

  const uiBase = await page.evaluate(() => ({
    sum: document.querySelector("#liSum").textContent,
    rows: [...document.querySelectorAll("#liList li")].map(li => ({ name: li.querySelector(".nm").textContent, n: +li.querySelector(".cnt").textContent }))
  }));
  assert.ok(uiBase.sum.includes(`未完成 ${baseSnap.total} 件`), `the unfiltered sum shows ${baseSnap.total}: ${uiBase.sum}`);
  assert.equal(uiBase.rows.reduce((n, r) => n + r.n, 0), baseSnap.total, "the unfiltered rows add up to the sum");

  const picked = Object.entries(baseSnap.byAsp).find(([a, n]) => a && n > 0 && n < baseSnap.total);
  assert.ok(picked, `one aspect has some but not all reports: ${JSON.stringify(baseSnap.byAsp)}`);
  const [asp, expectedTotal] = picked;
  console.log(`${district}: ${baseSnap.total} unfinished, ${asp} has ${expectedTotal}`);

  await page.locator(`#distAspects [data-asp="${asp}"]`).dispatchEvent("click");
  await page.waitForFunction(a => document.querySelector(`#distAspects [data-asp="${a}"]`)?.getAttribute("aria-pressed") === "true", asp);
  await page.waitForTimeout(100);

  const expected = await page.evaluate(([d, a]) => {
    const rows = {};
    for (const i of issues) {
      if (i.status === "fixed" || aspectOf(i) !== a || !inTaipei(i.lat, i.lng)) continue;
      const x = liAt(i.lat, i.lng);
      if (x && x.district === d) rows[x.li] = (rows[x.li] || 0) + 1;
    }
    return { rows, total: Object.values(rows).reduce((n, v) => n + v, 0) };
  }, [district, asp]);

  const ui = await page.evaluate(() => ({
    sum: document.querySelector("#liSum").textContent,
    foot: document.querySelector("#liFoot").textContent,
    rows: [...document.querySelectorAll("#liList li")].map(li => ({ name: li.querySelector(".nm").textContent, n: +li.querySelector(".cnt").textContent }))
  }));
  assert.ok(ui.sum.includes(`未完成 ${expected.total} 件`), `the filtered sum shows ${expected.total}: ${ui.sum}`);
  assert.equal(ui.rows.reduce((n, r) => n + r.n, 0), expected.total, "the filtered rows add up to the filtered sum");
  assert.deepEqual(new Set(ui.rows.map(r => r.name)), new Set(Object.keys(expected.rows)), `only villages with ${asp} reports are listed`);
  for (const r of ui.rows) assert.equal(r.n, expected.rows[r.name], `${r.name} shows its ${asp} count`);
  if (Object.keys(expected.rows).length < Object.keys(baseSnap.counts).length)
    assert.ok(ui.foot.includes("這類"), `the footer says the other villages have no ${asp} reports: ${ui.foot}`);
  const filteredSum = ui.sum;

  const firstName = ui.rows[0].name;
  await page.locator("#liList li button").first().click();
  await page.waitForFunction(() => !document.querySelector("#liDetail").hidden);
  const detail = await page.evaluate(() => ({
    name: document.querySelector("#ldName").textContent,
    ids: [...document.querySelectorAll("#ldEvents [data-go]")].map(b => b.dataset.go),
    more: document.querySelector("#ldEvents .more")?.textContent || ""
  }));
  assert.equal(detail.name, firstName);
  const expectedIds = await page.evaluate(([d, a, name]) => issues.filter(i => {
    if (aspectOf(i) !== a || !inTaipei(i.lat, i.lng)) return false;
    const x = liAt(i.lat, i.lng);
    return x && x.district === d && x.li === name;
  }).map(i => i.id), [district, asp, firstName]);
  assert.equal(detail.ids.length, Math.min(6, expectedIds.length), `the 里 page lists ${Math.min(6, expectedIds.length)} ${asp} reports`);
  for (const id of detail.ids) assert.ok(expectedIds.includes(id), `the 里 page shows only ${asp} reports: ${id}`);
  if (expectedIds.length > 6) assert.ok(detail.more.includes(`另有 ${expectedIds.length - 6} 件`), `the 里 page counts the other ${asp} reports: ${detail.more}`);

  await page.locator("#liBack").click();
  await page.waitForFunction(() => !document.querySelector("#liPanel").hidden);
  await page.locator('#distAspects [data-asp=""]').dispatchEvent("click");
  await page.waitForFunction(() => document.querySelector('#distAspects [data-asp=""]')?.getAttribute("aria-pressed") === "true");
  await page.waitForTimeout(100);
  const restored = await page.evaluate(() => ({
    sum: document.querySelector("#liSum").textContent,
    total: [...document.querySelectorAll("#liList .cnt")].reduce((n, e) => n + (+e.textContent), 0)
  }));
  assert.ok(restored.sum.includes(`未完成 ${baseSnap.total} 件`), `全部 restores the sum: ${restored.sum}`);
  assert.equal(restored.total, baseSnap.total, "全部 restores every village count");
  assert.notEqual(filteredSum, restored.sum, "the filtered sum differs from the full sum");

  assert.deepEqual(errors, [], "no page errors");
  console.log(`OK ${asp}: the district filter also updates the 里 counts, the 里 list and the 里 page`);
} finally {
  await page.close();
  await browser.close();
}
