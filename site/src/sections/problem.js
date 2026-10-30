import { gsap, ScrollTrigger } from '../fx/scroll.js';

/* problem: "What your router does behind your back".
   Four evidence cards, each with a live dithered illustration that breaks out above the card top.
   Desktop with a fine pointer: the cards rise as a stacked deck and fan into an overlapping hand
   (one scrubbed variable, --p, drives every card); a short pin then steps a focused card through
   the hand: it straightens, lifts forward and lights its rim while the others recede, and an
   anamorphic flare tracks it. Hover or keyboard focus picks a card directly. Touch or narrow
   screens: a coverflow carousel with real perspective. No JS / reduced motion: a flat, fully
   legible row (desktop) or a plain snap carousel. All canvases share one rAF that runs only while
   the section is near the viewport. */

const mq = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false });
const RM = mq('(prefers-reduced-motion: reduce)');
const FINE = mq('(hover: hover) and (pointer: fine)');
const DESK = '(min-width: 1024px)';
const FANQ = `${DESK} and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)`;
const PINQ = `${FANQ} and (min-height: 760px)`;

const CARDS = [
  {
    tone: '#FF8E7A',
    scene: 'remote',
    tag: 'TR-069 · port 7547',
    title: 'Your provider keeps a remote control',
    body:
      'TR-069, also called CWMP, lets your internet provider reach the router over port 7547 to change its settings and push new firmware. It works whether or not you ever open the admin page.',
  },
  {
    tone: '#FFC772',
    scene: 'dns',
    tag: 'DNS · plain text',
    title: 'Every site you visit, in plain text',
    body:
      'Before any page loads, your device asks a DNS server where the site lives. By default that question goes to your provider unencrypted, so the provider, and anyone on the path, can read the list.',
  },
  {
    tone: '#B7A9FF',
    scene: 'upnp',
    tag: 'UPnP · auto port-forwards',
    title: 'Devices open doors on their own',
    body:
      'With UPnP switched on, any app or gadget on your network can ask the router to forward a port from the internet to itself. There is no password and no prompt, and the forward stays until something removes it.',
  },
  {
    tone: '#8FD3FF',
    scene: 'tv',
    tag: 'Smart TV · set-top box',
    title: 'The TV keeps talking with the screen off',
    body:
      'Smart TVs and set-top boxes often keep sending usage and viewing data to the maker’s servers while they sit in standby. Nothing on the screen tells you it is happening.',
  },
];

// loose-deck pose per card before the fan opens (rotation, vertical offset)
const DECK = [
  { srz: -3.5, sy: 0 },
  { srz: 2.2, sy: -6 },
  { srz: -1.2, sy: -12 },
  { srz: 3.8, sy: -18 },
];
const SPREAD = 0.68; // card pitch in the hand, as a fraction of the card width (32% overlap)
// first guess for the focused card's top edge in the stage (from captures); measured once it settles
const flareY = (o) => 51 + o * o * 15.5;

/* ---------------- dithered pixel illustrations ---------------- */

const CELL = 3; // CSS px per illustration pixel
const BREAK = 42; // px the illustration rises above the card top (matches --brk in problem.css)
const FADE = 12; // bottom rows that dissolve into the card body
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

// 3x5 pixel font (uppercase shapes read best at this size)
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001110',
  '.': '000000000000010', '-': '000000111000000', ':': '000010000010000', '?': '110001010000010',
  '>': '100010001010100', ' ': '000000000000000',
};

// illustrative lookups; the lens magnifies only the leaf label, so it always reads as a word
const LEAVES = ['CLINIC', 'MYBANK', 'DATING', 'LOANS', 'LAWYER', 'DOCTOR', 'JOBS', 'NEWS'];

