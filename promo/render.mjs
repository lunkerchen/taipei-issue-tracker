// Render promo/compose.html to promo/out/taipei-promo.mp4 (1080x1920, 30 fps, 29.5 s).
// Uses the global Playwright install and ffmpeg. The soundtrack is synthesized by ffmpeg (aevalsrc).
//   node promo/render.mjs              full video
//   node promo/render.mjs 1.5 4 9.2    only these seconds, as JPEG files in promo/out/sample/
//   node promo/render.mjs --encode     only encode the frames already in promo/out/frames/
import { createRequire } from "node:module";
import { execSync, execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(join(execSync("npm root -g").toString().trim(), "playwright"));
const here = dirname(fileURLToPath(import.meta.url)), out = join(here, "out");
const FPS = 30, DUR = 29.5;
const data = f => readFileSync(join(here, "..", "data", f), "utf8");

async function openPage() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on("pageerror", e => { console.error(e); process.exit(1); });
  await page.addInitScript(`window.DATA={districts:${data("districts.geojson")},history:${data("history-2026.json")}};`);
  await page.goto(pathToFileURL(join(here, "compose.html")).href);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  return page;
}
const frame = (page, t, path) => page.evaluate(t => render(t), t).then(() => page.screenshot({ path, type: "jpeg", quality: 93 }));

const encodeOnly = process.argv[2] === "--encode", at = encodeOnly ? [] : process.argv.slice(2).map(Number);
const dir = join(out, "frames"), total = Math.round(DUR * FPS);
if (!encodeOnly) {
  const page = await openPage();
  if (at.length) {
    const dir = join(out, "sample"); mkdirSync(dir, { recursive: true });
    for (const t of at) await frame(page, t, join(dir, `t${t.toFixed(2)}.jpg`));
    await page.context().browser().close(); process.exit(0);
  }
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await frame(page, i / FPS, join(dir, `${String(i).padStart(4, "0")}.jpg`));
    if (i % 60 === 0) console.log(`frame ${i}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await page.context().browser().close();
}

// 120 BPM: kick on beats, hats off-beat, Am-F-C-G bass and pad, hits and UI blips on the cuts.
const R = (a, b, c, d) => `if(lt(mod(t,8),2),${a},if(lt(mod(t,8),4),${b},if(lt(mod(t,8),6),${c},${d})))`;
const beat = "mod(t,0.5)", run = "gte(t,3)*not(between(t,11,12))";
const voice = f => `sin(2*PI*${f}*t)+0.6*sin(2*PI*(${f}+0.7)*t)`;
// exp() takes max(t-T,0): before T, exp would overflow to inf and 0*inf = NaN poisons the whole stream.
const hit = (T, a) => `gte(t,${T})*sin(2*PI*42*(t-${T}))*exp(-3.5*max(t-${T},0))*${a}`;
const crack = T => `gte(t,${T})*(random(5)*2-1)*exp(-18*max(t-${T},0))*0.45`;
const blip = (T, f) => `gte(t,${T})*sin(2*PI*${f}*(t-${T}))*exp(-30*max(t-${T},0))*0.16`;
const expr = [
  `${run}*lt(t,29)*sin(2*PI*(45*${beat}+6*(1-exp(-25*${beat}))))*exp(-7*${beat})*0.9`,
  `${run}*(random(0)*2-1)*(0.2*exp(-70*mod(t+0.25,0.5))+0.05*exp(-140*mod(t,0.125)))`,
  `${run}*(sin(2*PI*${R(55, 43.65, 65.41, 49)}*t)+0.35*sin(4*PI*${R(55, 43.65, 65.41, 49)}*t))*(1-exp(-30*${beat}))*(1-0.7*exp(-9*${beat}))*0.3`,
  `(${voice(R(220, 174.61, 261.63, 196))}+${voice(R(261.63, 220, 329.63, 246.94))}+${voice(R(329.63, 261.63, 392, 293.66))})*(1-exp(-5*mod(t,2)))*exp(-0.35*mod(t,2))*(0.025+0.02*gte(t,3))`,
  `between(t,0.35,1.6)*(random(1)*2-1)*exp(-250*mod(t-0.35,0.065))*0.35`,
  `between(t,1.85,2.35)*(random(2)*2-1)*exp(-400*mod(t-1.85,0.018))*0.15`,
  `between(t,2.2,3)*((random(3)*2-1)*0.45+sin(2*PI*(200*(t-2.2)+900*pow(t-2.2,2)))*0.25)*pow((t-2.2)/0.8,3)`,
  `between(t,11,12)*((random(4)*2-1)*0.35+sin(2*PI*(100*(t-11)+700*pow(t-11,2)))*0.3)*pow(t-11,2)`,
  ...[[3, 1], [8.7, .6], [9.35, .6], [10, .6], [12, 1], [14.5, .5], [20, .5], [21.95, .7], [24.5, .6], [27, .9]].map(([T, a]) => hit(T, a)),
  ...[3, 8.7, 9.35, 10, 12].map(crack),
  ...[[15, 1500], [16.9, 1200], [17.85, 1400], [17.95, 1600], [18.05, 1800], [18.9, 1300], [19.35, 1200], [19.5, 1700], [21.85, 1000], [22.65, 1400], [22.8, 1600], [22.95, 1800], [28, 1500]].map(([T, f]) => blip(T, f)),
].join("+");

const mp4 = join(out, "taipei-promo.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%04d.jpg"),
  "-filter_complex", `aevalsrc='${expr}':s=48000:d=${DUR},volume=0.7,highpass=f=25,alimiter=limit=0.9:level=disabled,afade=t=out:st=${DUR - 0.7}:d=0.7,aformat=channel_layouts=stereo[a]`,
  "-map", "0:v", "-map", "[a]", "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-color_range", "tv",
  "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-maxrate", "8M", "-bufsize", "16M",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", String(DUR), mp4], { stdio: "inherit" });
console.log(mp4);
