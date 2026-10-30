import { reveal } from '../fx/reveal.js';
import { motionOK, isReduced, scrollToTarget, requestRefresh } from '../fx/scroll.js';

/* features: "Four jobs, done on your computer".

   Desktop (fine pointer, room to breathe, motion allowed): a pinned scroll story. The section holds
   the viewport for ~4 screens; the left column steps through the four jobs on a vertical progress
   rail while one dithered particle field on the right morphs, scroll-scrubbed, between four
   formations: radar dome -> program/packet graph -> Wi-Fi spectrum landscape -> router with three
   orbiting AI watchers. Each morph fires an anamorphic flare.

   Narrow screens, touch and reduced motion: no pinning. Four stacked blocks, each with a still frame
   of its formation rendered once to a canvas when it comes near the viewport.

   The markup is complete and readable before any of this runs: the default (no JS) layout is the
   stacked one, and the story mode only adds classes on top. */

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (x) => x * x * (3 - 2 * x);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fract = (x) => x - Math.floor(x);
const mod = (a, n) => ((a % n) + n) % n;
const hash = (i, k) => fract(Math.sin(i * 12.9898 + k * 78.233 + i * k * 0.0137) * 43758.5453);

/* ---------- palette: dithered pixels come in 9 colours x 4 brightness levels ---------- */
const PAL = ['#B7A9FF', '#8FD3FF', '#9EF0C4', '#FF8E7A', '#FFC772', '#E8A07F', '#F3F0FF', '#7C6CFF', '#6F68A8'];
const LAV = 0, SKY = 1, MINT = 2, CORAL = 3, AMBER = 4, CLAY = 5, WHITE = 6, VIOLET = 7, DIM = 8;
const LV = [0.3, 0.54, 0.78, 1];
const NB = PAL.length * 4;
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const FILLS = [];
for (const hex of PAL) { const [r, g, b] = rgb(hex); for (const l of LV) FILLS.push(`rgba(${r},${g},${b},${l})`); }
const BAYER = Float32Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], (v) => (v + 0.5) / 16);

const mkBuf = (n) => ({ x: new Float32Array(n), y: new Float32Array(n), a: new Float32Array(n), s: new Float32Array(n), c: new Uint8Array(n) });

/* ---------- tiny 3D camera (yaw around y, pitch looking down, mild perspective) ---------- */
function cam(yaw, pitch, persp, sc, ox, oy) {
  return { ca: Math.cos(yaw), sa: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch), persp, sc, ox, oy };
}
let PX = 0, PY = 0, PD = 0;
function P(c, x, y, z) {
  const xr = x * c.ca + z * c.sa;
  const zr = -x * c.sa + z * c.ca;
  const d = zr * c.cp - y * c.sp;
  const k = 1 / (1 + d * c.persp);
  PX = c.ox + xr * k * c.sc;
  PY = c.oy - (y * c.cp + zr * c.sp) * k * c.sc;
  PD = d;
}
const front = () => clamp(0.5 - PD * 0.6);

/* point on the edges (or top face) of a box centred on x/z, sitting on y0 */
let BX = 0, BY = 0, BZ = 0;
function boxPt(w, h, d, y0, e, u, v) {
  const hw = w / 2, hd = d / 2;
  if (v < 0.22) { BX = (u * 2 - 1) * hw; BY = y0 + h; BZ = (fract(u * 7.13) * 2 - 1) * hd; return; }
  const ed = (e * 12) | 0, ax = (ed / 4) | 0, s1 = ed & 1 ? 1 : -1, s2 = ed & 2 ? 1 : -1, q = u * 2 - 1;
  if (ax === 0) { BX = q * hw; BY = y0 + (s1 > 0 ? h : 0); BZ = s2 * hd; }
  else if (ax === 1) { BX = s1 * hw; BY = y0 + (q * 0.5 + 0.5) * h; BZ = s2 * hd; }
  else { BX = s1 * hw; BY = y0 + (s2 > 0 ? h : 0); BZ = q * hd; }
}

/* ======================================================================================
   Formations. Each writes every particle's target (normalised coords, ~[-1,1]) into a buffer
   and returns the overlay labels and soft glows for that moment.
   ====================================================================================== */

/* ---------- 0: a slowly turning dust cloud (intro, before the story pins / before a still reveals)
   kept inside ~1 unit with a radial alpha falloff so it never meets the canvas edge ---------- */
const SCATTER = {
  labelSpec: [],
  frame(F, b, t) {
    const [r0, r1, r2, r3] = F.r;
    for (let i = 0; i < F.N; i++) {
      const rr = 1.12 * Math.pow(r0[i], 0.72), an = r1[i] * TAU + t * 0.05 * (1.5 - rr);
      const fall = Math.pow(clamp(1 - rr / 1.15), 1.4);
      b.x[i] = Math.cos(an) * rr;
      b.y[i] = Math.sin(an) * rr * 0.7 + (r3[i] - 0.5) * 0.1 * (1 - rr);
      b.a[i] = (0.08 + 0.3 * r3[i] * r3[i]) * fall;
      b.c[i] = r2[i] < 0.5 ? DIM : r2[i] < 0.82 ? VIOLET : r2[i] < 0.96 ? LAV : WHITE;
      b.s[i] = 1;
    }
    return { labels: [], glows: [[0, 0, 0.7, VIOLET, 0.14]] };
  },
};

/* ---------- 1: radar dome over the router, coral beacons on open ports ---------- */
const BEACONS = [
  { deg: 300, r: 0.84, port: '7547', name: 'TR-069', col: CORAL },
  { deg: 32, r: 0.62, port: '23', name: 'Telnet', col: CORAL },
  { deg: 148, r: 0.8, port: '1900', name: 'UPnP', col: CORAL },
  { deg: 218, r: 0.52, port: '80', name: 'HTTP admin', col: AMBER },
].map((b) => {
  const a = (b.deg * Math.PI) / 180;
  return { ...b, a, x: Math.cos(a) * b.r, z: Math.sin(a) * b.r };
});
const SWEEP = 0.9;
const PARALLELS = [0.3, 0.62, 0.94, 1.24];
const FLOOR_R = [0.34, 0.6, 0.86, 1.1, 1.32];

