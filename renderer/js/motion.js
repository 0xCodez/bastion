// Shared micro-animations for the Bastion renderer (Uplink look).
// Dependency-free ES module. Every helper respects prefers-reduced-motion by jumping
// straight to its end state, and none of them invents data: unknown values stay unknown.
// Pair with renderer/styles/motion.css (keyframes + utility classes) and docs/UI-NOTES.md.

const RM_QUERY = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

// Read live so a change in system settings applies without a reload.
export function prefersReducedMotion() {
  return Boolean(RM_QUERY && RM_QUERY.matches);
}

// True when animating is pointless: reduced motion, or the window is hidden
// (Electron throttles requestAnimationFrame in background windows).
function skipMotion() {
  return prefersReducedMotion() || (typeof document !== 'undefined' && document.hidden);
}

// ---------- easing ----------

// Minimal cubic-bezier solver so JS motion matches the CSS curves exactly.
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sx(t) - x;
      const d = dx(t);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    t = Math.min(1, Math.max(0, t));
    return sy(t);
  };
}

// Same names and values as the --mo-ease-* tokens in motion.css.
export const CSS_EASE = {
  out: 'cubic-bezier(.2,.7,.15,1)',
  inOut: 'cubic-bezier(.65,0,.2,1)',
  std: 'cubic-bezier(.4,0,.2,1)',
};

export const EASE = {
  linear: (x) => x,
  out: cubicBezier(0.2, 0.7, 0.15, 1),
  inOut: cubicBezier(0.65, 0, 0.2, 1),
  std: cubicBezier(0.4, 0, 0.2, 1),
};

export const DURATION = {
  quick: 120,
  base: 200,
  progress: 350,
  panel: 520,
  count: 900,
  flare: 900,
  reveal: 1100,
  long: 1800,
};

// ---------- tween core ----------

// One running tween per owner (element or canvas). Starting a new one cancels the old.
const running = new WeakMap();
// Which typewriter call currently owns an element (see typewriter()).
const typing = new WeakMap();
// Last number countUp actually painted into an element, so a retarget starts from it.
const shownNum = new WeakMap();

function cancel(owner) {
  const prev = running.get(owner);
  if (prev) prev.cancel();
}

// aria-busy keeps screen readers from announcing every partial frame of a live region;
// clearing it lets them read the final text once. Only cleared when no newer tween owns el.
function setBusy(el, on) {
  if (!el || typeof el.setAttribute !== 'function') return;
  if (on) el.setAttribute('aria-busy', 'true');
  else if (!running.has(el)) el.removeAttribute('aria-busy');
}

// Runs onFrame(eased 0..1) for `ms`. Resolves true when completed, false when cancelled.
// With reduced motion or a hidden window it calls onFrame(1) once and resolves.
export function tween(owner, ms, onFrame, ease = EASE.out) {
  if (owner) cancel(owner);
  if (skipMotion() || !(ms > 0)) {
    try {
      onFrame(1);
    } catch (err) {
      console.error('[motion] frame failed', err);
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let raf = 0;
    const t0 = performance.now();
    const handle = {
      cancel() {
        cancelAnimationFrame(raf);
        if (owner && running.get(owner) === handle) running.delete(owner);
        resolve(false);
      },
    };
    const step = (now) => {
      // rAF timestamps can predate t0 on the first frame, so clamp both ends.
      const p = Math.max(0, Math.min(1, (now - t0) / ms));
      try {
        onFrame(ease(p));
      } catch (err) {
        // A throwing frame must still settle the promise and free the owner.
        console.error('[motion] frame failed', err);
        if (owner && running.get(owner) === handle) running.delete(owner);
        resolve(false);
        return;
      }
      if (p < 1) {
        raf = requestAnimationFrame(step);
      } else {
        if (owner && running.get(owner) === handle) running.delete(owner);
        resolve(true);
      }
    };
    if (owner) running.set(owner, handle);
    raf = requestAnimationFrame(step);
  });
}

// ---------- countUp ----------

