import { reveal } from '../fx/reveal.js';

/* features: four large rows, alternating sides, each with a small live visual.
   Canvases initialise only when they come near the viewport, run only while visible
   and the tab is in front, and draw one still frame under prefers-reduced-motion. */

const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const TAU = Math.PI * 2;
const C = {
  text: '#F3F0FF', muted: '#ABA6CB', dim: '#857FA9', violet: '#7C6CFF', lavender: '#B7A9FF',
  sky: '#8FD3FF', mint: '#9EF0C4', coral: '#FF8E7A', amber: '#FFC772', clay: '#E8A07F',
};
const MONO = "'JetBrains Mono', ui-monospace, Consolas, monospace";
const UI = "'Plus Jakarta Sans', system-ui, sans-serif";

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- live canvas helper ---------- */
function liveCanvas(figure, canvas, draw, still) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let W = 0, H = 0, dpr = 1, raf = 0, t = 0, last = 0, visible = false, ready = false;

  function paint() {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    draw(ctx, W, H, RM.matches ? still : t, RM.matches);
  }
  function size() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    paint();
  }
  function frame(now) {
    raf = 0;
    t += Math.min(0.05, (now - last) / 1000);
    last = now;
    paint();
    loop();
  }
  function loop() {
    const want = ready && visible && !document.hidden && !RM.matches;
    figure.classList.toggle('is-live', want);
    if (want && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!want && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function init() {
    if (ready) return;
    ready = true;
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(canvas);
    else window.addEventListener('resize', size);
    size();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const e of entries) {
        visible = e.isIntersecting;
        if (visible) init();
      }
      loop();
    }, { rootMargin: '160px 0px' }).observe(figure);
  } else { visible = true; init(); }
  document.addEventListener('visibilitychange', loop);
  if (RM.addEventListener) RM.addEventListener('change', () => { loop(); paint(); });
}

/* ---------- 01 exposure map ---------- */
const BLIPS = [
  { deg: 312, r: 0.80, port: '7547', name: 'TR-069', col: C.coral },
  { deg: 32, r: 0.56, port: '23', name: 'Telnet', col: C.amber },
  { deg: 150, r: 0.72, port: '1900', name: 'UPnP', col: C.lavender },
  { deg: 196, r: 0.5, port: '80', name: 'HTTP admin', col: C.amber },
  { deg: 275, r: 0.36, port: '443', name: 'HTTPS admin', col: C.mint, ok: true },
];
const SWEEP_SPEED = 0.8;

