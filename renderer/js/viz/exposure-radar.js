// Shield exposure radar. A glass disc seen at a three-quarter angle with the router as a luminous
// core; every scan check is a beacon placed by category angle and status radius (exposed checks
// sit near the WAN edge, sealed ones close to the core). A sweep lights each finding as it passes.
//
// This module owns state, animation timing, interaction (parallax, drag, hover, click) and the
// crisp HTML label layer with leader lines. Drawing is delegated to an engine: WebGL
// (exposure-radar-gl.js, loaded on demand) or the Canvas 2D fallback (exposure-radar-2d.js),
// which also takes over when a lost WebGL context does not come back.
//
// Labels stay quiet: an open finding (and a running check) is always labelled, a finding to
// review appears as the sweep passes it and fades a few seconds later, everything else shows on
// hover. Labels sit beside their beacon, never on its pillar, and glide when they move.
//
// createExposureRadar(host, { onHover(id|null), onSelect(id) }) ->
//   { setData({ checks, devices, gateway, scanning, progress, hasReport }), setHighlight(id|null), dispose() }
// checks: [{ id, title, status, state: 'done'|'checking'|'pending', evidence }] (pending is not drawn)
// devices: [{ key, self: boolean }]

import { createCanvasEngine } from './exposure-radar-2d.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const CHECK_ORDER = ['tr069', 'upnp', 'dns-plaintext', 'admin-default', 'wps', 'telnet', 'ssh',
  'web-admin-http', 'location-map', 'mac-privacy', 'wifi-security', 'unknown-devices'];
const SHORT = {
  tr069: 'TR-069', upnp: 'UPnP', 'dns-plaintext': 'DNS', 'admin-default': 'Admin login', wps: 'WPS',
  telnet: 'Telnet', ssh: 'SSH', 'web-admin-http': 'HTTP admin', 'location-map': 'Location maps',
  'mac-privacy': 'MAC privacy', 'wifi-security': 'Wi-Fi security', 'unknown-devices': 'Devices',
};
// Colour and dot carry the status; only an open finding spells it out.
const WORD = { risk: 'Open' };
// Exposure radius: the more reachable a finding, the closer it sits to the WAN edge.
const RADIUS = { risk: 0.84, warn: 0.67, unknown: 0.52, checking: 0.52, ok: 0.37 };
const PRIORITY = { checking: 0, risk: 1, warn: 2, unknown: 3, ok: 4 };
const REST_EL = 36 * DEG;
const EL_MIN = 22 * DEG;
const EL_MAX = 52 * DEG;
const AZ_LIM = 38 * DEG;
const SPEED_IDLE = TAU / 10;
const SPEED_SCAN = TAU / 2.6;
const REDUCED_SWEEP = -52 * DEG;
const WARN_LINGER = 3.4; // seconds a label to review stays after the sweep passes its beacon
const LOST_GRACE = 2500; // ms to wait for a lost WebGL context before switching to 2D
const GAP = 12; // minimum clear space between two labels, px

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);

function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

export function checkAngle(id) {
  const i = CHECK_ORDER.indexOf(id);
  if (i >= 0) return (-90 + i * (360 / CHECK_ORDER.length) + 8) * DEG;
  return (-90 + hash(id) * 360) * DEG;
}

