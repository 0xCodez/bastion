// Agents section: "Ask about your network".
// A scripted demo of the app's voice bar (iridescent aurora pill that morphs into an answer card),
// set as the centrepiece over a large animated aurora (low-res Canvas2D curtains, upscaled). The
// sample-scan findings ride an orbit around the orb, clear of the planet horizon. Below, a 3D ring
// of iridescent glass tiles, one per provider: the tiles start stacked and fan out to the ring as
// it scrolls into view, then it turns to the next tile every few seconds and rests in between
// (pause button, hover and focus stop it); it can be dragged with inertia and follows the arrow
// keys, and picking a tile switches the agent in the voice bar. Narrow screens, touch and reduced
// motion get a plain snap slider instead (same gate as motionOK() in fx/scroll.js).
// Nothing typed here leaves the page: answers are pre-written and picked by keyword.

import '../fx/aurora.css';
import { gsap } from '../fx/scroll.js';
import { flare } from '../fx/flare.js';
import { reveal } from '../fx/reveal.js';

const CAR_MQ = '(min-width: 821px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

const PROVIDERS = [
  { id: 'claude', name: 'Claude', vendor: 'Anthropic', host: 'api.anthropic.com', color: 'var(--clay)', iris: ['#E8A07F', '#FF5FD2', '#FFC772'] },
  { id: 'openai', name: 'ChatGPT', vendor: 'OpenAI', host: 'api.openai.com', color: 'var(--mint)', iris: ['#9EF0C4', '#3FE3C9', '#8FD3FF'] },
  { id: 'grok', name: 'Grok', vendor: 'xAI', host: 'api.x.ai', color: 'var(--sky)', iris: ['#8FD3FF', '#7C6CFF', '#FF8FE0'] },
];

const SUGGESTIONS = [
  'Is my router safe?',
  'Why is my Wi-Fi slow in the evening?',
  'What is TR-069?',
  'Which device is new on my network?',
];

