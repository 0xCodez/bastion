// How it works: a labelled replay of a Bastion scan with sample data, staged like a product shot.
// Wide screens with a fine pointer (motionOK): the app window rises out of a reflective floor and
// tilts into place in perspective as you scroll (scrubbed), lands centred in the viewport, and the
// stage pins briefly so window, floor light and rim flare share one frame while the replay starts.
// The three steps (Scan / Understand / Fix) sit on the floor right under the window as a slim
// stepper whose light follows the replay; its caption swaps with the active phase.
// Narrow / touch / reduced motion: no pinning or scrubbing, the steps stack above the window with
// their full text; reduced motion opens the replay on its finished state.

import { gsap, ScrollTrigger } from '../fx/scroll.js';
import { reveal } from '../fx/reveal.js';

// Same gate as motionOK() in fx/scroll.js, as a media query so gsap.matchMedia can follow changes.
const STAGED_MQ = '(min-width: 821px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

const CHECKS = [
  { name: 'Router remote management', detail: 'TR-069 / CWMP · port 7547', result: 'Open', tone: 'risk' },
  { name: 'UPnP', detail: 'Automatic port forwards', result: '3 forwards', tone: 'warn' },
  { name: 'DNS', detail: 'How lookups leave your network', result: 'Unencrypted', tone: 'warn' },
  { name: 'Telnet', detail: 'Port 23 on the router', result: 'Closed', tone: 'ok' },
  { name: 'Wi-Fi channel', detail: '5 GHz · channel 36', result: '7 neighbours on 36', tone: 'warn' },
  { name: 'Location maps', detail: 'Network name opt-out', result: 'Name lacks _nomap', tone: 'warn' },
];

const SCORE = 58;
const SPEED = { ping: 11, down: 312.4, up: 96.1 };
const FINDINGS = CHECKS.filter((c) => c.tone !== 'ok').length;

const STOPS = [0, 100, 200, 500, 750, 1000];
const STOP_LABELS = ['0', '100', '200', '500', '750', '1G'];
const NS = 'http://www.w3.org/2000/svg';

// 270-degree gauge arc (from 135deg to 45deg, clockwise) around (130, 130) at radius r.
function arc(r) {
  const k = Math.SQRT1_2 * r;
  return `M${(130 - k).toFixed(2)} ${(130 + k).toFixed(2)} A${r} ${r} 0 1 1 ${(130 + k).toFixed(2)} ${(130 + k).toFixed(2)}`;
}
const ARC = arc(100);

const STEPS = [
  {
    id: 'scan',
    title: 'Scan',
    text: 'Bastion checks your router from inside your network: remote management on port 7547, UPnP forwards, Telnet, plain-HTTP admin pages and how your DNS lookups travel. It also reads your Wi-Fi channel and runs a speed test.',
  },
  {
    id: 'understand',
    title: 'Understand',
    text: 'Each finding says what it is and why it matters, in plain words. If you add your own API key, Claude, ChatGPT or Grok can review the results with you.',
  },
  {
    id: 'fix',
    title: 'Fix',
    text: 'You get steps for your router and decide what to change. Bastion never logs in to it, never tries passwords and never changes a setting on its own.',
  },
];

// The app's own tab bar (icons from the desktop app), Shield active.
const TABS = [
  { id: 'home', label: 'Home', icon: '<path d="M3.5 10.5L12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-6h4v6"/>' },
  { id: 'shield', label: 'Shield', icon: '<path d="M12 2.5l8 3.2v5.6c0 5-3.4 9.1-8 10.7-4.6-1.6-8-5.7-8-10.7V5.7z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>' },
  { id: 'speed', label: 'Speed & Wi-Fi', icon: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>' },
  { id: 'devices', label: 'Devices', icon: '<rect x="3" y="4" width="13" height="10" rx="1"/><path d="M7 18h5"/><rect x="17.5" y="9" width="4" height="11" rx="1"/>' },
  { id: 'agents', label: 'Agents', icon: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>' },
  { id: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>' },
];

const ICON_REPLAY =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
const LOGO =
  '<svg width="20" height="20" viewBox="0 0 28 28" aria-hidden="true" focusable="false"><defs><linearGradient id="demoLogo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D4CBFF"/><stop offset="1" stop-color="#7C6CFF"/></linearGradient></defs><path d="M14 2.5l9.5 4v6.8c0 6-4 10.7-9.5 12.7-5.5-2-9.5-6.7-9.5-12.7V6.5z" fill="url(#demoLogo)"/><path d="M9.5 14.5a6.4 6.4 0 0 1 9 0M11.6 17a3.4 3.4 0 0 1 4.8 0" fill="none" stroke="#120C2E" stroke-width="1.9" stroke-linecap="round"/><circle cx="14" cy="19.6" r="1.3" fill="#120C2E"/></svg>';

function frac(v) {
  const x = Math.max(0, Math.min(1000, v));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i]) return (i - 1 + (x - STOPS[i - 1]) / (STOPS[i] - STOPS[i - 1])) / (STOPS.length - 1);
  }
  return 1;
}