const RADAR = {
  label: 'Illustration: a radar dome over your router. A sweep passes over open ports 7547 (TR-069), 23 (Telnet), 1900 (UPnP) and 80 (plain-HTTP admin), each marked by a coral beacon. Plain-text DNS is a separate check, not a port.',
  cap: 'Illustration · exposure map',
  labelSpec: [
    ...BEACONS.map((b) => ({ html: `<b>${b.port}</b> <span>${b.name}</span>`, anchor: 'l', cls: b.col === AMBER ? 'warn' : 'risk' })),
    { html: 'your router', anchor: 'c', cls: 'dim' },
  ],
  frame(F, b, t) {
    const N = F.N, [r0, r1, r2, r3, r4] = F.r;
    const sw = t * SWEEP;
    const C = cam(-0.3 + Math.sin(t * 0.12) * 0.16, 0.52, 0.2, 0.78, 0, 0.14);
    const n1 = (N * 0.26) | 0, n2 = (N * 0.37) | 0, n3 = (N * 0.53) | 0, n4 = (N * 0.67) | 0, n5 = (N * 0.84) | 0, n6 = (N * 0.9) | 0;
    const M = 18, J = Math.ceil(n1 / M), PC = Math.ceil((n2 - n1) / PARALLELS.length);
    const gB = BEACONS.map((B) => Math.exp(-mod(sw - B.a, TAU) * 1.1));
    for (let i = 0; i < N; i++) {
      let x = 0, y = 0, z = 0, c = LAV, a = 0.5, s = 1, depthFade = true;
      if (i < n1) {
        // dome meridians
        const th = (((i / M) | 0) / J) * Math.PI * 0.495, lam = ((i % M) / M) * TAU;
        x = Math.cos(th) * Math.cos(lam); y = Math.sin(th); z = Math.cos(th) * Math.sin(lam);
        const g = Math.exp(-mod(sw - lam, TAU) * 2.4);
        a = 0.2 + 0.75 * g; c = g > 0.5 ? WHITE : r2[i] < 0.3 ? VIOLET : LAV;
      } else if (i < n2) {
        // dome parallels
        const q = i - n1, th = PARALLELS[q % PARALLELS.length], lam = (((q / PARALLELS.length) | 0) / PC) * TAU;
        x = Math.cos(th) * Math.cos(lam); y = Math.sin(th); z = Math.cos(th) * Math.sin(lam);
        const g = Math.exp(-mod(sw - lam, TAU) * 2.4);
        a = 0.22 + 0.6 * g; c = g > 0.5 ? WHITE : LAV;
      } else if (i < n3) {
        // floor rings, more dots on the bigger ones
        const ring = Math.min(4, (Math.sqrt(r0[i]) * 5) | 0), rad = FLOOR_R[ring] + (r3[i] - 0.5) * 0.012;
        const lam = r1[i] * TAU;
        x = Math.cos(lam) * rad; z = Math.sin(lam) * rad;
        const g = Math.exp(-mod(sw - lam, TAU) * 2);
        a = (ring === 4 ? 0.42 : 0.26) + 0.5 * g; c = ring === 4 ? LAV : r2[i] < 0.5 ? VIOLET : LAV;
      } else if (i < n4) {
        // sweep: a wedge on the floor and a curtain through the dome
        const lag = r1[i] * r1[i] * 1.3, lam = sw - lag;
        const fade = Math.pow(1 - lag / 1.3, 2);
        if (r4[i] < 0.32) {
          const th = r2[i] * Math.PI * 0.49;
          x = Math.cos(th) * Math.cos(lam); y = Math.sin(th); z = Math.cos(th) * Math.sin(lam);
          a = fade * 0.75;
        } else {
          const rad = 0.06 + Math.sqrt(r2[i]) * 1.32;
          x = Math.cos(lam) * rad; z = Math.sin(lam) * rad;
          a = fade * 0.95;
        }
        c = lag < 0.05 ? WHITE : r3[i] < 0.5 ? LAV : VIOLET;
      } else if (i < n5) {
        // beacons: a light column, expanding pulse rings and a hot core
        const q = i - n4, bi = q & 3, B = BEACONS[bi], g = gB[bi];
        const m = r1[i];
        if (m < 0.34) {
          const h = Math.pow(r2[i], 1.3) * 0.46;
          x = B.x + (r3[i] - 0.5) * 0.018; z = B.z + (r4[i] - 0.5) * 0.018; y = h;
          a = (1 - (h / 0.46) * 0.8) * (0.5 + 0.5 * g); c = B.col;
        } else if (m < 0.74) {
          const ph = fract(t * 0.42 + bi * 0.27 + (r2[i] < 0.5 ? 0 : 0.5)), rr = 0.03 + ph * 0.27, an = r3[i] * TAU;
          x = B.x + Math.cos(an) * rr; z = B.z + Math.sin(an) * rr;
          a = (1 - ph) * (0.45 + 0.55 * g); c = B.col;
        } else {
          const rr = 0.05 * Math.sqrt(r2[i]), an = r3[i] * TAU;
          x = B.x + Math.cos(an) * rr; z = B.z + Math.sin(an) * rr; y = r4[i] * 0.02;
          a = 0.35 + 0.4 * g * (1 - r2[i]); c = r4[i] < 0.12 ? WHITE : B.col;
        }
        depthFade = false;
      } else if (i < n6) {
        // the router at the centre
        if (r3[i] < 0.1) { x = -0.09 + Math.floor(r4[i] * 4) * 0.06; y = 0.04; z = -0.095; c = r4[i] > 0.75 ? SKY : MINT; a = 1; s = 1.3; }
        else if (r3[i] < 0.26) { const sd = r4[i] < 0.5 ? -1 : 1, h = r2[i] * 0.22; x = sd * (0.1 + h * 0.18); y = 0.085 + h; z = 0.06; a = 0.8; c = LAV; }
        else { boxPt(0.32, 0.085, 0.19, 0, r1[i], r2[i], r4[i]); x = BX; y = BY; z = BZ; a = 0.85; c = r2[i] < 0.2 ? WHITE : LAV; }
        depthFade = false;
      } else {
        // dust
        x = (r0[i] - 0.5) * 3.6; z = (r1[i] - 0.5) * 3.2; y = r2[i] * 1.5 - 0.1;
        a = 0.05 + 0.14 * (0.5 + 0.5 * Math.sin(t * 1.4 + r3[i] * 20)); c = r4[i] < 0.6 ? DIM : VIOLET;
      }
      P(C, x, y, z);
      b.x[i] = PX; b.y[i] = PY; b.c[i] = c; b.s[i] = s;
      b.a[i] = depthFade ? a * (0.5 + 0.5 * front()) : a;
    }
    P(C, 0, 0, 0);
    const rx = PX, ry = PY;
    // beacon labels sit at the top of each light column, pushed away from the router on screen
    const labels = BEACONS.map((B, k) => {
      P(C, B.x, 0.48, B.z);
      const right = PX >= rx;
      return { x: PX + (right ? 0.045 : -0.045), y: PY, o: 0.62 + 0.38 * gB[k], al: right ? 'l' : 'r' };
    });
    labels.push({ x: rx, y: ry + 0.12, o: 1 });
    const glows = [[rx, ry - 0.04, 0.42, VIOLET, 0.32]];
    BEACONS.forEach((B, k) => { P(C, B.x, 0.02, B.z); glows.push([PX, PY, 0.2, B.col, 0.12 + 0.22 * gB[k]]); });
    return { labels, glows };
  },
};

/* ---------- 2: programs streaming packets to the addresses they talk to ---------- */
const PROGS = [
  { name: 'Browser', col: SKY, y: -0.6 },
  { name: 'Cloud sync', col: LAV, y: -0.2 },
  { name: 'Game launcher', col: MINT, y: 0.2 },
  { name: 'Updater', col: AMBER, y: 0.6 },
];
// documentation-range addresses (RFC 5737): illustrative, never real hosts
const DESTS = ['203.0.113.24:443', '198.51.100.7:443', '192.0.2.15:3478', '203.0.113.90:443', '198.51.100.61:443'];
const DY = [-0.68, -0.34, 0, 0.34, 0.68];
const LINKS = [[0, 0, 2.6], [0, 1, 3.4], [1, 3, 3.0], [2, 2, 2.2], [3, 4, 1.4]];
const HOT = 4;
const PX0 = -0.62, DX0 = 0.62;
let QX = 0, QY = 0;
function bez(L, u) {
  const [p, d] = LINKS[L];
  const x0 = PX0 + 0.14, y0 = PROGS[p].y, x3 = DX0 - 0.07, y3 = DY[d];
  const x1 = x0 + 0.5, x2 = x3 - 0.5, v = 1 - u;
  QX = v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3;
  QY = v * v * v * y0 + 3 * v * v * u * y0 + 3 * v * u * u * y3 + u * u * u * y3;
}

