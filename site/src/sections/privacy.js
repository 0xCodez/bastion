import { reveal } from '../fx/reveal.js';
import { ScrollTrigger, isReduced } from '../fx/scroll.js';

/* privacy: a frosted-glass vault holds the network data (particles that bounce off its inner wall);
   three thin beams of light leave it and land on the three things that do go out. The full factual
   list is real text next to the visual; the canvas and orb are decorative.
   Facts match the app's README and agents/prompt.js. */

const REPO = 'https://github.com/0xCodez/bastion';

const OUT = [
  {
    what: 'Speed test',
    to: 'Cloudflare',
    host: 'speed.cloudflare.com',
    when: 'Only when you press Run speed test',
    sent: 'Test traffic. Cloudflare sees your IP address, as any website you open would.',
    tone: 'sky',
    hex: '#8FD3FF',
  },
  {
    what: 'Public IP lookup',
    to: 'ipify',
    host: 'api.ipify.org',
    when: 'When the overview loads',
    sent: 'One request that returns your public IP address, so Bastion can show it to you.',
    tone: 'lavender',
    hex: '#B7A9FF',
  },
  {
    what: 'AI requests',
    to: 'Anthropic, OpenAI or xAI',
    host: 'the provider you picked',
    when: 'Only when you ask an agent a question',
    sent: 'Your question and a trimmed snapshot of the scan, sent with your own key. MAC addresses are removed and your public IP is cut to its first three parts.',
    tone: 'amber',
    hex: '#FFC772',
    masked: true,
  },
];

const NEVER = [
  'Full MAC addresses of your devices',
  'Device names and this computer’s name',
  'Wi-Fi network names and router hardware IDs (BSSIDs)',
  'The last part of your public IP, in any AI request',
  'Anything at all to a Bastion server, because there isn’t one',
];

const ICON = {
  lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/></svg>',
};

/* ---------- vault canvas ---------- */
const KINDS = [
  { c: '#B7A9FF', n: 22 }, // scan
  { c: '#9EF0C4', n: 18 }, // devices
  { c: '#8FD3FF', n: 18 }, // Wi-Fi
];
const TAGS = ['MAC', 'device name', 'SSID', 'BSSID', 'PC name', 'last IP part'];
// which particles light up for each line of "What never leaves" (-1 = the whole vault)
const NEVER_TAGS = [['MAC'], ['device name', 'PC name'], ['SSID', 'BSSID'], ['last IP part'], -1];

function sprite(color, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.18, color);
  grd.addColorStop(0.45, color + '55');
  grd.addColorStop(1, color + '00');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

function bez(p, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
    y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
  };
}