function easeOut(p) {
  return 1 - Math.pow(1 - p, 3);
}

function prefersReduced() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function mount(el) {
  if (!el) return;
  const uid = 'demo';

  const rows = CHECKS.map(
    (c, i) => `
      <li class="dc" data-state="idle" data-i="${i}">
        <span class="dc__ic" aria-hidden="true"></span>
        <span class="dc__t"><strong>${c.name}</strong><span class="dc__d">${c.detail}</span></span>
        <span class="dc__r"><span class="dc__pill">Waiting</span></span>
      </li>`,
  ).join('');

  const steps = STEPS.map(
    (s, i) => `
      <li class="demo__step" data-step="${s.id}">
        <span class="demo__step-hd"><span class="demo__node" aria-hidden="true"><span class="demo__num">0${i + 1}</span></span><h3 class="demo__step-t">${s.title}</h3></span>
        <p class="demo__step-p">${s.text}</p>
      </li>`,
  ).join('');

  const tabs = TABS.map(
    (t) => `<span class="demo__tab${t.id === 'shield' ? ' is-on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>${t.id === 'shield' ? `<span>${t.label}</span>` : ''}</span>`,
  ).join('');

  el.setAttribute('aria-labelledby', `${uid}-title`);
  el.innerHTML = `
    <div class="demo__sky" aria-hidden="true"></div>
    <div class="container">
      <header class="sec-head demo__head" data-reveal>
        <p class="eyebrow">How it works</p>
        <h2 class="display-l" id="${uid}-title">See what is open. Then decide what to close.</h2>
        <p class="lead">One scan from your own computer, findings in plain words, and fixes you carry out yourself. This is a replay with sample data, so you can see it before you install anything.</p>
      </header>

      <div class="demo__stage">
       <div class="demo__fit">
        <div class="demo__set">
        <div class="demo__beam" aria-hidden="true"></div>
        <div class="demo__floor" aria-hidden="true">${floorGrid()}<i class="demo__floor-pool"></i></div>
        <div class="demo__mirror" aria-hidden="true"><i></i></div>
        <div class="demo__tilt">
          <figure class="demo__win" aria-labelledby="${uid}-cap">
            <figcaption id="${uid}-cap" class="sr-only">Demo with sample data: a replay of a Bastion network check. It finds remote management open on port 7547, three UPnP forwards, unencrypted DNS, Telnet closed, seven neighbouring networks on Wi-Fi channel 36 and a network name without the _nomap suffix. Score ${SCORE} out of 100. Speed test: ${SPEED.down} megabits per second down, ${SPEED.up} up, ${SPEED.ping} milliseconds ping.</figcaption>

            <div class="demo__chrome">
              <span class="demo__lights" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="demo__app">${LOGO}<span>Bastion</span></span>
              <span class="demo__tabs" aria-hidden="true">${tabs}</span>
              <span class="demo__badge">Demo with sample data</span>
            </div>

            <div class="demo__body">
              <section class="demo__panel demo__checks">
                <div class="demo__checks-in" aria-hidden="true">
                <div class="demo__ph">
                  <h4>Network check</h4>
                  <span class="demo__count"><b data-ref="count">0</b> / ${CHECKS.length}</span>
                </div>
                <div class="demo__bar"><span data-ref="bar"></span></div>
                <ol class="demo__list" role="list">${rows}</ol>
                </div>
                <div class="demo__foot">
                  <p class="demo__fix" data-ref="fix" aria-hidden="true">
                    <span class="demo__fix-k">Next</span>
                    <span data-ref="fixText">Findings and suggested fixes appear here after the scan.</span>
                  </p>
                  <button type="button" class="btn btn--ghost btn--sm demo__replay" data-ref="replay">${ICON_REPLAY}<span data-ref="replayLabel">Play demo</span></button>
                </div>
              </section>

              <div class="demo__side" aria-hidden="true">
                <section class="demo__panel demo__score">
                  <div class="demo__ph"><h4>Score</h4><span class="demo__tag" data-ref="scoreTag">Not scanned</span></div>
                  <div class="demo__score-row">
                  <div class="ring">
                    <svg viewBox="0 0 120 120">
                      <defs>
                        <linearGradient id="${uid}-ring" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0" stop-color="#FF5FD2"/>
                          <stop offset=".45" stop-color="#7C6CFF"/>
                          <stop offset="1" stop-color="#8FD3FF"/>
                        </linearGradient>
                        <radialGradient id="${uid}-disc" cx=".5" cy=".3" r=".75">
                          <stop offset="0" stop-color="#3A3180" stop-opacity=".55"/>
                          <stop offset=".6" stop-color="#151230" stop-opacity=".7"/>
                          <stop offset="1" stop-color="#0B0A18" stop-opacity=".9"/>
                        </radialGradient>
                        <linearGradient id="${uid}-spec" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0" stop-color="#fff" stop-opacity=".75"/>
                          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
                        </linearGradient>
                      </defs>
                      <circle class="ring__disc" cx="60" cy="60" r="41" fill="url(#${uid}-disc)"/>
                      <g class="ring__ticks" data-ref="ringTicks"></g>
                      <circle class="ring__track" cx="60" cy="60" r="50" pathLength="100"/>
                      <circle class="ring__val ring__val--glow" data-ref="ringGlow" cx="60" cy="60" r="50" pathLength="100" stroke="url(#${uid}-ring)" stroke-dasharray="0 100" transform="rotate(-90 60 60)"/>
                      <circle class="ring__val" data-ref="ring" cx="60" cy="60" r="50" pathLength="100" stroke="url(#${uid}-ring)" stroke-dasharray="0 100" transform="rotate(-90 60 60)"/>
                      <path class="ring__spec" d="M22 46 A40 40 0 0 1 48 21" stroke="url(#${uid}-spec)"/>
                      <circle class="ring__cap" data-ref="ringCap" cx="60" cy="10" r="3.2"/>
                    </svg>
                    <div class="ring__read"><b data-ref="score">--</b><span>of 100</span></div>
                  </div>
                  <p class="demo__small" data-ref="scoreNote">Waiting for the scan.</p>
                  </div>
                </section>

                <section class="demo__panel demo__speed">
                  <div class="demo__ph"><h4>Speed test</h4><span class="demo__tag">Cloudflare</span></div>
                  <div class="gauge">
                    <svg viewBox="0 0 260 232">
                      <defs>
                        <linearGradient id="${uid}-gauge" x1="0" y1="1" x2="1" y2="0">
                          <stop offset="0" stop-color="#8FD3FF"/>
                          <stop offset=".55" stop-color="#7C6CFF"/>
                          <stop offset="1" stop-color="#FF8FE0"/>
                        </linearGradient>
                      </defs>
                      <path class="gauge__track" d="${ARC}"/>
                      <path class="gauge__rim" d="${arc(110)}"/>
                      <path class="gauge__rim gauge__rim--in" d="${arc(90)}"/>
                      <path class="gauge__val gauge__val--glow" data-ref="gGlow" d="${ARC}" pathLength="100" stroke="url(#${uid}-gauge)" stroke-dasharray="0 100"/>
                      <path class="gauge__val" data-ref="gVal" d="${ARC}" pathLength="100" stroke="url(#${uid}-gauge)" stroke-dasharray="0 100"/>
                      <path class="gauge__gloss" d="${arc(104)}" pathLength="100" stroke-dasharray="0 6 40 100"/>
                      <g data-ref="ticks"></g>
                      <g class="gauge__needle" data-ref="needle" transform="rotate(135 130 130)"><line x1="130" y1="130" x2="196" y2="130"/><circle class="gauge__tip" cx="196" cy="130" r="4"/><circle cx="130" cy="130" r="7"/></g>
                    </svg>
                    <div class="gauge__read"><b data-ref="gNum">0.0</b><small>Mbps</small><span data-ref="phase">Ready</span></div>
                  </div>
                  <dl class="trio">
                    <div><dt>Ping</dt><dd data-ref="ping">--</dd></div>
                    <div><dt>Down</dt><dd data-ref="down">--</dd></div>
                    <div><dt>Up</dt><dd data-ref="up">--</dd></div>
                  </dl>
                </section>
              </div>
            </div>
            <p class="sr-only" aria-live="polite" data-ref="live"></p>
            <span class="demo__glare" aria-hidden="true"></span>
            <span class="demo__gloss" aria-hidden="true"></span>
          </figure>
          <span class="demo__flare" aria-hidden="true"></span>
        </div>
        </div>

        <div class="demo__rail" style="--p:0" data-phase="idle">
          <div class="demo__track" aria-hidden="true"><span class="demo__track-fill"></span><span class="demo__track-clip"><span class="demo__track-head"></span></span></div>
          <ol class="demo__steps" role="list">${steps}</ol>
        </div>
       </div>
      </div>
    </div>
  `;

  const ref = {};
  el.querySelectorAll('[data-ref]').forEach((n) => {
    ref[n.dataset.ref] = n;
  });
  const rowEls = Array.from(el.querySelectorAll('.dc'));
  const stepEls = Array.from(el.querySelectorAll('.demo__step'));
  const rail = el.querySelector('.demo__rail');
  const stage = el.querySelector('.demo__stage');
  const fit = el.querySelector('.demo__fit');
  const tilt = el.querySelector('.demo__tilt');
  const win = el.querySelector('.demo__win');
  const beam = el.querySelector('.demo__beam');
  const floor = el.querySelector('.demo__floor');
  const floorGridEl = el.querySelector('.demo__floor-grid');
  const mirror = el.querySelector('.demo__mirror');

  buildTicks(ref.ticks);
  buildRingTicks(ref.ringTicks);
  reveal(el);

  const reduced = prefersReduced();
  let token = 0;
  let played = false;

  /* ---------- state setters ---------- */
  function setRail(p) {
    rail.style.setProperty('--p', Math.max(0, Math.min(1, p)).toFixed(4));
  }
  function setRow(i, state) {
    const row = rowEls[i];
    const c = CHECKS[i];
    row.dataset.state = state;
    const pill = row.querySelector('.dc__pill');
    pill.textContent = state === 'idle' ? 'Waiting' : state === 'checking' ? 'Checking' : c.result;
  }
  function setCount(n) {
    ref.count.textContent = String(n);
    ref.bar.style.transform = `scaleX(${n / CHECKS.length})`;
  }
  function setScore(v, done) {
    const d = `${v.toFixed(2)} 100`;
    ref.ring.setAttribute('stroke-dasharray', d);
    ref.ringGlow.setAttribute('stroke-dasharray', d);
    const a = ((-90 + 3.6 * v) * Math.PI) / 180;
    ref.ringCap.setAttribute('cx', (60 + 50 * Math.cos(a)).toFixed(2));
    ref.ringCap.setAttribute('cy', (60 + 50 * Math.sin(a)).toFixed(2));
    const on = v > 0.5 ? '1' : '0';
    ref.ringCap.style.opacity = on;
    ref.ring.style.opacity = on;
    ref.ringGlow.style.opacity = on;
    ref.score.textContent = done === null ? '--' : String(Math.round(v));
  }
  function setGauge(v) {
    const f = frac(v);
    const d = `${(f * 100).toFixed(2)} 100`;
    ref.gVal.setAttribute('stroke-dasharray', d);
    ref.gGlow.setAttribute('stroke-dasharray', d);
    ref.gVal.style.opacity = f > 0.004 ? '' : '0';
    ref.gGlow.style.opacity = f > 0.004 ? '' : '0';
    ref.needle.setAttribute('transform', `rotate(${(135 + 270 * f).toFixed(2)} 130 130)`);
    ref.gNum.textContent = v.toFixed(1);
  }
  function setPhase(id) {
    const order = STEPS.map((s) => s.id);
    const at = id === 'done' ? order.length : order.indexOf(id);
    stepEls.forEach((s, i) => {
      s.classList.toggle('is-active', i === at);
      s.classList.toggle('is-done', i < at);
      if (i === at) s.setAttribute('aria-current', 'step');
      else s.removeAttribute('aria-current');
    });
    rail.dataset.phase = id;
    win.dataset.phase = id;
    if (id === 'idle') setRail(0);
    if (id === 'done') setRail(1);
  }
  function setFix(done) {
    ref.fix.classList.toggle('is-ready', done);
    ref.fixText.textContent = done
      ? 'Start with remote management: turn off TR-069 in your router’s admin page. Bastion shows where; you make the change.'
      : 'Findings and suggested fixes appear here after the scan.';
  }

  function reset() {
    rowEls.forEach((_, i) => setRow(i, 'idle'));
    setCount(0);
    setScore(0, null);
    setGauge(0);
    setRail(0);
    ref.scoreTag.textContent = 'Scanning';
    ref.scoreTag.className = 'demo__tag';
    ref.scoreNote.textContent = 'Scored when the checks finish.';
    ref.phase.textContent = 'Ready';
    ref.ping.textContent = '--';
    ref.down.textContent = '--';
    ref.up.textContent = '--';
    setFix(false);
  }

  function finishScore() {
    setScore(SCORE, true);
    ref.scoreTag.textContent = 'Needs attention';
    ref.scoreTag.className = 'demo__tag demo__tag--warn';
    ref.scoreNote.textContent = `${FINDINGS} things to review, 1 high risk.`;
  }
  function finishSpeed() {
    setGauge(SPEED.down);
    ref.phase.textContent = 'Download';
    ref.ping.textContent = `${SPEED.ping} ms`;
    ref.down.textContent = SPEED.down.toFixed(1);
    ref.up.textContent = SPEED.up.toFixed(1);
  }

  function showEnd() {
    token++;
    CHECKS.forEach((c, i) => setRow(i, c.tone));
    setCount(CHECKS.length);
    finishScore();
    finishSpeed();
    setFix(true);
    setPhase('done');
    ref.replayLabel.textContent = 'Replay';
    played = true;
  }

  /* ---------- timeline ---------- */
  function wait(ms, my) {
    return new Promise((res) => setTimeout(() => res(my === token), ms));
  }
  function tween(ms, fn, my) {
    if (reduced) {
      fn(1);
      return Promise.resolve(my === token);
    }
    return new Promise((res) => {
      const t0 = performance.now();
      function step(now) {
        if (my !== token) return res(false);
        const p = Math.min(1, (now - t0) / ms);
        fn(p);
        if (p < 1) requestAnimationFrame(step);
        else res(true);
      }
      requestAnimationFrame(step);
    });
  }

  async function runSpeed(my) {
    ref.phase.textContent = 'Ping';
    if (!(await tween(650, (p) => { ref.ping.textContent = `${Math.round(42 - (42 - SPEED.ping) * easeOut(p))} ms`; }, my))) return false;
    ref.phase.textContent = 'Download';
    if (!(await tween(2300, (p) => {
      const v = SPEED.down * (1 - Math.pow(1 - p, 2.4)) + (p < 1 ? Math.sin(p * 38) * SPEED.down * 0.03 * (1 - p) : 0);
      setGauge(Math.max(0, v));
      ref.down.textContent = Math.max(0, v).toFixed(1);
    }, my))) return false;
    ref.phase.textContent = 'Upload';
    if (!(await tween(1700, (p) => {
      const from = SPEED.down;
      const v = p < 0.18 ? from * (1 - p / 0.18) : SPEED.up * (1 - Math.pow(Math.max(0, 1 - (p - 0.18) / 0.82), 2.4));
      setGauge(Math.max(0, v));
      if (p >= 0.18) ref.up.textContent = Math.max(0, v).toFixed(1);
    }, my))) return false;
    ref.phase.textContent = 'Download';
    if (!(await tween(650, (p) => setGauge(SPEED.up + (SPEED.down - SPEED.up) * easeOut(p)), my))) return false;
    finishSpeed();
    return true;
  }

  async function play() {
    const my = ++token;
    played = true;
    reset();
    ref.replayLabel.textContent = 'Restart';
    ref.live.textContent = 'Demo scan started.';
    setPhase('scan');

    // The rail runs node to node: Scan at 0, Understand at .5, Fix at 1.
    const half = 0.5;
    for (let i = 0; i < CHECKS.length; i++) {
      setRow(i, 'checking');
      setRail(half * (i + 0.5) / CHECKS.length);
      if (!(await wait(reduced ? 320 : 560 + (i % 2) * 140, my))) return;
      setRow(i, CHECKS[i].tone);
      setCount(i + 1);
      setRail(half * (i + 1) / CHECKS.length);
      if (!(await wait(reduced ? 80 : 120, my))) return;
    }

    setPhase('understand');
    ref.scoreTag.textContent = 'Scoring';
    ref.scoreNote.textContent = 'Scoring…';
    const SPEED_MS = 650 + 2300 + 1700 + 650;
    const ok = await Promise.all([
      tween(1500, (p) => setScore(SCORE * easeOut(p), true), my).then((r) => { if (r) finishScore(); return r; }),
      runSpeed(my),
      tween(SPEED_MS, (p) => setRail(half + half * 0.92 * p), my),
    ]);
    if (ok.includes(false) || my !== token) return;

    setPhase('fix');
    await tween(reduced ? 0 : 700, (p) => setRail(half + half * (0.92 + 0.08 * easeOut(p))), my);
    if (my !== token) return;
    setFix(true);
    if (!(await wait(reduced ? 0 : 900, my))) return;
    setPhase('done');
    ref.replayLabel.textContent = 'Replay';
    ref.live.textContent = `Demo finished: score ${SCORE} of 100, ${FINDINGS} things to review. Suggested first fix: turn off remote management, TR-069.`;
  }

  ref.replay.addEventListener('click', () => play());

  if (reduced) {
    showEnd();
    return;
  }

  setPhase('idle');
  reset();
  ref.scoreTag.textContent = 'Not scanned';

  /* ---------- staging: rise, tilt into place, land centred, hold ---------- */
  let landed = false;
  function land() {
    if (landed) return;
    landed = true;
    stage.classList.add('is-landed');
    if (!played) play();
  }

  const navH = () => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'));
    return Number.isFinite(v) ? v : 76;
  };
  // Scale window + stepper so the whole set fits between the nav and the bottom edge.
  function fitToViewport() {
    fit.style.setProperty('--fit', '1');
    const h = fit.offsetHeight;
    const room = window.innerHeight - navH() - 40;
    const k = h > 0 ? Math.min(1, room / h) : 1;
    fit.style.setProperty('--fit', Math.max(0.62, k).toFixed(3));
  }
  // where the set's centre sits when it lands: the middle of the space under the nav
  const anchor = () => `center ${(50 + (navH() / window.innerHeight) * 50).toFixed(1)}%`;

  let staged = false;
  try {
    const mm = gsap.matchMedia();
    mm.add(STAGED_MQ, () => {
      staged = true;
      el.classList.add('is-staged');
      fitToViewport();
      ScrollTrigger.addEventListener('refreshInit', fitToViewport);

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: stage,
          start: 'top bottom',
          end: anchor,
          scrub: 0.6,
          invalidateOnRefresh: true,
          onUpdate(self) {
            // land near the end of the rise, and only once the whole set is really on screen
            // (positions can be briefly stale while lazy content above settles)
            if (landed || self.progress < 0.9) return;
            if (fit.getBoundingClientRect().bottom < window.innerHeight + 60) land();
          },
          onLeave: land,
        },
      });
      tl.fromTo(tilt, { rotateX: 26, y: 150, scale: 0.84, transformOrigin: '50% 100%' }, { rotateX: 0, y: 0, scale: 1, ease: 'none' }, 0)
        .fromTo([beam, mirror], { opacity: 0.15 }, { opacity: 1, ease: 'power2.in' }, 0)
        .fromTo(floor, { opacity: 0.2 }, { opacity: 1, ease: 'none' }, 0)
        .fromTo(rail, { opacity: 0.4, y: 40 }, { opacity: 1, y: 0, ease: 'power1.in' }, 0);

      // Short hold: window, floor light and flare in one frame while the replay starts.
      const hold = gsap.timeline({
        scrollTrigger: {
          trigger: stage,
          start: anchor,
          end: () => `+=${Math.round(window.innerHeight * 0.55)}`,
          pin: true,
          anticipatePin: 1,
          scrub: 0.6,
          invalidateOnRefresh: true,
          onEnter: land,
        },
      });
      hold.fromTo(floorGridEl, { y: 0 }, { y: 22, ease: 'none' }, 0);

      return () => {
        staged = false;
        el.classList.remove('is-staged');
        fit.style.removeProperty('--fit');
        ScrollTrigger.removeEventListener('refreshInit', fitToViewport);
      };
    });
  } catch (err) {
    staged = false;
  }

  // Start the replay when the window is seen: right away in the stacked layout, and as a safety
  // net when staged (if the scroll staging never runs: no ScrollTrigger, odd scroller).
  if ('IntersectionObserver' in window) {
    let t = 0;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.some((e) => e.isIntersecting);
        clearTimeout(t);
        if (vis && !landed) t = setTimeout(land, staged ? 4000 : 250);
        if (landed) io.disconnect();
      },
      { threshold: 0.3 },
    );
    io.observe(win);
  } else {
    land();
  }

  /* ---------- pointer: gentle parallax tilt + specular glare once landed ---------- */
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const glare = win.querySelector('.demo__glare');
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let gx = 50;
    let gy = 0;
    let active = false;
    const loop = () => {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      win.style.transform = `rotateX(${(-cy * 3).toFixed(3)}deg) rotateY(${(cx * 4).toFixed(3)}deg)`;
      glare.style.setProperty('--gx', `${gx.toFixed(1)}%`);
      glare.style.setProperty('--gy', `${gy.toFixed(1)}%`);
      if (active || Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) raf = requestAnimationFrame(loop);
      else raf = 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    win.addEventListener('pointermove', (e) => {
      if (!landed || e.pointerType !== 'mouse') return;
      const r = win.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      tx = nx - 0.5;
      ty = ny - 0.5;
      gx = nx * 100;
      gy = ny * 100;
      active = true;
      win.classList.add('is-hover');
      kick();
    });
    win.addEventListener('pointerleave', () => {
      tx = 0;
      ty = 0;
      active = false;
      win.classList.remove('is-hover');
      kick();
    });
  }
}

