// Shield view: exposure map (polar plot around the router), deep scan checks with guided fixes,
// score dial, UPnP mappings and open ports. Everything shown comes from the store; nothing is invented.
import { readPrefs, PREFS_EVENT } from './settings.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const FONT_D = '"Bricolage Grotesque Variable", "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif';
const FONT_U = '"Plus Jakarta Sans", system-ui, "Segoe UI", sans-serif';
const FONT_M = '"JetBrains Mono", Consolas, monospace';

const CHECK_ORDER = ['tr069', 'upnp', 'dns-plaintext', 'admin-default', 'wps', 'telnet', 'ssh',
  'web-admin-http', 'location-map', 'mac-privacy', 'wifi-security', 'unknown-devices'];
const SHORT = {
  tr069: 'TR-069', upnp: 'UPnP', 'dns-plaintext': 'DNS', 'admin-default': 'Admin login', wps: 'WPS',
  telnet: 'Telnet', ssh: 'SSH', 'web-admin-http': 'HTTP admin', 'location-map': 'Location maps',
  'mac-privacy': 'MAC privacy', 'wifi-security': 'Wi-Fi security', 'unknown-devices': 'Devices',
};
const STATUS_WORD = { risk: 'open', warn: 'check', ok: 'sealed', unknown: 'unknown' };
// Score arc: 270 degrees, same geometry as the reference speed gauge (centre 130,130, r 100).
const ARC_D = 'M59.29 200.71 A100 100 0 1 1 200.71 200.71';
const STATUS_RADIUS = { risk: 1, warn: 0.8, unknown: 0.62, ok: 0.44 };
const STATUS_RANK = { risk: 0, warn: 1, unknown: 2, ok: 3 };
const FIX_TARGET = {
  'router-admin': 'Opens your router admin page',
  'dns-settings': 'Opens the DNS settings of this computer',
  'wifi-settings': 'Opens the Wi-Fi settings of this computer',
  'mac-privacy': 'Opens the private Wi-Fi address settings',
};
const RISKY_PORTS = { 21: 'risk', 23: 'risk', 7547: 'risk', 22: 'warn', 80: 'warn', 8080: 'warn', 1900: 'warn', 5000: 'warn' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function errText(err) {
  return String((err && err.message) || err || 'Unknown error');
}

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const t = (n, f) => cs.getPropertyValue(n).trim() || f;
  return {
    ground: t('--ground', '#07060E'), text: t('--text', '#F3F0FF'), muted: t('--muted', '#ABA6CB'), dim: t('--dim', '#857FA9'),
    violet: t('--violet', '#7C6CFF'), lavender: t('--lavender', '#B7A9FF'), sky: t('--sky', '#8FD3FF'),
    mint: t('--mint', '#9EF0C4'), coral: t('--coral', '#FF8E7A'), amber: t('--amber', '#FFC772'),
  };
}

