// Builds data/districts.geojson (12 districts) and data/li.geojson (456 villages, 里) from data.taipei's 臺北市里界圖.
// The source is a TWD97 TM2 shapefile; mapshaper reprojects it to WGS84 and simplifies it with shared borders kept,
// so neighbouring 里 never gap or overlap and each district outline is the exact union of its 里.
// Needs `unzip` and network (npx fetches mapshaper once). Run: node scripts/build-li.mjs
import { writeFileSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const at = p => fileURLToPath(new URL("../data/" + p, import.meta.url));
const SRC = "https://data.taipei/api/dataset/6b17b31d-4e16-495e-95b1-9fd1f47c80d8/resource/145e30da-58f3-45db-a125-8adc3fde2620/download";
const UA = "taipei-issue-tracker (labanchen@gmail.com)";
const MAPSHAPER = "mapshaper@0.6.113";
const DISTRICTS = "中正區 大同區 中山區 松山區 大安區 萬華區 信義區 士林區 北投區 內湖區 南港區 文山區".split(" ");
const KEEP = "20%"; // of vertices; a few metres of error at this scale, enough for zoom 16

const tmp = mkdtempSync(join(tmpdir(), "li-"));
try {
  const r = await fetch(SRC, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  writeFileSync(join(tmp, "li.zip"), Buffer.from(await r.arrayBuffer()));
  execFileSync("unzip", ["-q", "-o", "li.zip"], { cwd: tmp });
  const shp = readdirSync(tmp).find(f => f.endsWith(".shp"));
  const ms = (...args) => execFileSync("npx", ["-y", MAPSHAPER, shp, "encoding=utf8", ...args], { cwd: tmp, stdio: ["ignore", "ignore", "inherit"] });
  // -clean drops ~40 slivers between 里 in the source and fixes intersections left by -simplify
  const common = ["-proj", "wgs84", "-clean", "-simplify", KEEP, "keep-shapes", "-clean"];
  ms(...common, "-each", "district=TNAME, li=VNAME, code=String(NPTVID).split('.')[0]", "-filter-fields", "district,li,code",
    "-o", "li.geojson", "precision=0.00001");
  ms(...common, "-dissolve", "TNAME", "copy-fields=", "-rename-fields", "district=TNAME", "-o", "districts.geojson", "precision=0.00001");

  const li = JSON.parse(readFileSync(join(tmp, "li.geojson"), "utf8"));
  const ds = JSON.parse(readFileSync(join(tmp, "districts.geojson"), "utf8"));
  assert.equal(li.features.length, 456, "里 count");
  assert.deepEqual(ds.features.map(f => f.properties.district).sort(), [...DISTRICTS].sort(), "district names");
  for (const f of li.features) assert.ok(DISTRICTS.includes(f.properties.district) && /里$/.test(f.properties.li), JSON.stringify(f.properties));
  assert.equal(new Set(li.features.map(f => f.properties.district + f.properties.li)).size, 456, "unique 區+里");
  // Sort so reruns produce the same file
  li.features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  ds.features.sort((a, b) => DISTRICTS.indexOf(a.properties.district) - DISTRICTS.indexOf(b.properties.district));
  writeFileSync(at("li.geojson"), JSON.stringify(li));
  writeFileSync(at("districts.geojson"), JSON.stringify(ds));
  const per = Object.fromEntries(DISTRICTS.map(d => [d, li.features.filter(f => f.properties.district === d).length]));
  console.log("里 per district:", per);
  console.log("wrote data/li.geojson", readFileSync(at("li.geojson")).length, "bytes; data/districts.geojson", readFileSync(at("districts.geojson")).length, "bytes");
} finally { rmSync(tmp, { recursive: true, force: true }); }
