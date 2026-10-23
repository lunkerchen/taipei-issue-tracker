// Pull maskPII and isoWeek out of taipei-issues.html and assert on them. Run: node check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const html = readFileSync(new URL("./taipei-issues.html", import.meta.url), "utf8");
const grab = name => { const m = html.match(new RegExp(`^function ${name}\\b[\\s\\S]*?^}`, "m")); assert(m, `${name} not found`); return m[0]; };
const { maskPII, isoWeek } = new Function("DAY", `${grab("maskPII")}\n${grab("isoWeek")}\nreturn { maskPII, isoWeek };`)(864e5);

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
console.log("OK");
