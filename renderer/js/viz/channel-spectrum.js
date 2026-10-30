// Channel spectrum: the real Wi-Fi survey drawn as a luminous spectrum landscape over the channel
// axis of one band. Every heard network is a soft plateau centred on the span it really occupies
// (its width when reported, else 20 MHz) with a height set by its signal. Neighbours are painted
// into one offscreen light layer (so a crowded band saturates to lavender instead of blowing out
// to white), composited once with a soft bloom; only the strongest few crests carry a hairline.
// The user's own network is a mint ridge with a crisp top line and a floor reflection; the
// router's other radios are a quieter mint outline. The recommended channel is a lavender slot
// with a "move here" arc. Hover or arrow keys show a precise cursor and a glass tooltip.
//
// Canvas 2D, DPR-aware (capped at 2), paused while offscreen or hidden; the intro waits until the
// card is actually on screen. Once settled the landscape is cached, so the travelling light on the
// arc only blits. Reduced motion draws the final frame only. Nothing here invents data: every
// curve comes from the survey the view passes.

const TAU = Math.PI * 2;
const FONT_U = '"Plus Jakarta Sans", system-ui, "Segoe UI", sans-serif';
const FONT_M = '"JetBrains Mono", ui-monospace, Consolas, monospace';
const BLOCKS_5 = {
  40: [36, 44, 52, 60, 100, 108, 116, 124, 132, 140, 149, 157, 165, 173],
  80: [36, 52, 100, 116, 132, 149, 165],
  160: [36, 100, 149],
};
const DFS_5 = [50, 146]; // channel units covering 52..144
// Top padding: room for the recommendation chip and arc only when they are drawn.
const PAD = { l: 52, r: 20, t: 46, tRec: 112, b: 46 };
const BREAK_PX = 26;
const RISE_MS = 1100;
const STAGGER_MS = 55;
const ARC_LOOP_MS = 2800;
const ARC_PASSES = 3; // the travelling light runs a few times, then the page goes still
const HAIRLINES = 4; // only the strongest neighbour crests get a top line

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function rgb(c) {
  let h = String(c || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (!/^#[0-9a-f]{6}$/i.test(h)) return [183, 169, 255];
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function rgba(c, a) {
  const [r, g, b] = rgb(c);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
}

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const t = (n, f) => cs.getPropertyValue(n).trim() || f;
  return {
    text: t('--text', '#F3F0FF'), muted: t('--muted', '#ABA6CB'), dim: t('--dim', '#857FA9'),
    violet: t('--violet', '#7C6CFF'), lavender: t('--lavender', '#B7A9FF'), sky: t('--sky', '#8FD3FF'),
    mint: t('--mint', '#9EF0C4'), coral: t('--coral', '#FF8E7A'), amber: t('--amber', '#FFC772'),
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

// Damped spring step response (slight overshoot, settles by ~1 s).
function spring(ms) {
  if (ms <= 0) return 0;
  const t = ms / 1000;
  const z = 0.58;
  const w = 10.5;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}

// Plateau with soft shoulders, like a Wi-Fi spectral mask (d = distance / half width).
const profile = (d) => Math.exp(-Math.pow(d / 0.96, 4));
// Wide, faint skirt drawn under each curve: the soft light a real emitter spills around itself.
const halo = (d) => Math.exp(-Math.pow(d / 1.3, 2));

export function channelFreq(band, ch) {
  if (band === '2.4') return ch === 14 ? 2484 : 2407 + 5 * ch;
  if (band === '6') return 5950 + 5 * ch;
  return 5000 + 5 * ch;
}

// Span a transmission occupies, in channel units (one unit = 5 MHz).
export function channelSpan(band, ch, widthMHz) {
  const w = [20, 40, 80, 160].includes(widthMHz) ? widthMHz : 20;
  if (band === '2.4') {
    if (w >= 40) { const c = ch <= 7 ? ch + 2 : ch - 2; return { lo: c - 4, hi: c + 4, c, w: 40 }; }
    return { lo: ch - 2.2, hi: ch + 2.2, c: ch, w: 20 };
  }
  if (w > 20) {
    const units = w / 5;
    let s = null;
    if (band === '5') s = (BLOCKS_5[w] || []).find((b) => ch >= b && ch <= b + units - 4);
    else if (band === '6') s = 1 + Math.floor((ch - 1) / units) * units;
    if (s != null) { const lo = s - 2; const hi = s + units - 2; return { lo, hi, c: (lo + hi) / 2, w }; }
  }
  return { lo: ch - 2, hi: ch + 2, c: ch, w: 20 };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// data = { band, channels: number[], networks: [{ ssid, bssid, channel, widthMHz, signalPct, own }],
//          current: number|null, currentWidth: number|null, recommended: number|null,
//          link: { ssid, bssid }|null (the connected network), ownFallback, summary }
export function createChannelSpectrum(host, opts = {}) {
  const RM = opts.reducedMotion != null ? !!opts.reducedMotion : window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  host.classList.add('cs');
  host.tabIndex = 0;
  host.setAttribute('role', 'group');
  host.setAttribute('aria-roledescription', 'spectrum chart');
  host.innerHTML = '<canvas class="cs-canvas" aria-hidden="true"></canvas><div class="cs-tip" aria-hidden="true" hidden></div><p class="cs-sr" aria-live="polite"></p>';
  const canvas = host.querySelector('canvas');
  const tip = host.querySelector('.cs-tip');
  const sr = host.querySelector('.cs-sr');
  const ctx = canvas.getContext('2d');
  // Offscreen layers: the neighbours' light, and the settled frame (so the arc light only blits).
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  const cache = document.createElement('canvas');
  const cctx = cache.getContext('2d');

  let pal = readPalette();
  let W = 0;
  let H = 0;
  let dpr = 1;
  let data = null;
  let model = null; // derived geometry + curves
  let t0 = 0;
  let introPending = false;
  let raf = 0;
  // Unknown until the IntersectionObserver reports: the intro must not start below the fold.
  let onScreen = typeof IntersectionObserver !== 'function';
  let alive = true;
  let hover = -1; // index into model.chs
  let hoverByKey = false;
  let cacheOk = false;
  let dirty = true;
  let labelBoxes = []; // label rectangles from the last frame, for tooltip placement

  // ---------- model ----------
  const heightOf = (sig, dflt) => 0.1 + 0.9 * Math.pow(clamp01((sig != null ? sig : dflt) / 100), 1.1);

  function build() {
    if (!data || !W) { model = null; return; }
    const band = data.band;
    const chs = [...new Set((data.channels || []).filter((c) => Number.isFinite(c)))].sort((a, b) => a - b);
    if (!chs.length) { model = null; return; }
    const cur = num(data.current);
    const link = data.link || {};
    const nets = [];
    for (const n of data.networks || []) {
      const ch = Number(n.channel);
      if (!Number.isFinite(ch)) continue;
      const sig = num(n.signalPct);
      nets.push({ ssid: n.ssid || '', bssid: n.bssid || '', ch, rawWidth: num(n.widthMHz), sig, h: heightOf(sig, 45), own: !!n.own, main: false, dup: false, radio: false });
    }
    // The ridge is the radio this computer is actually joined to: its BSSID, else its SSID, else the
    // strongest of the user's entries on the current channel. Other own entries on that channel
    // (hidden or duplicate BSSes of the same router) are not drawn twice.
    let ownMain = null;
    if (cur != null) {
      const here = nets.filter((n) => n.own && n.ch === cur);
      ownMain = (link.bssid && here.find((n) => n.bssid && n.bssid.toLowerCase() === String(link.bssid).toLowerCase()))
        || (link.ssid && here.find((n) => n.ssid === link.ssid))
        || here.slice().sort((a, b) => (b.sig || 0) - (a.sig || 0))[0] || null;
      for (const n of here) if (n !== ownMain) n.dup = true;
    }
    if (ownMain) {
      ownMain.main = true;
      if (!ownMain.ssid && link.ssid) ownMain.label = link.ssid;
    }
    // The connected network missing from the scan (some adapters omit it): draw it from link info.
    if (!ownMain && cur != null && data.ownFallback) {
      const sig = num(data.ownFallback.signalPct);
      ownMain = { ssid: data.ownFallback.ssid || '', bssid: '', ch: cur, rawWidth: null, sig, h: heightOf(sig, 60), own: true, main: true, dup: false, radio: false };
      nets.push(ownMain);
    }
    // The router's other radios on this band (own, but not the one this computer is joined to): one
    // outline per channel, named by the entry that carries the network's name.
    const radioBy = new Map();
    for (const n of nets) {
      if (!n.own || n.main || n.dup) continue;
      const best = radioBy.get(n.ch);
      const score = (m) => (link.ssid && m.ssid === link.ssid ? 2 : 0) + (m.ssid ? 1 : 0) + (m.sig || 0) / 1000;
      if (!best || score(n) > score(best)) { if (best) best.dup = true; radioBy.set(n.ch, n); } else n.dup = true;
    }
    for (const n of radioBy.values()) { n.radio = true; if (!n.ssid && link.ssid) n.label = link.ssid; }
    for (const n of nets) {
      const width = n.rawWidth != null ? n.rawWidth : n.main && num(data.currentWidth) != null ? data.currentWidth : null;
      n.span = channelSpan(band, n.ch, width);
      n.width = n.span.w;
      n.widthKnown = width != null;
    }
    // Strength rank among neighbours: the strongest few crests get a hairline, the rest read as haze.
    nets.filter((n) => !n.own).sort((a, b) => (b.sig || 0) - (a.sig || 0)).forEach((n, i) => { n.rank = i; });
    // Axis segments: contiguous channel runs; long frequency gaps are folded into a break mark.
    const ivs = chs.map((c) => [c - 3, c + 3]);
    for (const n of nets) ivs.push([n.span.lo - 0.6, n.span.hi + 0.6]);
    ivs.sort((a, b) => a[0] - b[0]);
    const segs = [];
    for (const [lo, hi] of ivs) {
      const last = segs[segs.length - 1];
      if (last && lo - last.hi <= 12) last.hi = Math.max(last.hi, hi);
      else segs.push({ lo, hi });
    }
    const plotL = PAD.l;
    const plotR = W - PAD.r;
    const totalU = segs.reduce((a, s) => a + (s.hi - s.lo), 0);
    const k = Math.max(0.5, (plotR - plotL - BREAK_PX * (segs.length - 1)) / totalU);
    let x = plotL;
    for (const s of segs) { s.x0 = x; s.x1 = x + (s.hi - s.lo) * k; x = s.x1 + BREAK_PX; }
    const xOf = (u) => {
      for (const s of segs) if (u <= s.hi) return s.x0 + (Math.max(u, s.lo) - s.lo) * k;
      const s = segs[segs.length - 1];
      return s.x1;
    };
    const rec = num(data.recommended);
    const recSpan = rec != null ? channelSpan(band, rec, num(data.currentWidth)) : null;
    const top = rec != null && rec !== cur ? PAD.tRec : PAD.t;
    const base = H - PAD.b;
    // Stagger left to right; the user's ridge rises last so the eye lands on it.
    const order = nets.filter((n) => !n.dup).sort((a, b) => (a.main - b.main) || (a.span.c - b.span.c));
    order.forEach((n, i) => { n.delay = 140 + i * STAGGER_MS; });
    for (const n of nets) if (n.dup) n.delay = ownMain ? ownMain.delay : 140;
    const lastDelay = order.length ? order[order.length - 1].delay : 140;
    // Per-channel neighbour counts by primary channel (what the peaks show).
    const prim = new Map();
    for (const n of nets) if (!n.own) prim.set(n.ch, (prim.get(n.ch) || 0) + 1);
    model = {
      band, chs, nets, ownMain, segs, k, xOf, top, base, plotL, plotR, rec, recSpan, prim, cur,
      slotAt: lastDelay + 520, arcAt: lastDelay + 820, introEnd: lastDelay + RISE_MS + 900,
      lightEnd: lastDelay + 820 + 700 + ARC_PASSES * ARC_LOOP_MS,
    };
  }

  const heightPx = () => (model ? model.base - model.top : 0);

  function riseOf(n, t) {
    if (t == null) return 1;
    return spring(t - n.delay);
  }

  function envelopeAt(u, t, includeOwn) {
    let m = 0;
    for (const n of model.nets) {
      if (n.dup || (n.own && !includeOwn)) continue;
      const half = (n.span.hi - n.span.lo) / 2;
      const v = n.h * profile(Math.abs(u - n.span.c) / half) * Math.max(0, riseOf(n, t));
      if (v > m) m = v;
    }
    return m * heightPx();
  }

  // ---------- drawing ----------
  function curvePath(n, rise, mirror, shape = profile, reach = 1.6, c = ctx) {
    const { xOf, k, base } = model;
    const half = (n.span.hi - n.span.lo) / 2;
    const xc = xOf(n.span.c);
    const halfPx = half * k;
    const amp = n.h * heightPx() * rise * (mirror ? -0.32 : 1);
    const x0 = xc - halfPx * reach;
    const x1 = xc + halfPx * reach;
    c.beginPath();
    c.moveTo(x0, base);
    for (let x = x0; x <= x1 + 0.01; x += 1.5) {
      c.lineTo(x, base - amp * shape(Math.abs(x - xc) / halfPx));
    }
    c.lineTo(x1, base);
    return { xc, amp, x0, x1, halfPx };
  }

  function topLine(n, rise, c = ctx) {
    const { xOf, k, base } = model;
    const half = (n.span.hi - n.span.lo) / 2;
    const xc = xOf(n.span.c);
    const halfPx = half * k;
    const amp = n.h * heightPx() * rise;
    c.beginPath();
    let first = true;
    for (let x = xc - halfPx * 1.45; x <= xc + halfPx * 1.45 + 0.01; x += 1.5) {
      const y = base - amp * profile(Math.abs(x - xc) / halfPx);
      if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y);
    }
    return { xc, halfPx, amp };
  }

  // The landscape has settled (intro over), so a cached frame of it stays valid.
  const settled = (now) => RM || (!introPending && !!model && now - t0 >= model.introEnd);

  function draw(now) {
    dirty = false;
    cacheOk = false;
    if (!alive || !W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    labelBoxes = [];
    if (!model) return;
    drawScene(now);
    if (settled(now)) {
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.clearRect(0, 0, cache.width, cache.height);
      cctx.drawImage(canvas, 0, 0);
      cacheOk = true;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLight(now);
  }

  // A settled frame: the cached landscape plus the travelling light.
  function blit(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cache, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLight(now);
  }

  function drawScene(now) {
    const { segs, xOf, top, base, plotL, plotR, chs, nets, ownMain, rec, recSpan, band, prim, cur } = model;
    // Reduced motion: the final frame. Waiting for the card to scroll into view: the empty first frame.
    const t = RM ? null : introPending ? 0 : now - t0;
    const tt = t == null ? 1e9 : t;
    const ph = base - top;
    const axisA = easeOut(tt / 500);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    model.arc = null;
    model.ownRidge = null;

    // floor wash: a faint violet light pooled on the baseline
    const wash = ctx.createLinearGradient(0, top, 0, base);
    wash.addColorStop(0, rgba(pal.violet, 0));
    wash.addColorStop(1, rgba(pal.violet, 0.07 * axisA));
    ctx.fillStyle = wash;
    for (const s of segs) ctx.fillRect(s.x0, top - 10, s.x1 - s.x0, ph + 10);

    // signal guides at 50% and 100%
    ctx.save();
    ctx.globalAlpha = axisA;
    ctx.setLineDash([1, 4]);
    ctx.lineWidth = 1;
    ctx.font = '500 9.5px ' + FONT_M;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const [f, lbl] of [[1, '100%'], [0.5, '50%']]) {
      const y = Math.round(base - ph * f) + 0.5;
      ctx.strokeStyle = rgba(pal.lavender, 0.09);
      for (const s of segs) { ctx.beginPath(); ctx.moveTo(s.x0, y); ctx.lineTo(s.x1, y); ctx.stroke(); }
      ctx.fillStyle = rgba(pal.dim, 0.85);
      ctx.fillText(lbl, plotL - 12, y);
    }
    ctx.setLineDash([]);
    // channel columns: fine points rising from the floor, brightest at the floor. They give empty
    // stretches (unused channels, the DFS range) a quiet, precise texture instead of dead space.
    for (const c of chs) {
      const x = Math.round(xOf(c));
      for (let y = base - 7; y > top - 2; y -= 9) {
        const f = 1 - (base - y) / ph;
        ctx.fillStyle = rgba(pal.lavender, 0.02 + 0.15 * f * f);
        ctx.fillRect(x - 0.6, Math.round(y) - 0.6, 1.2, 1.2);
      }
    }
    ctx.restore();

    // DFS range (5 GHz): faint shaded column, its caption inside the column, a bracket under the labels
    let dfsLabel = null;
    if (band === '5') {
      ctx.save();
      ctx.globalAlpha = axisA;
      const parts = segs.map((s) => [Math.max(s.lo, DFS_5[0]), Math.min(s.hi, DFS_5[1])]).filter(([a, b]) => b > a);
      const widest = parts.reduce((m, q) => (xOf(q[1]) - xOf(q[0]) > xOf(m[1]) - xOf(m[0]) ? q : m), parts[0] || [0, 0]);
      for (const s of segs) {
        const lo = Math.max(s.lo, DFS_5[0]);
        const hi = Math.min(s.hi, DFS_5[1]);
        if (hi <= lo) continue;
        const xa = xOf(lo);
        const xb = xOf(hi);
        const g = ctx.createLinearGradient(0, top - 26, 0, base);
        g.addColorStop(0, rgba(pal.amber, 0.045));
        g.addColorStop(0.12, rgba(pal.amber, 0.018));
        g.addColorStop(1, rgba(pal.amber, 0.04));
        ctx.fillStyle = g;
        ctx.fillRect(xa, top - 26, xb - xa, base - top + 26);
        ctx.fillStyle = rgba(pal.amber, 0.28);
        ctx.fillRect(xa, top - 26, xb - xa, 1);
        const by = base + 32.5;
        ctx.strokeStyle = rgba(pal.amber, 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xa + 0.5, by - 4); ctx.lineTo(xa + 0.5, by); ctx.lineTo(xb - 0.5, by); ctx.lineTo(xb - 0.5, by - 4);
        ctx.stroke();
        if (lo === widest[0] && xb - xa > 150) dfsLabel = { x: (xa + xb) / 2, y: top - 10 };
      }
      ctx.restore();
    }

    // recommended slot (behind the curves)
    const slotA = rec != null && rec !== cur ? easeOut((tt - model.slotAt) / 600) : 0;
    let slot = null;
    if (slotA > 0 && recSpan) {
      const xa = xOf(recSpan.lo + 0.35);
      const xb = xOf(recSpan.hi - 0.35);
      const yTop = top - 6;
      slot = { xa, xb, xm: (xa + xb) / 2, yTop };
      ctx.save();
      ctx.globalAlpha = slotA;
      const g = ctx.createLinearGradient(0, yTop, 0, base);
      g.addColorStop(0, rgba(pal.lavender, 0.02));
      g.addColorStop(0.7, rgba(pal.lavender, 0.08));
      g.addColorStop(1, rgba(pal.lavender, 0.2));
      ctx.fillStyle = g;
      roundRect(ctx, xa, yTop, xb - xa, base - yTop, 10);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.lavender, 0.38);
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      roundRect(ctx, xa + 0.5, yTop + 0.5, xb - xa - 1, base - yTop, 10);
      ctx.stroke();
      ctx.setLineDash([]);
      // glowing floor of the slot
      ctx.shadowColor = rgba(pal.lavender, 0.9);
      ctx.shadowBlur = 14;
      ctx.strokeStyle = rgba(pal.lavender, 0.95);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(xa + 4, base); ctx.lineTo(xb - 4, base); ctx.stroke();
      ctx.restore();
    }

    // curves and their light stay inside the plotted channel ranges
    ctx.save();
    ctx.beginPath();
    for (const s of segs) ctx.rect(s.x0 - 2, 0, s.x1 - s.x0 + 4, base + 26);
    ctx.clip();

    // Neighbours: painted weakest first into one offscreen light layer with normal blending, so a
    // crowded band saturates to lavender instead of summing to white. Strong networks read as
    // lit glass, weak ones as haze. The layer is composited once over a soft bloom of itself.
    const neigh = nets.filter((n) => !n.own).sort((a, b) => (a.sig || 0) - (b.sig || 0));
    const fadeOf = (n) => clamp01((tt - n.delay) / 260);
    const emph = (n) => (n.rank < HAIRLINES ? 1 - n.rank * 0.12 : 0.3);
    let lit = false;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const n of neigh) {
      const r = riseOf(n, t);
      if (r <= 0.001) continue;
      lit = true;
      const fade = fadeOf(n);
      const e = emph(n);
      // halo: a low, wide spill of light around the emitter
      const { amp } = curvePath(n, r * 0.9, false, halo, 2.6, lctx);
      const hg = lctx.createLinearGradient(0, base - Math.max(8, amp), 0, base);
      hg.addColorStop(0, rgba(pal.violet, 0));
      hg.addColorStop(1, rgba(pal.violet, (0.05 + 0.08 * e) * fade));
      lctx.fillStyle = hg;
      lctx.fill();
      // body: brightest just under the crest, fading into the floor
      curvePath(n, r, false, profile, 1.6, lctx);
      const g = lctx.createLinearGradient(0, base - Math.max(8, amp / 0.9), 0, base);
      g.addColorStop(0, rgba(pal.lavender, (0.12 + 0.24 * e) * fade));
      g.addColorStop(0.2, rgba(pal.lavender, (0.08 + 0.14 * e) * fade));
      g.addColorStop(0.65, rgba(pal.violet, (0.04 + 0.07 * e) * fade));
      g.addColorStop(1, rgba(pal.violet, 0.02 * fade));
      lctx.fillStyle = g;
      lctx.fill();
    }
    if (lit) {
      // soft ends: light fades out where a plotted channel range stops, instead of a hard cut
      lctx.save();
      lctx.globalCompositeOperation = 'destination-out';
      for (const s of segs) {
        for (const [xa, xb] of [[s.x0 - 2, s.x0 + 22], [s.x1 + 2, s.x1 - 22]]) {
          const g = lctx.createLinearGradient(xa, 0, xb, 0);
          g.addColorStop(0, 'rgba(0,0,0,1)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          lctx.fillStyle = g;
          lctx.fillRect(Math.min(xa, xb), 0, Math.abs(xb - xa), base + 30);
        }
      }
      lctx.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if ('filter' in ctx) {
        ctx.filter = 'blur(' + Math.round(14 * dpr) + 'px)';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.7;
        ctx.drawImage(layer, 0, 0);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
      // hairlines on the strongest crests only: bright at the crest, gone by the shoulders
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      for (const n of neigh) {
        if (n.rank >= HAIRLINES) continue;
        const r = riseOf(n, t);
        if (r <= 0.001) continue;
        const a = (0.7 - n.rank * 0.12) * fadeOf(n);
        const { xc, halfPx } = topLine(n, r);
        const lg = ctx.createLinearGradient(xc - halfPx * 1.45, 0, xc + halfPx * 1.45, 0);
        lg.addColorStop(0, rgba(pal.lavender, 0));
        lg.addColorStop(0.28, rgba(pal.lavender, a));
        lg.addColorStop(0.72, rgba(pal.lavender, a));
        lg.addColorStop(1, rgba(pal.lavender, 0));
        ctx.strokeStyle = lg;
        ctx.stroke();
      }
    }

    // the router's other radios on this band: a quiet mint outline, not the lit ridge
    for (const n of nets) {
      if (!n.radio) continue;
      const r = riseOf(n, t);
      if (r <= 0.001) continue;
      const fade = fadeOf(n);
      const { amp } = curvePath(n, r, false);
      const g = ctx.createLinearGradient(0, base - Math.max(8, amp), 0, base);
      g.addColorStop(0, rgba(pal.mint, 0.1 * fade));
      g.addColorStop(1, rgba(pal.mint, 0.015 * fade));
      ctx.fillStyle = g;
      ctx.fill();
      topLine(n, r);
      ctx.setLineDash([3, 4]);
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(pal.mint, 0.62 * fade);
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // the user's own ridge: soft body, bloom, crisp top line, reflection
    let ownTop = null;
    if (ownMain) {
      const r = riseOf(ownMain, t);
      const fade = fadeOf(ownMain);
      if (r > 0.001) {
        const xc = xOf(ownMain.span.c);
        const amp = ownMain.h * ph * r;
        const halfPx = ((ownMain.span.hi - ownMain.span.lo) / 2) * model.k;
        ownTop = { x: xc, y: base - amp };
        model.ownRidge = { x0: xc - halfPx * 1.05, x1: xc + halfPx * 1.05, y0: base - amp - 4, y1: base };
        // pooled light on the floor
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // an elliptical pool of light on the floor (no hard edges: the shape ends where the gradient does)
        const R = halfPx * 2.8;
        ctx.save();
        ctx.translate(xc, base);
        ctx.scale(1, 0.32);
        const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        pool.addColorStop(0, rgba(pal.mint, 0.2 * fade));
        pool.addColorStop(0.5, rgba(pal.mint, 0.06 * fade));
        pool.addColorStop(1, rgba(pal.mint, 0));
        ctx.fillStyle = pool;
        ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
        ctx.restore();
        // halo, then body
        curvePath(ownMain, r * 0.92, false, halo, 2.6);
        const hg = ctx.createLinearGradient(0, base - amp, 0, base);
        hg.addColorStop(0, rgba(pal.mint, 0));
        hg.addColorStop(1, rgba(pal.mint, 0.1 * fade));
        ctx.fillStyle = hg;
        ctx.fill();
        curvePath(ownMain, r, false);
        const g = ctx.createLinearGradient(0, base - amp, 0, base);
        g.addColorStop(0, rgba(pal.mint, 0.46 * fade));
        g.addColorStop(0.2, rgba(pal.mint, 0.26 * fade));
        g.addColorStop(0.65, rgba(pal.mint, 0.1 * fade));
        g.addColorStop(1, rgba(pal.mint, 0.04 * fade));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
        // reflection under the baseline
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, base, W, 26);
        ctx.clip();
        curvePath(ownMain, r, true);
        const rg = ctx.createLinearGradient(0, base, 0, base + 24);
        rg.addColorStop(0, rgba(pal.mint, 0.2 * fade));
        rg.addColorStop(1, rgba(pal.mint, 0));
        ctx.fillStyle = rg;
        ctx.fill();
        ctx.restore();
        // bloom + crisp top line
        ctx.save();
        topLine(ownMain, r);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = rgba(pal.mint, 0.85);
        ctx.shadowBlur = 18;
        ctx.strokeStyle = rgba(pal.mint, 0.55 * fade);
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = rgba('#F4FFF9', 0.95 * fade);
        ctx.lineWidth = 1.25;
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore(); // curve clip

    // baseline, ticks, channel numbers
    ctx.save();
    ctx.globalAlpha = axisA;
    ctx.strokeStyle = rgba(pal.lavender, 0.3);
    ctx.lineWidth = 1;
    const by = Math.round(base) + 0.5;
    for (const s of segs) { ctx.beginPath(); ctx.moveTo(s.x0, by); ctx.lineTo(s.x1, by); ctx.stroke(); }
    for (let i = 1; i < segs.length; i++) {
      const mx = (segs[i - 1].x1 + segs[i].x0) / 2;
      ctx.strokeStyle = rgba(pal.lavender, 0.4);
      ctx.beginPath(); ctx.moveTo(mx - 6, by + 4); ctx.lineTo(mx - 2, by - 4); ctx.moveTo(mx + 2, by + 4); ctx.lineTo(mx + 6, by - 4); ctx.stroke();
    }
    const xs = chs.map((c) => xOf(c));
    const minGap = xs.length > 1 ? Math.min(...xs.slice(1).map((x, i) => x - xs[i])) : 99;
    const every = minGap >= 24 ? 1 : minGap >= 12 ? 2 : Math.ceil(24 / Math.max(1, minGap));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    chs.forEach((c, i) => {
      const x = Math.round(xs[i]) + 0.5;
      const isCur = c === cur;
      const isRec = c === rec && rec !== cur;
      const isHov = i === hover;
      ctx.strokeStyle = rgba(pal.lavender, isCur || isRec || isHov ? 0.8 : 0.32);
      ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x, by + 4); ctx.stroke();
      if (i % every !== 0 && !isCur && !isRec && !isHov) return;
      ctx.font = (isCur || isRec || isHov ? '600 ' : '500 ') + '10.5px ' + FONT_M;
      ctx.fillStyle = isCur ? pal.mint : isRec ? pal.lavender : isHov ? pal.text : rgba(pal.dim, 1);
      ctx.fillText(String(c), x, by + 20);
    });
    ctx.restore();

    // Labels: your network, the router's other radios, the DFS caption, then neighbour counts
    // wherever they fit. Every label is a box, and later labels avoid earlier ones.
    const boxOf = (x, w, y) => ({ x0: x - w / 2 - 5, x1: x + w / 2 + 5, y0: y - 12, y1: y + 4 });
    const hit = (b) => labelBoxes.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (ownTop && ownMain) {
      const a = clamp01((tt - ownMain.delay - 380) / 400);
      const raw = ownMain.ssid || ownMain.label || '';
      const name = raw ? (raw.length > 22 ? raw.slice(0, 21) + '…' : raw) : 'Your network';
      ctx.font = '600 11.5px ' + FONT_U;
      const tw = ctx.measureText(name).width;
      const y = ownTop.y - 14;
      ctx.globalAlpha = a;
      ctx.fillStyle = pal.mint;
      ctx.fillText(name, ownTop.x, y);
      ctx.globalAlpha = 1;
      labelBoxes.push(boxOf(ownTop.x, tw, y));
      ownTop.labelY = y - 12;
    }
    ctx.font = '500 10.5px ' + FONT_U;
    for (const n of nets) {
      if (!n.radio) continue;
      const env = n.h * ph * Math.max(0, riseOf(n, t));
      if (env < 8) continue;
      const x = xOf(n.span.c);
      let y = base - env - 12;
      const raw = n.ssid || n.label || '';
      const nm = raw ? (raw.length > 18 ? raw.slice(0, 17) + '…' : raw) : 'Your router';
      const name = nm + ' · ' + band + ' GHz radio';
      const w = ctx.measureText(name).width;
      if (hit(boxOf(x, w, y))) y -= 16;
      if (hit(boxOf(x, w, y)) || y < 12) continue;
      ctx.globalAlpha = clamp01((tt - n.delay - 380) / 400) * 0.85;
      ctx.fillStyle = pal.mint;
      ctx.fillText(name, x, y);
      labelBoxes.push(boxOf(x, w, y));
    }
    ctx.globalAlpha = 1;
    if (dfsLabel) {
      const label = 'DFS · shared with radar';
      ctx.font = '600 10.5px ' + FONT_U;
      const w = ctx.measureText(label).width;
      const b = boxOf(dfsLabel.x, w, dfsLabel.y);
      const underChip = slot && Math.abs(slot.xm - dfsLabel.x) < (w / 2 + 80);
      if (!underChip && !hit(b)) {
        ctx.globalAlpha = axisA * 0.85;
        ctx.fillStyle = pal.amber;
        ctx.fillText(label, dfsLabel.x, dfsLabel.y);
        ctx.globalAlpha = 1;
        labelBoxes.push(b);
      }
    }
    // neighbour counts per primary channel, quiet and uncoloured; placed above the full envelope
    // (the user's ridge included) so they never sit inside a curve
    ctx.font = '500 10px ' + FONT_M;
    [...prim.entries()].sort((a, b) => a[0] - b[0]).forEach(([c, n]) => {
      const label = String(n);
      const w = ctx.measureText(label).width;
      const du = (w / 2 + 3) / model.k;
      const env = Math.max(envelopeAt(c - du, t, true), envelopeAt(c, t, true), envelopeAt(c + du, t, true));
      if (env < 6) return;
      const x = xOf(c);
      let y = base - env - 10;
      if (hit(boxOf(x, w, y))) y -= 16;
      if (hit(boxOf(x, w, y)) || y < 14) return;
      const first = nets.filter((m) => m.ch === c && !m.own).reduce((d, m) => Math.min(d, m.delay), 1e9);
      ctx.globalAlpha = clamp01((tt - first - 420) / 400) * 0.9;
      ctx.fillStyle = pal.muted;
      ctx.fillText(label, x, y);
      labelBoxes.push(boxOf(x, w, y));
    });
    ctx.globalAlpha = 1;

    // recommended label chip + "move here" arc
    if (slot) {
      ctx.save();
      ctx.globalAlpha = slotA;
      ctx.font = '600 11px ' + FONT_U;
      const label = 'Quietest · ' + rec;
      const tw = ctx.measureText(label).width + 20;
      const cy = slot.yTop - 18;
      const cx = Math.max(plotL + tw / 2, Math.min(plotR - tw / 2, slot.xm));
      roundRect(ctx, cx - tw / 2, cy - 11, tw, 22, 11);
      ctx.fillStyle = 'rgba(28,22,58,0.92)';
      ctx.fill();
      ctx.strokeStyle = rgba(pal.lavender, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy + 0.5);
      ctx.restore();
      slot.chip = { cx, cy, w: tw };
      labelBoxes.push({ x0: cx - tw / 2 - 4, x1: cx + tw / 2 + 4, y0: cy - 13, y1: cy + 13 });

      if (ownTop) {
        const p = RM ? 1 : easeInOut((tt - model.arcAt) / 700);
        if (p > 0) {
          const dir = slot.chip.cx >= ownTop.x ? 1 : -1;
          const sx = ownTop.x;
          const sy = (ownTop.labelY != null ? ownTop.labelY : ownTop.y) - 8;
          // A clean arch from your ridge, over the landscape, landing on top of the chip.
          const ex = slot.chip.cx;
          const ey = slot.chip.cy - 16;
          const dx = Math.abs(ex - sx);
          const lift = Math.max(12, Math.min(sy, ey) - Math.min(90, 24 + dx * 0.12));
          const c1 = [sx + dir * dx * 0.08, lift];
          const c2 = [ex - dir * dx * 0.08, lift];
          const bz = (u) => {
            const m = 1 - u;
            return [
              m * m * m * sx + 3 * m * m * u * c1[0] + 3 * m * u * u * c2[0] + u * u * u * ex,
              m * m * m * sy + 3 * m * m * u * c1[1] + 3 * m * u * u * c2[1] + u * u * u * ey,
            ];
          };
          ctx.save();
          ctx.beginPath();
          const steps = 64;
          for (let i = 0; i <= steps * p; i++) {
            const [x, y] = bz(i / steps);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = rgba(pal.lavender, 0.75);
          ctx.lineWidth = 1.25;
          ctx.setLineDash([3, 5]);
          ctx.lineCap = 'round';
          ctx.shadowColor = rgba(pal.lavender, 0.7);
          ctx.shadowBlur = 8;
          ctx.stroke();
          ctx.setLineDash([]);
          // origin dot
          ctx.fillStyle = rgba(pal.mint, 0.9);
          ctx.beginPath(); ctx.arc(sx, sy, 2.25, 0, TAU); ctx.fill();
          if (p >= 1) {
            // arrowhead into the chip
            const [ax, ay] = bz(0.97);
            const ang = Math.atan2(ey - ay, ex - ax);
            ctx.strokeStyle = rgba(pal.lavender, 0.95);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(ex - 6 * Math.cos(ang - 0.6), ey - 6 * Math.sin(ang - 0.6));
            ctx.lineTo(ex, ey);
            ctx.lineTo(ex - 6 * Math.cos(ang + 0.6), ey - 6 * Math.sin(ang + 0.6));
            ctx.stroke();
            model.arc = { bz };
          }
          ctx.restore();
        }
      }
    }

    // hover cursor
    if (hover >= 0 && hover < chs.length) {
      const x = Math.round(xOf(chs[hover])) + 0.5;
      ctx.save();
      const g = ctx.createLinearGradient(0, top - 24, 0, base);
      g.addColorStop(0, rgba(pal.text, 0));
      g.addColorStop(0.25, rgba(pal.text, 0.5));
      g.addColorStop(1, rgba(pal.text, 0.85));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top - 24); ctx.lineTo(x, base); ctx.stroke();
      const env = envelopeAt(chs[hover], t, true);
      if (env > 2) {
        ctx.fillStyle = pal.text;
        ctx.shadowColor = rgba(pal.text, 0.8);
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(x, base - env, 3, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  // The light travelling along the "move here" arc: a few passes, then stillness.
  function drawLight(now) {
    if (RM || introPending || !model || !model.arc) return;
    const tt = now - t0;
    const s = tt - model.arcAt - 700;
    if (s < 0 || tt >= model.lightEnd) return;
    const u = easeInOut((s % ARC_LOOP_MS) / ARC_LOOP_MS);
    const [dx, dy] = model.arc.bz(u);
    const a = Math.sin(Math.PI * u);
    ctx.save();
    const glow = ctx.createRadialGradient(dx, dy, 0, dx, dy, 12);
    glow.addColorStop(0, rgba(pal.lavender, 0.55 * a));
    glow.addColorStop(1, rgba(pal.lavender, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(dx, dy, 12, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba('#FFFFFF', 0.95 * a);
    ctx.beginPath(); ctx.arc(dx, dy, 2.2, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------- loop ----------
  function needsLoop(now) {
    if (RM || !model || introPending) return false;
    const t = now - t0;
    if (t < model.introEnd) return true;
    return model.rec != null && model.rec !== model.cur && !!model.ownMain && t < model.lightEnd;
  }

  function frame(now) {
    raf = 0;
    if (!alive) return;
    if (!dirty && cacheOk && settled(now)) blit(now); else draw(now);
    if (onScreen && !document.hidden && needsLoop(now)) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!alive || raf) return;
    if (!onScreen || document.hidden) return;
    if (introPending) { introPending = false; t0 = performance.now(); dirty = true; }
    raf = requestAnimationFrame(frame);
  }

  function redraw() {
    dirty = true;
    if (raf) return; // the running loop draws the next frame anyway
    draw(performance.now());
  }

  // ---------- size ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = layer.width = cache.width = Math.max(1, Math.round(W * dpr));
    canvas.height = layer.height = cache.height = Math.max(1, Math.round(H * dpr));
    cacheOk = false;
    build();
    redraw();
    if (hover >= 0) placeTip();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    if (onScreen) kick();
  }, { threshold: 0.15 }) : null;
  if (io) io.observe(host);

  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVis);

  // ---------- hover + keyboard ----------
  function networksAt(ch) {
    if (!model) return [];
    return model.nets
      .filter((n) => ch >= n.span.lo + 0.5 && ch <= n.span.hi - 0.5)
      .sort((a, b) => (b.main - a.main) || ((b.ch === ch) - (a.ch === ch)) || ((b.sig || 0) - (a.sig || 0)));
  }

  function placeTip() {
    if (!model || hover < 0) { tip.hidden = true; return; }
    const ch = model.chs[hover];
    const list = networksAt(ch);
    const shown = list.slice(0, 6);
    const assumed = shown.some((n) => !n.widthKnown);
    const isCur = ch === model.cur;
    const isRec = ch === model.rec && model.rec !== model.cur;
    tip.innerHTML = `
      <div class="cs-tip-h"><b>Channel ${ch}</b><span>${channelFreq(model.band, ch)} MHz</span></div>
      ${isCur ? '<p class="cs-tip-tag is-cur">Your channel</p>' : isRec ? '<p class="cs-tip-tag is-rec">Quietest channel</p>' : ''}
      ${shown.length ? `<ul>${shown.map((n) => `<li class="${n.own ? 'is-own' : ''}"><span class="cs-tip-n">${esc(n.ssid || 'Hidden network')}</span><span class="cs-tip-v">${n.sig != null ? Math.round(n.sig) + '%' : '--'}</span><span class="cs-tip-v${n.widthKnown ? '' : ' is-est'}">${n.widthKnown ? '' : '~'}${n.width} MHz</span></li>`).join('')}</ul>` : '<p class="cs-tip-empty">No networks heard here</p>'}
      ${list.length > shown.length ? `<p class="cs-tip-more">+${list.length - shown.length} more</p>` : ''}
      ${assumed ? '<p class="cs-tip-more">~ width not reported, 20 MHz assumed</p>' : ''}`;
    const firstShow = tip.hidden;
    tip.hidden = false;
    const x = model.xOf(ch);
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    // The tooltip never covers what it describes: the plot's labels and your ridge are obstacles.
    const obst = labelBoxes.slice();
    if (model.ownRidge) obst.push(model.ownRidge);
    const hitAt = (L, T) => obst.find((b) => L < b.x1 && L + tw > b.x0 && T < b.y1 && T + th > b.y0);
    const clampX = (L) => Math.max(4, Math.min(W - 4 - tw, L));
    // Pinned along the top of the plot, on whichever side of the cursor reaches a clear spot sooner.
    const topY = 6;
    const side = (dir) => {
      let L = dir > 0 ? x + 18 : x - 18 - tw;
      for (let i = 0; i < 8; i++) {
        const b = hitAt(L, topY);
        if (!b) break;
        L = dir > 0 ? b.x1 + 10 : b.x0 - 10 - tw;
      }
      return L;
    };
    const r = side(1);
    const l = side(-1);
    const okR = r + tw <= W - 4 && !hitAt(r, topY);
    const okL = l >= 4 && !hitAt(l, topY);
    let left;
    if (okR && (!okL || r - x <= x - (l + tw))) left = r;
    else if (okL) left = l;
    else left = clampX(x + 18 + tw > W - 4 ? x - 18 - tw : x + 18);
    // First show: appear in place (no slide in from the corner), then glide between channels.
    if (firstShow) tip.style.transition = 'none';
    tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(topY) + 'px)';
    if (firstShow) { void tip.offsetWidth; tip.style.transition = ''; }
    const names = list.map((n) => (n.ssid || 'Hidden network') + (n.sig != null ? ' ' + Math.round(n.sig) + '%' : '')).join(', ');
    sr.textContent = 'Channel ' + ch + (isCur ? ', your channel' : isRec ? ', quietest channel' : '') + '. ' + (list.length ? list.length + ' network' + (list.length === 1 ? '' : 's') + ': ' + names : 'No networks heard here') + '.';
  }

  function setHover(i, byKey) {
    if (!model) return;
    const n = Math.max(-1, Math.min(model.chs.length - 1, i));
    hoverByKey = !!byKey;
    if (n === hover) return;
    hover = n;
    if (hover < 0) { tip.hidden = true; sr.textContent = ''; } else placeTip();
    redraw();
  }

  host.addEventListener('pointermove', (e) => {
    if (!model) return;
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    let best = -1;
    let bd = 1e9;
    model.chs.forEach((c, i) => { const d = Math.abs(model.xOf(c) - mx); if (d < bd) { bd = d; best = i; } });
    setHover(bd < 40 ? best : -1, false);
  });
  host.addEventListener('pointerleave', () => { if (!hoverByKey) setHover(-1); });
  host.addEventListener('keydown', (e) => {
    if (!model) return;
    const start = () => { const i = model.chs.indexOf(model.cur); return i >= 0 ? i : 0; };
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setHover(hover < 0 ? start() : hover + (e.key === 'ArrowRight' ? 1 : -1), true);
    } else if (e.key === 'Home') { e.preventDefault(); setHover(0, true); }
    else if (e.key === 'End') { e.preventDefault(); setHover(model.chs.length - 1, true); }
    else if (e.key === 'Escape') { setHover(-1); }
  });
  host.addEventListener('blur', () => setHover(-1));

  return {
    // animate: true replays the rise (first show, band switch); otherwise the new data snaps in.
    update(next, { animate = false } = {}) {
      data = next;
      pal = readPalette();
      host.setAttribute('aria-label', (next && next.summary ? next.summary + ' ' : '') + 'Use the left and right arrow keys to inspect channels.');
      const keepHover = hover >= 0 && model ? model.chs[hover] : null;
      // The plot is taller only when the recommendation chip and arc need the headroom.
      const recShown = !!next && num(next.recommended) != null && next.recommended !== next.current;
      host.toggleAttribute('data-rec', recShown);
      build();
      hover = keepHover != null && model ? model.chs.indexOf(keepHover) : -1;
      if (hover < 0) tip.hidden = true; else placeTip();
      if (animate && !RM) {
        introPending = true;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        draw(performance.now()); // empty first frame until the card is on screen
        kick();
      } else {
        redraw();
        if (model && !RM && !introPending && needsLoop(performance.now())) kick();
      }
    },
    redraw() { pal = readPalette(); redraw(); },
    dispose() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
