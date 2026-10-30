// Agents view: chat with Claude / ChatGPT / Grok using the user's own keys, plus watch mode.
// Watch mode lives at module level so it keeps running while the user is on other views,
// and stops when the app window closes. Agents only answer; they never take actions.
import { readPrefs, writePrefs, PREFS_EVENT } from './settings.js';

const LOG_KEY = 'bastion.agentLog';
const PROVIDER_KEY = 'bastion.agentProvider';
const LOG_MAX = 300;
// kind 'cli': the user's own Claude / ChatGPT subscription through Claude Code / Codex
// (shown only when installed, first when ready). `icon` picks the provider app icon.
const PROVIDERS = [
  { id: 'claude-cli', name: 'Claude (my subscription)', tab: 'Claude', tag: 'plan', dot: 'var(--clay)', icon: 'claude', kind: 'cli', via: 'Claude Code', login: 'claude auth login' },
  { id: 'codex-cli', name: 'ChatGPT (my subscription)', tab: 'ChatGPT', tag: 'plan', dot: 'var(--mint)', icon: 'openai', kind: 'cli', via: 'Codex', login: 'codex login' },
  { id: 'claude', name: 'Claude', dot: 'var(--clay)' },
  { id: 'openai', name: 'ChatGPT', dot: 'var(--mint)' },
  { id: 'grok', name: 'Grok', dot: 'var(--sky)' },
];
const isCliId = (id) => PROVIDERS.some((p) => p.id === id && p.kind === 'cli');

