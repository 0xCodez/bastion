// Agents section: "Ask about your network".
// A scripted demo of the app's voice bar (iridescent aurora pill that morphs into an answer card)
// plus three provider cards with a rotating glow ring. Nothing typed here leaves the page:
// answers are pre-written and picked by keyword.

import '../fx/aurora.css';
import { flare } from '../fx/flare.js';
import { reveal } from '../fx/reveal.js';

const PROVIDERS = [
  { id: 'claude', name: 'Claude', vendor: 'Anthropic', host: 'api.anthropic.com', color: 'var(--clay)' },
  { id: 'openai', name: 'ChatGPT', vendor: 'OpenAI', host: 'api.openai.com', color: 'var(--mint)' },
  { id: 'grok', name: 'Grok', vendor: 'xAI', host: 'api.x.ai', color: 'var(--sky)' },
];

const SUGGESTIONS = [
  'Is my router safe?',
  'Why is my Wi-Fi slow in the evening?',
  'What is TR-069?',
  'Which device is new on my network?',
];

// Sample scan the demo answers refer to. Shown floating behind the voice bar.
const SCAN = [
  { k: 'risk', t: 'TCP 7547 open', s: 'tr069' },
  { k: 'warn', t: 'UPnP · 3 mappings', s: 'upnp' },
  { k: 'warn', t: 'DNS unencrypted', s: 'dns' },
  { k: 'warn', t: 'ch 6 · 9 networks', s: 'wifi' },
  { k: 'warn', t: '1 new device', s: 'devices' },
  { k: 'ok', t: 'Telnet closed', s: 'telnet' },
];

