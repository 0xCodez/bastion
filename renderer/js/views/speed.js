// Speed & Wi-Fi view: live speed gauge, result numerals, test history, Wi-Fi link details
// and the channel alignment ring built from the real neighbour survey.
import { readPrefs, PREFS_EVENT } from './settings.js';

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
  if (n == null) return '--';
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
                <defs><linearGradient id="spGaugeGrad" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" style="stop-color:var(--sky)"/><stop offset=".55" style="stop-color:var(--violet)"/><stop offset="1" style="stop-color:var(--lavender)"/>
                </linearGradient></defs>
                <path class="g-track" d="${ARC_D}" pathLength="100"/>
                <path class="g-val" d="${ARC_D}" pathLength="100" stroke="url(#spGaugeGrad)" stroke-dasharray="0 100" data-gval/>
                <g data-gticks></g>
                <g class="g-needle" data-needle transform="rotate(135 130 130)"><line x1="130" y1="130" x2="196" y2="130"/><circle cx="130" cy="130" r="7"/></g>
              </svg>
              <div class="sp-read">
                <span class="sp-phase" data-phase>Ready</span>
                <span class="sp-read-num" data-gnum>--</span>
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
            <div class="nv-glass nv-stat"><span class="nv-stat-k"><svg class="sp-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sky)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v14M6 12l6 6 6-6"/></svg>Download</span><span class="nv-stat-v" data-n="down">--</span><span class="nv-stat-u">Mbps</span></div>
            <div class="nv-glass nv-stat"><span class="nv-stat-k"><svg class="sp-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--lavender)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V6M6 12l6-6 6 6"/></svg>Upload</span><span class="nv-stat-v" data-n="up">--</span><span class="nv-stat-u">Mbps</span></div>
            <div class="nv-glass nv-stat"><span class="nv-stat-k"><svg class="sp-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mint)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>Ping</span><span class="nv-stat-v" data-n="ping">--</span><span class="nv-stat-u">ms</span></div>
            <div class="nv-glass nv-stat"><span class="nv-stat-k"><svg class="sp-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h3l3-6 4 12 3-6h5"/></svg>Jitter</span><span class="nv-stat-v" data-n="jitter">--</span><span class="nv-stat-u">ms</span></div>
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
    GAUGE_STOPS.forEach((v, i) => {
      const a = (135 + 270 * (i / (GAUGE_STOPS.length - 1))) * DEG;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', (130 + 124 * c).toFixed(1));
      t.setAttribute('y', (130 + 124 * sn + 4).toFixed(1));
      t.setAttribute('text-anchor', Math.abs(c) < 0.2 ? 'middle' : c < 0 ? 'end' : 'start');
      t.setAttribute('class', 'g-tick');
      t.textContent = GAUGE_LABELS[i];
      g.appendChild(t);
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', (130 + 86 * c).toFixed(1)); ln.setAttribute('y1', (130 + 86 * sn).toFixed(1));
      ln.setAttribute('x2', (130 + 80 * c).toFixed(1)); ln.setAttribute('y2', (130 + 80 * sn).toFixed(1));
      ln.setAttribute('class', 'g-mark');
      g.appendChild(ln);
    });
  })();

  const gWrap = $('[data-gauge-wrap]');
  const gVal = $('[data-gval]');
  const gNeedle = $('[data-needle]');
  const gNum = $('[data-gnum]');
  const gUnit = $('[data-gunit]');

  function drawGauge() {
    const f = frac(sp.needle);
    const running = isRunning();
    gVal.setAttribute('stroke-dasharray', (f * 100).toFixed(2) + ' 100');
    gVal.style.opacity = f > 0.002 ? '1' : '0';
    gNeedle.setAttribute('transform', 'rotate(' + (135 + 270 * f).toFixed(2) + ' 130 130)');
    gWrap.dataset.running = String(running);

    const p = sp.prog;
    let big = '--';
    let unit = 'Mbps';
    if (running && p && p.phase === 'ping') {
      big = num(p.pingMs) != null ? String(Math.round(p.pingMs)) : '--';
      unit = 'ms';
    } else if (running && p && num(p.mbps) != null) {
      big = fmtMbps(p.mbps);
    } else if (latestResult()) {
      big = fmtMbps(latestResult().downMbps);
    }
    if (gNum.textContent !== big) gNum.textContent = big;
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

    const n = (k, v) => { $('[data-n="' + k + '"]').textContent = v; };
    if (running) {
      if (p && p.phase === 'ping' && num(p.pingMs) != null) sp.live.ping = p.pingMs;
      if (p && p.phase === 'download' && num(p.mbps) != null) sp.live.down = p.mbps;
      if (p && p.phase === 'upload' && num(p.mbps) != null) sp.live.up = p.mbps;
      if (p && sp.live.down == null && num(p.downMbps) != null) sp.live.down = p.downMbps;
      if (p && sp.live.up == null && num(p.upMbps) != null) sp.live.up = p.upMbps;
      n('down', sp.live.down != null ? fmtMbps(sp.live.down) : '--');
      n('up', sp.live.up != null ? fmtMbps(sp.live.up) : '--');
      n('ping', sp.live.ping != null ? String(Math.round(sp.live.ping)) : '--');
      n('jitter', '--');
    } else if (r) {
      n('down', fmtMbps(r.downMbps));
      n('up', fmtMbps(r.upMbps));
      n('ping', num(r.pingMs) != null ? String(Math.round(r.pingMs)) : '--');
      n('jitter', num(r.jitterMs) != null ? (r.jitterMs < 10 ? r.jitterMs.toFixed(1) : String(Math.round(r.jitterMs))) : '--');
    } else {
      ['down', 'up', 'ping', 'jitter'].forEach((k) => n(k, '--'));
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
      const lr = latestResult();
      setTarget(lr && !sp.outcome ? lr.downMbps || 0 : 0);
      renderRun();
      renderHistory();
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
      ctx.strokeStyle = rgba(pal.lavender, 0.25); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, Tp + ph); ctx.lineTo(L + pw, Tp + ph); ctx.stroke();
      ctx.fillStyle = pal.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 15px ' + FONT_D;
      ctx.fillText('No tests yet', L + pw / 2, Tp + ph / 2);
      return;
    }
    const peak = Math.max(...history.map((x) => Math.max(x.down || 0, x.up || 0)), 1);
    const max = niceMax(peak * 1.1);
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const y = Tp + ph * (1 - v / max);
      ctx.strokeStyle = rgba(pal.lavender, i === 0 ? 0.24 : 0.07); ctx.lineWidth = 1;
      ctx.setLineDash(i === 0 ? [] : [2, 5]);
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
    // Tests where a direction was not measured leave a gap instead of a fake zero.
    const path = (key) => {
      ctx.beginPath();
      let pen = false;
      history.forEach((x, i) => {
        if (num(x[key]) == null) { pen = false; return; }
        if (pen) ctx.lineTo(X(i), Y(x[key])); else ctx.moveTo(X(i), Y(x[key]));
        pen = true;
      });
    };
    const downIdx = history.map((x, i) => (num(x.down) != null ? i : -1)).filter((i) => i >= 0);
    if (n > 1) {
      if (downIdx.length > 1 && downIdx.length === n) {
        path('down'); ctx.lineTo(X(n - 1), Tp + ph); ctx.lineTo(X(0), Tp + ph); ctx.closePath();
        const g = ctx.createLinearGradient(0, Tp, 0, Tp + ph);
        g.addColorStop(0, rgba(pal.violet, 0.38)); g.addColorStop(0.6, rgba(pal.violet, 0.08)); g.addColorStop(1, rgba(pal.violet, 0));
        ctx.fillStyle = g; ctx.fill();
      }
      if (history.some((x) => num(x.up) != null)) {
        path('up'); ctx.strokeStyle = rgba(pal.sky, 0.75); ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.save();
      ctx.shadowColor = rgba(pal.violet, 0.95); ctx.shadowBlur = 14;
      path('down'); ctx.strokeStyle = pal.lavender; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      ctx.restore();
    }
    history.forEach((x, i) => {
      if (num(x.down) != null) { ctx.fillStyle = pal.lavender; ctx.beginPath(); ctx.arc(X(i), Y(x.down), 2.8, 0, TAU); ctx.fill(); }
      if (num(x.up) != null) { ctx.fillStyle = rgba(pal.sky, 0.85); ctx.beginPath(); ctx.arc(X(i), Y(x.up), 2.2, 0, TAU); ctx.fill(); }
    });
    const last = history[n - 1];
    const ex = X(n - 1);
    const hasDown = num(last.down) != null;
    const ey = hasDown ? Y(last.down) : Tp;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const lx = Math.min(ex + 12, w - 44);
    if (hasDown) {
      const hg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 16);
      hg.addColorStop(0, rgba(pal.lavender, 0.55)); hg.addColorStop(1, rgba(pal.lavender, 0));
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(ex, ey, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = pal.text; ctx.beginPath(); ctx.arc(ex, ey, 3.8, 0, TAU); ctx.fill();
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

  function renderHistory() {
    chart.redraw();
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

  function ringSvg(chs, counts, cur, rec) {
    const cx = 160;
    const cy = 160;
    const r = 104;
    const N = chs.length;
    const ang = (i) => (-90 + i * (360 / N)) * DEG;
    const pt = (rad, a) => (cx + rad * Math.cos(a)).toFixed(1) + '" cy="' + (cy + rad * Math.sin(a)).toFixed(1);
    const maxCount = Math.max(1, ...counts.values());
    const barScale = Math.min(4.5, 34 / maxCount);
    const parts = [];
    parts.push('<defs><radialGradient id="spRingCore"><stop offset="0" style="stop-color:var(--violet);stop-opacity:.32"/><stop offset="1" style="stop-color:var(--violet);stop-opacity:0"/></radialGradient></defs>');
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r - 6}" fill="url(#spRingCore)"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="sp-ring-base"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r - 18}" fill="none" stroke="var(--lavender)" stroke-opacity=".18" stroke-dasharray="2 6"/>`);
    const labelEvery = Math.max(1, Math.ceil(N / 8));
    chs.forEach((ch, i) => {
      const a = ang(i);
      const c = Math.cos(a);
      const s = Math.sin(a);
      parts.push(`<line x1="${(cx + (r - 6) * c).toFixed(1)}" y1="${(cy + (r - 6) * s).toFixed(1)}" x2="${(cx + (r + 4) * c).toFixed(1)}" y2="${(cy + (r + 4) * s).toFixed(1)}" stroke="var(--lavender)" stroke-opacity=".45" stroke-width="1"/>`);
      const n = counts.get(ch) || 0;
      if (n) {
        const col = n >= 4 ? 'var(--coral)' : n >= 2 ? 'var(--amber)' : 'var(--lavender)';
        parts.push(`<line x1="${(cx + (r + 9) * c).toFixed(1)}" y1="${(cy + (r + 9) * s).toFixed(1)}" x2="${(cx + (r + 9 + n * barScale) * c).toFixed(1)}" y2="${(cy + (r + 9 + n * barScale) * s).toFixed(1)}" stroke="${col}" stroke-width="4" stroke-linecap="round" class="sp-ring-bar"/>`);
      }
      if (i % labelEvery === 0 || ch === cur || ch === rec) {
        const cls = ch === cur ? ' is-cur' : ch === rec ? ' is-rec' : '';
        parts.push(`<text x="${(cx + (r + 54) * c).toFixed(1)}" y="${(cy + (r + 54) * s + 4).toFixed(1)}" text-anchor="middle" class="sp-ring-lbl${cls}">${ch}</text>`);
      }
    });
    const ci = chs.indexOf(cur);
    const ri = chs.indexOf(rec);
    if (ci >= 0 && ri >= 0 && ci !== ri) {
      let delta = ri - ci;
      if (delta > N / 2) delta -= N;
      if (delta < -N / 2) delta += N;
      const a0 = ang(ci);
      const a1 = ang(ri);
      const sweep = delta > 0 ? 1 : 0;
      const large = Math.abs(delta) > N / 2 ? 1 : 0;
      parts.push(`<path d="M${(cx + r * Math.cos(a0)).toFixed(1)} ${(cy + r * Math.sin(a0)).toFixed(1)} A${r} ${r} 0 ${large} ${sweep} ${(cx + r * Math.cos(a1)).toFixed(1)} ${(cy + r * Math.sin(a1)).toFixed(1)}" fill="none" stroke="var(--sky)" stroke-width="3" stroke-linecap="round" class="sp-ring-arc"/>`);
    }
    if (ri >= 0) {
      parts.push(`<circle cx="${pt(r, ang(ri))}" r="10" fill="none" stroke="var(--sky)" stroke-width="1.5" stroke-dasharray="2 3"/>`);
    }
    if (ci >= 0) {
      const a = ang(ci);
      parts.push(`<circle cx="${pt(r, a)}" r="18" fill="var(--mint)" fill-opacity=".16" class="sp-ring-halo"/>`);
      parts.push(`<circle cx="${pt(r, a)}" r="11" fill="none" stroke="var(--mint)" stroke-width="1.5"/>`);
      parts.push(`<circle cx="${pt(r, a)}" r="6" fill="var(--mint)" class="sp-ring-cur"/>`);
    }
    return `<svg viewBox="-20 -20 360 360" role="img" aria-label="Wi-Fi channel ring${cur != null ? ', your channel ' + cur : ''}${rec != null ? ', quietest ' + rec : ''}">${parts.join('')}</svg>`;
  }

  function spectrum(chs, counts, cur, rec) {
    const max = Math.max(1, ...counts.values());
    return `<div class="sp-spec" role="img" aria-label="Neighbouring networks per channel">
      ${chs.map((ch) => {
        const n = counts.get(ch) || 0;
        const lvl = n >= 4 ? 'high' : n >= 2 ? 'mid' : n ? 'low' : 'none';
        return `<div class="sp-spec-col${ch === cur ? ' is-cur' : ''}${ch === rec ? ' is-rec' : ''}" title="Channel ${ch}: ${n} network${n === 1 ? '' : 's'}">
          <span class="sp-spec-n">${n || ''}</span>
          <span class="sp-spec-bar" data-l="${lvl}" style="height:${Math.round((n / max) * 100)}%"></span>
          <span class="sp-spec-ch">${ch}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderChannel() {
    const box = $('[data-chan]');
    const bandsEl = $('[data-bands]');
    const survey = store.get('survey');
    const wifi = store.get('wifi');
    if (survey === undefined || (survey === null && wifiBusy)) {
      bandsEl.innerHTML = '';
      box.innerHTML = '<p class="empty-state">Listening for nearby networks.</p>';
      return;
    }
    if (survey === null) {
      bandsEl.innerHTML = '';
      box.innerHTML = '<p class="empty-state">Bastion could not list the networks around you, so channel crowding is unknown. Press Refresh above to try again.</p>';
      return;
    }
    if (typeof survey !== 'object' || !survey.supported) {
      bandsEl.innerHTML = '';
      box.innerHTML = unsupportedBlock(survey, 'Bastion could not list the networks around you, so it cannot compare channels.');
      return;
    }
    const { bands, current: curBand } = surveyBands(survey, wifi);
    if (!bands.length) {
      bandsEl.innerHTML = '';
      box.innerHTML = '<p class="empty-state">No nearby networks were heard. Either the air is clear or the scan was blocked; press Refresh to try again.</p>';
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
    if (curCh != null) set.add(curCh);
    if (recCh != null) set.add(recCh);
    const chs = [...set].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);

    const nowN = recObj && num(recObj.neighboursNow) != null ? recObj.neighboursNow : curCh != null ? counts.get(curCh) || 0 : null;
    const thereN = recObj && num(recObj.neighboursThere) != null ? recObj.neighboursThere : recCh != null ? counts.get(recCh) || 0 : null;
    const already = recCh != null && curCh != null && recCh === curCh;
    const word = nowN == null ? '' : nowN >= 4 ? 'congested' : nowN >= 2 ? 'busy' : 'clear';
    const totalNets = [...counts.values()].reduce((a, b) => a + b, 0);
    const width = wifi && num(wifi.widthMHz) != null ? wifi.widthMHz : null;
    const dfs = selBand === '5' && recCh != null && recCh >= 52 && recCh <= 144;
    const shouldMove = recCh != null && !already;

    const steps = shouldMove ? [
      'Open your router admin page with the button below and sign in.',
      'Find the Wireless or Wi-Fi settings for the ' + selBand + ' GHz band.',
      'Change Channel from ' + (curCh != null ? curCh : 'Auto') + ' to ' + recCh + (width ? ' and keep the width at ' + width + ' MHz' : '') + '.',
      'Save. Devices drop for a few seconds and reconnect on their own.',
      'Come back and run a speed test to measure the difference.',
    ] : [];

    box.innerHTML = `
      <div class="sp-chan">
        <div class="sp-ring">
          ${ringSvg(chs, counts, curCh, recCh)}
          <div class="sp-ring-center">
            <b>${curCh != null ? curCh : '--'}</b>
            <span>${curCh != null ? nowN + ' neighbour' + (nowN === 1 ? '' : 's') + (word ? ' · ' + word : '') : selBand === curBand ? 'Channel unknown' : 'Not your band'}</span>
          </div>
        </div>
        <div class="sp-chan-side">
          <div class="sp-kv"><span>Current</span><span>${curCh != null ? 'Channel ' + curCh : selBand === curBand ? '<span class="sp-unknown">unknown</span>' : 'Not on ' + selBand + ' GHz'}</span></div>
          <div class="sp-kv"><span>Neighbours there</span><span>${nowN != null ? nowN + ' network' + (nowN === 1 ? '' : 's') : '<span class="sp-unknown">unknown</span>'}</span></div>
          <div class="sp-kv"><span>Quietest</span><span class="${shouldMove ? 'sp-gain' : ''}">${recCh != null ? 'Channel ' + recCh + (thereN != null ? ' · ' + thereN + ' network' + (thereN === 1 ? '' : 's') : '') : 'No recommendation'}</span></div>
          <div class="sp-kv"><span>Heard on this band</span><span>${totalNets} network${totalNets === 1 ? '' : 's'}</span></div>
          ${recObj && recObj.reason ? `<p class="sp-fine">${esc(recObj.reason)}</p>` : ''}
          ${already ? '<p class="sp-okline">You are already on the quietest channel nearby. Nothing to change.</p>' : ''}
          ${!recObj && curCh != null ? '<p class="sp-fine">Bastion did not find a clearly better channel on this band.</p>' : ''}
          ${dfs && shouldMove ? '<p class="sp-fine">Channel ' + recCh + ' is a DFS channel. The router must leave it briefly if it detects radar, and some older devices cannot use it.</p>' : ''}
        </div>
      </div>
      ${spectrum(chs, counts, curCh, recCh)}
      <p class="sp-fine">Counts are the networks this computer can hear from where it sits. Bastion cannot change your router's channel itself; it shows you exactly where to do it.</p>
      ${shouldMove ? `
        <div class="sp-guide">
          <p class="sp-guide-title">Move to channel ${recCh}</p>
          <ol class="sp-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          <div class="sp-actions"><button class="btn btn--primary" type="button" data-open="router-admin">Open router admin</button></div>
        </div>` : ''}`;
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
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (alive) { pal = palette(); chart.redraw(); } });
  const w0 = store.get('wifi');
  const s0 = store.get('survey');
  if (w0 === null || s0 === null || (w0 === undefined && s0 === undefined)) refreshWifi();

  return {
    unmount() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      gauge.dispose();
      chart.dispose();
      clearInterval(staleTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(PREFS_EVENT, onPrefs);
      for (const off of subs) if (typeof off === 'function') off();
      el.innerHTML = '';
    },
  };
}
