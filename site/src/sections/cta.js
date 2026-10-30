import { reveal } from '../fx/reveal.js';
import { flare } from '../fx/flare.js';
import { gsap, ScrollTrigger, isReduced } from '../fx/scroll.js';

/* cta: the finale. Arriving here, stars warp toward the horizon, the planet's rim sweeps open with
   an anamorphic flare across the full width, the headline rises word by word and the download
   buttons light up. Everything is visible by default: the start state is only applied by JS when
   the section is still below the fold, and safety nets play the sequence if a trigger is missed. */

const REPO = 'https://github.com/0xCodez/bastion';
const RELEASES = `${REPO}/releases/latest`;
const TITLE = 'Close the doors you didn’t know were open.';

const ICON = {
  down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  code: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/></svg>',
  shield:
    '<svg width="34" height="34" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 2.5l9.5 4v6.8c0 6-4 10.7-9.5 12.7-5.5-2-9.5-6.7-9.5-12.7V6.5z" fill="#fff" fill-opacity=".95"/><path d="M9.5 14.5a6.4 6.4 0 0 1 9 0M11.6 17a3.4 3.4 0 0 1 4.8 0" fill="none" stroke="#3A2BB8" stroke-width="1.9" stroke-linecap="round"/><circle cx="14" cy="19.6" r="1.3" fill="#3A2BB8"/></svg>',
};

function platform() {
  const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
  if (/iphone|ipad|ipod|android/i.test(navigator.userAgent || '')) return 'mobile';
  if (/mac/i.test(p)) return 'mac';
  if (/win/i.test(p)) return 'win';
  return 'other';
}