function packColor(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return ((Math.round(a * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
function mixHex(hex, to, k) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const c = (s) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
}
const fract = (x) => x - Math.floor(x);
const hash = (x) => fract(Math.sin(x * 12.9898) * 43758.5453);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function makePixelScene(wrap, canvas, tone, draw) {
  const ctx = canvas.getContext('2d');
  const s = {
    ctx, canvas, wrap, draw, C: 0, R: 0, T: 0, B: 0, buf: null, img: null, u32: null, hot: null, tape: null,
    colGlow: packColor(tone, 0.16), colDim: packColor(tone, 0.34), colMid: packColor(tone, 0.95),
    colHi: packColor(mixHex(tone, '#FFFFFF', 0.62), 1),
  };
  s.resize = () => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const C = Math.max(20, Math.floor(w / CELL)), R = Math.max(30, Math.floor(h / CELL));
    if (C === s.C && R === s.R) return false;
    s.C = C; s.R = R;
    s.T = Math.round(BREAK / CELL); // first row inside the card
    s.B = R - FADE; // ground line, just above the dissolve
    canvas.width = C; canvas.height = R;
    canvas.style.width = C * CELL + 'px';
    canvas.style.height = R * CELL + 'px';
    s.buf = new Float32Array(C * R);
    s.hot = new Uint8Array(C * R);
    s.img = ctx.createImageData(C, R);
    s.u32 = new Uint32Array(s.img.data.buffer);
    s.tape = null;
    return true;
  };
  return s;
}

// Ordered dither into three tone levels. The bottom rows dissolve into the card body through the
// dither itself, and bright cells get a 1-cell halo baked into the buffer (no CSS filter).
function renderPixels(s) {
  const { buf, u32, hot, C, R } = s;
  hot.fill(0);
  for (let y = 0; y < R; y++) {
    const row = (y & 3) * 4;
    const f = Math.min(1, (R - 1 - y) / FADE, (y + 1) / 3);
    for (let x = 0; x < C; x++) {
      const i = y * C + x;
      const v = buf[i] * f;
      if (v > BAYER[row + (x & 3)]) {
        u32[i] = v > 1.05 ? s.colHi : v > 0.55 ? s.colMid : s.colDim;
        if (v > 0.9) hot[i] = 1;
      } else u32[i] = 0;
    }
  }
  for (let y = 1; y < R - 1; y++) {
    for (let x = 1; x < C - 1; x++) {
      const i = y * C + x;
      if (u32[i] === 0 && (hot[i - 1] | hot[i + 1] | hot[i - C] | hot[i + C])) u32[i] = s.colGlow;
    }
  }
  s.ctx.putImageData(s.img, 0, 0);
}

// drawing primitives on the intensity buffer (max blend)
function P(s, x, y, v) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= s.C || y >= s.R) return;
  const i = y * s.C + x;
  if (v > s.buf[i]) s.buf[i] = v;
}
function rect(s, x, y, w, h, v) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(s, x + i, y + j, v); }
function frame(s, x, y, w, h, v) {
  for (let i = 0; i < w; i++) { P(s, x + i, y, v); P(s, x + i, y + h - 1, v); }
  for (let j = 0; j < h; j++) { P(s, x, y + j, v); P(s, x + w - 1, y + j, v); }
}
function line(s, x0, y0, x1, y1, v, dash = 0, off = 0) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
  for (let k = 0; k <= n; k++) {
    if (dash && ((k + off) % dash + dash) % dash >= dash / 2) continue;
    const u = n ? k / n : 0;
    P(s, x0 + (x1 - x0) * u + 0.5, y0 + (y1 - y0) * u + 0.5, v);
  }
}
function text(s, str, x, y, v, out = null) {
  for (let c = 0; c < str.length; c++) {
    const g = GLYPHS[str[c]] || GLYPHS[' '];
    for (let k = 0; k < 15; k++) {
      if (g[k] !== '1') continue;
      const px = x + c * 4 + (k % 3), py = y + ((k / 3) | 0);
      if (out) { if (px >= 0 && px < out.w && py >= 0 && py < out.h) out.a[py * out.w + px] = 1; } else P(s, px, py, v);
    }
  }
}
function groundDots(s, v = 0.3) {
  for (let y = s.T + 2; y < s.R; y += 6) for (let x = 2 + ((y / 6) & 1) * 3; x < s.C; x += 6) P(s, x, y, v);
}
function router(s, x, y, w, h, glow) {
  rect(s, x + 1, y + 1, w - 2, h - 2, 0.16 + glow * 0.2);
  frame(s, x, y, w, h, 0.85 + glow * 0.3);
  line(s, x + 3, y - 1, x + 1, y - 7, 0.7);
  line(s, x + w - 4, y - 1, x + w - 2, y - 7, 0.7);
}