const NET = {
  label: 'Illustration: four programs on this computer, Browser, Cloud sync, Game launcher and Updater, streaming packets to the addresses they connect to. The Updater link is highlighted.',
  cap: 'Illustration · example addresses',
  labelSpec: [
    ...PROGS.map((p) => ({ html: p.name, anchor: 'c', cls: 'name' })),
    ...DESTS.map((d, i) => ({ html: d, anchor: 'c', cls: i === HOT ? 'addr warn' : 'addr' })),
    { html: 'this computer', anchor: 'c', cls: 'tag' },
    { html: 'internet', anchor: 'c', cls: 'tag' },
  ],
  frame(F, b, t) {
    const N = F.N, [r0, r1, r2, r3, r4] = F.r;
    const yaw = Math.sin(t * 0.3) * 0.16, cy = Math.cos(yaw), sy = Math.sin(yaw), sc = 0.94;
    const n1 = (N * 0.24) | 0, n2 = (N * 0.36) | 0, n3 = (N * 0.6) | 0, n4 = (N * 0.87) | 0, n5 = (N * 0.92) | 0;
    const proj = (x, y) => { const k = 1 / (1 + x * sy * 0.4); PX = x * cy * k * sc; PY = y * k * sc; };
    for (let i = 0; i < N; i++) {
      let x = 0, y = 0, c = LAV, a = 0.5, s = 1;
      if (i < n1) {
        const k = i & 3, p = PROGS[k], br = 1 + 0.05 * Math.sin(t * 2.2 + k * 1.7);
        const an = r1[i] * TAU;
        if (r0[i] < 0.26) { const rr = 0.135 * br; x = PX0 + Math.cos(an) * rr; y = p.y + Math.sin(an) * rr; a = 0.45; c = p.col; }
        else {
          const q = Math.sqrt(r2[i]), rr = 0.11 * q * br;
          x = PX0 + Math.cos(an) * rr; y = p.y + Math.sin(an) * rr;
          a = 0.5 + 0.5 * (1 - q); c = r3[i] < 0.14 ? WHITE : p.col; s = 1.15;
        }
      } else if (i < n2) {
        const k = (i - n1) % 5, hot = k === HOT, an = r1[i] * TAU;
        if (hot && r4[i] < 0.3) {
          const ph = fract(t * 0.8 + r2[i] * 0.5), rr = 0.055 + ph * 0.09;
          x = DX0 + Math.cos(an) * rr; y = DY[k] + Math.sin(an) * rr; a = (1 - ph) * 0.8; c = AMBER;
        } else if (r0[i] < 0.7) { x = DX0 + Math.cos(an) * 0.055; y = DY[k] + Math.sin(an) * 0.055; a = 0.75; c = hot ? AMBER : LAV; }
        else { const rr = 0.02 * Math.sqrt(r2[i]); x = DX0 + Math.cos(an) * rr; y = DY[k] + Math.sin(an) * rr; a = 1; c = hot ? AMBER : WHITE; }
      } else if (i < n3) {
        const L = (i - n2) % 5;
        bez(L, r1[i]);
        x = QX; y = QY + (r2[i] - 0.5) * 0.016;
        a = 0.16 + 0.16 * r3[i]; c = L === HOT ? AMBER : PROGS[LINKS[L][0]].col;
      } else if (i < n4) {
        const q = i - n3, L = q % 5, pk = ((q / 5) | 0) % 3, e = r1[i], dur = LINKS[L][2];
        let u = fract(t / dur + pk / 3 + L * 0.13) - e * 0.09;
        if (u < 0) { u = 0; a = 0; } else a = Math.pow(1 - e, 1.6) * smooth(clamp(u * 10)) * smooth(clamp((1 - u) * 10));
        bez(L, u);
        x = QX; y = QY + (r2[i] - 0.5) * 0.01 * (1 + e * 2);
        c = e < 0.14 ? WHITE : L === HOT ? AMBER : PROGS[LINKS[L][0]].col; s = 1 + (1 - e) * 0.7;
      } else if (i < n5) {
        // brackets grouping "this computer" and "internet"
        const side = r0[i] < 0.55 ? 0 : 1, gx = side ? DX0 : PX0, gw = side ? 0.2 : 0.22;
        const u = r1[i];
        if (u < 0.5) { x = gx - gw + (u / 0.5) * gw * 2; y = -0.8; }
        else { x = gx - gw + ((u - 0.5) / 0.5) * gw * 2; y = 0.86; }
        a = 0.22; c = DIM;
      } else {
        x = (r0[i] * 2 - 1) * 1.2; y = (r1[i] * 2 - 1) * 1.05;
        a = 0.05 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.2 + r2[i] * 30)); c = r3[i] < 0.7 ? DIM : VIOLET;
      }
      proj(x, y);
      b.x[i] = PX; b.y[i] = PY; b.a[i] = a; b.c[i] = c; b.s[i] = s;
    }
    const labels = [];
    for (const p of PROGS) { proj(PX0, p.y + 0.205); labels.push({ x: PX, y: PY, o: 1 }); }
    DY.forEach((y) => { proj(DX0, y + 0.115); labels.push({ x: PX, y: PY, o: 1 }); });
    proj(PX0, -0.88); labels.push({ x: PX, y: PY, o: 1 });
    proj(DX0, -0.88); labels.push({ x: PX, y: PY, o: 1 });
    const glows = PROGS.map((p) => { proj(PX0, p.y); return [PX, PY, 0.22, p.col, 0.2]; });
    proj(DX0, DY[HOT]); glows.push([PX, PY, 0.16, AMBER, 0.22]);
    return { labels, glows };
  },
};

/* ---------- 3: Wi-Fi spectrum landscape ---------- */
const CH = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165];
const SHOW = [36, 52, 100, 116, 132, 149, 165];
// neighbouring networks: centre (channel index), width in 20 MHz slots, relative signal
const NETS = [
  { c: 1.5, w: 4, h: 0.52 }, { c: 0, w: 1, h: 0.7 }, { c: 0.5, w: 2, h: 0.44 }, { c: 0, w: 1, h: 0.34 },
  { c: 1, w: 1, h: 0.6 }, { c: 0.5, w: 2, h: 0.28 }, { c: 0, w: 1, h: 0.5 }, { c: 2, w: 1, h: 0.4 },
  { c: 5.5, w: 4, h: 0.36 }, { c: 4, w: 1, h: 0.5 }, { c: 9.5, w: 2, h: 0.42 }, { c: 13.5, w: 4, h: 0.24 },
  { c: 21.5, w: 4, h: 0.22 },
];
const NET_CUM = (() => { let s = 0; const out = NETS.map((n) => (s += n.w * n.h)); return out.map((v) => v / s); })();
const FROM = 0, TO = CH.indexOf(149);
// channel axis runs along x; neighbouring networks stand in rows receding along z; yours is the front row
const XS = 1.1, SX = (c) => (-0.9 + ((c + 0.5) / CH.length) * 1.8) * XS;
const HS = 0.74, ZY = -0.3;
const ZROW = [0.08, 0.38, 0.68, 0.98];
const ZGRID = [-0.62, ZY, 0.08, 0.38, 0.68, 0.98, 1.22];
const bell = (u, h) => h * Math.pow(Math.max(0, 1 - u * u), 0.62);
const chPos = (u) => FROM + (TO - FROM) * easeInOut(clamp(u));
function shareAt(pos) { let n = 0; for (const nw of NETS) if (Math.abs(nw.c - pos) < nw.w / 2 + 0.5) n++; return n; }

