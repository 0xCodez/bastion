// Home view (Nebula Voice): full-bleed 3D router hero with the live shield verdict, a session
// watch timer, last real speed numbers, the round shield/power button, a router chip, the
// iridescent voice bar for asking an AI agent, and three glass cards below.
// Everything shown comes from the store (real data in Electron); anything we cannot know is
// labelled as unknown, never invented.

const STATUS_RANK = { risk: 0, warn: 1, unknown: 2, ok: 3 };
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const PROVIDERS = [
  { id: 'claude', name: 'Claude', company: 'Anthropic', color: '#E8A07F', hint: 'security' },
  { id: 'openai', name: 'ChatGPT', company: 'OpenAI', color: '#9EF0C4', hint: 'devices' },
  { id: 'grok', name: 'Grok', company: 'xAI', color: '#8FD3FF', hint: 'speed' },
];
const FIX_TARGET_LABEL = {
  'router-admin': 'router admin page',
  'dns-settings': 'DNS settings',
  'wifi-settings': 'Wi-Fi settings',
  'mac-privacy': 'Wi-Fi privacy settings',
};
const FIX_TARGET_CHIP = {
  'router-admin': 'Open router settings',
  'dns-settings': 'Open DNS settings',
  'wifi-settings': 'Open Wi-Fi settings',
  'mac-privacy': 'Open Wi-Fi privacy',
};
const PROVIDER_PREF_KEY = 'bastion.home.provider';
const LONG_PRESS_MS = 650;
// Gauge scale (Mbps), non-linear so typical home speeds use most of the arc.
const G_STOPS = [0, 100, 200, 500, 750, 1000];
const G_LABELS = ['0', '100', '200', '500', '750', '1G'];

// Checks that actually test the router's doors. "All doors closed" needs every one of them 'ok'.
const DOOR_IDS = ['tr069', 'upnp', 'telnet', 'ssh', 'web-admin-http'];

// Devices first seen during this app session (module scope so it survives view switches).
let mountSeq = 0;
const seenMacs = new Set();
const newMacs = new Set();
let seenPrimed = false;

/* ------------------------------------------------------------------ helpers */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const errMsg = (err) => String((err && err.message) || err || 'Unknown error');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const DASH = '—';

function fmtSpeed(v) {
  if (!isNum(v)) return DASH;
  if (v >= 100) return String(Math.round(v));
  return v.toFixed(1);
}

function fmtTime(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}
function spokenClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const parts = [];
  if (hh) parts.push(plural(hh, 'hour', 'hours'));
  parts.push(plural(mm, 'minute', 'minutes'));
  return parts.join(' ');
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function rankChecks(checks) {
  return [...(checks || [])]
    .filter((c) => c && c.status in STATUS_RANK && c.status !== 'ok')
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status])
      || ((SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)));
}

function countBy(checks) {
  const out = { risk: 0, warn: 0, unknown: 0, ok: 0 };
  for (const c of checks || []) if (c && c.status in out) out[c.status] += 1;
  return out;
}

function doorState(checks) {
  const doors = DOOR_IDS.map((id) => (checks || []).find((c) => c && c.id === id));
  if (doors.every((c) => c && c.status === 'ok')) return 'closed';
  if (doors.every((c) => !c || c.status === 'unknown')) return 'blind';
  return 'partial';
}

function untestedDoors(checks) {
  return DOOR_IDS.filter((id) => { const c = (checks || []).find((x) => x && x.id === id); return !c || c.status !== 'ok'; }).length;
}

function threatLevel(scan) {
  if (!scan || !Array.isArray(scan.checks) || !scan.checks.length) return 0;
  if (scan.checks.some((c) => c.status === 'risk' && (c.severity === 'critical' || c.severity === 'high'))) return 2;
  if (scan.checks.some((c) => c.status === 'risk' || c.status === 'warn')) return 1;
  // Doors we could not test are not an all-clear.
  if (doorState(scan.checks) !== 'closed') return 1;
  return 0;
}

function gaugeFrac(v) {
  if (!isNum(v)) return 0;
  const x = Math.max(0, Math.min(1000, v));
  for (let i = 1; i < G_STOPS.length; i += 1) {
    if (x <= G_STOPS[i]) return ((i - 1) + (x - G_STOPS[i - 1]) / (G_STOPS[i] - G_STOPS[i - 1])) / (G_STOPS.length - 1);
  }
  return 1;
}

function readPref() {
  try { return localStorage.getItem(PROVIDER_PREF_KEY); } catch { return null; }
}
function writePref(id) {
  try { localStorage.setItem(PROVIDER_PREF_KEY, id); } catch { /* storage unavailable */ }
}

function dictationHint(platform) {
  let p = platform;
  if (!p || p === 'browser-mock') {
    const ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    p = /mac/i.test(ua) ? 'darwin' : 'win32';
  }
  return p === 'darwin'
    ? 'Press Fn twice to dictate, then press Return to send.'
    : 'Press Win + H to dictate, then press Enter to send.';
}

const svg = (body, size = 18, extra = '') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
const I_DOWN = svg('<path d="M12 4v14M6 12l6 6 6-6"/>', 22);
const I_UP = svg('<path d="M12 20V6M6 12l6-6 6 6"/>', 22);
const I_PING = svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', 22);
const I_POWER = svg('<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>', 34);
const I_PLUS = svg('<path d="M12 5v14M5 12h14"/>');
const I_MIC = svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');
const I_SEND = svg('<path d="M12 19V5M6 11l6-6 6 6"/>');
const I_CLOSE = svg('<path d="M6 6l12 12M18 6L6 18"/>', 16);
const I_CARET = svg('<path d="M6 9l6 6 6-6"/>', 12);
const I_ROUTER = svg('<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 13l-1-6M17 13l1-6M7 16.5h.01M10.5 16.5h.01"/>', 16);
const I_SCAN = svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>', 14);
const I_BOLT = svg('<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>', 18);
const I_DEV = {
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>'),
  laptop: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>'),
  router: svg('<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 13l-1-6M17 13l1-6"/>'),
  unknown: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5h.01"/>'),
};

/* ------------------------------------------------------------------ view */

