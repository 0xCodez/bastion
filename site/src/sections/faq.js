import { reveal } from '../fx/reveal.js';
import { flare } from '../fx/flare.js';

/* faq: native <details> accordion. Opening a question decodes its text, the answer rises line by
   line out of masks, a lit band springs to the open item, and the ASCII planet beside the intro
   turns to that question's spot where a beacon pings. Works without JS; JS only adds motion. */

const REPO = 'https://github.com/0xCodez/bastion';
const RELEASES = `${REPO}/releases/latest`;

const QA = [
  {
    q: 'Is it really free?',
    a: `<p>Yes. Bastion is free and open source under the MIT licence, and there is no account to create. If you use the AI watchers, your AI provider bills your own key for what you use. Bastion adds nothing on top and never sees the bill.</p>`,
  },
  {
    q: 'Does it change my router settings?',
    a: `<p>No. Bastion never logs in to your router, never tries a password and never changes a setting on its own. Each fix is a guided fix: the steps, plus a button that opens the right settings page or your router’s admin page. You make the change.</p>`,
  },
  {
    q: 'Do I need an API key?',
    a: `<p>No. The scan, the connections view, the Wi-Fi channel advice and the speed test all work without one. A key from Anthropic, OpenAI or xAI is only needed for the AI watchers, and you can add or remove it at any time.</p>`,
  },
  {
    q: 'Which AI is best?',
    a: `<p>The one you already have a key for. Claude, ChatGPT and Grok all receive the same trimmed snapshot of your scan and can answer the same questions. You can connect more than one and ask each of them, then see where they agree.</p>`,
  },
  {
    q: 'Will it slow my network?',
    a: `<p>No. The scan talks only to your router’s local address and uses standard local discovery, so it is light. The one thing that uses real bandwidth is the speed test, and it only runs when you press the button.</p>`,
  },
  {
    q: 'Does it work on macOS?',
    a: `<p>Yes. There are builds for macOS 13 and later, for both Apple Silicon and Intel, and for Windows 10 and 11. The builds are not code-signed yet, so the first launch shows a system warning; the <a href="${REPO}#install" rel="noopener">install notes</a> walk you through it.</p>`,
  },
  {
    q: 'Can it see my family’s traffic?',
    a: `<p>Not yet. Bastion sees which programs on your computer connect where. Seeing traffic from phones, TVs and other devices needs router integration, which is on the roadmap.</p><p>It also can’t prove from inside your network that a port is reachable from the internet. When that matters, the finding says so plainly.</p>`,
  },
  {
    q: 'Why open source?',
    a: `<p>Because a tool that looks at your network should be one you can read. Every line is on <a href="${REPO}" rel="noopener">GitHub</a>: you can check exactly what leaves your machine, build it yourself, or report a problem.</p>`,
  },
];

const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';