const SPEC = {
  label: 'Illustration: a 5 GHz channel landscape. Your network, in mint, moves from crowded channel 36 to quiet channel 149.',
  cap: 'Illustration · 5 GHz channels',
  labelSpec: [
    { html: 'Your Wi-Fi', anchor: 'c', cls: 'you' },
    { html: '5 GHz', anchor: 'r', cls: 'tag' },
    { html: '', anchor: 'r', cls: 'hud' },
    ...SHOW.map((ch) => ({ html: String(ch), anchor: 'c', cls: 'ch' })),
    { html: '', anchor: 'c', cls: 'ch on' },
  ],
  frame(F, b, t, u) {
    const N = F.N, [r0, r1, r2, r3, r4] = F.r;
    const pos = chPos(u), moved = clamp((pos - FROM - 0.4) / 3);
    const C = cam(-0.1 + Math.sin(t * 0.13) * 0.05, 0.5, 0.3, 0.92, 0, 0.16);
    const n1 = (N * 0.42) | 0, n2 = (N * 0.56) | 0, n3 = (N * 0.76) | 0, n4 = (N * 0.92) | 0;
    const slot = (1.8 / CH.length) * XS;
    for (let i = 0; i < N; i++) {
      let x = 0, y = 0, z = 0, c = LAV, a = 0.5, s = 1;
      if (i < n2) {
        // neighbours: ridgelines (outline) over a dithered curtain, one row per network group
        let k = 0; const pick = r0[i];
        while (k < NETS.length - 1 && NET_CUM[k] < pick) k++;
        const nw = NETS[k];
        z = ZROW[k % 4] + (r4[i] - 0.5) * 0.025;
        const h = nw.h * (1 + 0.06 * Math.sin(t * 1.7 + k * 1.3)), uu = r1[i] * 2 - 1;
        const f = bell(uu, h) * HS;
        x = SX(nw.c) + (uu * nw.w * slot) / 2;
        if (i < n1) { const v = Math.sqrt(r2[i]); y = f * v; a = 0.1 + 0.36 * v; c = r3[i] < 0.55 ? VIOLET : LAV; }
        else { y = f; a = 0.85; c = r3[i] < 0.15 ? WHITE : LAV; }
      } else if (i < n3) {
        // your network, front row; a faint ghost stays on channel 36 once it has moved
        const uu = r1[i] * 2 - 1, isGhost = r4[i] < 0.2 * moved;
        const cpos = isGhost ? FROM : pos, h = 0.85 * (1 + 0.03 * Math.sin(t * 2.4));
        const f = bell(uu, h) * HS;
        x = SX(cpos) + uu * slot; z = ZY + (r0[i] - 0.5) * 0.03;
        if (isGhost) { y = f; a = 0.3; c = MINT; }
        else if (r2[i] < 0.34) { y = f; a = 1; c = r3[i] < 0.25 ? WHITE : MINT; s = 1.2; }
        else { const v = Math.sqrt(r3[i]); y = f * v; a = 0.25 + 0.6 * v; c = MINT; }
      } else if (i < n4) {
        // the ground: lines along the channel axis at each row, and channel lines running into depth
        if (r0[i] < 0.62) { x = SX(-0.6) + r1[i] * (SX(CH.length - 0.4) - SX(-0.6)); z = ZGRID[(r2[i] * ZGRID.length) | 0]; a = z === ZY ? 0.42 : 0.26; c = z === ZY ? LAV : VIOLET; }
        else { const ci = CH.indexOf(SHOW[(r1[i] * SHOW.length) | 0]); x = SX(ci); z = -0.62 + r2[i] * 1.84; a = 0.2; c = VIOLET; }
      } else {
        x = (r0[i] - 0.5) * 2.6; z = -0.5 + r1[i] * 1.7; y = fract(r2[i] + t * 0.03) * 1.1;
        a = 0.04 + 0.1 * r3[i]; c = r4[i] < 0.6 ? DIM : VIOLET;
      }
      P(C, x, y, z);
      b.x[i] = PX; b.y[i] = PY; b.c[i] = c; b.s[i] = s;
      b.a[i] = a * (0.32 + 0.68 * front());
    }
    const near = Math.round(pos), share = shareAt(pos);
    const hud = `ch ${CH[near]} · ${share} other network${share === 1 ? '' : 's'}`;
    const at = (x, y, z) => { P(C, x, y, z); return { x: PX, y: PY }; };
    const labels = [
      { ...at(SX(pos), 0.85 * HS + 0.12, ZY), o: 1 },
      { ...at(SX(-1.2), 0, -0.74), o: 1 },
      { x: 1.02, y: -0.62, o: 1, text: hud, cls: share > 2 ? 'warn' : 'ok' },
      ...SHOW.map((ch) => { const ci = CH.indexOf(ch); return { ...at(SX(ci), 0, -0.74), o: Math.abs(ci - pos) < 1.4 ? 0 : 1 }; }),
      { ...at(SX(pos), 0, -0.74), o: 1, text: String(CH[near]) },
    ];
    P(C, SX(pos), 0.3, ZY);
    const glows = [[PX, PY, 0.44, MINT, 0.22]];
    return { labels, glows };
  },
};

/* ---------- 4: router with three orbiting AI watchers ---------- */
const ORBS = [
  { name: 'Claude', col: CLAY, R: 1.0, inc: 0.3, nod: 0.25, sp: 0.32, ph: 0.4 },
  { name: 'ChatGPT', col: MINT, R: 0.8, inc: -0.36, nod: -0.6, sp: 0.23, ph: 2.6 },
  { name: 'Grok', col: SKY, R: 0.6, inc: 0.52, nod: 1.3, sp: 0.4, ph: 4.4 },
].map((o) => ({ ...o, ci: Math.cos(o.inc), si: Math.sin(o.inc), cn: Math.cos(o.nod), sn: Math.sin(o.nod) }));
let OX = 0, OY = 0, OZ = 0;
function orbitPt(o, th) {
  const x0 = o.R * Math.cos(th), z0 = o.R * Math.sin(th);
  const y1 = -z0 * o.si, z1 = z0 * o.ci;
  OX = x0 * o.cn + z1 * o.sn; OZ = -x0 * o.sn + z1 * o.cn; OY = y1 + 0.06;
}
const CYCLE = 3.4;