// Every scene draws its subject inside the card (rows T..B) and lets one element climb out above
// the card top (rows 0..T): the mast, the magnifier, escaping traffic, the TV's outgoing packets.
const SCENES = {
  // 1. a signal from a far mast pulses into the router over port 7547
  remote(s, t) {
    const { C, T, B } = s;
    groundDots(s, 0.2);
    const tx = 9, ty = T - 8, base = B;
    line(s, tx, ty, tx, base, 0.62);
    line(s, tx, ty + 9, tx - 6, base, 0.45);
    line(s, tx, ty + 9, tx + 6, base, 0.45);
    for (let k = 1; k < 4; k++) line(s, tx - k * 1.5, ty + 9 + k * 10, tx + k * 1.5, ty + 9 + k * 10, 0.36);
    rect(s, tx - 1, ty - 1, 3, 3, 0.8 + 0.45 * Math.max(0, Math.sin(t * 5)));
    line(s, 0, base, C, base, 0.32, 4, Math.floor(t * 6));

    const rw = Math.min(30, C - 30), rh = 10, rx = C - rw - 6, ry = base - rh - 1;
    const hx = rx + rw / 2, hy = ry - 2;
    const D = Math.hypot(hx - tx, hy - ty), a0 = Math.atan2(hy - ty, hx - tx);
    const gap = D / 4, speed = 17;
    let hit = 0;
    for (let k = 0; k < 4; k++) {
      const r = (t * speed + k * gap) % D;
      if (r < 3) continue;
      hit = Math.max(hit, Math.exp(-(((D - r) / 2.5) ** 2)));
      const v = 1.15 - 0.5 * (r / D);
      const spread = 0.42;
      for (let a = a0 - spread; a <= a0 + spread; a += 0.7 / r) {
        const taper = Math.cos(((a - a0) / spread) * Math.PI * 0.5);
        P(s, tx + Math.cos(a) * r, ty + Math.sin(a) * r, v * (0.25 + 0.75 * taper));
      }
    }
    line(s, tx, ty, hx, hy, 0.36, 5, -Math.floor(t * 14));
    router(s, rx, ry, rw, rh, hit);
    for (let i = 0; i < 3; i++) rect(s, rx + 4 + i * 4, ry + 3, 2, 2, i === 0 ? 0.7 + hit * 0.8 : 0.5);
    text(s, '7547', rx + rw - 17, ry - 16, 0.95 + hit * 0.25);
  },

  // 2. plain-text lookups scroll under a magnifier that reads each site name
  dns(s, t) {
    const { C, R, T, B } = s;
    // an elliptical loupe, wide enough for a whole six-letter name at 2x
    const ry = Math.max(12, Math.min(23, (B - T) * 0.46)), rx = Math.min(ry * 1.32, C * 0.3);
    const lx = Math.round(Math.max(rx + 2, C * 0.44));
    const ly = Math.round(T + (B - T) * 0.42);
    if (!s.tape) {
      const h = LEAVES.length * 8;
      const full = { w: C, h, a: new Uint8Array(C * h) };
      const leaf = { w: C, h, a: new Uint8Array(C * h) };
      LEAVES.forEach((d, i) => {
        text(s, `A? ${d}.EXAMPLE`, 3, i * 8 + 1, 1, full);
        // each name centred on the lens axis, so the loupe always frames the whole word
        text(s, d, Math.round(lx - (d.length * 4 - 1) / 2), i * 8 + 1, 1, leaf);
      });
      s.tape = { full, leaf, h };
    }
    const { full, leaf, h } = s.tape;
    // phase: at the still frame (t = 2.4) the first name sits centred in the lens
    const scroll = t * 5 + (3.5 - ly - 12);
    const at = (tp, x, y) => tp.a[(((y % h) + h) % h) * C + x];
    for (let y = 0; y < R; y++) {
      const edge = Math.min(1, (y - T + 1) / 6);
      for (let x = 0; x < C; x++) {
        const dx = x - lx, dy = y - ly, d = Math.hypot(dx / rx, dy / ry);
        let v = 0;
        if (d < 1) {
          const sx = Math.floor(lx + dx / 2), sy = Math.floor(ly + dy / 2 + scroll);
          const on = sx >= 0 && sx < C && at(leaf, sx, sy);
          v = on ? 1.2 : 0.07 + 0.12 * (1 - d) * (dx < -dy ? 1 : 0.3);
        } else if (d < 1 + 1.4 / ry) {
          v = 0.95;
        } else if (edge > 0) {
          v = at(full, x, Math.floor(y + scroll)) ? 0.46 * edge : 0;
        }
        if (v) P(s, x, y, v);
      }
    }
    const hx = lx + (rx + 1) * 0.72, hy = ly + (ry + 1) * 0.72;
    for (let k = 0; k < 2; k++) line(s, hx + k, hy, hx + 9 + k, hy + 9, 0.8);
  },

  // 3. ports on the router pop open by themselves; traffic climbs out of them and out of the card
  upnp(s, t) {
    const { C, T, B } = s;
    // the open internet above the card: a drifting band of dots
    for (let x = 1; x < C; x += 2) P(s, x, T - 9 + Math.round(1.6 * Math.sin(x * 0.2 + t * 0.8)), 0.4);
    const rw = Math.min(C - 14, 72), rh = 14, rx = ((C - rw) / 2) | 0, ry = B - rh;
    const n = 8, step = (rw - 8) / n;
    let lit = 0;
    for (let i = 0; i < n; i++) {
      const px = Math.round(rx + 5 + i * step), py = ry + rh - 5;
      const win = 2.6, phase = (t + i * 0.83) / win;
      const open = hash(i * 7.31 + Math.floor(phase) * 3.17) > 0.5;
      const pop = open ? Math.exp(-fract(phase) * 5) : 0;
      if (open) {
        lit++;
        rect(s, px - 1, py - 1, 5, 5, 0.55 + pop * 0.6);
        rect(s, px, py, 3, 3, 1.2);
        const top = T - 7, span = py - 4 - top;
        for (let j = 0; j < 6; j++) {
          const yy = py - 4 - ((t * 13 + j * (span / 6) + i * 3) % span);
          const v = 0.4 + 0.8 * (1 - (yy - top) / span);
          P(s, px + 1, yy, v + 0.25);
          P(s, px, yy + 1, v * 0.75);
          P(s, px + 2, yy + 1, v * 0.75);
        }
        line(s, px + 1, top, px + 1, py - 2, 0.2, 2);
      } else {
        frame(s, px, py, 3, 3, 0.45);
      }
    }
    router(s, rx, ry, rw, rh, Math.min(1, lit / 6) * 0.4);
    for (let i = 0; i < 3; i++) rect(s, rx + 4 + i * 4, ry + 3, 2, 1, 0.85);
  },

  // 4. the screen is dark, yet packets keep leaving the TV and fly off the top of the card
  tv(s, t) {
    const { C, T, B } = s;
    groundDots(s, 0.18);
    const tw = Math.min(46, Math.round(C * 0.46)), th = Math.min(30, B - T - 12);
    const tx = 7, ty = B - th - 10;
    rect(s, tx, ty, tw, th + 3, 0.12);
    frame(s, tx, ty, tw, th + 3, 0.8);
    frame(s, tx + 2, ty + 2, tw - 4, th - 2, 0.42);
    // a cold reflection on the dark glass
    for (let y = ty + 3; y < ty + th - 1; y++) for (let x = tx + 3; x < tx + tw - 3; x++) {
      const b = (x - tx) + (y - ty) * 0.9;
      if (b > 10 && b < 16) P(s, x, y, 0.2);
      else if (b > 19 && b < 21) P(s, x, y, 0.14);
    }
    const blink = 0.55 + 0.7 * Math.max(0, Math.sin(t * 2.2)) ** 6;
    rect(s, tx + tw - 5, ty + th + 1, 2, 1, blink);
    const cx = tx + (tw >> 1);
    line(s, cx, ty + th + 3, cx, ty + th + 7, 0.6);
    line(s, cx - 8, ty + th + 7, cx + 8, ty + th + 7, 0.6);

    const ex = tx + tw + 1, ey = ty + 6, L = C - ex + 4, rise = ey - 3;
    const pathY = (u) => ey - rise * (0.55 * u + 0.45 * Math.sin(u * Math.PI * 0.5));
    const pathX = (u) => ex + u * L;
    for (let k = 0; k <= 30; k++) P(s, pathX(k / 30), pathY(k / 30), 0.22);
    for (let k = 0; k < 15; k++) {
      const burst = Math.floor(k / 3), lead = k % 3;
      const u = fract(t * 0.28 + burst * 0.2 + lead * 0.03);
      const x = pathX(u), y = pathY(u);
      const v = 1.25 - u * 0.5;
      rect(s, x - 1, y - 1, 3, 3, v * 0.55);
      P(s, x, y, v);
    }
  },
};

