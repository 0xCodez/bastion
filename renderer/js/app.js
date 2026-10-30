// Bastion renderer entry: app shell, in-memory routing, shared ctx, toasts, live watch loop.

import api, { isMock } from './api.js';
import { store } from './store.js';

const VIEWS = [
  { id: 'home', label: 'Home', icon: '<path d="M3.5 10.5L12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-6h4v6"/>' },
  { id: 'shield', label: 'Shield', icon: '<path d="M12 2.5l8 3.2v5.6c0 5-3.4 9.1-8 10.7-4.6-1.6-8-5.7-8-10.7V5.7z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>' },
  { id: 'speed', label: 'Speed & Wi-Fi', icon: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>' },
  { id: 'devices', label: 'Devices', icon: '<rect x="3" y="4" width="13" height="10" rx="1"/><path d="M7 18h5"/><rect x="17.5" y="9" width="4" height="11" rx="1"/>' },
  { id: 'agents', label: 'Agents', icon: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>' },
  { id: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>' },
];

const $ = (sel, root = document) => root.querySelector(sel);
const errMsg = (err) => String((err && err.message) || err || 'Unknown error');

/* ------------------------------------------------------------------ toasts */

const MAX_TOASTS = 4;

function toast(message, kind = 'info', opts = {}) {
  const host = $('#toasts');
  if (!host || !message) return () => {};
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  const dot = document.createElement('span');
  dot.className = `dot dot--${kind}`;
  const text = document.createElement('div');
  text.textContent = String(message);
  const close = document.createElement('button');
  close.className = 'toast__close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = 'x';
  el.append(dot, text, close);
  host.append(el);

  while (host.children.length > MAX_TOASTS) host.firstElementChild.remove();

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected || el.classList.contains('is-leaving')) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  };
  const ttl = opts.ttl ?? (kind === 'risk' ? 8000 : 4500);
  const arm = () => { if (ttl > 0) timer = setTimeout(dismiss, ttl); };
  close.addEventListener('click', dismiss);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  arm();
  return dismiss;
}

/* ------------------------------------------------------------------ data loading */

const ARRAY_KEYS = new Set(['devices', 'connections', 'providers']);
const loaders = {
  overview: () => api.network.overview(),
  wifi: () => api.wifi.info(),
  survey: () => api.wifi.survey(),
  dns: () => api.dns.status(),
  devices: () => api.network.devices(),
  connections: () => api.network.connections(),
  providers: () => api.agents.providers(),
};
const lastLoaded = {};
const inflight = {};

// Store convention: undefined = not loaded yet, null = load failed (unknown), otherwise data.
function load(key) {
  if (inflight[key]) return inflight[key];
  inflight[key] = (async () => {
    try {
      let value = await loaders[key]();
      if (ARRAY_KEYS.has(key) && !Array.isArray(value)) {
        console.warn(`[bastion] ${key} returned no list`, value);
        value = null;
      }
      store.set(key, value);
      lastLoaded[key] = Date.now();
      return value;
    } catch (err) {
      console.warn(`[bastion] loading ${key} failed`, err);
      if (store.get(key) === undefined) store.set(key, null);
      return null;
    } finally {
      delete inflight[key];
    }
  })();
  return inflight[key];
}

function refresh(keys = Object.keys(loaders)) {
  return Promise.all(keys.filter((k) => loaders[k]).map(load)).then(() => undefined);
}

/* ------------------------------------------------------------------ scan + speed */

let scanPromise = null;

// opts (for example { depth }) is forwarded to the engine; main.js currently ignores it.
function runScan(opts) {
  if (scanPromise) return scanPromise;
  store.set('scanProgress', { running: true, index: 0, total: 0, id: null, title: 'Starting scan', seen: {}, startedAt: Date.now() });
  scanPromise = (async () => {
    try {
      const report = opts ? await api.network.scan(opts) : await api.network.scan();
      // An empty check list means the engine failed (guard() fallback), never "all clear".
      if (!report || !Array.isArray(report.checks) || report.checks.length === 0) {
        throw new Error((report && (report.error || (report.errors || [])[0])) || 'The scan returned no results.');
      }
      store.patch('scanProgress', { running: false, finishedAt: Date.now() });
      store.set('scan', report);
      const risks = report.checks.filter((c) => c.status === 'risk').length;
      if (risks) toast(`Scan finished: ${risks} open ${risks === 1 ? 'door' : 'doors'} found.`, 'risk');
      else toast('Scan finished: no open doors found.', 'ok');
      return report;
    } catch (err) {
      store.patch('scanProgress', { running: false, finishedAt: Date.now(), error: errMsg(err) });
      toast(`Scan failed: ${errMsg(err)}`, 'risk');
      throw err;
    } finally {
      scanPromise = null;
    }
  })();
  return scanPromise;
}

let speedPromise = null;

function runSpeed() {
  if (speedPromise) return speedPromise;
  store.set('speedProgress', { running: true, phase: 'ping', progress: 0, pingMs: null, mbps: null, downMbps: null, upMbps: null });
  speedPromise = (async () => {
    try {
      let result = await api.speed.run();
      if (!result || typeof result.downMbps !== 'number') {
        throw new Error((result && (result.error || (result.errors || [])[0])) || 'The speed test returned no result.');
      }
      const errs = Array.isArray(result.errors) ? result.errors : [];
      const cancelled = errs.some((e) => /cancel/i.test(e));
      // engine/speed.js reports unmeasured values as 0. No latency means nothing was measured
      // (server unreachable, or another test already running): that is a failure, not a 0 Mbps result.
      if (!cancelled && !(result.pingMs > 0)) {
        throw new Error(errs[0] || 'The speed test returned no result.');
      }
      store.patch('speedProgress', { running: false, phase: 'done', progress: 1 });
      if (cancelled) {
        toast('Speed test cancelled.', 'info');
      } else {
        const aborted = errs.some((e) => /^Speed test failed/i.test(e));
        const unmeasured = (re, v) => errs.some((e) => re.test(e)) || (aborted && !(v > 0));
        result = {
          ...result,
          downMbps: unmeasured(/^Download was not measured/i, result.downMbps) ? null : result.downMbps,
          upMbps: unmeasured(/^Upload was not measured/i, result.upMbps) ? null : result.upMbps,
        };
        store.set('speed', result);
        if (result.errors && result.errors.length) toast(`Speed test finished with problems: ${result.errors[0]}`, 'warn');
        else toast(`Speed test: ${fmtMbps(result.downMbps)} down, ${fmtMbps(result.upMbps)} up.`, 'ok');
      }
      return result;
    } catch (err) {
      store.patch('speedProgress', { running: false, phase: 'done', error: errMsg(err) });
      toast(`Speed test failed: ${errMsg(err)}`, 'risk');
      throw err;
    } finally {
      speedPromise = null;
    }
  })();
  return speedPromise;
}

function fmtMbps(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} Mbps`;
}

function wireProgressEvents() {
  api.network.onScanProgress((p) => {
    if (!p) return;
    const prev = store.get('scanProgress') || {};
    const seen = { ...(prev.seen || {}), [p.id]: p.status || 'checking' };
    store.set('scanProgress', { ...prev, ...p, running: true, seen });
  });
  api.speed.onProgress((p) => {
    if (!p) return;
    const prev = store.get('speedProgress') || {};
    const next = { ...prev, ...p, running: p.phase !== 'done' ? true : prev.running };
    if (p.phase === 'download' && typeof p.mbps === 'number') next.downMbps = p.mbps;
    if (p.phase === 'upload' && typeof p.mbps === 'number') next.upMbps = p.mbps;
    store.set('speedProgress', next);
  });
}

/* ------------------------------------------------------------------ agent snapshot */

// Compact, JSON-serialisable picture of what the app knows. Sent to AI providers with every question.
function snapshot() {
  const ov = store.get('overview');
  const scan = store.get('scan');
  const wifi = store.get('wifi');
  const survey = store.get('survey');
  const dns = store.get('dns');
  const speed = store.get('speed');
  const devices = store.get('devices');
  const connections = store.get('connections');

  const byRemote = new Map();
  if (Array.isArray(connections)) {
    for (const c of connections) {
      const k = `${c.process || 'unknown'}|${c.remoteIp}|${c.remotePort}|${c.protocol}`;
      const row = byRemote.get(k) || { process: c.process || null, remoteIp: c.remoteIp, remotePort: c.remotePort, protocol: c.protocol, count: 0 };
      row.count += 1;
      byRemote.set(k, row);
    }
  }

  return {
    takenAt: new Date().toISOString(),
    platform: api.platform,
    sampleData: isMock,
    overview: ov ? { hostname: ov.hostname, local: ov.local, gateway: ov.gateway, publicIp: ov.publicIp } : null,
    scan: scan ? {
      finishedAt: scan.finishedAt,
      score: scan.score,
      checks: (scan.checks || []).map((c) => ({ id: c.id, title: c.title, status: c.status, severity: c.severity, evidence: c.evidence, fix: c.fix ? c.fix.label : null })),
      upnpMappings: scan.upnpMappings || [],
      openPorts: scan.openPorts || [],
    } : null,
    wifi: wifi && wifi.supported !== false ? {
      ssid: wifi.ssid, band: wifi.band, channel: wifi.channel, widthMHz: wifi.widthMHz, rssi: wifi.rssi,
      signalPct: wifi.signalPct, rxMbps: wifi.rxMbps, txMbps: wifi.txMbps, security: wifi.security, nomap: wifi.nomap,
    } : (wifi ? { supported: false } : null),
    survey: survey && survey.supported !== false ? {
      current: survey.current,
      recommendation: survey.recommendation,
      networksInRange: (survey.networks || []).length,
      congestion: (survey.congestion || []).slice(0, 12),
    } : null,
    dns: dns ? { servers: dns.servers, provider: dns.provider, encrypted: dns.encrypted, gatewayIsResolver: dns.gatewayIsResolver } : null,
    speed: speed ? { downMbps: speed.downMbps, upMbps: speed.upMbps, pingMs: speed.pingMs, jitterMs: speed.jitterMs, server: speed.server, at: speed.at } : null,
    devices: Array.isArray(devices) ? {
      count: devices.length,
      list: devices.slice(0, 80).map((d) => ({
        ip: d.ip, mac: d.mac, vendor: d.vendor, hostname: d.hostname,
        randomizedMac: d.randomizedMac, isGateway: d.isGateway, isThisComputer: d.isThisComputer,
      })),
    } : null,
    connections: Array.isArray(connections) ? {
      count: connections.length,
      top: [...byRemote.values()].sort((a, b) => b.count - a.count).slice(0, 40),
    } : null,
  };
}

/* ------------------------------------------------------------------ routing */

const viewCache = new Map();
let current = null; // { id, el, instance }
let navToken = 0;

function navigate(id) {
  const def = VIEWS.find((v) => v.id === id);
  if (!def || (current && current.id === id)) return;
  const token = ++navToken;

  for (const btn of document.querySelectorAll('.tabbar__item')) {
    if (btn.dataset.view === id) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  moveThumb();
  document.title = id === 'home' ? 'Bastion' : `${def.label} - Bastion`;

  const stage = $('#stage');
  const el = document.createElement('section');
  el.className = 'view';
  el.dataset.view = id;
  el.setAttribute('aria-label', def.label);
  stage.append(el);

  const prev = current;
  current = { id, el, instance: null };

  if (prev) {
    prev.el.classList.remove('is-in');
    prev.el.classList.add('is-out');
    setTimeout(() => {
      try { prev.instance && prev.instance.unmount && prev.instance.unmount(); } catch (err) { console.error(err); }
      prev.el.remove();
    }, 380);
  }

  loadView(id).then((mod) => {
    if (token !== navToken) return;
    try {
      current.instance = mod.mount(el, ctx) || null;
    } catch (err) {
      console.error(`[bastion] mount ${id} failed`, err);
      renderViewError(el, def, err);
    }
  }).catch((err) => {
    if (token !== navToken) return;
    console.error(`[bastion] loading view ${id} failed`, err);
    renderViewError(el, def, err);
  }).finally(() => {
    if (token !== navToken) return;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
  });
}

function loadView(id) {
  if (!viewCache.has(id)) {
    const p = import(`./views/${id}.js`);
    p.catch(() => viewCache.delete(id));
    viewCache.set(id, p);
  }
  return viewCache.get(id);
}

function renderViewError(el, def, err) {
  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'view-pad';
  wrap.innerHTML = `<div class="empty-state"><span class="empty-state__title"></span><p></p></div>`;
  wrap.querySelector('.empty-state__title').textContent = `${def.label} could not open`;
  wrap.querySelector('p').textContent = errMsg(err);
  el.append(wrap);
}

/* ------------------------------------------------------------------ shell */

// Floating pill tab bar centred in the title bar. Every tab carries data-view="<id>".
function buildRail() {
  const nav = $('#railNav');
  nav.innerHTML = '';
  const mod = api.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  VIEWS.forEach((v, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tabbar__item';
    btn.dataset.view = v.id;
    btn.setAttribute('aria-label', v.label);
    btn.title = `${v.label} (${mod}+${i + 1})`;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${v.icon}</svg>`
      + '<span class="tabbar__label" aria-hidden="true"></span><span class="tabbar__badge" hidden></span>';
    btn.querySelector('.tabbar__label').textContent = v.label;
    btn.addEventListener('click', () => navigate(v.id));
    nav.append(btn);
  });
  const brand = $('#brand');
  if (brand) brand.title = `Bastion v${api.version}`;
  const keys = $('#keysBtn');
  if (keys) keys.addEventListener('click', () => navigate('settings'));

  // Keep the glass thumb under the active tab when the bar reflows (resize, fonts, badge).
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => moveThumb(true)).observe(nav);
  else window.addEventListener('resize', () => moveThumb(true));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveThumb(true));
}