const WATCH = {
  label: 'Illustration: three AI watchers, Claude, ChatGPT and Grok, orbiting your router and taking turns to review it.',
  cap: 'Illustration · three watchers',
  labelSpec: [...ORBS.map((o) => ({ html: o.name, anchor: 'l', cls: 'agent' })), { html: 'your router', anchor: 'c', cls: 'dim' }],
  frame(F, b, t) {
    const N = F.N, [r0, r1, r2, r3, r4] = F.r;
    const C = cam(Math.sin(t * 0.1) * 0.12, 0.62, 0.22, 0.86, 0, 0.06);
    const n1 = (N * 0.12) | 0, n2 = (N * 0.46) | 0, n3 = (N * 0.62) | 0, n4 = (N * 0.8) | 0, n5 = (N * 0.86) | 0;
    const act = Math.floor(t / CYCLE) % 3, phs = fract(t / CYCLE), env = Math.sin(Math.PI * clamp(phs * 1.25));
    const pos = ORBS.map((o) => { orbitPt(o, o.ph + t * o.sp); return [OX, OY, OZ]; });
    const per = Math.ceil((n3 - n2) / 3);
    // the router's screen footprint: anything on the far side of it that lands inside is occluded
    P(C, 0, 0.05, 0);
    const rx = PX, ry = PY;
    const hidden = () => PD > 0.02 && Math.abs(PX - rx) < 0.27 && PY > ry - 0.42 && PY < ry + 0.13;
    const agentHidden = pos.map((p) => { P(C, p[0], p[1], p[2]); return hidden() ? 1 : 0; });
    for (let i = 0; i < N; i++) {
      let x = 0, y = 0, z = 0, c = LAV, a = 0.5, s = 1, flat = false, depthFade = true;
      if (i < n1) {
        if (r3[i] < 0.08) { x = -0.15 + Math.floor(r4[i] * 5) * 0.06; y = 0.05; z = -0.145; c = r4[i] > 0.8 ? SKY : MINT; a = 0.7 + 0.3 * Math.max(0, Math.sin(t * 5 + r4[i] * 9)); s = 1.3; }
        else if (r3[i] < 0.24) { const sd = r4[i] < 0.5 ? -1 : 1, h = r2[i] * 0.34; x = sd * (0.17 + h * 0.2); y = 0.11 + h; z = 0.1; a = 0.85; c = LAV; }
        else { boxPt(0.5, 0.11, 0.29, 0, r1[i], r2[i], r4[i]); x = BX; y = BY; z = BZ; a = 0.9; c = r2[i] < 0.2 ? WHITE : LAV; }
        depthFade = false;
      } else if (i < n2) {
        const o = ORBS[i % 3];
        orbitPt(o, r1[i] * TAU); x = OX; y = OY; z = OZ;
        a = 0.5; c = r2[i] < 0.45 ? o.col : r2[i] < 0.8 ? LAV : VIOLET;
      } else if (i < n3) {
        const q = i - n2, k = q % 3, j = (q / 3) | 0, o = ORBS[k], p = pos[k];
        const fl = k === act ? env : 0;
        const ph = Math.acos(1 - (2 * (j + 0.5)) / per), th = j * 2.39996 + t * 0.7;
        const rr = 0.07 * (0.55 + 0.45 * r1[i]) * (1 + 0.35 * fl);
        x = p[0] + Math.sin(ph) * Math.cos(th) * rr; y = p[1] + Math.cos(ph) * rr; z = p[2] + Math.sin(ph) * Math.sin(th) * rr;
        a = 0.3 + 0.35 * r3[i] + 0.2 * fl; c = r2[i] < 0.04 + 0.1 * fl ? WHITE : o.col; s = 1.1;
      } else if (i < n4) {
        const k = i % 3, o = ORBS[k], lag = r1[i] * 1.2;
        orbitPt(o, o.ph + t * o.sp - lag);
        x = OX + (r2[i] - 0.5) * 0.02; y = OY + (r3[i] - 0.5) * 0.02; z = OZ;
        a = Math.pow(1 - lag / 1.2, 2) * 0.8; c = lag < 0.05 ? WHITE : o.col;
      } else if (i < n5) {
        const p = pos[act], u = fract(r1[i] + t * 0.9);
        x = p[0] + (0 - p[0]) * u; y = p[1] + (0.13 - p[1]) * u; z = p[2] + (0 - p[2]) * u;
        a = env * (0.35 + 0.6 * r2[i]) * smooth(clamp(u * 6)); c = ORBS[act].col;
        depthFade = false;
      } else {
        x = (r0[i] * 2 - 1) * 1.2; y = (r1[i] * 2 - 1) * 1.05;
        a = 0.05 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.3 + r2[i] * TAU)); c = r3[i] < 0.3 ? WHITE : DIM; flat = true;
      }
      if (flat) { b.x[i] = x; b.y[i] = y; b.a[i] = a; }
      else {
        P(C, x, y, z);
        if (i >= n1 && i < n4 && hidden()) a *= 0.1;
        b.x[i] = PX; b.y[i] = PY; b.a[i] = depthFade ? a * (0.45 + 0.55 * front()) : a;
      }
      b.c[i] = c; b.s[i] = s;
    }
    // agent labels sit on the outside of each cluster and fade while it passes behind the router
    const labels = pos.map((p, k) => {
      P(C, p[0], p[1], p[2]);
      const right = PX >= rx;
      const o = (0.7 + 0.3 * front() + (k === act ? 0.2 * env : 0)) * (agentHidden[k] ? 0.06 : 1);
      return { x: PX + (right ? 0.1 : -0.1), y: PY, o, al: right ? 'l' : 'r' };
    });
    P(C, 0, 0, 0);
    labels.push({ x: PX, y: PY + 0.15, o: 1 });
    const glows = [[PX, PY - 0.03, 0.5, VIOLET, 0.34]];
    pos.forEach((p, k) => {
      P(C, p[0], p[1], p[2]);
      const dim = agentHidden[k] ? 0.15 : 1;
      glows.push([PX, PY, 0.2 + (k === act ? 0.08 * env : 0), ORBS[k].col, (0.22 + (k === act ? 0.25 * env : 0)) * dim]);
    });
    return { labels, glows };
  },
};

const FORMS = [RADAR, NET, SPEC, WATCH];
// what each still frame shows: the sweep just past TR-069, packets mid-flight, the quiet channel, Claude reviewing
const STILL_T = [(BEACONS[0].a + 0.3) / SWEEP, 1.3, 0, 1.4];

/* ======================================================================================
   Field: one canvas, N square pixels on a 3px grid, brightness dithered with a 4x4 Bayer matrix,
   drawn in one path per colour/brightness bucket with additive blending.

   Morphs: every particle travels a path, not a straight line. The outgoing shape spins into a
   tilted vortex ring around the centre (radius pulled towards a ring, angle advanced by one full
   turn), then unfurls into the incoming shape, so a silhouette is always readable. Fast particles
   leave a short streak along their own direction of travel (capped at 3x the pixel size).
   ====================================================================================== */
const SPR = [];
function glowSprite(ci) {
  if (SPR[ci]) return SPR[ci];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), [r, gg, b] = rgb(PAL[ci]);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return (SPR[ci] = c);
}
const defaultStage = (W, H) => ({ cx: W / 2, cy: H / 2, S: (Math.min(W, H * 1.08) / 2) * 0.9 });

