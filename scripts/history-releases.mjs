// Build one release per month from data/history-2026.json (1999 dispatch data has no close date, so these summarise dispatches).
// Usage: node scripts/history-releases.mjs            -> prints the release docs as JSON
//        ADMIN=<token> BASE=<url> node scripts/history-releases.mjs --write   -> writes them via /api/db
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const p = f => fileURLToPath(new URL("../data/" + f, import.meta.url));
const h = JSON.parse(readFileSync(p("history-2026.json"), "utf8"));
const cats = Object.fromEntries(JSON.parse(readFileSync(p("1999-categories.json"), "utf8")).categories.map(c => [c.id, c.name]));

const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);

const months = new Map();
for (const [day, rows] of Object.entries(h.days)) {
  const k = day.slice(0, 7);
  if (!months.has(k)) months.set(k, { total: 0, days: new Map(), cat: new Map(), item: new Map(), dist: new Map() });
  const m = months.get(k);
  m.total += rows.length;
  m.days.set(day, rows.length);
  for (const [r, i] of rows) {
    const [name, cat] = h.items[i];
    inc(m.cat, cats[cat] || "其他"); inc(m.item, name); inc(m.dist, h.roads[r][0]);
  }
}

const docs = [];
let prev = null;
for (const [k, m] of [...months].sort()) {
  const [y, mo] = k.split("-").map(Number), nDays = m.days.size;
  const [peakDay, peakN] = top(m.days, 1)[0];
  const diff = prev ? Math.round((m.total - prev) / prev * 100) : null;
  const body = [
    "## 本月摘要",
    `- 1999 共派工 ${m.total.toLocaleString()} 件，平均每天 ${Math.round(m.total / nDays)} 件${diff === null ? "" : `，較上月${diff >= 0 ? "增加" : "減少"} ${Math.abs(diff)}%`}`,
    `- 派工最多的一天：${mo}/${+peakDay.slice(8)}，${peakN} 件`,
    "## 依 1999 大類",
    ...top(m.cat, 9).map(([n, c]) => `- ${n}：${c.toLocaleString()} 件`),
    "## 前 5 名派工項目",
    ...top(m.item, 5).map(([n, c]) => `- ${n}：${c.toLocaleString()} 件`),
    "## 派工最多的行政區",
    ...top(m.dist, 5).map(([n, c]) => `- ${n}：${c.toLocaleString()} 件`),
    "資料來源：臺北市政府 1999 派工資料（data.taipei）。資料只有立案日期，沒有結案狀態，因此這裡統計的是派工件數。",
  ].join("\n");
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  docs.push({ tag: `1999-${y}.${String(mo).padStart(2, "0")}`, title: `台北市 1999 派工月報 ${y} 年 ${mo} 月：${m.total.toLocaleString()} 件`,
    body, createdAt: `${k}-${String(last).padStart(2, "0")}T23:59:00+08:00`, fixed: [] });
  prev = m.total;
}

// ponytail: one runnable check, totals must match the source file
assert.equal(docs.length, 9);
assert.equal([...months.values()].reduce((s, m) => s + m.total, 0), Object.values(h.days).reduce((s, d) => s + d.length, 0));

if (!process.argv.includes("--write")) { console.log(JSON.stringify(docs, null, 2)); process.exit(0); }
const { ADMIN, BASE } = process.env;
assert.ok(ADMIN && BASE, "ADMIN and BASE are required for --write");
for (const d of docs) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(BASE + "/api/db", { method: "POST", headers: { "content-type": "application/json", "x-admin": ADMIN },
        body: JSON.stringify({ op: "set", path: `releases/${d.tag.replace(".", "-")}`, data: d }), signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`${d.tag}: ${r.status} ${await r.text()}`);
      console.log("wrote", d.tag); break;
    } catch (e) { if (k) throw e; await new Promise(res => setTimeout(res, 1000)); }
  }
}