function drawExposure(ctx, W, H, t) {
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W * 0.4, H * 0.42);
  const s = (t * SWEEP_SPEED) % TAU;

  let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
  g.addColorStop(0, 'rgba(124,108,255,.14)');
  g.addColorStop(1, 'rgba(124,108,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // rings and spokes
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    ctx.strokeStyle = i === 4 ? 'rgba(183,169,255,.22)' : 'rgba(183,169,255,.10)';
    ctx.setLineDash(i === 4 ? [] : [2, 5]);
    ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 4, 0, TAU); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(183,169,255,.06)';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.25, cy + Math.sin(a) * R * 0.25);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
  }
  // outer tick marks
  ctx.strokeStyle = 'rgba(183,169,255,.28)';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU, l = i % 6 === 0 ? 7 : 3;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l)); ctx.stroke();
  }

  // sweep wedge
  const span = 1.15;
  if (ctx.createConicGradient) {
    const cg = ctx.createConicGradient(s - span, cx, cy);
    const f = span / TAU;
    cg.addColorStop(0, 'rgba(124,108,255,0)');
    cg.addColorStop(f * 0.98, 'rgba(160,145,255,.30)');
    cg.addColorStop(f, 'rgba(160,145,255,0)');
    cg.addColorStop(1, 'rgba(124,108,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, s - span, s); ctx.closePath(); ctx.fill();
  } else {
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = `rgba(160,145,255,${0.025 * (i / 12)})`;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, s - span + (span * i) / 12, s); ctx.closePath(); ctx.fill();
    }
  }
  const lg = ctx.createLinearGradient(cx, cy, cx + Math.cos(s) * R, cy + Math.sin(s) * R);
  lg.addColorStop(0, 'rgba(220,214,255,0)');
  lg.addColorStop(1, 'rgba(220,214,255,.9)');
  ctx.strokeStyle = lg; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(s) * R, cy + Math.sin(s) * R); ctx.stroke();

  // blips
  const fs = W < 380 ? 10 : 11;
  for (const b of BLIPS) {
    const a = (b.deg * Math.PI) / 180;
    const x = cx + Math.cos(a) * R * b.r, y = cy + Math.sin(a) * R * b.r;
    let d = (s - a) % TAU; if (d < 0) d += TAU;
    const glow = Math.exp(-d * 1.5);
    if (!b.ok) {
      const rr = 5 + (1 - glow) * 20;
      ctx.strokeStyle = rgba(b.col, 0.55 * glow);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      const hg = ctx.createRadialGradient(x, y, 0, x, y, 16);
      hg.addColorStop(0, rgba(b.col, 0.35 + 0.4 * glow));
      hg.addColorStop(1, rgba(b.col, 0));
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = rgba(b.col, b.ok ? 0.7 : 0.55 + 0.45 * glow);
    ctx.beginPath(); ctx.arc(x, y, b.ok ? 2.6 : 3.4, 0, TAU); ctx.fill();

    ctx.font = `500 ${fs}px ${MONO}`;
    const label = b.port, sub = ' ' + b.name;
    const wl = ctx.measureText(label).width;
    ctx.font = `400 ${fs}px ${MONO}`;
    const ws = ctx.measureText(sub).width;
    let tx = x + 10;
    if (tx + wl + ws > W - 8) tx = x - 10 - wl - ws;
    const al = b.ok ? 0.6 : 0.55 + 0.45 * glow;
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${fs}px ${MONO}`;
    ctx.fillStyle = rgba(b.ok ? C.mint : C.text, al);
    ctx.fillText(label, tx, y);
    ctx.font = `400 ${fs}px ${MONO}`;
    ctx.fillStyle = rgba(C.muted, al * 0.9);
    ctx.fillText(sub, tx + wl, y);
  }

  // router at the centre
  const rw = 30, rh = 11;
  g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 34);
  g.addColorStop(0, 'rgba(183,169,255,.35)'); g.addColorStop(1, 'rgba(183,169,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, TAU); ctx.fill();
  roundRect(ctx, cx - rw / 2, cy - rh / 2, rw, rh, 4);
  ctx.fillStyle = '#17133A'; ctx.fill();
  ctx.strokeStyle = 'rgba(206,198,255,.85)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(183,169,255,.75)';
  ctx.beginPath(); ctx.moveTo(cx - 9, cy - rh / 2); ctx.lineTo(cx - 12, cy - rh / 2 - 9);
  ctx.moveTo(cx + 9, cy - rh / 2); ctx.lineTo(cx + 12, cy - rh / 2 - 9); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i === 2 ? C.sky : C.mint;
    ctx.beginPath(); ctx.arc(cx - 7 + i * 5, cy + 0.5, 1.2, 0, TAU); ctx.fill();
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.font = `400 10px ${MONO}`;
  ctx.fillStyle = rgba(C.dim, 0.9);
  ctx.fillText('your router', cx, cy + 22);
  ctx.textAlign = 'left';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

/* ---------- 02 process -> destination (SVG) ---------- */
const PROCS = [
  { name: 'Browser', col: C.sky },
  { name: 'Cloud sync', col: C.lavender },
  { name: 'Game launcher', col: C.mint },
  { name: 'Updater', col: C.amber },
];
// documentation-range addresses (RFC 5737): illustrative, never real hosts
const DESTS = ['203.0.113.24:443', '198.51.100.7:443', '192.0.2.15:3478', '203.0.113.90:443', '198.51.100.61:443'];
const LINKS = [
  [0, 0, 2.6], [0, 1, 3.4], [1, 3, 3.0], [2, 2, 2.2], [3, 4, 1.4, true],
];

// Phones get a smaller layout (3 programs, 3 addresses) drawn near 1:1 so the text stays legible.
const FLOW_SM = {
  procs: [0, 1, 3],
  dests: ['203.0.113.24:443', '198.51.100.7:443', '198.51.100.61:443'],
  links: [[0, 0, 2.6], [0, 1, 3.4], [1, 1, 3.0], [2, 2, 1.4, true]],
};

function flowSvg(sm = false) {
  const VW = sm ? 300 : 460, VH = sm ? 205 : 330;
  const pw = sm ? 116 : 150, ph = sm ? 38 : 42, dw = sm ? 136 : 158, dh = sm ? 34 : 36;
  const pad = sm ? 8 : 10;
  const px = pad, dx = VW - dw - pad;
  const procList = sm ? FLOW_SM.procs.map((i) => PROCS[i]) : PROCS;
  const destList = sm ? FLOW_SM.dests : DESTS;
  const links = sm ? FLOW_SM.links : LINKS;
  const py = (i) => (sm ? 34 + i * 68 : 44 + i * 80);
  const dy = (i) => (sm ? 34 + i * 68 : 33 + i * 66);
  const bend = sm ? 18 : 70;
  const dotX = sm ? 16 : 20, textX = sm ? 28 : 34, dTextX = sm ? 11 : 14;
  let paths = '', procs = '', dests = '';
  links.forEach(([p, d, dur, hot], i) => {
    const x1 = px + pw, y1 = py(p), x2 = dx, y2 = dy(d);
    const path = `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
    const col = hot ? C.amber : procList[p].col;
    paths += `
      <path d="${path}" class="ft-flow__base${hot ? ' is-hot' : ''}" pathLength="200"/>
      <path d="${path}" class="ft-flow__pkt" pathLength="200" stroke="${col}" style="animation-duration:${dur}s;animation-delay:-${(i * 0.37).toFixed(2)}s"/>
      <path d="${path}" class="ft-flow__pkt" pathLength="200" stroke="${col}" style="animation-duration:${dur}s;animation-delay:-${(i * 0.37 + dur / 2).toFixed(2)}s"/>`;
  });
  procList.forEach((p, i) => {
    const y = py(i) - ph / 2;
    procs += `
      <g class="ft-flow__proc">
        <rect x="${px}" y="${y}" width="${pw}" height="${ph}" rx="14"/>
        <circle cx="${px + dotX}" cy="${py(i)}" r="4.5" fill="${p.col}"/>
        <text x="${px + textX}" y="${py(i) + 4.5}" class="ft-flow__pn">${p.name}</text>
      </g>`;
  });
  destList.forEach((d, i) => {
    const hot = i === destList.length - 1;
    const y = dy(i) - dh / 2;
    dests += `
      <g class="ft-flow__dest${hot ? ' is-hot' : ''}">
        <rect x="${dx}" y="${y}" width="${dw}" height="${dh}" rx="12"/>
        <text x="${dx + dTextX}" y="${dy(i) + 4}" class="ft-flow__dn">${d}</text>
      </g>`;
  });
  return `<svg class="ft-flow ft-flow--${sm ? 'sm' : 'lg'}" viewBox="0 0 ${VW} ${VH}" aria-hidden="true" focusable="false">
    <g fill="none" stroke-linecap="round">${paths}</g>${procs}${dests}
  </svg>`;
}