class Field {
  constructor(figure, forms, { density = 30, maxN = 9000, stage = defaultStage } = {}) {
    this.fig = figure;
    this.cv = figure.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.layer = figure.querySelector('.ft-labels');
    this.forms = forms;
    this.stage = stage;
    this.W = 0; this.H = 0; this.S = 1; this.cx = 0; this.cy = 0; this.dpr = 1; this.G = 3;
    this.measure();
    const N = (this.N = Math.round(clamp((this.W * this.H) / density, 2400, maxN)));
    this.r = [1, 2, 3, 4, 5].map((k) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = hash(i + 1, k); return a; });
    this.A = mkBuf(N); this.B = mkBuf(N); this.O = mkBuf(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N);
    this.ring = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.r[0][i], b = this.r[1][i];
      // most particles form a thick ring, a few are flung wider as debris
      this.ring[i] = b < 0.16 ? 0.86 + a * 0.42 : 0.5 + (a - 0.5) * 0.36;
    }
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pw = new Float32Array(N);
    this.bk = new Uint8Array(N); this.ord = new Int32Array(N); this.cnt = new Int32Array(NB + 1); this.nst = new Int32Array(NB);
    this.buildLabels();
  }
  measure() {
    const r = this.cv.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    const st = this.stage(this.W, this.H);
    this.cx = st.cx; this.cy = st.cy; this.S = st.S;
    this.G = this.W < 420 ? 2.5 : 3;
  }
  buildLabels() {
    this.lab = this.forms.map((f) => f.labelSpec.map((spec) => {
      const el = document.createElement('span');
      el.className = `ft-lb ft-lb--${spec.anchor} ${spec.cls.split(' ').map((c) => `is-${c}`).join(' ')}`;
      const inner = document.createElement('span');
      inner.innerHTML = spec.html;
      el.appendChild(inner);
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
      this.layer.appendChild(el);
      return { el, inner, o: 0, x: NaN, y: NaN, text: spec.html, cls: '', al: spec.anchor };
    }));
  }
  setLabels(fi, scene, w) {
    const list = this.lab[fi];
    const cx = this.cx, cy = this.cy, S = this.S;
    for (let k = 0; k < list.length; k++) {
      const L = list[k], d = scene ? scene.labels[k] : null;
      const o = d ? Math.round(clamp(w * d.o) * 100) / 100 : 0;
      if (o !== L.o) { L.el.style.opacity = String(o); L.el.style.visibility = o > 0 ? '' : 'hidden'; L.o = o; }
      if (!d || o <= 0) continue;
      const x = Math.round(cx + d.x * S), y = Math.round(cy + d.y * S);
      if (x !== L.x || y !== L.y) { L.el.style.transform = `translate3d(${x}px,${y}px,0)`; L.x = x; L.y = y; }
      if (d.text !== undefined && d.text !== L.text) { L.inner.textContent = d.text; L.text = d.text; }
      if (d.cls !== undefined && d.cls !== L.cls) {
        if (L.cls) L.el.classList.remove(`is-${L.cls}`);
        L.el.classList.add(`is-${d.cls}`); L.cls = d.cls;
      }
      if (d.al !== undefined && d.al !== L.al) {
        L.el.classList.remove(`ft-lb--${L.al}`);
        L.el.classList.add(`ft-lb--${d.al}`); L.al = d.al;
      }
    }
  }
  /* draw formations ia -> ib blended by k (0..1), with a flare pulse 0..1 */
  draw(ia, ib, k, t, u, pulse) {
    const N = this.N, A = this.A, B = this.B, r = this.r;
    const sa = this.forms[ia].frame(this, A, t, u);
    let O = A, sb = null;
    const blending = ib !== ia && k > 0.0005;
    const vx = this.vx, vy = this.vy;
    if (blending) {
      sb = this.forms[ib].frame(this, B, t, u);
      O = this.O;
      const r2 = r[2], r3 = r[3], r4 = r[4], ring = this.ring;
      const spin = (ia & 1 ? -1 : 1) * TAU;
      let QXp = 0, QYp = 0;
      const path = (ax, ay, bx, by, q, R, jit) => {
        const lx = ax + (bx - ax) * q, ly = ay + (by - ay) * q;
        const w = Math.sin(Math.PI * q);
        const rad = Math.sqrt(lx * lx + ly * ly), th = Math.atan2(ly, lx);
        const rr = rad + (R - rad) * w * 0.86;
        const an = th + spin * q * q * (3 - 2 * q) + jit * w;
        QXp = Math.cos(an) * rr;
        QYp = Math.sin(an) * rr * (1 - 0.55 * w);
      };
      for (let i = 0; i < N; i++) {
        let q = clamp((k - 0.2 * r3[i]) / 0.8); q = q * q * (3 - 2 * q);
        const ax = A.x[i], ay = A.y[i], bx = B.x[i], by = B.y[i], R = ring[i], jit = (r2[i] - 0.5) * 0.7;
        path(ax, ay, bx, by, q, R, jit);
        const x = QXp, y = QYp;
        if (pulse > 0.01 && q > 0.002 && q < 0.998) {
          path(ax, ay, bx, by, Math.max(0, q - 0.04), R, jit);
          vx[i] = x - QXp; vy[i] = y - QYp;
        } else { vx[i] = 0; vy[i] = 0; }
        const w = Math.sin(Math.PI * q);
        O.x[i] = x; O.y[i] = y;
        O.a[i] = A.a[i] + (B.a[i] - A.a[i]) * q + w * 0.05;
        O.s[i] = A.s[i] + (B.s[i] - A.s[i]) * q;
        O.c[i] = q > r4[i] ? B.c[i] : A.c[i];
      }
    }

    const ctx = this.ctx, W = this.W, H = this.H, S = this.S, cx = this.cx, cy = this.cy, G = this.G;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);

    // soft glows under the pixels: pre-baked radial sprites, scaled and faded
    const glow = (list, w) => {
      if (!list || w <= 0.01) return;
      for (const [gx, gy, gr, gc, ga] of list) {
        const a = ga * w;
        if (a <= 0.004) continue;
        const x = cx + gx * S, y = cy + gy * S, R = gr * S;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(glowSprite(gc), x - R, y - R, R * 2, R * 2);
      }
      ctx.globalAlpha = 1;
    };
    ctx.globalCompositeOperation = 'lighter';
    glow(sa.glows, blending ? 1 - k : 1);
    if (sb) glow(sb.glows, k);

    // bucket the pixels by colour x dithered brightness (counting sort), then one path per bucket
    const cnt = this.cnt, nst = this.nst; cnt.fill(0); nst.fill(0);
    const bk = this.bk, px = this.px, py = this.py, pw = this.pw;
    const base = G - 1, streaks = blending && pulse > 0.01, maxL = base * 2;
    for (let i = 0; i < N; i++) {
      const a = O.a[i];
      if (a <= 0.02) { bk[i] = 255; continue; }
      const gx = Math.round((cx + O.x[i] * S) / G), gy = Math.round((cy + O.y[i] * S) / G);
      const X = gx * G, Y = gy * G;
      if (X < -4 || Y < -4 || X > W + 4 || Y > H + 4) { bk[i] = 255; continue; }
      const l = Math.min(4, (a * 4 + BAYER[(gx & 3) | ((gy & 3) << 2)]) | 0);
      if (l === 0) { bk[i] = 255; continue; }
      const b = O.c[i] * 4 + l - 1;
      bk[i] = b; cnt[b + 1]++;
      px[i] = X; py[i] = Y; pw[i] = Math.max(1, Math.round(base * O.s[i]));
      if (streaks) {
        // trail along the particle's own velocity; grows with speed, capped (head + 2x = 3x)
        const dx = vx[i] * S, dy = vy[i] * S, len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1.5) {
          const L = (Math.min(maxL, len * 0.45) * pulse) / len;
          vx[i] = dx * L; vy[i] = dy * L; nst[b]++;
        } else { vx[i] = 0; vy[i] = 0; }
      }
    }
    for (let b = 1; b <= NB; b++) cnt[b] += cnt[b - 1];
    const ord = this.ord, start = cnt.slice(0, NB);
    for (let i = 0; i < N; i++) { const b = bk[i]; if (b !== 255) ord[start[b]++] = i; }
    ctx.lineWidth = base;
    ctx.lineCap = 'butt';
    for (let b = 0; b < NB; b++) {
      const from = cnt[b], to = cnt[b + 1];
      if (to <= from) continue;
      ctx.fillStyle = FILLS[b];
      ctx.beginPath();
      for (let j = from; j < to; j++) {
        const i = ord[j], w = pw[i];
        ctx.rect(px[i] - w / 2, py[i] - w / 2, w, w);
      }
      ctx.fill();
      if (streaks && nst[b]) {
        ctx.strokeStyle = FILLS[b];
        ctx.beginPath();
        for (let j = from; j < to; j++) {
          const i = ord[j];
          if (vx[i] === 0 && vy[i] === 0) continue;
          ctx.moveTo(px[i], py[i]);
          ctx.lineTo(px[i] - vx[i], py[i] - vy[i]);
        }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // labels: the outgoing set fades fast, the incoming one arrives near the end of the morph
    const wa = blending ? clamp(1 - k * 3.5) : 1, wb = blending ? clamp((k - 0.8) * 5) : 0;
    for (let fi = 0; fi < this.forms.length; fi++) {
      if (fi === ia) this.setLabels(fi, sa, wa);
      else if (fi === ib && sb) this.setLabels(fi, sb, wb);
      else this.setLabels(fi, null, 0);
    }
  }
}

/* ======================================================================================
   Copy (unchanged facts)
   ====================================================================================== */
const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const KEY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16.5 6.5l2.5 2.5M14 9l2 2"/></svg>';

