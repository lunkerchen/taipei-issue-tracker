// Add simulated typhoon reports (#48–#57, 2026-10-23/24) and a 颱風災後復原 milestone.
// Usage: node scripts/typhoon-seed.mjs            → writes worker/data.json
//        ADMIN=… BASE=… node scripts/typhoon-seed.mjs → also writes the live Hub
// Re-running is safe: the same keys are overwritten.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const dataPath = fileURLToPath(new URL("../worker/data.json", import.meta.url));
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const MS = "typhoon-2026";
// [n, title, body, district, address, lat, lng, category, dept, tags, reason, createdAt, status, statusAt]
const rows = [
  [48, "仁愛路四段路樹倒塌壓到機車", "颱風風勢太大，仁愛路四段安全島一棵大樹連根倒下，壓到路邊兩台機車，佔掉一個車道。", "大安區", "臺北市大安區仁愛路四段", 25.0377, 121.548, "TYPEA-AC0402", "工務局公園處", [], "行道樹倒塌移除屬公園路燈工程管理處。", "2026-10-23T18:20:00+08:00", "progress", "2026-10-23T19:05:00+08:00"],
  [49, "社子島延平北路七段淹水及膝", "延平北路七段往社子島方向整段積水，水深到膝蓋，機車過不去。", "士林區", "臺北市士林區延平北路七段", 25.106, 121.497, "TYPEA-AC0203", "工務局水利處", ["排水淤積"], "路面積淹水由水利處抽水處理。", "2026-10-23T21:40:00+08:00", "progress", "2026-10-23T22:10:00+08:00"],
  [50, "成功路四段地下道積水", "成功路四段地下道積水約 30 公分，已經有車熄火卡在裡面。", "內湖區", "臺北市內湖區成功路四段", 25.083, 121.593, "TYPEA-AC0212", "工務局水利處", ["排水淤積"], "地下道積淹水屬水利處。", "2026-10-23T22:15:00+08:00", "fixed", "2026-10-24T03:30:00+08:00"],
  [51, "南京東路三段招牌被吹落半懸空", "南京東路三段一家店的大型招牌被風吹落一半，掛在騎樓上方搖晃，下面還有人走過。", "中山區", "臺北市中山區南京東路三段", 25.052, 121.543, "TYPEA-AC0603", "建管處", [], "廣告招牌安全屬建築管理工程處。", "2026-10-23T23:05:00+08:00", "open"],
  [52, "基隆路一段號誌被吹歪不亮", "基隆路一段和信義路口的紅綠燈被吹歪，有一面完全不亮，路口很亂。", "信義區", "臺北市信義區基隆路一段", 25.041, 121.56, "TYPEA-AC0511", "交通局", ["交通號誌"], "號誌設施損壞屬交通管制工程處。", "2026-10-24T00:30:00+08:00", "fixed", "2026-10-24T06:40:00+08:00"],
  [53, "木柵路四段山壁落石", "木柵路四段靠山壁那側有落石掉到慢車道，大小跟籃球差不多。", "文山區", "臺北市文山區木柵路四段", 24.989, 121.577, "TYPEA-AC0217", "工務局新工處", [], "道路邊坡落石先由新工處清除。", "2026-10-24T05:50:00+08:00", "open"],
  [54, "新生高架下側溝被落葉堵住", "新生高架下的側溝被颱風吹下來的樹葉塞滿，水排不掉一直往路面溢。", "中山區", "臺北市中山區新生北路二段", 25.056, 121.53, "TYPEA-AC0301", "工務局水利處", ["排水淤積"], "側溝清淤屬水利處。", "2026-10-24T07:10:00+08:00", "open"],
  [55, "和平東路二段路燈桿傾斜", "和平東路二段一根路燈桿被吹到傾斜，燈也不亮了，怕會倒下來。", "大安區", "臺北市大安區和平東路二段", 25.025, 121.544, "TYPEA-AC0401", "台電/路燈管理", ["路燈"], "路燈設施損壞屬路燈管理單位。", "2026-10-24T07:45:00+08:00", "open"],
  [56, "中央北路樹枝散落車道", "中央北路一段車道上散落很多斷掉的樹枝，騎車要一直閃。", "北投區", "臺北市北投區中央北路一段", 25.133, 121.5, "TYPEA-AC0213", "環保局", ["垃圾"], "道路散落物清除屬環保局。", "2026-10-24T08:20:00+08:00", "fixed", "2026-10-24T10:05:00+08:00"],
  [57, "北安路人孔蓋冒水", "北安路靠近大直橋的人孔蓋一直冒水出來，路面積了一大片。", "中山區", "臺北市中山區北安路", 25.08, 121.545, "TYPEA-AC0307", "工務局水利處", ["排水淤積"], "下水道孔蓋冒水屬水利處。", "2026-10-24T09:15:00+08:00", "open"]
];

const items = data.reports["demo-seed"].items, triage = {};
for (const [n, title, body, district, address, lat, lng, category, dept, tags, reason, createdAt, status, statusAt] of rows) {
  assert.ok(lat > 24.96 && lat < 25.21 && lng > 121.46 && lng < 121.67, title);
  const key = "demo-" + n;
  items[key] = { address, author:"demo-seed", body:body + "（模擬資料）", category, createdAt, dept, district, flagged:false, lat, lng, loc:"geocode", n, tags, title, triage:{ by:"ai", reason } };
  const t1 = new Date(Date.parse(createdAt) + 30e3).toISOString();
  const events = [{ t:createdAt, type:"opened" }, { by:"taipei-bot", dept, t:t1, type:"labeled" }, { by:"颱風應變中心", t:t1, title:"颱風災後復原", type:"milestone" }];
  if (status !== "open") events.push({ by:dept, t:statusAt, to:status, type:"status" });
  triage[key] = { status, milestone:MS, events };
}
const milestone = { title:"颱風災後復原", description:"2026-10-23 颱風造成的路樹倒塌、積淹水、招牌與號誌損壞，災後 72 小時內優先處理" };
(data.triage ||= {}); Object.assign(data.triage, triage);
(data.milestones ||= {})[MS] = milestone;
writeFileSync(dataPath, JSON.stringify(data));
console.log(`${rows.length} typhoon reports written to worker/data.json`);

const { ADMIN, BASE } = process.env;
if (!ADMIN || !BASE) process.exit(0);
const post = async (path, body) => {
  for (let k = 0; ; k++) try {
    const r = await fetch(BASE + "/api/db", { method:"POST", headers:{ "content-type":"application/json", "x-admin":ADMIN },
      body:JSON.stringify({ op:"set", path, data:body }), signal:AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`); return;
  } catch (e) { if (k) throw e; await new Promise(res => setTimeout(res, 1000)); }
};
const live = (await (await fetch(BASE + "/api/db", { signal:AbortSignal.timeout(15000) })).json());
const seed = live.reports["demo-seed"];
for (const [n] of rows) seed.items["demo-" + n] = items["demo-" + n];
await post("reports/demo-seed", seed);
for (const [k, v] of Object.entries(triage)) await post("triage/" + k, v);
await post("milestones/" + MS, milestone);
console.log("live Hub updated");
