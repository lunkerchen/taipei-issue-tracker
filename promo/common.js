// Shared by compose.html (9:16 promo) and intro.html (16:9 intro).
// Every frame is a pure function of t: no Date, no Math.random, no requestAnimationFrame.
"use strict";
const $ = id => document.getElementById(id);
const SANS = "'Source Han Sans TC','Noto Sans CJK TC','PingFang TC',sans-serif"; // same stack as --sans in the pages
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eo = k => 1 - (1 - k) ** 3, ei = k => k * k * k;
const eio = k => k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
const back = k => { const c = 2.2; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const imp = (t, T, d = 10) => t < T ? 0 : Math.exp(-(t - T) * d);
const win = (t, a, b, fi = .25, fo = .25) => Math.min(seg(t, a, a + fi), 1 - seg(t, b - fo, b));
const chars = s => [...s];
const typed = (s, t, t0, dt) => chars(s).slice(0, clamp(Math.floor((t - t0) / dt), 0, 1e9)).join("");
const GL = "!<>-_/[]{}=+*^?#01ABCDEF";
const scramble = (s, k, seed) => { const a = chars(s), m = Math.floor(k * a.length); return a.map((c, i) => i < m || c === " " ? c : GL[Math.floor(hash(seed * 13.1 + i * 7.3) * GL.length)]).join(""); };
function show(el, o, tf = "", filter = "") {
  el.style.visibility = o > .001 ? "visible" : "hidden";
  el.style.opacity = o; el.style.transform = tf; el.style.filter = filter;
}
// Red/cyan split used on glitches and slams.
const rgb = dx => dx > .3 ? `${dx}px 0 #ff2a6dcc,${-dx}px 0 #05d9e8cc` : "none";
function caption(t, list, sub, cap) { // list: [t0, sub, text]
  let cur = list[0]; for (const it of list) if (t >= it[0]) cur = it;
  sub.textContent = cur[1]; cap.textContent = cur[2];
  const k = eo(seg(t, cur[0], cur[0] + .35));
  return { o: k, y: (1 - k) * 50, blur: (1 - k) * 12 };
}
const flashLevel = (t, list) => { let f = 0; for (const [T, a, d] of list) f += a * imp(t, T, d) * (t - T < .06 ? (t - T) / .06 : 1); return f; };
function shake(t, list) {
  let s = 0; for (const [T, a] of list) s += a * imp(t, T, 9);
  const f = Math.floor(t * 30);
  return s > .3 ? `translate(${(hash(f) - .5) * s}px,${(hash(f + 99) - .5) * s}px)` : "";
}

/* Taipei map plus the 128,640 real 1999 dispatches (window.DATA), drawn on #cv; #fx is the top layer.
   cfg: W, H, mapW, mapCx, mapCy, galaxy [x, y], vig [x, y, r0, r1], glow [x, y, r] */
function Stage(cfg) {
  const { W, H } = cfg, CX = cfg.mapCx, MCY = cfg.mapCy, D = window.DATA;
  const LON0 = 121.4588, LON1 = 121.6659, LAT0 = 24.9603, LAT1 = 25.2102, KC = Math.cos(25.085 * Math.PI / 180);
  const SC = cfg.mapW / ((LON1 - LON0) * KC), MH = (LAT1 - LAT0) * SC, MX = CX - cfg.mapW / 2, MY = MCY - MH / 2;
  const proj = (lon, lat) => [MX + (lon - LON0) * KC * SC, MY + (LAT1 - lat) * SC];

  const districts = D.districts.features.map(f => {
    const pts = f.geometry.coordinates[0].map(([lo, la]) => proj(lo, la));
    let len = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(len); }
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { name: f.properties.district, pts, cum, len, cx, cy };
  });
  const DCOL = ["#1f6feb", "#2ea043", "#bf8700", "#8957e5", "#db61a2", "#1b7c83", "#d1242f", "#57ab5a", "#e16f24", "#539bf5", "#a371f7", "#3fb950"];

  const HIS = D.history, dayKeys = Object.keys(HIS.days).sort();
  let N = 0; for (const k of dayKeys) N += HIS.days[k].length;
  const TX = new Float32Array(N), TY = new Float32Array(N), SR = new Float32Array(N), SA = new Float32Array(N), COL = new Uint8Array(N), DAY = new Uint16Array(N), ITEM = new Uint8Array(N);
  const CAT = { "TYPEA-AC0100": 0, "TYPEA-AC0200": 1, "TYPEA-AC0300": 2, "TYPEA-AC0500": 3, "TYPEA-AC0700": 4 };
  const PAL = [[63, 185, 80], [210, 153, 34], [68, 147, 248], [219, 97, 162], [163, 113, 247]];
  {
    let i = 0;
    dayKeys.forEach((k, di) => {
      for (const [r, it] of HIS.days[k].slice().sort((a, b) => a[2] - b[2])) {
        const rd = HIS.roads[r]; const [x, y] = proj(rd[3], rd[2]);
        // Roads share one coordinate, so spread each dispatch around its road point.
        const u = Math.max(hash(i * 1.31 + .1), 1e-6), v = hash(i * 2.17 + .7), g = Math.sqrt(-2 * Math.log(u)) * 8.5;
        TX[i] = x + g * Math.cos(2 * Math.PI * v); TY[i] = y + g * Math.sin(2 * Math.PI * v);
        const arm = Math.floor(hash(i * 5.1 + .2) * 3), r0 = 50 + 470 * Math.pow(hash(i * 3.7 + .3), .65);
        SR[i] = r0; SA[i] = arm * 2.094 + r0 * .012 + (hash(i * 7.9 + .4) - .5) * .8;
        COL[i] = CAT[HIS.items[it][1]] ?? 0; DAY[i] = di; ITEM[i] = it; i++;
      }
    });
  }
  // A road name can repeat in several districts, and records with r[4] = 0 are district-centre fallbacks.
  const road = (district, name) => {
    const r = HIS.roads.find(x => x[0] === district && x[1] === name && x[4] === 1);
    if (!r) throw new Error(`no geocoded road ${district} ${name}`);
    return proj(r[3], r[2]);
  };

  const cv = $("cv"), ctx = cv.getContext("2d"), fctx = $("fx").getContext("2d");
  const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const pc = canvas(W, H), pctx = pc.getContext("2d"), pimg = pctx.createImageData(W, H), PD = pimg.data;
  const bl1 = canvas(W / 4, H / 4), b1 = bl1.getContext("2d"), bl2 = canvas(W / 12, H / 12), b2 = bl2.getContext("2d");
  const grain = [0, 1, 2, 3].map(s => {
    const c = canvas(W / 2, H / 2), g = c.getContext("2d"), im = g.createImageData(W / 2, H / 2);
    let x = 1234567 + s * 99991;
    for (let j = 0; j < im.data.length; j += 4) { x = (x * 1103515245 + 12345) & 0x7fffffff; const v = x & 255; im.data[j] = im.data[j + 1] = im.data[j + 2] = v; im.data[j + 3] = 10; }
    g.putImageData(im, 0, 0); return c;
  });
  const vig = canvas(W, H);
  { const [x, y, r0, r1] = cfg.vig, g = vig.getContext("2d"), gr = g.createRadialGradient(x, y, r0, x, y, r1); gr.addColorStop(0, "#0000"); gr.addColorStop(1, "#000c"); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  const dots = canvas(54, 54);
  { const g = dots.getContext("2d"); g.fillStyle = "#ffffff12"; g.fillRect(26, 26, 3, 3); }
  const dotPat = ctx.createPattern(dots, "repeat");

  /* camera: screen = C + z * R(rot) * (p - focus) + offset */
  const cam = (z = 1, rot = 0, fx = CX, fy = MCY, ox = 0, oy = 0) => ({ z, c: Math.cos(rot), s: Math.sin(rot), fx, fy, ox, oy });
  const camP = (x, y, m) => { const dx = x - m.fx, dy = y - m.fy; return [CX + (dx * m.c - dy * m.s) * m.z + m.ox, MCY + (dx * m.s + dy * m.c) * m.z + m.oy]; };
  const camT = (g, m) => g.setTransform(m.z * m.c, m.z * m.s, -m.z * m.s, m.z * m.c, CX - m.z * (m.c * m.fx - m.s * m.fy) + m.ox, MCY - m.z * (m.s * m.fx + m.c * m.fy) + m.oy);

  /* particles: clear, plot each dispatch as a 2x2 additive dot, then flush with a two-level bloom */
  const clear = () => PD.fill(0);
  function plot(x, y, ci, g) {
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return;
    const p = ((y | 0) * W + (x | 0)) * 4, c = PAL[ci], r = c[0] * g, gg = c[1] * g, b = c[2] * g;
    PD[p] += r; PD[p + 1] += gg; PD[p + 2] += b; PD[p + 3] = 255;
    PD[p + 4] += r; PD[p + 5] += gg; PD[p + 6] += b; PD[p + 7] = 255;
    const q = p + W * 4;
    PD[q] += r; PD[q + 1] += gg; PD[q + 2] += b; PD[q + 3] = 255;
    PD[q + 4] += r; PD[q + 5] += gg; PD[q + 6] += b; PD[q + 7] = 255;
  }
  function flush() {
    pctx.putImageData(pimg, 0, 0);
    b1.clearRect(0, 0, bl1.width, bl1.height); b1.drawImage(pc, 0, 0, bl1.width, bl1.height);
    b2.clearRect(0, 0, bl2.width, bl2.height); b2.drawImage(bl1, 0, 0, bl2.width, bl2.height);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = .9; ctx.drawImage(bl2, 0, 0, W, H);
    ctx.globalAlpha = .8; ctx.drawImage(bl1, 0, 0, W, H);
    ctx.globalAlpha = 1; ctx.drawImage(pc, 0, 0);
    ctx.restore();
  }

  /* district outlines drawn on to k of their length, optional fill; labels at centroids */
  function outlines(m, a, k = 1, fill = 0, color = "#8bb8ff") {
    if (a <= 0) return;
    ctx.save(); camT(ctx, m); ctx.lineJoin = "round";
    districts.forEach((d, j) => {
      ctx.beginPath(); const lim = d.len * k;
      ctx.moveTo(d.pts[0][0], d.pts[0][1]);
      for (let i = 1; i < d.pts.length && d.cum[i - 1] < lim; i++) {
        if (d.cum[i] <= lim) ctx.lineTo(d.pts[i][0], d.pts[i][1]);
        else { const f = (lim - d.cum[i - 1]) / (d.cum[i] - d.cum[i - 1]); ctx.lineTo(lerp(d.pts[i - 1][0], d.pts[i][0], f), lerp(d.pts[i - 1][1], d.pts[i][1], f)); }
      }
      if (fill) { ctx.globalAlpha = fill; ctx.fillStyle = DCOL[j]; ctx.fill(); }
      ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = 2.2 / m.z; ctx.stroke();
    });
    ctx.restore();
  }
  function labels(m, a, size = 26) {
    if (a <= 0) return;
    ctx.save(); ctx.font = `700 ${size}px ${SANS}`; ctx.textAlign = "center"; ctx.fillStyle = "#f0f6fc"; ctx.globalAlpha = a * .75;
    ctx.shadowColor = "#000"; ctx.shadowBlur = 8;
    for (const d of districts) { const [x, y] = camP(d.cx, d.cy, m); ctx.fillText(d.name, x, y); }
    ctx.restore();
  }
  function pin(x, y, col, s, alpha, label) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(s, s);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-6, -14, -22, -26, -22, -42); ctx.arc(0, -42, 22, Math.PI, 0); ctx.bezierCurveTo(22, -26, 6, -14, 0, 0); ctx.closePath();
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 26; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 2.5; ctx.strokeStyle = "#ffffffaa"; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -42, 8, 0, 2 * Math.PI); ctx.fillStyle = "#0d1117"; ctx.fill();
    if (label) {
      ctx.font = "700 22px Menlo"; const w = ctx.measureText(label).width + 22;
      ctx.fillStyle = "#0d1117ee"; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(26, -86, w, 36, 18); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f0f6fc"; ctx.fillText(label, 37, -60);
    }
    ctx.restore();
  }

  /* background: base colour, a soft glow that follows glowKeys [[t, [r,g,b]], ...], and a slow dot grid */
  function background(t, glowKeys) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#0d1117"; ctx.fillRect(0, 0, W, H);
    let c = glowKeys[0][1];
    for (let i = 1; i < glowKeys.length; i++) if (t >= glowKeys[i][0]) { const k = seg(t, glowKeys[i][0], glowKeys[i][0] + .8); c = glowKeys[i - 1][1].map((v, j) => lerp(v, glowKeys[i][1][j], k)); }
    const [gx, gy, gr_] = cfg.glow, gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr_);
    gr.addColorStop(0, `rgba(${c.map(Math.round)},.16)`); gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(0, -(t * 18) % 54); ctx.fillStyle = dotPat; ctx.fillRect(0, 0, W, H + 54); ctx.restore();
  }

  /* fx layer: confetti burst from (x, y) at T, white flash, vignette, grain, fade to black at the end */
  function confetti(t, T, x0, y0) {
    if (t < T || t >= T + 1.65) return;
    const dt = t - T;
    for (let i = 0; i < 120; i++) {
      const a = hash(i * 3.1) * Math.PI * 2, sp = 500 + hash(i * 5.3) * 1300;
      const x = x0 + Math.cos(a) * sp * dt, y = y0 + Math.sin(a) * sp * dt * .8 + 1400 * dt * dt;
      fctx.save(); fctx.globalAlpha = clamp(1 - dt / 1.6); fctx.translate(x, y); fctx.rotate(dt * (6 + i % 7) + i);
      fctx.fillStyle = ["#a371f7", "#3fb950", "#f0f6fc", "#8957e5", "#7ee787"][i % 5]; fctx.fillRect(-9, -4, 18, 8); fctx.restore();
    }
  }
  const fxClear = () => { fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, W, H); };
  function fxFinish(t, flash, dur) {
    if (flash > .002) { fctx.globalAlpha = clamp(flash); fctx.fillStyle = "#f0f6fc"; fctx.fillRect(0, 0, W, H); }
    fctx.globalAlpha = 1; fctx.drawImage(vig, 0, 0);
    fctx.globalAlpha = .9; fctx.drawImage(grain[Math.floor(t * 30) % 4], 0, 0, W, H);
    fctx.globalAlpha = clamp(seg(t, dur - .35, dur)); fctx.fillStyle = "#000"; fctx.fillRect(0, 0, W, H);
  }

  return { W, H, CX, MCY, proj, districts, HIS, dayKeys, N, TX, TY, SR, SA, COL, DAY, ITEM, PAL, road, ctx, fctx,
    cam, camP, camT, clear, plot, flush, outlines, labels, pin, background, confetti, fxClear, fxFinish };
}