/* ---------------- halftone planet ---------------- */

// The canvas is sized to the planet plus its ring; the edge falloff is baked into the dots (no CSS
// mask), and `spin` lets the carousel turn it on swipe.
function makePlanet(canvas) {
  const ctx = canvas.getContext('2d');
  const p = { W: 0, H: 0, dpr: 1, spin: 0 };
  const radius = () => Math.min(p.W * 0.28, p.H * 0.44);
  p.resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    p.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    p.W = r.width; p.H = r.height;
    canvas.width = Math.round(p.W * p.dpr);
    canvas.height = Math.round(p.H * p.dpr);
    canvas.parentElement.style.setProperty('--limb', (p.H * 0.5 - radius() * 0.93).toFixed(1) + 'px');
  };
  const L = (() => { const v = [-0.55, -0.6, 0.58], m = Math.hypot(...v); return v.map((x) => x / m); })();
  const cols = [
    ['rgba(212,203,255,', 0.9], ['rgba(183,169,255,', 0.7], ['rgba(124,108,255,', 0.6],
    ['rgba(63,227,201,', 0.75], ['rgba(255,95,210,', 0.7],
  ];
  p.draw = (t) => {
    const { W, H } = p;
    if (!W) return;
    ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const R = radius(), cx = W * 0.5, cy = H * 0.5;
    const sp = Math.max(7, R / 26), rot = t * 0.05 + p.spin;
    const edge = (x, y) => {
      const e = Math.hypot((x - cx) / (W * 0.5), (y - cy) / (H * 0.5));
      return clamp((1 - e) / 0.3, 0, 1);
    };
    const paths = cols.map(() => new Path2D());
    for (let row = -Math.ceil(R / sp); row <= Math.ceil(R / sp); row++) {
      const y = cy + row * sp * 0.866;
      const off = (row & 1) * sp * 0.5;
      for (let x = cx - R - sp + off; x <= cx + R + sp; x += sp) {
        const nx = (x - cx) / R, ny = (y - cy) / R, q = nx * nx + ny * ny;
        if (q >= 1) continue;
        const nz = Math.sqrt(1 - q);
        const lon = Math.atan2(nx, nz) + rot, lat = Math.asin(ny);
        let tex = 0.5 + 0.5 * Math.sin(lat * 7 + 1.4 * Math.sin(lon * 2 + lat * 3))
          + 0.3 * Math.sin(lon * 5 + 1.7) * Math.cos(lat * 4);
        tex = clamp(tex, 0, 1);
        tex = tex * tex * (3 - 2 * tex);
        const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const rim = Math.pow(1 - nz, 3);
        const lit = Math.pow(lam, 1.3) * (0.12 + 0.88 * tex);
        let v = lit + rim * 0.55, b;
        if (rim * 0.55 > lit) b = nx > 0 ? 3 : 4;
        else b = tex > 0.75 ? 0 : tex > 0.4 ? 1 : 2;
        v = Math.min(1, v) * edge(x, y);
        if (v < 0.06) continue;
        const r = sp * 0.5 * Math.pow(v, 0.8);
        paths[b].moveTo(x + r, y);
        paths[b].arc(x, y, r, 0, Math.PI * 2);
      }
    }
    // tilted dotted ring; the half behind the globe is hidden by it
    const ra = R * 1.7, rb = R * 0.3, tilt = -0.2, ct = Math.cos(tilt), st = Math.sin(tilt);
    const N = 220;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 + t * 0.04 + p.spin * 0.6;
      const ex = Math.cos(a) * ra, ey = Math.sin(a) * rb;
      const x = cx + ex * ct - ey * st, y = cy + ex * st + ey * ct;
      const behind = Math.sin(a) < 0;
      if (behind && Math.hypot(x - cx, y - cy) < R) continue;
      const v = (0.35 + 0.65 * hash(k * 1.7)) * (behind ? 0.45 : 1) * edge(x, y);
      if (v < 0.04) continue;
      const r = sp * 0.3 * v + 0.6;
      paths[k % 3 === 0 ? 3 : 1].moveTo(x + r, y);
      paths[k % 3 === 0 ? 3 : 1].arc(x, y, r, 0, Math.PI * 2);
    }
    cols.forEach(([c, a], i) => { ctx.fillStyle = c + a + ')'; ctx.fill(paths[i]); });
  };
  return p;
}

