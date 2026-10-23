// Enrich worker/data.json demo-seed items with 1999 sub-category, address and coordinates.
// Usage: node scripts/enrich-seed.mjs
// Idempotent: items that already have numeric lat/lng are never re-geocoded; fixed mapping, no AI calls.
// Fallback offsets are deterministic (hash of item key) instead of random so that reruns are stable.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA = ROOT + "worker/data.json";
const CATS = ROOT + "data/1999-categories.json";

const UA = "taipei-issue-tracker (labanchen@gmail.com)";
const BOUNDS = { latMin: 24.95, latMax: 25.22, lngMin: 121.45, lngMax: 121.67 };
const MIN_GAP_MS = 1100;

const DISTRICT_CENTER = {
  中正區: [25.0324, 121.5199], 大同區: [25.0633, 121.513], 中山區: [25.0643, 121.533],
  松山區: [25.0497, 121.5779], 大安區: [25.0267, 121.5434], 萬華區: [25.0338, 121.4999],
  信義區: [25.0331, 121.5711], 士林區: [25.0928, 121.5253], 北投區: [25.1318, 121.5018],
  內湖區: [25.069, 121.5937], 南港區: [25.0553, 121.6071], 文山區: [24.9887, 121.5703],
};

// key -> [sub-category id, address]. Address is taken from the item's title/body.
const MAP = {
  "demo-01": ["TYPEA-AC0208", "臺北市大安區信義路四段200號"],
  "demo-02": ["TYPEA-AC0401", "臺北市松山區富錦街300巷口"],
  "demo-03": ["TYPEA-AC0512", "臺北市中正區羅斯福路四段公館捷運站"],
  "demo-04": ["TYPEA-AC0405", "臺北市內湖區大湖公園錦帶橋"],
  "demo-05": ["TYPEA-AC0103", "臺北市萬華區西寧南路"],
  "demo-06": ["TYPEA-AC0301", "臺北市士林區忠誠路二段"],
  "demo-07": ["TYPEA-AC0513", "臺北市南港區經貿二路"],
  "demo-08": ["TYPEA-AC0101", "臺北市萬華區華江橋"],
  "demo-09": ["TYPEA-AC0712", "臺北市北投區溫泉路"],
  "demo-10": ["TYPEA-AC0202", "臺北市文山區木柵路一段"],
  "demo-11": ["TYPEA-AC0601", "臺北市中山區長安東路一段"],
  "demo-12": ["TYPEA-AC0702", "臺北市大同區寧夏路"],
  "demo-15": ["TYPEA-AC0207", "臺北市中山區南京東路二段120號"],
  "demo-16": ["TYPEA-AC0401", "臺北市內湖區內湖路一段300號"],
  "demo-17": ["TYPEA-AC0114", "臺北市信義區松仁路與松高路口"],
  "demo-18": ["TYPEA-AC0302", "臺北市士林區天母東路50巷"],
  "demo-19": ["TYPEA-AC0405", "臺北市大安區大安森林公園"],
  "demo-20": ["TYPEA-AC0512", "臺北市萬華區西園路二段"],
  "demo-21": ["TYPEA-AC0202", "臺北市文山區興隆路三段"],
  "demo-22": ["TYPEA-AC0103", "臺北市南港區研究院路一段"],
  "demo-23": ["TYPEA-AC0712", "臺北市北投區石牌路二段"],
  "demo-24": ["TYPEA-AC0601", "臺北市中正區羅斯福路一段"],
  "demo-25": ["TYPEA-AC0702", "臺北市大同區迪化街一段"],
  "demo-26": ["TYPEA-AC0102", "臺北市松山區饒河街"],
  "demo-27": ["TYPEA-AC0303", "臺北市中山區民權東路三段60號"],
  "demo-28": ["TYPEA-AC0405", "臺北市信義區象山步道"],
  "demo-29": ["TYPEA-AC0203", "臺北市內湖區東湖路100巷"],
  "demo-30": ["TYPEA-AC0512", "臺北市士林區大南路"],
  "demo-31": ["TYPEA-AC0401", "臺北市文山區景美溪河濱公園"],
  "demo-32": ["TYPEA-AC0601", "臺北市萬華區環河南路二段"],
  // new demo items (n continues after the highest issue n 32 and PR n 33-36)
  "demo-37": ["TYPEA-AC0903", "臺北市文山區木新路三段"],
  "demo-38": ["TYPEA-AC0906", "臺北市松山區南京東路五段"],
  "demo-39": ["TYPEA-AC0407", "臺北市大同區保安街"],
  "demo-40": ["TYPEA-AC0506", "臺北市南港區忠孝東路七段"],
  "demo-41": ["TYPEA-AC0534", "臺北市士林區文林路"],
  "demo-42": ["TYPEA-AC0802", "臺北市萬華區康定路"],
  "demo-43": ["TYPEA-AC0809", "臺北市中山區林森北路"],
  "demo-44": ["TYPEA-AC0603", "臺北市北投區大度路三段"],
  "demo-45": ["TYPEA-AC0907", "臺北市士林區基河路"],
  "demo-46": ["TYPEA-AC0907", "臺北市信義區松高路"],
};

