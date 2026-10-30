// Speed & Wi-Fi view: live speed gauge, result numerals, test history, Wi-Fi link details
// and the channel spectrum built from the real neighbour survey.
import { readPrefs, PREFS_EVENT } from './settings.js';
import { createChannelSpectrum } from '../viz/channel-spectrum.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const FONT_D = '"Bricolage Grotesque Variable", "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif';
const FONT_U = '"Plus Jakarta Sans", system-ui, "Segoe UI", sans-serif';
const FONT_M = '"JetBrains Mono", Consolas, monospace';
const HISTORY_KEY = 'bastion.speedHistory';
const FOCUS_KEYS = ['data-band', 'data-open'];
const HISTORY_MAX = 10;
const GAUGE_MAX = 1000;
// Gauge stops are spaced evenly round the 270 degree arc (piecewise linear), so home-broadband speeds stay readable.
const GAUGE_STOPS = [0, 10, 50, 100, 250, 500, 1000];
const GAUGE_LABELS = ['0', '10', '50', '100', '250', '500', '1G'];
const ARC_D = 'M59.29 200.71 A100 100 0 1 1 200.71 200.71';
const PHASE_WORD = { ping: 'Latency', download: 'Downloading', upload: 'Uploading', done: 'Complete' };
const CHANNELS = {
  '2.4': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  '5': [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
  '6': [5, 21, 37, 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213, 229],
};

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

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function fmtMbps(v) {
  const n = num(v);
  if (n == null) return '–';
  return n >= 100 ? n.toFixed(0) : n.toFixed(1);
}

function fmtClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'time unknown';
  return d.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// A result counts when anything was measured; the shell sets unmeasured directions to null.
// Runs render() and puts keyboard focus back on the matching rebuilt button (by data-* attribute).
function keepFocus(root, attrs, render) {
  const a = document.activeElement;
  let sel = null;
  let idx = -1;
  if (a && a !== document.body && root.contains(a)) {
    const k = attrs.find((x) => a.hasAttribute(x));
    if (k) {
      sel = '[' + k + '="' + CSS.escape(a.getAttribute(k)) + '"]';
      idx = [...root.querySelectorAll(sel)].indexOf(a);
    }
  }
  render();
  if (!sel || a.isConnected) return;
  const list = root.querySelectorAll(sel);
  const t = list[Math.max(0, Math.min(idx, list.length - 1))];
  if (t) t.focus();
}

function isResult(r) {
  return !!(r && [r.downMbps, r.upMbps, r.pingMs].some((v) => num(v) != null && v > 0));
}

function loadHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => x && (num(x.down) != null || num(x.up) != null || num(x.ping) != null)).slice(-HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_MAX)));
  } catch {
    // Storage unavailable: history lives for this session only.
  }
}

function normBand(b, channel) {
  const f = parseFloat(b);
  if (f >= 2 && f < 3) return '2.4';
  if (f >= 4.9 && f < 6) return '5';
  if (f >= 5.9 && f < 8) return '6';
  const ch = num(channel);
  if (ch != null) return ch <= 14 ? '2.4' : '5';
  return null;
}

function signalWord(rssi, pct) {
  if (num(rssi) != null) return rssi >= -60 ? 'Excellent' : rssi >= -67 ? 'Good' : rssi >= -75 ? 'Fair' : 'Weak';
  if (num(pct) != null) return pct >= 75 ? 'Excellent' : pct >= 55 ? 'Good' : pct >= 35 ? 'Fair' : 'Weak';
  return null;
}

function niceMax(v) {
  const steps = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 5000, 10000];
  for (const s of steps) if (v <= s) return s;
  return Math.ceil(v / 1000) * 1000;
}

function makeCanvas(canvas, draw) {
  const c2d = canvas.getContext('2d');
  const s = { c: canvas, ctx: c2d, w: 0, h: 0 };
  const size = () => {
    const r = canvas.getBoundingClientRect();
    const d = Math.min(2, window.devicePixelRatio || 1);
    s.w = r.width; s.h = r.height;
    canvas.width = Math.max(1, Math.round(r.width * d));
    canvas.height = Math.max(1, Math.round(r.height * d));
    c2d.setTransform(d, 0, 0, d, 0, 0);
    draw(s);
  };
  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  return { s, redraw: () => draw(s), dispose: () => ro.disconnect() };
}

