// How it works: a labelled replay of a Bastion scan with sample data. The check list ticks in
// order, the score ring counts up and the speed gauge sweeps. It starts when scrolled into view;
// with reduced motion it opens on the finished state and Replay steps through without tweening.

import { reveal } from '../fx/reveal.js';

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
const ARC = 'M59.29 200.71 A100 100 0 1 1 200.71 200.71';

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

const ICON_REPLAY =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

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
        <span class="demo__num" aria-hidden="true">0${i + 1}</span>
        <div class="demo__step-b">
          <h3 class="demo__step-t">${s.title}</h3>
          <p class="demo__step-p">${s.text}</p>
        </div>
      </li>`,
  ).join('');

  el.setAttribute('aria-labelledby', `${uid}-title`);
  el.innerHTML = `
    <div class="container">
      <header class="sec-head demo__head" data-reveal>
        <p class="eyebrow">How it works</p>
        <h2 class="display-l" id="${uid}-title">See what is open. Then decide what to close.</h2>
        <p class="lead">One scan from your own computer, findings in plain words, and fixes you carry out yourself. This is a replay with sample data, so you can see it before you install anything.</p>
      </header>

      <div class="demo__grid">
        <ol class="demo__steps" role="list" data-reveal>${steps}</ol>

        <figure class="demo__win" aria-labelledby="${uid}-cap" data-reveal="scale">
          <figcaption id="${uid}-cap" class="sr-only">Demo with sample data: a replay of a Bastion network check. It finds remote management open on port 7547, three UPnP forwards, unencrypted DNS, Telnet closed, seven neighbouring networks on Wi-Fi channel 36 and a network name without the _nomap suffix. Score ${SCORE} out of 100. Speed test: ${SPEED.down} megabits per second down, ${SPEED.up} up, ${SPEED.ping} milliseconds ping.</figcaption>

          <div class="demo__chrome">
            <span class="demo__lights" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="demo__app">Bastion</span>
            <span class="demo__badge">Demo with sample data</span>
          </div>

          <div class="demo__body" aria-hidden="true">
            <section class="demo__panel demo__checks">
              <div class="demo__ph">
                <h4>Network check</h4>
                <span class="demo__count"><b data-ref="count">0</b> / ${CHECKS.length}</span>
              </div>
              <div class="demo__bar"><span data-ref="bar"></span></div>
              <ol class="demo__list" role="list">${rows}</ol>
            </section>

            <div class="demo__side">
              <section class="demo__panel demo__score">
                <div class="demo__ph"><h4>Score</h4><span class="demo__tag" data-ref="scoreTag">Not scanned</span></div>
                <div class="ring">
                  <svg viewBox="0 0 120 120">
                    <defs>
                      <linearGradient id="${uid}-ring" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stop-color="#FF5FD2"/>
                        <stop offset=".45" stop-color="#7C6CFF"/>
                        <stop offset="1" stop-color="#8FD3FF"/>
                      </linearGradient>
                    </defs>
                    <circle class="ring__track" cx="60" cy="60" r="50" pathLength="100"/>
                    <circle class="ring__val" data-ref="ring" cx="60" cy="60" r="50" pathLength="100" stroke="url(#${uid}-ring)" stroke-dasharray="0 100" transform="rotate(-90 60 60)"/>
                  </svg>
                  <div class="ring__read"><b data-ref="score">--</b><span>of 100</span></div>
                </div>
                <p class="demo__small" data-ref="scoreNote">Waiting for the scan.</p>
              </section>

              <section class="demo__panel demo__speed">
                <div class="demo__ph"><h4>Speed test</h4><span class="demo__tag">Cloudflare</span></div>
                <div class="gauge">
                  <svg viewBox="0 0 260 232">
                    <defs>
                      <linearGradient id="${uid}-gauge" x1="0" y1="1" x2="1" y2="0">
                        <stop offset="0" stop-color="#8FD3FF"/>
                        <stop offset=".55" stop-color="#7C6CFF"/>
                        <stop offset="1" stop-color="#D3C8FF"/>
                      </linearGradient>
                    </defs>
                    <path class="gauge__track" d="${ARC}" pathLength="100"/>
                    <path class="gauge__val" data-ref="gVal" d="${ARC}" pathLength="100" stroke="url(#${uid}-gauge)" stroke-dasharray="0 100"/>
                    <g data-ref="ticks"></g>
                    <g class="gauge__needle" data-ref="needle" transform="rotate(135 130 130)"><line x1="130" y1="130" x2="192" y2="130"/><circle cx="130" cy="130" r="7"/></g>
                  </svg>
                  <div class="gauge__read"><span data-ref="phase">Ready</span><b data-ref="gNum">0.0</b><small>Mbps</small></div>
                </div>
                <dl class="trio">
                  <div><dt>Ping</dt><dd data-ref="ping">--</dd></div>
                  <div><dt>Down</dt><dd data-ref="down">--</dd></div>
                  <div><dt>Up</dt><dd data-ref="up">--</dd></div>
                </dl>
              </section>
            </div>
          </div>

          <div class="demo__foot">
            <p class="demo__fix" data-ref="fix">
              <span class="demo__fix-k">Next</span>
              <span data-ref="fixText">Findings and suggested fixes appear here after the scan.</span>
            </p>
            <button type="button" class="btn btn--ghost btn--sm demo__replay" data-ref="replay">${ICON_REPLAY}<span data-ref="replayLabel">Play demo</span></button>
          </div>
          <p class="sr-only" aria-live="polite" data-ref="live"></p>
        </figure>
      </div>
    </div>
  `;

  const ref = {};
  el.querySelectorAll('[data-ref]').forEach((n) => {
    ref[n.dataset.ref] = n;
  });
  const rowEls = Array.from(el.querySelectorAll('.dc'));
  const stepEls = Array.from(el.querySelectorAll('.demo__step'));
  const win = el.querySelector('.demo__win');

  buildTicks(ref.ticks);
  reveal(el);

  const reduced = prefersReduced();
  let token = 0;
  let played = false;

  /* ---------- state setters ---------- */
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
    ref.ring.setAttribute('stroke-dasharray', `${v.toFixed(2)} 100`);
    ref.score.textContent = done === null ? '--' : String(Math.round(v));
  }
  function setGauge(v) {
    const f = frac(v);
    ref.gVal.setAttribute('stroke-dasharray', `${(f * 100).toFixed(2)} 100`);
    ref.needle.setAttribute('transform', `rotate(${(135 + 270 * f).toFixed(2)} 130 130)`);
    ref.gNum.textContent = v.toFixed(1);
  }
  function setPhase(id) {
    const order = STEPS.map((s) => s.id);
    const at = id === 'done' ? order.length : order.indexOf(id);
    stepEls.forEach((s, i) => {
      s.classList.toggle('is-active', i === at);
      s.classList.toggle('is-done', i < at);
    });
    win.dataset.phase = id;
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
    ref.scoreTag.textContent = 'Scanning';
    ref.scoreTag.className = 'demo__tag';
    ref.scoreNote.textContent = 'Waiting for the scan.';
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
      const v = p < 0.18 ? from * (1 - p / 0.18) : SPEED.up * (1 - Math.pow(1 - (p - 0.18) / 0.82, 2.4));
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

    for (let i = 0; i < CHECKS.length; i++) {
      setRow(i, 'checking');
      if (!(await wait(reduced ? 320 : 560 + (i % 2) * 140, my))) return;
      setRow(i, CHECKS[i].tone);
      setCount(i + 1);
      if (!(await wait(reduced ? 80 : 120, my))) return;
    }

    setPhase('understand');
    ref.scoreTag.textContent = 'Scoring';
    const ok = await Promise.all([
      tween(1500, (p) => setScore(SCORE * easeOut(p), true), my).then((r) => { if (r) finishScore(); return r; }),
      runSpeed(my),
    ]);
    if (ok.includes(false) || my !== token) return;

    if (!(await wait(reduced ? 0 : 300, my))) return;
    setFix(true);
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

  if (!('IntersectionObserver' in window)) {
    play();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && !played) {
        io.disconnect();
        play();
      }
    },
    { threshold: 0.15 },
  );
  io.observe(win);
}

function buildTicks(g) {
  for (let i = 0; i < STOPS.length; i++) {
    const a = ((135 + (270 * i) / (STOPS.length - 1)) * Math.PI) / 180;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', (130 + 122 * Math.cos(a)).toFixed(1));
    t.setAttribute('y', (130 + 122 * Math.sin(a) + 4).toFixed(1));
    t.setAttribute('text-anchor', Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) < 0 ? 'end' : 'start');
    t.setAttribute('class', 'gauge__tick');
    t.textContent = STOP_LABELS[i];
    g.appendChild(t);
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', (130 + 86 * Math.cos(a)).toFixed(1));
    l.setAttribute('y1', (130 + 86 * Math.sin(a)).toFixed(1));
    l.setAttribute('x2', (130 + 79 * Math.cos(a)).toFixed(1));
    l.setAttribute('y2', (130 + 79 * Math.sin(a)).toFixed(1));
    l.setAttribute('class', 'gauge__mark');
    g.appendChild(l);
  }
}

export default mount;