const NEW_ITEMS = {
  "demo-37": { n: 37, title: "木新路三段圖書館閱覽室冷氣故障", district: "文山區", dept: "1999 待分派", tags: [], createdAt: "2026-10-14T10:05:00+08:00",
    body: "木新路三段的區立圖書館閱覽室冷氣壞了一週，傍晚悶熱，學生還是擠在裡面自習。（模擬資料）", reason: "圖書館設施屬教育事務，先由 1999 待分派轉送主管單位。" },
  "demo-38": { n: 38, title: "南京東路五段運動中心泳池水溫偏低", district: "松山區", dept: "1999 待分派", tags: [], createdAt: "2026-10-15T19:30:00+08:00",
    body: "南京東路五段的運動中心泳池這幾天水溫很低，長輩下水不到十分鐘就冷得發抖。（模擬資料）", reason: "運動中心營運屬體育事務，轉送主管單位。" },
  "demo-39": { n: 39, title: "保安街古蹟旁解說牌倒塌", district: "大同區", dept: "1999 待分派", tags: [], createdAt: "2026-10-16T13:20:00+08:00",
    body: "保安街古蹟旁的導覽解說牌被撞倒，文字也褪色看不清楚，外地遊客找不到說明。（模擬資料）", reason: "古蹟解說設施屬文化事務。" },
  "demo-40": { n: 40, title: "忠孝東路七段 YouBike 站早上無車", district: "南港區", dept: "交通局", tags: [], createdAt: "2026-10-17T08:15:00+08:00",
    body: "忠孝東路七段的 YouBike 站早上上班時段完全沒有車，晚上卻停滿沒有空位可還。（模擬資料）", reason: "公共自行車調度屬交通局。" },
  "demo-41": { n: 41, title: "文林路公車尖峰班距過長", district: "士林區", dept: "交通局", tags: [], createdAt: "2026-10-18T07:40:00+08:00",
    body: "文林路尖峰時段公車要等二十分鐘才一班，而且常常客滿過站不停。（模擬資料）", reason: "公車班次與路線屬交通局。" },
  "demo-42": { n: 42, title: "康定路巷口消防通道被機車堵住", district: "萬華區", dept: "警察局", tags: ["違規停車"], createdAt: "2026-10-19T22:10:00+08:00",
    body: "康定路一處巷口的消防通道畫了紅線，卻整排停滿機車，消防車根本進不去。（模擬資料）", reason: "消防通道違停取締屬警察局。" },
  "demo-43": { n: 43, title: "林森北路巷口監視器畫面模糊", district: "中山區", dept: "警察局", tags: [], createdAt: "2026-10-20T14:25:00+08:00",
    body: "林森北路巷口的監視器晚上畫面幾乎看不清楚，前陣子有機車被偷，希望更換鏡頭。（模擬資料）", reason: "治安監視器維護屬警察局。" },
  "demo-44": { n: 44, title: "大度路三段大型廣告氣球倒塌", district: "北投區", dept: "建管處", tags: [], createdAt: "2026-10-21T11:50:00+08:00",
    body: "大度路三段店家門口的大型廣告氣球被風吹倒，橫在人行道上，行人要繞到車道。（模擬資料）", reason: "廣告物管理屬建築管理工程處。" },
  "demo-45": { n: 45, title: "基河路邊疑似遭丟棄的輪椅", district: "士林區", dept: "1999 待分派", tags: [], createdAt: "2026-10-21T17:05:00+08:00",
    body: "基河路人行道旁放著一張輪椅好幾天，沒人認領，不知道該找哪個單位處理。（模擬資料）", reason: "無法判定主管單位，先由 1999 待分派確認。" },
  "demo-46": { n: 46, title: "松高路旁廣場活動立牌留置一週", district: "信義區", dept: "1999 待分派", tags: [], createdAt: "2026-10-22T09:30:00+08:00",
    body: "松高路旁廣場上有多面活動宣傳立牌，活動結束一週仍沒撤，不知道是哪個單位主辦。（模擬資料）", reason: "主辦單位不明，先由 1999 待分派確認。" },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastReq = 0;

async function nominatim(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&countrycodes=tw&bounded=1" +
    "&viewbox=121.45,25.22,121.67,24.95&limit=1&q=" + encodeURIComponent(q);
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastReq + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const arr = await res.json();
      const hit = arr[0];
      return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
    } catch (e) {
      console.warn("  nominatim error (attempt " + (attempt + 1) + "): " + e.message);
    }
  }
  return null;
}