const ROWS = [
  {
    id: 'backdoors',
    kicker: 'Backdoors',
    title: 'Close the backdoors',
    body:
      'One scan checks your router from the inside for the ways in that are usually left open: provider remote management (TR-069 on port 7547), UPnP port-forwards, Telnet, a plain-HTTP admin page and unencrypted DNS. Each finding comes with the evidence Bastion saw and the exact steps to close it.',
    points: [
      'Never logs in to the router and never tries a password',
      'Guided fixes: the steps, plus a button that opens the right settings page',
      'Says “unknown” when it can’t measure something, instead of guessing',
    ],
  },
  {
    id: 'traffic',
    kicker: 'Connections',
    title: 'See which apps talk to the internet',
    body:
      'A live view of this computer’s connections: which program is talking to which address and port, right now. It is the quickest way to spot the updater that never sleeps or the app that calls home more often than you expected.',
    points: [
      'Per program, live, on this computer',
      'Nothing to install on your router',
      'Phones, TVs and other devices need router integration, which is on the roadmap',
    ],
  },
  {
    id: 'wifi',
    kicker: 'Wi-Fi',
    title: 'Faster Wi-Fi on the same router',
    body:
      'Bastion surveys the networks around you, shows how crowded each channel is and recommends a quieter one, with the count of networks behind the advice. Then a real speed test, with ping, jitter, download and upload, so you can compare before and after.',
    points: [
      'Channel advice from the networks your computer can actually hear',
      'Speed test against Cloudflare, only when you press Run',
      'No new hardware, no extender, no subscription',
    ],
  },
  {
    id: 'agents',
    kicker: 'AI watchers',
    title: 'AI watchers, with your own key',
    body:
      'Connect Claude, ChatGPT or Grok with your own API key. They read a snapshot of your scan and answer plain questions like “is anything here dangerous?” or “why is my Wi-Fi slow in the evening?”, then suggest fixes. Nothing changes unless you make the change.',
    points: [
      'Bring your own key from Anthropic, OpenAI or xAI',
      'MAC addresses, device and Wi-Fi names are removed before anything is sent',
      'Agents can’t change anything on your computer or router',
    ],
  },
];
const ACCENT = ['coral', 'sky', 'mint', 'clay'];
const num = (i) => String(i + 1).padStart(2, '0');
const words = (s) => s.split(' ').map((w, i) => `<span class="ft-w"><span style="--wi:${i}">${w}</span></span>`).join(' ');

function figureHTML(cls, i, extra = '') {
  return `
    <figure class="${cls}" role="img" aria-label="${FORMS[i].label}" data-accent="${ACCENT[i]}">
      <div class="ft-halo" aria-hidden="true"></div>
      <canvas class="ft-canvas" aria-hidden="true"></canvas>
      <div class="ft-labels" aria-hidden="true"></div>${extra}
      <figcaption class="ft-cap mono" aria-hidden="true">${FORMS[i].cap}</figcaption>
    </figure>`;
}
const keyPill = (i) => (i === 3 ? `<span class="ft-key" aria-hidden="true">${KEY}Bring your own key</span>` : '');

/* ---------- story timeline: 4 holds and 3 morphs over the pinned scroll ---------- */
const HOLD = 0.19, MORPH = (1 - 4 * HOLD) / 3;
function storyAt(p) {
  for (let i = 0; i < 4; i++) {
    const st = i * (HOLD + MORPH);
    if (p < st + HOLD || i === 3) return { s: i, local: clamp((p - st) / HOLD) };
    if (p < st + HOLD + MORPH) return { s: i + easeInOut((p - st - HOLD) / MORPH), local: 1 };
  }
  return { s: 3, local: 1 };
}
const stepCentre = (i) => i * (HOLD + MORPH) + HOLD * (i === 2 ? 0.8 : 0.5);

/* ======================================================================================
   mount
   ====================================================================================== */
