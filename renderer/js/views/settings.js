// Settings view: AI provider keys and models, scan / alert / watch preferences, privacy statement.
// Also exports the preference helpers the other views use (readPrefs, writePrefs, PREFS_KEY).

export const PREFS_KEY = 'bastion.prefs';
export const PREFS_EVENT = 'bastion:prefs';

export const DEFAULT_PREFS = {
  scanDepth: 'standard',      // 'quick' | 'standard' | 'deep'
  alertSensitivity: 'normal', // 'low' | 'normal' | 'high'
  watchMinutes: 15,           // 5-60
  scanOnOpen: true,          // the shell currently scans on every launch; see the hint in the UI
  advancedEvidence: false,
};

const DEPTHS = ['quick', 'standard', 'deep'];
const SENSITIVITIES = ['low', 'normal', 'high'];

const DEPTH_TEXT = {
  quick: 'Quick: the router checks only. Fastest.',
  standard: 'Standard: router checks plus the common service ports.',
  deep: 'Deep: every check and the widest port sweep. Slowest.',
};
const SENS_TEXT = {
  low: 'Low: only open backdoors are worth a message.',
  normal: 'Normal: open backdoors and anything that needs a look.',
  high: 'High: every change, including new devices and Wi-Fi shifts.',
};

const KEY_PAGES = {
  claude: { url: 'https://console.anthropic.com/settings/keys', host: 'api.anthropic.com' },
  openai: { url: 'https://platform.openai.com/api-keys', host: 'api.openai.com' },
  grok: { url: 'https://console.x.ai', host: 'api.x.ai' },
};
const PROVIDER_DOT = { claude: 'var(--clay)', openai: 'var(--mint)', grok: 'var(--sky)' };
const PROVIDER_FALLBACK = [
  { id: 'claude', name: 'Claude', hasKey: false, model: '', models: [] },
  { id: 'openai', name: 'ChatGPT', hasKey: false, model: '', models: [] },
  { id: 'grok', name: 'Grok', hasKey: false, model: '', models: [] },
];

export function readPrefs() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
  } catch {
    saved = null;
  }
  const p = Object.assign({}, DEFAULT_PREFS, saved && typeof saved === 'object' ? saved : {});
  if (!DEPTHS.includes(p.scanDepth)) p.scanDepth = DEFAULT_PREFS.scanDepth;
  if (!SENSITIVITIES.includes(p.alertSensitivity)) p.alertSensitivity = DEFAULT_PREFS.alertSensitivity;
  p.watchMinutes = clampMinutes(p.watchMinutes);
  p.scanOnOpen = !!p.scanOnOpen;
  p.advancedEvidence = !!p.advancedEvidence;
  return p;
}

export function writePrefs(patch) {
  const next = Object.assign(readPrefs(), patch || {});
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable; the preference still applies for this session via the event.
  }
  try {
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
  } catch {
    // Ignore: no listeners is fine.
  }
  return next;
}