// Full address first; house numbers rarely resolve in OSM, so then try the road only.
function queriesFor(addr) {
  const road = addr.replace(/\d+巷?口?號?$/, "").replace(/(與.+路口|口)$/, "");
  return [...new Set([addr, road])];
}

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}
function districtPoint(key, district) {
  const c = DISTRICT_CENTER[district];
  if (!c) throw new Error("unknown district " + district + " for " + key);
  const h = hash(key);
  const off = (x) => ((x % 6001) / 6000 - 0.5) * 0.006; // within +-0.003
  return { lat: +(c[0] + off(h)).toFixed(6), lng: +(c[1] + off(Math.floor(h / 6001))).toFixed(6) };
}
const inBounds = (p) => p.lat >= BOUNDS.latMin && p.lat <= BOUNDS.latMax && p.lng >= BOUNDS.lngMin && p.lng <= BOUNDS.lngMax;
const nearDistrict = (p, d) => Math.abs(p.lat - DISTRICT_CENTER[d][0]) < 0.08 && Math.abs(p.lng - DISTRICT_CENTER[d][1]) < 0.08;

const raw = readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const cats = JSON.parse(readFileSync(CATS, "utf8"));
const subMain = {};
const mainName = {};
for (const m of cats.categories) {
  mainName[m.id] = m.name;
  for (const s of m.subs) subMain[s.id] = { main: m.id, name: s.name };
}

const items = data.reports["demo-seed"].items;
for (const [key, nu] of Object.entries(NEW_ITEMS)) {
  if (items[key]) continue;
  items[key] = {
    author: "demo-seed", body: nu.body, createdAt: nu.createdAt, dept: nu.dept, district: nu.district,
    flagged: false, n: nu.n, tags: nu.tags, title: nu.title, triage: { by: "ai", reason: nu.reason },
  };
}

// n must be unique across issues and PR numbers in triage events
const used = new Map();
for (const [k, it] of Object.entries(items)) {
  if (used.has(it.n)) throw new Error("duplicate n " + it.n + ": " + k + " / " + used.get(it.n));
  used.set(it.n, k);
}
for (const [k, t] of Object.entries(data.triage || {})) {
  for (const ev of t.events || []) {
    if (ev.type === "pr" && used.has(ev.n) && used.get(ev.n) !== "pr:" + k)
      throw new Error("PR n " + ev.n + " in triage/" + k + " collides with issue " + used.get(ev.n));
    if (ev.type === "pr") used.set(ev.n, "pr:" + k);
  }
}

const rows = [];
for (const key of Object.keys(items)) {
  const it = items[key];
  const m = MAP[key];
  if (!m) throw new Error("no mapping for " + key);
  if (!subMain[m[0]]) throw new Error("unknown sub-category " + m[0]);
  if (m[1].length > 100) throw new Error("address too long " + key);
  const hadCoords = typeof it.lat === "number" && typeof it.lng === "number";
  const out = { ...it, category: it.category || m[0], address: it.address || m[1] };
  if (!hadCoords) {
    console.log("geocode " + key + " " + out.address);
    let p = null;
    for (const q of queriesFor(out.address)) {
      p = await nominatim(q);
      if (p && inBounds(p) && nearDistrict(p, it.district)) break;
      p = null;
    }
    if (p) { out.lat = +p.lat.toFixed(6); out.lng = +p.lng.toFixed(6); out.loc = "geocode"; }
    else { Object.assign(out, districtPoint(key, it.district)); out.loc = "district"; }
  }
  if (!(typeof out.lat === "number" && typeof out.lng === "number" && inBounds(out)))
    throw new Error("coordinates out of Taipei bounds for " + key);
  items[key] = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  rows.push([key, it.n, subMain[out.category]?.name, out.loc]);
}

writeFileSync(DATA, JSON.stringify(data)); // minified, same as the source file

const counts = {};
for (const it of Object.values(items)) {
  const mid = subMain[it.category].main;
  counts[mid] = (counts[mid] || 0) + 1;
}
console.log("\nkey\tn\tsub-category\tloc");
for (const r of rows) console.log(r.join("\t"));
console.log("\ncounts per main category");
for (const id of Object.keys(mainName)) {
  console.log(id + " " + mainName[id] + ": " + (counts[id] || 0));
  if ((counts[id] || 0) < 2) throw new Error("main category " + id + " has fewer than 2 items");
}