// First port mentioned in the evidence ("TCP 192.168.1.1:23 answers", "port 7547").
function portOf(evidence) {
  const s = String(evidence || '');
  const m = s.match(/\b(?:\d{1,3}\.){3}\d{1,3}:(\d{1,5})\b/) || s.match(/\bport\s+(\d{1,5})\b/i);
  return m ? m[1] : '';
}

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const t = (n, f) => {
    const v = cs.getPropertyValue(n).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : f;
  };
  return {
    text: t('--text', '#F3F0FF'), muted: t('--muted', '#ABA6CB'), dim: t('--dim', '#857FA9'),
    violet: t('--violet', '#7C6CFF'), lavender: t('--lavender', '#B7A9FF'), sky: t('--sky', '#8FD3FF'),
    mint: t('--mint', '#9EF0C4'), coral: t('--coral', '#FF8E7A'), amber: t('--amber', '#FFC772'),
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Label candidates: always beside the beacon (left or right), at a few leader lengths and
// vertical offsets, so a label never sits on its own pillar.
const CANDS = [];
for (const len of [14, 28, 46, 70]) {
  for (const dy of [0, -0.75, 0.75, -1.5, 1.5]) for (const side of [1, -1]) CANDS.push({ len, dy, side });
}

export function createExposureRadar(host, opts = {}) {
  const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(reducedQuery && reducedQuery.matches);
  const pal = readPalette();

  host.classList.add('rx');
  host.innerHTML = `
    <div class="rx-stage" data-rx-stage>
      <svg class="rx-leaders" aria-hidden="true"></svg>
      <div class="rx-layer" aria-hidden="true">
        <div class="rx-core-label" data-rx-core></div>
        <div class="rx-empty" data-rx-empty hidden><b>No scan yet</b><span>Run a deep scan to map what can reach your router.</span></div>
      </div>
    </div>`;
  const stage = host.querySelector('[data-rx-stage]');
  const svg = host.querySelector('.rx-leaders');
  const layer = host.querySelector('.rx-layer');
  const coreLabel = host.querySelector('[data-rx-core]');
  const emptyEl = host.querySelector('[data-rx-empty]');

  const st = {
    disposed: false,
    engine: null,
    raf: 0,
    queued: false,
    lastNow: 0,
    time: 0,
    sweep: REDUCED_SWEEP,
    speed: SPEED_IDLE,
    inView: true,
    focused: typeof document.hasFocus === 'function' ? document.hasFocus() : true,
    w: 0,
    h: 0,
    az: 0, el: REST_EL, // current
    dragAz: 0, dragEl: REST_EL, // user rotation target
    px: 0, py: 0, tpx: 0, tpy: 0, // parallax
    drag: null,
    hoverId: null,
    extId: null,
    data: { checks: [], devices: [], gateway: '', scanning: false, progress: 0, hasReport: false },
    started: false,
    pingAt: -10,
    dt: 0,
  };
  const beacons = new Map(); // id -> { id, name, status, port, angle, radius, x, z, born, hot, dim, el, line, prevC, w, h, visible, lx, ly }
  let devices = [];

  // ---------- data ----------
  function setData(d) {
    if (st.disposed) return;
    const prevScanning = st.data.scanning;
    st.data = {
      checks: Array.isArray(d.checks) ? d.checks : [],
      devices: Array.isArray(d.devices) ? d.devices : [],
      gateway: d.gateway || '',
      scanning: !!d.scanning,
      progress: Number(d.progress) || 0,
      hasReport: !!d.hasReport,
    };
    if (st.data.scanning && !prevScanning) st.pingAt = st.time;
    const intro = !st.started;
    st.started = true;
    const seen = new Set();
    let order = 0;
    for (const c of st.data.checks) {
      if (!c || !c.id || c.state === 'pending') continue;
      const status = c.state === 'checking' ? 'checking' : (['risk', 'warn', 'ok', 'unknown'].includes(c.status) ? c.status : 'unknown');
      seen.add(c.id);
      let b = beacons.get(c.id);
      const angle = checkAngle(c.id);
      if (!b) {
        b = { id: c.id, hot: 0, dim: 0, prevC: -1, w: 0, h: 0, visible: false, lx: 0, ly: 0, born: intro ? st.time + order * 0.07 : st.time };
        b.el = document.createElement('div');
        b.el.className = 'rx-label';
        b.el.dataset.id = c.id;
        layer.appendChild(b.el);
        b.line = document.createElementNS(SVG_NS, 'line');
        b.line.setAttribute('class', 'rx-leader');
        svg.appendChild(b.line);
        beacons.set(c.id, b);
        order += 1;
      } else if (b.status !== status && st.data.scanning) {
        b.born = st.time; // a check that just completed lands again with its result
      }
      const name = SHORT[c.id] || c.title || c.id;
      const port = status === 'checking' ? '' : portOf(c.evidence);
      if (b.status !== status || b.name !== name || b.port !== port) {
        b.status = status; b.name = name; b.port = port;
        b.el.dataset.status = status;
        b.line.dataset.status = status;
        const word = WORD[status] || '';
        b.el.innerHTML = `<i></i><b></b>${word ? '<span class="rx-w"></span>' : ''}${port ? '<span class="rx-p"></span>' : ''}`;
        b.el.querySelector('b').textContent = name;
        if (word) b.el.querySelector('.rx-w').textContent = word;
        if (port) b.el.querySelector('.rx-p').textContent = ':' + port;
        b.w = 0; // remeasure
      }
      b.title = c.title || name;
      b.angle = angle;
      b.radius = RADIUS[status];
      b.x = b.radius * Math.cos(angle);
      b.z = b.radius * Math.sin(angle);
    }
    for (const [id, b] of beacons) {
      if (!seen.has(id)) { b.el.remove(); b.line.remove(); beacons.delete(id); }
    }
    devices = st.data.devices.map((dv) => {
      const key = String(dv.key || '');
      const a = hash(key) * TAU;
      const r = 0.13 + hash(key + '|r') * 0.17;
      return { key, kind: dv.self ? 'self' : 'dev', x: r * Math.cos(a), z: r * Math.sin(a) };
    });
    const coreText = st.data.gateway || 'Router';
    if (coreLabel.textContent !== coreText) { coreLabel.textContent = coreText; coreLabel._w = 0; }
    emptyEl.hidden = st.data.hasReport || st.data.scanning || beacons.size > 0;
    host.classList.toggle('rx--scanning', st.data.scanning);
    kick();
  }

  // Only a beacon that is on the radar can be highlighted (a pending row has none).
  function hotId() {
    const id = st.hoverId || st.extId;
    return id && beacons.has(id) ? id : null;
  }

  // ---------- engine ----------
  let lostTimer = 0;
  const hooks = {
    onLost() {
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (st.disposed || !st.engine || st.engine.kind !== 'webgl') return;
        console.warn('[exposure-radar] WebGL context did not come back, switching to 2D');
        try { st.engine.dispose(); } catch { /* already gone */ }
        st.engine = null;
        startEngine(createCanvasEngine);
      }, LOST_GRACE);
    },
    onRestored() {
      clearTimeout(lostTimer);
      if (st.disposed) return;
      resize();
      kick();
    },
  };

  function startEngine(factory) {
    try {
      const e = factory(stage, pal, hooks);
      st.engine = e;
      host.dataset.engine = e.kind;
      resize();
      kick();
      return true;
    } catch (err) {
      console.warn('[exposure-radar] engine failed, trying the fallback', err);
      return false;
    }
  }

  import('./exposure-radar-gl.js')
    .then((m) => {
      if (st.disposed) return;
      if (!startEngine(m.createGLEngine)) startEngine(createCanvasEngine);
    })
    .catch((err) => {
      if (st.disposed) return;
      console.warn('[exposure-radar] WebGL module unavailable', err);
      startEngine(createCanvasEngine);
    });

  function resize() {
    const r = stage.getBoundingClientRect();
    st.w = Math.round(r.width);
    st.h = Math.round(r.height);
    svg.setAttribute('viewBox', `0 0 ${st.w} ${st.h}`);
    if (st.engine) st.engine.resize(st.w, st.h);
    for (const b of beacons.values()) { b.w = 0; b.visible = false; }
    requestRender();
  }

  // ---------- simulation ----------
  function step(dt) {
    const d = st.data;
    st.dt = dt;
    if (!reduced) {
      st.time += dt;
      st.speed = damp(st.speed, d.scanning ? SPEED_SCAN : SPEED_IDLE, 2.5, dt);
      st.sweep = (st.sweep + st.speed * dt) % TAU;
    } else {
      st.sweep = d.scanning ? -Math.PI / 2 + d.progress * TAU : REDUCED_SWEEP;
    }
    const rate = st.drag ? 14 : 5;
    st.px = damp(st.px, reduced ? 0 : st.tpx, 3, dt);
    st.py = damp(st.py, reduced ? 0 : st.tpy, 3, dt);
    const taz = st.dragAz + st.px * 4 * DEG;
    const tel = clamp(st.dragEl - st.py * 2.5 * DEG, EL_MIN, EL_MAX);
    if (dt > 0) {
      st.az = damp(st.az, taz, rate, dt);
      st.el = damp(st.el, tel, rate, dt);
    } else if (reduced) {
      st.az = taz; st.el = tel;
    }
    const hid = hotId();
    for (const b of beacons.values()) {
      const tHot = b.id === hid ? 1 : 0;
      const tDim = hid && b.id !== hid ? 1 : 0;
      if (reduced || dt === 0) {
        if (reduced) { b.hot = tHot; b.dim = tDim; }
      } else {
        b.hot = damp(b.hot, tHot, 12, dt);
        b.dim = damp(b.dim, tDim, 8, dt);
      }
    }
  }

  // Seconds since the sweep last passed this beacon.
  function sinceSweep(b, speed) {
    let gap = (st.sweep - b.angle) % TAU;
    if (gap < 0) gap += TAU;
    return gap / speed;
  }

  function frameModel() {
    const d = st.data;
    const speed = Math.max(reduced ? SPEED_IDLE : st.speed, 0.2);
    const list = [];
    for (const b of beacons.values()) {
      const lit = Math.exp(-sinceSweep(b, speed) * 1.6);
      const appear = reduced ? 1 : easeOut(clamp((st.time - b.born) / 0.75, 0, 1));
      list.push({ id: b.id, status: b.status, x: b.x, z: b.z, angle: b.angle, lit, appear, hot: b.hot, dim: b.dim });
    }
    let ping = 2;
    let pingA = 0;
    if (!reduced) {
      const period = d.scanning ? 1.6 : 5;
      ping = ((st.time - st.pingAt) % period) / (period * 0.85);
      pingA = d.scanning ? 1 : 0.55;
    }
    return {
      time: st.time,
      reduced,
      sweep: st.sweep,
      trail: d.scanning ? 1 : d.hasReport ? 0.85 : 0.65,
      ping,
      pingA,
      breath: reduced ? 0.5 : 0.5 + 0.5 * Math.sin(st.time * 1.3),
      beacons: list,
      devices,
    };
  }

  // ---------- labels ----------
  function measure(item) {
    if (item.w) return;
    item.w = Math.ceil(item.el.offsetWidth) || 60;
    item.h = Math.ceil(item.el.offsetHeight) || 24;
  }

  function overlap(a, b, pad) {
    const x = Math.max(0, Math.min(a.x + a.w + pad, b.x + b.w) - Math.max(a.x - pad, b.x));
    const y = Math.max(0, Math.min(a.y + a.h + pad, b.y + b.h) - Math.max(a.y - pad, b.y));
    return x * y;
  }

  // Penalty for a label box against the drawing itself, measured on the disc plane: the rim and
  // bezel annulus, the ripple footprint of open findings, and (for open findings) the disc face.
  function planeCost(e, box, isRisk, risks) {
    let cost = 0;
    for (let iy = 0; iy <= 2; iy++) {
      for (let ix = 0; ix <= 2; ix++) {
        const q = e.unproject(box.x + box.w * ix / 2, box.y + box.h * iy / 2);
        if (!q) continue;
        const r = Math.hypot(q.x, q.z);
        if (r > 0.93 && r < 1.12) cost += 260;
        else if (isRisk && r <= 0.93) cost += 90;
        for (const k of risks) if (Math.hypot(q.x - k.x, q.z - k.z) < 0.27) cost += 220;
      }
    }
    return cost;
  }

  // Where a leader from (sx, sy) meets a label box: the nearest point of the box.
  function leaderEnd(sx, sy, box) {
    return { x: clamp(sx, box.x, box.x + box.w), y: clamp(sy, box.y + 4, box.y + box.h - 4) };
  }

  function segCross(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  }

  function segDist(p, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / Math.max(1e-6, vx * vx + vy * vy), 0, 1);
    return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
  }

  function hideLabel(b) {
    b.visible = false;
    b.el.classList.remove('is-on', 'is-hot', 'is-dim');
    b.line.classList.remove('is-on');
  }

  function layoutLabels() {
    const e = st.engine;
    if (!e || !st.w) return;
    const W = st.w;
    const H = st.h;
    const M = 12;
    const dt = st.dt;
    const core = e.project(0, 0.045, 0);
    const obstacles = [{ x: core.x - 16, y: core.y - 16, w: 32, h: 32 }];
    const columns = [];

    // router caption under the core
    if (!coreLabel._w) { coreLabel._w = coreLabel.offsetWidth; coreLabel._h = coreLabel.offsetHeight; }
    const cw = coreLabel._w || 80;
    const ch = coreLabel._h || 16;
    const cy = core.y + 22;
    coreLabel.style.transform = `translate3d(${(core.x - cw / 2).toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
    obstacles.push({ x: core.x - cw / 2, y: cy, w: cw, h: ch });

    const hid = hotId();
    const speed = Math.max(reduced ? SPEED_IDLE : st.speed, 0.2);
    const items = [];
    const risks = [];
    for (const b of beacons.values()) {
      const pr = e.project(b.x, 0.02, b.z);
      b.sx = pr.x; b.sy = pr.y; b.soft = pr.soft;
      obstacles.push({ x: pr.x - 8, y: pr.y - 8, w: 16, h: 16 });
      const ph = e.pillarHeight(b.status);
      if (ph) {
        const top = e.project(b.x, ph, b.z);
        columns.push({ x: top.x - 5, y: top.y - 6, w: 10, h: Math.max(0, pr.y - top.y + 6) });
      }
      if (b.status === 'risk') risks.push(b);
      let show = b.id === hid;
      if (!show && b.status === 'risk') show = true;
      if (!show && b.status === 'checking') show = true;
      // a finding to review surfaces as the sweep passes; it is hidden while another is in focus
      if (!show && b.status === 'warn' && !hid && !reduced && st.data.hasReport && !st.data.scanning) show = sinceSweep(b, speed) < WARN_LINGER;
      if (show) items.push(b);
      else if (b.visible || b.el.classList.contains('is-on')) hideLabel(b);
    }
    items.sort((a, b) => (a.id === hid ? -1 : b.id === hid ? 1 : 0) || PRIORITY[a.status] - PRIORITY[b.status] || a.angle - b.angle);

    const placed = [];
    const leaders = [];
    const dots = [...beacons.values()].map((k) => ({ id: k.id, x: k.sx, y: k.sy }));
    for (const b of items) {
      measure(b);
      const outward = b.sx >= core.x ? 1 : -1;
      const isRisk = b.status === 'risk';
      const others = risks.filter((k) => k !== b);
      let best = null;
      CANDS.forEach((c, ci) => {
        const x = c.side > 0 ? b.sx + c.len : b.sx - c.len - b.w;
        const y = b.sy - b.h / 2 + c.dy * b.h;
        const bx = clamp(x, M, W - M - b.w);
        const by = clamp(y, M, H - M - b.h);
        const box = { x: bx, y: by, w: b.w, h: b.h };
        let ov = 0;
        for (const o of placed) ov += overlap(box, o, GAP);
        let ob = 0;
        for (const o of obstacles) ob += overlap(box, o, 3);
        let col = 0;
        for (const o of columns) col += overlap(box, o, 2);
        // a leader must not cross another leader or run over another beacon
        const a0 = { x: b.sx, y: b.sy };
        const a1 = leaderEnd(b.sx, b.sy, box);
        let lead = 0;
        for (const l of leaders) if (segCross(a0, a1, l[0], l[1])) lead += 500;
        for (const k of dots) if (k.id !== b.id && segDist(k, a0, a1) < 9) lead += 220;
        for (const l of leaders) if (overlap(box, { x: Math.min(l[0].x, l[1].x), y: Math.min(l[0].y, l[1].y), w: Math.abs(l[1].x - l[0].x) + 1, h: Math.abs(l[1].y - l[0].y) + 1 }, 0) > 0 && segDist({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, l[0], l[1]) < box.h) lead += 260;
        const score = ov * 9 + ob * 3 + col * 8 + lead
          + planeCost(e, box, isRisk, others)
          + (Math.abs(bx - x) + Math.abs(by - y)) * 4
          + c.len * (isRisk ? 0.35 : 0.7) + Math.abs(c.dy) * 9
          + (c.side === outward ? 0 : 26)
          - (ci === b.prevC ? 70 : 0);
        if (!best || score < best.score) best = { score, box, ci };
      });
      b.prevC = best.ci;
      placed.push(best.box);
      leaders.push([{ x: b.sx, y: b.sy }, leaderEnd(b.sx, b.sy, best.box)]);
      // glide toward the new place; a label that just appeared starts there
      if (!b.visible || reduced || dt <= 0) {
        b.lx = best.box.x; b.ly = best.box.y;
      } else {
        b.lx = damp(b.lx, best.box.x, 10, dt);
        b.ly = damp(b.ly, best.box.y, 10, dt);
      }
      b.visible = true;
      const bx = b.lx;
      const by = b.ly;
      b.el.style.transform = `translate3d(${bx.toFixed(2)}px, ${by.toFixed(2)}px, 0)`;
      b.el.style.setProperty('--soft', (b.soft || 0).toFixed(2));
      b.el.classList.add('is-on');
      b.el.classList.toggle('is-hot', b.id === hid);
      b.el.classList.toggle('is-dim', !!hid && b.id !== hid);
      // leader: from the beacon to the nearest point of the label box
      const { x: tx, y: ty } = leaderEnd(b.sx, b.sy, { x: bx, y: by, w: b.w, h: b.h });
      const lx = tx - b.sx;
      const ly = ty - b.sy;
      const ll = Math.hypot(lx, ly);
      if (ll > 12) {
        const r0 = 7;
        b.line.setAttribute('x1', (b.sx + lx / ll * r0).toFixed(2));
        b.line.setAttribute('y1', (b.sy + ly / ll * r0).toFixed(2));
        b.line.setAttribute('x2', tx.toFixed(2));
        b.line.setAttribute('y2', ty.toFixed(2));
        b.line.classList.add('is-on');
      } else {
        b.line.classList.remove('is-on');
      }
      b.line.classList.toggle('is-hot', b.id === hid);
      b.line.classList.toggle('is-dim', !!hid && b.id !== hid);
    }
  }

  // ---------- loop ----------
  function busy() {
    if (st.drag || st.data.scanning) return true;
    if (Math.abs(st.az - (st.dragAz + st.px * 4 * DEG)) > 1e-3 || Math.abs(st.px - st.tpx) > 0.01 || Math.abs(st.py - st.tpy) > 0.01) return true;
    const hid = hotId();
    for (const b of beacons.values()) {
      if (Math.abs(b.hot - (b.id === hid ? 1 : 0)) > 0.01) return true;
      if (st.time - b.born < 0.8) return true;
    }
    return false;
  }

  function wantsLoop() {
    if (st.disposed || !st.engine || !st.inView || document.hidden) return false;
    if (st.engine.isLost && st.engine.isLost()) return false;
    if (!reduced) return true;
    return !!st.drag || Math.abs(st.az - st.dragAz) > 1e-3 || Math.abs(st.el - clamp(st.dragEl, EL_MIN, EL_MAX)) > 1e-3;
  }

  function draw() {
    const e = st.engine;
    if (!e || !st.w) return;
    e.setView(st.az, st.el);
    e.render(frameModel());
    layoutLabels();
  }

  // Display rate while the window has focus, so the sweep glides; a lower rate in the background.
  function frame(now) {
    st.raf = 0;
    if (st.disposed) return;
    const interval = busy() || st.focused ? 0 : 1 / 20;
    if (interval > 0 && now - st.lastNow < interval * 1000 - 4) {
      st.raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - st.lastNow) / 1000));
    st.lastNow = now;
    step(dt);
    draw();
    if (wantsLoop()) st.raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (st.disposed || !st.engine) return;
    if (wantsLoop()) {
      if (!st.raf) {
        st.lastNow = performance.now();
        st.raf = requestAnimationFrame(frame);
      }
    } else {
      requestRender();
    }
  }

  function requestRender() {
    if (st.disposed || st.queued || st.raf || !st.engine) return;
    st.queued = true;
    requestAnimationFrame(() => {
      st.queued = false;
      if (st.disposed || st.raf) return;
      step(0);
      draw();
    });
  }

  // ---------- interaction ----------
  function pick(clientX, clientY, target) {
    const lab = target && target.closest && target.closest('.rx-label.is-on');
    if (lab && lab.dataset.id) return lab.dataset.id;
    const r = stage.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    let best = null;
    let bd = 18 * 18;
    for (const b of beacons.values()) {
      if (b.sx == null) continue;
      const d2 = (b.sx - x) ** 2 + (b.sy - y) ** 2;
      if (d2 < bd) { bd = d2; best = b.id; }
    }
    return best;
  }

  function setHover(id) {
    if (st.hoverId === id) return;
    st.hoverId = id;
    stage.classList.toggle('is-pointing', !!id);
    if (typeof opts.onHover === 'function') opts.onHover(id);
    kick();
  }

  function onMove(e) {
    const r = stage.getBoundingClientRect();
    st.tpx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1);
    st.tpy = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1);
    if (st.drag) {
      const dx = e.clientX - st.drag.x;
      const dy = e.clientY - st.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) st.drag.moved = true;
      st.dragAz = clamp(st.drag.az - dx * 0.006, -AZ_LIM, AZ_LIM);
      st.dragEl = clamp(st.drag.el + dy * 0.004, EL_MIN, EL_MAX);
    } else {
      setHover(pick(e.clientX, e.clientY, e.target));
    }
    kick();
  }

  function onDown(e) {
    if (e.button !== 0) return;
    st.drag = { x: e.clientX, y: e.clientY, az: st.dragAz, el: st.dragEl, moved: false, id: pick(e.clientX, e.clientY, e.target) };
    try { stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    stage.classList.add('is-dragging');
    kick();
  }

  function onUp(e) {
    const d = st.drag;
    if (!d) return;
    st.drag = null;
    stage.classList.remove('is-dragging');
    try { stage.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (!d.moved && d.id && typeof opts.onSelect === 'function') opts.onSelect(d.id);
    kick();
  }

  function onLeave() {
    if (st.drag) return;
    st.tpx = 0;
    st.tpy = 0;
    setHover(null);
  }

  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('pointerleave', onLeave);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(stage);
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      const en = entries[entries.length - 1];
      st.inView = !!(en && en.isIntersecting);
      kick();
    }, { threshold: 0 })
    : null;
  if (io) io.observe(stage);
  const onVis = () => kick();
  const onFocus = () => { st.focused = true; kick(); };
  const onBlur = () => { st.focused = false; };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  const onReduced = (e) => { reduced = !!e.matches; kick(); };
  if (reducedQuery && reducedQuery.addEventListener) reducedQuery.addEventListener('change', onReduced);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (st.disposed) return;
      for (const b of beacons.values()) b.w = 0;
      coreLabel._w = 0;
      requestRender();
    });
  }

  return {
    setData,
    setHighlight(id) {
      if (st.extId === (id || null)) return;
      st.extId = id || null;
      kick();
    },
    dispose() {
      if (st.disposed) return;
      st.disposed = true;
      clearTimeout(lostTimer);
      if (st.raf) cancelAnimationFrame(st.raf);
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      if (reducedQuery && reducedQuery.removeEventListener) reducedQuery.removeEventListener('change', onReduced);
      if (st.engine) { try { st.engine.dispose(); } catch { /* released */ } }
      host.innerHTML = '';
      host.classList.remove('rx', 'rx--scanning');
    },
  };
}
