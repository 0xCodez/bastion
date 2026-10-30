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
// App icons from the user's installed Claude / ChatGPT / Grok apps (store key 'providerIcons', loaded by app.js).
const LOGO_RE = /^data:image\/(png|jpeg|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/;
function logoSrc(store, id) {
  const m = store.get('providerIcons');
  const v = m && typeof m === 'object' ? m[id] : null;
  return typeof v === 'string' && LOGO_RE.test(v) ? v : null;
}
const PROVIDER_FALLBACK = [
  { id: 'claude', name: 'Claude', kind: 'api', hasKey: false, model: '', models: [] },
  { id: 'openai', name: 'ChatGPT', kind: 'api', hasKey: false, model: '', models: [] },
  { id: 'grok', name: 'Grok', kind: 'api', hasKey: false, model: '', models: [] },
];
// Subscription providers: the official CLI the user is signed in to. Icons reuse the provider's app icon.
const SUBSCRIPTIONS = [
  { id: 'claude-cli', icon: 'claude', title: 'Claude', via: 'Claude Code', plan: 'Claude', company: 'Anthropic',
    install: 'npm install -g @anthropic-ai/claude-code', login: 'claude auth login', docs: 'https://code.claude.com/docs/en/setup' },
  { id: 'codex-cli', icon: 'openai', title: 'ChatGPT', via: 'Codex', plan: 'ChatGPT', company: 'OpenAI',
    install: 'npm install -g @openai/codex', login: 'codex login', docs: 'https://developers.openai.com/codex/cli' },
];
const isCli = (p) => !!p && (p.kind === 'cli' || SUBSCRIPTIONS.some((s) => s.id === p.id));

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
          <h2 class="st-h">Use your subscription</h2>
          <span class="st-meta">No API key: your own Claude or ChatGPT plan</span>
        </div>
        <p class="st-fine st-sub-lede">If Claude Code or Codex is installed and signed in on this computer, Bastion can ask through it. Answers count against your subscription's usage limits. Bastion starts the CLI with every tool switched off, in an empty folder, so it can only answer: it cannot run commands, read your files or browse.</p>
        <div class="st-providers" data-subs></div>
      </div>

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
              <b>AI requests, with your subscription</b>
              <span>If you pick Claude or ChatGPT "(my subscription)", the same question and snapshot go to Anthropic or OpenAI through your own Claude Code or Codex login on this computer. Bastion starts the CLI with its tools switched off and never reads your login.</span>
            </li>
            <li>
              <b>Provider icons, once</b>
              <span>Bastion shows the icons of the Claude, ChatGPT and Grok apps installed on this computer, and only of apps signed by Anthropic, OpenAI or xAI. If one is not installed and you saved a key for it, Bastion downloads that provider's site icon once (<span class="st-mono">claude.ai</span>, <span class="st-mono">chatgpt.com</span> or <span class="st-mono">grok.com</span>) and keeps it on this computer.</span>
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
  const subsEl = $('[data-subs]');

  // ---------- providers ----------
  function noteFor(id) {
    const n = notes[id];
    if (!n) return '';
    return `<p class="st-note st-note--${esc(n.kind)}" role="status">${esc(n.text)}</p>`;
  }

  // The provider's own app icon in a rounded tile; a monogram in the provider colour when there is none.
  function logoTile(id, name) {
    const src = logoSrc(store, id);
    if (src) return `<span class="st-logo" aria-hidden="true"><img src="${esc(src)}" alt="" width="28" height="28" draggable="false"></span>`;
    return `<span class="st-logo st-logo--mono" style="--prov:${PROVIDER_DOT[id] || 'var(--lavender)'}" aria-hidden="true">${esc(String(name || id).charAt(0).toUpperCase())}</span>`;
  }

  function renderProviders() {
    renderSubs();
    const list = (providers || PROVIDER_FALLBACK).filter((p) => !isCli(p));
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
            <h3>${logoTile(id, p.name)}${esc(p.name || id)}</h3>
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

  // ---------- subscriptions (Claude Code / Codex) ----------
  function cmdRow(label, cmd) {
    return `
      <div>
        <span class="st-label">${esc(label)}</span>
        <div class="st-keyrow">
          <input class="st-input st-mono-input" type="text" readonly value="${esc(cmd)}" aria-label="${esc(label)}" data-cmd>
          <button class="nv-mini" type="button" data-act="copy" data-copy="${esc(cmd)}">Copy</button>
        </div>
      </div>`;
  }

  function subState(s, p, loading) {
    if (loading) return 'Checking this computer';
    if (!p) return 'This version of Bastion could not check for ' + s.via + '.';
    const c = p.cli || {};
    if (!c.installed) return c.error || s.via + ' is not installed on this computer.';
    const login = c.loggedIn === true
      ? 'signed in' + (c.authMethod && c.authMethod !== 'none' ? ' (' + c.authMethod + ')' : '')
      : c.loggedIn === false ? 'not signed in' : 'sign-in is checked on first use';
    return s.via + (c.version ? ' ' + c.version : '') + ' · ' + login;
  }

  function renderSubs() {
    const loading = !providers;
    subsEl.innerHTML = SUBSCRIPTIONS.map((s) => {
      const p = (providers || []).find((x) => x && x.id === s.id) || null;
      const c = (p && p.cli) || {};
      const working = busy.has(s.id);
      const installed = !!c.installed;
      let pill = '<span class="pill">Loading</span>';
      if (!loading) {
        if (!p) pill = '<span class="pill">Unavailable</span>';
        else if (!installed) pill = '<span class="pill">Not installed</span>';
        else if (c.loggedIn === false) pill = '<span class="pill pill--warn">Not signed in</span>';
        else if (c.ready) pill = '<span class="pill pill--ok">Ready</span>';
        else if (/^api_key/.test(c.authMethod || '')) pill = '<span class="pill pill--warn">API key login</span>';
        else pill = '<span class="pill">Sign-in unknown</span>';
      }
      const models = p && Array.isArray(p.models) ? p.models : [];
      const current = (p && p.model) || 'default';
      const options = models.map((m) => `<option value="${esc(m)}"${m === current ? ' selected' : ''}>${esc(m === 'default' ? 'default (set in ' + s.via + ')' : m)}</option>`).join('');
      let help = '';
      if (!loading && p && !installed) help = cmdRow('Install in a terminal (needs Node.js)', s.install) + cmdRow('Then sign in', s.login);
      else if (!loading && p && c.loggedIn === false) help = cmdRow('Sign in in a terminal first', s.login);
      else if (!loading && p && c.loggedIn == null) help = cmdRow('If the test says you are signed out, run', s.login);
      return `
        <article class="st-prov" data-sub="${esc(s.id)}">
          <div class="st-prov-h">
            <h3>${logoTile(s.icon, s.title)}${esc(s.title)} <span class="st-via">via ${esc(s.via)}</span></h3>
            ${pill}
          </div>
          <p class="st-fine">${esc(subState(s, p, loading))}</p>
          ${installed && c.path ? `<p class="st-fine">Found at <span class="st-mono">${esc(c.path)}</span></p>` : ''}
          ${c.note ? `<p class="st-fine">${esc(c.note)}</p>` : ''}
          ${help}
          ${installed ? `
          <div class="st-model">
            <label class="st-label" for="st-model-${esc(s.id)}">Model</label>
            <div class="st-keyrow">
              <select class="st-input st-select" id="st-model-${esc(s.id)}" data-sub-model ${working ? 'disabled' : ''}>${options}</select>
            </div>
          </div>` : ''}
          <div class="st-prov-actions">
            <button class="nv-mini" type="button" data-act="test" ${!installed || working || loading ? 'disabled' : ''}>${working ? 'Working' : 'Test'}</button>
            <button class="nv-mini" type="button" data-act="recheck" ${working || loading ? 'disabled' : ''}>Check again</button>
            <button class="st-link" type="button" data-act="docs">${esc(s.via)} setup guide</button>
          </div>
          <p class="st-fine">Uses your ${esc(s.plan)} subscription: answers count against its usage limits. Requests go to ${esc(s.company)} through your own login.</p>
          ${noteFor(s.id)}
        </article>`;
    }).join('');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* fall back below */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  subsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('[data-sub]');
    if (!btn || !card) return;
    const id = card.dataset.sub;
    const s = SUBSCRIPTIONS.find((x) => x.id === id);
    const act = btn.dataset.act;
    if (act === 'copy') {
      copyText(btn.dataset.copy || '').then((ok) => ctx.toast(ok ? 'Command copied. Paste it into a terminal.' : 'Could not copy. Select the command and copy it.', ok ? 'ok' : 'warn'));
      return;
    }
    if (act === 'docs') {
      if (s) Promise.resolve(api.app.openExternal(s.docs)).catch(() => {});
      return;
    }
    if (act === 'recheck') {
      // refresh: the CLIs are looked at again now, so signing out or uninstalling shows up.
      withBusy(id, async () => { delete notes[id]; }, { refresh: true });
      return;
    }
    if (act === 'test') {
      withBusy(id, async () => {
        try {
          const r = await api.agents.test(id);
          notes[id] = r && r.ok
            ? { kind: 'ok', text: 'Working. ' + (s ? s.via : 'The CLI') + ' answered' + (r.model && r.model !== 'default' ? ' with ' + r.model : '') + '.' }
            : { kind: 'risk', text: 'Test failed: ' + ((r && r.error) || 'no answer') };
        } catch (err) {
          notes[id] = { kind: 'risk', text: 'Test failed: ' + errText(err) };
        }
      });
    }
  });
  subsEl.addEventListener('focusin', (e) => {
    const input = e.target.closest('[data-cmd]');
    if (input) input.select();
  });
  subsEl.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-sub-model]');
    if (!sel) return;
    saveModel(sel.closest('[data-sub]').dataset.sub, sel.value);
  });

  async function reloadProviders(opts) {
    try {
      const list = await (opts && opts.refresh ? api.agents.providers({ refresh: true }) : api.agents.providers());
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

  async function withBusy(id, fn, reloadOpts) {
    if (busy.has(id)) return;
    busy.add(id);
    renderProviders();
    try {
      await fn();
    } finally {
      busy.delete(id);
      if (alive) await reloadProviders(reloadOpts);
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

  // Swap only the logo tiles, so a key being typed is not wiped by a late icon.
  subs.push(store.on('providerIcons', () => {
    if (!alive) return;
    subsEl.querySelectorAll('.st-prov[data-sub]').forEach((card) => {
      const s = SUBSCRIPTIONS.find((x) => x.id === card.dataset.sub);
      const tile = card.querySelector('.st-logo');
      if (s && tile) tile.outerHTML = logoTile(s.icon, s.title);
    });
    provEl.querySelectorAll('.st-prov[data-id]').forEach((card) => {
      const tile = card.querySelector('.st-logo');
      const p = (providers || PROVIDER_FALLBACK).find((x) => String(x.id) === card.dataset.id);
      if (tile) tile.outerHTML = logoTile(card.dataset.id, p ? p.name : card.dataset.id);
    });
  }));
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