let thumbReady = false;

function moveThumb(instant = false) {
  const thumb = $('#tabThumb');
  const active = document.querySelector('.tabbar__item[aria-current="page"]');
  if (!thumb) return;
  if (!active || !active.offsetWidth) {
    thumb.style.opacity = '0';
    return;
  }
  const bar = $('#tabbar');
  if (instant || !thumbReady) bar.classList.add('is-instant');
  thumb.style.opacity = '1';
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  if (instant || !thumbReady) {
    void thumb.offsetWidth;
    requestAnimationFrame(() => bar.classList.remove('is-instant'));
    thumbReady = true;
  }
}

function openDoors() {
  const scan = store.get('scan');
  return scan && Array.isArray(scan.checks) ? scan.checks.filter((c) => c.status === 'risk').length : 0;
}

function updateRailStatus() {
  const dot = $('#railDot');
  const text = $('#railLiveText');
  const live = $('#railLive');
  const ov = store.get('overview');
  const sp = store.get('scanProgress');
  const risks = openDoors();
  let kind = 'ok';
  let label = 'Watching';
  if (!navigator.onLine) {
    kind = 'risk';
    label = 'Offline';
  } else if (sp && sp.running) {
    kind = 'info';
    label = sp.total ? `Scanning ${Math.min(sp.index + 1, sp.total)}/${sp.total}` : 'Scanning';
  } else if (risks) {
    kind = 'risk';
    label = `${risks} ${risks === 1 ? 'door' : 'doors'} open`;
  } else if (ov === null || (ov && !ov.gateway?.ip)) {
    kind = 'warn';
    label = 'No router found';
  } else if (ov === undefined) {
    kind = 'info';
    label = 'Connecting';
  }
  dot.className = `dot dot--${kind} blink`;
  live.className = `live live--${kind}`;
  text.textContent = label;
  // Addresses are shown by the pill's hover/focus card (CSS ::after) and read via aria-label.
  const addr = addressParts();
  if (addr.length) live.dataset.addr = addr.join('\n');
  else delete live.dataset.addr;
  live.setAttribute('aria-label', ['Network status: ' + label, ...addr].join('. '));
  // Announce state changes only, never the per-step scan counter.
  const announce = $('#railAnnounce');
  const spoken = sp && sp.running && navigator.onLine ? 'Scanning' : label;
  if (announce && announce.textContent !== spoken) announce.textContent = spoken;

  const btn = document.querySelector('.tabbar__item[data-view="shield"]');
  const badge = btn && btn.querySelector('.tabbar__badge');
  if (badge) {
    const was = badge.hidden;
    badge.hidden = !risks;
    badge.textContent = String(risks);
    btn.setAttribute('aria-label', risks ? `Shield, ${risks} open ${risks === 1 ? 'door' : 'doors'}` : 'Shield');
    if (was !== badge.hidden) moveThumb(true);
  }
}

