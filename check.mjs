// Pull maskPII, isoWeek, tkDate and cleanItem (with the consts it needs) out of taipei-issues.html and assert on them. Run: node check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const html = readFileSync(new URL("./taipei-issues.html", import.meta.url), "utf8");
// Every inline script must parse: a syntax error stops the whole page (the form then does a native GET submit)
for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(code);
const grab = name => { const m = html.match(new RegExp(`^function ${name}\\b[\\s\\S]*?^}`, "m")); assert(m, `${name} not found`); return m[0]; };
// const declarations run to the first line that ends in ";"
const grabConst = name => { const m = html.match(new RegExp(`^const ${name}\\b[\\s\\S]*?;[ \\t]*$`, "m")); assert(m, `${name} not found`); return m[0]; };
const { maskPII, isoWeek } = new Function("DAY", `${grab("maskPII")}\n${grab("isoWeek")}\nreturn { maskPII, isoWeek };`)(864e5);
const { cleanItem, inTaipei } = new Function(["DISTRICTS","DEPTS","CODEOWNERS","TAGS","BOUNDS","TAIPEI_RING","inRing","isStr","validDate","deptOf","inTaipei","PHOTO_MAX"].map(n => grabConst(n)).join("\n") + `\n${grab("cleanItem")}\nreturn { cleanItem, inTaipei };`)();

const tkDate = new Function(`${grabConst("tkDate")}\nreturn tkDate;`)();
for (const [src, want] of [["10/24", "10/24"], [" 9/05", "9/5"], ["2026-10-23T16:15:30Z", "10/24"], ["", ""]]) assert.equal(tkDate(src), want, src);

const M = "［已遮蔽］";
for (const [src, want] of [
  ["手機 0912-345-678 請回電", `手機 ${M} 請回電`],
  ["0912345678", M],
  ["0912 345 678", M],
  ["+886 912 345 678", M],
  ["+886-912-345-678", M],
  ["電話 02-2720-8889", `電話 ${M}`],
  ["(02)27208889", M],
  ["身分證 A123456789", `身分證 ${M}`],
  ["信箱 laban.chen@example.com 謝謝", `信箱 ${M} 謝謝`],
  ["身分證 Ａ１２３４５６７８９ 謝謝", `身分證 ${M} 謝謝`],
  ["身分證 𝐀𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗 謝謝", `身分證 ${M} 謝謝`],
  ["信箱 ｌａｂａｎ＠ｅｘａｍｐｌｅ．ｃｏｍ，謝謝", `信箱 ${M}，謝謝`],
  ["0912.345.678", M],
  ["0912  345  678", M],
  ["886912345678", M],
  ["037-123456", M],
  ["037-123-456", M],
  ["049-2345678", M],
  ["(037)123456", M],
  ["(049)222-1234", M],
  ["０９１２３４５６７８", M],
  ["電話：０９１２－３４５－６７８", `電話：${M}`],
  ["營業時間 08:00-22:00", "營業時間 08:00-22:00"],
  ["2026-10-23", "2026-10-23"],
  ["信義路四段 200 號前人行道磚塊鬆動", "信義路四段 200 號前人行道磚塊鬆動"],
  ["松仁路 100 號 8 樓，2026-10-23 發現", "松仁路 100 號 8 樓，2026-10-23 發現"],
]) assert.equal(maskPII(src).text, want, src);
assert.equal(maskPII("0912-345-678 與 A123456789 與 a@b.co").count, 3);
assert.equal(maskPII("沒有個資").count, 0);

assert.deepEqual(isoWeek(new Date(2026, 9, 23)), [2026, 43]);
assert.deepEqual(isoWeek(new Date(2021, 0, 1)), [2020, 53]);
assert.deepEqual(isoWeek(new Date(2024, 11, 30)), [2025, 1]);
assert.deepEqual(isoWeek(new Date(2026, 0, 1)), [2026, 1]);