function clampMinutes(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_PREFS.watchMinutes;
  return Math.max(5, Math.min(60, n));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function errText(err) {
  return String((err && err.message) || err || 'Unknown error');
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

function cap(s) {
  const t = String(s || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function providerList(value) {
  return Array.isArray(value) && value.length ? value : null;
}

export function mount(el, ctx) {
  const { api, store } = ctx;
  const subs = [];
  const timers = new Set();
  let alive = true;
  let glowCleanup = null;
  let providers = providerList(store.get('providers'));
  const busy = new Set();
  const notes = {}; // provider id -> { kind, text }
  const customOpen = new Set();

  el.innerHTML = `
    <section class="v-settings view-pad" aria-labelledby="st-title">
      <header class="st-head">
        <div>
          <p class="eyebrow">Settings</p>
          <h1 class="h-display" id="st-title">Your keys. Your rules.</h1>
        </div>
        <p class="st-lede">Everything here is stored on this computer. Agents only answer questions; they never change your router or your computer.</p>
      </header>

      <div class="st-block nv-glass">
        <div class="st-block-h">
          <h2 class="st-h">AI providers</h2>
          <span class="st-meta">Bring your own API key</span>
        </div>
        <div class="st-providers" data-providers></div>
      </div>

      <div class="st-block nv-glass">
        <div class="st-block-h">
          <h2 class="st-h">Scanning and alerts</h2>
          <span class="st-meta">Saved on this computer</span>
        </div>
        <div class="st-prefs">
          <div class="st-pref">
            <label class="gk-slider" data-ticks="3" data-tick-labels="Quick,Standard,Deep"><span>Scan depth</span><input type="range" min="0" max="2" step="1" data-pref="depth" aria-valuetext="Standard"></label>
            <output class="st-out" data-out="depth"></output>
            <p class="st-fine" data-hint="depth"></p>
          </div>
          <div class="st-pref">
            <label class="gk-slider" data-ticks="3" data-tick-labels="Low,Normal,High"><span>Alert sensitivity</span><input type="range" min="0" max="2" step="1" data-pref="sens"></label>
            <output class="st-out" data-out="sens"></output>
            <p class="st-fine" data-hint="sens"></p>
          </div>
          <div class="st-pref">
            <label class="gk-slider" data-ticks="12"><span>Watch interval</span><input type="range" min="5" max="60" step="5" data-pref="watch"></label>
            <output class="st-out" data-out="watch"></output>
            <p class="st-fine">How often watch mode refreshes the network and asks the selected agent what changed. Only while Bastion is open.</p>
          </div>
          <div class="st-switches">
            <div class="st-switch">
              <span id="st-sw-open">Run a scan when Bastion opens</span>
              <button class="gk-toggle" type="button" role="switch" aria-checked="false" aria-labelledby="st-sw-open" data-toggle="scanOnOpen"></button>
            </div>
            <p class="st-fine" data-hint="open" hidden></p>
            <div class="st-switch">
              <span id="st-sw-adv">Show advanced evidence</span>
              <button class="gk-toggle" type="button" role="switch" aria-checked="false" aria-labelledby="st-sw-adv" data-toggle="advancedEvidence"></button>
            </div>
            <p class="st-fine">Advanced evidence shows full raw observations, BSSIDs and scan notes instead of the short versions.</p>
          </div>
        </div>
      </div>

      <div class="st-block nv-glass">
        <div class="st-block-h">
          <h2 class="st-h">Privacy</h2>
          <span class="st-meta">Exactly what leaves this computer</span>
        </div>
        <div class="st-privacy">
          <ul class="st-leaves">
            <li>
              <b>Speed test</b>
              <span>Test data is downloaded from and uploaded to Cloudflare's speed test servers (<span class="st-mono">speed.cloudflare.com</span>). Only when you run a test.</span>
            </li>
            <li>
              <b>Public IP lookup</b>
              <span>A request to <span class="st-mono">api.ipify.org</span> about every two minutes while Bastion is open (and when the connection comes back), to learn the address the internet sees for your network.</span>
            </li>
            <li>
              <b>AI requests, with your key</b>
              <span>When you ask an agent, or watch mode runs, your question and a compact snapshot of what Bastion measured go to the provider you picked (<span class="st-mono">api.anthropic.com</span>, <span class="st-mono">api.openai.com</span> or <span class="st-mono">api.x.ai</span>). Nothing is sent until you add a key and ask.</span>
            </li>
            <li>
              <b>Nothing else</b>
              <span>No telemetry, no account, no analytics. Scans, device lists and connection lists stay on this computer.</span>
            </li>
          </ul>
          <details class="st-snap">
            <summary>Preview the snapshot an agent receives</summary>
            <pre class="st-pre" data-snap></pre>
          </details>
        </div>
      </div>

      <div class="st-block nv-glass">
        <div class="st-block-h">
          <h2 class="st-h">Local data</h2>
          <span class="st-meta" data-about></span>
        </div>
        <div class="st-local">
          <p class="st-fine">Chat history, speed test history and these preferences are kept in this app's local storage. API keys are kept separately by Bastion and are not affected.</p>
          <div class="st-local-actions">
            <button class="btn btn--outline" type="button" data-clear>Clear history and preferences</button>
          </div>
        </div>
      </div>
    </section>`;

  const $ = (sel) => el.querySelector(sel);
  const provEl = $('[data-providers]');

  // ---------- providers ----------
  function noteFor(id) {
    const n = notes[id];
    if (!n) return '';
    return `<p class="st-note st-note--${esc(n.kind)}" role="status">${esc(n.text)}</p>`;
  }

  function renderProviders() {
    const list = providers || PROVIDER_FALLBACK;
    const loading = !providers;
    provEl.innerHTML = list.map((p) => {
      const id = String(p.id);
      const models = Array.isArray(p.models) ? p.models : [];
      const current = p.model || '';
      const isCustom = customOpen.has(id) || (current && !models.includes(current));
      const options = models.map((m) => `<option value="${esc(m)}"${m === current && !isCustom ? ' selected' : ''}>${esc(m)}</option>`).join('');
      const page = KEY_PAGES[id];
      const working = busy.has(id);
      return `
        <article class="st-prov" data-id="${esc(id)}">
          <div class="st-prov-h">
            <h3><i class="st-dot" style="background:${PROVIDER_DOT[id] || 'var(--lavender)'}" aria-hidden="true"></i>${esc(p.name || id)}</h3>
            ${loading ? '<span class="pill">Loading</span>' : p.hasKey ? '<span class="pill pill--ok">Key saved</span>' : '<span class="pill">No key</span>'}
          </div>
          <form class="st-keyform" data-form="${esc(id)}" autocomplete="off">
            <label class="st-label" for="st-key-${esc(id)}">API key</label>
            <div class="st-keyrow">
              <input class="st-input" id="st-key-${esc(id)}" type="password" autocomplete="off" spellcheck="false"
                placeholder="${p.hasKey ? 'Saved. Paste a new key to replace it' : 'Paste your API key'}" ${working || loading ? 'disabled' : ''}>
              <button class="btn btn--primary st-save" type="submit" ${working || loading ? 'disabled' : ''}>Save</button>
            </div>
          </form>
          <div class="st-prov-actions">
            <button class="nv-mini" type="button" data-act="test" ${!p.hasKey || working || loading ? 'disabled' : ''}>${working ? 'Working' : 'Test'}</button>
            <button class="nv-mini" type="button" data-act="remove" ${!p.hasKey || working || loading ? 'disabled' : ''}>Remove</button>
            ${page ? `<button class="st-link" type="button" data-act="get-key">Get a key</button>` : ''}
          </div>
          <div class="st-model">
            <label class="st-label" for="st-model-${esc(id)}">Model</label>
            <div class="st-keyrow">
              <select class="st-input st-select" id="st-model-${esc(id)}" data-model-select ${working || loading ? 'disabled' : ''}>
                ${options}
                <option value="__custom"${isCustom ? ' selected' : ''}>Custom model name</option>
              </select>
            </div>
            <div class="st-keyrow" ${isCustom ? '' : 'hidden'} data-custom-row>
              <input class="st-input st-mono-input" type="text" spellcheck="false" autocomplete="off" placeholder="Exact model id" value="${esc(isCustom ? current : '')}" data-model-custom ${working || loading ? 'disabled' : ''}>
              <button class="nv-mini nv-mini--go" type="button" data-act="model-save" ${working || loading ? 'disabled' : ''}>Use</button>
            </div>
            <p class="st-fine">In use: <span class="st-mono">${esc(current || 'provider default')}</span></p>
          </div>
          ${noteFor(id)}
        </article>`;
    }).join('');
  }

  async function reloadProviders() {
    try {
      const list = await api.agents.providers();
      if (!alive) return;
      if (Array.isArray(list)) {
        providers = list;
        store.set('providers', list);
      } else if (list && list.error) {
        ctx.toast('Could not load AI providers: ' + list.error, 'risk');
      }
    } catch (err) {
      ctx.toast('Could not load AI providers: ' + errText(err), 'risk');
    }
    if (alive) renderProviders();
  }

  async function withBusy(id, fn) {
    if (busy.has(id)) return;
    busy.add(id);
    renderProviders();
    try {
      await fn();
    } finally {
      busy.delete(id);
      if (alive) await reloadProviders();
    }
  }

  provEl.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const id = form.dataset.form;
    const input = form.querySelector('input[type="password"]');
    const key = input ? input.value.trim() : '';
    if (input) input.value = '';
    if (!key) {
      notes[id] = { kind: 'warn', text: 'Paste a key first.' };
      renderProviders();
      return;
    }
    withBusy(id, async () => {
      try {
        const r = await api.agents.setKey(id, key);
        notes[id] = r && r.ok
          ? { kind: 'ok', text: 'Key saved. Press Test to check it works.' }
          : { kind: 'risk', text: 'Key not saved: ' + ((r && r.error) || 'unknown error') };
      } catch (err) {
        notes[id] = { kind: 'risk', text: 'Key not saved: ' + errText(err) };
      }
    });
  });

  provEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    if (!card) return;
    const id = card.dataset.id;
    const act = btn.dataset.act;
    if (act === 'get-key') {
      const page = KEY_PAGES[id];
      if (page) Promise.resolve(api.app.openExternal(page.url)).catch(() => {});
      return;
    }
    if (act === 'test') {
      withBusy(id, async () => {
        try {
          const r = await api.agents.test(id);
          notes[id] = r && r.ok
            ? { kind: 'ok', text: 'Working. Model answered: ' + (r.model || 'unknown') + '.' }
            : { kind: 'risk', text: 'Test failed: ' + ((r && r.error) || 'no answer') };
        } catch (err) {
          notes[id] = { kind: 'risk', text: 'Test failed: ' + errText(err) };
        }
      });
      return;
    }
    if (act === 'remove') {
      withBusy(id, async () => {
        try {
          const r = await api.agents.clearKey(id);
          notes[id] = r && r.ok ? { kind: 'info', text: 'Key removed from this computer.' } : { kind: 'risk', text: 'Could not remove the key.' };
        } catch (err) {
          notes[id] = { kind: 'risk', text: 'Could not remove the key: ' + errText(err) };
        }
      });
      return;
    }
    if (act === 'model-save') {
      const input = card.querySelector('[data-model-custom]');
      const model = input ? input.value.trim() : '';
      if (!model) {
        notes[id] = { kind: 'warn', text: 'Type a model id first.' };
        renderProviders();
        return;
      }
      saveModel(id, model);
    }
  });

  provEl.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-model-select]');
    if (!sel) return;
    const card = sel.closest('[data-id]');
    const id = card.dataset.id;
    if (sel.value === '__custom') {
      customOpen.add(id);
      const row = card.querySelector('[data-custom-row]');
      if (row) row.hidden = false;
      const input = card.querySelector('[data-model-custom]');
      if (input) input.focus();
      return;
    }
    customOpen.delete(id);
    saveModel(id, sel.value);
  });

  function saveModel(id, model) {
    withBusy(id, async () => {
      try {
        const r = await api.agents.setModel(id, model);
        notes[id] = r && r.ok ? { kind: 'ok', text: 'Model set to ' + model + '.' } : { kind: 'risk', text: 'Model not saved' + (r && r.error ? ': ' + r.error : '.') };
        if (r && r.ok && providers) {
          const p = providers.find((x) => x.id === id);
          if (p && Array.isArray(p.models) && p.models.includes(model)) customOpen.delete(id);
        }
      } catch (err) {
        notes[id] = { kind: 'risk', text: 'Model not saved: ' + errText(err) };
      }
    });
  }

  // ---------- preferences ----------
  const depthIn = $('[data-pref="depth"]');
  const sensIn = $('[data-pref="sens"]');
  const watchIn = $('[data-pref="watch"]');
  const toggles = el.querySelectorAll('[data-toggle]');

  function paintPrefs() {
    const p = readPrefs();
    depthIn.value = String(DEPTHS.indexOf(p.scanDepth));
    sensIn.value = String(SENSITIVITIES.indexOf(p.alertSensitivity));
    watchIn.value = String(p.watchMinutes);
    $('[data-out="depth"]').textContent = cap(p.scanDepth);
    $('[data-out="sens"]').textContent = cap(p.alertSensitivity);
    $('[data-out="watch"]').textContent = p.watchMinutes + ' min';
    $('[data-hint="depth"]').textContent = DEPTH_TEXT[p.scanDepth] + ' Not applied yet: the scanner currently runs the same full check set at every depth.';
    $('[data-hint="sens"]').textContent = SENS_TEXT[p.alertSensitivity] + ' Used by watch mode to decide what to report.';
    depthIn.setAttribute('aria-valuetext', p.scanDepth);
    sensIn.setAttribute('aria-valuetext', p.alertSensitivity);
    watchIn.setAttribute('aria-valuetext', p.watchMinutes + ' minutes');
    toggles.forEach((t) => t.setAttribute('aria-checked', String(!!p[t.dataset.toggle])));
    const openHint = $('[data-hint="open"]');
    openHint.hidden = p.scanOnOpen;
    openHint.textContent = p.scanOnOpen ? '' : 'Off is not applied yet: Bastion still runs a scan each time it opens.';
  }

  depthIn.addEventListener('input', () => { writePrefs({ scanDepth: DEPTHS[Number(depthIn.value)] || 'standard' }); paintPrefs(); });
  sensIn.addEventListener('input', () => { writePrefs({ alertSensitivity: SENSITIVITIES[Number(sensIn.value)] || 'normal' }); paintPrefs(); });
  watchIn.addEventListener('input', () => { writePrefs({ watchMinutes: clampMinutes(watchIn.value) }); paintPrefs(); });

  toggles.forEach((t) => {
    t.addEventListener('click', () => {
      const key = t.dataset.toggle;
      const next = !readPrefs()[key];
      writePrefs({ [key]: next });
      // Set after any other click handlers (the glow kit may toggle the attribute itself).
      const id = setTimeout(() => { timers.delete(id); t.setAttribute('aria-checked', String(next)); }, 0);
      timers.add(id);
    });
  });

  const onPrefs = () => { if (alive) paintPrefs(); };
  window.addEventListener(PREFS_EVENT, onPrefs);

  // ---------- privacy snapshot preview ----------
  const snapDetails = $('.st-snap');
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

  // ---------- local data ----------
  $('[data-about]').textContent = 'Bastion ' + (api.version || '') + ' · ' + (api.platform === 'win32' ? 'Windows' : api.platform === 'darwin' ? 'macOS' : String(api.platform || 'unknown'));
  $('[data-clear]').addEventListener('click', () => {
    if (!window.confirm('Clear chat history, speed test history and preferences on this computer? API keys stay saved.')) return;
    for (const k of [PREFS_KEY, 'bastion.agentLog', 'bastion.speedHistory']) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
    store.set('agentLog', []);
    writePrefs({});
    paintPrefs();
    ctx.toast('Local history and preferences cleared.', 'ok');
  });

  subs.push(store.on('providers', (v) => {
    const list = providerList(v);
    if (list) { providers = list; renderProviders(); }
  }));

  renderProviders();
  paintPrefs();
  upgradeGlow(el, (c) => { if (alive) glowCleanup = c; else c(); });
  reloadProviders();

  return {
    unmount() {
      alive = false;
      if (glowCleanup) glowCleanup();
      for (const off of subs) if (typeof off === 'function') off();
      for (const id of timers) clearTimeout(id);
      window.removeEventListener(PREFS_EVENT, onPrefs);
      el.innerHTML = '';
    },
  };
}
