// Fills data/li-contacts.json (里長 + 里辦公處 phone) and data/councilors.json (members per zone) from data/offices.json.
// Office phones only: the 里長 mobile in offices.json stays out of the page. Run after fetch-offices.mjs: node scripts/fill-contacts.mjs
// ponytail: zones 7 and 8 (原住民, citywide) are left out; the 里 page shows one zone per district.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const file = f => fileURLToPath(new URL("../data/" + f, import.meta.url));
const read = f => JSON.parse(readFileSync(file(f), "utf8"));
const write = (f, v) => writeFileSync(file(f), JSON.stringify(v, null, 2) + "\n");
const key = (d, li) => (d + li).replace(/臺/g, "台").replace(/廍/g, "蔀"); // 區公所 writes 糖廍里, the 里 map writes 糖蔀里

// First number only ("27297708#6025、6125" → "02-2729-7708#6025"), so the 撥打 link dials one line; adds 02 to 8-digit numbers
export function phone(s) {
  const m = /(\+?[\d-]{7,})(#\d+)?/.exec(String(s || "")); if (!m) return "";
  const d = m[1].replace(/-/g, "");
  return (/^\d{8}$/.test(d) ? `02-${d.slice(0, 4)}-${d.slice(4)}` : m[1]) + (m[2] || "");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { offices } = read("offices.json");
  const vil = new Map(offices.filter(o => o.kind === "village").map(o => [key(o.district, o.area), o]));
  const li = read("li-contacts.json").map(r => { const o = vil.get(key(r.district, r.li)); return o ? { ...r, chief: o.name || "", phone: phone(o.phone) } : r; });
  const ZH = "一二三四五六七八";
  const zones = read("councilors.json").map(z => {
    const area = `第${ZH[parseInt(/\d+/.exec(z.zone)) - 1]}選區`;
    return { ...z, members: offices.filter(o => o.kind === "councilor" && o.area === area).map(o => ({ name: o.name, party: o.party || "", phone: phone(o.phone) })) };
  });
  // li-contacts.json keeps one row per line, as before
  writeFileSync(file("li-contacts.json"), "[\n" + li.map(r => JSON.stringify(r)).join(",\n") + "\n]\n");
  write("councilors.json", zones);
  console.log(`里長 ${li.filter(r => r.chief).length}/${li.length}, 議員 ${zones.reduce((n, z) => n + z.members.length, 0)}`);
}

assert.equal(phone("27297708#6025、6125"), "02-2729-7708#6025");
assert.equal(phone("25091939(中山服務處)"), "02-2509-1939");
assert.equal(phone("02-2369-0339"), "02-2369-0339");
assert.equal(phone(""), "");