/* ---------- star warp: stars stream out of a vanishing point above the horizon ---------- */
function starWarp(el, canvas, getBoost) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const reduced = isReduced();
  const N = 340;
  const stars = [];
  let W = 0, H = 0, dpr = 1, hz = 0;
  let vel = 0; // extra warp from scroll velocity, decays each frame
  const rnd = (a, b) => a + Math.random() * (b - a);
  const spawn = (s, far) => {
    s.x = rnd(-1, 1); s.y = rnd(-1, 1); s.z = far ? 1 : rnd(0.05, 1); s.pz = s.z;
    s.c = Math.random() < 0.18 ? '143,211,255' : Math.random() < 0.3 ? '183,169,255' : '236,232,255';
    return s;
  };
  for (let i = 0; i < N; i++) stars.push(spawn({}, false));

  function size() {
    const r = el.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const v = parseFloat(getComputedStyle(el).getPropertyValue('--hz-px')) || 0;
    hz = H - (v || Math.min(260, Math.max(150, W * 0.19)));
  }

  function frame(dt) {
    const speed = 0.045 + (reduced ? 0 : getBoost() * 1.5 + vel);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = hz * 0.62, f = Math.max(W, H) * 0.42;
    ctx.lineCap = 'round';
    for (const s of stars) {
      s.pz = s.z;
      s.z -= speed * dt;
      if (s.z <= 0.03) { spawn(s, true); continue; }
      const x = cx + (s.x / s.z) * f, y = cy + (s.y / s.z) * f;
      if (x < -20 || x > W + 20 || y < -20 || y > hz) { if (s.z < 0.5) spawn(s, true); continue; }
      const px = cx + (s.x / s.pz) * f, py = cy + (s.y / s.pz) * f;
      const a = Math.min(1, (1 - s.z) * 1.3);
      // keep the streak length bounded so the warp reads as light, not lines
      const k = Math.min(1, 26 / (Math.hypot(x - px, y - py) + 0.001));
      ctx.strokeStyle = `rgba(${s.c},${(a * 0.9).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, (1 - s.z) * 1.8);
      ctx.beginPath();
      ctx.moveTo(x - (x - px) * Math.max(k, 0.2) * (speed > 0.1 ? 3 : 1), y - (y - py) * Math.max(k, 0.2) * (speed > 0.1 ? 3 : 1));
      ctx.lineTo(x + 0.01, y + 0.01);
      ctx.stroke();
    }
  }

  let raf = 0, last = 0;
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    vel *= 0.93;
    frame(dt);
  };
  size();
  if (reduced) {
    // one still frame: tiny points, no streaks
    for (let i = 0; i < 3; i++) frame(0.016);
  }
  if ('ResizeObserver' in window) new ResizeObserver(() => { size(); if (reduced) frame(0.016); }).observe(el);

  return {
    start() { if (!raf && !reduced) { last = 0; raf = requestAnimationFrame(loop); } },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    kick(v) { vel = Math.max(vel, v); },
  };
}

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'cta-title');

  const words = TITLE.split(' ')
    .map((w) => `<span class="ct-w"><span class="ct-wi">${w}</span></span>`)
    .join(' ');

  el.innerHTML = `
    <div class="ct-sky" aria-hidden="true">
      <div class="ct-stars"></div>
      <canvas class="ct-warp"></canvas>
      <div class="ct-glow"></div>
      <div class="ct-planet"><div class="ct-surface"></div></div>
      <div class="ct-rim"></div>
      <div class="ct-bloom"></div>
      <div class="ct-flare"><i class="ct-flare__haze"></i><i class="ct-flare__core"></i><i class="ct-flare__hot"></i></div>
      <div class="ct-ghosts"><span class="ct-gc"><i class="ct-ghost"></i></span><span class="ct-gc ct-gc--2"><i class="ct-ghost ct-ghost--2"></i></span><span class="ct-gc ct-gc--3"><i class="ct-ghost ct-ghost--3"></i></span></div>
    </div>
    <div class="container ct">
      <span class="ct-mark" aria-hidden="true">${ICON.shield}</span>
      <p class="eyebrow ct-eyebrow">Free · open source · Windows and macOS</p>
      <h2 class="display-xl ct-title" id="cta-title">${words}</h2>
      <p class="lead ct-lead">Download Bastion, run one scan, and see what your router has been doing. No account, no subscription, nothing changed without you.</p>
      <div class="ct-actions">
        <a class="btn btn--primary btn--lg" data-os="win" href="https://github.com/0xCodez/bastion/releases/latest/download/Bastion-setup-x64.exe" rel="noopener">${ICON.down}Download for Windows</a>
        <a class="btn btn--primary btn--lg" data-os="mac" href="https://github.com/0xCodez/bastion/releases/latest/download/Bastion-mac-arm64.dmg" rel="noopener">${ICON.down}Download for macOS</a>
        <a class="btn btn--ghost btn--lg ct-gh" href="${REPO}" rel="noopener">${ICON.code}View source on GitHub</a>
      </div>
      <p class="ct-meta mono">Windows 10 and 11 · macOS 13 and later · MIT licence</p>
    </div>`;

  // Lead with the visitor's own system; the other download becomes a quieter button.
  const os = platform();
  const actions = el.querySelector('.ct-actions');
  if (os === 'win' || os === 'mac') {
    const mine = actions.querySelector(`[data-os="${os}"]`);
    const other = actions.querySelector(`[data-os="${os === 'win' ? 'mac' : 'win'}"]`);
    actions.prepend(mine);
    other.classList.remove('btn--primary');
    other.classList.add('btn--ghost');
  }
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    actions.querySelectorAll('.btn').forEach((b) => flare(b, { y: 0.5, color: b.classList.contains('btn--primary') ? '#ffffff' : '#B7A9FF' }));
  }

  const reduced = isReduced();
  let boost = 1; // 1 = full warp; eased to 0 when the finale lands
  const warpCanvas = el.querySelector('.ct-warp');
  let warp = null;

  // Canvas starts near the viewport and pauses off screen; the drift animations follow the same flag.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      for (const e of es) {
        el.classList.toggle('ct-live', e.isIntersecting);
        if (e.isIntersecting && !warp) {
          try { warp = starWarp(el, warpCanvas, () => boost); if (warp) el.classList.add('ct-has-warp'); } catch (err) { console.error(err); }
        }
        if (warp) (e.isIntersecting ? warp.start() : warp.stop());
      }
    }, { rootMargin: '200px 0px' }).observe(el);
  }

  reveal(el);
  if (reduced) { el.classList.add('ct-arrived'); return; }

  /* ---------- arrival sequence ----------
     Two beats with their own triggers, so each plays where it can be seen:
     1. the headline: mark, words, lead and buttons rise as the section comes up (warp eases down);
     2. the horizon: the rim sweeps open with a hot flare and lens ghosts only once the horizon line
        itself is inside the viewport. Until then the flare idles at a low glow. */
  const q = gsap.utils.selector(el);
  const belowFold = el.getBoundingClientRect().top > window.innerHeight * 0.6;
  const rim = el.querySelector('.ct-rim');
  const rimBelow = rim.getBoundingClientRect().top > window.innerHeight * 0.88;

  const head = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } });
  head.fromTo(q('.ct-glow'), { opacity: 0 }, { opacity: 1, duration: 2 }, 0)
    .fromTo(q('.ct-mark'), { scale: 0.4, opacity: 0, y: 30 }, { scale: 1, opacity: 1, y: 0, duration: 1.3 }, 0.1)
    .fromTo(q('.ct-eyebrow'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 1 }, 0.25)
    .fromTo(q('.ct-wi'), { yPercent: 115, rotate: 4 }, { yPercent: 0, rotate: 0, duration: 1.3, stagger: 0.055 }, 0.3)
    .fromTo(q('.ct-lead'), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1.1 }, 0.75)
    .fromTo(q('.ct-actions > *'), { opacity: 0, y: 24, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 1.1, stagger: 0.09 }, 0.9)
    .fromTo(q('.ct-meta'), { opacity: 0 }, { opacity: 1, duration: 1 }, 1.2)
    .add(() => el.classList.add('ct-glowing'), 1.3);

  // ghosts sit opposite the hot spot (mirrored through the centre), so they travel against the sweep
  const hz = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' }, onComplete: () => el.classList.add('ct-arrived') });
  hz.fromTo(q('.ct-rim'), { clipPath: 'inset(0% 50% 0% 50%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.7, ease: 'power3.inOut' }, 0)
    .fromTo(q('.ct-flare__core, .ct-flare__haze'), { scaleX: 0.28, opacity: 0.22 }, { scaleX: 1, opacity: 1, duration: 1.4, ease: 'power3.out' }, 0.05)
    .fromTo(q('.ct-flare__hot'), { xPercent: -60, opacity: 0 }, { xPercent: 60, opacity: 1, duration: 1.7, ease: 'power2.inOut' }, 0.05)
    .to(q('.ct-flare__hot'), { opacity: 0, duration: 0.6, ease: 'power1.in' }, 1.2)
    .fromTo(q('.ct-gc'), { xPercent: (i) => [14, 30, -8][i], opacity: 0 }, { xPercent: (i) => [-14, -30, 8][i], opacity: 1, duration: 1.7, ease: 'power2.inOut' }, 0.05)
    .to(q('.ct-gc'), { opacity: (i) => [0.4, 0.25, 0.5][i], duration: 1.2, ease: 'power2.out' }, 1.5)
    .fromTo(q('.ct-bloom'), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'power2.out' }, 0.75)
    .to(q('.ct-bloom'), { opacity: 0.35, scale: 1.1, duration: 1.6, ease: 'power2.out' }, 1.25)
    .to(q('.ct-flare__core, .ct-flare__haze'), { opacity: 0.62, duration: 1.6, ease: 'power2.out' }, 1.6);

  // scroll speed adds a little extra warp while the sky is on screen
  ScrollTrigger.create({
    trigger: el,
    start: 'top bottom',
    end: 'bottom top',
    onUpdate: (self) => { if (warp) warp.kick(Math.min(1, Math.abs(self.getVelocity()) / 4000)); },
  });

  let headPlayed = false;
  let hzPlayed = false;
  const playHead = () => {
    if (headPlayed) return;
    headPlayed = true;
    head.play(0);
    // warp eases down to a gentle drift as the finale settles
    const o = { b: boost };
    gsap.to(o, { b: 0, duration: 2.6, ease: 'power3.out', onUpdate: () => { boost = o.b; } });
  };
  const playHz = () => {
    if (hzPlayed) return;
    hzPlayed = true;
    hz.play(0);
  };

  if (belowFold) {
    head.progress(0).pause(); // render start state
    ScrollTrigger.create({ trigger: el, start: 'top 62%', once: true, onEnter: playHead });
  } else {
    head.progress(1);
    headPlayed = true;
    el.classList.add('ct-glowing');
    boost = 0;
  }
  if (rimBelow) {
    hz.progress(0).pause();
    ScrollTrigger.create({ trigger: rim, start: 'top 86%', once: true, onEnter: playHz });
  } else {
    hz.progress(1);
    hzPlayed = true;
  }
  if (belowFold || rimBelow) {
    // safety nets: whatever is on screen and has not played, plays
    const check = () => {
      const r = el.getBoundingClientRect();
      if (!headPlayed && r.top < window.innerHeight * 0.75 && r.bottom > 0) playHead();
      const h = rim.getBoundingClientRect().top;
      if (!hzPlayed && h < window.innerHeight * 0.92 && h > -40) playHz();
    };
    let t = 0;
    window.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(check, 300); }, { passive: true });
    window.addEventListener('hashchange', () => setTimeout(check, 900));
    window.addEventListener('beforeprint', () => { head.progress(1); hz.progress(1); });
  }
}
