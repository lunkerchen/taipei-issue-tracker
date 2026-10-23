// Builds public/index.html: the artifact page plus a window.claude stand-in.
// Data comes from data.json (demo snapshot); writes stay in this tab's memory, so a reload resets everything.
// AI calls go to the Worker's /api/sample. ?admin turns on the bureau controls (merge, draft release) for the presenter.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const page = readFileSync(here("../taipei-issues.html"), "utf8");
const data = readFileSync(here("data.json"), "utf8").replace(/</g, "\\u003c"); // keep "</script>" in data from closing the tag

const shim = `<script>
(() => {
const DATA = ${data}, subs = [];
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const docSnap = (id, d) => ({ id, exists: d !== undefined, data: () => clone(d) });
const colSnap = c => ({ docs: Object.entries(DATA[c] || {}).map(([id, d]) => docSnap(id, d)), metadata: { fromCache: false } });
const fire = () => setTimeout(() => subs.forEach(s => s()));
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" ? { ...o[k], ...v } : v; return o; };
const ref = (c, id) => ({
  get: async () => docSnap(id, (DATA[c] || {})[id]),
  set: async d => { (DATA[c] ||= {})[id] = clone(d); fire(); },
  update: async d => { (DATA[c] ||= {})[id] = merge(DATA[c][id] || {}, clone(d)); fire(); },
  delete: async () => { if (DATA[c]) delete DATA[c][id]; fire(); },
  acquire: async () => ({ acquired: true }),
  onSnapshot(cb) { const s = () => cb(docSnap(id, (DATA[c] || {})[id])); subs.push(s); setTimeout(s); },
});
const db = {
  doc: p => { const [c, id] = p.split("/"); return ref(c, id); },
  collection: c => ({ doc: id => ref(c, id), get: async () => colSnap(c), onSnapshot(cb) { const s = () => cb(colSnap(c)); subs.push(s); setTimeout(s); } }),
};
const admin = new URLSearchParams(location.search).has("admin");
const user = { id: async () => "visitor", canEdit: async () => admin };
const sample = { async json(prompt, { modelTier, signal } = {}) {
  const r = await fetch("/api/sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, tier: modelTier || "default" }), signal });
  if (r.ok) return r.json();
  const e = new Error("sample " + r.status); if (r.status === 502) e.code = "upstream_error"; throw e;
} };
const ai = fetch("/api/health", { signal: AbortSignal.timeout(5000) }).then(r => r.json()).then(j => j.ai).catch(() => false);
window.claude = { use: async n => n === "sample" ? ((await ai) ? sample : null) : ({ db, user })[n] ?? null };
})();
</script>`;

mkdirSync(here("public"), { recursive: true });
writeFileSync(here("public/index.html"), `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>台北市 Issue Tracker</title></head><body style="margin:0">
<div style="font:13px system-ui;padding:6px 12px;background:#fff3cd;color:#664d03">展示版：資料為模擬資料，你的操作只存在這個分頁，重新整理就會還原。</div>
${shim}${page}</body></html>`);
console.log("built public/index.html");