// Why a provider cannot answer yet, in plain words.
function notReadyText(id, info) {
  const p = meta(id);
  if (p.kind !== 'cli') return 'No ' + p.name + ' key saved. Add one in Settings.';
  const c = (info && info.cli) || {};
  if (!c.installed) return p.via + ' is not installed on this computer. Settings shows how to install it.';
  return p.via + ' is not signed in. Run `' + p.login + '` in a terminal, then try again.';
}
const QUICK = ['What should I fix first?', 'Is anything on my network suspicious?', 'Why is my Wi-Fi slow?'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function errText(err) {
  return String((err && err.message) || err || 'Unknown error');
}

// Escapes everything, then allows **bold** and `code` only.
function richText(s) {
  return esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

function clock(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function meta(id) {
  return PROVIDERS.find((p) => p.id === id) || { id, name: id, dot: 'var(--muted)' };
}

// Provider app icon from the user's installed apps (store key 'providerIcons', loaded by app.js),
// or a monogram tile in the provider colour when there is none.
const LOGO_RE = /^data:image\/(png|jpeg|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/;
function logoMark(store, id, size) {
  const m = store.get('providerIcons');
  const v = m && typeof m === 'object' ? m[meta(id).icon || id] : null;
  if (typeof v === 'string' && LOGO_RE.test(v)) {
    return `<span class="ag-logo ag-logo--${size}" aria-hidden="true"><img src="${esc(v)}" alt="" draggable="false"></span>`;
  }
  const p = meta(id);
  return `<span class="ag-logo ag-logo--${size} ag-logo--mono" style="--prov:${p.dot}" aria-hidden="true">${esc(String(p.name).charAt(0))}</span>`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Upgrades gk-* markup; hands back the kit's cleanup so the view can release its observers.
function upgradeGlow(el, onCleanup) {
  import('../glow-kit.js')
    .then((m) => {
      if (!m || typeof m.initGlowKit !== 'function') return;
      const cleanup = m.initGlowKit(el);
      if (typeof cleanup === 'function') onCleanup(cleanup);
    })
    .catch(() => {});
}

// ---------- shared log ----------
let logLoaded = false;

// The shell starts the store with an empty log; the first read merges in what was saved on disk.
function getLog(store) {
  const v = store.get('agentLog');
  const current = Array.isArray(v) ? v : [];
  if (logLoaded) return current;
  logLoaded = true;
  let saved = [];
  try {
    const arr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    if (Array.isArray(arr)) saved = arr.filter((m) => m && typeof m.text === 'string' && m.provider);
  } catch {
    saved = [];
  }
  const ids = new Set(current.map((m) => m.id));
  const merged = saved.filter((m) => !ids.has(m.id)).concat(current).slice(-LOG_MAX);
  store.set('agentLog', merged);
  return merged;
}

function saveLog(log) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
  } catch {
    // Storage unavailable: history stays for this session only.
  }
}

function pushLog(store, m) {
  const next = getLog(store).concat([{ id: uid(), at: Date.now(), ...m }]).slice(-LOG_MAX);
  store.set('agentLog', next);
  saveLog(next);
}

// ---------- module state (survives unmount) ----------
const pending = new Map(); // provider id -> question
const listeners = new Set();
let selected = (() => {
  try {
    const v = localStorage.getItem(PROVIDER_KEY);
    return PROVIDERS.some((p) => p.id === v) ? v : 'claude';
  } catch {
    return 'claude';
  }
})();

const watch = { on: false, timer: 0, nextAt: 0, lastAt: 0, running: false, ctx: null, prev: null, prefsHooked: false };
const WATCH_RETRY_MS = 60000;

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch { /* a stale view must not break others */ }
  }
}

function providerInfo(store, id) {
  const list = store.get('providers');
  return Array.isArray(list) ? list.find((p) => p.id === id) || null : null;
}

// Resolves to 'empty', 'busy' (this provider is already answering) or 'done'.
async function ask(ctx, providerId, question, opts) {
  const q = String(question || '').trim();
  if (!q) return 'empty';
  if (pending.has(providerId)) return 'busy';
  const watchRun = !!(opts && opts.watch);
  if (!(opts && opts.silentQuestion)) pushLog(ctx.store, { provider: providerId, role: 'me', text: q });
  pending.set(providerId, q);
  notify();
  let snapshot = null;
  try {
    snapshot = ctx.snapshot();
  } catch {
    snapshot = null;
  }
  try {
    const r = await ctx.api.agents.ask(providerId, q, snapshot);
    if (r && r.ok && r.text) {
      pushLog(ctx.store, { provider: providerId, role: 'agent', text: String(r.text), model: r.model || null, watch: watchRun });
    } else {
      const msg = (r && r.error) || (r && r.ok && !r.text ? 'The model returned an empty answer.' : 'No answer.');
      pushLog(ctx.store, { provider: providerId, role: 'error', text: msg, model: (r && r.model) || null, watch: watchRun });
    }
  } catch (err) {
    pushLog(ctx.store, { provider: providerId, role: 'error', text: errText(err), watch: watchRun });
  } finally {
    pending.delete(providerId);
    notify();
  }
  return 'done';
}

// ---------- watch mode ----------
function capture(store) {
  const out = { at: Date.now(), devices: new Map(), checks: new Map(), wifi: null, publicIp: null, dns: null, down: null };
  const devs = store.get('devices');
  if (Array.isArray(devs)) {
    for (const d of devs) out.devices.set(d.mac || d.ip, d.hostname || d.vendor || d.ip || 'unknown device');
  } else {
    out.devices = null;
  }
  const scan = store.get('scan');
  if (scan && Array.isArray(scan.checks)) for (const c of scan.checks) out.checks.set(c.id, { status: c.status, title: c.title });
  const wifi = store.get('wifi');
  if (wifi && wifi.supported) out.wifi = { ssid: wifi.ssid, channel: wifi.channel, signalPct: wifi.signalPct };
  const ov = store.get('overview');
  if (ov) out.publicIp = ov.publicIp || null;
  const dns = store.get('dns');
  if (dns && Array.isArray(dns.servers)) out.dns = { provider: dns.provider, encrypted: dns.encrypted, servers: dns.servers.join(', ') };
  return out;
}

// Returns [{ level: 'risk'|'warn'|'info', text }]
function diff(a, b) {
  const items = [];
  if (a.devices && b.devices) {
    for (const [k, name] of b.devices) if (!a.devices.has(k)) items.push({ level: 'warn', text: 'New device: ' + name + ' (' + k + ')' });
    for (const [k, name] of a.devices) if (!b.devices.has(k)) items.push({ level: 'info', text: 'Device no longer seen: ' + name + ' (' + k + ')' });
  }
  for (const [id, c] of b.checks) {
    const before = a.checks.get(id);
    if (before && before.status !== c.status) {
      items.push({ level: c.status === 'risk' ? 'risk' : c.status === 'warn' ? 'warn' : 'info', text: 'Check "' + (c.title || id) + '" changed from ' + before.status + ' to ' + c.status });
    }
  }
  if (a.wifi && b.wifi) {
    if (a.wifi.ssid !== b.wifi.ssid) items.push({ level: 'warn', text: 'Wi-Fi network changed from ' + (a.wifi.ssid || 'unknown') + ' to ' + (b.wifi.ssid || 'unknown') });
    else if (a.wifi.channel !== b.wifi.channel) items.push({ level: 'info', text: 'Wi-Fi channel changed from ' + a.wifi.channel + ' to ' + b.wifi.channel });
    if (typeof a.wifi.signalPct === 'number' && typeof b.wifi.signalPct === 'number' && Math.abs(a.wifi.signalPct - b.wifi.signalPct) >= 20) {
      items.push({ level: 'info', text: 'Wi-Fi signal moved from ' + a.wifi.signalPct + '% to ' + b.wifi.signalPct + '%' });
    }
  }
  if (a.publicIp && b.publicIp && a.publicIp !== b.publicIp) items.push({ level: 'info', text: 'Public IP changed from ' + a.publicIp + ' to ' + b.publicIp });
  if (a.dns && b.dns && (a.dns.servers !== b.dns.servers || a.dns.encrypted !== b.dns.encrypted)) {
    items.push({ level: 'warn', text: 'DNS changed from ' + (a.dns.servers || 'unknown') + ' to ' + (b.dns.servers || 'unknown') + (b.dns.encrypted === false ? ' (not encrypted)' : '') });
  }
  return items;
}

function filterBySensitivity(items, sens) {
  if (sens === 'low') return items.filter((i) => i.level === 'risk');
  if (sens === 'normal') return items.filter((i) => i.level !== 'info');
  return items;
}

function schedule(delayMs) {
  if (watch.timer) { clearTimeout(watch.timer); watch.timer = 0; }
  if (!watch.on) { watch.nextAt = 0; return; }
  const ms = delayMs || readPrefs().watchMinutes * 60000;
  watch.nextAt = Date.now() + ms;
  watch.timer = setTimeout(watchTick, ms);
}

async function watchTick() {
  watch.timer = 0;
  const ctx = watch.ctx;
  if (!watch.on || !ctx || watch.running) return;
  const providerId = selected;
  const sens = readPrefs().alertSensitivity;
  let retryMs = 0;
  watch.running = true;
  notify();
  try {
    const before = watch.prev || capture(ctx.store);
    try {
      await ctx.refresh();
    } catch (err) {
      pushLog(ctx.store, { provider: providerId, role: 'error', text: 'Watch check could not refresh the network: ' + errText(err), watch: true });
    }
    const after = capture(ctx.store);
    watch.prev = after;
    const all = diff(before, after);
    const items = filterBySensitivity(all, sens);
    const since = clock(before.at);
    if (!items.length) {
      pushLog(ctx.store, {
        provider: providerId, role: 'sys', watch: true,
        text: 'Watch check: nothing ' + (all.length ? 'above your alert sensitivity ' : '') + 'changed since ' + since + '. Agent not asked.',
      });
      return;
    }
    const info = providerInfo(ctx.store, providerId);
    pushLog(ctx.store, { provider: providerId, role: 'sys', watch: true, text: 'Watch check found ' + items.length + ' change' + (items.length === 1 ? '' : 's') + ' since ' + since + ':\n' + items.map((i) => '- ' + i.text).join('\n') });
    if (pending.has(providerId)) {
      // Keep the old baseline so the retry reports these changes instead of losing them.
      watch.prev = before;
      retryMs = WATCH_RETRY_MS;
      pushLog(ctx.store, { provider: providerId, role: 'sys', watch: true, text: meta(providerId).name + ' is still answering another question, so these changes were not sent yet. Bastion will check again in a minute.' });
      return;
    }
    if (info && !info.hasKey) {
      pushLog(ctx.store, { provider: providerId, role: 'error', watch: true, text: 'The agent was not asked. ' + notReadyText(providerId, info) });
      return;
    }
    const q = 'Watch mode check. Bastion refreshed my network and found these changes since ' + since + ':\n' +
      items.map((i) => '- ' + i.text).join('\n') +
      '\nUsing the attached snapshot, tell me in at most four short sentences what changed and whether any of it needs my attention. ' +
      'You cannot take actions; only suggest what I could do. If none of it matters, say so in one sentence.';
    if ((await ask(ctx, providerId, q, { watch: true, silentQuestion: true })) === 'busy') {
      watch.prev = before;
      retryMs = WATCH_RETRY_MS;
    }
  } finally {
    watch.running = false;
    watch.lastAt = Date.now();
    schedule(retryMs);
    notify();
  }
}

function setWatch(ctx, on) {
  watch.ctx = ctx;
  watch.on = !!on;
  if (watch.on) {
    watch.prev = capture(ctx.store);
    pushLog(ctx.store, { provider: selected, role: 'sys', watch: true, text: 'Watch mode on. Every ' + readPrefs().watchMinutes + ' minutes Bastion refreshes the network and asks ' + meta(selected).name + ' about anything that changed. Only while Bastion is open.' });
  } else {
    watch.prev = null;
    pushLog(ctx.store, { provider: selected, role: 'sys', watch: true, text: 'Watch mode off.' });
  }
  schedule();
  notify();
}

function hookPrefs() {
  if (watch.prefsHooked) return;
  watch.prefsHooked = true;
  let lastMinutes = readPrefs().watchMinutes;
  window.addEventListener(PREFS_EVENT, () => {
    const m = readPrefs().watchMinutes;
    if (m !== lastMinutes) {
      lastMinutes = m;
      if (watch.on && !watch.running) schedule();
    }
    notify();
  });
}

// ---------- view ----------
export function mount(el, ctx) {
  const { api, store } = ctx;
  const subs = [];
  const timers = new Set();
  let alive = true;
  let glowCleanup = null;
  watch.ctx = ctx;
  hookPrefs();
  getLog(store);

  el.innerHTML = `
    <section class="v-agents view-pad" aria-labelledby="ag-title">
      <header class="ag-head">
        <div>
          <p class="eyebrow">Agents</p>
          <h1 class="h-display" id="ag-title">Ask. Then decide.</h1>
        </div>
        <p class="ag-lede">Claude, ChatGPT and Grok read what Bastion measured and answer in plain words. They suggest; you decide. No agent can change your router or this computer.</p>
      </header>

      <div class="ag-console">
        <div class="ag-card ag-chat nv-glass">
          <div class="ag-card-h">
            <div><h2>Ask your agents</h2><p class="ag-sub">Your own key or subscription, straight to the provider</p></div>
            <div class="gk-segment" role="tablist" aria-label="Agent">
              ${PROVIDERS.map((p) => `<button type="button" role="tab" data-provider="${p.id}" aria-selected="${p.id === selected}"${p.kind === 'cli' ? ` title="${esc(p.name)} via ${esc(p.via)}"${p.id === selected ? '' : ' hidden disabled'}` : ''}><span class="ag-mark" data-mark="${p.id}">${logoMark(store, p.id, 'tab')}</span>${esc(p.tab || p.name)}${p.tag ? `<small class="ag-tab-tag">${esc(p.tag)}</small>` : ''}</button>`).join('')}
            </div>
          </div>
          <div class="ag-status" data-status></div>
          <div class="ag-log" role="log" aria-live="polite" data-log></div>
          <form class="ag-form" data-form autocomplete="off">
            <div class="gk-ring" data-gk="intelligence">
              <div class="ag-ask">
                <div class="ag-aurora" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
                <label class="ag-sr" for="ag-input">Ask the agent about your network</label>
                <input id="ag-input" data-input placeholder="Ask about your router, Wi-Fi or devices" maxlength="2000">
                <button class="btn btn--primary ag-send" type="submit" data-send>Send</button>
              </div>
            </div>
          </form>
          <div class="ag-chips">
            ${QUICK.map((q) => `<button class="ag-chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
          </div>
        </div>

        <aside class="ag-card ag-side nv-glass" aria-label="Watch mode">
          <div class="ag-watch">
            <div class="ag-watch-h">
              <div>
                <p class="ag-k">Watch mode</p>
                <p class="ag-watch-state" data-watch-state></p>
              </div>
              <button class="gk-toggle" type="button" role="switch" aria-checked="${watch.on}" aria-label="Watch mode" data-watch></button>
            </div>
            <label class="gk-slider" data-ticks="12"><span>Check every</span><input type="range" min="5" max="60" step="5" data-interval></label>
            <output class="ag-out" data-interval-out></output>
            <p class="ag-fine">Each check refreshes devices, Wi-Fi, DNS and connections, compares them with the previous check, and asks the selected agent only when something changed above your alert sensitivity (<span data-sens></span>). Runs only while Bastion is open and turns off when you quit.</p>
          </div>
          <div class="ag-rules">
            <p class="ag-k">Rules</p>
            <ul>
              <li>Agents can read the snapshot below and answer. They cannot run commands, change settings or touch your router.</li>
              <li>Every fix stays a guided step you do yourself.</li>
              <li>Requests go straight from this computer to the provider with your own key, or through your own Claude Code or Codex login.</li>
            </ul>
          </div>
          <details class="ag-snap" data-snap-details>
            <summary>What the agent sees</summary>
            <pre class="ag-pre" data-snap></pre>
          </details>
          <button class="ag-link" type="button" data-clear>Clear this conversation</button>
        </aside>
      </div>
    </section>`;

  const $ = (sel) => el.querySelector(sel);
  const logEl = $('[data-log]');
  const input = $('[data-input]');
  const sendBtn = $('[data-send]');
  const intervalIn = $('[data-interval]');

  // Store convention: undefined = not loaded yet, null = load failed. provErr keeps this view's own error text.
  let provLoading = false;
  let provErr = '';
  function ensureProviders() {
    if (Array.isArray(store.get('providers')) || provLoading) return;
    provLoading = true;
    provErr = '';
    renderStatus();
    Promise.resolve(api.agents.providers())
      .then((list) => {
        if (!alive) return;
        if (Array.isArray(list)) store.set('providers', list);
        else provErr = (list && list.error) || 'Unexpected answer from the key store.';
      })
      .catch((err) => { if (alive) provErr = errText(err); })
      .finally(() => {
        provLoading = false;
        if (alive) { renderStatus(); renderLog(); }
      });
  }

  function renderStatus() {
    const info = providerInfo(store, selected);
    const m = meta(selected);
    const box = $('[data-status]');
    const provs = store.get('providers');
    if (!Array.isArray(provs) && (provLoading || (provs === undefined && !provErr))) {
      box.innerHTML = `<span class="ag-k">${logoMark(store, selected, 'status')}${esc(m.name)}</span><span class="ag-dim">Checking your keys</span>`;
    } else if (!Array.isArray(provs)) {
      box.innerHTML = `<span class="ag-k">${logoMark(store, selected, 'status')}${esc(m.name)}</span><span class="pill pill--warn">Unknown</span><span class="ag-dim">Could not check your saved keys${provErr ? ': ' + esc(provErr) : '.'}</span><button class="ag-link" type="button" data-retry-providers>Retry</button>`;
    } else if (!info || !info.hasKey) {
      const cliInfo = (info && info.cli) || {};
      box.innerHTML = m.kind === 'cli'
        ? `<span class="ag-k">${logoMark(store, selected, 'status')}${esc(m.name)}</span><span class="pill pill--warn">${cliInfo.installed ? 'Not signed in' : 'Not installed'}</span><button class="ag-link" type="button" data-go-settings>Set up in Settings</button>`
        : `<span class="ag-k">${logoMark(store, selected, 'status')}${esc(m.name)}</span><span class="pill">No key</span><button class="ag-link" type="button" data-go-settings>Add a key in Settings</button>`;
    } else if (m.kind === 'cli') {
      const c = info.cli || {};
      const pill = c.ready ? '<span class="pill pill--ok">Subscription</span>'
        : /^api_key/.test(c.authMethod || '') ? '<span class="pill pill--warn" title="Answers are billed to that API key, not to your subscription">API key login</span>'
          : '<span class="pill" title="Bastion could not check the sign-in; the first answer will tell">Sign-in unchecked</span>';
      box.innerHTML = `<span class="ag-k">${logoMark(store, selected, 'status')}${esc(m.name)}</span>${pill}<span class="ag-model">${esc(m.via)}${info.model && info.model !== 'default' ? ' · ' + esc(info.model) : ''}</span>`;
    } else {
      box.innerHTML = `<span class="ag-k">${logoMark(store, selected, 'status')}${esc(m.name)}</span><span class="pill pill--ok">Key saved</span><span class="ag-model">${esc(info.model || 'default model')}</span>`;
    }
    const hasKey = !!(info && info.hasKey);
    const busy = pending.has(selected);
    input.disabled = !hasKey;
    // While this agent answers, the button stops it (agents.cancel).
    sendBtn.disabled = !hasKey;
    sendBtn.textContent = busy ? 'Stop' : 'Send';
    sendBtn.setAttribute('aria-label', busy ? 'Stop ' + m.name + ' (thinking)' : 'Send');
    input.placeholder = hasKey ? 'Ask ' + (m.tab || m.name) + ' about your router, Wi-Fi or devices'
      : m.kind === 'cli' ? 'Set up ' + m.via + ' in Settings to ask' : 'Add a ' + m.name + ' key in Settings to ask';
    el.querySelectorAll('[data-q]').forEach((b) => { b.disabled = !hasKey || busy; });
  }

  // The log is an aria-live region: append only new messages so screen readers do not
  // re-read the whole conversation. The pending indicator is aria-hidden (the Send button says "Thinking").
  let shown = { provider: null, ids: [], emptyHtml: null };
  function renderLog() {
    const m = meta(selected);
    const info = providerInfo(store, selected);
    const msgs = getLog(store).filter((x) => x.provider === selected);
    const busy = pending.has(selected);
    const oldPending = logEl.querySelector('[data-pending]');
    if (oldPending) oldPending.remove();
    if (!msgs.length && !busy) {
      const html = info && info.hasKey
        ? `<div class="ag-empty"><p>Ask ${esc(m.name)} anything about your network. It sees the latest scan, Wi-Fi, DNS, speed and device data, and nothing else.</p></div>`
        : m.kind === 'cli'
          ? `<div class="ag-empty"><p>${esc(notReadyText(selected, info))} Answers then count against your subscription's usage limits.</p><button class="nv-mini nv-mini--go" type="button" data-go-settings>Open Settings</button></div>`
          : `<div class="ag-empty"><p>${esc(m.name)} needs your own API key. Bastion stores it on this computer and sends requests straight to the provider.</p><button class="nv-mini nv-mini--go" type="button" data-go-settings>Open Settings</button></div>`;
      if (shown.provider !== selected || shown.emptyHtml !== html) logEl.innerHTML = html;
      shown = { provider: selected, ids: [], emptyHtml: html };
      return;
    }
    const appendOnly = shown.provider === selected && shown.emptyHtml == null &&
      shown.ids.length <= msgs.length && shown.ids.every((id, i) => msgs[i].id === id);
    const fresh = appendOnly ? msgs.slice(shown.ids.length) : msgs;
    if (!appendOnly) logEl.innerHTML = '';
    if (fresh.length) logEl.insertAdjacentHTML('beforeend', fresh.map(msgHtml).join(''));
    if (busy) {
      logEl.insertAdjacentHTML('beforeend', `<div class="ag-msg ag-msg--pending" data-pending aria-hidden="true"><span class="ag-who"><i style="background:${m.dot}"></i>${esc(m.name)}</span><span class="ag-txt"><span class="ag-dots"><i></i><i></i><i></i></span></span></div>`);
    }
    shown = { provider: selected, ids: msgs.map((x) => x.id), emptyHtml: null };
    if (fresh.length || busy || !appendOnly) logEl.scrollTop = logEl.scrollHeight;
  }

  function msgHtml(x) {
    const m = meta(x.provider);
    if (x.role === 'me') {
      return `<div class="ag-msg ag-msg--me"><span class="ag-who">You · ${esc(clock(x.at))}</span><span class="ag-txt">${esc(x.text)}</span></div>`;
    }
    if (x.role === 'sys') {
      return `<div class="ag-msg ag-msg--sys"><span class="ag-who">Bastion${x.watch ? ' · watch' : ''} · ${esc(clock(x.at))}</span><span class="ag-txt">${esc(x.text)}</span></div>`;
    }
    if (x.role === 'error') {
      return `<div class="ag-msg ag-msg--err"><span class="ag-who"><i style="background:var(--coral)"></i>${esc(m.name)} · error${x.model ? ' · ' + esc(x.model) : ''} · ${esc(clock(x.at))}</span><span class="ag-txt">${esc(x.text)}</span></div>`;
    }
    return `<div class="ag-msg"><span class="ag-who"><i style="background:${m.dot}"></i>${esc(m.name)}${x.model ? ' · ' + esc(x.model) : ''}${x.watch ? ' · watch' : ''} · ${esc(clock(x.at))}</span><span class="ag-txt">${richText(x.text)}</span></div>`;
  }

  function fmtLeft(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function renderWatch() {
    const p = readPrefs();
    intervalIn.value = String(p.watchMinutes);
    intervalIn.setAttribute('aria-valuetext', p.watchMinutes + ' minutes');
    $('[data-interval-out]').textContent = p.watchMinutes + ' min';
    $('[data-sens]').textContent = p.alertSensitivity;
    const stateEl = $('[data-watch-state]');
    if (!watch.on) stateEl.textContent = 'Off';
    else if (watch.running) stateEl.textContent = 'Checking now with ' + meta(selected).name;
    else stateEl.textContent = 'Next check in ' + fmtLeft(watch.nextAt - Date.now()) + ' · ' + meta(selected).name + (watch.lastAt ? ' · last ' + clock(watch.lastAt) : '');
    stateEl.dataset.on = String(watch.on);
  }

  function renderAll() {
    if (!alive) return;
    renderStatus();
    renderLog();
    renderWatch();
  }

  // ---------- events ----------
  // The glow kit's segment switches tabs by click and by Arrow/Home/End (emitting `change`);
  // both paths land here so the highlighted tab is always the provider that gets asked.
  function selectProvider(id) {
    if (!PROVIDERS.some((p) => p.id === id)) return;
    const changed = id !== selected;
    selected = id;
    try { localStorage.setItem(PROVIDER_KEY, selected); } catch { /* ignore */ }
    const t = setTimeout(() => {
      timers.delete(t);
      el.querySelectorAll('[data-provider]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.provider === selected)));
    }, 0);
    timers.add(t);
    if (changed) renderAll();
  }
  el.querySelectorAll('[data-provider]').forEach((b) => {
    b.addEventListener('click', () => selectProvider(b.dataset.provider));
  });

  // Subscription tabs show only when their CLI is installed; ready ones go first, then the
  // API-key providers, then installed-but-signed-out subscriptions. Buttons are moved, not
  // re-created, so the glow kit's segment keeps working.
  let tabOrderKey = '';
  function arrangeTabs() {
    const list = store.get('providers');
    if (!Array.isArray(list)) return;
    const seg = $('[role="tablist"]');
    // Ready (signed in for sure, not with an API key) subscriptions first; usable but
    // unchecked / API-key-login ones after the API-key providers.
    const rank = (p) => {
      if (p.kind !== 'cli') return 1;
      const info = list.find((x) => x && x.id === p.id);
      if (info && info.cli && info.cli.ready) return 0;
      if (info && info.hasKey) return 1.5;
      return info && info.cli && info.cli.installed ? 2 : 3;
    };
    const ordered = PROVIDERS.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i);
    const key = ordered.map((o) => o.p.id + ':' + o.r).join(',');
    if (key === tabOrderKey) return;
    tabOrderKey = key;
    for (const o of ordered) {
      const b = seg.querySelector(`[data-provider="${o.p.id}"]`);
      if (!b) continue;
      const hide = o.r === 3;
      b.hidden = hide;
      b.disabled = hide;
      seg.append(b);
    }
    // A subscription that disappeared (uninstalled) cannot stay selected.
    if (isCliId(selected) && rank(meta(selected)) === 3) selectProvider(ordered[0].p.id);
    else seg.querySelectorAll('[data-provider]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.provider === selected)));
  }
  $('[role="tablist"]').addEventListener('change', (e) => {
    const tab = e.detail && e.detail.tab;
    if (tab && tab.dataset) selectProvider(tab.dataset.provider);
  });

  $('[data-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    if (pending.has(selected)) {
      // Stop button: the pending ask() resolves with "Cancelled." and is logged as an error
      // line. Enter in the field while busy does nothing and keeps the typed question.
      if (e.submitter === sendBtn) Promise.resolve(api.agents.cancel(selected)).catch(() => {});
      return;
    }
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    ask(ctx, selected, q);
  });

  el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-q]');
    if (chip) { ask(ctx, selected, chip.dataset.q); return; }
    if (e.target.closest('[data-go-settings]')) { ctx.navigate('settings'); return; }
    if (e.target.closest('[data-retry-providers]')) { ensureProviders(); return; }
    if (e.target.closest('[data-clear]')) {
      const next = getLog(store).filter((x) => x.provider !== selected);
      store.set('agentLog', next);
      saveLog(next);
    }
  });

  const watchBtn = $('[data-watch]');
  watchBtn.addEventListener('click', () => {
    let next = !watch.on;
    if (next) {
      const info = providerInfo(store, selected);
      if (!info || !info.hasKey) {
        ctx.toast(isCliId(selected) ? notReadyText(selected, info) : 'Add a ' + meta(selected).name + ' key in Settings before turning on watch mode.', 'warn');
        next = false;
      } else {
        setWatch(ctx, true);
      }
    } else {
      setWatch(ctx, false);
    }
    const id = setTimeout(() => { timers.delete(id); watchBtn.setAttribute('aria-checked', String(next)); }, 0);
    timers.add(id);
  });

  intervalIn.addEventListener('input', () => {
    writePrefs({ watchMinutes: Number(intervalIn.value) });
  });

  const snapDetails = $('[data-snap-details]');
  snapDetails.addEventListener('toggle', () => {
    if (!snapDetails.open) return;
    let text = '';
    try {
      const snap = ctx.snapshot();
      if (typeof snap === 'string') {
        try { text = JSON.stringify(JSON.parse(snap), null, 2); } catch { text = snap; }
      } else {
        text = JSON.stringify(snap, null, 2);
      }
    } catch (err) {
      text = 'Snapshot unavailable: ' + errText(err);
    }
    $('[data-snap]').textContent = text || 'Nothing measured yet.';
  });

  const onChange = () => { if (alive) renderAll(); };
  listeners.add(onChange);
  subs.push(store.on('agentLog', () => { if (alive) renderLog(); }));
  subs.push(store.on('providers', () => { if (alive) { arrangeTabs(); renderStatus(); renderLog(); } }));
  subs.push(store.on('providerIcons', () => {
    if (!alive) return;
    el.querySelectorAll('[data-mark]').forEach((x) => { x.innerHTML = logoMark(store, x.dataset.mark, 'tab'); });
    renderStatus();
  }));
  const tick = setInterval(() => { if (alive && watch.on) renderWatch(); }, 1000);

  arrangeTabs();
  renderAll();
  upgradeGlow(el, (c) => { if (alive) glowCleanup = c; else c(); });
  ensureProviders();

  return {
    unmount() {
      alive = false;
      if (glowCleanup) glowCleanup();
      listeners.delete(onChange);
      clearInterval(tick);
      for (const id of timers) clearTimeout(id);
      for (const off of subs) if (typeof off === 'function') off();
      el.innerHTML = '';
      // Watch mode intentionally keeps running after unmount (only while the app is open).
    },
  };
}