export function mount(el, ctx) {
  const { api, store } = ctx;
  const cleanups = [];
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reduceMQ.matches;
  let hero = null;
  let heroInView = true;
  let disposed = false;
  let lastThreat = null;
  let lastSignal;
  let lastShield = null;
  let lastAgentsKey = '';
  let lastScanSeen = store.get('scan') || null;
  let asking = false;

  // Watch session lives in the store so it survives view switches. app.js should skip its
  // periodic refresh while store.get('watch').on === false.
  if (!store.get('watch')) {
    const origin = (performance && isNum(performance.timeOrigin)) ? performance.timeOrigin : Date.now();
    store.set('watch', { on: true, since: origin, carriedMs: 0 });
  }

  el.classList.add('view--home');
  // Per-mount suffix: app.js keeps the outgoing view in the DOM for 380 ms, so static IDs
  // (gradients, label for, aria-*) could otherwise resolve to the departing tree.
  const uid = `-${++mountSeq}`;
  el.innerHTML = `
    <div class="home">
      <section class="nv-hero" aria-label="Network status">
        <div class="nv-hero__stage" data-ref="stage" aria-hidden="true"></div>
        <div class="nv-hero__shade" aria-hidden="true"></div>

        <div class="nv-hero__inner">
          <div class="nv-status nv-rise" style="--d:.05s" data-ref="status">
            <span class="nv-status__dot"></span><span data-ref="statusText">Shield active</span>
          </div>
          <div class="nv-timer nv-rise" style="--d:.12s" data-ref="timer" role="timer">00:00:00</div>
          <div class="nv-timer-l nv-rise" style="--d:.18s" data-ref="timerLabel">Watching your network</div>

          <div class="nv-rates nv-rise" style="--d:.24s" aria-label="Last speed test">
            <div class="nv-rate nv-rate--down" data-ref="rateDown">${I_DOWN}<div><small>Download</small><b><span data-ref="vDown">${DASH}</span> <span class="nv-rate__u">Mbps</span></b></div></div>
            <div class="nv-rate nv-rate--up" data-ref="rateUp">${I_UP}<div><small>Upload</small><b><span data-ref="vUp">${DASH}</span> <span class="nv-rate__u">Mbps</span></b></div></div>
            <div class="nv-rate nv-rate--ping" data-ref="ratePing">${I_PING}<div><small>Ping</small><b><span data-ref="vPing">${DASH}</span> <span class="nv-rate__u">ms</span></b></div></div>
          </div>
          <div class="nv-rates__meta nv-rise" style="--d:.28s">
            <span data-ref="ratesMeta"></span>
            <button type="button" class="nv-link" data-ref="ratesRun">Run a test</button>
          </div>

          <div class="nv-power-wrap nv-rise" style="--d:.34s">
            <svg class="nv-power-ring" viewBox="0 0 160 160" aria-hidden="true">
              <defs><linearGradient id="nvRingGrad${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8FD3FF"/><stop offset=".5" stop-color="#B7A9FF"/><stop offset="1" stop-color="#FF5FD2"/></linearGradient></defs>
              <circle class="nv-power-ring__track" cx="80" cy="80" r="74" pathLength="100"/>
              <circle class="nv-power-ring__val" data-ref="ring" cx="80" cy="80" r="74" pathLength="100" stroke="url(#nvRingGrad${uid})"/>
              <circle class="nv-power-ring__hold" cx="80" cy="80" r="74" pathLength="100"/>
            </svg>
            <button type="button" class="nv-power" data-ref="power" aria-pressed="true" aria-describedby="nvPowerHint${uid}">
              <span>${I_POWER}<em data-ref="powerLabel">Watching</em></span>
            </button>
            <span class="nv-sr" id="nvPowerHint${uid}">Press to pause or resume watching. Hold, or use Scan now, to scan.</span>
          </div>
          <button type="button" class="nv-scanchip nv-rise" style="--d:.4s" data-ref="scanChip">${I_SCAN}<span data-ref="scanChipText">Scan now</span></button>

          <div class="nv-router nv-rise" style="--d:.46s" data-ref="router">
            <span class="nv-router__main" data-ref="routerMain">${I_ROUTER}<span data-ref="routerText">Looking for your router</span></span>
            <span class="nv-pill" data-ref="dohPill">DoH ${DASH}</span>
            <button type="button" class="nv-pill nv-pill--btn" data-ref="riskPill">Not scanned</button>
          </div>
        </div>

      </section>

      <div class="nv-dock nv-rise" style="--d:.55s">
        <div class="nv-vox" data-ref="vox" data-state="idle">
          <div class="nv-vox__clip" aria-hidden="true">
            <div class="nv-aurora"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
          </div>
          <div class="nv-vox__body">
            <div class="nv-vox__card" data-ref="card"></div>
            <form class="nv-vox__idle" data-ref="form" autocomplete="off">
              <label for="nvAsk${uid}" class="nv-sr">Ask an AI agent about your network</label>
              <input id="nvAsk${uid}" data-ref="input" type="text" spellcheck="false" maxlength="2000" placeholder="Ask about your network…">
            </form>
            <p class="nv-vox__hint" data-ref="hint" role="status" hidden></p>
            <p class="nv-sr" data-ref="answerLive" aria-live="polite"></p>
          </div>
          <div class="nv-vox__bar">
            <button type="button" class="nv-ic nv-ic--plus" data-ref="plus" aria-pressed="false" title="Attach the latest scan to the question">${I_PLUS}</button>
            <span class="nv-attach" data-ref="attachTag" hidden>Scan attached</span>
            <div class="nv-agent-wrap">
              <button type="button" class="nv-agent" data-ref="agentBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="nvAgentMenu${uid}">
                <i data-ref="agentDot"></i><span data-ref="agentName">Agent (auto)</span>${I_CARET}
              </button>
              <div class="nv-menu" id="nvAgentMenu${uid}" data-ref="menu" role="menu" aria-label="Choose agent" hidden></div>
            </div>
            <button type="button" class="nv-ic" data-ref="mic" aria-label="Dictate a question">${I_MIC}</button>
            <button type="button" class="nv-ic nv-ic--send" data-ref="send" aria-label="Ask">${I_SEND}</button>
            <button type="button" class="nv-ic" data-ref="closeBtn" aria-label="Close answer" hidden>${I_CLOSE}</button>
          </div>
        </div>
      </div>

      <section class="nv-below" aria-labelledby="nvBelowTitle${uid}">
        <div class="nv-below__h">
          <div>
            <div class="nv-eyebrow">Right now on your network</div>
            <h2 id="nvBelowTitle${uid}" data-ref="headline">Your network, under watch.</h2>
          </div>
          <p data-ref="summary">Looking at your router, Wi-Fi and the devices around you.</p>
        </div>

        <div class="nv-grid">
          <article class="nv-card" aria-labelledby="nvDoorsTitle${uid}">
            <div class="nv-card__h">
              <div><h3 id="nvDoorsTitle${uid}">Close backdoors</h3><p class="nv-sub" data-ref="doorsSub">Worst first, from the last scan.</p></div>
              <span class="nv-tag" data-ref="scanAge">not scanned</span>
            </div>
            <div class="nv-prog" data-ref="prog" hidden><div class="nv-prog__bar"><span data-ref="progBar"></span></div><b data-ref="progText"></b></div>
            <div class="nv-scanline" data-ref="scanLine"></div>
            <ul class="nv-doors" data-ref="doors"></ul>
            <div class="nv-row">
              <button type="button" class="nv-btn nv-btn--primary" data-ref="scanBtn">Scan now</button>
              <button type="button" class="nv-btn nv-btn--ghost" data-ref="seeAll">See all</button>
            </div>
          </article>

          <article class="nv-card" aria-labelledby="nvSpeedTitle${uid}">
            <div class="nv-card__h">
              <div><h3 id="nvSpeedTitle${uid}">Speed</h3><p class="nv-sub" data-ref="spSub">No speed test yet.</p></div>
              <span class="nv-tag" data-ref="spTag" hidden></span>
            </div>
            <div class="nv-gauge">
              <svg viewBox="0 0 260 232" role="img" aria-labelledby="nvGaugeTitle${uid}">
                <title id="nvGaugeTitle${uid}" data-ref="gTitle">Download speed gauge, 0 to 1 gigabit</title>
                <defs><linearGradient id="nvGaugeGrad${uid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8FD3FF"/><stop offset=".55" stop-color="#7C6CFF"/><stop offset="1" stop-color="#D3C8FF"/></linearGradient></defs>
                <path class="nv-g-track" d="M59.29 200.71 A100 100 0 1 1 200.71 200.71" pathLength="100"/>
                <path class="nv-g-val" data-ref="gVal" d="M59.29 200.71 A100 100 0 1 1 200.71 200.71" pathLength="100" stroke="url(#nvGaugeGrad${uid})" stroke-dasharray="0 100"/>
                <g data-ref="gTicks"></g>
                <g class="nv-g-needle" data-ref="gNeedle" transform="rotate(135 130 130)"><line x1="130" y1="130" x2="196" y2="130"/><circle cx="130" cy="130" r="7"/></g>
              </svg>
              <div class="nv-g-read"><span class="nv-g-phase" data-ref="gPhase">Download</span><span class="nv-g-num" data-ref="gNum">${DASH}</span><span class="nv-g-unit">Mbps</span></div>
            </div>
            <dl class="nv-trio">
              <div><dt>Ping</dt><dd data-ref="tPing">${DASH}</dd></div>
              <div><dt>Download</dt><dd data-ref="tDown">${DASH}</dd></div>
              <div><dt>Upload</dt><dd data-ref="tUp">${DASH}</dd></div>
            </dl>
            <p class="nv-signal" data-ref="signal"></p>
            <div class="nv-hint" data-ref="spHint" hidden></div>
            <div class="nv-row">
              <button type="button" class="nv-btn nv-btn--primary" data-ref="speedBtn">Run test</button>
              <button type="button" class="nv-btn nv-btn--ghost" data-ref="speedMore">Speed &amp; Wi-Fi</button>
            </div>
          </article>

          <article class="nv-card" aria-labelledby="nvDevTitle${uid}">
            <div class="nv-card__h">
              <div><h3 id="nvDevTitle${uid}">Who's on your Wi-Fi</h3><p class="nv-sub" data-ref="devSub">Discovering devices.</p></div>
              <span class="nv-tag nv-tag--count" data-ref="devCount">${DASH}</span>
            </div>
            <ul class="nv-devs" data-ref="devs"></ul>
            <div class="nv-row">
              <button type="button" class="nv-btn nv-btn--ghost" data-ref="devMore">Open Devices</button>
            </div>
          </article>
        </div>
        ${ctx.isMock ? '<p class="nv-foot">Browser preview: everything on this page is sample data.</p>' : ''}
      </section>
    </div>`;

  const ref = {};
  for (const node of el.querySelectorAll('[data-ref]')) ref[node.dataset.ref] = node;

  /* ---------------------------------------------------------------- hero */

  import('../hero3d.js')
    .then((mod) => {
      if (disposed) return;
      hero = mod.initRouterHero(ref.stage, { reducedMotion: reduced() });
      lastThreat = null;
      lastSignal = undefined;
      lastShield = null;
      lastAgentsKey = '';
      applyHero();
      heroCall('setPaused', document.hidden || !heroInView);
    })
    .catch((err) => {
      console.warn('[home] 3D hero unavailable, using flat backdrop', err);
      el.querySelector('.nv-hero').classList.add('nv-hero--flat');
    });

  function heroCall(name, ...args) {
    if (!hero || typeof hero[name] !== 'function') return;
    try { hero[name](...args); } catch (err) { console.warn(`[home] hero.${name} failed`, err); }
  }

  function applyHero() {
    if (!hero) return;
    const level = threatLevel(store.get('scan'));
    if (level !== lastThreat) {
      lastThreat = level;
      heroCall('setThreat', level);
    }
    const wifi = store.get('wifi');
    // null = not measured; the hero must not keep a stale level on screen.
    const signal = wifi && isNum(wifi.signalPct) ? Math.max(0, Math.min(1, wifi.signalPct / 100)) : null;
    if (wifi !== undefined && signal !== lastSignal) {
      lastSignal = signal;
      heroCall('setSignal', signal);
    }
    const on = watchState().on;
    if (on !== lastShield) {
      lastShield = on;
      heroCall('setShield', on);
    }
    applyAgents();
  }

  function applyAgents() {
    if (!hero) return;
    const list = store.get('providers');
    const agents = PROVIDERS.map((p) => {
      const live = Array.isArray(list) ? list.find((x) => x && x.id === p.id) : null;
      return { id: p.id, name: (live && live.name) || p.name, color: p.color, active: Boolean(live && live.hasKey) };
    });
    const key = agents.map((a) => `${a.id}:${a.active ? 1 : 0}`).join(',');
    if (key === lastAgentsKey) return;
    lastAgentsKey = key;
    heroCall('setAgents', agents);
  }

  const onVisibility = () => { heroCall('setPaused', document.hidden || !heroInView); renderTimer(); };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

  // Pause the render loop while the hero is scrolled out of view.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([entry]) => {
      heroInView = entry.isIntersecting;
      heroCall('setPaused', document.hidden || !heroInView);
    }, { root: el, threshold: 0.02 });
    io.observe(el.querySelector('.nv-hero'));
    cleanups.push(() => io.disconnect());
  }

  /* ---------------------------------------------------------------- watch timer + power */

  function watchState() {
    return store.get('watch') || { on: true, since: Date.now(), carriedMs: 0 };
  }
  function watchedMs() {
    const w = watchState();
    return (w.carriedMs || 0) + (w.on ? Date.now() - w.since : 0);
  }

  let lastSpoken = '';
  function renderTimer() {
    if (document.hidden) return;
    const ms = watchedMs();
    ref.timer.textContent = fmtClock(ms);
    const spoken = `Watched for ${spokenClock(ms)}`;
    if (spoken !== lastSpoken) { lastSpoken = spoken; ref.timer.setAttribute('aria-label', spoken); }
  }
  const timerId = setInterval(renderTimer, 1000);
  cleanups.push(() => clearInterval(timerId));

  function renderPower() {
    const on = watchState().on;
    ref.power.setAttribute('aria-pressed', on ? 'true' : 'false');
    ref.power.setAttribute('aria-label', on ? 'Watching. Press to pause' : 'Paused. Press to resume watching');
    ref.powerLabel.textContent = on ? 'Watching' : 'Paused';
    ref.timerLabel.textContent = on ? 'Watching your network' : 'Watching paused';
    el.querySelector('.nv-hero').classList.toggle('is-paused', !on);
  }

  function toggleWatch() {
    const w = watchState();
    const now = Date.now();
    if (w.on) store.set('watch', { on: false, since: now, carriedMs: (w.carriedMs || 0) + (now - w.since) });
    else store.set('watch', { on: true, since: now, carriedMs: w.carriedMs || 0 });
    const on = watchState().on;
    ctx.toast(on ? 'Watching again. The session timer continues.' : 'Watching paused. Fixes you made stay in place.', 'info');
  }

  function startScan() {
    const sp = store.get('scanProgress');
    if (sp && sp.running) return;
    ctx.runScan().catch(() => {});
  }

  // Click toggles watch; hold (pointer) runs a scan. Keyboard users get the "Scan now" chip.
  let holdTimer = 0;
  let held = false;
  const wrap = el.querySelector('.nv-power-wrap');
  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = 0;
    wrap.classList.remove('is-holding');
  }
  ref.power.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = false;
    cancelHold();
    wrap.classList.add('is-holding');
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      held = true;
      wrap.classList.remove('is-holding');
      startScan();
    }, LONG_PRESS_MS);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => ref.power.addEventListener(t, cancelHold));
  ref.power.addEventListener('contextmenu', (e) => e.preventDefault());
  ref.power.addEventListener('click', (e) => {
    // A stale hold (pointer released off the button) must not swallow a keyboard press (detail 0).
    if (held) { held = false; if (e.detail !== 0) return; }
    toggleWatch();
  });
  ref.scanChip.addEventListener('click', startScan);
  cleanups.push(cancelHold);

  /* ---------------------------------------------------------------- status + verdict */

  function computeStatus() {
    const scan = store.get('scan');
    const sp = store.get('scanProgress') || {};
    const hasScan = Boolean(scan && Array.isArray(scan.checks) && scan.checks.length > 0);
    if (sp.running) {
      return {
        tone: 'scan',
        text: sp.total ? `Scanning · check ${Math.min((sp.index || 0) + 1, sp.total)}/${sp.total}` : 'Scanning · starting',
      };
    }
    const prefix = watchState().on ? 'Shield active' : 'Shield paused';
    if (hasScan) {
      const c = countBy(scan.checks);
      if (c.risk > 0) return { tone: 'risk', text: `${prefix} · ${plural(c.risk, 'door', 'doors')} open` };
      const ds = doorState(scan.checks);
      if (ds === 'blind') return { tone: 'warn', text: `${prefix} · router not reachable` };
      if (ds === 'partial') return { tone: 'warn', text: `${prefix} · ${plural(untestedDoors(scan.checks), 'door', 'doors')} not tested` };
      if (c.warn > 0) return { tone: 'warn', text: `${prefix} · ${c.warn} to tighten` };
      return { tone: watchState().on ? 'ok' : 'paused', text: `${prefix} · all clear` };
    }
    if (sp.error) return { tone: 'warn', text: `${prefix} · last scan failed` };
    return { tone: 'scan', text: `${prefix} · first scan pending` };
  }

  function renderStatus() {
    const st = computeStatus();
    ref.status.dataset.tone = st.tone;
    ref.statusText.textContent = st.text;
  }

  function renderVerdict() {
    const scan = store.get('scan');
    const sp = store.get('scanProgress') || {};
    const running = Boolean(sp.running);
    const hasScan = Boolean(scan && Array.isArray(scan.checks) && scan.checks.length > 0);
    const counts = hasScan ? countBy(scan.checks) : null;
    const scanErr = hasScan && Array.isArray(scan.errors) && scan.errors[0] ? String(scan.errors[0]).replace(/\.?$/, '.') : '';

    let headline = 'Your network, under watch.';
    let tone = 'watch';
    let summary;

    if (running) {
      summary = sp.total
        ? `Checking your router for open doors. Check ${Math.min((sp.index || 0) + 1, sp.total)} of ${sp.total}: ${sp.title || ''}`
        : 'Checking your router for open doors.';
    } else if (hasScan) {
      const worst = rankChecks(scan.checks)[0];
      if (counts.risk > 0) {
        headline = `${plural(counts.risk, 'door', 'doors')} open.`;
        tone = 'risk';
        const rest = [];
        if (counts.warn) rest.push(`${counts.warn} more to tighten`);
        if (counts.unknown) rest.push(`${counts.unknown} we cannot see from this computer`);
        summary = `Worst first: ${worst.title.replace(/\.$/, '')}.${rest.length ? ` Plus ${rest.join(', ')}.` : ''}`;
      } else if (doorState(scan.checks) !== 'closed') {
        const blind = doorState(scan.checks) === 'blind';
        headline = blind ? "Can't see your router." : 'No open doors seen.';
        summary = blind
          ? 'Bastion could not reach your router from this computer, so its doors were not tested.'
          : `Nothing open that we can see, but ${plural(untestedDoors(scan.checks), 'router door was', 'router doors were')} not tested.`;
        if (scanErr) summary += ` ${scanErr}`;
      } else {
        headline = 'Faster, quieter, closed.';
        tone = 'clear';
        if (counts.warn) summary = `Nothing is wide open. ${plural(counts.warn, 'setting is', 'settings are')} worth tightening${worst ? `, starting with: ${worst.title.replace(/\.$/, '')}` : ''}.`;
        else if (counts.unknown) summary = `Nothing open that we can see. ${plural(counts.unknown, 'check needs', 'checks need')} a look inside the router to confirm.`;
        else summary = 'Every check passed. Bastion keeps watching and will tell you if anything changes.';
      }
    } else if (sp.error) {
      summary = `The last scan did not finish: ${sp.error}`;
    } else {
      summary = 'Looking at your router, Wi-Fi and the devices around you.';
    }

    if (ref.headline.textContent !== headline) {
      ref.headline.textContent = headline;
      ref.headline.classList.remove('is-swap');
      void ref.headline.offsetWidth; // restart the swap animation
      ref.headline.classList.add('is-swap');
    }
    ref.headline.dataset.tone = tone;
    ref.summary.textContent = summary;

    // Scan controls
    ref.scanBtn.disabled = running;
    ref.scanBtn.textContent = running ? 'Scanning…' : hasScan ? 'Scan again' : 'Scan now';
    ref.scanChip.disabled = running;
    ref.scanChipText.textContent = running ? 'Scanning…' : 'Scan now';

    // Progress ring around the power button: live during a scan, empty otherwise.
    const frac = running && sp.total ? Math.min(1, (Object.keys(sp.seen || {}).length) / sp.total) : 0;
    ref.ring.style.strokeDasharray = `${(frac * 100).toFixed(2)} 100`;
    wrap.classList.toggle('is-scanning', running);
    ref.power.setAttribute('aria-busy', running ? 'true' : 'false');
  }

  /* ---------------------------------------------------------------- rates */

  function renderRates() {
    const speed = store.get('speed');
    const sp = store.get('speedProgress') || {};
    const running = Boolean(sp.running);
    let down = speed ? speed.downMbps : null;
    let up = speed ? speed.upMbps : null;
    let ping = speed ? speed.pingMs : null;
    if (running) {
      down = isNum(sp.downMbps) ? sp.downMbps : null;
      up = isNum(sp.upMbps) ? sp.upMbps : null;
      ping = isNum(sp.pingMs) ? sp.pingMs : null;
    }
    ref.vDown.textContent = fmtSpeed(down);
    ref.vUp.textContent = fmtSpeed(up);
    ref.vPing.textContent = isNum(ping) ? String(Math.round(ping)) : DASH;
    ref.rateDown.classList.toggle('is-live', running && sp.phase === 'download');
    ref.rateUp.classList.toggle('is-live', running && sp.phase === 'upload');
    ref.ratePing.classList.toggle('is-live', running && sp.phase === 'ping');

    if (running) {
      ref.ratesMeta.textContent = 'Measuring now · Cloudflare speed test';
      ref.ratesRun.hidden = true;
    } else if (speed) {
      ref.ratesMeta.textContent = ['Last test', fmtTime(speed.at), speed.server].filter(Boolean).join(' · ');
      ref.ratesRun.hidden = true;
    } else {
      ref.ratesMeta.textContent = sp.error ? 'The last speed test failed.' : 'No speed test yet.';
      ref.ratesRun.hidden = false;
    }
  }

  /* ---------------------------------------------------------------- router chip */

  function renderRouter() {
    const ov = store.get('overview');
    const wifi = store.get('wifi');
    const dns = store.get('dns');
    const scan = store.get('scan');
    const sp = store.get('scanProgress') || {};

    const parts = [];
    let title = '';
    if (ov === undefined) parts.push('Looking for your router');
    else if (!ov || !ov.gateway || !ov.gateway.ip) parts.push('No router found');
    else parts.push(ov.gateway.vendor || 'Router');

    if (wifi === undefined) {
      // still reading
    } else if (!wifi || wifi.supported === false || (!wifi.ssid && !isNum(wifi.channel))) {
      parts.push('Wi-Fi details unavailable');
      title = (wifi && wifi.errors && wifi.errors[0]) || 'This computer may be on a cable, or the system did not share Wi-Fi details.';
    } else {
      // macOS 14+ without Location permission hides the name but still reports radio values.
      if (wifi.ssid) parts.push(wifi.ssid);
      else {
        parts.push('Network name hidden');
        title = (wifi.errors && wifi.errors[0]) || 'The system did not share the network name. On macOS, allow Location access for Bastion.';
      }
      if (wifi.band) parts.push(`${wifi.band} GHz`);
      if (isNum(wifi.channel)) parts.push(`ch ${wifi.channel}`);
    }
    ref.routerText.textContent = parts.join(' · ');
    if (title) ref.routerMain.title = title; else ref.routerMain.removeAttribute('title');
    if (ov && ov.gateway && ov.gateway.ip) ref.routerMain.setAttribute('aria-label', `${parts.join(', ')}. Gateway ${ov.gateway.ip}`);
    else ref.routerMain.removeAttribute('aria-label');

    // DNS-over-HTTPS
    let dohText = `DoH ${DASH}`;
    let dohTone = 'unknown';
    let dohTitle = 'Reading DNS settings';
    if (dns === null) { dohText = 'DoH unknown'; dohTitle = 'DNS settings could not be read'; }
    else if (dns) {
      if (dns.encrypted === true) { dohText = 'DoH on'; dohTone = 'ok'; }
      else if (dns.encrypted === false) { dohText = 'DoH off'; dohTone = 'warn'; }
      else dohText = 'DoH unknown';
      dohTitle = [dns.provider, (dns.servers || []).slice(0, 2).join(', ')].filter(Boolean).join(' · ') || 'DNS';
    }
    ref.dohPill.textContent = dohText;
    ref.dohPill.dataset.tone = dohTone;
    ref.dohPill.title = dohTitle;

    // Risks
    const hasScan = Boolean(scan && Array.isArray(scan.checks) && scan.checks.length);
    let riskText = 'Not scanned';
    let riskTone = 'unknown';
    if (sp.running && !hasScan) riskText = 'Scanning';
    else if (hasScan) {
      const n = countBy(scan.checks).risk;
      riskText = n ? plural(n, 'risk', 'risks') : 'No risks';
      riskTone = n ? 'risk' : 'ok';
    }
    ref.riskPill.textContent = riskText;
    ref.riskPill.dataset.tone = riskTone;
    ref.riskPill.setAttribute('aria-label', `${riskText}. Open Shield`);
  }

  /* ---------------------------------------------------------------- backdoors card */

  const expanded = new Set();

  async function openTarget(target) {
    try {
      const res = await api.fix.open(target);
      if (res && res.ok) ctx.toast(`Opened ${FIX_TARGET_LABEL[target] || target}. Follow the steps, then scan again.`, 'info');
      else ctx.toast(`Could not open ${FIX_TARGET_LABEL[target] || target} automatically. Follow the steps instead.`, 'warn');
    } catch (err) {
      ctx.toast(`Could not open ${FIX_TARGET_LABEL[target] || target}: ${errMsg(err)}`, 'warn');
    }
  }

  function renderDoors() {
    const scan = store.get('scan');
    const sp = store.get('scanProgress') || {};
    const list = ref.doors;
    list.innerHTML = '';
    const hasScan = Boolean(scan && Array.isArray(scan.checks) && scan.checks.length);

    ref.scanLine.textContent = sp.running
      ? (sp.total ? `> Check ${Math.min((sp.index || 0) + 1, sp.total)}/${sp.total}: ${sp.title || ''}` : '> Starting scan…')
      : '';

    if (!hasScan) {
      ref.prog.hidden = true;
      ref.scanAge.textContent = sp.running ? 'scanning' : 'not scanned';
      if (sp.running) {
        for (let i = 0; i < 3; i += 1) {
          list.append(h('li', { class: 'nv-door is-checking' },
            h('div', { class: 'nv-door__t' },
              h('strong', { text: 'Checking your router' }),
              h('span', { text: 'Waiting for the scan to finish' }))));
        }
      } else {
        list.append(h('li', { class: 'nv-empty' },
          h('strong', { text: sp.error ? 'Scan did not finish' : 'No scan yet' }),
          h('p', { text: sp.error ? sp.error : 'Run a scan to see what needs fixing on your router.' })));
      }
      return;
    }

    const counts = countBy(scan.checks);
    const total = scan.checks.length;
    ref.prog.hidden = false;
    ref.progBar.style.width = `${Math.round((counts.ok / total) * 100)}%`;
    ref.progText.textContent = `${counts.ok} of ${total} passed`;
    const at = fmtTime(scan.finishedAt);
    ref.scanAge.textContent = at ? `scanned ${at}` : 'scanned';
    ref.doorsSub.textContent = `${counts.risk + counts.warn} to fix · ${counts.ok} passed${counts.unknown ? ` · ${counts.unknown} unknown` : ''}`;

    const ranked = rankChecks(scan.checks);
    if (!ranked.length) {
      list.append(h('li', { class: 'nv-empty nv-empty--ok' },
        h('strong', { text: 'Nothing to fix' }),
        h('p', { text: `All ${total} checks passed on the last scan.` })));
      return;
    }
    for (const check of ranked.slice(0, 4)) list.append(renderDoor(check));
  }

  function sevInfo(check) {
    if (check.status === 'unknown') return { cls: 'unknown', text: 'unknown' };
    if (check.severity === 'critical') return { cls: 'crit', text: 'critical' };
    if (check.severity === 'high') return { cls: 'high', text: 'high' };
    if (check.severity === 'medium') return { cls: 'med', text: 'medium' };
    return { cls: 'low', text: check.severity || 'low' };
  }

  function renderDoor(check) {
    const sev = sevInfo(check);
    const open = expanded.has(check.id);
    const fix = check.fix;
    const row = h('li', { class: `nv-door nv-door--${check.status}`, 'data-id': check.id },
      h('div', { class: 'nv-door__t' },
        h('strong', { text: check.title }),
        h('span', { class: 'nv-selectable', text: check.evidence || '' })),
      h('span', { class: `nv-sev nv-sev--${sev.cls}`, text: sev.text }),
      fix ? h('button', {
        type: 'button',
        class: `nv-mini ${check.status === 'risk' ? 'nv-mini--go' : ''}`,
        'aria-expanded': open ? 'true' : 'false',
        text: fix.label || 'Fix',
        onclick: () => onFix(check),
      }) : null);

    if (open && fix && Array.isArray(fix.steps) && fix.steps.length) {
      row.append(h('div', { class: 'nv-door__steps' },
        h('ol', {}, fix.steps.map((s) => h('li', { text: s }))),
        h('div', { class: 'nv-door__steps-end' },
          fix.open ? h('button', { type: 'button', class: 'nv-mini nv-mini--go', text: `Open ${FIX_TARGET_LABEL[fix.open] || 'settings'}`, onclick: () => openTarget(fix.open) }) : null,
          h('button', { type: 'button', class: 'nv-mini', text: 'Scan again when done', onclick: startScan }))));
    }
    return row;
  }

  function onFix(check) {
    const wasOpen = expanded.has(check.id);
    if (wasOpen) expanded.delete(check.id);
    else expanded.add(check.id);
    renderDoors();
    const btn = ref.doors.querySelector(`[data-id="${CSS.escape(check.id)}"] .nv-mini`);
    if (btn) btn.focus();
    if (!wasOpen && check.fix && check.fix.open) openTarget(check.fix.open);
  }

  /* ---------------------------------------------------------------- speed card */

  (function buildTicks() {
    const ns = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < G_STOPS.length; i += 1) {
      const a = ((135 + (270 * i) / (G_STOPS.length - 1)) * Math.PI) / 180;
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', (130 + 124 * Math.cos(a)).toFixed(1));
      t.setAttribute('y', (130 + 124 * Math.sin(a) + 4).toFixed(1));
      t.setAttribute('text-anchor', Math.abs(Math.cos(a)) < 0.2 ? 'middle' : (Math.cos(a) < 0 ? 'end' : 'start'));
      t.setAttribute('class', 'nv-g-tick');
      t.textContent = G_LABELS[i];
      ref.gTicks.append(t);
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', (130 + 86 * Math.cos(a)).toFixed(1));
      l.setAttribute('y1', (130 + 86 * Math.sin(a)).toFixed(1));
      l.setAttribute('x2', (130 + 80 * Math.cos(a)).toFixed(1));
      l.setAttribute('y2', (130 + 80 * Math.sin(a)).toFixed(1));
      l.setAttribute('class', 'nv-g-mark');
      ref.gTicks.append(l);
    }
  })();

  function setGauge(v, phase) {
    const f = gaugeFrac(v);
    ref.gVal.setAttribute('stroke-dasharray', `${(f * 100).toFixed(2)} 100`);
    ref.gNeedle.setAttribute('transform', `rotate(${(135 + 270 * f).toFixed(2)} 130 130)`);
    ref.gNum.textContent = fmtSpeed(v);
    el.querySelector('.nv-gauge').classList.toggle('is-empty', !isNum(v));
    ref.gPhase.textContent = phase;
    ref.gTitle.textContent = isNum(v) ? `${phase}: ${fmtSpeed(v)} megabits per second` : `${phase}: not measured`;
  }

  function renderSpeed() {
    const speed = store.get('speed');
    const sp = store.get('speedProgress') || {};
    const wifi = store.get('wifi');
    const running = Boolean(sp.running);

    if (running) {
      const phaseName = sp.phase === 'ping' ? 'Measuring latency' : sp.phase === 'upload' ? 'Uploading' : sp.phase === 'download' ? 'Downloading' : 'Finishing';
      const live = sp.phase === 'upload' ? sp.upMbps : sp.phase === 'download' ? sp.downMbps : null;
      setGauge(isNum(live) ? live : (isNum(sp.mbps) ? sp.mbps : null), phaseName);
      ref.tPing.textContent = isNum(sp.pingMs) ? `${Math.round(sp.pingMs)} ms` : DASH;
      ref.tDown.textContent = fmtSpeed(sp.downMbps);
      ref.tUp.textContent = fmtSpeed(sp.upMbps);
      ref.spSub.textContent = `Running · ${Math.round((sp.progress || 0) * 100)}% · Cloudflare`;
      ref.speedBtn.textContent = 'Cancel';
    } else {
      setGauge(speed ? speed.downMbps : null, 'Download');
      ref.tPing.textContent = speed && isNum(speed.pingMs) ? `${Math.round(speed.pingMs)} ms` : DASH;
      ref.tDown.textContent = fmtSpeed(speed ? speed.downMbps : null);
      ref.tUp.textContent = fmtSpeed(speed ? speed.upMbps : null);
      if (speed) {
        const jit = isNum(speed.jitterMs) ? `jitter ${speed.jitterMs.toFixed(1)} ms` : null;
        ref.spSub.textContent = [fmtTime(speed.at) ? `Last run ${fmtTime(speed.at)}` : 'Last run', speed.server, jit].filter(Boolean).join(' · ');
      } else {
        ref.spSub.textContent = sp.error ? `Last test failed: ${sp.error}` : 'No speed test yet. It takes about 15 seconds.';
      }
      ref.speedBtn.textContent = speed ? 'Run again' : 'Run test';
    }
    el.querySelector('.nv-gauge').classList.toggle('is-live', running);

    // Wi-Fi radio line
    if (wifi && wifi.supported !== false && (isNum(wifi.signalPct) || isNum(wifi.rssi) || isNum(wifi.rxMbps))) {
      const bits = [];
      if (isNum(wifi.signalPct)) bits.push(`Signal ${Math.round(wifi.signalPct)}%`);
      if (isNum(wifi.rssi)) bits.push(`${wifi.rssi} dBm`);
      if (isNum(wifi.rxMbps)) bits.push(`link ${Math.round(wifi.rxMbps)} Mbps`);
      if (wifi.security) bits.push(wifi.security);
      ref.signal.textContent = bits.join(' · ');
      ref.signal.hidden = false;
    } else {
      ref.signal.textContent = '';
      ref.signal.hidden = true;
    }
    if (wifi && (wifi.band || isNum(wifi.channel))) {
      ref.spTag.hidden = false;
      ref.spTag.textContent = [wifi.band ? `${wifi.band} GHz` : null, isNum(wifi.channel) ? `ch ${wifi.channel}` : null, isNum(wifi.widthMHz) ? `${wifi.widthMHz} MHz` : null].filter(Boolean).join(' · ');
    } else {
      ref.spTag.hidden = true;
    }
    renderSurveyHint();
  }

  function renderSurveyHint() {
    const survey = store.get('survey');
    const host = ref.spHint;
    host.innerHTML = '';
    host.className = 'nv-hint';
    if (survey === undefined) { host.hidden = true; return; }
    if (!survey || survey.ok === false || survey.supported === false || !Array.isArray(survey.networks)) {
      host.hidden = false;
      host.classList.add('nv-hint--muted');
      host.append(h('span', { text: (survey && (survey.error || (survey.errors && survey.errors[0]))) || 'This computer cannot list nearby networks, so no channel advice.' }));
      return;
    }
    host.hidden = false;
    if (survey.recommendation) {
      const r = survey.recommendation;
      host.insertAdjacentHTML('afterbegin', I_BOLT);
      host.append(h('div', {},
        h('span', {},
          h('strong', { text: `Move to channel ${r.channel}` }),
          ` (${r.band} GHz). ${r.neighboursNow} neighbouring ${r.neighboursNow === 1 ? 'network shares' : 'networks share'} your channel now, ${r.neighboursThere} there.`),
        h('button', {
          type: 'button',
          class: 'nv-link',
          text: 'Change channel',
          onclick: async () => {
            await openTarget('router-admin');
            ctx.toast(`In the router's Wireless settings, set the ${r.band} GHz channel to ${r.channel}.`, 'info', { ttl: 9000 });
          },
        })));
      return;
    }
    const cur = survey.current || {};
    const canJudge = isNum(cur.channel) && (cur.band === '2.4' || cur.band === '5') && survey.networks.length > 0;
    let why = 'No channel advice right now.';
    if (!isNum(cur.channel)) why = 'No channel advice: the current Wi-Fi channel is unknown.';
    else if (cur.band === '6') why = 'No channel advice: 6 GHz is rarely crowded.';
    else if (!survey.networks.length) why = 'No channel advice: no nearby networks were listed.';
    host.classList.add(canJudge ? 'nv-hint--ok' : 'nv-hint--muted');
    host.append(h('span', { text: canJudge ? 'Your channel is as quiet as any nearby. No change needed.' : why }));
  }

  /* ---------------------------------------------------------------- devices card */

  function devKey(d) { return String(d.mac || d.ip || '').toLowerCase(); }

  function trackDevices(devices) {
    if (!Array.isArray(devices)) return;
    if (!seenPrimed) {
      for (const d of devices) seenMacs.add(devKey(d));
      seenPrimed = true;
      return;
    }
    for (const d of devices) {
      const k = devKey(d);
      if (!seenMacs.has(k)) { seenMacs.add(k); newMacs.add(k); }
    }
  }

  function renderDevices() {
    const devices = store.get('devices');
    const list = ref.devs;
    list.innerHTML = '';
    if (devices === undefined) {
      ref.devCount.textContent = DASH;
      ref.devSub.textContent = 'Discovering devices.';
      for (let i = 0; i < 3; i += 1) {
        list.append(h('li', { class: 'nv-dev is-loading' }, h('span', { class: 'nv-dev__ic', html: I_DEV.unknown }),
          h('div', {}, h('div', { class: 'nv-dev__n', text: 'Looking around' }), h('div', { class: 'nv-dev__m', text: 'Reading the network' }))));
      }
      return;
    }
    if (!Array.isArray(devices)) {
      ref.devCount.textContent = DASH;
      ref.devSub.textContent = 'Device list unavailable.';
      list.append(h('li', { class: 'nv-empty' }, h('strong', { text: 'Could not list devices' }), h('p', { text: 'Bastion could not read the network neighbour table on this computer.' })));
      return;
    }
    trackDevices(devices);
    const priv = devices.filter((d) => d.randomizedMac && !d.isThisComputer).length;
    const fresh = devices.filter((d) => newMacs.has(devKey(d))).length;
    ref.devCount.textContent = String(devices.length);
    ref.devSub.textContent = [plural(devices.length, 'device', 'devices'), fresh ? `${fresh} new this session` : null, priv ? `${priv} private ${priv === 1 ? 'address' : 'addresses'}` : null].filter(Boolean).join(' · ');

    if (!devices.length) {
      list.append(h('li', { class: 'nv-empty' }, h('strong', { text: 'No devices seen yet' }), h('p', { text: 'Devices appear once they talk on the network.' })));
      return;
    }
    const score = (d) => (newMacs.has(devKey(d)) ? 0 : d.randomizedMac && !d.isThisComputer ? 1 : !d.vendor && !d.hostname ? 2 : d.isThisComputer ? 3 : d.isGateway ? 4 : 5);
    const shown = [...devices].sort((a, b) => score(a) - score(b)).slice(0, 4);
    for (const d of shown) {
      const isNew = newMacs.has(devKey(d));
      const kind = d.isGateway ? 'router' : d.isThisComputer ? 'laptop' : d.randomizedMac ? 'phone' : 'unknown';
      const name = d.isThisComputer ? 'This computer' : d.isGateway ? (d.vendor ? `${d.vendor} router` : 'Router') : (d.hostname || d.vendor || 'Unknown device');
      const meta = [d.ip, d.randomizedMac ? 'private address' : (d.isThisComputer || d.isGateway ? null : d.vendor && d.hostname ? d.vendor : null)].filter(Boolean).join(' · ');
      const badge = isNew ? 'new' : d.isGateway ? 'router' : d.isThisComputer ? 'you' : d.randomizedMac ? 'private' : null;
      list.append(h('li', { class: `nv-dev${isNew ? ' nv-dev--new' : d.randomizedMac && !d.isThisComputer ? ' nv-dev--warn' : ''}` },
        h('span', { class: 'nv-dev__ic', html: I_DEV[kind] }),
        h('div', { class: 'nv-dev__main' },
          h('div', { class: 'nv-dev__n', text: name }),
          h('div', { class: 'nv-dev__m nv-selectable', text: meta || (d.mac || '') })),
        badge ? h('span', { class: `nv-dev__b nv-dev__b--${badge}`, text: badge }) : h('span')));
    }
  }

  /* ---------------------------------------------------------------- voice bar */

  let agentPref = readPref();
  if (agentPref !== 'auto' && !PROVIDERS.some((p) => p.id === agentPref)) agentPref = 'auto';
  let attachScan = false;

  function providerInfo(id) {
    const base = PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
    const list = store.get('providers');
    const live = Array.isArray(list) ? list.find((p) => p && p.id === base.id) : null;
    return { ...base, name: (live && live.name) || base.name, hasKey: live ? Boolean(live.hasKey) : null, model: live ? live.model : null };
  }

  // Auto = first provider with a key (falls back to Claude so the no-key card can explain).
  function resolveProvider() {
    if (agentPref !== 'auto') return providerInfo(agentPref);
    const list = store.get('providers');
    const withKey = Array.isArray(list) ? PROVIDERS.find((p) => list.some((x) => x && x.id === p.id && x.hasKey)) : null;
    return providerInfo(withKey ? withKey.id : 'claude');
  }

  function renderAgent() {
    const p = resolveProvider();
    const auto = agentPref === 'auto';
    ref.agentName.textContent = auto ? 'Agent (auto)' : p.name;
    ref.agentDot.style.background = auto ? 'var(--lavender)' : p.color;
    ref.agentBtn.title = `${auto ? `Auto: ${p.name}` : p.name}${p.model ? ` · ${p.model}` : ''}${p.hasKey === false ? ' · no key yet' : ''}`;
    ref.agentBtn.classList.toggle('no-key', p.hasKey === false);

    ref.menu.innerHTML = '';
    const items = [{ id: 'auto', name: 'Auto', color: 'var(--lavender)', small: 'first with a key' },
      ...PROVIDERS.map((x) => { const info = providerInfo(x.id); return { id: x.id, name: info.name, color: x.color, small: info.hasKey === false ? 'no key' : x.hint }; })];
    for (const it of items) {
      const b = h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': agentPref === it.id ? 'true' : 'false', 'data-agent': it.id, tabindex: '-1' },
        h('i', { style: `background:${it.color}` }), it.name, h('small', { text: it.small }));
      ref.menu.append(b);
    }
  }

  function openMenu() {
    ref.menu.hidden = false;
    ref.agentBtn.setAttribute('aria-expanded', 'true');
    const cur = ref.menu.querySelector('[aria-checked="true"]') || ref.menu.querySelector('button');
    if (cur) cur.focus();
  }
  function closeMenu(focusBtn) {
    if (ref.menu.hidden) return;
    ref.menu.hidden = true;
    ref.agentBtn.setAttribute('aria-expanded', 'false');
    if (focusBtn) ref.agentBtn.focus();
  }
  ref.agentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ref.menu.hidden) openMenu(); else closeMenu(false);
  });
  ref.agentBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(); }
  });
  ref.menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-agent]');
    if (!b) return;
    agentPref = b.dataset.agent;
    writePref(agentPref);
    renderAgent();
    closeMenu(true);
  });
  ref.menu.addEventListener('keydown', (e) => {
    const items = [...ref.menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Tab') closeMenu(false);
  });
  const onDocClick = (e) => { if (!ref.menu.hidden && !e.target.closest('.nv-agent-wrap')) closeMenu(false); };
  document.addEventListener('click', onDocClick);
  cleanups.push(() => document.removeEventListener('click', onDocClick));

  // "+" attaches the full latest scan; without it the agent gets only the scan summary.
  function renderAttach() {
    const scan = store.get('scan');
    const hasScan = Boolean(scan && Array.isArray(scan.checks) && scan.checks.length);
    if (!hasScan) attachScan = false;
    ref.plus.setAttribute('aria-pressed', attachScan ? 'true' : 'false');
    ref.plus.setAttribute('aria-label', attachScan ? 'Detach the latest scan' : 'Attach the latest scan to the question');
    ref.plus.title = hasScan ? (attachScan ? 'Latest scan attached. Click to detach.' : 'Attach the latest scan to the question') : 'No scan to attach yet';
    ref.attachTag.hidden = !attachScan;
    if (attachScan) ref.attachTag.textContent = `Scan attached · ${scan.checks.length} checks`;
  }
  ref.plus.addEventListener('click', () => {
    const scan = store.get('scan');
    if (!scan || !Array.isArray(scan.checks) || !scan.checks.length) {
      showHint('Run a scan first, then attach it to your question.');
      return;
    }
    attachScan = !attachScan;
    renderAttach();
    ref.input.focus();
  });

  function buildSnapshot() {
    const snap = ctx.snapshot();
    if (!attachScan && snap && snap.scan) {
      const c = countBy(snap.scan.checks);
      snap.scan = { finishedAt: snap.scan.finishedAt, score: snap.scan.score, summary: { open: c.risk, toTighten: c.warn, unknown: c.unknown, passed: c.ok }, detail: 'not attached' };
    }
    return snap;
  }

  // Mic: no offline speech recognition in Electron, so point to the OS dictation honestly.
  let hintTimer = 0;
  function showHint(text) {
    ref.hint.textContent = text;
    ref.hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { ref.hint.hidden = true; }, 7000);
  }
  cleanups.push(() => clearTimeout(hintTimer));
  ref.mic.addEventListener('click', () => {
    ref.input.focus();
    showHint(dictationHint(api.platform));
  });

  // Morph between the pill and the taller card with a measured height transition.
  function setVox(state) {
    closeMenu(false);
    const vox = ref.vox;
    const from = vox.offsetHeight;
    vox.dataset.state = state;
    vox.style.height = '';
    const to = vox.offsetHeight;
    ref.closeBtn.hidden = state === 'idle';
    el.querySelector('.nv-hero').classList.toggle('has-card', state !== 'idle');
    if (reduced() || from === to) { vox.classList.remove('is-anim'); return; }
    vox.classList.add('is-anim');
    vox.style.height = `${from}px`;
    void vox.offsetHeight;
    vox.style.height = `${to}px`;
  }
  ref.vox.addEventListener('transitionend', (e) => {
    if (e.target === ref.vox && e.propertyName === 'height') {
      ref.vox.style.height = '';
      ref.vox.classList.remove('is-anim');
    }
  });

  function whoLine(p) {
    return h('div', { class: 'nv-who' }, h('i', { style: `background:${p.color};color:${p.color}` }),
      h('span', { text: `${p.name}${agentPref === 'auto' ? ' · picked automatically' : ''}` }));
  }

  function renderNeedsKey(p, question) {
    ref.card.innerHTML = '';
    ref.card.append(
      h('div', { class: 'nv-q' }, 'You asked: ', h('b', { text: question })),
      whoLine(p),
      h('p', { class: 'nv-ans', text: needsKeyText(p) }),
      h('div', { class: 'nv-chips' },
        h('button', { type: 'button', class: 'nv-chip nv-chip--go', text: 'Add a key in Settings', onclick: () => ctx.navigate('settings') }),
        h('button', { type: 'button', class: 'nv-chip', text: 'Choose another agent', onclick: (e) => { e.stopPropagation(); openMenu(); } })));
    setVox('answer');
    announce(`${p.name}: ${needsKeyText(p)}`);
  }

  function needsKeyText(p) {
    return `${p.name} needs your own ${p.company} API key first. Add one in Settings: it stays on this computer, and questions go straight from here to ${p.company}.`;
  }

  // One off-screen live region for finished answers; the typing paragraph itself is not live.
  function announce(text) {
    ref.answerLive.textContent = '';
    setTimeout(() => { if (!disposed) ref.answerLive.textContent = text; }, 60);
  }

  function renderThinking(p, question) {
    ref.card.innerHTML = '';
    ref.card.setAttribute('aria-busy', 'true');
    ref.card.append(
      h('div', { class: 'nv-q' }, 'You asked: ', h('b', { text: question })),
      whoLine(p),
      h('p', { class: 'nv-thinking', text: `${p.name} is reading your network snapshot…` }));
    setVox('thinking');
  }

  // Action chips derived from the real scan and state, never from the answer text alone.
  function answerChips(question, ok, keyProblem) {
    const chips = [];
    const q = question.toLowerCase();
    const scan = store.get('scan');
    const hasScan = Boolean(scan && Array.isArray(scan.checks) && scan.checks.length);
    if (keyProblem) chips.push({ label: 'Add a key in Settings', go: true, run: () => ctx.navigate('settings') });
    if (hasScan) {
      const worst = rankChecks(scan.checks).find((c) => c.fix && c.fix.open);
      if (worst) chips.push({ label: FIX_TARGET_CHIP[worst.fix.open] || 'Open settings', go: !keyProblem, run: () => openTarget(worst.fix.open) });
      if (scan.checks.some((c) => c.status === 'risk' || c.status === 'warn')) chips.push({ label: 'Show Shield', run: () => ctx.navigate('shield') });
    } else {
      chips.push({ label: 'Run a scan', go: !keyProblem, run: startScan });
    }
    if (/slow|speed|fast|lag|ping|latency|channel|wi-?fi|evening|download|upload/.test(q) || !store.get('speed')) {
      chips.push({ label: 'Run speed test', run: () => { const sp = store.get('speedProgress'); if (!(sp && sp.running)) ctx.runSpeed().catch(() => {}); } });
    }
    if (/device|who|phone|unknown|new|guest|tv|camera/.test(q)) chips.push({ label: 'Show devices', run: () => ctx.navigate('devices') });
    if (ok) chips.push({ label: 'Continue in Agents', run: () => ctx.navigate('agents') });
    return chips.slice(0, 4);
  }

  let typeTok = 0;
  function renderAnswer(p, question, res) {
    const ok = Boolean(res && res.ok);
    const keyProblem = !ok && /key/i.test((res && res.error) || '');
    const text = ok ? (res.text || '(empty answer)') : `${p.name} could not answer: ${(res && res.error) || 'unknown error'}`;
    ref.card.innerHTML = '';
    const ans = h('p', { class: `nv-ans nv-selectable${ok ? '' : ' nv-ans--error'}` });
    const chipsBox = h('div', { class: 'nv-chips' });
    const meta = [res && res.model, fmtTime(new Date().toISOString())].filter(Boolean).join(' · ');
    ref.card.append(
      h('div', { class: 'nv-q' }, 'You asked: ', h('b', { text: question })),
      h('div', { class: 'nv-who-row' }, whoLine(p), meta ? h('span', { class: 'nv-meta', text: meta }) : null),
      ans,
      chipsBox);
    setVox('answer');
    if (ok) heroCall('flareAgent', p.id);

    const chips = answerChips(question, ok, keyProblem);
    const finish = () => {
      ans.textContent = text;
      ref.card.setAttribute('aria-busy', 'false');
      announce(ok ? `${p.name}: ${text}` : text);
      chips.forEach((c, n) => {
        chipsBox.append(h('button', {
          type: 'button',
          class: `nv-chip${c.go ? ' nv-chip--go' : ''}`,
          style: `animation-delay:${(n * 0.08).toFixed(2)}s`,
          text: c.label,
          onclick: c.run,
        }));
      });
    };
    const tok = ++typeTok;
    if (reduced()) { finish(); return; }
    let i = 0;
    const step = Math.max(2, Math.ceil(text.length / 260));
    const tick = () => {
      if (tok !== typeTok || disposed) return;
      i = Math.min(text.length, i + step);
      ans.textContent = text.slice(0, i);
      if (i < text.length) {
        ans.append(h('span', { class: 'nv-caret', 'aria-hidden': 'true' }));
        setTimeout(tick, 16);
      } else finish();
    };
    setTimeout(tick, 120);
  }

  async function ask(question) {
    const q = String(question || '').trim();
    if (!q || asking) return;
    closeMenu(false);
    const p = resolveProvider();
    if (p.hasKey === false) {
      typeTok += 1;
      renderNeedsKey(p, q);
      return;
    }
    asking = true;
    typeTok += 1;
    ref.send.disabled = true;
    ref.input.value = '';
    renderThinking(p, q);
    const at = new Date().toISOString();
    let res;
    try {
      res = await api.agents.ask(p.id, q, buildSnapshot());
    } catch (err) {
      res = { ok: false, provider: p.id, model: '', text: '', error: errMsg(err) };
    }
    asking = false;
    store.set('agentLog', [...(store.get('agentLog') || []), {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      at,
      source: 'home',
      provider: p.id,
      model: (res && res.model) || p.model || '',
      question: q,
      ok: Boolean(res && res.ok),
      text: (res && res.text) || '',
      error: (res && res.error) || null,
    }]);
    if (disposed) return;
    ref.send.disabled = false;
    renderAnswer(p, q, res);
  }

  ref.form.addEventListener('submit', (e) => { e.preventDefault(); ask(ref.input.value); });
  ref.send.addEventListener('click', () => ask(ref.input.value));
  ref.closeBtn.addEventListener('click', () => {
    if (asking) return;
    typeTok += 1;
    ref.card.innerHTML = '';
    ref.card.removeAttribute('aria-busy');
    setVox('idle');
    ref.input.focus();
  });
  ref.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ref.vox.dataset.state === 'answer') { e.preventDefault(); ref.closeBtn.click(); }
  });

  /* ---------------------------------------------------------------- actions */

  ref.riskPill.addEventListener('click', () => ctx.navigate('shield'));
  ref.seeAll.addEventListener('click', () => ctx.navigate('shield'));
  ref.scanBtn.addEventListener('click', startScan);
  ref.speedMore.addEventListener('click', () => ctx.navigate('speed'));
  ref.devMore.addEventListener('click', () => ctx.navigate('devices'));
  const speedToggle = () => {
    const sp = store.get('speedProgress');
    if (sp && sp.running) { try { api.speed.cancel(); } catch (err) { console.warn(err); } }
    else ctx.runSpeed().catch(() => {});
  };
  ref.speedBtn.addEventListener('click', speedToggle);
  ref.ratesRun.addEventListener('click', speedToggle);

  /* ---------------------------------------------------------------- subscriptions */

  const on = (key, fn) => cleanups.push(store.on(key, fn));
  on('scan', (scan) => {
    renderStatus();
    renderVerdict();
    renderDoors();
    renderRouter();
    renderAttach();
    applyHero();
    if (scan && scan !== lastScanSeen) heroCall('pulse');
    lastScanSeen = scan;
  });
  on('scanProgress', () => {
    renderStatus();
    renderVerdict();
    renderRouter();
    renderDoors();
  });
  on('speed', () => { renderRates(); renderSpeed(); });
  on('speedProgress', () => { renderRates(); renderSpeed(); });
  on('devices', renderDevices);
  on('wifi', () => { renderRouter(); renderSpeed(); applyHero(); });
  on('survey', renderSurveyHint);
  on('overview', renderRouter);
  on('dns', renderRouter);
  on('providers', () => { renderAgent(); applyHero(); });
  on('watch', () => { renderPower(); renderStatus(); renderTimer(); applyHero(); });

  renderPower();
  renderTimer();
  renderStatus();
  renderVerdict();
  renderRates();
  renderRouter();
  renderDoors();
  renderSpeed();
  renderDevices();
  renderAgent();
  renderAttach();

  return {
    unmount() {
      disposed = true;
      typeTok += 1;
      for (const fn of cleanups) {
        try { fn(); } catch (err) { console.warn(err); }
      }
      if (hero) {
        try { hero.dispose(); } catch (err) { console.warn(err); }
        hero = null;
      }
    },
  };
}