/* ---------------- mount ---------------- */

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'problem-title');

  const cards = CARDS.map((c, i) => {
    const o = i - 1.5;
    const n = String(i + 1).padStart(2, '0');
    return `
        <li class="pb-slot" style="--i:${i};--o:${o};--o2:${o * o};--oa:${Math.abs(o)};--tone:${c.tone};--srz:${DECK[i].srz}deg;--sy:${DECK[i].sy}px">
          <article class="pb-card" aria-labelledby="pb-t${i}">
            <div class="pb-tilt">
              <span class="pb-card__face" aria-hidden="true"></span>
              <span class="pb-card__rim" aria-hidden="true"></span>
              <span class="pb-card__glare" aria-hidden="true"></span>
              <div class="pb-art" aria-hidden="true">
                <canvas class="pb-art__cv" data-scene="${c.scene}" width="1" height="1"></canvas>
              </div>
              <div class="pb-card__in">
                <div class="pb-meta">
                  <p class="pb-chip mono"><span class="pb-chip__dot" aria-hidden="true"></span>${c.tag}</p>
                  <span class="pb-no mono" aria-hidden="true">${n}</span>
                </div>
                <h3 class="pb-card__title" id="pb-t${i}">${c.title}</h3>
                <p class="pb-card__body">${c.body}</p>
              </div>
            </div>
          </article>
        </li>`;
  }).join('');

  const dots = CARDS.map((c, i) =>
    `<button class="pb-dot" type="button" aria-label="Show card ${i + 1} of ${CARDS.length}: ${c.title}"${i === 0 ? ' aria-current="true"' : ''}><span aria-hidden="true"></span></button>`,
  ).join('');
  const arrow = (dir, label) =>
    `<button class="pb-nav pb-nav--${dir}" type="button" aria-label="${label}"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="${dir === 'prev' ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;

  el.innerHTML = `
    <div class="pb-bg" aria-hidden="true"></div>
    <div class="pb-planet" aria-hidden="true"><canvas class="pb-planet__cv" width="1" height="1"></canvas><span class="pb-planet__flare"></span></div>
    <div class="container">
      <header class="sec-head pb-head">
        <p class="eyebrow">The quiet part</p>
        <h2 class="display-l" id="problem-title">What your router does behind your back</h2>
        <p class="lead">Home routers and the gadgets around them ship with features that serve the provider or the device maker first. None of them ask you, and none of them make noise.</p>
      </header>
      <div class="pb-stage" role="region" aria-label="Four things your router does">
        <div class="pb-flare" aria-hidden="true">
          <i class="pb-flare__bloom"></i><i class="pb-flare__fringe pb-flare__fringe--a"></i><i class="pb-flare__fringe pb-flare__fringe--b"></i><i class="pb-flare__streak"></i><i class="pb-flare__core"></i>
        </div>
        <ul class="pb-deck" role="list">${cards}
        </ul>
        <div class="pb-ctrl">${arrow('prev', 'Previous card')}<div class="pb-dots" role="group" aria-label="Choose a card">${dots}</div>${arrow('next', 'Next card')}</div>
      </div>
      <p class="pb-foot">
        <span class="pb-foot__dot" aria-hidden="true"></span>
        Bastion checks for the first three from your computer and walks you through switching each one off. TV traffic needs router integration, which is on the roadmap; for now, Bastion lists those devices on your network.
      </p>
    </div>`;

  try { setupEntrance(el); } catch (err) { console.error('[problem] entrance', err); }

  const stage = el.querySelector('.pb-stage');
  const deck = el.querySelector('.pb-deck');
  const live = { planet: null };
  try { setupLive(el, live); } catch (err) { console.error('[problem] canvases', err); }
  let hand = null;
  try { hand = setupHand(el, stage, deck); } catch (err) { console.error('[problem] hand', err); }
  try { setupFan(el, stage, deck, hand); } catch (err) { console.error('[problem] fan', err); }
  try { setupTilt(el); } catch (err) { console.error('[problem] tilt', err); }
  try { setupCarousel(el, stage, deck, live); } catch (err) { console.error('[problem] carousel', err); }
}

/* Heading and footnote entrance. Visible by default; only elements still below the fold at mount
   are armed (with an opacity floor), and a ScrollTrigger settles them, including on jumps past. */
function setupEntrance(el) {
  if (RM.matches) return;
  const vh = window.innerHeight || 800;
  const head = el.querySelector('.pb-head'), foot = el.querySelector('.pb-foot');
  const arm = (node, targets, from) => {
    if (!node || node.getBoundingClientRect().top < vh * 0.9) return;
    gsap.set(targets, { opacity: 0.14, ...from });
    ScrollTrigger.create({
      trigger: node,
      start: 'top 90%',
      once: true,
      onEnter: () => gsap.to(targets, {
        opacity: 1, x: 0, y: 0, scale: 1, duration: 1.1, ease: 'expo.out', stagger: 0.09,
        clearProps: 'opacity,transform',
      }),
    });
  };
  if (head) {
    const [eyebrow, h2, lead] = head.children;
    arm(head, [eyebrow], { x: -24 });
    arm(head, [h2], { y: 46, scale: 0.97, transformOrigin: '0% 100%' });
    arm(head, [lead], { y: 30 });
  }
  arm(foot, [foot], { y: 30 });
}

/* one loop for the four illustrations and the planet */
function setupLive(el, live) {
  const scenes = [];
  let planet = null, ready = false, near = false, raf = 0, t0 = 0, lastPlanet = -1;

  function init() {
    if (ready) return;
    ready = true;
    el.querySelectorAll('.pb-art__cv').forEach((cv, i) => {
      const s = makePixelScene(cv.parentElement, cv, CARDS[i].tone, SCENES[cv.dataset.scene]);
      s.resize();
      scenes.push(s);
    });
    planet = live.planet = makePlanet(el.querySelector('.pb-planet__cv'));
    planet.resize();
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => {
        scenes.forEach((s) => s.resize());
        planet.resize();
        paint(RM.matches ? 2.4 : (performance.now() - t0) / 1000, true);
      });
      scenes.forEach((s) => ro.observe(s.wrap));
      ro.observe(el.querySelector('.pb-planet'));
    }
    t0 = performance.now();
    paint(2.4, true);
  }

  function paint(t, force) {
    for (const s of scenes) {
      if (!s.C) continue;
      s.buf.fill(0);
      s.draw(s, t);
      renderPixels(s);
    }
    // the planet turns slowly; 30fps is plenty
    if (planet && (force || t - lastPlanet > 1 / 30)) { planet.draw(t); lastPlanet = t; }
  }
  live.repaintPlanet = () => { if (planet && RM.matches) planet.draw(2.4); };

  function tick(now) {
    raf = 0;
    paint((now - t0) / 1000);
    loop();
  }
  function loop() {
    const want = ready && near && !document.hidden && !RM.matches;
    if (want && !raf) raf = requestAnimationFrame(tick);
    else if (!want && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const e of entries) { near = e.isIntersecting; if (near) init(); }
      loop();
    }, { rootMargin: '300px 0px' }).observe(el);
  } else { near = true; init(); loop(); }
  document.addEventListener('visibilitychange', loop);
  if (RM.addEventListener) RM.addEventListener('change', () => { loop(); if (ready) paint(2.4, true); });
}

/* ---------------- the hand (desktop fan mode) ---------------- */

// Which card is focused: the pointer / keyboard pick wins, otherwise the scroll step. -1 = none.
function setupHand(el, stage, deck) {
  const slots = [...deck.children];
  const flare = stage.querySelector('.pb-flare');
  const st = { on: false, scrollIdx: -1, pickIdx: -1, cur: -2, flashT: 0, fitT: 0 };

  // lock the flare onto the focused card's top edge once its lift has settled
  const fit = () => {
    const face = deck.querySelector('.pb-slot.is-active .pb-card__face');
    if (!face) return;
    const r = face.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    stage.style.setProperty('--fx', (r.left + r.width / 2 - sr.left).toFixed(1) + 'px');
    stage.style.setProperty('--fy', (r.top - sr.top).toFixed(1) + 'px');
  };

  const flash = (kind) => {
    flare.classList.remove('is-flash', 'is-blip');
    void flare.offsetWidth; // restart the animation
    flare.classList.add(kind);
    clearTimeout(st.flashT);
    st.flashT = setTimeout(() => flare.classList.remove(kind), 1700);
  };

  function apply() {
    const k = st.on ? (st.pickIdx >= 0 ? st.pickIdx : st.scrollIdx) : -1;
    if (k === st.cur) return;
    const prev = st.cur;
    st.cur = k;
    stage.classList.toggle('pb-has-active', k >= 0);
    const W = slots[0].offsetWidth || 320;
    const fx = k >= 0 ? stage.clientWidth / 2 + (k - 1.5) * W * SPREAD : stage.clientWidth / 2;
    slots.forEach((s, i) => {
      const d = k < 0 ? 0 : i - k;
      s.classList.toggle('is-active', d === 0 && k >= 0);
      s.style.setProperty('--side', String(Math.sign(d)));
      s.style.zIndex = k < 0 ? String(10 + i) : String(20 - Math.abs(d) * 2 - (d < 0 ? 1 : 0));
      // where the flare sits relative to this card, so its face light leans toward it
      const cx = stage.clientWidth / 2 + (i - 1.5) * W * SPREAD;
      s.style.setProperty('--fl', clamp(50 + ((fx - cx) / W) * 100, -40, 140).toFixed(0) + '%');
    });
    if (k >= 0) {
      stage.style.setProperty('--fx', fx.toFixed(1) + 'px');
      stage.style.setProperty('--fy', flareY(k - 1.5).toFixed(1) + 'px');
      flash(prev < 0 ? 'is-flash' : 'is-blip');
      clearTimeout(st.fitT);
      st.fitT = setTimeout(fit, 1400); // fallback; normally the card's transitionend fits it
    }
  }

  deck.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'transform' && e.target.classList.contains('pb-card') && e.target.parentElement.classList.contains('is-active')) fit();
  });
  slots.forEach((s, i) => {
    s.addEventListener('pointerenter', (e) => { if (st.on && e.pointerType !== 'touch') { st.pickIdx = i; apply(); } });
    s.addEventListener('focusin', () => { if (st.on) { st.pickIdx = i; apply(); } });
    s.addEventListener('focusout', (e) => {
      if (st.on && !s.contains(e.relatedTarget)) { st.pickIdx = -1; apply(); }
    });
  });
  deck.addEventListener('pointerleave', () => { if (st.on) { st.pickIdx = -1; apply(); } });
  window.addEventListener('resize', () => { if (st.on) { const k = st.cur; st.cur = -2; apply(); if (k === st.cur) flare.classList.remove('is-flash', 'is-blip'); } }, { passive: true });

  return {
    enable(on) {
      st.on = on;
      st.pickIdx = -1;
      slots.forEach((s) => {
        const card = s.querySelector('.pb-card');
        if (on) card.setAttribute('tabindex', '0'); else card.removeAttribute('tabindex');
        if (!on) { s.classList.remove('is-active'); ['--side', '--fl', 'z-index'].forEach((p) => s.style.removeProperty(p)); }
      });
      if (!on) { stage.classList.remove('pb-has-active'); st.cur = -2; st.scrollIdx = -1; }
      else apply();
    },
    step(idx) { if (idx !== st.scrollIdx) { st.scrollIdx = idx; apply(); } },
    get scrollIdx() { return st.scrollIdx; },
  };
}

/* desktop: the deck rises and fans into a hand, then a short pin steps the focus through it */
function setupFan(el, stage, deck, hand) {
  if (!hand) return;
  const mm = gsap.matchMedia();
  mm.add({ fan: FANQ, pin: PINQ }, (ctx) => {
    const { fan, pin } = ctx.conditions;
    if (!fan) return undefined;
    el.classList.add('pb-fan');
    hand.enable(true);
    let fanDone = false, stepP = 0;
    const sync = () => hand.step(fanDone ? Math.min(3, Math.floor(stepP * 4)) : -1);

    gsap.fromTo(stage, { '--p': 0 }, {
      '--p': 1,
      ease: 'none',
      scrollTrigger: {
        trigger: stage,
        start: 'top 86%',
        end: pin ? 'center 56%' : 'center 62%',
        scrub: 0.7,
        onToggle: (self) => el.classList.toggle('pb-is-fanning', self.isActive),
        onUpdate: (self) => {
          const done = self.progress > 0.985;
          if (done !== fanDone) { fanDone = done; sync(); }
        },
        onLeave: () => { fanDone = true; sync(); },
      },
    });
    ScrollTrigger.create({
      trigger: stage,
      start: pin ? 'center 52%' : 'center 56%',
      end: pin ? '+=95%' : 'center 26%',
      pin,
      anticipatePin: pin ? 1 : 0,
      onUpdate: (self) => { stepP = self.progress; sync(); },
    });
    gsap.fromTo(el.querySelector('.pb-planet'), { yPercent: 9 }, {
      yPercent: -7,
      ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
    });
    return () => {
      el.classList.remove('pb-fan', 'pb-is-fanning');
      stage.style.removeProperty('--p');
      hand.enable(false);
    };
  });
}

/* pointer-tracked tilt and glare, eased in rAF like light moving on a metal card. The rect comes
   from the untilted slot, cached on enter, so the card never rotates out from under the cursor. */
function setupTilt(el) {
  el.querySelectorAll('.pb-slot').forEach((slot) => {
    const card = slot.querySelector('.pb-card');
    const tilt = slot.querySelector('.pb-tilt');
    let rect = null, raf = 0, on = false;
    const cur = { x: 0.5, y: 0.5, a: 0 }, tgt = { x: 0.5, y: 0.5, a: 0 };
    const active = () => FINE.matches && !RM.matches && el.classList.contains('pb-fan');
    const frame = () => {
      raf = 0;
      const k = 0.16;
      cur.x += (tgt.x - cur.x) * k;
      cur.y += (tgt.y - cur.y) * k;
      cur.a += (tgt.a - cur.a) * k;
      const rx = (0.5 - cur.y) * 12 * cur.a, ry = (cur.x - 0.5) * 16 * cur.a;
      tilt.style.transform = cur.a < 0.002 ? '' : `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      tilt.style.setProperty('--gx', (cur.x * 100).toFixed(1) + '%');
      tilt.style.setProperty('--gy', (cur.y * 100).toFixed(1) + '%');
      tilt.style.setProperty('--ga', (Math.atan2(cur.y - 0.5, cur.x - 0.5) * 57.3 + 90).toFixed(1) + 'deg');
      const settled = Math.abs(tgt.x - cur.x) + Math.abs(tgt.y - cur.y) + Math.abs(tgt.a - cur.a) < 0.002;
      if (!settled) raf = requestAnimationFrame(frame);
      else if (!on) { tilt.style.transform = ''; card.classList.remove('is-lit'); }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    // the cached rect goes stale when the page scrolls under a still pointer
    window.addEventListener('scroll', () => { rect = null; }, { passive: true });
    slot.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch' || !active()) return;
      rect = slot.getBoundingClientRect();
      on = true;
      tgt.a = 1;
      card.classList.add('is-lit');
    });
    slot.addEventListener('pointermove', (e) => {
      if (!on) return;
      if (!rect) rect = slot.getBoundingClientRect();
      tgt.x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      tgt.y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      kick();
    });
    slot.addEventListener('pointerleave', () => {
      if (!on) return;
      on = false;
      rect = null;
      tgt.x = 0.5; tgt.y = 0.5; tgt.a = 0;
      kick();
    });
  });
}