function vault(stage) {
  const canvas = stage.querySelector('.pv-canvas');
  const orb = stage.querySelector('.pv-orb');
  const ports = [...stage.querySelectorAll('.pv-port')];
  const items = [...stage.querySelectorAll('.pv-beam')];
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduced = isReduced();
  const sprites = KINDS.map((k) => sprite(k.c));
  const beamSprites = OUT.map((o) => sprite(o.hex));

  let W = 0, H = 0, dpr = 1;
  let C = { x: 0, y: 0, r: 100 };
  let beams = [];
  let draw = reduced ? 1 : 0; // how far the beams have drawn in (0..1), scrubbed by scroll

  // particles live in orb-relative unit coordinates (radius 1)
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const parts = [];
  KINDS.forEach((k, ki) => {
    for (let i = 0; i < k.n; i++) {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 0.8, sp = 0.05 + rand() * 0.11, va = rand() * Math.PI * 2;
      parts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: Math.cos(va) * sp, vy: Math.sin(va) * sp, k: ki, s: 0.6 + rand() * 0.9, tag: null });
    }
  });
  TAGS.forEach((t, i) => { parts[i * 9 + 1].tag = t; parts[i * 9 + 1].s = 1.5; });
  const ripples = [];
  let hi = null; // highlighted tags, from the "What never leaves" list
  let hiT = 0;

  function layout() {
    // everything is measured against the canvas, which on narrow screens reaches into the page
    // gutters so the beam lanes left of the ports stay on it
    const sr = canvas.getBoundingClientRect();
    W = Math.max(1, sr.width);
    H = Math.max(1, sr.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const or = orb.getBoundingClientRect();
    C = { x: or.left - sr.left + or.width / 2, y: or.top - sr.top + or.height / 2, r: or.width / 2 };
    const outEl = stage.querySelector('.pv-out');
    const outTop = outEl.getBoundingClientRect().top - sr.top;
    const ends = ports.map((p) => {
      const pr = p.getBoundingClientRect();
      return { x: pr.left - sr.left + pr.width / 2, y: pr.top - sr.top + pr.height / 2 };
    });
    // stacked: the masked marker sits in the gap after the ipify entry, on the AI lane only
    const li = items.map((n) => n.getBoundingClientRect());
    const gapY = li.length > 2 ? (li[1].bottom + li[2].top) / 2 - sr.top : 0;
    beams = ports.map((p, i) => {
      const end = ends[i];
      const horizontal = end.x > C.x + C.r * 1.1;
      const dense = [];
      if (horizontal) {
        // wide: a curve out of the orb's right side straight into each port
        const ang = Math.atan2(end.y - C.y, end.x - C.x) * 0.75;
        const start = { x: C.x + Math.cos(ang) * C.r, y: C.y + Math.sin(ang) * C.r };
        const k = (end.x - start.x) * 0.5;
        const pts = [start, { x: start.x + Math.cos(ang) * k, y: start.y + Math.sin(ang) * k }, { x: end.x - k, y: end.y }, end];
        for (let s = 0; s <= 48; s++) dense.push(bez(pts, s / 48));
      } else {
        // stacked: down out of the orb into the list's left gutter, then down three parallel lanes
        // (each 8px further out), every lane stepping into its own port
        const laneX = end.x - i * 8;
        const ang = Math.PI / 2 + 0.55 + (1 - i) * 0.12;
        const start = { x: C.x + Math.cos(ang) * C.r, y: C.y + Math.sin(ang) * C.r };
        const G = { x: laneX, y: Math.min(end.y - 18, outTop) };
        const k = Math.max(30, (G.y - start.y) * 0.5);
        const pts = [start, { x: start.x + Math.cos(ang) * k * 0.8, y: start.y + Math.sin(ang) * k }, { x: G.x, y: G.y - k }, G];
        for (let s = 0; s <= 48; s++) dense.push(bez(pts, s / 48));
        const turn = { x: laneX, y: end.y - 14 };
        for (let s = 1; s <= 24; s++) dense.push({ x: laneX, y: G.y + ((turn.y - G.y) * s) / 24 });
        const hop = [turn, { x: laneX, y: end.y }, { x: laneX, y: end.y }, end];
        for (let s = 1; s <= 10; s++) dense.push(bez(hop, s / 10));
      }
      // resample by arc length so pulses travel at an even speed
      const acc = [0];
      for (let s = 1; s < dense.length; s++) acc.push(acc[s - 1] + Math.hypot(dense[s].x - dense[s - 1].x, dense[s].y - dense[s - 1].y));
      const total = acc[acc.length - 1] || 1;
      const lut = [];
      let j = 0;
      for (let s = 0; s <= 60; s++) {
        const d = (total * s) / 60;
        while (j < acc.length - 2 && acc[j + 1] < d) j++;
        const u = (d - acc[j]) / (acc[j + 1] - acc[j] || 1);
        lut.push({ x: dense[j].x + (dense[j + 1].x - dense[j].x) * u, y: dense[j].y + (dense[j + 1].y - dense[j].y) * u });
      }
      let maskT = 0.5;
      if (!horizontal) {
        maskT = 0.9;
        for (let s = 0; s <= 60; s++) if (lut[s].y >= gapY) { maskT = s / 60; break; }
      }
      return { lut, maskT, hex: OUT[i].hex, masked: !!OUT[i].masked, lit: false, pulses: [0, 0.34, 0.67].map((o) => o + i * 0.11) };
    });
    if (reduced) frame(0);
  }

  const at = (b, t) => {
    const f = Math.max(0, Math.min(1, t)) * 60, i = Math.floor(f), j = Math.min(60, i + 1), u = f - i;
    return { x: b.lut[i].x + (b.lut[j].x - b.lut[i].x) * u, y: b.lut[i].y + (b.lut[j].y - b.lut[i].y) * u };
  };

  function step(dt) {
    const rin = 0.9;
    for (const p of parts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      const d = Math.hypot(p.x, p.y);
      if (d > rin) {
        const nx = p.x / d, ny = p.y / d;
        const dot = p.vx * nx + p.vy * ny;
        if (dot > 0) {
          p.vx -= 2 * dot * nx; p.vy -= 2 * dot * ny;
          const big = !!(hi && p.tag && hi.includes(p.tag));
          if (big) ripples.push({ x: nx, y: ny, t: 0, c: '#ffffff', big });
          else if (ripples.length < 14) ripples.push({ x: nx, y: ny, t: 0, c: KINDS[p.k].c });
        }
        p.x = nx * rin; p.y = ny * rin;
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].t += dt * (ripples[i].big ? 1.1 : 1.6); if (ripples[i].t > 1) ripples.splice(i, 1); }
    if (hi) hiT += dt;
    for (const b of beams) for (let k = 0; k < b.pulses.length; k++) b.pulses[k] = (b.pulses[k] + dt * 0.22) % 1;
  }

  function frame(dt) {
    if (dt) step(Math.min(dt, 0.05));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // beams
    beams.forEach((b, i) => {
      const local = Math.max(0, Math.min(1, (draw - i * 0.14) / 0.72));
      if (local <= 0) { if (b.lit) { b.lit = false; items[i].classList.remove('is-lit'); } return; }
      const n = Math.max(1, Math.round(local * 60));
      ctx.lineCap = 'round';
      for (const [w, a] of [[6, 0.07], [1.4, 0.55]]) {
        ctx.beginPath();
        ctx.moveTo(b.lut[0].x, b.lut[0].y);
        for (let s = 1; s <= n; s++) ctx.lineTo(b.lut[s].x, b.lut[s].y);
        ctx.strokeStyle = b.hex;
        ctx.globalAlpha = a;
        ctx.lineWidth = w;
        if (b.masked && w < 2) ctx.setLineDash([]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // drawing head
      if (local < 1) {
        const h = at(b, local);
        ctx.drawImage(beamSprites[i], h.x - 18, h.y - 18, 36, 36);
      }
      const isLit = local >= 0.999;
      if (isLit !== b.lit) { b.lit = isLit; items[i].classList.toggle('is-lit', isLit); }
      if (!isLit) return;
      // mask node on the AI beam
      if (b.masked) {
        const m = at(b, b.maskT);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = b.hex;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#FFE2B0';
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.fillText('masked', m.x + 12, m.y - 9);
        ctx.globalAlpha = 1;
      }
      // pulses of light travelling out
      for (const t of b.pulses) {
        const p = at(b, t);
        const fade = Math.min(1, t * 6, (1 - t) * 6);
        ctx.globalAlpha = fade;
        if (b.masked && t > b.maskT) {
          // past the mask: hollow, scrambled packets
          ctx.strokeStyle = b.hex;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([2, 2.5]);
          ctx.beginPath(); ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.drawImage(beamSprites[i], p.x - 13, p.y - 13, 26, 26);
        }
      }
      ctx.globalAlpha = 1;
    });

    // particles inside the vault
    const R = C.r;
    ctx.save();
    ctx.beginPath();
    ctx.arc(C.x, C.y, R * 0.97, 0, Math.PI * 2);
    ctx.clip();
    // constellation threads between near neighbours
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = '#CFC6FF';
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i];
      for (let j = i + 1; j < parts.length; j++) {
        const b = parts[j];
        const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > 0.05) continue;
        ctx.globalAlpha = (1 - d2 / 0.05) * 0.22;
        ctx.beginPath();
        ctx.moveTo(C.x + a.x * R, C.y + a.y * R);
        ctx.lineTo(C.x + b.x * R, C.y + b.y * R);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    const lit = (p) => !!(hi && p.tag && hi.includes(p.tag));
    for (const p of parts) {
      const on = lit(p);
      const s = (p.tag ? 26 : 16) * p.s * Math.min(1.25, R / 180) * (on ? 1.9 : 1);
      ctx.globalAlpha = hi && !on ? 0.55 : 1;
      ctx.drawImage(sprites[p.k], C.x + p.x * R - s / 2, C.y + p.y * R - s / 2, s, s);
      if (on) {
        const rr = 12 + (hiT * 30) % 18;
        ctx.globalAlpha = 0.9 * (1 - ((hiT * 30) % 18) / 18);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(C.x + p.x * R, C.y + p.y * R, rr, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '500 10.5px "JetBrains Mono", monospace';
    for (const p of parts) {
      if (!p.tag || R <= 90) continue;
      const on = lit(p);
      ctx.fillStyle = on ? '#ffffff' : hi ? 'rgba(226, 221, 255, .4)' : 'rgba(226, 221, 255, .78)';
      // labels on the right half of the orb sit to the left of their particle, so the glass never cuts them
      const flip = p.x > 0.15;
      ctx.textAlign = flip ? 'right' : 'left';
      ctx.fillText(p.tag, C.x + p.x * R + (flip ? -1 : 1) * (on ? 14 : 9), C.y + p.y * R + 3.5);
    }
    ctx.textAlign = 'left';
    ctx.globalCompositeOperation = 'lighter';
    // wall ripples where data hits the glass and stays in
    for (const r of ripples) {
      if (r.t < 0) continue;
      const ang = Math.atan2(r.y, r.x);
      const w = r.big ? 0.22 + r.t * 0.5 : 0.12 + r.t * 0.2;
      ctx.lineWidth = r.big ? 2.4 : 1.5;
      ctx.strokeStyle = r.c;
      ctx.globalAlpha = (1 - r.t) * (r.big ? 1 : 0.9);
      ctx.beginPath();
      ctx.arc(C.x, C.y, R * 0.94, ang - w, ang + w);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // run loop: only while on screen
  let raf = 0, last = 0, onScreen = false;
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    const dt = last ? (t - last) / 1000 : 0;
    last = t;
    frame(dt);
  };
  const startLoop = () => { if (!raf && !reduced) { last = 0; raf = requestAnimationFrame(loop); } };
  const stopLoop = () => { cancelAnimationFrame(raf); raf = 0; };

  layout();
  stage.classList.add('pv-armed');
  if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(stage);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

  if (!reduced) {
    const st = ScrollTrigger.create({
      trigger: stage,
      start: 'top 78%',
      end: 'top 18%',
      scrub: 0.4,
      onUpdate: (self) => { draw = self.progress; },
      onLeave: () => { draw = 1; },
    });
    draw = st.progress; // landing below the section (anchor jump, reload): beams already drawn
    new IntersectionObserver((es) => {
      for (const e of es) { onScreen = e.isIntersecting; onScreen ? startLoop() : stopLoop(); }
    }).observe(stage);
  } else {
    items.forEach((i) => i.classList.add('is-lit'));
  }

  // pointer: the glass catches the light where the pointer is
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced) {
    let pr = 0;
    stage.addEventListener('pointermove', (e) => {
      if (pr) return;
      pr = requestAnimationFrame(() => {
        pr = 0;
        const r = orb.getBoundingClientRect();
        const mx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 1.4)));
        const my = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 1.4)));
        orb.style.setProperty('--mx', mx.toFixed(3));
        orb.style.setProperty('--my', my.toFixed(3));
      });
    });
    stage.addEventListener('pointerleave', () => { orb.style.setProperty('--mx', '0'); orb.style.setProperty('--my', '0'); });
  }
  // "What never leaves": light the matching particles and send them into the glass
  return {
    highlight(i) {
      const tags = i == null ? null : NEVER_TAGS[i];
      if (tags === -1) {
        hi = [];
        for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; ripples.push({ x: Math.cos(a), y: Math.sin(a), t: k * -0.03, c: '#9EF0C4', big: true }); }
      } else hi = tags;
      hiT = 0;
      if (hi) for (const p of parts) {
        if (!p.tag || !hi.includes(p.tag)) continue;
        const d = Math.hypot(p.x, p.y) || 1;
        p.vx = (p.x / d) * 0.55; p.vy = (p.y / d) * 0.55;
      } else for (const p of parts) {
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 0.16) { p.vx *= 0.16 / sp; p.vy *= 0.16 / sp; }
      }
      if (reduced) frame(0);
    },
  };
}

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'privacy-title');

  const beams = OUT.map(
    (r) => `
            <li class="pv-beam${r.masked ? ' pv-beam--masked' : ''}" style="--tone:var(--${r.tone})">
              <span class="pv-port" aria-hidden="true"></span>
              <h4 class="pv-beam__h">
                <span class="pv-what">${r.what}</span>
                <span class="pv-to"><span class="sr-only">goes to </span><span class="pv-arrow" aria-hidden="true">→</span> ${r.to}</span>
                ${r.masked ? '<span class="pv-mask mono">masked</span>' : ''}
              </h4>
              <p class="pv-host mono">${r.host}</p>
              <dl class="pv-meta">
                <div><dt>When</dt><dd>${r.when}</dd></div>
                <div><dt>What is sent</dt><dd>${r.sent}</dd></div>
              </dl>
            </li>`,
  ).join('');

  el.innerHTML = `
    <div class="pv-bgfx" aria-hidden="true"></div>
    <div class="container">
      <header class="sec-head pv-head" data-reveal>
        <p class="eyebrow">Privacy</p>
        <h2 class="display-l" id="privacy-title">Your network data stays on your computer</h2>
        <p class="lead">No account, no telemetry, no analytics, no crash reports. Bastion sends three things off your computer, each for a reason you can see.</p>
      </header>

      <div class="pv-stage">
        <canvas class="pv-canvas" aria-hidden="true"></canvas>

        <div class="pv-vault" aria-hidden="true">
          <div class="pv-orb">
            <span class="pv-orb__halo"></span>
            <span class="pv-orb__glass"></span>
            <span class="pv-orb__spec"></span>
            <span class="pv-orb__rim"></span>
          </div>
          <p class="pv-vault__cap mono">This computer</p>
          <ul class="pv-legend" role="list">
            <li style="--tone:var(--lavender)">Scan results</li>
            <li style="--tone:var(--mint)">Devices</li>
            <li style="--tone:var(--sky)">Wi-Fi</li>
          </ul>
        </div>

        <div class="pv-out">
          <div class="pv-out__h">
            <h3 class="pv-h">What leaves your computer</h3>
            <p class="pv-sub">Everything Bastion itself sends out.</p>
          </div>
          <ol class="pv-beams" role="list">${beams}
          </ol>
        </div>
      </div>

      <div class="pv-lower">
        <div class="pv-never">
          <div class="pv-never__h" data-reveal>
            <h3 class="pv-h">What never leaves</h3>
            <p class="pv-sub">Not even inside an AI request.</p>
          </div>
          <ul class="pv-list" role="list">
            ${NEVER.map((n, i) => `<li class="pv-stop" style="--i:${i}"><span class="pv-glass" aria-hidden="true"><i class="pv-pk"></i><i class="pv-rip"></i><i class="pv-wall"></i></span><span class="pv-stop__t">${n}</span></li>`).join('')}
          </ul>
        </div>
        <div class="pv-keys" data-reveal style="--reveal-delay:.08s">
          <span class="pv-lock" aria-hidden="true"><span class="pv-lock__rim"></span>${ICON.lock}</span>
          <h3 class="pv-h">Your API keys</h3>
          <p>Encrypted at rest with your operating system’s keychain: Keychain on macOS, DPAPI on Windows. A key is decrypted only for the moment of a request and goes only to the provider it belongs to.</p>
        </div>
      </div>

      <p class="pv-foot" data-reveal>
        The scan itself talks only to your router’s local address. To show device names, Bastion asks the DNS server your system already uses, which is usually your router, but can be your provider’s or a public DNS server if your system is set up that way.
        <a href="${REPO}" rel="noopener">Check every request in the source</a>.
      </p>
    </div>`;

  reveal(el);

  // Heavy canvas: start it only when the section comes near the viewport.
  const stage = el.querySelector('.pv-stage');
  let api = null;
  const boot = () => {
    try { api = vault(stage) || null; } catch (err) { console.error('[bastion-site] privacy vault failed', err); }
  };
  if (!('IntersectionObserver' in window)) boot();
  else {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); boot(); }
    }, { rootMargin: '600px 0px' });
    io.observe(stage);
  }

  /* "What never leaves": each line is a packet stopped at the glass. Lines below the fold play the
     hit (packet slides in, strikes the wall, ripples back) as they arrive; hovering a line replays
     it and lights the matching data inside the vault. Resting state = the stopped
     packet, fully legible, so nothing depends on this running. */
  const stops = [...el.querySelectorAll('.pv-stop')];
  const hit = (li) => {
    li.classList.remove('is-hit');
    void li.offsetWidth; // restart the CSS animation
    li.classList.add('is-hit');
  };
  if (!isReduced() && 'IntersectionObserver' in window) {
    const below = stops.filter((li) => li.getBoundingClientRect().top > window.innerHeight * 0.92);
    below.forEach((li) => li.classList.add('is-armed'));
    const io2 = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        io2.unobserve(e.target);
        const li = e.target;
        setTimeout(() => { li.classList.remove('is-armed'); hit(li); }, (+li.style.getPropertyValue('--i') || 0) * 110);
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    below.forEach((li) => io2.observe(li));
    // safety net: never leave a line armed once it is on screen
    let t = 0;
    const settle = () => below.forEach((li) => {
      if (li.classList.contains('is-armed') && li.getBoundingClientRect().top < window.innerHeight) { li.classList.remove('is-armed'); hit(li); }
    });
    window.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(settle, 400); }, { passive: true });
  }
  stops.forEach((li, i) => {
    const on = () => { if (!isReduced()) hit(li); if (api) api.highlight(i); };
    const off = () => { if (api) api.highlight(null); };
    li.addEventListener('pointerenter', on);
    li.addEventListener('pointerleave', off);
  });
}