// Answers. Strings may contain `code` spans; { ol: [...] } renders a numbered list.
// Every answer follows the app's rules: cite the check, say what is unknown, never claim to change anything.
const TOPICS = [
  {
    id: 'tr069',
    strong: /tr-?0?69|cwmp|7547|remote manage|\bacs\b/,
    weak: /\bisp\b|provider|remote/,
    body: [
      'TR-069, also called CWMP, is how many internet providers manage home routers remotely: they can push settings, update firmware and read status. The router listens for it on TCP port `7547`.',
      'It helps with support, but it is also a way into your router that you don\'t control, and exposed TR-069 services have been hit by large attacks on home routers before.',
      'In this sample scan, `check tr069` found port 7547 answering on `192.168.1.1`. From inside your network that is a strong hint, not proof that it can be reached from the internet.',
      { ol: [
        'Ask your provider whether your plan needs remote management.',
        'If not, turn off TR-069 or CWMP in the router\'s admin page, usually under Remote management. You make the change; I only suggest it.',
      ] },
    ],
  },
  {
    id: 'nomap',
    strong: /nomap|location|\bmaps?\b|mapped|mapping service/,
    weak: /network name|\bssid\b|hide|track/,
    body: [
      'Phones report the Wi-Fi networks they see, which lets location services tie your router to your home address. Add `_nomap` to the end of your Wi-Fi name, for example `HomeNet_nomap`, to opt out.',
      'Google honors it, and some other location services do too. It does not hide your network from people nearby; it only asks mapping services not to record it.',
      'In the sample scan, the location check says your network name does not end in `_nomap` yet. Renaming it means every device has to reconnect once.',
    ],
  },
  {
    id: 'dns',
    strong: /\bdns\b|lookups?|\bdoh\b|resolver|dns over/,
    weak: /encrypt|\bisp\b|snoop|read my/,
    body: [
      'In the sample scan, this computer sends DNS lookups to the router at `192.168.1.1` in plain text, so your provider and anyone on the path can read which sites you look up.',
      { ol: [
        'On Windows 11, turn on DNS over HTTPS in Settings > Network & internet, usually under your connection\'s DNS server assignment.',
        'On Windows 10 or macOS there is no Settings switch: turn on encrypted DNS on your router if it supports it, or install your DNS provider\'s profile or app.',
        'Scan again. The DNS check should then read encrypted.',
      ] },
    ],
  },
  {
    id: 'upnp',
    strong: /upnp|port ?forward|forwarding|port mapping/,
    weak: /console|xbox|playstation|gaming|\bnat\b/,
    body: [
      'UPnP lets any program on your network ask the router to open ports, without a password. In the sample scan, `check upnp` lists 3 open mappings, all created by a game console.',
      'That is common for online games, but malware on any device could open ports the same way.',
      { ol: [
        'If you don\'t need it, turn UPnP off in the router\'s admin page. Online play may then need a manual port forward.',
        'If you keep it on, look over the mappings in Bastion now and then. Unexpected ones are worth a question.',
      ] },
    ],
  },
  {
    id: 'apps',
    strong: /\bapps?\b|program|process|which software|phone home|calling home/,
    weak: /traffic|connections?|talks? to|internet|upload/,
    body: [
      'Bastion lists live connections from this computer: which program talks to which address and port. In the sample, 6 programs have open connections. The busiest is a cloud-sync client, and an updater you may not recognise is talking to its vendor\'s update server.',
      'If a program surprises you, look it up before blocking it. Updaters are usually harmless.',
      'One limit: I can only see this computer\'s connections. Traffic from phones, TVs and other devices needs router integration, which is on Bastion\'s roadmap.',
    ],
  },
  {
    id: 'privacy',
    strong: /privacy|api key|\bkeys?\b|what.*(send|sent|share)|telemetry|tracking me/,
    weak: /\bdata\b|\bsend\b|\bsent\b|\blog\b|account/,
    body: [
      'When you ask, Bastion sends your question and a compact snapshot of the scan to the provider you picked, with your own API key. Nothing is sent until you add a key and ask, or turn on watch mode.',
      'Full MAC addresses, device names, Wi-Fi network names and the last part of your public IP are removed first. Your key is encrypted by the operating system (Keychain on macOS, DPAPI on Windows) and only goes to its own provider.',
      'This demo sends nothing at all. The answers on this page are pre-written.',
    ],
  },
  {
    id: 'cost',
    strong: /\bcosts?\b|price|pricing|\bpay\b|\bfree\b|billing|subscription/,
    weak: /money|tokens?|cheap|expensive/,
    body: [
      'Bastion itself is free and open source, with no account.',
      'Agent questions run on your own API key, so the provider bills your account at its normal rates for what you ask. Watch mode asks your agent each time it finds a change, so it can use more than an occasional question.',
      'Using an agent is optional. Every scan and check works without one.',
    ],
  },
  {
    id: 'devices',
    strong: /\bnew\b|unknown|stranger|intruder|who.*(on|connected)|joined|someone/,
    weak: /devices?|\bguest\b|\bmac\b|connected/,
    body: [
      'One device in the sample scan was not there last time. Its vendor shows as `unknown` because it uses a randomized hardware address.',
      'That usually means a phone or laptop with Private Wi-Fi Address (Apple) or Random hardware addresses (Windows) turned on. It is a privacy feature, not a sign of trouble.',
      { ol: [
        'Ask whoever is home whether they just connected something.',
        'If nobody claims it, change the Wi-Fi password in the router. Every device will need the new one to rejoin.',
      ] },
      'One limit: I only see devices this computer has talked to recently, so a quiet device can be missing from the list.',
    ],
  },
  {
    id: 'slow',
    strong: /slow|evening|\blag|buffer|speed|channel|latency|mbps|drop/,
    weak: /wi-?fi|wireless|fast|night|\bping\b|5 ?ghz|2\.4/,
    body: [
      'Most likely a crowded channel. In the sample survey your 2.4 GHz network is on channel 6 with 9 other networks; channel 1 has 2.',
      'In the evening more neighbours are home and streaming, so every network on channel 6 waits longer for airtime.',
      { ol: [
        'Run the speed test in the morning and again around 9 pm to confirm the drop.',
        'Move to channel 1 in the router\'s wireless settings. Devices drop for a few seconds while they reconnect.',
        'Use 5 GHz where you can. It has many more channels that don\'t overlap.',
      ] },
      'If evening speed stays low on a quiet channel, the slowdown is probably upstream at your provider, not in your Wi-Fi.',
    ],
  },
  {
    id: 'safe',
    strong: /safe|secure|risk|danger|hack|backdoor|attack|vulnerab|protect|exposed/,
    weak: /router|\bports?\b|telnet|\bssh\b|admin|password|firewall/,
    body: [
      'Mostly, with one thing worth fixing soon and two to review. From the sample scan:',
      { ol: [
        '`check tr069`: port 7547 answers on the router. That is your provider\'s remote management channel. Ask whether you need it, and turn it off if not.',
        '`check upnp`: 3 port mappings opened automatically by a game console. Fine if you use it; turn UPnP off if you don\'t.',
        '`check dns`: lookups go out unencrypted. Encrypted DNS keeps them private.',
      ] },
      'Telnet is closed and Wi-Fi uses WPA2. From inside your network I can\'t prove what is reachable from the internet.',
    ],
  },
];