// cleanItem: coordinates, loc and address are validated on their own; a bad one is dropped, never the whole item.
const base = { n:1, title:"t", body:"b", createdAt:"2026-10-23T09:00:00+08:00", dept:"環保局", district:"大安區", tags:["噪音"], author:"u1" };
const ok = (extra, doc = "u1") => cleanItem("k1", { ...base, ...extra }, doc);
let c = ok({ lat:25.033, lng:121.565, loc:"gps", address:"信義路四段 200 號" });
assert.deepEqual([c.lat, c.lng, c.loc, c.address], [25.033, 121.565, "gps", "信義路四段 200 號"]);
for (const loc of ["gps", "pin", "geocode", "district"]) assert.equal(ok({ loc }).loc, loc);
c = ok({});
assert(c && !("lat" in c) && !("lng" in c) && !("loc" in c) && !("address" in c), "fields stay absent when not given");
for (const [lat, lng] of [[24.94, 121.5], [25.23, 121.5], [25.0, 121.44], [25.0, 121.68], ["25.03", 121.5], [25.03, "121.5"], [NaN, 121.5], [25.03, Infinity], [null, 121.5], [25.03, undefined], [{}, []]]) {
  c = ok({ lat, lng, loc:"pin", address:"x" });
  assert(c, `item kept: ${lat},${lng}`);
  assert(!("lat" in c) && !("lng" in c), `coordinates dropped: ${lat},${lng}`);
  assert.equal(c.loc, "pin"); assert.equal(c.address, "x"); assert.equal(c.title, "t");
}
// Bounding-box corners are New Taipei, so the boundary check drops them; a point inside the city keeps its coordinates
for (const [lat, lng] of [[24.95, 121.45], [25.22, 121.67]]) assert(!("lat" in ok({ lat, lng })), `outside Taipei dropped: ${lat},${lng}`);
assert.deepEqual([ok({ lat:25.0339, lng:121.5645 }).lat, ok({ lat:25.0339, lng:121.5645 }).lng], [25.0339, 121.5645]);
for (const loc of ["GPS", "manual", "", null, 1, ["gps"]]) { c = ok({ lat:25.03, lng:121.5, loc }); assert(c && !("loc" in c) && c.lat === 25.03, `loc dropped: ${String(loc)}`); }
assert.equal(ok({ address:"a".repeat(100) }).address.length, 100);
for (const address of ["a".repeat(101), 5, null, ["x"], ""]) { c = ok({ address, lat:25.03, lng:121.5 }); assert(c && !("address" in c) && c.lat === 25.03, `address dropped: ${String(address).slice(0, 5)}`); }
assert.equal(ok({ lat:25.03, lng:121.5 }, "u2"), null, "author mismatch still rejects the whole item");
assert(inTaipei(25.0375, 121.5637) && !inTaipei(0, 0) && !inTaipei("25", "121.5"));
// Taipei boundary: neighbours inside the old bounding box must be out
for (const [name, la, ln, want] of [["板橋文化路", 25.0187, 121.4651, false], ["三重", 25.0615, 121.4870, false], ["永和", 25.0090, 121.5150, false],
  ["台北101", 25.0339, 121.5645, true], ["北投", 25.137, 121.498, true], ["南港展覽館", 25.0565, 121.6176, true]]) assert.equal(inTaipei(la, ln), want, name);
// A template with nothing filled in is empty; any real content after a label counts
const withoutTemplate = new Function(["ROAD","NOISE","LAMP","TEMPLATES","TPL_LINES","withoutTemplate"].map(n => grabConst(n)).join("\n") + "\nreturn withoutTemplate;")();
assert.equal(withoutTemplate("地點：\n噪音來源（店家、工地、住戶…）：\n時段（幾點到幾點、每天或只有週末）："), "");
assert.equal(withoutTemplate("地點：  \n狀況（不亮、閃爍、白天也亮）：\n從什麼時候開始："), "");
assert.notEqual(withoutTemplate("地點：民生東路三段\n噪音來源（店家、工地、住戶…）：\n時段（幾點到幾點、每天或只有週末）："), "");
assert.equal(withoutTemplate("地點:\n狀況（不亮、閃爍、白天也亮）:\n從什麼時候開始:"), "");
assert.notEqual(withoutTemplate("敦化南路紅綠燈一直閃黃燈"), "");
// Photos: own folder (or demo/ for the seed) only, at most 3
const pbase = { title:"t", body:"b", createdAt:"2026-10-01T00:00:00Z" }, me16 = "0123456789abcdef";
assert.deepEqual(cleanItem("x", { ...pbase, author:me16, photos:[`${me16}/a.jpg`, "fedcba9876543210/b.jpg", "demo/c.jpg", "../x.jpg", `${me16}/d.webp`, `${me16}/e.jpg`, `${me16}/f.jpg`, `${me16}/g.jpg`] }, me16).photos, [`${me16}/a.jpg`, `${me16}/e.jpg`, `${me16}/f.jpg`]);
assert.deepEqual(cleanItem("x", { ...pbase, n:1, photos:["demo/demo-01.jpg", "javascript:alert(1)"] }, "demo-seed").photos, ["demo/demo-01.jpg"]);
assert.deepEqual(cleanItem("x", { ...pbase, author:me16, photos:"demo/a.jpg" }, me16).photos, []);
console.log("OK");
