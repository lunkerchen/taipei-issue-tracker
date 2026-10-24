// Render a composition in promo/ to an MP4 in promo/out/. Uses the global Playwright install and ffmpeg.
// The soundtrack is synthesized by ffmpeg (aevalsrc).
//   node promo/render.mjs [promo|intro]              full video (default: promo)
//   node promo/render.mjs [promo|intro] 1.5 4 9.2    only these seconds of the video, as JPEG files in promo/out/<name>/sample/
//   node promo/render.mjs [promo|intro] --encode     only encode the frames already in promo/out/<name>/frames/
import { createRequire } from "node:module";
import { execSync, execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(join(execSync("npm root -g").toString().trim(), "playwright"));
const here = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const data = f => readFileSync(join(here, "..", "data", f), "utf8");

// A composition is authored on a source timeline of dur seconds. retime: [source second, speed] pairs; from that
// source second on, the video plays at that speed, so speeds above 1 make the video shorter.
// Score parameters, in source seconds. drop: groove starts. end: kick stops. gaps: groove off. half: kick on every
// other beat and no hats. alt: second chord loop. typing: [t0, t1, period, decay, gain]. risers: [a, b, noise, f0, f1,
// sweep, power]. hits: [T, gain]. cracks: T. blips: [T, Hz].
const COMPS = {
  promo: {
    html: "compose.html", w: 1080, h: 1920, dur: 29.5, mp4: "taipei-promo.mp4",
    score: {
      drop: 3, end: 29, gaps: [[11, 12]], half: [], alt: [],
      typing: [[0.35, 1.6, 0.065, 250, 0.35], [1.85, 2.35, 0.018, 400, 0.15]],
      risers: [[2.2, 3, 0.45, 200, 900, 0.25, 3], [11, 12, 0.35, 100, 700, 0.3, 2]],
      hits: [[3, 1], [8.7, .6], [9.35, .6], [10, .6], [12, 1], [14.5, .5], [20, .5], [21.95, .7], [24.5, .6], [27, .7], [27.45, 1]],
      cracks: [3, 8.7, 9.35, 10, 12, 27.45],
      blips: [[15, 1500], [16.9, 1200], [17.35, 1300], [18.3, 1400], [18.4, 1600], [18.5, 1800], [19.35, 1200], [19.5, 1700], [21.85, 1000], [22.65, 1400], [22.8, 1600], [22.95, 1800], [28, 1500]],
    },
  },
  intro: {
    html: "intro.html", w: 1920, h: 1080, dur: 90, mp4: "taipei-intro.mp4",
    // Actions keep near 1x for reading, holds and transitions run fast: 90 source seconds play in about 59 s.
    retime: [[0, 1.32], [2.9, 1.1], [5.5, 1.5], [6, 1.8], [13.4, 1.3], [16, 1.4], [17.4, 1.25], [20.9, 2.2], [23.6, 1.2], [24.8, 1.5],
      [26.6, 1.3], [29.2, 2.4], [33, 1.5], [36.8, 1.2], [38.6, 1.4], [41.9, 2.6], [45, 1.6], [47.3, 1.25], [49.7, 1.15], [52, 1.6],
      [53, 1.5], [57.2, 1.6], [62, 2], [69, 1.6], [75, 1.2], [77.9, 1.35], [81, 2.2], [85.5, 1.2], [87.6, 1]],
    score: {
      drop: 3.5, end: 89, gaps: [[23.6, 24.8]], half: [[53, 69]], alt: [[33, 53], [69, 81]],
      typing: [[0.3, 1.5, 0.06, 250, 0.35], [1.75, 2.25, 0.018, 400, 0.15], [34.4, 35.85, 0.042, 300, 0.1], [45.4, 46.8, 0.07, 250, 0.1]],
      risers: [[2.1, 2.9, 0.45, 200, 900, 0.25, 3], [23.6, 24.8, 0.35, 100, 700, 0.3, 2], [84.5, 85.5, 0.3, 150, 800, 0.2, 3]],
      hits: [[2.9, 1], [3.25, 1], [6, .7], [17.6, .6], [18.5, .6], [19.4, .6], [24.8, 1], [33, .5], [45, .5], [53, .5], [62, .6], [69, .5], [74, .5], [75.95, .7], [81, .5], [85.5, .7], [86, 1]],
      cracks: [2.9, 3.25, 17.6, 18.5, 19.4, 24.8, 86],
      blips: [
        ...[0, 1, 2, 3, 4, 5].map(i => [26.6 + i * .35, 1200 + i * 120]),
        [33.9, 1500], [36.8, 1200], [37.3, 1300], [39.5, 1400], [39.6, 1600], [39.7, 1800], [41.6, 1200], [41.8, 1700],
        [47.3, 1200], [48, 1300], [49.1, 1000], [49.7, 1600], ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => [50.2 + i * .22, 1000 + i * 110]),
        [54.2, 1400], [55, 1500], [57.2, 1400], [58.3, 1600], [62.8, 1200],
        [71, 1200], [71.9, 1200], [72.4, 1600], [73.1, 1200], [75.95, 1000], [78.1, 1400], [79, 1600], [87.2, 1500],
      ],
    },
  },
};