function addressParts() {
  const ov = store.get('overview');
  const parts = [];
  if (ov && ov.gateway && ov.gateway.ip) parts.push(`Router ${ov.gateway.ip}`);
  if (ov && ov.local && ov.local.ip) parts.push(`This computer ${ov.local.ip}`);
  if (ov && ov.publicIp) parts.push(`Public ${ov.publicIp}`);
  return parts;
}

function updateTitleStatus() {
  const badge = $('#sampleBadge');
  if (badge) badge.hidden = !isMock;
  updateRailStatus();
}

// Three dots, one per AI provider, lit in the provider colour when a key is stored.
function updateKeys() {
  const btn = $('#keysBtn');
  if (!btn) return;
  const list = store.get('providers');
  const byId = new Map(Array.isArray(list) ? list.map((p) => [p.id, p]) : []);
  let n = 0;
  for (const i of btn.querySelectorAll('[data-prov]')) {
    const p = byId.get(i.dataset.prov);
    const on = !!(p && p.hasKey);
    if (on) n += 1;
    i.classList.toggle('is-on', on);
  }
  const text = $('#keysText');
  let label;
  if (list === undefined) label = 'Keys';
  else if (!Array.isArray(list)) label = 'Keys unknown';
  else label = n ? `${n} ${n === 1 ? 'key' : 'keys'}` : 'No keys';
  text.textContent = label;
  const names = Array.isArray(list) ? list.filter((p) => p.hasKey).map((p) => p.name) : [];
  const desc = names.length ? `AI keys stored: ${names.join(', ')}` : (Array.isArray(list) ? 'No AI keys stored yet' : 'AI keys');
  btn.title = `${desc}. Open Settings to manage them.`;
  btn.setAttribute('aria-label', `${desc}. Open Settings`);
}