// Animates a number into el.textContent. `to` of null / undefined / NaN renders the
// `unknown` text instead of a number (never a made-up zero).
// opts: duration, decimals, from, prefix, suffix, group (thousands separators), unknown.
export function countUp(el, to, opts = {}) {
  if (!el) return Promise.resolve(false);
  typing.delete(el);
  const {
    duration = DURATION.count,
    decimals = 0,
    from,
    prefix = '',
    suffix = '',
    group = false,
    unknown = '—',
  } = opts;

  const target = to === null || to === undefined || to === '' ? NaN : Number(to);
  if (!Number.isFinite(target)) {
    cancel(el);
    el.textContent = unknown;
    delete el.dataset.moValue;
    shownNum.delete(el);
    setBusy(el, false);
    return Promise.resolve(true);
  }

  const nf = group
    ? new Intl.NumberFormat(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : null;
  const fmt = (v) => prefix + (nf ? nf.format(v) : v.toFixed(decimals)) + suffix;

  // Start from what is on screen now (mid-count included), not from the previous target.
  let start = Number(from);
  if (!Number.isFinite(start)) start = shownNum.has(el) ? shownNum.get(el) : Number(el.dataset.moValue);
  if (!Number.isFinite(start)) start = 0;
  el.dataset.moValue = String(target);

  if (start === target) {
    cancel(el);
    el.textContent = fmt(target);
    shownNum.set(el, target);
    setBusy(el, false);
    return Promise.resolve(true);
  }
  setBusy(el, true);
  return tween(el, duration, (p) => {
    const v = p >= 1 ? target : start + (target - start) * p;
    shownNum.set(el, v);
    el.textContent = fmt(v);
  }).then((completed) => {
    setBusy(el, false);
    return completed;
  });
}

// ---------- stagger ----------

// Reveals nodes one after another. Elements are visible at rest: the hidden start
// keyframe exists only while the animation runs (fill: backwards), so if anything goes
// wrong the content simply shows. Uses the `translate` property, so an element's own
// `transform` is left alone.
// opts: delay (ms between items), duration, distance (px), start (ms), maxSteps.
export function stagger(nodes, opts = {}) {
  const {
    delay = 50,
    duration = DURATION.panel,
    distance = 12,
    start = 0,
    maxSteps = 12,
  } = opts;
  const list = Array.from(nodes || []).filter((n) => n && typeof n.animate === 'function');
  if (!list.length || skipMotion()) return Promise.resolve();
  const anims = list.map((node, i) => node.animate(
    [
      { opacity: 0, translate: `0 ${distance}px` },
      { opacity: 1, translate: '0 0' },
    ],
    {
      duration,
      delay: start + Math.min(i, maxSteps) * delay,
      easing: CSS_EASE.out,
      fill: 'backwards',
    },
  ));
  return Promise.all(anims.map((a) => a.finished.catch(() => null))).then(() => undefined);
}

// ---------- typewriter ----------

// Types `text` into el. Long text is sped up so it never takes longer than maxMs.
// Aborting the signal (or reduced motion) writes the full text at once.
// Resolves { completed: boolean }. Uses textContent, so it is safe for model output.
export function typewriter(el, text, opts = {}) {
  const { cps = 70, signal, maxMs = 4000, caret = true } = opts;
  const str = text === null || text === undefined ? '' : String(text);
  if (!el) return Promise.resolve({ completed: false });
  const chars = Array.from(str);
  const ms = Math.min((chars.length / Math.max(1, cps)) * 1000, maxMs);

  if (signal && signal.aborted) {
    cancel(el);
    typing.delete(el);
    el.classList.remove('mo-caret');
    el.textContent = str;
    setBusy(el, false);
    return Promise.resolve({ completed: false });
  }
  const token = {};
  typing.set(el, token);
  shownNum.delete(el);
  let onAbort = null;
  let aborted = false;
  // Partial strings are not announced; the full answer is read once aria-busy clears.
  setBusy(el, true);
  const run = tween(el, ms, (p) => {
    const n = p >= 1 ? chars.length : Math.max(0, Math.floor(chars.length * p));
    el.textContent = n >= chars.length ? str : chars.slice(0, n).join('');
  }, EASE.linear);
  // Added after tween() so a cancelled predecessor cannot strip it.
  if (caret && !skipMotion()) el.classList.add('mo-caret');
  if (signal) {
    onAbort = () => {
      if (typing.get(el) !== token) return;
      aborted = true;
      cancel(el);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return run.then((completed) => {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    const owner = typing.get(el);
    // A newer typewriter owns the element (and its caret): leave it alone.
    if (owner && owner !== token) return { completed: false };
    if (owner === token) typing.delete(el);
    el.classList.remove('mo-caret');
    // Only our own abort writes the full text; a countUp or tween that took over keeps el.
    if (!completed && aborted) el.textContent = str;
    setBusy(el, false);
    return { completed };
  });
}

// ---------- flareBurst ----------

const VOID_TAGS = new Set(['INPUT', 'IMG', 'CANVAS', 'TEXTAREA', 'SELECT', 'VIDEO', 'BR', 'HR', 'SVG']);

// One-shot horizontal anamorphic light streak across an element (CSS-driven, see
// .mo-flare-burst in motion.css). Use it to acknowledge a real event: a check that
// passed, a port that was sealed, a test that finished. No-op with reduced motion.
// opts: color (CSS color for the wings; default the accent blue), danger (red streak).
export function flareBurst(el, opts = {}) {
  if (!el || skipMotion()) return Promise.resolve();
  let host = el;
  if (VOID_TAGS.has(String(host.tagName).toUpperCase()) && host.parentElement) host = host.parentElement;

  const old = host.querySelector(':scope > .mo-flare-burst');
  if (old) old.remove();

  const addedHost = getComputedStyle(host).position === 'static';
  if (addedHost) host.classList.add('mo-flare-host');

  const burst = document.createElement('span');
  burst.className = 'mo-flare-burst' + (opts.danger ? ' mo-flare-burst--risk' : '');
  burst.setAttribute('aria-hidden', 'true');
  if (opts.color) burst.style.setProperty('--mo-flare-color', opts.color);
  host.appendChild(burst);

  return new Promise((resolve) => {
    setTimeout(() => {
      burst.remove();
      if (addedHost && !host.querySelector(':scope > .mo-flare-burst')) host.classList.remove('mo-flare-host');
      resolve();
    }, DURATION.flare + 60);
  });
}

// ---------- canvas helpers ----------

// Accepts a CSS color, a token name ('--accent') or 'var(--accent, #fff)'.
export function resolveColor(color, fallback = '#7C6CFF') {
  if (!color) return fallback;
  const c = String(color).trim();
  let name = null, fb = null;
  if (c.startsWith('--')) {
    name = c;
  } else {
    const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(c);
    if (m) { name = m[1]; fb = m[2] ? m[2].trim() : null; }
  }
  if (!name) return c;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fb || fallback;
}

// Color with alpha. Any CSS color is first normalized by a scratch 2D context (which
// returns #rrggbb or rgba()), so CanvasGradient.addColorStop never sees a string it rejects.
let scratchCtx = null;
const ALPHA_FALLBACK = '124,108,255';
function withAlpha(color, a) {
  let c = String(color || '').trim();
  try {
    if (!scratchCtx) scratchCtx = document.createElement('canvas').getContext('2d');
    if (scratchCtx) {
      const sentinel = '#010203';
      scratchCtx.fillStyle = sentinel;
      scratchCtx.fillStyle = c;
      const out = String(scratchCtx.fillStyle);
      c = out === sentinel && c.toLowerCase() !== sentinel ? '' : out;
    }
  } catch {
    // Keep the raw string; the parsers below fall back to the accent if it is unusable.
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c);
  if (m) {
    const base = m[4] === undefined ? 1 : Number(m[4]);
    return `rgba(${m[1]},${m[2]},${m[3]},${base * a})`;
  }
  return `rgba(${ALPHA_FALLBACK},${a})`;
}

// Canvases already measured once (see the size lock in fitCanvas).
const fitted = new WeakSet();

// Sizes the backing store to the element's CSS box at device pixel ratio (max 2).
// A canvas without a CSS size takes its box from the width/height attributes, so at
// dpr > 1 every resize would grow it again (a ResizeObserver loop). On the first fit,
// an axis whose box equals its attribute and has no inline size is locked to that size.
// Views should still give sparkline / ring canvases an explicit CSS width and height.
function fitCanvas(canvas) {
  let rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!fitted.has(canvas) && rect.width > 0 && rect.height > 0) {
    fitted.add(canvas);
    let locked = false;
    if (!canvas.style.width && Math.round(rect.width) === canvas.width) {
      canvas.style.width = `${rect.width}px`;
      locked = true;
    }
    if (!canvas.style.height && Math.round(rect.height) === canvas.height) {
      canvas.style.height = `${rect.height}px`;
      locked = true;
    }
    if (locked) rect = canvas.getBoundingClientRect();
  }
  const w = rect.width || canvas.clientWidth || canvas.width / dpr || 0;
  const h = rect.height || canvas.clientHeight || canvas.height / dpr || 0;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function observeResize(canvas, redraw) {
  if (typeof ResizeObserver !== 'function') return () => {};
  // The initial callback also fires, which covers canvases that were not laid out yet.
  const ro = new ResizeObserver(() => {
    try {
      redraw();
    } catch (err) {
      console.error('[motion] redraw failed', err);
    }
  });
  ro.observe(canvas);
  return () => ro.disconnect();
}

// ---------- sparkline ----------

// Draws a thin line chart of `values` (numbers; null leaves a gap, nothing is interpolated).
// Returns { update(values, opts?), dispose() }. Redraws on resize. The first draw sweeps
// in from the left; updates are instant so live data does not flicker.
// opts: color, fill (area under the line, default true), lineWidth, min, max, dot (last point), animate.
export function sparkline(canvas, values, opts = {}) {
  let data = Array.isArray(values) ? values.slice() : [];
  let o = { fill: true, lineWidth: 1.5, dot: true, animate: true, ...opts };
  let reveal = 1;

  function draw() {
    if (!canvas) return;
    const { ctx, w, h } = fitCanvas(canvas);
    if (w <= 0 || h <= 0) return;
    const color = resolveColor(o.color || '--accent');
    const pts = data.map((v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v)));
    const finite = pts.filter((v) => v !== null);
    if (finite.length < 2) return;

    let lo = Number.isFinite(o.min) ? o.min : Math.min(...finite);
    let hi = Number.isFinite(o.max) ? o.max : Math.max(...finite);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = o.lineWidth + (o.dot ? 3 : 1);
    const xAt = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2);
    const yAt = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);

    ctx.save();
    if (reveal < 1) {
      ctx.beginPath();
      ctx.rect(0, 0, w * reveal, h);
      ctx.clip();
    }

    // Segments split at null gaps.
    const segs = [];
    let cur = [];
    pts.forEach((v, i) => {
      if (v === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([xAt(i), yAt(v)]);
    });
    if (cur.length) segs.push(cur);

    if (o.fill) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, withAlpha(color, 0.22));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      for (const s of segs) {
        if (s.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(s[0][0], h);
        for (const [x, y] of s) ctx.lineTo(x, y);
        ctx.lineTo(s[s.length - 1][0], h);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = o.lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const s of segs) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.01, s[0][1]);
      ctx.stroke();
    }

    if (o.dot && pts[pts.length - 1] !== null && reveal >= 1) {
      const x = xAt(pts.length - 1), y = yAt(pts[pts.length - 1]);
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = resolveColor('--fg', '#ffffff');
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (o.animate && !skipMotion()) {
    reveal = 0;
    tween(canvas, DURATION.panel, (p) => { reveal = p; draw(); }, EASE.out);
  } else {
    draw();
  }
  const stopObserving = observeResize(canvas, draw);

  return {
    update(next, nextOpts) {
      if (Array.isArray(next)) data = next.slice();
      if (nextOpts) o = { ...o, ...nextOpts };
      if (reveal >= 1) draw();
    },
    redraw: draw,
    dispose() {
      cancel(canvas);
      stopObserving();
    },
  };
}

// ---------- ring ----------

// Small dial: a thin track with a value arc from 12 o'clock, clockwise.
// value null / undefined draws a dashed, dimmed track (unknown). A measured 0 draws the
// solid track plus the bright tip at 12 o'clock, so the two never look alike.
// Returns { set(value, opts?), dispose() }; set() animates from the current value.
// opts: value, max (default 100), color, track, thickness, glow (default true).
export function ring(canvas, opts = {}) {
  let o = { max: 100, glow: true, ...opts };
  let shown = 0;
  let hasValue = false;

  function valid(v) {
    return v !== null && v !== undefined && Number.isFinite(Number(v));
  }

  function draw(v) {
    if (!canvas) return;
    const { ctx, w, h } = fitCanvas(canvas);
    if (w <= 0 || h <= 0) return;
    const size = Math.min(w, h);
    const lw = o.thickness || Math.max(2, Math.round(size * 0.06));
    const r = size / 2 - lw - (o.glow ? 3 : 1);
    if (r <= 0) return;
    const cx = w / 2, cy = h / 2;

    ctx.lineWidth = lw;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = resolveColor(o.track || '--line', 'rgba(255,255,255,.14)');
    ctx.save();
    if (v === null) {
      ctx.setLineDash([Math.max(1, lw * 0.6), Math.max(3, lw * 1.6)]);
      ctx.globalAlpha = 0.6;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (v === null) return;
    const max = Number(o.max) > 0 ? Number(o.max) : 100;
    const frac = Math.min(1, Math.max(0, v / max));
    const color = resolveColor(o.color || '--accent');
    const a0 = -Math.PI / 2;
    const a1 = a0 + frac * Math.PI * 2;
    if (frac > 0) {
      ctx.save();
      if (o.glow) { ctx.shadowColor = color; ctx.shadowBlur = Math.max(4, lw * 2); }
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();
      ctx.restore();
    }

    // Bright tip marks the current value.
    ctx.fillStyle = resolveColor('--fg', '#ffffff');
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, lw * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function set(value, nextOpts) {
    if (nextOpts) o = { ...o, ...nextOpts };
    if (!valid(value)) {
      cancel(canvas);
      hasValue = false;
      shown = 0;
      draw(null);
      return Promise.resolve(true);
    }
    const target = Number(value);
    const from = hasValue ? shown : 0;
    hasValue = true;
    return tween(canvas, DURATION.long * 0.6, (p) => {
      shown = from + (target - from) * p;
      draw(shown);
    }, EASE.inOut);
  }

  set(o.value);
  const stopObserving = observeResize(canvas, () => draw(hasValue ? shown : null));

  return {
    set,
    dispose() {
      cancel(canvas);
      stopObserving();
    },
  };
}