/* ---------- 03 channel spectrum ---------- */
const CH = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165];
const SHOW = new Set([36, 52, 100, 116, 132, 149, 165]);
// neighbouring networks: centre (channel index), width in 20 MHz slots, relative signal
const NETS = [
  { c: 1.5, w: 4, h: 0.52 }, { c: 0, w: 1, h: 0.7 }, { c: 0.5, w: 2, h: 0.44 }, { c: 0, w: 1, h: 0.34 },
  { c: 1, w: 1, h: 0.6 }, { c: 0.5, w: 2, h: 0.28 }, { c: 0, w: 1, h: 0.5 }, { c: 2, w: 1, h: 0.4 },
  { c: 5.5, w: 4, h: 0.36 }, { c: 4, w: 1, h: 0.5 }, { c: 9.5, w: 2, h: 0.42 }, { c: 13.5, w: 4, h: 0.24 },
  { c: 21.5, w: 4, h: 0.22 },
];
const FROM = 0, TO = CH.indexOf(149);
const PERIOD = 9;

function chState(t, still) {
  if (still) return { pos: TO, alpha: 1 };
  const p = t % PERIOD;
  if (p < 2.4) return { pos: FROM, alpha: Math.min(1, p / 0.5) };
  if (p < 4.8) return { pos: FROM + (TO - FROM) * easeInOut((p - 2.4) / 2.4), alpha: 1 };
  if (p < 8.4) return { pos: TO, alpha: 1 };
  return { pos: TO, alpha: 1 - (p - 8.4) / 0.6 };
}