function buildTicks(g) {
  // minor ticks every 270/30 degrees
  for (let i = 0; i <= 30; i++) {
    if (i % 6 === 0) continue;
    const a = ((135 + 9 * i) * Math.PI) / 180;
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', (130 + 84 * Math.cos(a)).toFixed(1));
    l.setAttribute('y1', (130 + 84 * Math.sin(a)).toFixed(1));
    l.setAttribute('x2', (130 + 81 * Math.cos(a)).toFixed(1));
    l.setAttribute('y2', (130 + 81 * Math.sin(a)).toFixed(1));
    l.setAttribute('class', 'gauge__mark gauge__mark--minor');
    g.appendChild(l);
  }
  for (let i = 0; i < STOPS.length; i++) {
    const a = ((135 + (270 * i) / (STOPS.length - 1)) * Math.PI) / 180;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', (130 + 124 * Math.cos(a)).toFixed(1));
    t.setAttribute('y', (130 + 124 * Math.sin(a) + 4).toFixed(1));
    t.setAttribute('text-anchor', Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) < 0 ? 'end' : 'start');
    t.setAttribute('class', 'gauge__tick');
    t.textContent = STOP_LABELS[i];
    g.appendChild(t);
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', (130 + 86 * Math.cos(a)).toFixed(1));
    l.setAttribute('y1', (130 + 86 * Math.sin(a)).toFixed(1));
    l.setAttribute('x2', (130 + 78 * Math.cos(a)).toFixed(1));
    l.setAttribute('y2', (130 + 78 * Math.sin(a)).toFixed(1));
    l.setAttribute('class', 'gauge__mark');
    g.appendChild(l);
  }
}