function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const m = /^Digit([1-6])$/.exec(e.code) || /^([1-6])$/.exec(e.key);
    if (!m) return;
    e.preventDefault();
    navigate(VIEWS[Number(m[1]) - 1].id);
  });
}

// Keeps the live picture fresh while the window is visible. Intervals are per data source.
const WATCH_MS = { wifi: 15000, connections: 20000, devices: 90000, overview: 120000, dns: 120000, survey: 300000 };

function startWatch() {
  setInterval(() => {
    if (document.hidden) return;
    const watch = store.get('watch');
    if (watch && watch.on === false) return;
    const now = Date.now();
    for (const [key, ms] of Object.entries(WATCH_MS)) {
      if (lastLoaded[key] && now - lastLoaded[key] >= ms) load(key);
    }
  }, 5000);
  window.addEventListener('online', () => { updateRailStatus(); refresh(['overview', 'wifi', 'dns']); });
  window.addEventListener('offline', updateRailStatus);
}

/* ------------------------------------------------------------------ boot */

const ctx = {
  api,
  store,
  isMock,
  navigate,
  toast,
  runScan,
  runSpeed,
  refresh,
  snapshot,
};

function boot() {
  store.set('agentLog', []);
  buildRail();
  wireKeyboard();
  wireProgressEvents();

  ['overview', 'scanProgress', 'scan'].forEach((k) => store.on(k, updateRailStatus));
  store.on('providers', updateKeys);
  updateTitleStatus();
  updateKeys();

  navigate('home');

  refresh();
  load('overview').then(() => {
    runScan().catch(() => {});
  });
  startWatch();

  if (isMock) {
    toast('Browser preview: all data is sample data. Run the desktop app to see your real network.', 'warn', { ttl: 7000 });
  }
}

try {
  boot();
} catch (err) {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'boot-error';
  box.innerHTML = '<p class="eyebrow">Bastion could not start</p><pre></pre>';
  box.querySelector('pre').textContent = String((err && err.stack) || err);
  ($('#stage') || document.body).append(box);
}