const FALLBACK = {
  id: 'fallback',
  body: [
    'That one is not in this demo\'s script, so here is the sample scan in one line: port `7547` open, 3 UPnP mappings, unencrypted DNS, a crowded Wi-Fi channel and one new device. Telnet is closed.',
    'In the app, your agent answers any question about your real scan, in the language you ask in. Try one of the suggestions below.',
  ],
};

function pickTopic(q) {
  const s = q.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const t of TOPICS) {
    const score = (t.strong.test(s) ? 2 : 0) + (t.weak.test(s) ? 1 : 0);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best || FALLBACK;
}

const ic = (body, size = 18, sw = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const I_MIC = ic('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');
const I_SEND = ic('<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>', 18, 2.2);
const I_CARET = ic('<path d="M6 9l6 6 6-6"/>', 12, 2.4);
const I_CLOSE = ic('<path d="M6 6l12 12M18 6L6 18"/>', 16, 2.2);
const I_ARROW = ic('<path d="M5 12h14M13 6l6 6-6 6"/>', 16, 2);
const I_CHECK = ic('<path d="M5 12l5 5L20 7"/>', 14, 2.6);

function template() {
  const tags = SCAN.map((t, i) =>
    `<li class="ag-tag ag-tag--${t.k}" style="--i:${i}"><span class="ag-tag__k">${t.s}</span><span class="ag-tag__v">${t.t}</span></li>`).join('');
  const menu = [{ id: 'auto', name: 'Auto', vendor: 'first with a key', color: 'var(--lavender)' }, ...PROVIDERS]
    .map((p) => `<button type="button" role="menuitemradio" tabindex="-1" aria-checked="${p.id === 'auto'}" data-agent="${p.id}"><i style="background:${p.color}"></i>${p.name}<small>${p.vendor}</small></button>`).join('');
  const chips = SUGGESTIONS.map((s) => `<li><button type="button" class="ag-chip" data-q="${s}">${s}</button></li>`).join('');
  const provs = PROVIDERS.map((p, i) => `
    <li data-reveal>
      <button type="button" class="ag-prov" data-agent="${p.id}" aria-pressed="false" style="--c:${p.color};--d:${(-i * 2.3).toFixed(1)}s">
        <span class="ag-prov__body">
          <span class="ag-prov__top">
            <i class="ag-prov__dot" aria-hidden="true"></i>
            <span class="ag-prov__name">${p.name}</span>
            <span class="ag-prov__vendor">by ${p.vendor}</span>
          </span>
          <span class="ag-prov__host mono">${p.host}</span>
          <span class="ag-prov__cta"><span class="ag-prov__cta-t">Ask ${p.name} in the demo</span>${I_ARROW}</span>
        </span>
      </button>
    </li>`).join('');

  return `
  <div class="container">
    <header class="sec-head ag-head" data-reveal>
      <p class="eyebrow">AI watchers</p>
      <h2 class="display-l" id="agents-title">Ask about your <span class="aurora-text">network</span></h2>
      <p class="lead">Connect Claude, ChatGPT or Grok with your own API key. Your agent reads what Bastion measured, explains it in plain words and proposes fixes. Nothing changes unless you make the change.</p>
    </header>

    <div class="ag-grid">
      <div class="ag-demo" data-reveal>
        <div class="ag-stage" data-state="idle">
          <div class="ag-stage__bg" aria-hidden="true"></div>
          <div class="ag-stage__top">
            <span class="ag-stage__label mono"><i aria-hidden="true"></i>Live demo · sample network</span>
            <span class="ag-stage__label ag-stage__label--r mono">Nothing you type leaves this page</span>
          </div>

          <div class="ag-scene">
            <div class="ag-orb" aria-hidden="true"><span class="ag-orb__spin"></span><span class="ag-orb__core"></span></div>
            <p class="ag-scene__cap">Sample scan the demo agent reads</p>
            <ul class="ag-tags" role="list" aria-label="Sample scan findings">${tags}</ul>
          </div>

          <div class="ag-vox aurora-edge" data-state="idle">
            <div class="ag-vox__clip" aria-hidden="true">
              <div class="aurora"><i></i><i></i><i></i><i></i></div>
            </div>

            <div class="ag-vox__out" hidden>
              <div class="ag-vox__head">
                <p class="ag-q">You asked: <b data-ref="q"></b></p>
                <button type="button" class="ag-ib ag-ib--sm" data-ref="close" aria-label="Close the answer">${I_CLOSE}</button>
              </div>
              <div class="ag-who">
                <i data-ref="whoDot" aria-hidden="true"></i><span data-ref="who">Claude</span>
                <span class="ag-who__auto mono" data-ref="whoAuto">auto</span>
              </div>
              <p class="ag-badge mono">Demo answer — in the app, your agent reads your real scan</p>
              <div class="ag-think" data-ref="think" aria-hidden="true"><span>Reading the sample scan</span><i></i><i></i><i></i></div>
              <div class="ag-ans" data-ref="ans" aria-hidden="true"></div>
              <p class="ag-done mono" data-ref="done" hidden>${I_CHECK}Suggestions only. You apply every change yourself.</p>
            </div>

            <form class="ag-vox__form" data-ref="form" novalidate>
              <label class="sr-only" for="ag-input">Ask about your network</label>
              <input class="ag-input" id="ag-input" data-ref="input" type="text" autocomplete="off" enterkeyhint="send" maxlength="200" placeholder="Ask about your network…">
              <div class="ag-bar">
                <div class="ag-agent">
                  <button type="button" class="ag-agent__btn" data-ref="agentBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="ag-menu">
                    <i data-ref="agentDot" aria-hidden="true"></i><span data-ref="agentName">Agent (auto)</span>${I_CARET}
                  </button>
                  <div class="ag-menu" id="ag-menu" role="menu" aria-label="Choose an agent" data-ref="menu" hidden>${menu}</div>
                </div>
                <span class="ag-bar__sp"></span>
                <div class="ag-mic">
                  <button type="button" class="ag-ib" data-ref="mic" aria-label="Dictate a question" aria-describedby="ag-mic-tip">${I_MIC}</button>
                  <span class="ag-tip" role="tooltip" id="ag-mic-tip" data-ref="tip">In the app, use your system dictation<small class="mono">Win + H · Fn twice on Mac</small></span>
                </div>
                <button type="submit" class="ag-ib ag-ib--go" aria-label="Ask">${I_SEND}</button>
              </div>
            </form>
          </div>
        </div>

        <div class="ag-suggest">
          <p class="ag-suggest__l mono" id="ag-suggest-l">Try asking</p>
          <ul class="ag-chips" role="list" aria-labelledby="ag-suggest-l">${chips}</ul>
        </div>
        <p class="sr-only" aria-live="polite" data-ref="live"></p>
      </div>

      <aside class="ag-side" aria-labelledby="ag-side-title">
        <h3 class="ag-side__title" id="ag-side-title" data-reveal>Bring the agent you already use</h3>
        <ul class="ag-provs" role="list" data-reveal-stagger="0.08">${provs}</ul>
        <ul class="ag-facts" role="list" data-reveal-stagger="0.06">
          <li data-reveal><b>What it gets.</b> Your question and a compact snapshot of the scan. Full MAC addresses, device names, Wi-Fi names and the end of your public IP are removed first.</li>
          <li data-reveal><b>Your key, your account.</b> Encrypted by the operating system (Keychain on macOS, DPAPI on Windows) and sent only to its own provider. No Bastion account in between.</li>
          <li data-reveal><b>Watch mode</b> (off until you turn it on). While Bastion is open, it rescans every 5-60 minutes and asks your agent only when something changed.</li>
          <li data-reveal><b>Suggests, never acts.</b> Agents can't change anything on your computer or router. You review and apply each fix.</li>
        </ul>
      </aside>
    </div>
  </div>`;
}

export function mount(root) {
  if (!root) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.setAttribute('aria-labelledby', 'agents-title');
  root.innerHTML = template();
  root.setAttribute('data-aurora-paused', '');

  const $ = (s) => root.querySelector(s);
  const ref = {};
  root.querySelectorAll('[data-ref]').forEach((el) => { ref[el.dataset.ref] = el; });
  const stage = $('.ag-stage');
  const vox = $('.ag-vox');
  const out = $('.ag-vox__out');
  const aurora = $('.ag-vox .aurora');
  const provBtns = [...root.querySelectorAll('.ag-prov')];

  let agent = 'auto';
  let tok = 0;
  let timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  /* ---------- agent picker ---------- */
  const provider = (id) => PROVIDERS.find((p) => p.id === id);
  function setAgent(id) {
    agent = id;
    const p = provider(id);
    ref.agentName.textContent = p ? p.name : 'Agent (auto)';
    ref.agentDot.style.background = p ? p.color : 'var(--lavender)';
    ref.menu.querySelectorAll('[role="menuitemradio"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.agent === id)));
    provBtns.forEach((b) => {
      const on = b.dataset.agent === id;
      b.setAttribute('aria-pressed', String(on));
      const name = provider(b.dataset.agent).name;
      b.querySelector('.ag-prov__cta-t').textContent = on ? `${name} is answering in the demo` : `Ask ${name} in the demo`;
    });
  }
  const menuItems = () => [...ref.menu.querySelectorAll('[role="menuitemradio"]')];
  function openMenu(focusLast) {
    ref.menu.hidden = false;
    ref.agentBtn.setAttribute('aria-expanded', 'true');
    const items = menuItems();
    const cur = items.find((b) => b.getAttribute('aria-checked') === 'true') || items[0];
    (focusLast ? items[items.length - 1] : cur).focus();
  }
  function closeMenu(refocus) {
    if (ref.menu.hidden) return;
    ref.menu.hidden = true;
    ref.agentBtn.setAttribute('aria-expanded', 'false');
    if (refocus) ref.agentBtn.focus();
  }
  ref.agentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ref.menu.hidden) openMenu(); else closeMenu(true);
  });
  ref.agentBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); openMenu(e.key === 'ArrowUp'); }
  });
  ref.menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-agent]');
    if (!b) return;
    setAgent(b.dataset.agent);
    closeMenu(true);
  });
  ref.menu.addEventListener('keydown', (e) => {
    const items = menuItems();
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Tab') closeMenu(false);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.ag-agent')) closeMenu(false); });

  /* ---------- mic tooltip ---------- */
  let tipT = 0;
  ref.mic.addEventListener('click', () => {
    ref.tip.classList.add('is-shown');
    clearTimeout(tipT);
    tipT = setTimeout(() => ref.tip.classList.remove('is-shown'), 3200);
  });
  ref.mic.addEventListener('keydown', (e) => { if (e.key === 'Escape') ref.tip.classList.remove('is-shown'); });

  /* ---------- pill <-> card morph ---------- */
  function setState(s) {
    closeMenu(false);
    const was = vox.dataset.state;
    if (was === s) return;
    const expanding = was === 'idle';
    const collapsing = s === 'idle';
    if (!expanding && !collapsing) { vox.dataset.state = s; stage.dataset.state = s; return; }

    const from = vox.offsetHeight;
    out.hidden = collapsing;
    vox.dataset.state = s;
    stage.dataset.state = s;
    vox.style.height = '';
    const to = vox.offsetHeight;
    if (reduce || from === to) return;
    if (collapsing) out.hidden = false; // keep content visible while the card shrinks
    vox.classList.add('is-morphing');
    vox.style.height = from + 'px';
    void vox.offsetHeight;
    vox.style.height = to + 'px';
    const end = (e) => {
      if (e && (e.target !== vox || e.propertyName !== 'height')) return;
      vox.removeEventListener('transitionend', end);
      clearTimeout(safety);
      vox.classList.remove('is-morphing');
      vox.style.height = '';
      if (vox.dataset.state === 'idle') out.hidden = true;
    };
    const safety = setTimeout(end, 900);
    vox.addEventListener('transitionend', end);
  }

  /* ---------- typing ---------- */
  // Splits an answer into typed segments. Each segment knows its host (<p> or <li>, plus the
  // <ol> for list items) so hosts are attached lazily as typing reaches them.
  function buildAnswer(body) {
    const segs = [];
    const addText = (host, ol, str) => {
      str.split(/(`[^`]+`)/).forEach((part) => {
        if (!part) return;
        const code = part.length > 1 && part.startsWith('`') && part.endsWith('`');
        const span = document.createElement('span');
        if (code) span.className = 'ag-code';
        segs.push({ host, ol, node: span, text: code ? part.slice(1, -1) : part });
      });
    };
    for (const b of body) {
      if (typeof b === 'string') {
        addText(document.createElement('p'), null, b);
      } else if (b.ol) {
        const ol = document.createElement('ol');
        b.ol.forEach((item) => addText(document.createElement('li'), ol, item));
      }
    }
    return segs;
  }

  function plainText(body) {
    return body.map((b) => (typeof b === 'string' ? b : b.ol.map((x, i) => `${i + 1}. ${x}`).join(' '))).join(' ').replace(/`/g, '');
  }

  function typeAnswer(body, my, onDone) {
    const ans = ref.ans;
    ans.textContent = '';
    const segs = buildAnswer(body);
    const caret = document.createElement('span');
    caret.className = 'ag-caret';
    caret.setAttribute('aria-hidden', 'true');
    const attach = (seg) => {
      const { host, ol } = seg;
      if (ol) {
        if (!ol.isConnected) ans.appendChild(ol);
        if (!host.isConnected) ol.appendChild(host);
      } else if (!host.isConnected) ans.appendChild(host);
      host.appendChild(seg.node);
    };
    if (reduce) {
      segs.forEach((s) => { attach(s); s.node.textContent = s.text; });
      onDone();
      return;
    }
    let si = 0;
    let ci = 0;
    let stick = true;
    const onScroll = () => { stick = ans.scrollHeight - ans.scrollTop - ans.clientHeight < 24; };
    ans.addEventListener('scroll', onScroll, { passive: true });
    const tick = () => {
      if (my !== tok) { ans.removeEventListener('scroll', onScroll); return; }
      let budget = 3;
      while (budget > 0 && si < segs.length) {
        const s = segs[si];
        if (ci === 0) attach(s);
        const n = Math.min(budget, s.text.length - ci);
        ci += n;
        budget -= n;
        s.node.textContent = s.text.slice(0, ci);
        if (ci >= s.text.length) { si++; ci = 0; }
      }
      if (si < segs.length) {
        segs[si > 0 && ci === 0 ? si - 1 : si].node.after(caret);
        if (stick) ans.scrollTop = ans.scrollHeight;
        later(tick, 18 + Math.random() * 14);
      } else {
        caret.remove();
        ans.removeEventListener('scroll', onScroll);
        onDone();
      }
    };
    tick();
  }

  /* ---------- ask ---------- */
  function ask(q) {
    q = q.trim().slice(0, 200);
    if (!q) { ref.input.focus(); return; }
    clearTimers();
    const my = ++tok;
    const topic = pickTopic(q);
    const p = provider(agent) || PROVIDERS[0];

    ref.q.textContent = q;
    ref.who.textContent = p.name;
    ref.whoDot.style.background = p.color;
    ref.whoDot.style.color = p.color;
    ref.whoAuto.hidden = agent !== 'auto';
    ref.whoAuto.textContent = 'auto';
    ref.ans.textContent = '';
    ref.ans.setAttribute('aria-hidden', 'true');
    ref.done.hidden = true;
    ref.think.hidden = false;
    ref.live.textContent = '';
    vox.setAttribute('aria-busy', 'true');
    aurora.classList.add('aurora--intense');
    aurora.classList.remove('aurora--calm');
    setState('thinking');

    later(() => {
      if (my !== tok) return;
      ref.think.hidden = true;
      aurora.classList.remove('aurora--intense');
      setState('answer');
      typeAnswer(topic.body, my, () => {
        if (my !== tok) return;
        ref.ans.removeAttribute('aria-hidden');
        ref.done.hidden = false;
        vox.removeAttribute('aria-busy');
        aurora.classList.add('aurora--calm');
        ref.live.textContent = `Demo answer from ${p.name}: ${plainText(topic.body)}`;
      });
    }, reduce ? 0 : 1100 + Math.random() * 300);
  }

  function reset() {
    clearTimers();
    tok++;
    vox.removeAttribute('aria-busy');
    aurora.classList.remove('aurora--intense', 'aurora--calm');
    ref.live.textContent = '';
    setState('idle');
  }

  ref.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = ref.input.value;
    ref.input.value = '';
    if (q.trim()) ref.input.placeholder = 'Ask a follow-up…';
    ask(q);
  });
  ref.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && vox.dataset.state !== 'idle') { e.preventDefault(); reset(); }
  });
  ref.close.addEventListener('click', () => { reset(); ref.input.focus(); });

  // Suggestion chips type the question into the bar, then ask.
  let chipTok = 0;
  root.querySelector('.ag-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.ag-chip');
    if (!b) return;
    const q = b.dataset.q;
    const my = ++chipTok;
    const vr = stage.getBoundingClientRect();
    if (vr.top < 0 || vr.bottom > window.innerHeight) stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    if (reduce) { ask(q); return; }
    let i = 0;
    ref.input.value = '';
    const step = () => {
      if (my !== chipTok) return;
      i = Math.min(q.length, i + 2);
      ref.input.value = q.slice(0, i);
      if (i < q.length) setTimeout(step, 14);
      else setTimeout(() => { if (my === chipTok) { ref.input.value = ''; ask(q); } }, 160);
    };
    step();
  });

  // Provider cards pick the agent and send focus to the bar.
  provBtns.forEach((b) => {
    flare(b.querySelector('.ag-prov__body'), { focusEl: b, color: getComputedStyle(b).getPropertyValue('--c').trim() || undefined });
    b.addEventListener('click', () => {
      setAgent(agent === b.dataset.agent ? 'auto' : b.dataset.agent);
      const vr = vox.getBoundingClientRect();
      if (vr.top < 0 || vr.bottom > window.innerHeight) vox.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      setTimeout(() => ref.input.focus({ preventScroll: true }), reduce ? 0 : 350);
    });
  });

  setAgent('auto');

  /* ---------- run animations only while visible ---------- */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) root.removeAttribute('data-aurora-paused');
        else root.setAttribute('data-aurora-paused', '');
      }
    }, { rootMargin: '120px 0px' }).observe(root);
  } else {
    root.removeAttribute('data-aurora-paused');
  }

  reveal(root);
}

export default mount;