function rgba(c, a) {
  let h = String(c).trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (!/^#[0-9a-f]{6}$/i.test(h)) return c;
  const n = parseInt(h.slice(1), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isReport(r) {
  return !!(r && Array.isArray(r.checks));
}

function sevLabel(c) {
  if (c.liveOnly) return STATUS_WORD[c.status] || 'unknown';
  if (c.status === 'ok') return 'sealed';
  if (c.status === 'unknown') return 'unknown';
  return String(c.severity || (c.status === 'risk' ? 'high' : 'medium')).toLowerCase();
}

function pillClass(status) {
  if (status === 'risk') return 'pill pill--risk';
  if (status === 'warn') return 'pill pill--warn';
  if (status === 'ok') return 'pill pill--ok';
  return 'pill pill--unknown';
}


export function mount(el, ctx) {
  const { api, store } = ctx;
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const subs = [];
  let alive = true;
  let raf = 0;
  let prefs = readPrefs();

  const st = {
    report: isReport(store.get('scan')) ? store.get('scan') : null,
    scanError: null,
    prog: null,
    progAt: 0,
    current: null,
    live: new Map(),
    busy: false,
  };
  const scanVal = store.get('scan');
  if (scanVal && !isReport(scanVal) && (scanVal.error || (Array.isArray(scanVal.errors) && scanVal.errors.length))) {
    st.scanError = scanVal.error || scanVal.errors.join('; ');
  }

  el.innerHTML = `
    <section class="v-shield view-pad" aria-labelledby="sh-title">
      <header class="sh-head">
        <div>
          <p class="eyebrow">Shield</p>
          <h1 class="h-display" id="sh-title">Close every backdoor.</h1>
        </div>
        <div class="sh-head-side">
          <p class="sh-lede" data-lede></p>
          <button class="btn btn--primary" type="button" data-run>Run deep scan</button>
        </div>
      </header>

      <div class="sh-console">
        <div class="sh-bar nv-glass">
          <span class="sh-live"><span class="sh-led" data-led></span><span data-bar-status>Idle</span></span>
          <span class="nv-tag" data-bar-gw>Gateway unknown</span>
          <span class="nv-tag sh-bar-right" data-bar-time></span>
          <div class="sh-progress" aria-hidden="true"><span data-progress></span></div>
        </div>

        <div class="sh-cells sh-cells--main">
          <div class="sh-card sh-map nv-glass">
            <div class="sh-card-h"><h2>Exposure map</h2><span class="nv-tag" data-open-count></span></div>
            <canvas class="sh-canvas" data-map role="img" aria-label="Polar map of checks and devices around your router"></canvas>
            <div class="sh-legend">
              <span><i class="lg-dev"></i>Device</span>
              <span><i class="lg-risk"></i>Open backdoor</span>
              <span><i class="lg-warn"></i>Needs a look</span>
              <span><i class="lg-ok"></i>Sealed</span>
              <span><i class="lg-unk"></i>Unknown</span>
            </div>
          </div>
          <div class="sh-card sh-checks nv-glass">
            <div class="sh-card-h"><h2>Deep scan</h2><span class="nv-tag" data-scan-meta></span></div>
            <p class="sh-step" data-step role="status" aria-live="polite"></p>
            <ul class="sh-list" data-list></ul>
            <div data-errors></div>
          </div>
        </div>

        <div class="sh-cells sh-cells--lower">
          <div class="sh-card sh-score nv-glass">
            <div class="sh-card-h"><h2>Score</h2><span class="nv-tag" data-score-meta></span></div>
            <div class="sh-dial" data-dial-wrap data-level="none">
              <svg viewBox="0 0 260 232" role="img" aria-label="Security score" data-dial>
                <defs><linearGradient id="shScoreGrad" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" style="stop-color:var(--sky)"/><stop offset=".55" style="stop-color:var(--violet)"/><stop offset="1" style="stop-color:var(--lavender)"/>
                </linearGradient></defs>
                <path class="sc-track" d="${ARC_D}" pathLength="100"/>
                <path class="sc-val" d="${ARC_D}" pathLength="100" stroke="url(#shScoreGrad)" stroke-dasharray="0 100" data-arc/>
                <g data-ticks></g>
              </svg>
              <div class="sh-dial-center"><b data-score>--</b><span data-score-word>No scan yet</span></div>
            </div>
            <p class="sh-fine" data-score-note></p>
          </div>
          <div class="sh-card sh-upnp nv-glass">
            <div class="sh-card-h"><h2>UPnP mappings</h2><span class="nv-tag" data-upnp-meta></span></div>
            <div data-upnp></div>
          </div>
          <div class="sh-card sh-ports nv-glass">
            <div class="sh-card-h"><h2>Open ports</h2><span class="nv-tag" data-ports-meta></span></div>
            <div data-ports></div>
          </div>
        </div>
      </div>
    </section>`;

  const $ = (sel) => el.querySelector(sel);
  const runBtn = $('[data-run]');
  const canvas = $('[data-map]');
  const c2d = canvas.getContext('2d');
  const scene = { w: 0, h: 0 };
  let pal = palette();

  // ---------- derived state ----------
  function progFrac() {
    const p = st.prog;
    if (!p || !p.total) return 0;
    const done = p.status ? Number(p.index) + 1 : Number(p.index);
    return Math.max(0, Math.min(1, done / p.total));
  }

  // The shell marks scanProgress.running; older payloads without it fall back to progress + recency.
  function isScanning() {
    if (st.busy) return true;
    if (!st.prog) return false;
    if (typeof st.prog.running === 'boolean') return st.prog.running;
    return progFrac() < 1 && Date.now() - st.progAt < 20000;
  }

  // Checks to plot and list: the last report, overlaid with what the running scan has found so far.
  function currentChecks() {
    const scanning = isScanning();
    const base = st.report ? st.report.checks.slice() : [];
    if (!scanning) return base.map((c) => ({ ...c, state: 'done' }));
    const out = base.map((c) => {
      if (st.live.has(c.id)) return { ...c, status: st.live.get(c.id), state: 'done' };
      if (st.current === c.id) return { ...c, state: 'checking' };
      return { ...c, state: 'pending' };
    });
    for (const [id, status] of st.live) {
      if (!out.some((c) => c.id === id)) out.push({ id, title: (st.titles && st.titles[id]) || SHORT[id] || id, status, severity: null, liveOnly: true, evidence: '', fix: null, state: 'done' });
    }
    if (st.current && !out.some((c) => c.id === st.current)) {
      out.push({ id: st.current, title: (st.titles && st.titles[st.current]) || SHORT[st.current] || st.current, status: 'unknown', severity: null, liveOnly: true, evidence: '', fix: null, state: 'checking' });
    }
    return out;
  }

  // ---------- exposure map ----------
  function sizeCanvas() {
    const r = canvas.getBoundingClientRect();
    const d = Math.min(2, window.devicePixelRatio || 1);
    scene.w = r.width;
    scene.h = r.height;
    canvas.width = Math.max(1, Math.round(r.width * d));
    canvas.height = Math.max(1, Math.round(r.height * d));
    c2d.setTransform(d, 0, 0, d, 0, 0);
    draw(performance.now() / 1000);
  }

  function checkAngle(id) {
    const i = CHECK_ORDER.indexOf(id);
    if (i >= 0) return (-90 + i * (360 / CHECK_ORDER.length) + 8) * DEG;
    return (-90 + hash(id) * 360) * DEG;
  }

  // Soft radial glow, used for every dot so the map reads like the reference's luminous planet.
  function halo(ctx, x, y, r, col, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, a));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  function draw(t) {
    const ctx = c2d;
    const { w, h } = scene;
    if (!w || !h) return;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.36;
    const scanning = isScanning();
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;

    // nebula core
    halo(ctx, cx, cy, R * 1.12, pal.violet, 0.2);

    // rings
    [0.25, 0.5, 0.75, 1].forEach((k) => {
      ctx.strokeStyle = rgba(pal.lavender, k === 1 ? 0.4 : k === 0.75 ? 0.2 : 0.12);
      ctx.setLineDash(k === 1 || k === 0.75 ? [] : [2, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, TAU); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.save();
    ctx.shadowColor = rgba(pal.violet, 0.9); ctx.shadowBlur = 16;
    ctx.strokeStyle = rgba(pal.lavender, 0.3); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1;
    for (let i = 0; i < 72; i++) {
      const a = i * 5 * DEG;
      const long = i % 6 === 0;
      const r0 = R + 6;
      const r1 = R + (long ? 14 : 9);
      ctx.strokeStyle = rgba(pal.lavender, long ? 0.55 : 0.18);
      ctx.beginPath(); ctx.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)); ctx.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); ctx.stroke();
    }
    ctx.strokeStyle = rgba(pal.lavender, 0.07);
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();

    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.font = '500 10px ' + FONT_M;
    ctx.fillStyle = pal.dim; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    // Axis captions register their boxes so check labels step around them.
    const placed = [];
    if (w > 300) {
      const cap = (txt, x) => { ctx.fillText(txt, x, cy + 9); placed.push({ x, y: cy + 9, w: ctx.measureText(txt).width }); };
      cap('LAN', cx + R * 0.44 + 4);
      cap('WAN edge', Math.min(w - 64, cx + R + 18));
    }

    // violet sweep, only while a scan runs
    let sweepA = null;
    if (scanning) {
      sweepA = RM ? -90 * DEG + progFrac() * TAU : (t * 1.1) % TAU;
      for (let k = 0; k < 32; k++) {
        const a0 = sweepA - (k + 1) * 0.035;
        ctx.fillStyle = rgba(pal.violet, 0.3 * Math.pow(1 - k / 32, 1.4));
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a0 + 0.037); ctx.closePath(); ctx.fill();
      }
      const ex = cx + R * Math.cos(sweepA);
      const ey = cy + R * Math.sin(sweepA);
      ctx.save();
      ctx.shadowColor = pal.violet; ctx.shadowBlur = 12;
      const lg = ctx.createLinearGradient(cx, cy, ex, ey);
      lg.addColorStop(0, rgba(pal.lavender, 0.15)); lg.addColorStop(1, rgba(pal.sky, 0.95));
      ctx.strokeStyle = lg; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.restore();
      halo(ctx, ex, ey, 14, pal.sky, 0.55);
      ctx.lineWidth = 1;
    }
    const glow = (ang) => {
      if (sweepA == null) return 0;
      let d = (sweepA - ang) % TAU;
      if (d < 0) d += TAU;
      return Math.exp(-d * 1.4);
    };

    // devices seen on the LAN (real neighbour table entries)
    const devices = Array.isArray(store.get('devices')) ? store.get('devices') : [];
    for (const d of devices) {
      if (d.isGateway) continue;
      const key = d.mac || d.ip;
      const ang = hash(key) * TAU;
      const rr = 0.16 + hash(key + '|r') * 0.5;
      const gl = glow(ang);
      const x = cx + rr * R * Math.cos(ang);
      const y = cy + rr * R * Math.sin(ang);
      const col = d.isThisComputer ? pal.mint : pal.lavender;
      halo(ctx, x, y, 9 + gl * 6, col, (d.isThisComputer ? 0.4 : 0.22) + 0.3 * gl);
      ctx.fillStyle = rgba(col, (d.isThisComputer ? 0.95 : 0.55) + 0.4 * gl);
      ctx.beginPath(); ctx.arc(x, y, (d.isThisComputer ? 2.6 : 1.9) + gl * 1.2, 0, TAU); ctx.fill();
      if (d.randomizedMac) {
        ctx.strokeStyle = rgba(pal.lavender, 0.5); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 4.6, 0, TAU); ctx.stroke();
      }
    }

    // checks
    const showLabels = w > 340;
    ctx.font = '600 11px ' + FONT_U;
    ctx.textBaseline = 'middle';
    const label = (x, y, txt, col) => {
      const tw = ctx.measureText(txt).width;
      const th = 14;
      const right = x >= cx;
      let lx = right ? x + 11 : x - 11 - tw;
      lx = Math.max(4, Math.min(w - 4 - tw, lx));
      let ly = y - 10;
      const dir = y < cy ? -1 : 1;
      for (let k = 0; k < 10; k++) {
        const hit = placed.some((r) => lx < r.x + r.w + 4 && lx + tw + 4 > r.x && Math.abs(ly - r.y) < th);
        if (!hit) break;
        ly += dir * th;
      }
      ly = Math.max(th / 2 + 2, Math.min(h - th / 2 - 2, ly));
      placed.push({ x: lx, y: ly, w: tw });
      ctx.textAlign = 'left';
      ctx.fillStyle = col;
      ctx.fillText(txt, lx, ly);
    };

    const checks = currentChecks().filter((c) => c.state !== 'pending')
      .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
    for (const c of checks) {
      const ang = checkAngle(c.id);
      const rr = STATUS_RADIUS[c.status] || STATUS_RADIUS.unknown;
      const x = cx + rr * R * Math.cos(ang);
      const y = cy + rr * R * Math.sin(ang);
      const gl = glow(ang);
      const name = SHORT[c.id] || String(c.id);
      if (c.state === 'checking') {
        halo(ctx, x, y, 16, pal.lavender, 0.35);
        ctx.strokeStyle = pal.lavender; ctx.lineWidth = 1.4; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(x, y, 6.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        if (showLabels) label(x, y, name + ' · checking', pal.lavender);
        continue;
      }
      if (c.status === 'risk') {
        for (let k = 0; k < 2; k++) {
          const ph = RM ? 0.4 : (t * 0.8 + k / 2) % 1;
          ctx.strokeStyle = rgba(pal.coral, (1 - ph) * 0.85); ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.arc(x, y, 5 + ph * 24, 0, TAU); ctx.stroke();
        }
        halo(ctx, x, y, 30, pal.coral, 0.5);
        // anamorphic flare
        const fl = ctx.createLinearGradient(x - 40, y, x + 40, y);
        fl.addColorStop(0, rgba(pal.coral, 0)); fl.addColorStop(0.5, rgba('#FFFFFF', 0.85)); fl.addColorStop(1, rgba(pal.coral, 0));
        ctx.fillStyle = fl; ctx.fillRect(x - 40, y - 0.75, 80, 1.5);
        ctx.fillStyle = pal.coral; ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba('#FFFFFF', 0.9); ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fill();
        if (showLabels) label(x, y, name + ' · ' + STATUS_WORD.risk, pal.coral);
      } else if (c.status === 'warn') {
        halo(ctx, x, y, 18, pal.amber, 0.38 + 0.3 * gl);
        ctx.fillStyle = rgba(pal.amber, 0.85 + 0.15 * gl);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
        if (showLabels) label(x, y, name + ' · ' + STATUS_WORD.warn, pal.amber);
      } else if (c.status === 'ok') {
        halo(ctx, x, y, 15, pal.mint, 0.28 + 0.3 * gl);
        ctx.fillStyle = rgba(pal.mint, 0.85 + 0.15 * gl);
        ctx.beginPath(); ctx.arc(x, y, 3.6, 0, TAU); ctx.fill();
        if (showLabels) label(x, y, name + ' · ' + STATUS_WORD.ok, pal.mint);
      } else {
        ctx.strokeStyle = rgba(pal.dim, 0.95); ctx.lineWidth = 1.2; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        if (showLabels) label(x, y, name + ' · ' + STATUS_WORD.unknown, pal.dim);
      }
    }

    // router at the centre: a small luminous orb, like the reference shield button
    halo(ctx, cx, cy, 34, pal.violet, 0.55);
    ctx.strokeStyle = rgba(pal.lavender, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 15, 0, TAU); ctx.stroke();
    const og = ctx.createRadialGradient(cx, cy - 4, 0, cx, cy, 10);
    og.addColorStop(0, '#C9C0FF'); og.addColorStop(0.45, '#9F90FF'); og.addColorStop(1, '#4B39D0');
    ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(220,214,255,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, TAU); ctx.stroke();
    const ov = store.get('overview');
    const gw = ov && ov.gateway && ov.gateway.ip;
    if (w > 260) {
      ctx.font = '500 10.5px ' + FONT_M;
      ctx.textAlign = 'center'; ctx.fillStyle = rgba(pal.lavender, 0.8);
      ctx.fillText(gw || 'Router', cx, cy + 27);
    }

    if (!st.report && !scanning) {
      ctx.font = '600 15px ' + FONT_D; ctx.textAlign = 'center'; ctx.fillStyle = pal.muted;
      ctx.fillText('No scan yet', cx, cy - R * 0.62);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function needsAnimation() {
    if (RM) return false;
    if (isScanning()) return true;
    return currentChecks().some((c) => c.status === 'risk');
  }

  function frame(now) {
    raf = 0;
    if (!alive) return;
    if (!document.hidden) draw(now / 1000);
    if (needsAnimation()) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!alive) return;
    if (raf) return;
    if (needsAnimation()) raf = requestAnimationFrame(frame);
    else draw(performance.now() / 1000);
  }

  const ro = new ResizeObserver(() => sizeCanvas());
  ro.observe(canvas);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVis);

  // ---------- head / bar ----------
  function renderHead() {
    const scanning = isScanning();
    const p = st.prog;
    runBtn.disabled = scanning;
    runBtn.textContent = scanning ? (p && p.total ? 'Scanning ' + Math.min(p.total, Number(p.index) + 1) + '/' + p.total : 'Scanning') : st.report ? 'Run deep scan again' : 'Run deep scan';
    $('[data-progress]').style.width = (scanning ? progFrac() * 100 : st.report ? 100 : 0) + '%';
    $('[data-led]').dataset.state = scanning ? 'scan' : !st.report ? 'idle' : st.report.checks.some((c) => c.status === 'risk') ? 'risk' : 'ok';
    $('[data-bar-status]').textContent = scanning ? 'Scanning' : st.report ? 'Last scan ' + (fmtTime(st.report.finishedAt) || 'time unknown') : 'No scan yet';
    const ov = store.get('overview');
    const gw = ov && ov.gateway;
    $('[data-bar-gw]').textContent = gw && gw.ip ? 'Gateway ' + gw.ip + (gw.vendor ? ' · ' + gw.vendor : '') : 'Gateway unknown';
    if (st.report && st.report.startedAt && st.report.finishedAt) {
      const secs = (new Date(st.report.finishedAt) - new Date(st.report.startedAt)) / 1000;
      $('[data-bar-time]').textContent = Number.isFinite(secs) && secs >= 0 ? 'Took ' + secs.toFixed(secs < 10 ? 1 : 0) + ' s' : '';
    } else {
      $('[data-bar-time]').textContent = '';
    }
    $('[data-lede]').textContent = st.report
      ? 'Each finding below shows what Bastion actually observed and how to close it. Bastion never changes your router on its own.'
      : 'A deep scan checks your router for remote-management channels, legacy shells, open port forwards and plain-text DNS. Read-only, no admin rights needed.';

    const step = $('[data-step]');
    if (scanning) {
      step.hidden = false;
      step.textContent = p && p.id && p.title ? 'Checking: ' + p.title : (p && p.title) || 'Starting scan';
    } else if (st.scanError) {
      step.hidden = false;
      step.textContent = 'Scan failed: ' + st.scanError;
    } else {
      step.hidden = true;
      step.textContent = '';
    }
    step.classList.toggle('sh-step--err', !scanning && !!st.scanError);

    const checks = currentChecks();
    const risk = checks.filter((c) => c.state === 'done' && c.status === 'risk').length;
    const warn = checks.filter((c) => c.state === 'done' && c.status === 'warn').length;
    const unk = checks.filter((c) => c.state === 'done' && c.status === 'unknown').length;
    let txt = 'No scan yet';
    if (st.report || scanning) {
      const parts = [];
      if (risk) parts.push(risk + ' open');
      if (warn) parts.push(warn + ' to check');
      if (unk) parts.push(unk + ' unknown');
      txt = parts.length ? parts.join(' · ') : scanning ? 'Scanning' : 'All sealed';
    }
    $('[data-open-count]').textContent = txt;
    $('[data-scan-meta]').textContent = st.report || scanning ? checks.length + ' checks' : '';
  }

  // ---------- check list ----------
  const expanded = new Set();

  function renderList() {
    const list = $('[data-list]');
    const scanning = isScanning();
    const checks = currentChecks();
    if (!checks.length) {
      list.innerHTML = scanning
        ? '<li class="sh-empty">Preparing checks.</li>'
        : `<li class="sh-empty">
             <p class="empty-state">No scan yet. A deep scan takes under a minute and only reads; it changes nothing.</p>
           </li>`;
      return;
    }
    const sorted = scanning ? checks : checks.slice().sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
    list.innerHTML = sorted.map((c) => {
      const state = c.state === 'done' ? c.status : c.state;
      const hasSteps = c.fix && Array.isArray(c.fix.steps) && c.fix.steps.length && c.status !== 'ok' && c.state === 'done';
      const canOpen = c.fix && c.fix.open && c.status !== 'ok' && c.state === 'done';
      const tag = c.state === 'pending' ? '<span class="pill pill--unknown">Pending</span>'
        : c.state === 'checking' ? '<span class="pill pill--info">Checking</span>'
        : `<span class="${pillClass(c.status)}">${esc(sevLabel(c))}</span>`;
      const extra = c.id === 'unknown-devices' && c.state === 'done'
        ? '<button class="nv-mini" type="button" data-go="devices">See devices</button>' : '';
      const upnpLink = c.id === 'upnp' && c.state === 'done' && st.report && Array.isArray(st.report.upnpMappings) && st.report.upnpMappings.length
        ? '<button class="nv-mini" type="button" data-jump="upnp">See mappings</button>' : '';
      return `
        <li class="sh-row" data-state="${esc(state)}" data-id="${esc(c.id)}">
          <span class="sh-dot" aria-hidden="true"></span>
          <div class="sh-what">
            <b>${esc(c.title || SHORT[c.id] || c.id)}</b>
            ${c.evidence ? `<span class="sh-ev${prefs.advancedEvidence ? '' : ' sh-ev--clamp'}" title="${esc(c.evidence)}">${esc(c.evidence)}</span>` : ''}
          </div>
          <div class="sh-tag">${tag}</div>
          ${canOpen || extra || upnpLink ? `<div class="sh-act">
            ${canOpen ? `<button class="nv-mini${c.status === 'risk' ? ' nv-mini--go' : ''}" type="button" data-fix="${esc(c.fix.open)}" title="${esc(FIX_TARGET[c.fix.open] || '')}">${esc(c.fix.label || 'Open settings')}</button>` : ''}
            ${upnpLink}${extra}
          </div>` : ''}
          ${hasSteps ? `<details class="sh-steps"${expanded.has(c.id) ? ' open' : ''} data-steps="${esc(c.id)}">
            <summary>How to fix · ${c.fix.steps.length} step${c.fix.steps.length === 1 ? '' : 's'}</summary>
            <ol>${c.fix.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          </details>` : ''}
        </li>`;
    }).join('');
  }

  function renderErrors() {
    const box = $('[data-errors]');
    const errs = st.report && Array.isArray(st.report.errors) ? st.report.errors.filter(Boolean) : [];
    if (!errs.length || isScanning()) { box.innerHTML = ''; return; }
    if (!prefs.advancedEvidence) {
      box.innerHTML = `<p class="sh-fine">${errs.length} scan note${errs.length === 1 ? '' : 's'} hidden. Turn on "Show advanced evidence" in Settings to see them.</p>`;
      return;
    }
    box.innerHTML = `<details class="sh-notes"><summary>Scan notes · ${errs.length}</summary><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>`;
  }

  el.addEventListener('click', (e) => {
    const fixBtn = e.target.closest('[data-fix]');
    if (fixBtn) {
      const target = fixBtn.dataset.fix;
      fixBtn.disabled = true;
      Promise.resolve(api.fix.open(target))
        .then((r) => {
          if (r && r.ok) ctx.toast(FIX_TARGET[target] ? FIX_TARGET[target].replace('Opens', 'Opened') + '. Follow the steps below.' : 'Opened.', 'info');
          else ctx.toast('Bastion could not open that page. Follow the steps manually.' + (r && r.error ? ' (' + r.error + ')' : ''), 'warn');
        })
        .catch((err) => ctx.toast('Could not open: ' + errText(err), 'warn'))
        .finally(() => { fixBtn.disabled = false; });
      const row = fixBtn.closest('[data-id]');
      if (row) {
        expanded.add(row.dataset.id);
        const det = row.querySelector('details');
        if (det) det.open = true;
      }
      return;
    }
    const go = e.target.closest('[data-go]');
    if (go) { ctx.navigate(go.dataset.go); return; }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      const t = el.querySelector('.sh-' + jump.dataset.jump);
      if (t) t.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
    }
  });
  el.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.steps) return;
    if (d.open) expanded.add(d.dataset.steps); else expanded.delete(d.dataset.steps);
  }, true);

  // ---------- score ----------
  (function buildTicks() {
    const g = $('[data-ticks]');
    const NS = 'http://www.w3.org/2000/svg';
    [0, 25, 50, 75, 100].forEach((v) => {
      const a = (135 + 270 * (v / 100)) * DEG;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', (130 + 124 * c).toFixed(1));
      t.setAttribute('y', (130 + 124 * s + 4).toFixed(1));
      t.setAttribute('text-anchor', Math.abs(c) < 0.2 ? 'middle' : c < 0 ? 'end' : 'start');
      t.setAttribute('class', 'sc-tick');
      t.textContent = String(v);
      g.appendChild(t);
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', (130 + 86 * c).toFixed(1)); ln.setAttribute('y1', (130 + 86 * s).toFixed(1));
      ln.setAttribute('x2', (130 + 80 * c).toFixed(1)); ln.setAttribute('y2', (130 + 80 * s).toFixed(1));
      ln.setAttribute('class', 'sc-mark');
      g.appendChild(ln);
    });
  })();

  function renderScore() {
    const arc = $('[data-arc]');
    const wrap = $('[data-dial-wrap]');
    const scanning = isScanning();
    const has = st.report && Number.isFinite(Number(st.report.score));
    const score = has ? Math.max(0, Math.min(100, Math.round(Number(st.report.score)))) : null;
    let level = 'none';
    let word = 'No scan yet';
    if (score != null) {
      if (score >= 80) { level = 'ok'; word = 'Well sealed'; } else if (score >= 50) { level = 'warn'; word = 'Needs attention'; } else { level = 'risk'; word = 'Exposed'; }
    }
    if (scanning) { word = 'Scanning'; level = 'none'; }
    wrap.dataset.level = level;
    arc.setAttribute('stroke-dasharray', score == null ? '0 100' : score + ' 100');
    arc.style.opacity = score == null || score === 0 ? '0' : '1';
    $('[data-dial]').setAttribute('aria-label', score == null ? 'Security score: no scan yet' : 'Security score ' + score + ' out of 100, ' + word.toLowerCase());
    $('[data-score]').textContent = score == null ? '--' : String(score);
    $('[data-score-word]').textContent = word;
    $('[data-score-meta]').textContent = score == null ? '' : 'out of 100';
    const unknown = st.report ? st.report.checks.filter((c) => c.status === 'unknown').length : 0;
    $('[data-score-note]').textContent = score == null
      ? 'The score appears after the first scan.'
      : unknown
        ? unknown + ' check' + (unknown === 1 ? ' was' : 's were') + ' not measurable from this computer and ' + (unknown === 1 ? 'is' : 'are') + ' not counted as safe.'
        : 'Every check returned a result.';
  }

  // ---------- tables ----------
  function renderTables() {
    const upBox = $('[data-upnp]');
    const portBox = $('[data-ports]');
    if (!st.report) {
      const msg = isScanning() ? 'Waiting for the scan to finish.' : 'Run a deep scan to read these from your router.';
      upBox.innerHTML = `<p class="empty-state">${msg}</p>`;
      portBox.innerHTML = `<p class="empty-state">${msg}</p>`;
      $('[data-upnp-meta]').textContent = '';
      $('[data-ports-meta]').textContent = '';
      return;
    }
    const maps = Array.isArray(st.report.upnpMappings) ? st.report.upnpMappings : [];
    const upnp = st.report.checks.find((c) => c.id === 'upnp');
    $('[data-upnp-meta]').textContent = maps.length ? maps.length + ' forward' + (maps.length === 1 ? '' : 's') : '';
    if (maps.length) {
      upBox.innerHTML = `
        <div class="sh-table-wrap"><table class="sh-table">
          <thead><tr><th>Proto</th><th>External</th><th>Internal client</th><th>Port</th><th>Description</th></tr></thead>
          <tbody>${maps.map((m) => `<tr>
            <td>${esc(String(m.protocol || '').toUpperCase() || '?')}</td>
            <td class="sh-n">${esc(m.externalPort)}</td>
            <td class="sh-n">${esc(m.internalClient || 'unknown')}</td>
            <td class="sh-n">${esc(m.internalPort)}</td>
            <td class="sh-desc">${esc(m.description || '')}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="sh-fine">Each line is a hole a device on your network asked the router to open to the internet.</p>`;
    } else if (upnp && upnp.status === 'unknown') {
      upBox.innerHTML = '<p class="empty-state">The router did not answer UPnP queries, so port forwards are unknown. If UPnP is on, check its port-forwarding page in the router admin.</p>';
    } else if (upnp && upnp.status === 'ok') {
      upBox.innerHTML = '<p class="empty-state">UPnP is off or the router reported no automatic port forwards.</p>';
    } else {
      upBox.innerHTML = '<p class="empty-state">The router reported no UPnP port forwards.</p>';
    }

    const ports = Array.isArray(st.report.openPorts) ? st.report.openPorts.slice().sort((a, b) => a.port - b.port) : [];
    $('[data-ports-meta]').textContent = ports.length ? ports.length + ' open' : '';
    portBox.innerHTML = ports.length
      ? `<ul class="sh-portlist">${ports.map((p) => `<li data-level="${RISKY_PORTS[p.port] || 'none'}">
            <span class="sh-n">${esc(p.port)}</span><span>${esc(p.service || 'unknown service')}</span></li>`).join('')}</ul>
         <p class="sh-fine">Ports on the router that answer from inside your network. Whether they are also reachable from the internet cannot be tested from this computer.</p>`
      : '<p class="empty-state">No open ports found on the router from this computer.</p>';
  }

  function renderAll() {
    if (!alive) return;
    renderHead();
    renderList();
    renderErrors();
    renderScore();
    renderTables();
    kick();
  }

  // ---------- actions ----------
  async function runScan() {
    if (isScanning()) return;
    st.busy = true;
    st.scanError = null;
    st.live.clear();
    st.current = null;
    st.prog = null;
    renderAll();
    try {
      // The shell toasts the outcome; this view only reflects it.
      const r = await ctx.runScan({ depth: prefs.scanDepth });
      if (!alive) return;
      if (isReport(r)) st.report = r;
      else st.scanError = (r && (r.error || (Array.isArray(r.errors) && r.errors.join('; ')))) || 'The scanner returned no result.';
    } catch (err) {
      if (!alive) return;
      st.scanError = errText(err);
    } finally {
      st.busy = false;
      st.prog = null;
      st.current = null;
      st.live.clear();
      renderAll();
    }
  }
  runBtn.addEventListener('click', runScan);

  // ---------- store ----------
  st.titles = {};
  let lastIndex = -1;
  function applyProgress(p) {
    if (!p || typeof p !== 'object') { st.prog = null; st.current = null; return; }
    const idx = Number(p.index);
    const restarted = !st.prog || idx < lastIndex || (p.running === true && st.prog.running === false);
    if (restarted) st.live.clear();
    lastIndex = idx;
    st.prog = p;
    st.progAt = Date.now();
    st.staleShown = false;
    if (p.id && p.title) st.titles[p.id] = p.title;
    if (p.seen && typeof p.seen === 'object') {
      // Shell format: seen maps check id -> status, or 'checking' while it runs.
      st.live.clear();
      st.current = null;
      for (const [id, status] of Object.entries(p.seen)) {
        if (!id || id === 'null') continue;
        if (status === 'checking') st.current = id;
        else st.live.set(id, status);
      }
    } else if (p.id) {
      if (p.status) { st.live.set(p.id, p.status); st.current = null; } else st.current = p.id;
    }
    if (p.running === false && p.error && !st.busy) st.scanError = p.error;
  }
  subs.push(store.on('scanProgress', (p) => { applyProgress(p); renderAll(); }));
  subs.push(store.on('scan', (r) => {
    if (isReport(r)) { st.report = r; st.scanError = null; st.prog = null; st.current = null; st.live.clear(); }
    renderAll();
  }));
  subs.push(store.on('devices', () => kick()));
  subs.push(store.on('overview', () => { renderHead(); kick(); }));

  const onPrefs = () => { prefs = readPrefs(); renderList(); renderErrors(); };
  window.addEventListener(PREFS_EVENT, onPrefs);

  applyProgress(store.get('scanProgress'));

  // Reveal state for a scan already running (started from Home) through the fallback timeout in isScanning().
  const staleTimer = setInterval(() => {
    if (alive && st.prog && typeof st.prog.running !== 'boolean' && !st.busy && !isScanning() && !st.staleShown) { st.staleShown = true; renderAll(); }
  }, 5000);

  renderAll();
  requestAnimationFrame(() => { pal = palette(); sizeCanvas(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (alive) { pal = palette(); kick(); } });

  return {
    unmount() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      clearInterval(staleTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(PREFS_EVENT, onPrefs);
      for (const off of subs) if (typeof off === 'function') off();
      el.innerHTML = '';
    },
  };
}