const toOut = (segs, s) => { // source second -> video second
  let o = 0;
  for (let i = 0; i < segs.length; i++) { const [a, r] = segs[i], b = segs[i + 1]?.[0] ?? Infinity; if (s <= b) return o + (s - a) / r; o += (b - a) / r; }
};
const toSrc = (segs, t) => { // video second -> source second
  let o = 0;
  for (let i = 0; i < segs.length; i++) { const [a, r] = segs[i], b = segs[i + 1]?.[0] ?? Infinity, d = (b - a) / r; if (t <= o + d) return a + (t - o) * r; o += d; }
};
// Move every cue to video seconds. Typing clicks keep their count, so their period scales with the window.
function retimeScore(s, f) {
  const win = w => w.map(([a, b]) => [f(a), f(b)]);
  return {
    drop: f(s.drop), end: f(s.end), gaps: win(s.gaps), half: win(s.half), alt: win(s.alt),
    typing: s.typing.map(([a, b, p, k, g]) => { const q = (f(b) - f(a)) / (b - a); return [f(a), f(b), p * q, k / q, g]; }),
    risers: s.risers.map(([a, b, ...r]) => [f(a), f(b), ...r]),
    hits: s.hits.map(([T, g]) => [f(T), g]), cracks: s.cracks.map(f), blips: s.blips.map(([T, hz]) => [f(T), hz]),
  };
}

// 120 BPM: kick on beats, hats off-beat, bass and pad on a 4-chord loop (Am-F-C-G, or F-G-Em-Am in alt).
function score(s, dur) {
  const any = w => w.map(([a, b]) => `between(t,${a},${b})`).join("+") || "0";
  const beat = "mod(t,0.5)", run = `gte(t,${s.drop})${s.gaps.map(([a, b]) => `*not(between(t,${a},${b}))`).join("")}`;
  const half = `(${any(s.half)})`, alt = `(${any(s.alt)})`;
  const loop = (a, b, c, d) => `if(lt(mod(t,8),2),${a},if(lt(mod(t,8),4),${b},if(lt(mod(t,8),6),${c},${d})))`;
  const R = (one, two) => `if(${alt},${loop(...two)},${loop(...one)})`;
  const voice = f => `sin(2*PI*${f}*t)+0.6*sin(2*PI*(${f}+0.7)*t)`;
  const bass = R([55, 43.65, 65.41, 49], [43.65, 49, 41.2, 55]);
  // exp() takes max(t-T,0): before T, exp would overflow to inf and 0*inf = NaN poisons the whole stream.
  const hit = ([T, a]) => `gte(t,${T})*sin(2*PI*42*(t-${T}))*exp(-3.5*max(t-${T},0))*${a}`;
  const crack = T => `gte(t,${T})*(random(5)*2-1)*exp(-18*max(t-${T},0))*0.45`;
  const blip = ([T, f]) => `gte(t,${T})*sin(2*PI*${f}*(t-${T}))*exp(-30*max(t-${T},0))*0.16`;
  const typing = ([a, b, p, k, g], i) => `between(t,${a},${b})*(random(${1 + i % 2})*2-1)*exp(-${k}*mod(t-${a},${p}))*${g}`;
  const riser = ([a, b, n, f0, f1, sw, pw], i) => `between(t,${a},${b})*((random(${3 + i % 2})*2-1)*${n}+sin(2*PI*(${f0}*(t-${a})+${f1}*pow(t-${a},2)))*${sw})*pow((t-${a})/(${b}-${a}),${pw})`;
  return [
    `${run}*lt(t,${s.end})*(1-${half}*gte(mod(t,1),0.5))*sin(2*PI*(45*${beat}+6*(1-exp(-25*${beat}))))*exp(-7*${beat})*0.9`,
    `${run}*(1-${half})*(random(0)*2-1)*(0.2*exp(-70*mod(t+0.25,0.5))+0.05*exp(-140*mod(t,0.125)))`,
    `${run}*(sin(2*PI*${bass}*t)+0.35*sin(4*PI*${bass}*t))*(1-exp(-30*${beat}))*(1-0.7*exp(-9*${beat}))*0.3`,
    `(${voice(R([220, 174.61, 261.63, 196], [174.61, 196, 164.81, 220]))}+${voice(R([261.63, 220, 329.63, 246.94], [220, 246.94, 196, 261.63]))}+${voice(R([329.63, 261.63, 392, 293.66], [261.63, 293.66, 246.94, 329.63]))})*(1-exp(-5*mod(t,2)))*exp(-0.35*mod(t,2))*(0.025+0.02*gte(t,${s.drop}))`,
    ...s.typing.map(typing), ...s.risers.map(riser), ...s.hits.map(hit), ...s.cracks.map(crack), ...s.blips.map(blip),
  ].join("+");
}