/* ---------- answer text: every word in its own mask, so lines can rise one after another ---------- */
function splitWords(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (!n.nodeValue.trim()) continue;
    const frag = document.createDocumentFragment();
    for (const part of n.nodeValue.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
      const w = document.createElement('span');
      w.className = 'fq-w';
      const wi = document.createElement('span');
      wi.className = 'fq-wi';
      wi.textContent = part;
      w.appendChild(wi);
      frag.appendChild(w);
    }
    n.parentNode.replaceChild(frag, n);
  }
}
function riseLines(inner) {
  const words = [...inner.querySelectorAll('.fq-wi')];
  let line = -1;
  let lastTop = -1e9;
  for (const wi of words) {
    const top = wi.parentNode.getBoundingClientRect().top;
    if (Math.abs(top - lastTop) > 4) { line++; lastTop = top; }
    wi.animate(
      [{ transform: 'translate3d(0,108%,0)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 640, delay: 110 + line * 75, easing: EASE_OUT, fill: 'backwards' },
    );
  }
}

/* ---------- question decode: a short wave of glyphs resolves into the question ---------- */
const GLYPHS = 'abcdefghkmnoprstuvxz0123456789#%/<>*+=';
function decode(node, text) {
  if (node._dec) cancelAnimationFrame(node._dec);
  const n = text.length;
  const WIN = 5;
  const dur = Math.min(640, 240 + n * 12);
  const t0 = performance.now();
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const cur = Math.floor(k * (n + WIN));
    let done = '';
    let wave = '';
    for (let i = 0; i < Math.min(cur, n); i++) {
      if (i < cur - WIN) done += text[i];
      else wave += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    const rest = text.slice(Math.min(cur, n));
    node.innerHTML = `${esc(done)}<span class="fq-dec">${esc(wave)}</span><span class="fq-rest">${esc(rest)}</span>`;
    if (k < 1) node._dec = requestAnimationFrame(tick);
    else { node._dec = 0; node.textContent = text; }
  };
  node._dec = requestAnimationFrame(tick);
}

/* Smooth open/close for <details>. Native behaviour stays the source of truth; a click while the
   panel is moving reverses it from its current height, not from either end. */
function animate(details, onOpen) {
  const summary = details.querySelector('summary');
  const body = details.querySelector('.fq-a');
  const inner = details.querySelector('.fq-ai');
  let anim = null;
  let anim2 = null;
  let state = 'idle'; // 'opening' | 'closing' | 'idle'

  const stop = () => {
    const h = body.getBoundingClientRect().height; // where it is mid-flight
    if (anim) { anim.onfinish = null; anim.cancel(); anim = null; }
    if (anim2) { anim2.cancel(); anim2 = null; }
    return h;
  };

  summary.addEventListener('click', (e) => {
    if (RM.matches || !body.animate) return;
    e.preventDefault();
    const closing = state === 'opening' || (state === 'idle' && details.open);
    const from = state === 'idle' ? (details.open ? body.offsetHeight : 0) : stop();
    if (closing) {
      state = 'closing';
      details.classList.add('is-closing');
      details.dispatchEvent(new CustomEvent('fq:closing'));
      anim = body.animate([{ height: `${from}px` }, { height: '0px' }], { duration: 260 + Math.min(160, from * 0.4), easing: 'cubic-bezier(.4,0,.2,1)' });
      anim2 = inner.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
      anim.onfinish = () => {
        details.open = false;
        details.classList.remove('is-closing');
        state = 'idle';
        anim = null;
        if (anim2) { anim2.cancel(); anim2 = null; }
      };
    } else {
      state = 'opening';
      const reopening = details.open; // reversed mid-close: the answer is still in place
      details.classList.remove('is-closing');
      details.open = true;
      const h = inner.offsetHeight;
      anim = body.animate([{ height: `${from}px` }, { height: `${h}px` }], { duration: 560, easing: EASE_OUT });
      if (reopening) details.dispatchEvent(new Event('toggle'));
      else onOpen(inner);
      anim.onfinish = () => { state = 'idle'; anim = null; };
    }
  });
}

/* ---------- ASCII planet beside the intro (decorative, paused off screen) ----------
   Smooth continents from a few plane waves on the unit sphere (no seams at the poles), a fine
   character ramp and a dark ocean. Opening a question turns the planet to that question's spot and
   a beacon pings there. */
function asciiPlanet(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const RAMP = ' .:-=+*xX#';
  const reduced = RM.matches;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let rot = 0.6;
  let vel = 0;
  let target = 0.6;
  let beacon = -1;
  let ping = 0;
  const TILT = -0.32;
  const LAND = 0.8; // height above which a cell is land (about a third of the globe)
  // plane waves: direction, frequency, phase, weight
  const WAVES = [
    [0.8, 0.3, 0.5, 1.6, 0.4, 1], [-0.4, 0.9, 0.2, 1.9, 2.1, 0.8], [0.3, -0.5, 0.8, 2.6, 4.2, 0.55],
    [-0.7, -0.2, 0.6, 3.4, 1.3, 0.35], [0.1, 0.7, -0.7, 5.2, 0.7, 0.2], [0.6, -0.6, -0.5, 7.5, 3.3, 0.12],
  ].map(([x, y, z, f, p, w]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l, f, p, w]; });
  const land = (x, y, z) => {
    let v = 0;
    for (const [dx, dy, dz, f, p, w] of WAVES) v += w * Math.sin((dx * x + dy * y + dz * z) * f + p);
    return v;
  };
  // each question's beacon: a longitude / latitude on the globe
  const SPOTS = QA.map((_, i) => [i * 2.1 + 0.4, Math.sin(i * 1.7) * 0.45]);

  function size() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = Math.min(W * 0.31, H * 0.41);
    const cw = 5.6;
    const chh = 8;
    ctx.font = '500 8px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);

    const orbit = (front) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * 1.6, R * 0.36, TILT, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      ctx.strokeStyle = front ? 'rgba(183,169,255,.42)' : 'rgba(183,169,255,.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    orbit(false);

    // atmosphere
    const g0 = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.24);
    g0.addColorStop(0, 'rgba(124,108,255,.26)');
    g0.addColorStop(1, 'rgba(124,108,255,0)');
    ctx.fillStyle = g0;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.24, 0, Math.PI * 2);
    ctx.fill();

    for (let py = cy - R; py <= cy + R; py += chh) {
      const ny = (py - cy) / R;
      for (let px = cx - R; px <= cx + R; px += cw) {
        const nx = (px - cx) / R;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        // the view point in planet space (spin about the vertical axis)
        const x = nx * cr + nz * sr;
        const z = -nx * sr + nz * cr;
        const h = land(x, ny, z);
        const light = Math.max(0, -nx * 0.5 - ny * 0.45 + nz * 0.74);
        const rimL = Math.pow(1 - nz, 4) * 0.5;
        if (h > LAND) {
          // land: brightness from the light, with relief (higher ground a step brighter)
          const relief = Math.min(1, (h - LAND) * 0.9);
          const v = Math.min(1, 0.12 + light * (0.5 + relief * 0.36) + rimL);
          const idx = Math.max(2, Math.round(v * (RAMP.length - 1)));
          ctx.fillStyle = v > 0.7 ? `rgba(244,241,255,${(0.45 + v * 0.5).toFixed(2)})` : `rgba(183,169,255,${(0.28 + v * 0.62).toFixed(2)})`;
          ctx.fillText(RAMP[idx], px, py);
        } else {
          // ocean: sparse and dark, only where the light or the rim catches it
          const v = light * 0.36 + rimL * 0.8;
          if (v < 0.1 || ((px / cw + py / chh) | 0) % 2) continue;
          ctx.fillStyle = `rgba(96,116,255,${(0.08 + v * 0.4).toFixed(2)})`;
          ctx.fillText(v > 0.3 ? '~' : '.', px, py);
        }
      }
    }
    orbit(true);

    // beacon on the open question's spot
    if (beacon >= 0) {
      const [lon, lat] = SPOTS[beacon];
      const cl = Math.cos(lat);
      const x0 = Math.sin(lon) * cl;
      const z0 = Math.cos(lon) * cl;
      const y0 = Math.sin(lat);
      // planet space -> view (inverse of the spin above)
      const vx = x0 * cr - z0 * sr;
      const vz = x0 * sr + z0 * cr;
      if (vz > 0.05) {
        const bx = cx + vx * R;
        const by = cy + y0 * R;
        const a = Math.min(1, vz * 2.2);
        for (let k = 0; k < 2; k++) {
          const t = (ping + k * 0.5) % 1;
          const rr = 3 + t * 24;
          ctx.beginPath();
          ctx.ellipse(bx, by, rr, rr * (0.45 + vz * 0.55), 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(158,240,196,${((1 - t) * 0.85 * a).toFixed(3)})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, 11);
        g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
        g.addColorStop(0.35, `rgba(158,240,196,${(0.8 * a).toFixed(3)})`);
        g.addColorStop(1, 'rgba(158,240,196,0)');
        ctx.fillStyle = g;
        ctx.fillRect(bx - 11, by - 11, 22, 22);
      }
    }

    // a small moon on the orbit, hidden while it passes behind the planet
    const t = rot * 1.7;
    const mx = Math.cos(t) * R * 1.6;
    const my = Math.sin(t) * R * 0.36;
    const c = Math.cos(TILT);
    const s = Math.sin(TILT);
    const ox = cx + mx * c - my * s;
    const oy = cy + mx * s + my * c;
    if (!(Math.sin(t) < 0 && Math.hypot(ox - cx, oy - cy) < R)) {
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, 11);
      g.addColorStop(0, 'rgba(255,255,255,.95)');
      g.addColorStop(0.3, 'rgba(143,211,255,.7)');
      g.addColorStop(1, 'rgba(143,211,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ox - 11, oy - 11, 22, 22);
    }
  }

  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    target += dt * 0.1; // slow idle spin
    // critically damped spring toward the target longitude
    const k = 3.2;
    vel += ((target - rot) * k * k - 2 * k * vel) * dt;
    rot += vel * dt;
    ping = (ping + dt * 0.55) % 1;
    acc += dt;
    if (acc < 1 / 30) return; // 30fps is plenty for text
    acc = 0;
    draw();
  };

  size();
  draw();
  if ('ResizeObserver' in window) new ResizeObserver(() => { size(); draw(); }).observe(canvas);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  const api = {
    focus(i) {
      beacon = i;
      if (i >= 0) {
        // the shortest forward turn that brings the spot to the lit side of the front
        const tau = Math.PI * 2;
        let want = SPOTS[i][0] - 0.35;
        want += Math.ceil((rot - 0.3 - want) / tau) * tau;
        target = want;
      }
      if (reduced || !raf) { if (reduced) rot = target; draw(); }
    },
  };
  if (reduced || !('IntersectionObserver' in window)) return api;
  new IntersectionObserver((es) => {
    for (const e of es) {
      if (e.isIntersecting && !raf) { last = 0; raf = requestAnimationFrame(loop); }
      else if (!e.isIntersecting) { cancelAnimationFrame(raf); raf = 0; }
    }
  }).observe(canvas);
  return api;
}

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'faq-title');

  const items = QA.map(
    (x, i) => `
        <details class="fq-item" id="faq-${i + 1}"${i === 0 ? ' open' : ''}>
          <summary class="fq-q">
            <span class="fq-n mono" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
            <span class="fq-qt"><span class="sr-only">${x.q}</span><span class="fq-qv" aria-hidden="true">${x.q}</span></span>
            <span class="fq-plus" aria-hidden="true"></span>
          </summary>
          <div class="fq-a"><div class="fq-ai">${x.a}</div></div>
        </details>`,
  ).join('');

  el.innerHTML = `
    <div class="container fq">
      <header class="fq-intro" data-reveal>
        <p class="eyebrow">Questions</p>
        <h2 class="display-l" id="faq-title">Straight answers</h2>
        <p class="lead">The things people ask before they install a network tool, answered without the small print.</p>
        <div class="fq-links">
          <a class="btn btn--ghost btn--sm" href="${REPO}/issues" rel="noopener">Ask on GitHub</a>
          <a class="fq-link" href="${RELEASES}" rel="noopener">Latest release notes</a>
        </div>
        <canvas class="fq-planet" aria-hidden="true"></canvas>
      </header>
      <div class="fq-list" data-reveal style="--reveal-delay:.08s">
        <span class="fq-band" aria-hidden="true"><i class="fq-band__fill"></i><i class="fq-band__edge"></i><i class="fq-band__edge fq-band__edge--b"></i><i class="fq-band__lamp"></i></span>${items}
      </div>
    </div>`;

  const list = el.querySelector('.fq-list');
  const band = el.querySelector('.fq-band');
  const details = [...el.querySelectorAll('.fq-item')];
  if (!RM.matches) details.forEach((d) => splitWords(d.querySelector('.fq-ai')));

  let planet = null;
  let current = null;

  /* A lit band that slides to the open answer with a little inertia (spring on y and height). */
  const B = { y: 0, h: 0, vy: 0, vh: 0, placed: false };
  let braf = 0;
  let blast = 0;
  let trackUntil = 0;
  const place = () => {
    band.style.transform = `translate3d(0, ${B.y.toFixed(1)}px, 0)`;
    band.style.height = `${Math.max(0, B.h).toFixed(1)}px`;
  };
  function bandStep(now) {
    const dt = blast ? Math.min(0.04, (now - blast) / 1000) : 0.016;
    blast = now;
    if (!current) { braf = 0; return; }
    const ty = current.offsetTop;
    const th = current.offsetHeight;
    const k = 12;
    const z = 0.6; // under-damped: it overshoots a touch and settles
    B.vy += ((ty - B.y) * k * k - 2 * z * k * B.vy) * dt;
    B.vh += ((th - B.h) * k * k - 2 * z * k * B.vh) * dt;
    B.y += B.vy * dt;
    B.h += B.vh * dt;
    place();
    const moving = Math.abs(ty - B.y) > 0.3 || Math.abs(th - B.h) > 0.3 || Math.abs(B.vy) > 3 || Math.abs(B.vh) > 3;
    // keep tracking while an answer's height animates
    braf = moving || now < trackUntil ? requestAnimationFrame(bandStep) : 0;
  }
  function follow(jump = false) {
    if (planet) planet.focus(current ? details.indexOf(current) : -1);
    band.classList.toggle('is-on', !!current);
    if (!current) return;
    if (jump || RM.matches || !B.placed) {
      B.y = current.offsetTop; B.h = current.offsetHeight; B.vy = 0; B.vh = 0; B.placed = true;
      place();
      if (jump || RM.matches) return;
    }
    trackUntil = performance.now() + 800;
    if (!braf) { blast = 0; braf = requestAnimationFrame(bandStep); }
  }
  const openItems = () => details.filter((d) => d.open && !d.classList.contains('is-closing'));

  details.forEach((d) => {
    const qv = d.querySelector('.fq-qv');
    const text = qv.textContent;
    animate(d, (inner) => {
      decode(qv, text);
      riseLines(inner);
    });
    d.addEventListener('toggle', () => {
      if (d.open && !d.classList.contains('is-closing')) current = d;
      else if (d === current) current = openItems().pop() || null;
      follow();
    });
    d.addEventListener('fq:closing', () => {
      if (d === current) current = openItems().pop() || null;
      follow();
    });
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      flare(d.querySelector('.fq-q'), { y: 1, color: '#B7A9FF' });
    }
  });
  current = openItems().pop() || null;
  // first placement once layout has settled (fonts, late layout); no spring on these
  requestAnimationFrame(() => follow(true));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => follow(true));
  if ('ResizeObserver' in window) {
    let w = 0;
    new ResizeObserver((es) => {
      const nw = es[0].contentRect.width;
      if (nw !== w) { w = nw; if (!braf) follow(true); }
    }).observe(list);
  }

  const canvas = el.querySelector('.fq-planet');
  const startPlanet = () => {
    planet = asciiPlanet(canvas);
    if (planet) planet.focus(current ? details.indexOf(current) : -1);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); startPlanet(); }
    }, { rootMargin: '400px 0px' });
    io.observe(canvas);
  } else startPlanet();

  reveal(el);
}