export function mount(el, ctx) {
  const { api, store } = ctx;
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const subs = [];
  let alive = true;
  let raf = 0;
  let pal = palette();
  let prefs = readPrefs();
  let history = loadHistory();

  const sp = {
    busy: false,
    prog: null,
    progAt: 0,
    live: { down: null, up: null, ping: null },
    needle: 0,
    target: 0,
    outcome: null, // { kind: 'cancelled'|'failed', text }
    cancelling: false,
  };
  let selBand = null;
  let wifiBusy = false;

  el.innerHTML = `
    <section class="v-speed view-pad" aria-labelledby="sp-title">
      <header class="sp-head">
        <div>
          <p class="eyebrow">Speed &amp; Wi-Fi</p>
          <h1 class="h-display" id="sp-title">Measure, then tune.</h1>
        </div>
        <p class="sp-lede">Real measurements against Cloudflare's speed servers, your live Wi-Fi link, and which channel your neighbours crowd.</p>
      </header>

      <div class="sp-console">
        <div class="sp-hero">
          <div class="sp-run nv-glass">
            <div class="sp-card-h">
              <div><h2>Speed test</h2><p class="sp-sub">Cloudflare speed servers · nothing else is contacted</p></div>
              <span class="nv-tag" data-run-tag></span>
            </div>
            <div class="sp-gauge" data-gauge-wrap data-running="false">
              <svg viewBox="0 0 260 232" role="img" aria-labelledby="sp-g-title" data-gauge>
                <title id="sp-g-title">Speed gauge from 0 to 1 gigabit per second</title>
                <defs>
                  <linearGradient id="spGaugeGrad" x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0" style="stop-color:var(--sky)"/><stop offset=".55" style="stop-color:var(--violet)"/><stop offset="1" style="stop-color:var(--lavender)"/>
                  </linearGradient>
                  <radialGradient id="spGaugeWell" cx="130" cy="130" r="100" gradientUnits="userSpaceOnUse">
                    <stop offset=".5" style="stop-color:var(--violet);stop-opacity:0"/><stop offset="1" style="stop-color:var(--violet);stop-opacity:.12"/>
                  </radialGradient>
                  <filter id="spGaugeGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>
                </defs>
                <circle cx="130" cy="130" r="95" fill="url(#spGaugeWell)"/>
                <path class="g-inner" d="M73.43 186.57 A80 80 0 1 1 186.57 186.57"/>
                <path class="g-track" d="${ARC_D}" pathLength="100"/>
                <path class="g-glow" d="${ARC_D}" pathLength="100" stroke="url(#spGaugeGrad)" stroke-dasharray="0 100" filter="url(#spGaugeGlow)" data-gglow/>
                <path class="g-val" d="${ARC_D}" pathLength="100" stroke="url(#spGaugeGrad)" stroke-dasharray="0 100" data-gval/>
                <g data-gticks></g>
                <g class="g-head" data-needle transform="rotate(135 130 130)"><circle class="g-head-halo" cx="230" cy="130" r="13"/><circle class="g-head-dot" cx="230" cy="130" r="4.2"/></g>
              </svg>
              <div class="sp-read">
                <span class="sp-phase" data-phase>Ready</span>
                <span class="sp-read-num" data-gnum>–</span>
                <span class="sp-read-unit" data-gunit>Mbps</span>
              </div>
            </div>
            <div class="sp-prog" aria-hidden="true"><span data-prog></span></div>
            <p class="sp-result" data-result role="status" aria-live="polite"></p>
            <div class="sp-run-actions">
              <button class="btn btn--primary" type="button" data-run>Run speed test</button>
              <button class="btn btn--outline" type="button" data-cancel hidden>Cancel</button>
            </div>
          </div>

          <div class="sp-numerals">
            <div class="nv-glass nv-stat sp-tile"><span class="nv-stat-k"><svg class="sp-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sky)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v14M6 12l6 6 6-6"/></svg>Download</span><span class="sp-tile-v"><span class="nv-stat-v" data-n="down">–</span><span class="nv-stat-u">Mbps</span></span><span class="sp-spark" data-spark="down" aria-hidden="true"></span></div>
            <div class="nv-glass nv-stat sp-tile"><span class="nv-stat-k"><svg class="sp-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--lavender)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V6M6 12l6-6 6 6"/></svg>Upload</span><span class="sp-tile-v"><span class="nv-stat-v" data-n="up">–</span><span class="nv-stat-u">Mbps</span></span><span class="sp-spark" data-spark="up" aria-hidden="true"></span></div>
            <div class="nv-glass nv-stat sp-tile"><span class="nv-stat-k"><svg class="sp-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mint)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>Ping</span><span class="sp-tile-v"><span class="nv-stat-v" data-n="ping">–</span><span class="nv-stat-u">ms</span></span><span class="sp-spark" data-spark="ping" aria-hidden="true"></span></div>
            <div class="nv-glass nv-stat sp-tile"><span class="nv-stat-k"><svg class="sp-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h3l3-6 4 12 3-6h5"/></svg>Jitter</span><span class="sp-tile-v"><span class="nv-stat-v" data-n="jitter">–</span><span class="nv-stat-u">ms</span></span><span class="sp-spark" data-spark="jitter" aria-hidden="true"></span></div>
          </div>
        </div>

        <div class="sp-two">
          <div class="sp-card nv-glass">
            <div class="sp-card-h">
              <h2>History</h2>
              <div class="sp-legend"><span><i class="sp-lg-down"></i>Download</span><span><i class="sp-lg-up"></i>Upload</span><span class="nv-tag" data-hist-count></span></div>
            </div>
            <canvas class="sp-chart" data-chart role="img" aria-label="Speed test history"></canvas>
            <div class="sp-hist-foot"><p class="sp-fine" data-hist-note></p><button class="sp-link" type="button" data-hist-clear hidden>Clear history</button></div>
          </div>
          <div class="sp-card nv-glass">
            <div class="sp-card-h"><h2>Wi-Fi link</h2><button class="nv-mini" type="button" data-wifi-refresh>Refresh</button></div>
            <div data-wifi></div>
          </div>
        </div>

        <div class="sp-card sp-chan-card nv-glass">
          <div class="sp-card-h"><h2>Channel alignment</h2><div class="sp-bands" data-bands></div></div>
          <div data-chan></div>
        </div>
      </div>
    </section>`;

  const $ = (sel) => el.querySelector(sel);
  const runBtn = $('[data-run]');
  const cancelBtn = $('[data-cancel]');

  // ---------- state helpers ----------
  // The shell marks speedProgress.running; payloads without it fall back to phase + recency.
  function isRunning() {
    if (sp.busy) return true;
    if (!sp.prog) return false;
    if (typeof sp.prog.running === 'boolean') return sp.prog.running;
    return sp.prog.phase !== 'done' && Date.now() - sp.progAt < 15000;
  }

  function latestResult() {
    const r = store.get('speed');
    return isResult(r) ? r : null;
  }

  // ---------- gauge ----------
  // Piecewise-linear position (0..1) of a speed on the 270 degree arc.
  const frac = (v) => {
    const x = Math.max(0, Math.min(GAUGE_MAX, v));
    for (let i = 1; i < GAUGE_STOPS.length; i++) {
      if (x <= GAUGE_STOPS[i]) return ((i - 1) + (x - GAUGE_STOPS[i - 1]) / (GAUGE_STOPS[i] - GAUGE_STOPS[i - 1])) / (GAUGE_STOPS.length - 1);
    }
    return 1;
  };

  (function buildGaugeTicks() {
    const g = $('[data-gticks]');
    const NS = 'http://www.w3.org/2000/svg';
    // hairline minor ticks every 5 degrees just outside the track; the stops get longer marks
    const step = 270 / (GAUGE_STOPS.length - 1);
    for (let d = 5; d < 270; d += 5) {
      if (Math.abs(d / step - Math.round(d / step)) < 1e-6) continue;
      const a = (135 + d) * DEG;
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', (130 + 110 * Math.cos(a)).toFixed(2)); ln.setAttribute('y1', (130 + 110 * Math.sin(a)).toFixed(2));
      ln.setAttribute('x2', (130 + 113 * Math.cos(a)).toFixed(2)); ln.setAttribute('y2', (130 + 113 * Math.sin(a)).toFixed(2));
      ln.setAttribute('class', 'g-minor');
      g.appendChild(ln);
    }
    GAUGE_STOPS.forEach((v, i) => {
      const a = (135 + 270 * (i / (GAUGE_STOPS.length - 1))) * DEG;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', (130 + 125 * c).toFixed(1));
      t.setAttribute('y', (130 + 125 * sn + 3.5).toFixed(1));
      t.setAttribute('text-anchor', Math.abs(c) < 0.2 ? 'middle' : c < 0 ? 'end' : 'start');
      t.setAttribute('class', 'g-tick');
      t.textContent = GAUGE_LABELS[i];
      g.appendChild(t);
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', (130 + 109 * c).toFixed(2)); ln.setAttribute('y1', (130 + 109 * sn).toFixed(2));
      ln.setAttribute('x2', (130 + 116 * c).toFixed(2)); ln.setAttribute('y2', (130 + 116 * sn).toFixed(2));
      ln.setAttribute('class', 'g-mark');
      g.appendChild(ln);
    });
  })();

  const gWrap = $('[data-gauge-wrap]');
  const gVal = $('[data-gval]');
  const gNeedle = $('[data-needle]');
  const gGlow = $('[data-gglow]');
  const gNum = $('[data-gnum]');
  const gUnit = $('[data-gunit]');

  function drawGauge() {
    const f = frac(sp.needle);
    const running = isRunning();
    gVal.setAttribute('stroke-dasharray', (f * 100).toFixed(2) + ' 100');
    gVal.style.opacity = f > 0.002 ? '1' : '0';
    gGlow.setAttribute('stroke-dasharray', (f * 100).toFixed(2) + ' 100');
    gGlow.style.opacity = f > 0.002 ? '' : '0';
    gNeedle.style.opacity = f > 0.002 ? '1' : '0';
    gNeedle.setAttribute('transform', 'rotate(' + (135 + 270 * f).toFixed(2) + ' 130 130)');
    gWrap.dataset.running = String(running);

    const p = sp.prog;
    let big = '–';
    let unit = 'Mbps';
    if (running && p && p.phase === 'ping') {
      big = num(p.pingMs) != null ? String(Math.round(p.pingMs)) : '–';
      unit = 'ms';
    } else if (running && p && num(p.mbps) != null) {
      big = fmtMbps(p.mbps);
    } else if (latestResult()) {
      big = fmtMbps(latestResult().downMbps);
    }
    if (gNum.textContent !== big) gNum.textContent = big;
    gNum.toggleAttribute('data-empty', big === '–');
    if (gUnit.textContent !== unit) gUnit.textContent = unit;
  }

  const gauge = { redraw: drawGauge, dispose() {} };

  function animate() {
    raf = 0;
    if (!alive) return;
    const diff = sp.target - sp.needle;
    sp.needle += diff * 0.12;
    if (Math.abs(diff) < 0.05) sp.needle = sp.target;
    if (!document.hidden) gauge.redraw();
    if (sp.needle !== sp.target || isRunning()) raf = requestAnimationFrame(animate);
  }

  function setTarget(v) {
    sp.target = Math.max(0, num(v) ?? 0);
    if (RM) { sp.needle = sp.target; gauge.redraw(); return; }
    if (!raf) raf = requestAnimationFrame(animate);
  }

  // ---------- numerals / status ----------
  function renderRun() {
    const running = isRunning();
    const p = sp.prog;
    const r = latestResult();
    runBtn.disabled = running;
    runBtn.textContent = running ? 'Testing' : r ? 'Run again' : 'Run speed test';
    cancelBtn.hidden = !running;
    cancelBtn.disabled = sp.cancelling;
    cancelBtn.textContent = sp.cancelling ? 'Cancelling' : 'Cancel';

    const phaseEl = $('[data-phase]');
    const resultEl = $('[data-result]');
    const progEl = $('[data-prog]');
    if (!phaseEl || !resultEl || !progEl) return; // view already unmounted
    if (running) {
      phaseEl.textContent = p ? PHASE_WORD[p.phase] || String(p.phase) : 'Starting';
      progEl.style.width = (p && num(p.progress) != null ? Math.max(0, Math.min(1, p.progress)) * 100 : 0) + '%';
      resultEl.textContent = !p ? 'Connecting to the nearest Cloudflare speed server.'
        : p.phase === 'ping' ? 'Measuring round trip time to the test server.'
        : p.phase === 'download' ? 'Pulling test data. Other traffic on your network lowers this number.'
        : p.phase === 'upload' ? 'Pushing test data back to the server.' : 'Finishing.';
    } else {
      progEl.style.width = r ? '100%' : '0%';
      if (sp.outcome) {
        phaseEl.textContent = sp.outcome.kind === 'cancelled' ? 'Cancelled' : 'Failed';
        resultEl.textContent = sp.outcome.text;
      } else if (r) {
        phaseEl.textContent = 'Download';
        const wifi = store.get('wifi');
        const onWifi = wifi && wifi.supported && wifi.channel;
        const dir = (v, word) => (num(v) != null ? fmtMbps(v) + ' ' + word : word + ' not measured');
        resultEl.textContent = dir(r.downMbps, 'down') + ', ' + dir(r.upMbps, 'up') + ', ' + (num(r.pingMs) != null ? Math.round(r.pingMs) + ' ms ping' : 'ping unknown') +
          (r.server ? ' via ' + r.server : '') + ' at ' + fmtWhen(r.at) + '.' +
          (onWifi ? ' Measured over Wi-Fi channel ' + wifi.channel + '.' : '');
      } else {
        phaseEl.textContent = 'Ready';
        resultEl.textContent = 'A test downloads and then uploads test data through Cloudflare. Pause big downloads on your network for an honest number.';
      }
    }
    phaseEl.dataset.state = running ? 'run' : sp.outcome ? 'err' : 'idle';
    const tag = $('[data-run-tag]');
    const wifiNow = store.get('wifi');
    tag.textContent = wifiNow && wifiNow.supported && wifiNow.channel
      ? (normBand(wifiNow.band, wifiNow.channel) ? normBand(wifiNow.band, wifiNow.channel) + ' GHz · ' : '') + 'ch ' + wifiNow.channel
      : '';
    gauge.redraw();

    const n = (k, v) => { const e = $('[data-n="' + k + '"]'); e.textContent = v; e.toggleAttribute('data-empty', v === '–'); };
    if (running) {
      if (p && p.phase === 'ping' && num(p.pingMs) != null) sp.live.ping = p.pingMs;
      if (p && p.phase === 'download' && num(p.mbps) != null) sp.live.down = p.mbps;
      if (p && p.phase === 'upload' && num(p.mbps) != null) sp.live.up = p.mbps;
      if (p && sp.live.down == null && num(p.downMbps) != null) sp.live.down = p.downMbps;
      if (p && sp.live.up == null && num(p.upMbps) != null) sp.live.up = p.upMbps;
      n('down', sp.live.down != null ? fmtMbps(sp.live.down) : '–');
      n('up', sp.live.up != null ? fmtMbps(sp.live.up) : '–');
      n('ping', sp.live.ping != null ? String(Math.round(sp.live.ping)) : '–');
      n('jitter', '–');
    } else if (r) {
      n('down', fmtMbps(r.downMbps));
      n('up', fmtMbps(r.upMbps));
      n('ping', num(r.pingMs) != null ? String(Math.round(r.pingMs)) : '–');
      n('jitter', num(r.jitterMs) != null ? (r.jitterMs < 10 ? r.jitterMs.toFixed(1) : String(Math.round(r.jitterMs))) : '–');
    } else if (history.length) {
      // No result this session yet: the tiles show the last saved test (the one their trend ends on).
      const h = history[history.length - 1];
      n('down', fmtMbps(h.down));
      n('up', fmtMbps(h.up));
      n('ping', num(h.ping) != null ? String(Math.round(h.ping)) : '–');
      n('jitter', num(h.jitter) != null ? (h.jitter < 10 ? h.jitter.toFixed(1) : String(Math.round(h.jitter))) : '–');
    } else {
      ['down', 'up', 'ping', 'jitter'].forEach((k) => n(k, '–'));
    }
  }

  async function runTest() {
    if (isRunning()) return;
    sp.busy = true;
    sp.outcome = null;
    sp.cancelling = false;
    sp.prog = null;
    sp.live = { down: null, up: null, ping: null };
    setTarget(0);
    renderRun();
    try {
      // The shell toasts the outcome and stores successful results; this view reflects them.
      const r = await ctx.runSpeed();
      if (!alive) return;
      const errs = r && Array.isArray(r.errors) ? r.errors.filter(Boolean) : [];
      const msg = (r && r.error) || errs.join('; ');
      const cancelled = sp.cancelling || errs.some((e) => /cancel|abort/i.test(e));
      if (cancelled) {
        sp.outcome = { kind: 'cancelled', text: 'Test cancelled. Nothing was recorded.' };
      } else if (isResult(r)) {
        sp.outcome = null;
        record(r);
      } else {
        sp.outcome = { kind: 'failed', text: 'The test did not finish' + (msg ? ': ' + msg : '.') + ' Check your internet connection and try again.' };
      }
    } catch (err) {
      if (!alive) return;
      sp.outcome = sp.cancelling
        ? { kind: 'cancelled', text: 'Test cancelled. Nothing was recorded.' }
        : { kind: 'failed', text: 'The test did not finish: ' + errText(err) + ' Check your internet connection and try again.' };
    } finally {
      sp.busy = false;
      sp.cancelling = false;
      sp.prog = null;
      // The view may have been left while the test ran: nothing to render into then.
      if (alive) {
        const lr = latestResult();
        setTarget(lr && !sp.outcome ? lr.downMbps || 0 : 0);
        renderRun();
        renderHistory();
      }
    }
  }

  async function cancelTest() {
    if (!isRunning() || sp.cancelling) return;
    sp.cancelling = true;
    renderRun();
    try {
      await api.speed.cancel();
    } catch (err) {
      ctx.toast('Could not cancel: ' + errText(err), 'warn');
      sp.cancelling = false;
      renderRun();
    }
  }

  runBtn.addEventListener('click', runTest);
  cancelBtn.addEventListener('click', cancelTest);

  // ---------- history ----------
  function record(r) {
    if (!isResult(r)) return;
    const at = r.at || new Date().toISOString();
    if (history.some((x) => x.at === at)) return;
    history.push({ at, down: num(r.downMbps), up: num(r.upMbps), ping: num(r.pingMs), jitter: num(r.jitterMs) });
    history = history.slice(-HISTORY_MAX);
    saveHistory(history);
    renderHistory();
  }

  function drawChart(s) {
    const { ctx, w, h } = s;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const L = 44;
    const Rr = 52;
    const Tp = 16;
    const B = 26;
    const pw = Math.max(10, w - L - Rr);
    const ph = Math.max(10, h - Tp - B);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.font = '500 10.5px ' + FONT_M;
    if (!history.length) {
      // Empty state: the bare instrument (quiet guides, a lit floor) and one line of direction.
      for (const i of [0, 1, 3, 4]) { // the middle guide would run through the message
        const y = Math.round(Tp + ph * (i / 4)) + 0.5;
        ctx.strokeStyle = rgba(pal.lavender, i === 4 ? 0.26 : 0.06); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      }
      const fl = ctx.createRadialGradient(L + pw / 2, Tp + ph, 0, L + pw / 2, Tp + ph, pw * 0.45);
      fl.addColorStop(0, rgba(pal.violet, 0.16)); fl.addColorStop(1, rgba(pal.violet, 0));
      ctx.fillStyle = fl; ctx.fillRect(L, Tp, pw, ph);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = pal.text; ctx.font = '700 16px ' + FONT_D;
      ctx.fillText('No tests yet', L + pw / 2, Tp + ph / 2 - 10);
      ctx.fillStyle = pal.muted; ctx.font = '500 12.5px ' + FONT_U;
      ctx.fillText('Each finished speed test draws a point here.', L + pw / 2, Tp + ph / 2 + 13);
      return;
    }
    const peak = Math.max(...history.map((x) => Math.max(x.down || 0, x.up || 0)), 1);
    const max = niceMax(peak * 1.1);
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const y = Tp + ph * (1 - v / max);
      ctx.strokeStyle = rgba(pal.lavender, i === 0 ? 0.26 : 0.06); ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = pal.dim; ctx.textAlign = 'right';
      ctx.fillText(v >= 100 ? String(Math.round(v)) : String(+v.toFixed(1)), L - 10, y);
    }
    ctx.setLineDash([]);
    const n = history.length;
    const X = (i) => (n === 1 ? L + pw / 2 : L + (i / (n - 1)) * pw);
    const Y = (v) => Tp + ph * (1 - Math.min(max, Math.max(0, v || 0)) / max);
    // x labels
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = pal.dim;
    const every = pw / Math.max(1, n - 1) < 44 ? 2 : 1;
    history.forEach((x, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      ctx.textAlign = n === 1 ? 'center' : i === 0 ? 'left' : i === n - 1 ? 'right' : 'center';
      ctx.fillText(fmtClock(x.at), X(i), h - 6);
    });
    // Tests where a direction was not measured leave a gap instead of a fake zero. Each measured
    // run is drawn as a smooth monotone curve (no overshoot above or below the real values).
    const runs = (key) => {
      const out = [];
      let cur = null;
      history.forEach((x, i) => {
        if (num(x[key]) == null) { cur = null; return; }
        if (!cur) { cur = []; out.push(cur); }
        cur.push([X(i), Y(x[key])]);
      });
      return out;
    };
    const smooth = (pts, move) => {
      if (move) ctx.moveTo(pts[0][0], pts[0][1]); else ctx.lineTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) return;
      const m = pts.length;
      const d = [];
      const t = [];
      for (let i = 0; i < m - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1));
      t[0] = d[0];
      t[m - 1] = d[m - 2];
      for (let i = 1; i < m - 1; i++) t[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
      for (let i = 0; i < m - 1; i++) {
        if (d[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
        const a = t[i] / d[i];
        const b = t[i + 1] / d[i];
        const q = a * a + b * b;
        if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * d[i]; t[i + 1] = k * b * d[i]; }
      }
      for (let i = 0; i < m - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const hx = (x1 - x0) / 3;
        ctx.bezierCurveTo(x0 + hx, y0 + t[i] * hx, x1 - hx, y1 - t[i + 1] * hx, x1, y1);
      }
    };
    const path = (key) => {
      ctx.beginPath();
      for (const r of runs(key)) smooth(r, true);
    };
    if (n > 1) {
      // area under each download run: violet light fading into the floor
      for (const r of runs('down')) {
        if (r.length < 2) continue;
        ctx.beginPath();
        smooth(r, true);
        ctx.lineTo(r[r.length - 1][0], Tp + ph);
        ctx.lineTo(r[0][0], Tp + ph);
        ctx.closePath();
        const top = Math.min(...r.map((q) => q[1]));
        const g = ctx.createLinearGradient(0, top, 0, Tp + ph);
        g.addColorStop(0, rgba(pal.violet, 0.4)); g.addColorStop(0.5, rgba(pal.violet, 0.13)); g.addColorStop(1, rgba(pal.violet, 0));
        ctx.fillStyle = g; ctx.fill();
      }
      if (history.some((x) => num(x.up) != null)) {
        path('up'); ctx.strokeStyle = rgba(pal.sky, 0.8); ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.save();
      ctx.shadowColor = rgba(pal.violet, 0.95); ctx.shadowBlur = 16;
      path('down'); ctx.strokeStyle = rgba(pal.lavender, 0.9); ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      ctx.restore();
      path('down'); ctx.strokeStyle = rgba('#FFFFFF', 0.55); ctx.lineWidth = 0.8; ctx.stroke();
    }
    history.forEach((x, i) => {
      if (num(x.down) != null && !(i === n - 1 && n > 1)) { ctx.fillStyle = 'rgba(12,10,26,1)'; ctx.beginPath(); ctx.arc(X(i), Y(x.down), 3.2, 0, TAU); ctx.fill(); ctx.strokeStyle = pal.lavender; ctx.lineWidth = 1.4; ctx.stroke(); }
      if (num(x.up) != null) { ctx.fillStyle = rgba(pal.sky, 0.85); ctx.beginPath(); ctx.arc(X(i), Y(x.up), 2, 0, TAU); ctx.fill(); }
    });
    const last = history[n - 1];
    const ex = X(n - 1);
    const hasDown = num(last.down) != null;
    const ey = hasDown ? Y(last.down) : Tp;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const lx = Math.min(ex + 14, w - 44);
    if (hasDown) {
      const hg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 22);
      hg.addColorStop(0, rgba(pal.lavender, 0.6)); hg.addColorStop(0.4, rgba(pal.violet, 0.22)); hg.addColorStop(1, rgba(pal.violet, 0));
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(ex, ey, 22, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(pal.lavender, 0.45); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(ex, ey, 7.5, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, 3.6, 0, TAU); ctx.fill();
      ctx.font = '700 14px ' + FONT_D;
      ctx.fillStyle = pal.text; ctx.fillText(fmtMbps(last.down), lx, ey);
    }
    if (num(last.up) != null) {
      let uy = Y(last.up);
      if (Math.abs(uy - ey) < 16) uy = ey + 16;
      ctx.font = '600 12px ' + FONT_U;
      ctx.fillStyle = pal.sky; ctx.fillText(fmtMbps(last.up), lx, Math.min(h - B, uy));
    }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  }

  const chart = makeCanvas($('[data-chart]'), drawChart);

  // Each result tile carries its own trend across the saved tests: a hairline with a soft fill and
  // the newest point lit. Fewer than two tests: just the quiet track.
  const SPARK = { down: 'var(--sky)', up: 'var(--lavender)', ping: 'var(--mint)', jitter: 'var(--amber)' };
  function renderSparks() {
    const SW = 240;
    const SH = 40;
    for (const k of Object.keys(SPARK)) {
      const host = $('[data-spark="' + k + '"]');
      if (!host) continue;
      const vals = history.map((x) => num(x[k])).filter((v) => v != null).slice(-12);
      let html;
      if (vals.length < 2) {
        html = `<svg viewBox="0 0 ${SW} ${SH}" preserveAspectRatio="none"><line class="sp-spark-track" x1="0" y1="${SH - 0.5}" x2="${SW}" y2="${SH - 0.5}" vector-effect="non-scaling-stroke"/></svg>`;
      } else {
        const lo = Math.min(...vals);
        const span = Math.max(...vals) - lo || 1;
        const pts = vals.map((v, i) => [(i / (vals.length - 1)) * SW, SH - 4 - ((v - lo) / span) * (SH - 12)]);
        const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        const last = pts[pts.length - 1];
        html = `<svg viewBox="0 0 ${SW} ${SH}" preserveAspectRatio="none">
            <defs><linearGradient id="spk-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
            <line class="sp-spark-track" x1="0" y1="${SH - 0.5}" x2="${SW}" y2="${SH - 0.5}" vector-effect="non-scaling-stroke"/>
            <path d="${d} L${SW} ${SH} L0 ${SH} Z" fill="url(#spk-${k})"/>
            <path class="sp-spark-line" d="${d}" vector-effect="non-scaling-stroke"/>
          </svg><i class="sp-spark-dot" style="left:100%;top:${((last[1] / SH) * 100).toFixed(1)}%"></i>`;
      }
      html += `<span class="sp-spark-cap">${vals.length ? (vals.length === 1 ? '1 test' : 'Last ' + vals.length + ' tests') : 'No data yet'}</span>`;
      host.style.color = SPARK[k];
      if (host.__html !== html) { host.innerHTML = html; host.__html = html; }
    }
  }

  function renderHistory() {
    if (!alive) return;
    chart.redraw();
    renderSparks();
    const n = history.length;
    $('[data-hist-count]').textContent = n ? 'Last ' + n + ' test' + (n === 1 ? '' : 's') : '';
    $('[data-hist-clear]').hidden = !n;
    let note = 'Every finished test is added here, up to the last ' + HISTORY_MAX + '. Kept on this computer only.';
    const downs = history.map((x) => num(x.down)).filter((v) => v != null);
    if (downs.length >= 2) {
      const best = Math.max(...downs);
      const worst = Math.min(...downs);
      note = 'Best ' + fmtMbps(best) + ', worst ' + fmtMbps(worst) + ' Mbps down across ' + downs.length + ' tests. A wide spread usually means Wi-Fi interference or a busy network at those times.';
    }
    $('[data-hist-note]').textContent = note;
    $('[data-chart]').setAttribute('aria-label', n ? 'Speed test history, ' + n + ' tests. Latest ' + (num(history[n - 1].down) != null ? fmtMbps(history[n - 1].down) + ' Mbps down.' : 'download not measured.') : 'Speed test history, no tests yet');
  }

  $('[data-hist-clear]').addEventListener('click', () => {
    history = [];
    saveHistory(history);
    renderHistory();
    renderRun();
  });

  // ---------- Wi-Fi link ----------
  function platformGuide(wifi) {
    const errs = wifi && Array.isArray(wifi.errors) ? wifi.errors.join(' ') : '';
    const locationIssue = /locat|permission|denied|privacy/i.test(errs);
    if (api.platform === 'win32') {
      return {
        title: locationIssue ? 'Windows is hiding Wi-Fi details' : 'Wi-Fi details are not available',
        steps: [
          'Open Settings, then Privacy & security, then Location.',
          'Turn on Location services and "Let desktop apps access your location".',
          'Come back here and press Refresh.',
        ],
        note: 'Windows 11 only shares the network name, channel and nearby networks with apps that have location access. Bastion does not read your location.',
      };
    }
    if (api.platform === 'darwin') {
      return {
        title: locationIssue ? 'macOS is hiding Wi-Fi details' : 'Wi-Fi details are not available',
        steps: [
          'Open System Settings, then Privacy & Security, then Location Services.',
          'Turn Location Services on and allow Bastion.',
          'Come back here and press Refresh.',
        ],
        note: 'macOS only reveals network names and channels to apps with Location Services access. Bastion does not read your location.',
      };
    }
    return { title: 'Wi-Fi details are not available here', steps: [], note: 'Wi-Fi information needs the desktop app on Windows or macOS.' };
  }

  function unsupportedBlock(wifi, what) {
    const g = platformGuide(wifi);
    const errs = wifi && Array.isArray(wifi.errors) ? wifi.errors.filter(Boolean) : [];
    return `
      <div class="sp-unsupported">
        <p class="sp-unsup-title">${esc(g.title)}</p>
        <p class="sp-fine">${esc(what)} ${esc(g.note)}</p>
        ${g.steps.length ? `<ol class="sp-steps">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
        ${errs.length && prefs.advancedEvidence ? `<p class="sp-mono-note">${errs.map(esc).join('<br>')}</p>` : ''}
        <div class="sp-actions"><button class="nv-mini" type="button" data-open="wifi-settings">Open Wi-Fi settings</button></div>
      </div>`;
  }

  function kv(label, value, cls) {
    const unknown = value == null || value === '';
    return `<div class="sp-kv"><span>${esc(label)}</span><span class="${unknown ? 'sp-unknown' : cls || ''}">${unknown ? 'unknown' : esc(value)}</span></div>`;
  }

  function renderWifi() {
    const box = $('[data-wifi]');
    const wifi = store.get('wifi');
    $('[data-wifi-refresh]').disabled = wifiBusy;
    $('[data-wifi-refresh]').textContent = wifiBusy ? 'Reading' : 'Refresh';
    // Store convention: undefined = not loaded yet, null = load failed.
    if (wifi === undefined || (wifi === null && wifiBusy)) {
      box.innerHTML = '<p class="empty-state">Reading the Wi-Fi adapter.</p>';
      return;
    }
    if (wifi === null) {
      box.innerHTML = '<p class="empty-state">Bastion could not read the Wi-Fi adapter, so the link details are unknown. Press Refresh to try again.</p>';
      return;
    }
    if (typeof wifi !== 'object' || (wifi.ok === false && wifi.supported == null)) {
      box.innerHTML = `<p class="empty-state">Could not read Wi-Fi details${wifi && wifi.error ? ': ' + esc(wifi.error) : '.'}</p>`;
      return;
    }
    if (!wifi.supported) {
      box.innerHTML = unsupportedBlock(wifi, 'Bastion could not read the Wi-Fi link.');
      return;
    }
    if (!wifi.ssid && !wifi.channel && num(wifi.rssi) == null && num(wifi.signalPct) == null) {
      const errs = Array.isArray(wifi.errors) && wifi.errors.length;
      box.innerHTML = errs
        ? unsupportedBlock(wifi, 'The Wi-Fi adapter answered without network details.')
        : '<p class="empty-state">This computer is not connected to Wi-Fi right now. It may be on a cable, or Wi-Fi is off. Speed tests still work; Wi-Fi tuning needs a Wi-Fi connection.</p>';
      return;
    }
    const band = normBand(wifi.band, wifi.channel);
    const sw = signalWord(wifi.rssi, wifi.signalPct);
    const sigParts = [];
    if (num(wifi.signalPct) != null) sigParts.push(Math.round(wifi.signalPct) + '%');
    if (num(wifi.rssi) != null) sigParts.push(Math.round(wifi.rssi) + ' dBm');
    const sec = wifi.security || null;
    const weakSec = sec && /wep|open|none|tkip/i.test(sec);
    const strongSec = sec && /wpa3/i.test(sec);
    const rates = [];
    if (num(wifi.rxMbps) != null) rates.push('↓ ' + Math.round(wifi.rxMbps));
    if (num(wifi.txMbps) != null) rates.push('↑ ' + Math.round(wifi.txMbps));
    box.innerHTML = `
      <div class="sp-wifi-top">
        <div class="sp-ssid"><span class="sp-k">Network</span><b>${esc(wifi.ssid || 'Name hidden')}</b></div>
        <div class="sp-sig">
          <span class="sp-bars" data-q="${esc((sw || '').toLowerCase())}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <span class="sp-k">${esc(sw || 'Signal unknown')}</span>
        </div>
      </div>
      <div class="sp-kvs">
        ${kv('Band', band ? band + ' GHz' : null)}
        ${kv('Channel', wifi.channel)}
        ${kv('Width', num(wifi.widthMHz) != null ? wifi.widthMHz + ' MHz' : null)}
        ${kv('Signal', sigParts.join(' · ') || null)}
        ${kv('Link rate', rates.length ? rates.join('  ') + ' Mbps' : null)}
        ${kv('Security', sec, weakSec ? 'sp-warn' : strongSec ? 'sp-good' : '')}
        ${kv('Hidden from location maps', wifi.nomap == null ? null : wifi.nomap ? 'Yes (_nomap)' : 'No')}
        ${prefs.advancedEvidence ? kv('BSSID', wifi.bssid, 'sp-mono') : ''}
      </div>
      ${weakSec ? '<p class="sp-warnline">This network uses weak or no encryption. Switch the router to WPA2 or WPA3 in its Wi-Fi settings.</p>' : ''}
      ${num(wifi.rxMbps) != null ? '<p class="sp-fine">Link rate is the radio speed between this computer and the router, not your internet speed.</p>' : ''}`;
  }

  async function refreshWifi() {
    if (wifiBusy) return;
    wifiBusy = true;
    renderWifi();
    try {
      const [info, survey] = await Promise.all([
        api.wifi.info().catch((err) => ({ supported: false, errors: [errText(err)] })),
        api.wifi.survey().catch((err) => ({ supported: false, networks: [], congestion: [], current: {}, recommendation: null, errors: [errText(err)] })),
      ]);
      if (!alive) return;
      store.set('wifi', info);
      store.set('survey', survey);
    } finally {
      wifiBusy = false;
      if (alive) { renderWifi(); renderChannel(); }
    }
  }

  $('[data-wifi-refresh]').addEventListener('click', refreshWifi);

  // ---------- channel alignment ----------
  function surveyCounts(survey, band) {
    const counts = new Map();
    const cong = Array.isArray(survey.congestion) ? survey.congestion : [];
    if (cong.length) {
      for (const c of cong) {
        if (normBand(c.band, c.channel) !== band) continue;
        counts.set(Number(c.channel), (counts.get(Number(c.channel)) || 0) + (Number(c.count) || 0));
      }
    } else if (Array.isArray(survey.networks)) {
      for (const n of survey.networks) {
        if (normBand(n.band, n.channel) !== band) continue;
        counts.set(Number(n.channel), (counts.get(Number(n.channel)) || 0) + 1);
      }
    }
    return counts;
  }

  function surveyBands(survey, wifi) {
    const set = new Set();
    for (const c of survey.congestion || []) { const b = normBand(c.band, c.channel); if (b) set.add(b); }
    for (const n of survey.networks || []) { const b = normBand(n.band, n.channel); if (b) set.add(b); }
    const cur = normBand(survey.current && survey.current.band, survey.current && survey.current.channel) || (wifi && normBand(wifi.band, wifi.channel));
    if (cur) set.add(cur);
    return { bands: ['2.4', '5', '6'].filter((b) => set.has(b)), current: cur };
  }

  // Watch-style congestion dial: ten hairline segments. Clear channel = a full mint ring; each
  // neighbour fills more segments, warming from amber to coral. Unknown = an empty track.
  function mix(a, b, f) {
    const pa = rgbOf(a);
    const pb = rgbOf(b);
    return 'rgb(' + pa.map((v, i) => Math.round(v + (pb[i] - v) * f)).join(',') + ')';
  }

  function rgbOf(c) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(c).trim());
    const n = m ? parseInt(m[1], 16) : 0xb7a9ff;
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  function dialSvg(nowN) {
    const SEG = 10;
    const C = 90;
    const R = 70;
    const gap = 6;
    const filled = nowN == null ? 0 : nowN === 0 ? SEG : Math.min(SEG, Math.max(2, Math.ceil(SEG * (1 - Math.exp(-nowN / 2.2)))));
    const parts = [];
    for (let i = 0; i < 60; i++) {
      const a = (-90 + i * 6) * DEG;
      const major = i % 5 === 0;
      const r0 = major ? 80 : 81.5;
      const r1 = 84;
      parts.push(`<line x1="${(C + r0 * Math.cos(a)).toFixed(2)}" y1="${(C + r0 * Math.sin(a)).toFixed(2)}" x2="${(C + r1 * Math.cos(a)).toFixed(2)}" y2="${(C + r1 * Math.sin(a)).toFixed(2)}" class="sp-dial-tick${major ? ' is-major' : ''}"/>`);
    }
    for (let i = 0; i < SEG; i++) {
      const a0 = (-90 + i * (360 / SEG) + gap / 2) * DEG;
      const a1 = (-90 + (i + 1) * (360 / SEG) - gap / 2) * DEG;
      const d = `M${(C + R * Math.cos(a0)).toFixed(2)} ${(C + R * Math.sin(a0)).toFixed(2)} A${R} ${R} 0 0 1 ${(C + R * Math.cos(a1)).toFixed(2)} ${(C + R * Math.sin(a1)).toFixed(2)}`;
      parts.push(`<path d="${d}" class="sp-seg-track"/>`);
      if (i < filled) {
        const col = nowN === 0 ? pal.mint : mix(pal.amber, pal.coral, filled > 1 ? i / (filled - 1) : 0);
        parts.push(`<path d="${d}" class="sp-seg" stroke="${col}" style="--i:${i};color:${col}"/>`);
      }
    }
    return `<svg viewBox="0 0 180 180" aria-hidden="true">${parts.join('')}</svg>`;
  }

  // Builds what the spectrum draws: the real survey for one band, nothing invented.
  function spectrumData(survey, wifi, band, chs, curCh, curBand, recCh) {
    const nets = (Array.isArray(survey.networks) ? survey.networks : [])
      .filter((n) => normBand(n.band, n.channel) === band && Number(n.channel) > 0)
      .map((n) => ({
        ssid: n.ssid || '',
        bssid: n.bssid || '',
        channel: Number(n.channel),
        widthMHz: num(n.widthMHz),
        signalPct: num(n.signalPct),
        own: !!n.own || !!(wifi && ((wifi.bssid && n.bssid === wifi.bssid) || (wifi.ssid && n.ssid && n.ssid === wifi.ssid))),
      }));
    const onBand = band === curBand;
    const neighbours = nets.filter((n) => !n.own).length;
    const radios = [...new Set(nets.filter((n) => n.own && n.channel !== curCh).map((n) => n.channel))];
    const summary = 'Wi-Fi spectrum for ' + band + ' GHz: ' + neighbours + ' neighbouring network' + (neighbours === 1 ? '' : 's') + ' heard.' +
      (curCh != null ? ' Your network is on channel ' + curCh + '.' : '') +
      (radios.length ? ' Your router\'s other radio is on channel ' + radios.join(', ') + '.' : '') +
      (recCh != null && recCh !== curCh ? ' Quietest channel is ' + recCh + '.' : '');
    return {
      band,
      channels: chs,
      networks: nets,
      current: curCh,
      currentWidth: onBand && wifi && num(wifi.widthMHz) != null ? wifi.widthMHz : null,
      recommended: recCh,
      link: wifi ? { ssid: wifi.ssid || '', bssid: wifi.bssid || '' } : null,
      ownFallback: onBand && wifi && curCh != null ? { ssid: wifi.ssid || '', signalPct: num(wifi.signalPct) } : null,
      summary,
    };
  }

  let spectrumViz = null;
  let spectrumBand = null;

  function dropSpectrum() {
    if (spectrumViz) { spectrumViz.dispose(); spectrumViz = null; }
    spectrumBand = null;
  }

  function chanMessage(html) {
    dropSpectrum();
    $('[data-chan]').innerHTML = html;
  }

  // Sets innerHTML only when it changed, so CSS entrance animations do not replay on refresh.
  function setHtml(node, html) {
    if (node && node.__html !== html) { node.innerHTML = html; node.__html = html; }
  }

  function renderChannel() {
    const box = $('[data-chan]');
    const bandsEl = $('[data-bands]');
    const survey = store.get('survey');
    const wifi = store.get('wifi');
    if (survey === undefined || (survey === null && wifiBusy)) {
      bandsEl.innerHTML = '';
      chanMessage('<p class="empty-state">Listening for nearby networks.</p>');
      return;
    }
    if (survey === null) {
      bandsEl.innerHTML = '';
      chanMessage('<p class="empty-state">Bastion could not list the networks around you, so channel crowding is unknown. Press Refresh above to try again.</p>');
      return;
    }
    if (typeof survey !== 'object' || !survey.supported) {
      bandsEl.innerHTML = '';
      chanMessage(unsupportedBlock(survey, 'Bastion could not list the networks around you, so it cannot compare channels.'));
      return;
    }
    const { bands, current: curBand } = surveyBands(survey, wifi);
    if (!bands.length) {
      bandsEl.innerHTML = '';
      chanMessage('<p class="empty-state">No nearby networks were heard. Either the air is clear or the scan was blocked; press Refresh to try again.</p>');
      return;
    }
    if (!selBand || !bands.includes(selBand)) selBand = curBand && bands.includes(curBand) ? curBand : bands[0];
    bandsEl.innerHTML = bands.length > 1
      ? bands.map((b) => `<button type="button" class="sp-band" aria-pressed="${b === selBand}" data-band="${b}">${b} GHz</button>`).join('')
      : `<span class="sp-meta">${selBand} GHz${wifi && num(wifi.widthMHz) != null && selBand === curBand ? ' · ' + wifi.widthMHz + ' MHz' : ''}</span>`;

    const counts = surveyCounts(survey, selBand);
    const rawCur = (survey.current && survey.current.channel) ?? (wifi && wifi.channel);
    const curCh = selBand === curBand && rawCur != null && Number(rawCur) > 0 ? Number(rawCur) : null;
    const recObj = survey.recommendation && normBand(survey.recommendation.band, survey.recommendation.channel) === selBand ? survey.recommendation : null;
    const recCh = recObj ? Number(recObj.channel) : null;
    const set = new Set(CHANNELS[selBand] || []);
    for (const ch of counts.keys()) set.add(ch);
    for (const n of survey.networks || []) if (normBand(n.band, n.channel) === selBand && Number(n.channel) > 0) set.add(Number(n.channel));
    if (curCh != null) set.add(curCh);
    if (recCh != null) set.add(recCh);
    const chs = [...set].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);

    const nowN = recObj && num(recObj.neighboursNow) != null ? recObj.neighboursNow : curCh != null ? counts.get(curCh) || 0 : null;
    const thereN = recObj && num(recObj.neighboursThere) != null ? recObj.neighboursThere : recCh != null ? counts.get(recCh) || 0 : null;
    const already = recCh != null && curCh != null && recCh === curCh;
    const word = nowN == null ? '' : nowN >= 4 ? 'Congested' : nowN >= 2 ? 'Busy' : nowN === 1 ? 'Shared' : 'Clear';
    // Distinct networks heard (not overlap-weighted counts); the user's own radios are not neighbours.
    const bandNets = (survey.networks || []).filter((n) => normBand(n.band, n.channel) === selBand);
    const totalNets = bandNets.length
      ? bandNets.filter((n) => !(n.own || (wifi && ((wifi.bssid && n.bssid === wifi.bssid) || (wifi.ssid && n.ssid && n.ssid === wifi.ssid))))).length
      : [...counts.values()].reduce((a, b) => a + b, 0);
    const width = wifi && num(wifi.widthMHz) != null ? wifi.widthMHz : null;
    const dfs = selBand === '5' && recCh != null && recCh >= 52 && recCh <= 144;
    const shouldMove = recCh != null && !already;
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

    const steps = shouldMove ? [
      'Open your router admin page with the button below and sign in.',
      'Find the Wireless or Wi-Fi settings for the ' + selBand + ' GHz band.',
      'Change Channel from ' + (curCh != null ? curCh : 'Auto') + ' to ' + recCh + (width ? ' and keep the width at ' + width + ' MHz' : '') + '.',
      'Save. Devices drop for a few seconds and reconnect on their own.',
      'Come back and run a speed test to measure the difference.',
    ] : [];

    if (!box.querySelector('[data-chan-ok]')) {
      dropSpectrum();
      box.innerHTML = `
        <div class="sp-chan" data-chan-ok>
          <div class="sp-chan-legend" data-chan-legend></div>
          <div class="sp-spectrum" data-spectrum></div>
          <div class="sp-chan-foot">
            <div class="sp-dial" data-dial></div>
            <div class="sp-chan-side">
              <dl class="sp-facts" data-facts></dl>
              <div class="sp-chan-notes" data-chan-notes></div>
            </div>
          </div>
          <p class="sp-fine sp-chan-fine">Curves are the networks this computer can hear from where it sits: height is signal strength, width is the spectrum each one occupies. Bastion cannot change your router's channel itself; it shows you exactly where to do it.</p>
          <div data-chan-guide></div>
        </div>`;
    }
    if (!spectrumViz) spectrumViz = createChannelSpectrum(box.querySelector('[data-spectrum]'), { reducedMotion: RM });
    const animate = spectrumBand !== selBand;
    spectrumBand = selBand;
    const spec = spectrumData(survey, wifi, selBand, chs, curCh, curBand, recCh);
    spectrumViz.update(spec, { animate });
    // The router's other radios on this band (same network, not the one this computer is joined to).
    const radioChs = [...new Set(spec.networks.filter((n) => n.own && n.channel !== curCh).map((n) => n.channel))].sort((a, b) => a - b);

    setHtml(box.querySelector('[data-chan-legend]'), `
      ${curCh != null ? '<span><i class="lg-own"></i>Your network</span>' : ''}
      ${radioChs.length ? '<span><i class="lg-radio"></i>Your router, other radio</span>' : ''}
      <span><i class="lg-nb"></i>Neighbours</span>
      ${shouldMove ? '<span><i class="lg-rec"></i>Quietest channel</span>' : ''}
      ${selBand === '5' ? '<span><i class="lg-dfs"></i>DFS range</span>' : ''}`);

    const state = nowN == null ? 'unknown' : nowN === 0 ? 'clear' : nowN >= 4 ? 'high' : 'mid';
    setHtml(box.querySelector('[data-dial]'), `
      <div class="sp-dial-ring" data-state="${state}" role="img" aria-label="${curCh != null ? 'Channel ' + curCh + ', ' + plural(nowN, 'neighbour') + (word ? ', ' + word.toLowerCase() : '') : 'Current channel unknown on this band'}">
        ${dialSvg(curCh != null ? nowN : null)}
        <div class="sp-dial-c" aria-hidden="true">
          <span class="sp-dial-k">Channel</span>
          <b class="${curCh != null ? '' : 'is-empty'}">${curCh != null ? curCh : '&ndash;'}</b>
          <span class="sp-dial-s">${curCh != null ? esc(word) : selBand === curBand ? 'Unknown' : radioChs.length ? 'Not connected here' : 'Not your band'}</span>
        </div>
      </div>`);

    const fact = (k, v, cls) => `<div class="sp-fact"><dt>${k}</dt><dd class="${cls || ''}">${v}</dd></div>`;
    setHtml(box.querySelector('[data-facts]'), [
      fact('Current', curCh != null ? 'Channel <b>' + curCh + '</b>' : selBand === curBand ? '<span class="sp-unknown">unknown</span>' : 'Not on ' + selBand + ' GHz'),
      curCh == null && radioChs.length
        ? fact('Your router here', 'Channel <b>' + radioChs.join(', ') + '</b><span class="sp-fact-sub"> · other radio</span>')
        : fact('Neighbours there', nowN != null ? '<b>' + nowN + '</b> network' + (nowN === 1 ? '' : 's') : '<span class="sp-unknown">unknown</span>', nowN == null ? '' : nowN >= 4 ? 'sp-hot' : nowN >= 2 ? 'sp-warm' : ''),
      fact('Quietest', recCh != null ? 'Channel <b>' + recCh + '</b>' + (thereN != null ? '<span class="sp-fact-sub"> · ' + plural(thereN, 'network') + '</span>' : '') : 'No recommendation', shouldMove ? 'sp-gain' : ''),
      fact('Heard on this band', '<b>' + totalNets + '</b> network' + (totalNets === 1 ? '' : 's')),
    ].join(''));

    setHtml(box.querySelector('[data-chan-notes]'), `
      ${recObj && recObj.reason ? `<p class="sp-fine">${esc(recObj.reason)}</p>` : ''}
      ${already ? '<p class="sp-okline">You are already on the quietest channel nearby. Nothing to change.</p>' : ''}
      ${!recObj && curCh != null ? '<p class="sp-fine">Bastion did not find a clearly better channel on this band.</p>' : ''}
      ${dfs && shouldMove ? '<p class="sp-fine">Channel ' + recCh + ' is a DFS channel. The router must leave it briefly if it detects radar, and some older devices cannot use it.</p>' : ''}`);

    setHtml(box.querySelector('[data-chan-guide]'), shouldMove ? `
      <div class="sp-guide">
        <p class="sp-guide-title">Move to channel ${recCh}</p>
        <ol class="sp-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <div class="sp-actions"><button class="btn btn--primary" type="button" data-open="router-admin">Open router admin</button></div>
      </div>` : '');
  }

  el.addEventListener('click', (e) => {
    const bandBtn = e.target.closest('[data-band]');
    if (bandBtn) { selBand = bandBtn.dataset.band; keepFocus(el, FOCUS_KEYS, renderChannel); return; }
    const open = e.target.closest('[data-open]');
    if (open) {
      const target = open.dataset.open;
      Promise.resolve(api.fix.open(target))
        .then((r) => { if (!(r && r.ok)) ctx.toast('Bastion could not open that page. Follow the steps manually.', 'warn'); })
        .catch((err) => ctx.toast('Could not open: ' + errText(err), 'warn'));
    }
  });

  // ---------- store ----------
  subs.push(store.on('speedProgress', (p) => {
    if (!p || typeof p !== 'object') { sp.prog = null; renderRun(); return; }
    const started = (!sp.prog || sp.prog.running === false) && p.running !== false && p.phase !== 'done';
    if (started && !sp.busy) { sp.live = { down: null, up: null, ping: null }; sp.outcome = null; }
    if (p.running === false && p.error && !sp.busy) sp.outcome = { kind: 'failed', text: 'The test did not finish: ' + p.error };
    sp.prog = p;
    sp.progAt = Date.now();
    if (p.phase === 'ping') setTarget(0);
    else if (num(p.mbps) != null) setTarget(p.mbps);
    renderRun();
    if (!raf && !RM) raf = requestAnimationFrame(animate);
  }));
  subs.push(store.on('speed', (r) => {
    if (isResult(r)) {
      record(r);
      if (!isRunning()) { sp.outcome = null; setTarget(r.downMbps || 0); }
    }
    renderRun();
  }));
  // Background reloads rebuild these sections; keep keyboard focus on the same button.
  subs.push(store.on('wifi', () => keepFocus(el, FOCUS_KEYS, () => { renderWifi(); renderChannel(); renderRun(); })));
  subs.push(store.on('survey', () => keepFocus(el, FOCUS_KEYS, renderChannel)));

  const onPrefs = () => { prefs = readPrefs(); renderWifi(); renderChannel(); };
  window.addEventListener(PREFS_EVENT, onPrefs);

  const onVis = () => { if (!document.hidden) { gauge.redraw(); chart.redraw(); } };
  document.addEventListener('visibilitychange', onVis);
  const staleTimer = setInterval(() => {
    if (alive && sp.prog && typeof sp.prog.running !== 'boolean' && !isRunning()) { sp.prog = null; renderRun(); }
  }, 4000);

  const initialProg = store.get('speedProgress');
  if (initialProg && typeof initialProg === 'object' && (initialProg.running === true || (initialProg.running == null && initialProg.phase && initialProg.phase !== 'done'))) {
    sp.prog = initialProg;
    sp.progAt = Date.now();
  }
  const initial = latestResult();
  if (initial) {
    record(initial);
    sp.needle = sp.target = num(initial.downMbps) ?? 0;
  }

  renderRun();
  renderHistory();
  renderWifi();
  renderChannel();
  requestAnimationFrame(() => {
    if (!alive) return;
    pal = palette();
    gauge.redraw();
    chart.redraw();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (alive) { pal = palette(); chart.redraw(); if (spectrumViz) spectrumViz.redraw(); } });
  const w0 = store.get('wifi');
  const s0 = store.get('survey');
  if (w0 === null || s0 === null || (w0 === undefined && s0 === undefined)) refreshWifi();

  return {
    unmount() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      gauge.dispose();
      chart.dispose();
      dropSpectrum();
      clearInterval(staleTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(PREFS_EVENT, onPrefs);
      for (const off of subs) if (typeof off === 'function') off();
      el.innerHTML = '';
    },
  };
}