// Floor grid drawn in perspective: lines converge on a vanishing point above the window,
// cross lines bunch up toward the horizon (the window's bottom edge).
function floorGrid() {
  const W = 1200;
  const H = 300;
  const vy = -240;
  let d = '';
  for (let x = -1800; x <= 3000; x += 90) {
    const s = -vy / (H - vy);
    d += `M${(600 + (x - 600) * s).toFixed(1)} 0L${x} ${H}`;
  }
  for (let k = 1; k <= 9; k++) {
    const y = H * Math.pow(k / 9, 1.9);
    d += `M0 ${y.toFixed(1)}H${W}`;
  }
  return `<svg class="demo__floor-grid" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" focusable="false"><path d="${d}"/></svg>`;
}

function buildRingTicks(g) {
  for (let i = 0; i < 60; i++) {
    const a = (i * 6 * Math.PI) / 180;
    const major = i % 5 === 0;
    const r1 = 58.5;
    const r2 = major ? 55.5 : 57;
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', (60 + r1 * Math.cos(a)).toFixed(2));
    l.setAttribute('y1', (60 + r1 * Math.sin(a)).toFixed(2));
    l.setAttribute('x2', (60 + r2 * Math.cos(a)).toFixed(2));
    l.setAttribute('y2', (60 + r2 * Math.sin(a)).toFixed(2));
    if (major) l.setAttribute('class', 'is-major');
    g.appendChild(l);
  }
}

export default mount;