// Sample scan the demo answers refer to. Shown floating behind the voice bar.
// a: position on the orbit around the orb (degrees, 0 = right, clockwise), all above the horizon.
const SCAN = [
  { k: 'risk', t: 'TCP 7547 open', s: 'tr069', a: 200 },
  { k: 'warn', t: 'UPnP · 3 mappings', s: 'upnp', a: 340 },
  { k: 'warn', t: 'DNS unencrypted', s: 'dns', a: 162 },
  { k: 'warn', t: 'ch 6 · 9 networks', s: 'wifi', a: 18 },
  { k: 'warn', t: '1 new device', s: 'devices', a: 242 },
  { k: 'ok', t: 'Telnet closed', s: 'telnet', a: 298 },
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
const I_PREV = ic('<path d="M15 5l-7 7 7 7"/>', 18, 2.2);
const I_NEXT = ic('<path d="M9 5l7 7-7 7"/>', 18, 2.2);
const I_PAUSE = '<svg class="ag-car__i-pause" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';
const I_PLAY = '<svg class="ag-car__i-play" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

function template() {
  const tags = SCAN.map((t, i) =>
    `<li class="ag-tag ag-tag--${t.k}" style="--i:${i};--a:${t.a}deg"><span class="ag-tag__k">${t.s}</span><span class="ag-tag__v">${t.t}</span></li>`).join('');
  const menu = [{ id: 'auto', name: 'Auto', vendor: 'first with a key', color: 'var(--lavender)' }, ...PROVIDERS]
    .map((p) => `<button type="button" role="menuitemradio" tabindex="-1" aria-checked="${p.id === 'auto'}" data-agent="${p.id}"><i style="background:${p.color}"></i>${p.name}<small>${p.vendor}</small></button>`).join('');
  const chips = SUGGESTIONS.map((s) => `<li><button type="button" class="ag-chip" data-q="${s}">${s}</button></li>`).join('');
  const tiles = PROVIDERS.map((p, i) => `
    <li class="ag-car__item" data-i="${i}">
      <button type="button" class="ag-tile" data-agent="${p.id}" aria-pressed="false" aria-describedby="ag-car-hint"
        style="--c:${p.color};--g1:${p.iris[0]};--g2:${p.iris[1]};--g3:${p.iris[2]}">
        <span class="ag-tile__foil" aria-hidden="true"></span>
        <span class="ag-tile__spec" aria-hidden="true"></span>
        <span class="ag-tile__glare" aria-hidden="true"></span>
        <span class="ag-tile__sweep" aria-hidden="true"></span>
        <span class="ag-tile__in">
          <span class="ag-tile__top" aria-hidden="true"><img class="ag-tile__logo" src="/agents/${p.id === 'openai' ? 'chatgpt' : p.id}.png" alt="" width="44" height="44" decoding="async"><span class="ag-tile__key mono">Key or plan</span></span>
          <span class="ag-tile__name">${p.name}</span>
          <span class="ag-tile__vendor">by ${p.vendor}</span>
          <span class="ag-tile__host mono">${p.host}</span>
          <span class="ag-tile__cta"><span class="ag-tile__cta-t">Ask ${p.name} in the demo</span>${I_ARROW}</span>
        </span>
        <span class="ag-tile__shade" aria-hidden="true"></span>
      </button>
    </li>`).join('');

  return `
  <div class="ag-sky" aria-hidden="true"><canvas class="ag-sky__cv" width="2" height="2"></canvas><span class="ag-sky__haze"></span></div>
  <div class="container">
    <header class="sec-head sec-head--center ag-head" data-reveal>
      <p class="eyebrow">AI watchers</p>
      <h2 class="display-l" id="agents-title">Ask about your <span class="aurora-text">network</span></h2>
      <p class="lead">Connect Claude, ChatGPT or Grok with your own API key, or use the Claude or ChatGPT plan you already pay for. Your agent reads what Bastion measured, explains it in plain words and proposes fixes. Nothing changes unless you make the change.</p>
    </header>

    <div class="ag-demo" data-reveal>
        <div class="ag-stage" data-state="idle">
          <div class="ag-stage__bg" aria-hidden="true"></div>
          <div class="ag-scene">
            <svg class="ag-orbit" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="ag-orbit-g" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stop-color="#FF5FD2" stop-opacity="0"/>
                  <stop offset=".25" stop-color="#B7A9FF" stop-opacity=".55"/>
                  <stop offset=".5" stop-color="#F3F0FF" stop-opacity=".7"/>
                  <stop offset=".75" stop-color="#8FD3FF" stop-opacity=".55"/>
                  <stop offset="1" stop-color="#3FE3C9" stop-opacity="0"/>
                </linearGradient>
              </defs>
              <ellipse class="ag-orbit__path" cx="100" cy="50" rx="99" ry="49"/>
              <ellipse class="ag-orbit__comet" cx="100" cy="50" rx="99" ry="49" pathLength="100"/>
            </svg>
            <div class="ag-orb" aria-hidden="true"><span class="ag-orb__spin"></span><span class="ag-orb__core"></span></div>
            <ul class="ag-tags" role="list" aria-label="Sample scan the demo agent reads">${tags}</ul>
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
            <p class="ag-vox__meta mono"><span><i aria-hidden="true"></i>Live demo · sample network</span><span>Nothing you type leaves this page</span></p>
          </div>
        </div>

        <div class="ag-suggest">
          <p class="ag-suggest__l mono" id="ag-suggest-l">Try asking</p>
          <ul class="ag-chips" role="list" aria-labelledby="ag-suggest-l">${chips}</ul>
        </div>
        <p class="sr-only" aria-live="polite" data-ref="live"></p>
      </div>

    <section class="ag-agents" aria-labelledby="ag-side-title">
      <div class="ag-agents__head" data-reveal>
        <h3 class="ag-side__title" id="ag-side-title">Bring the agent you already use</h3>
        <p class="ag-car__hint" id="ag-car-hint">Pick one to have it answer in the demo above.</p>
      </div>
      <div class="ag-car" role="group" aria-roledescription="carousel" aria-labelledby="ag-side-title">
        <div class="ag-car__view">
          <ul class="ag-car__ring" role="list">${tiles}</ul>
          <div class="ag-car__floor" aria-hidden="true"></div>
        </div>
        <div class="ag-car__nav">
          <button type="button" class="ag-ib ag-car__btn" data-dir="-1" aria-label="Previous agent">${I_PREV}</button>
          <p class="ag-car__status mono" aria-live="polite" data-ref="carStatus">Auto · first agent with a key</p>
          <button type="button" class="ag-ib ag-car__btn" data-dir="1" aria-label="Next agent">${I_NEXT}</button>
          <button type="button" class="ag-ib ag-car__play" aria-pressed="false" aria-label="Pause automatic rotation">${I_PAUSE}${I_PLAY}</button>
        </div>
      </div>
      <ul class="ag-facts" role="list" data-reveal-stagger="0.06">
        <li data-reveal><b>What it gets.</b> Your question and a compact snapshot of the scan. Full MAC addresses, device names, Wi-Fi names and the end of your public IP are removed first.</li>
        <li data-reveal><b>Your key, your account.</b> Encrypted by the operating system (Keychain on macOS, DPAPI on Windows) and sent only to its own provider. No Bastion account in between.</li>
        <li data-reveal><b>Watch mode</b> (off until you turn it on). While Bastion is open, it rescans every 5-60 minutes and asks your agent only when something changed.</li>
        <li data-reveal><b>Suggests, never acts.</b> Agents can't change anything on your computer or router. You review and apply each fix.</li>
      </ul>
    </section>
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
  const tileBtns = [...root.querySelectorAll('.ag-tile')];
  let car = null; // carousel controller, set up below

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
    tileBtns.forEach((b) => {
      const on = b.dataset.agent === id;
      b.setAttribute('aria-pressed', String(on));
      const name = provider(b.dataset.agent).name;
      b.querySelector('.ag-tile__cta-t').textContent = on ? `${name} is answering in the demo` : `Ask ${name} in the demo`;
    });
    if (ref.carStatus) ref.carStatus.textContent = p ? `${p.name} is answering in the demo` : 'Auto · first agent with a key';
    if (car) {
      car.setHeld(Boolean(p));
      if (p) car.bringToFront(PROVIDERS.indexOf(p));
    }
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

  // Provider tiles pick the agent for the voice bar (picking the same tile again goes back to auto).
  car = carousel(root.querySelector('.ag-car'), { reduce });
  tileBtns.forEach((b) => {
    b.addEventListener('click', (e) => {
      if (car.consumeDrag()) { e.preventDefault(); return; }
      setAgent(agent === b.dataset.agent ? 'auto' : b.dataset.agent);
    });
  });
  root.querySelectorAll('.ag-car__btn').forEach((b) => {
    b.addEventListener('click', () => car.step(Number(b.dataset.dir), false));
  });

  // Anamorphic streak along the voice bar's lower rim, following the pointer.
  flare(vox, { y: 1, color: '#D9D0FF' });

  setAgent('auto');

  /* ---------- one rAF loop: the aurora while its canvas is on screen, the ring while it turns ---------- */
  const sky = auroraSky(root.querySelector('.ag-sky__cv'), { reduce });
  let skyOn = false;
  let raf = 0;
  let last = 0;
  const frame = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    if (skyOn) sky.draw(now / 1000);
    const turning = car.tick(dt, now);
    if ((skyOn && !reduce) || turning) raf = requestAnimationFrame(frame);
    else last = 0;
  };
  const run = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  car.onWake = run;

  if ('IntersectionObserver' in window) {
    // the canvas itself gates drawing (not the whole, much taller section)
    new IntersectionObserver((entries) => {
      for (const e of entries) {
        skyOn = e.isIntersecting;
        if (skyOn) {
          sky.init();
          run();
        }
      }
    }).observe(root.querySelector('.ag-sky'));
    // CSS loops (orb, orbit, rim) pause while the section is off screen
    new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) root.removeAttribute('data-aurora-paused');
        else root.setAttribute('data-aurora-paused', '');
      }
    }, { rootMargin: '120px 0px' }).observe(root);
  } else {
    skyOn = true;
    root.removeAttribute('data-aurora-paused');
    sky.init();
    run();
  }

  reveal(root);
}

/* ====================================================================================
   Aurora backdrop: a few curtains of light drawn as thin vertical strokes into a small
   canvas (about 1/6 of the display size) with additive blending; the browser's upscale
   softens them. One canvas, drawn from the section's single rAF loop.
   ==================================================================================== */
const CURTAINS = [
  // c: colour, y: bottom edge (fraction of height), amp: sway, f: waves across, s: drift speed, r: rays across, a: strength
  { c: [255, 95, 210], y: 0.5, amp: 0.035, f: 1.1, s: 0.22, r: 11, a: 0.42 },
  { c: [124, 108, 255], y: 0.55, amp: 0.045, f: 0.8, s: -0.16, r: 8, a: 0.6 },
  { c: [63, 227, 201], y: 0.58, amp: 0.03, f: 1.5, s: 0.13, r: 13, a: 0.36 },
  { c: [143, 211, 255], y: 0.52, amp: 0.04, f: 0.6, s: -0.1, r: 7, a: 0.3 },
  { c: [255, 199, 114], y: 0.61, amp: 0.025, f: 1.9, s: 0.18, r: 15, a: 0.16 },
];

function auroraSky(cv, { reduce }) {
  let ctx = null;
  let W = 0;
  let H = 0;
  let grads = [];

  function size() {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    const w = Math.max(96, Math.min(300, Math.round(r.width / 6)));
    const h = Math.max(60, Math.round((w * r.height) / r.width));
    if (w === W && h === H) return;
    W = cv.width = w;
    H = cv.height = h;
    grads = CURTAINS.map(({ c }) => {
      const g = ctx.createLinearGradient(0, 0, 0, 1);
      const [r0, g0, b0] = c;
      g.addColorStop(0, `rgba(${r0},${g0},${b0},0)`);
      g.addColorStop(0.55, `rgba(${r0},${g0},${b0},.35)`);
      g.addColorStop(0.86, `rgba(${r0},${g0},${b0},1)`);
      g.addColorStop(0.93, 'rgba(255,255,255,.9)');
      g.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
      return g;
    });
    draw(12);
  }

  function init() {
    if (ctx || !cv || !cv.getContext) return;
    ctx = cv.getContext('2d', { alpha: true });
    if (!ctx) return;
    cv.classList.add('is-on');
    size();
    if ('ResizeObserver' in window) new ResizeObserver(() => size()).observe(cv);
  }

  function draw(t) {
    if (!ctx || !W) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const TAU = Math.PI * 2;
    for (let k = 0; k < CURTAINS.length; k++) {
      const cu = CURTAINS[k];
      ctx.fillStyle = grads[k];
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const ph = u * TAU * cu.f + t * cu.s + k * 1.7;
        const base = H * (cu.y + Math.sin(ph) * cu.amp + Math.sin(ph * 2.3 + t * 0.31) * cu.amp * 0.4);
        const len = H * (0.13 + 0.11 * (0.5 + 0.5 * Math.sin(u * TAU * 1.3 + t * 0.23 + k)));
        const ray = 0.5 + 0.5 * Math.sin(u * TAU * cu.r - t * 0.55 + k * 2.1);
        const edge = Math.min(1, u * 4, (1 - u) * 4);
        const a = cu.a * (0.45 + 0.55 * ray) * edge;
        if (a < 0.01) continue;
        ctx.globalAlpha = a;
        ctx.setTransform(1, 0, 0, len, x, base - len);
        ctx.fillRect(0, 0, 1.6, 1);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  return { init, draw: (t) => { if (!reduce) draw(t); } };
}

/* ====================================================================================
   Carousel: tiles on a ring. 3D mode (wide screen, fine pointer, motion allowed) positions
   them from one angle. It rests on a tile, turns to the next one after a dwell, and only
   runs frames while it turns or is dragged. Entrance: tiles start stacked and fan out to the
   ring as it scrolls into view. Simple mode is a CSS scroll-snap slider driven by the same
   buttons and keys, with no automatic movement.
   ==================================================================================== */
function carousel(el, { reduce }) {
  const view = el.querySelector('.ag-car__view');
  const ring = el.querySelector('.ag-car__ring');
  const items = [...el.querySelectorAll('.ag-car__item')];
  const tiles = items.map((it) => it.querySelector('.ag-tile'));
  const foils = tiles.map((t) => t.querySelector('.ag-tile__foil'));
  const specs = tiles.map((t) => t.querySelector('.ag-tile__spec'));
  const shades = tiles.map((t) => t.querySelector('.ag-tile__shade'));
  const playBtn = el.querySelector('.ag-car__play');
  const N = items.length;
  const STEP = 360 / N;
  const DWELL = 5200; // ms resting on a tile before turning to the next
  const TURN = 1.15; // s per automatic turn
  const mq = window.matchMedia(CAR_MQ);

  let is3d = false;
  let angle = 0; // ring rotation in degrees; tile i is in front when angle = -i * STEP
  let from = 0;
  let target = 0;
  let t0 = 0;
  let dur = 1;
  let vel = 0; // deg/s while coasting
  let mode = 'rest'; // rest | tween | drag | coast
  let fan = 1; // entrance: 0 = stacked, 1 = on the ring
  let swept = false;
  let playing = true;
  let held = false; // an agent is picked: stay on it
  let hover = false;
  let focusIn = false;
  let visible = false;
  let autoT = 0;
  let dragMoved = false;
  let swallowClick = false;
  const api = { onWake: null };

  const wake = () => api.onWake && api.onWake();
  const norm = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
  const frontIndex = () => ((Math.round(-angle / STEP) % N) + N) % N;
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  function layout() {
    const w = view.clientWidth;
    const R = Math.min(330, Math.max(210, w * 0.29));
    const k = fan;
    const j = 1 - fan;
    for (let i = 0; i < N; i++) {
      const th = norm(angle + i * STEP);
      const rad = (th * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const d = (1 - c) / 2; // 0 in front .. 1 at the back
      const front = Math.max(0, c);
      // on the ring
      const xr = s * R * 1.25;
      const zr = (c - 1) * R * 0.55;
      // stacked: a tight deck behind the front tile, fanned a few degrees
      const x = xr * k + s * 30 * j;
      const y = j * (60 - d * 34);
      const z = zr * k - d * 70 * j;
      const sc = (0.88 + 0.18 * front * front) * k + (1 - d * 0.08) * j;
      items[i].style.transform =
        `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,${z.toFixed(1)}px) rotateY(${(th * 0.22 * k).toFixed(2)}deg) rotateZ(${(-s * 6 * j).toFixed(2)}deg) scale(${sc.toFixed(3)})`;
      items[i].style.zIndex = String(Math.round((c + 1) * 50));
      // light on the glass: foil and specular band move with the tile's angle (transform only)
      const sp = (th / 70) * k;
      foils[i].style.transform = `translate3d(${(-14 * sp).toFixed(2)}%,${(4 * sp).toFixed(2)}%,0) rotate(${(50 * sp).toFixed(2)}deg)`;
      specs[i].style.transform = `translate3d(${(-190 * sp).toFixed(1)}%,0,0) skewX(-16deg)`;
      shades[i].style.opacity = ((1 - c) * 0.24 * k + d * 0.45 * j).toFixed(3);
      tiles[i].classList.toggle('is-front', Math.abs(th) < STEP / 2);
    }
  }

  function canAuto() {
    return is3d && playing && !held && !hover && !focusIn && visible && fan >= 1 && mode === 'rest';
  }
  function scheduleAuto() {
    clearTimeout(autoT);
    if (canAuto()) autoT = setTimeout(() => { if (canAuto()) turnTo(frontIndex() + 1, TURN); }, DWELL);
  }
  function turnTo(i, seconds) {
    const idx = ((i % N) + N) % N;
    clearTimeout(autoT);
    from = angle;
    target = angle + norm(-idx * STEP - angle);
    t0 = performance.now();
    dur = Math.max(1, seconds * 1000);
    mode = 'tween';
    wake();
  }

  function bringToFront(i) {
    if (!is3d) {
      const it = items[i];
      ring.scrollTo({ left: it.offsetLeft - (ring.clientWidth - it.clientWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
      return;
    }
    turnTo(i, 0.85);
  }

  function nearestSlide() {
    const mid = ring.scrollLeft + ring.clientWidth / 2;
    let best = 0;
    let bestD = Infinity;
    items.forEach((it, k) => {
      const d = Math.abs(it.offsetLeft + it.clientWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  function step(dir, moveFocus) {
    const i = is3d ? (frontIndex() + dir + N) % N : Math.max(0, Math.min(N - 1, nearestSlide() + dir));
    bringToFront(i);
    if (moveFocus) tiles[i].focus({ preventScroll: true });
  }

  // returns true while it needs more frames
  function tick(dt, now) {
    if (!is3d) return false;
    if (mode === 'tween') {
      const p = Math.min(1, (now - t0) / dur);
      angle = from + (target - from) * easeInOut(p);
      if (p >= 1) {
        angle = target;
        if (Math.abs(angle) > 3600) angle = norm(angle);
        mode = 'rest';
        layout();
        scheduleAuto();
        return false;
      }
    } else if (mode === 'coast') {
      angle += vel * dt;
      vel *= Math.exp(-dt * 2.6);
      if (Math.abs(vel) < 40) turnTo(Math.round(-angle / STEP), 0.55);
    } else if (mode !== 'drag') {
      return false;
    }
    layout();
    return true;
  }

  function sweep() {
    if (swept) return;
    swept = true;
    const t = tiles[frontIndex()];
    t.classList.add('is-swept');
    setTimeout(() => t.classList.remove('is-swept'), 1600);
  }

  /* drag / swipe with inertia */
  let px = 0;
  let a0 = 0;
  let lastX = 0;
  let lastT = 0;
  let pid = null;
  view.addEventListener('pointerdown', (e) => {
    if (!is3d || e.button !== 0) return;
    pid = e.pointerId;
    px = lastX = e.clientX;
    lastT = performance.now();
    a0 = angle;
    dragMoved = false;
    vel = 0;
  });
  view.addEventListener('pointermove', (e) => {
    if (pid !== e.pointerId) return;
    const dx = e.clientX - px;
    if (!dragMoved && Math.abs(dx) > 6) {
      dragMoved = true;
      mode = 'drag';
      clearTimeout(autoT);
      try { view.setPointerCapture(pid); } catch (err) { /* pointer already gone */ }
      view.classList.add('is-dragging');
      wake();
    }
    if (!dragMoved) return;
    const now = performance.now();
    const kk = 0.34;
    angle = a0 + dx * kk;
    const dtm = Math.max(1, now - lastT);
    vel = vel * 0.6 + (((e.clientX - lastX) * kk) / dtm) * 1000 * 0.4;
    lastX = e.clientX;
    lastT = now;
  });
  const end = (e) => {
    if (pid !== e.pointerId) return;
    pid = null;
    if (!dragMoved) return;
    dragMoved = false;
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    view.classList.remove('is-dragging');
    if (performance.now() - lastT > 90) vel = 0;
    vel = Math.max(-900, Math.min(900, vel));
    mode = 'coast';
    wake();
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  view.addEventListener('lostpointercapture', end);

  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = true; clearTimeout(autoT); } });
  el.addEventListener('pointerleave', () => { hover = false; scheduleAuto(); });
  el.addEventListener('focusin', () => { focusIn = true; clearTimeout(autoT); });
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) { focusIn = false; scheduleAuto(); } });

  /* keys: arrows move between tiles (focus follows on a tile), Home/End jump */
  el.addEventListener('keydown', (e) => {
    const onTile = e.target.closest && e.target.closest('.ag-tile');
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (onTile) {
        const i = (tiles.indexOf(onTile) + dir + N) % N;
        bringToFront(i);
        tiles[i].focus({ preventScroll: true });
      } else step(dir, false);
    } else if ((e.key === 'Home' || e.key === 'End') && onTile) {
      e.preventDefault();
      const i = e.key === 'Home' ? 0 : N - 1;
      bringToFront(i);
      tiles[i].focus({ preventScroll: true });
    }
  });
  // a tile reached with Tab comes round to the front
  tiles.forEach((t, i) => t.addEventListener('focus', () => {
    if (is3d && t.matches(':focus-visible') && frontIndex() !== i) bringToFront(i);
  }));

  /* pointer glare on each tile */
  tiles.forEach((t) => {
    t.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      t.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    });
  });

  /* visible pause / play for the automatic rotation (WCAG 2.2.2) */
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      playing = !playing;
      playBtn.setAttribute('aria-pressed', String(!playing));
      if (playing) scheduleAuto(); else clearTimeout(autoT);
    });
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const e of entries) visible = e.isIntersecting;
      if (visible) scheduleAuto(); else clearTimeout(autoT);
    }, { threshold: 0.35 }).observe(view);
  } else {
    visible = true;
  }

  function clearInline() {
    items.forEach((it, i) => {
      it.style.transform = '';
      it.style.zIndex = '';
      foils[i].style.transform = '';
      specs[i].style.transform = '';
      shades[i].style.opacity = '';
      tiles[i].classList.remove('is-front');
    });
  }

  function apply() {
    is3d = mq.matches;
    el.classList.toggle('is-3d', is3d);
    if (is3d) {
      layout();
      scheduleAuto();
    } else {
      clearTimeout(autoT);
      mode = 'rest';
      clearInline();
    }
  }
  if (mq.addEventListener) mq.addEventListener('change', apply);
  apply();

  // Entrance: the deck fans out to the ring as it scrolls into view (scrubbed, reversible).
  try {
    gsap.matchMedia().add(CAR_MQ, () => {
      const st = { fan: 0 };
      fan = 0;
      layout();
      gsap.to(st, {
        fan: 1,
        ease: 'power2.out',
        scrollTrigger: { trigger: view, start: 'top 96%', end: 'top 40%', scrub: 0.8 },
        onUpdate() {
          fan = st.fan;
          if (is3d && mode === 'rest') layout();
          if (fan >= 0.999) { sweep(); scheduleAuto(); }
        },
      });
      return () => {
        fan = 1;
        if (is3d) layout();
      };
    });
  } catch (err) {
    fan = 1;
    if (is3d) layout();
  }

  return Object.assign(api, {
    tick,
    step,
    bringToFront,
    setHeld(v) { held = v; if (v) clearTimeout(autoT); else scheduleAuto(); },
    consumeDrag() { return swallowClick; },
  });
}

export default mount;