function hump(ctx, X, base, top, c, w, h) {
  const steps = 28;
  ctx.beginPath();
  ctx.moveTo(X(c - w / 2), base);
  for (let i = 0; i <= steps; i++) {
    const u = -1 + (2 * i) / steps;
    const y = h * Math.pow(Math.max(0, 1 - u * u), 0.62);
    ctx.lineTo(X(c + (u * w) / 2), base - y * (base - top));
  }
  ctx.lineTo(X(c + w / 2), base);
}

function drawSpectrum(ctx, W, H, t, still) {
  const padL = 14, padR = 14, top = 54, base = H - 40;
  const n = CH.length, slot = (W - padL - padR) / n;
  const X = (i) => padL + (i + 0.5) * slot;
  const { pos, alpha } = chState(t, still);

  // grid
  ctx.strokeStyle = 'rgba(183,169,255,.07)'; ctx.lineWidth = 1;
  for (let k = 1; k <= 3; k++) {
    const y = base - ((base - top) * k) / 3;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }
  // gap between the low and high 5 GHz blocks
  const gx = (X(7) + X(8)) / 2;
  ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(183,169,255,.14)';
  ctx.beginPath(); ctx.moveTo(gx, top - 6); ctx.lineTo(gx, base); ctx.stroke(); ctx.setLineDash([]);

  // neighbours
  for (const nw of NETS) {
    hump(ctx, X, base, top, nw.c, nw.w, nw.h);
    ctx.fillStyle = 'rgba(183,169,255,.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(183,169,255,.42)'; ctx.lineWidth = 1.1; ctx.stroke();
  }

  // ghost of the old position once we have moved away
  if (pos > FROM + 0.5) {
    hump(ctx, X, base, top, FROM, 2, 0.85);
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(158,240,196,.35)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  }

  // your network
  ctx.globalAlpha = clamp(alpha, 0, 1);
  hump(ctx, X, base, top, pos, 2, 0.85);
  const fg = ctx.createLinearGradient(0, top, 0, base);
  fg.addColorStop(0, 'rgba(158,240,196,.34)'); fg.addColorStop(1, 'rgba(158,240,196,.02)');
  ctx.fillStyle = fg; ctx.fill();
  ctx.save(); ctx.shadowColor = 'rgba(158,240,196,.8)'; ctx.shadowBlur = 14;
  ctx.strokeStyle = C.mint; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  const peakY = base - 0.85 * (base - top);
  ctx.font = `600 12px ${UI}`; ctx.textAlign = 'center'; ctx.fillStyle = C.mint;
  ctx.fillText('Your Wi-Fi', clamp(X(pos), 40, W - 40), peakY - 10);
  ctx.globalAlpha = 1;

  // baseline + labels
  ctx.strokeStyle = 'rgba(183,169,255,.3)';
  ctx.beginPath(); ctx.moveTo(padL, base + 0.5); ctx.lineTo(W - padR, base + 0.5); ctx.stroke();
  const near = Math.round(pos);
  ctx.font = `400 ${W < 400 ? 9.5 : 10.5}px ${MONO}`;
  for (let i = 0; i < n; i++) {
    const on = i === near && alpha > 0.5;
    if (!on && (!SHOW.has(CH[i]) || Math.abs(i - near) === 1)) continue;
    ctx.fillStyle = on ? C.mint : C.dim;
    ctx.fillText(String(CH[i]), X(i), base + 18);
  }
  ctx.textAlign = 'left';

  // HUD: networks sharing your channel, computed from the drawing
  let share = 0;
  for (const nw of NETS) if (Math.abs(nw.c - pos) < nw.w / 2 + 0.5) share++;
  ctx.font = `500 11px ${MONO}`; ctx.fillStyle = C.dim;
  ctx.fillText('5 GHz', padL, 24);
  const label = `ch ${CH[near]} · ${share} other network${share === 1 ? '' : 's'}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = share > 2 ? C.amber : C.mint;
  ctx.fillText(label, W - padR, 24);
  ctx.textAlign = 'left';
}

/* ---------- 04 AI watchers ---------- */
const ORBS = [
  { name: 'Claude', col: C.clay, a: 0.42, b: 0.26, tilt: -0.12, sp: 0.32, ph: 0.4 },
  { name: 'ChatGPT', col: C.mint, a: 0.33, b: 0.2, tilt: 0.09, sp: 0.23, ph: 2.6 },
  { name: 'Grok', col: C.sky, a: 0.24, b: 0.15, tilt: 0.2, sp: 0.4, ph: 4.4 },
];
const STARS = Array.from({ length: 46 }, (_, i) => {
  const r = (n) => { const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };
  return [r(1), r(2) * 0.7, 0.5 + r(3) * 1.1, r(4) * TAU];
});

function drawWatchers(ctx, W, H, t) {
  const cx = W / 2, cy = H * 0.5;
  const k = clamp(W / 520, 0.62, 1.1);
  const half = W / 2 - 54;

  for (const s of STARS) {
    ctx.globalAlpha = 0.18 + 0.4 * (0.5 + 0.5 * Math.sin(t * 1.3 + s[3]));
    ctx.fillStyle = '#E9E5FF';
    ctx.fillRect(s[0] * W, s[1] * H, s[2], s[2]);
  }
  ctx.globalAlpha = 1;

  let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.55);
  g.addColorStop(0, 'rgba(124,108,255,.20)'); g.addColorStop(1, 'rgba(124,108,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // which orb is "reviewing" right now
  const cycle = 3.4, idx = Math.floor(t / cycle) % ORBS.length, ph = (t % cycle) / cycle;

  const pos = ORBS.map((o, i) => {
    const A = Math.min(o.a * W, half), B = o.b * H;
    const an = o.ph + t * o.sp;
    const ex = A * Math.cos(an), ey = B * Math.sin(an);
    return {
      o, i,
      x: cx + ex * Math.cos(o.tilt) - ey * Math.sin(o.tilt),
      y: cy + ex * Math.sin(o.tilt) + ey * Math.cos(o.tilt),
      front: Math.sin(an) > 0,
      depth: 0.74 + 0.26 * Math.sin(an),
      A, B,
    };
  });

  ctx.lineWidth = 1;
  for (const p of pos) {
    ctx.strokeStyle = 'rgba(183,169,255,.10)';
    ctx.beginPath(); ctx.ellipse(cx, cy, p.A, p.B, p.o.tilt, 0, TAU); ctx.stroke();
  }

  const beam = (p) => {
    if (p.i !== idx) return;
    const a = Math.sin(Math.PI * clamp(ph * 1.25, 0, 1));
    if (a <= 0.01) return;
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = rgba(p.o.col, 0.55 * a); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(cx, cy - 6 * k); ctx.stroke();
    ctx.setLineDash([]);
    const q = clamp(ph * 1.25, 0, 1);
    const bx = p.x + (cx - p.x) * q, by = p.y + (cy - 6 * k - p.y) * q;
    ctx.fillStyle = rgba(p.o.col, a);
    ctx.beginPath(); ctx.arc(bx, by, 2.4, 0, TAU); ctx.fill();
  };

  const orb = (p) => {
    const o = p.o, sc = p.depth * Math.max(k, 0.8);
    const flare = p.i === idx ? Math.sin(Math.PI * clamp(ph * 1.25, 0, 1)) : 0;
    const rad = (5.5 + 2.5 * flare) * sc, glow = (20 + 26 * flare) * sc;
    const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
    gg.addColorStop(0, rgba(o.col, 0.55 + 0.35 * flare)); gg.addColorStop(1, rgba(o.col, 0));
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, glow, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, rad * 0.6, 0, TAU); ctx.fill();
    ctx.font = `600 ${Math.round(12 * Math.max(k, 0.9))}px ${UI}`;
    ctx.fillStyle = rgba(C.text, 0.5 + 0.5 * p.depth);
    let tx = p.x + rad + 9; ctx.textAlign = 'left';
    if (tx + ctx.measureText(o.name).width > W - 8) { ctx.textAlign = 'right'; tx = p.x - rad - 9; }
    ctx.fillText(o.name, tx, p.y + 4);
    ctx.textAlign = 'left';
  };

  for (const p of pos) if (!p.front) { beam(p); orb(p); }

  // router
  const rw = 92 * k, rh = 17 * k, rx = cx - rw / 2, ry = cy - rh / 2 + 4 * k;
  g = ctx.createRadialGradient(cx, ry + rh, 0, cx, ry + rh, 110 * k);
  g.addColorStop(0, 'rgba(183,169,255,.32)'); g.addColorStop(1, 'rgba(183,169,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, ry + rh, 110 * k, 26 * k, 0, 0, TAU); ctx.fill();
  for (const sx of [-1, 1]) {
    const ax = cx + sx * (rw / 2 - 12 * k), ay = ry, L = 34 * k, ang = -Math.PI / 2 + sx * 0.22;
    ctx.lineCap = 'round'; ctx.strokeStyle = '#1B1638'; ctx.lineWidth = 4.5 * k;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + Math.cos(ang) * L, ay + Math.sin(ang) * L); ctx.stroke();
    ctx.strokeStyle = 'rgba(183,169,255,.75)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + Math.cos(ang) * L, ay + Math.sin(ang) * L); ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.save(); ctx.shadowColor = 'rgba(150,130,255,.8)'; ctx.shadowBlur = 18 * k;
  roundRect(ctx, rx, ry, rw, rh, 6 * k);
  const fg = ctx.createLinearGradient(0, ry, 0, ry + rh);
  fg.addColorStop(0, '#1C1745'); fg.addColorStop(1, '#0B0919');
  ctx.fillStyle = fg; ctx.fill(); ctx.restore();
  roundRect(ctx, rx, ry, rw, rh, 6 * k);
  ctx.strokeStyle = 'rgba(206,198,255,.8)'; ctx.lineWidth = 1.1; ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const on = 0.5 + 0.5 * Math.max(0, Math.sin(t * (5 + i) + i * 1.9));
    ctx.fillStyle = rgba(i === 3 ? C.sky : C.mint, i > 1 ? on : 1);
    ctx.beginPath(); ctx.arc(rx + 14 * k + i * 9 * k, ry + rh / 2, 1.6 * k + 0.3, 0, TAU); ctx.fill();
  }
  const sg = ctx.createLinearGradient(rx, 0, rx + rw, 0);
  sg.addColorStop(0, 'rgba(143,211,255,0)'); sg.addColorStop(0.5, 'rgba(143,211,255,.9)'); sg.addColorStop(1, 'rgba(143,211,255,0)');
  ctx.fillStyle = sg; ctx.fillRect(rx + 8 * k, ry + rh - 4 * k, rw - 16 * k, 1.3);

  for (const p of pos) if (p.front) { beam(p); orb(p); }
}

/* ---------- copy ---------- */
const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const KEY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16.5 6.5l2.5 2.5M14 9l2 2"/></svg>';

const ROWS = [
  {
    id: 'backdoors',
    kicker: '01 · Backdoors',
    title: 'Close the backdoors',
    body:
      'One scan checks your router from the inside for the ways in that are usually left open: provider remote management (TR-069 on port 7547), UPnP port-forwards, Telnet, a plain-HTTP admin page and unencrypted DNS. Each finding comes with the evidence Bastion saw and the exact steps to close it.',
    points: [
      'Never logs in to the router and never tries a password',
      'Guided fixes: the steps, plus a button that opens the right settings page',
      'Says “unknown” when it can’t measure something, instead of guessing',
    ],
    vis: 'exposure',
    label: 'Illustration: a polar map around your router with a sweep passing over open ports 7547 (TR-069), 23 (Telnet), 1900 (UPnP) and 80 (plain-HTTP admin). Plain-text DNS is a separate check, not a port.',
    caption: 'Illustration · exposure map',
  },
  {
    id: 'traffic',
    kicker: '02 · Connections',
    title: 'See which apps talk to the internet',
    body:
      'A live view of this computer’s connections: which program is talking to which address and port, right now. It is the quickest way to spot the updater that never sleeps or the app that calls home more often than you expected.',
    points: [
      'Per program, live, on this computer',
      'Nothing to install on your router',
      'Phones, TVs and other devices need router integration, which is on the roadmap',
    ],
    vis: 'flow',
    label: 'Illustration: four programs on this computer, Browser, Cloud sync, Game launcher and Updater, with lines to the addresses they connect to. The Updater line is highlighted.',
    caption: 'Illustration · example addresses',
  },
  {
    id: 'wifi',
    kicker: '03 · Wi-Fi',
    title: 'Faster Wi-Fi on the same router',
    body:
      'Bastion surveys the networks around you, shows how crowded each channel is and recommends a quieter one, with the count of networks behind the advice. Then a real speed test, with ping, jitter, download and upload, so you can compare before and after.',
    points: [
      'Channel advice from the networks your computer can actually hear',
      'Speed test against Cloudflare, only when you press Run',
      'No new hardware, no extender, no subscription',
    ],
    vis: 'spectrum',
    label: 'Illustration: a 5 GHz channel chart. Your network, in mint, moves from crowded channel 36 to quiet channel 149.',
    caption: 'Illustration · 5 GHz channels',
  },
  {
    id: 'agents',
    kicker: '04 · AI watchers',
    title: 'AI watchers, with your own key',
    body:
      'Connect Claude, ChatGPT or Grok with your own API key. They read a snapshot of your scan and answer plain questions like “is anything here dangerous?” or “why is my Wi-Fi slow in the evening?”, then suggest fixes. Nothing changes unless you make the change.',
    points: [
      'Bring your own key from Anthropic, OpenAI or xAI',
      'MAC addresses, device and Wi-Fi names are removed before anything is sent',
      'Agents can’t change anything on your computer or router',
    ],
    vis: 'watchers',
    label: 'Illustration: three AI watchers, Claude, ChatGPT and Grok, circling a router and taking turns to review it.',
    caption: 'Illustration · three watchers',
  },
];

function visual(row) {
  const inner =
    row.vis === 'flow'
      ? flowSvg() + flowSvg(true)
      : `<canvas class="ft-canvas" aria-hidden="true"></canvas>${
          row.vis === 'watchers' ? `<span class="ft-key">${KEY}Bring your own key</span>` : ''
        }`;
  return `
    <figure class="ft-vis ft-vis--${row.vis} glass" data-vis="${row.vis}" role="img" aria-label="${row.label}">
      <div class="ft-stage">${inner}</div>
      <figcaption class="ft-cap mono" aria-hidden="true">${row.caption}</figcaption>
    </figure>`;
}

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'features-title');

  const rows = ROWS.map(
    (r, i) => `
      <article class="ft-row${i % 2 ? ' ft-row--flip' : ''}" id="feature-${r.id}" aria-labelledby="ft-${r.id}-t">
        <div class="ft-copy" data-reveal>
          <p class="ft-kicker mono">${r.kicker}</p>
          <h3 class="display-m ft-title" id="ft-${r.id}-t">${r.title}</h3>
          <p class="ft-body">${r.body}</p>
          <ul class="ft-points" role="list">
            ${r.points.map((p) => `<li>${CHECK}<span>${p}</span></li>`).join('')}
          </ul>
        </div>
        <div class="ft-media" data-reveal="scale" style="--reveal-delay:.08s">${visual(r)}</div>
      </article>`,
  ).join('');

  el.innerHTML = `
    <div class="container">
      <header class="sec-head ft-head" data-reveal>
        <p class="eyebrow">What Bastion does</p>
        <h2 class="display-l" id="features-title">Four jobs, done on your computer</h2>
        <p class="lead">Each one runs locally, explains what it found in plain language, and leaves every decision to you.</p>
      </header>
      <div class="ft-rows">${rows}
      </div>
    </div>`;

  const DRAW = {
    exposure: [drawExposure, (BLIPS[0].deg * Math.PI) / 180 / SWEEP_SPEED + 0.25],
    spectrum: [drawSpectrum, 0],
    watchers: [drawWatchers, 1.4],
  };
  el.querySelectorAll('.ft-vis').forEach((fig) => {
    const kind = fig.dataset.vis;
    if (DRAW[kind]) {
      liveCanvas(fig, fig.querySelector('canvas'), DRAW[kind][0], DRAW[kind][1]);
    } else {
      // SVG flow: CSS animations, paused while off-screen
      if ('IntersectionObserver' in window) {
        new IntersectionObserver((es) => {
          for (const e of es) fig.classList.toggle('is-live', e.isIntersecting && !RM.matches);
        }, { rootMargin: '80px 0px' }).observe(fig);
      }
    }
  });

  reveal(el);
}