const args = process.argv.slice(2), name = COMPS[args[0]] ? args.shift() : "promo", C = COMPS[name];
const segs = C.retime ?? [[0, 1]], D = +toOut(segs, C.dur).toFixed(3);
const out = join(here, "out"), dir = join(out, name, "frames"), total = Math.round(D * FPS);
const encodeOnly = args[0] === "--encode", at = encodeOnly ? [] : args.map(Number);

async function openPage() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: C.w, height: C.h } });
  page.on("pageerror", e => { console.error(e); process.exit(1); });
  await page.addInitScript(`window.DATA={districts:${data("districts.geojson")},history:${data("history-2026.json")},li:${data("li.geojson")}};`);
  await page.goto(pathToFileURL(join(here, C.html)).href);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  // Without a Traditional Chinese font, Chromium falls back to a font that can have no CJK glyphs (boxes).
  const fonts = await page.evaluate(() => {
    const g = document.createElement("canvas").getContext("2d"), w = f => (g.font = `40px ${f}`, g.measureText("Hamburgefonstiv").width);
    return ["'Source Han Sans TC'", "'Noto Sans CJK TC'", "'PingFang TC'"].filter(f => w(`${f},monospace`) !== w("monospace"));
  });
  if (!fonts.length) throw new Error("No Traditional Chinese font. Install Source Han Sans TC (or Noto Sans CJK TC).");
  return page;
}
const frame = (page, t, path) => page.evaluate(t => render(t), toSrc(segs, t)).then(() => page.screenshot({ path, type: "jpeg", quality: 93 }));

if (!encodeOnly) {
  const page = await openPage();
  if (at.length) {
    const sample = join(out, name, "sample"); mkdirSync(sample, { recursive: true });
    for (const t of at) await frame(page, t, join(sample, `t${t.toFixed(2)}.jpg`));
    await page.context().browser().close(); process.exit(0);
  }
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await frame(page, i / FPS, join(dir, `${String(i).padStart(4, "0")}.jpg`));
    if (i % 300 === 0) console.log(`frame ${i}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await page.context().browser().close();
}

const mp4 = join(out, C.mp4);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%04d.jpg"),
  "-filter_complex", `aevalsrc='${score(retimeScore(C.score, x => +toOut(segs, x).toFixed(3)), D)}':s=48000:d=${D},volume=0.7,highpass=f=25,alimiter=limit=0.9:level=disabled,afade=t=out:st=${D - 0.7}:d=0.7,aformat=channel_layouts=stereo[a]`,
  "-map", "0:v", "-map", "[a]", "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-color_range", "tv",
  "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-maxrate", "8M", "-bufsize", "16M",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", String(D), mp4], { stdio: "inherit" });
console.log(mp4);