/* touch / narrow screens: coverflow carousel with dots, prev/next and arrow keys */
function setupCarousel(el, stage, deck, live) {
  const slots = [...deck.children];
  const dots = [...el.querySelectorAll('.pb-dot')];
  const prev = el.querySelector('.pb-nav--prev');
  const next = el.querySelector('.pb-nav--next');
  const desk = mq(DESK);
  const coarse = mq('(hover: none), (pointer: coarse)');
  const isCarousel = () => !desk.matches || coarse.matches;
  let raf = 0, cur = 0;

  const current = () => {
    const mid = deck.scrollLeft + deck.clientWidth / 2;
    let best = 0, bd = Infinity;
    slots.forEach((s, i) => {
      const c = s.offsetLeft + s.offsetWidth / 2, d = Math.abs(c - mid);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const go = (i) => {
    const s = slots[clamp(i, 0, slots.length - 1)];
    deck.scrollTo({ left: s.offsetLeft - (deck.clientWidth - s.offsetWidth) / 2, behavior: RM.matches ? 'auto' : 'smooth' });
  };
  const update = () => {
    raf = 0;
    if (!isCarousel()) return;
    const mid = deck.scrollLeft + deck.clientWidth / 2;
    if (!RM.matches) {
      slots.forEach((s) => {
        const d = (s.offsetLeft + s.offsetWidth / 2 - mid) / (s.offsetWidth || 1);
        const c = clamp(d, -1.4, 1.4);
        s.style.setProperty('--d', c.toFixed(3));
        s.style.setProperty('--ad', Math.min(1, Math.abs(c)).toFixed(3));
      });
      // the planet behind turns with the swipe
      if (live.planet) live.planet.spin = (deck.scrollLeft / Math.max(1, deck.scrollWidth - deck.clientWidth)) * 1.6;
    }
    cur = current();
    dots.forEach((d, i) => (i === cur ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')));
    prev.disabled = cur === 0;
    next.disabled = cur === slots.length - 1;
  };
  const placePlanet = () => {
    if (!isCarousel()) { el.style.removeProperty('--pt'); return; }
    el.style.setProperty('--pt', (stage.offsetTop + 34).toFixed(0) + 'px');
  };

  deck.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
  prev.addEventListener('click', () => go(cur - 1));
  next.addEventListener('click', () => go(cur + 1));
  deck.addEventListener('keydown', (e) => {
    if (!isCarousel() || e.target !== deck) return;
    const k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const edge = e.key === 'Home' ? 0 : e.key === 'End' ? slots.length - 1 : -1;
    if (k) { e.preventDefault(); go(cur + k); } else if (edge >= 0) { e.preventDefault(); go(edge); }
  });

  const mode = () => {
    const on = isCarousel();
    el.classList.toggle('pb-carousel', on);
    if (on) {
      stage.setAttribute('aria-roledescription', 'carousel');
      deck.setAttribute('tabindex', '0');
      deck.setAttribute('role', 'group');
      deck.setAttribute('aria-label', 'Cards, use the arrow keys to move between them');
      slots.forEach((s, i) => {
        s.setAttribute('role', 'group');
        s.setAttribute('aria-roledescription', 'slide');
        s.setAttribute('aria-label', `${i + 1} of ${slots.length}`);
      });
      update();
    } else {
      stage.removeAttribute('aria-roledescription');
      deck.removeAttribute('tabindex');
      deck.setAttribute('role', 'list');
      deck.removeAttribute('aria-label');
      slots.forEach((s) => {
        ['role', 'aria-roledescription', 'aria-label'].forEach((a) => s.removeAttribute(a));
        s.style.removeProperty('--d'); s.style.removeProperty('--ad');
      });
      if (live.planet) live.planet.spin = 0;
    }
    placePlanet();
  };
  [desk, coarse].forEach((m) => (m.addEventListener ? m.addEventListener('change', mode) : m.addListener && m.addListener(mode)));
  window.addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(update); placePlanet(); }, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(placePlanet).observe(el);
  mode();
}