export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'features-title');

  const steps = ROWS.map((r, i) => `
        <article class="ft-step${i === 0 ? ' is-active' : ''}" id="feature-${r.id}" data-i="${i}" data-accent="${ACCENT[i]}" aria-labelledby="ft-${r.id}-t">
          <div class="ft-copy">
            <p class="ft-kicker mono"><span class="ft-kicker__n">${num(i)}</span><span class="ft-kicker__l">${r.kicker}</span></p>
            <h3 class="display-m ft-title" id="ft-${r.id}-t">${words(r.title)}</h3>
            <p class="ft-body">${r.body}</p>
            <ul class="ft-points" role="list">
              ${r.points.map((p, k) => `<li style="--pi:${k}">${CHECK}<span>${p}</span></li>`).join('')}
            </ul>
          </div>
          ${figureHTML('ft-still', i, keyPill(i))}
        </article>`).join('');

  el.innerHTML = `
    <div class="container">
      <header class="sec-head ft-head" data-reveal>
        <p class="eyebrow">What Bastion does</p>
        <h2 class="display-l" id="features-title">Four jobs, done on your computer</h2>
        <p class="lead">Each one runs locally, explains what it found in plain language, and leaves every decision to you.</p>
      </header>
    </div>
    <div class="ft-story">
      <div class="ft-pin">
        <div class="ft-bg" aria-hidden="true"><i data-b="0"></i><i data-b="1"></i><i data-b="2"></i><i data-b="3"></i></div>
        <div class="ft-right">
          <div class="ft-num" aria-hidden="true"><span class="ft-num__col">${ROWS.map((_, i) => `<span data-accent="${ACCENT[i]}">${num(i)}</span>`).join('')}</span></div>
          ${figureHTML('ft-visual', 0, `
            <div class="ft-flare" aria-hidden="true"><i class="ft-flare__halo"></i><i class="ft-flare__streak"></i><i class="ft-flare__core"></i><i class="ft-flare__ghost"></i></div>
            <span class="ft-key ft-key--story" aria-hidden="true">${KEY}Bring your own key</span>`)}
        </div>
        <div class="container ft-grid">
          <div class="ft-left">
            <nav class="ft-rail" aria-label="Feature steps">
              <span class="ft-rail__track" aria-hidden="true"><span class="ft-rail__fill"></span></span>
              <ol role="list">
                ${ROWS.map((r, i) => `<li><button type="button" class="ft-rail__btn" data-go="${i}" data-accent="${ACCENT[i]}"${i === 0 ? ' aria-current="step"' : ''}><span class="ft-rail__dot" aria-hidden="true"></span><span class="ft-rail__n mono" aria-hidden="true">${num(i)}</span><span class="sr-only">${r.title}</span></button></li>`).join('')}
              </ol>
            </nav>
            <div class="ft-steps">
              ${steps}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  reveal(el.querySelector('.ft-head'));

  const wantStory = () => motionOK() && window.innerWidth >= 960 && window.innerHeight >= 600;
  let mode = '';
  let teardown = () => {};
  const apply = () => {
    const next = wantStory() ? 'story' : 'stack';
    if (next === mode) return;
    teardown();
    mode = next;
    el.classList.toggle('ft--story', mode === 'story');
    teardown = mode === 'story' ? storyMode(el) : stackMode(el);
    requestRefresh();
  };
  apply();
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(apply, 200); });
  const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (rm && rm.addEventListener) rm.addEventListener('change', apply);
}

/* ---------- stacked mode (narrow, touch, reduced motion) ----------
   Motion allowed: each still is a light live field (~4k pixels, 30fps). It is created when it
   scrolls into view, the dust gathers into the formation, and only on-screen stills animate.
   Reduced motion: the finished formation is rendered once, no loop. */
function stackMode(el) {
  const figs = [...el.querySelectorAll('.ft-still')];
  const live = !isReduced();
  const states = new Map();
  const ensure = (fig) => {
    let s = states.get(fig);
    if (!s) {
      const i = Number(fig.closest('.ft-step').dataset.i);
      fig.querySelector('.ft-labels').textContent = '';
      const f = live ? new Field(fig, [SCATTER, FORMS[i]], { density: 22, maxN: 4200 }) : new Field(fig, [FORMS[i]], { density: 26, maxN: 9000 });
      s = { f, i, t: STILL_T[i], rev: 0, on: false };
      states.set(fig, s);
    }
    return s;
  };
  const paintStatic = (s) => s.f.draw(0, 0, 0, STILL_T[s.i], 1, 0);
  const paintLive = (s) => {
    const e = smooth(s.rev);
    if (e < 1) s.f.draw(0, 1, e, s.t, 1, 0.55 * Math.sin(Math.PI * e));
    else s.f.draw(1, 1, 0, s.t, 1, 0);
  };

  let raf = 0, last = 0, acc = 0;
  const tick = (now) => {
    raf = 0;
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000 || 0));
    last = now;
    acc += dt;
    if (acc >= 1 / 32) {
      for (const s of states.values()) {
        if (!s.on) continue;
        s.t += acc;
        // the reveal runs on wall-clock time, so a throttled frame rate can't leave it half-gathered
        if (!s.t0) s.t0 = now;
        s.rev = clamp((now - s.t0) / 1700);
        paintLive(s);
      }
      acc = 0;
    }
    kick();
  };
  const kick = () => {
    let any = false;
    for (const s of states.values()) if (s.on) { any = true; break; }
    const want = live && any && !document.hidden;
    if (want && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    else if (!want && raf) { cancelAnimationFrame(raf); raf = 0; }
  };

  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (live) {
          if (e.isIntersecting) ensure(e.target).on = true;
          else if (states.has(e.target)) states.get(e.target).on = false;
        } else if (e.isIntersecting) { io.unobserve(e.target); paintStatic(ensure(e.target)); }
      }
      kick();
    }, { rootMargin: live ? '0px' : '300px 0px' });
    figs.forEach((f) => io.observe(f));
  } else figs.forEach((f) => { const s = ensure(f); s.rev = 1; if (live) paintLive(s); else paintStatic(s); });

  const redraw = () => states.forEach((s) => { s.f.measure(); if (live) paintLive(s); else paintStatic(s); });
  let lastW = 0, rt = 0;
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => {
    const w = el.clientWidth;
    if (w === lastW) return;
    lastW = w;
    clearTimeout(rt);
    rt = setTimeout(redraw, 150);
  }) : null;
  if (ro) ro.observe(el);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!live) redraw(); });
  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);

  return () => {
    if (io) io.disconnect();
    if (ro) ro.disconnect();
    clearTimeout(rt);
    cancelAnimationFrame(raf); raf = 0;
    document.removeEventListener('visibilitychange', onVis);
    figs.forEach((f) => { f.querySelector('.ft-labels').textContent = ''; });
  };
}

/* ---------- story mode: sticky pin, scroll-scrubbed morphs ---------- */
function storyMode(el) {
  const story = el.querySelector('.ft-story');
  const fig = el.querySelector('.ft-visual');
  const stepsEls = [...el.querySelectorAll('.ft-step')];
  const railBtns = [...el.querySelectorAll('.ft-rail__btn')];
  const fill = el.querySelector('.ft-rail__fill');
  const numCol = el.querySelector('.ft-num__col');
  const bgs = [...el.querySelectorAll('.ft-bg i')];
  const flareEl = el.querySelector('.ft-flare');
  const cap = fig.querySelector('.ft-cap');
  const keyEl = fig.querySelector('.ft-key--story');

  const numEl = el.querySelector('.ft-num');
  let field = null, raf = 0, visible = false, t = 0, last = 0, q = NaN, active = 0, kNow = 1;
  const cache = {};
  const set = (k, elx, prop, v) => { if (cache[k] !== v) { cache[k] = v; elx.style.setProperty(prop, v); } };

  const metrics = () => {
    const r = story.getBoundingClientRect(), vh = window.innerHeight;
    return { top: r.top, travel: Math.max(1, r.height - vh), vh, abs: r.top + window.scrollY };
  };

  function setActive(n, dir) {
    if (n === active) return;
    const prev = active;
    active = n;
    stepsEls.forEach((s, i) => {
      s.classList.toggle('is-active', i === n);
      s.classList.toggle('is-out', i === prev);
      s.dataset.dir = dir;
    });
    clearTimeout(setActive.t);
    setActive.t = setTimeout(() => stepsEls.forEach((s) => s.classList.remove('is-out')), 700);
    railBtns.forEach((b, i) => { if (i === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    fig.setAttribute('aria-label', FORMS[n].label);
    fig.dataset.accent = ACCENT[n];
    cap.textContent = FORMS[n].cap;
  }

  let idleSkip = false;
  function frame(now) {
    raf = 0;
    const realDt = Math.max(0, (now - last) / 1000 || 0), dt = Math.min(0.05, realDt);
    last = now;
    t += dt;
    const m = metrics();
    const target = -m.top / m.vh;
    // light extra smoothing on top of the (optional) smooth scroll; real time, so it always settles
    const settled = !Number.isNaN(q) && Math.abs(target - q) < 0.0004;
    q = Number.isNaN(q) ? target : q + (target - q) * (1 - Math.exp(-realDt * 12));
    if (Math.abs(target - q) < 0.0004) q = target;
    // scroll at rest and no morph on screen: the ambient animation drops to 30fps
    if (settled && kNow === 0) {
      idleSkip = !idleSkip;
      if (idleSkip) { loop(); return; }
    } else idleSkip = false;

    let ia, ib, k, pulse, s, u = 0, p = 0;
    if (q < 0) {
      // the story approaching: dust gathers into the radar
      const e = smooth(clamp(1 + q * 1.15));
      ia = 0; ib = 1; k = e; pulse = 0.25 * Math.sin(Math.PI * e); s = 0;
      if (e >= 1) { ia = 1; k = 0; }
    } else {
      p = clamp((q * m.vh) / m.travel);
      const st = storyAt(p);
      s = st.s;
      const fl = Math.floor(s);
      ia = 1 + fl; ib = Math.min(4, ia + 1); k = s - fl;
      pulse = k > 0 ? Math.sin(Math.PI * k) : 0;
      // Wi-Fi step: hold the crowded channel 36 for the first third of the step, then glide
      u = s < 2 ? 0 : s > 2 ? 1 : smooth(clamp((st.local - 0.3) / 0.55));
      if (k === 0) ib = ia;
    }
    kNow = k;
    field.draw(ia, ib, k, t, u, pulse);

    const n = Math.min(3, Math.round(s));
    setActive(n, n > active ? 'down' : 'up');
    set('fill', fill, '--p', p.toFixed(4));
    set('num', numCol, '--s', s.toFixed(3));
    set('numk', numEl, '--k', pulse.toFixed(3));
    bgs.forEach((b, j) => set(`bg${j}`, b, '--w', clamp(1 - Math.abs(s - j) * 1.2).toFixed(3)));
    set('flare', flareEl, '--f', pulse.toFixed(3));
    set('key', keyEl, '--w', clamp((s - 2.6) * 2.5).toFixed(3));
    if (ib !== ia) flareEl.dataset.accent = ACCENT[Math.max(0, ib - 1)];

    loop();
  }
  function loop() {
    const want = visible && !document.hidden && field;
    if (want && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!want && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      visible = e.isIntersecting;
      if (visible && !field) {
        fig.querySelector('.ft-labels').textContent = '';
        // the visual bleeds full-height and past the right edge; formations sit right of centre,
        // centred in the frame below the nav. Fewer pixels on dense (DPR 2) screens.
        field = new Field(fig, [SCATTER, ...FORMS], {
          density: 30,
          maxN: (window.devicePixelRatio || 1) >= 1.5 ? 8000 : 11000,
          stage: (W, H) => ({ cx: W * 0.56, cy: H / 2 + 28, S: (Math.min(W * 0.68, H - 150) / 2) * 0.95 }),
        });
      }
    }
    loop();
  }, { rootMargin: '60% 0px' });
  io.observe(story);

  const ro = new ResizeObserver(() => { if (field) field.measure(); });
  ro.observe(fig.querySelector('canvas'));
  const onVis = () => loop();
  document.addEventListener('visibilitychange', onVis);

  const onGo = (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const i = Number(b.dataset.go), mt = metrics();
    scrollToTarget(Math.round(mt.abs + stepCentre(i) * mt.travel));
  };
  el.querySelector('.ft-rail').addEventListener('click', onGo);

  return () => {
    io.disconnect(); ro.disconnect();
    cancelAnimationFrame(raf); raf = 0;
    document.removeEventListener('visibilitychange', onVis);
    el.querySelector('.ft-rail').removeEventListener('click', onGo);
    stepsEls.forEach((s, i) => { s.classList.toggle('is-active', i === 0); s.classList.remove('is-out'); });
    fig.querySelector('.ft-labels').textContent = '';
  };
}
