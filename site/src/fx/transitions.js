// Section transitions and global chrome polish.
//
//   initTransitions(sectionIds)   horizon seams between consecutive sections + per-section colour
//                                 temperature (backdrop tint + atmosphere, .backdrop[data-temp]) + scroll progress hairline
//   initPointerLight()            one pointer listener: --lx/--ly (element px) on the hovered
//                                 .glass / [data-glow] element only (never on <html>: a custom
//                                 property written on the root restyles the whole document)
//   initNavMorph()                --nav-k (0..1) on the nav as the page leaves the top
//
// Seams are inserted programmatically as zero-height siblings between sections (no layout impact).
// Each one is a thin luminous arc with an anamorphic flare (white core, streak, faint chromatic
// fringes) that ignites and sweeps across as the seam crosses the viewport centre. Every seam is
// tuned to the section it opens: colour from that section's palette, alternating sweep direction,
// varied curvature and intensity, and two special ones (an eclipse ring before privacy, a horizon
// that lifts toward the CTA planet). Behind the content each seam also lays a feathered band that
// blends whatever ends above it into whatever starts below it, so no section edge reads as a box.
// The last section ends on a veil into the footer. Reduced motion: seams rest at a calm, centred
// glow; nothing is scrubbed.

import './transitions.css';
import { ScrollTrigger, isReduced, isTouch } from './scroll.js';
import { setTint, setAtmos } from './backdrop.js';

const PALETTES = {
  hero:     [[0.45, 0.22, 0.85], [0.62, 0.2, 0.5]],
  problem:  [[0.52, 0.2, 0.86], [0.78, 0.18, 0.52]],
  features: [[0.24, 0.3, 0.96], [0.46, 0.3, 1.0]],
  demo:     [[0.06, 0.56, 0.64], [0.18, 0.36, 0.84]],
  agents:   [[0.64, 0.18, 0.8], [0.24, 0.3, 0.9]],
  steps:    [[0.2, 0.42, 0.96], [0.36, 0.25, 0.86]],
  privacy:  [[0.05, 0.62, 0.55], [0.14, 0.42, 0.78]],
  faq:      [[0.36, 0.26, 0.78], [0.2, 0.2, 0.56]],
  cta:      [[0.5, 0.38, 1.0], [0.25, 0.55, 0.92]],
};
const FALLBACK = PALETTES.features;

// per-seam look, keyed by the section the seam opens: streak colour, fringe colour, sweep direction,
// arc sag (fraction of the viewport width), intensity and an optional special treatment
const SEAMS = {
  features: { c: '#9C8CFF', c2: '#8FD3FF', dir: 1, sag: 0.09, k: 1 },
  demo: { c: '#7FE6F0', c2: '#3FE3C9', dir: -1, sag: 0.06, k: 0.9 },
  agents: { c: '#E2A6FF', c2: '#8FA8FF', dir: 1, sag: 0.11, k: 1 },
  steps: { c: '#A9C8FF', c2: '#B7A9FF', dir: -1, sag: 0.07, k: 0.85 },
  privacy: { c: '#86F2DE', c2: '#8FD3FF', dir: 1, sag: 0.1, k: 1, kind: 'eclipse' },
  faq: { c: '#B7A9FF', c2: '#8A90E0', dir: -1, sag: 0.05, k: 0.7 },
  cta: { c: '#D2C8FF', c2: '#8FD3FF', dir: 1, sag: 0.16, k: 1.15, kind: 'rise' },
};
const SEAM_FALLBACK = SEAMS.features;

const seamHTML = (gid, cfg) => `
  <div class="seam__blend"></div>
  <div class="seam__atmo"></div>${cfg.kind === 'eclipse' ? '<div class="seam__eclipse"><i></i></div>' : ''}
  <svg class="seam__arc" viewBox="0 0 1000 100" preserveAspectRatio="none" focusable="false">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${cfg.dir > 0 ? cfg.c : cfg.c2}" stop-opacity="0"/>
        <stop offset=".28" stop-color="${cfg.dir > 0 ? cfg.c : cfg.c2}" stop-opacity=".55"/>
        <stop offset=".5" stop-color="#F3F0FF" stop-opacity=".95"/>
        <stop offset=".72" stop-color="${cfg.dir > 0 ? cfg.c2 : cfg.c}" stop-opacity=".55"/>
        <stop offset="1" stop-color="${cfg.dir > 0 ? cfg.c2 : cfg.c}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path class="seam__arc-glow" stroke="url(#${gid})" d="M0 100 Q500 -100 1000 100"/>
    <path class="seam__arc-line" stroke="url(#${gid})" d="M0 100 Q500 -100 1000 100"/>
  </svg>
  <div class="seam__flare">
    <i class="seam__halo"></i>
    <i class="seam__fringe seam__fringe--a"></i>
    <i class="seam__fringe seam__fringe--b"></i>
    <i class="seam__streak"></i>
    <i class="seam__core"></i>
    <i class="seam__ghost seam__ghost--a"></i>
    <i class="seam__ghost seam__ghost--b"></i>
  </div>`;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => v * v * (3 - 2 * v);
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// the outermost box of a section inside <main> (ScrollTrigger may wrap pinned sections)
const boxOf = (sec) => {
  let el = sec;
  while (el.parentElement && el.parentElement.tagName !== 'MAIN') el = el.parentElement;
  return el;
};

export function initTransitions(ids) {
  const main = document.getElementById('main');
  if (!main) return;
  const reduced = isReduced();
  const sections = ids.map((id) => document.getElementById(id)).filter(Boolean);
  if (!sections.length) return;

  // ---------- seams ----------
  const seams = [];
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1];
    const next = sections[i];
    const seam = document.createElement('div');
    seam.className = 'seam';
    seam.setAttribute('aria-hidden', 'true');
    seam.dataset.seam = `${prev.id}-${next.id}`;
    if (prev.id === 'hero') {
      // the hero already ends on its own planet horizon: blend into the page instead of a second arc
      seam.classList.add('seam--veil');
      seam.innerHTML = '<div class="seam__veil"></div>';
    } else {
      const cfg = SEAMS[next.id] || SEAM_FALLBACK;
      seam.innerHTML = seamHTML(`seamArc${i}`, cfg);
      if (cfg.kind) seam.classList.add(`seam--${cfg.kind}`);
      seam.style.setProperty('--seam-c', cfg.c);
      seam.style.setProperty('--seam-c2', cfg.c2);
      seam.style.setProperty('--seam-d', `${(cfg.sag * 100).toFixed(1)}vw`);
      seam.style.setProperty('--seam-k', String(cfg.k));
      seams.push({ el: seam, flare: seam.querySelector('.seam__flare'), cfg, y: 0, i: -1 });
    }
    boxOf(prev).after(seam);
  }

  // the last section fades into the footer instead of ending on a hard edge
  const last = sections[sections.length - 1];
  if (last && last.id !== 'hero') {
    const end = document.createElement('div');
    end.className = 'seam seam--end';
    end.setAttribute('aria-hidden', 'true');
    end.innerHTML = '<div class="seam__veil"></div>';
    boxOf(last).after(end);
  }

  // ---------- progress hairline ----------
  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<i></i>';
  document.body.appendChild(bar);
  const barFill = bar.firstChild;

  // ---------- geometry cache ----------
  let tops = [];
  let vh = window.innerHeight;
  let vw = window.innerWidth;
  const measure = () => {
    vh = window.innerHeight;
    vw = window.innerWidth;
    const sy = window.scrollY;
    tops = sections.map((s) => s.getBoundingClientRect().top + sy);
    for (const s of seams) s.y = s.el.getBoundingClientRect().top + sy;
  };

  // ---------- per-frame update ----------
  let lastTemp = '';
  const backdrop = document.querySelector('.backdrop');
  const update = (progress) => {
    const sy = window.scrollY;
    const centre = sy + vh * 0.5;

    // progress hairline
    barFill.style.transform = `scaleX(${progress.toFixed(4)})`;

    // colour temperature: blend toward the next section as its top nears the viewport centre
    let k = 0;
    while (k < tops.length - 1 && tops[k + 1] <= centre) k++;
    const cur = PALETTES[sections[k].id] || FALLBACK;
    const nextSec = sections[k + 1];
    let t = 0;
    if (nextSec) t = smooth(1 - clamp01((tops[k + 1] - centre) / (vh * 0.85)));
    const nxt = nextSec ? PALETTES[nextSec.id] || FALLBACK : cur;
    setTint(mix3(cur[0], nxt[0], t), mix3(cur[1], nxt[1], t));
    setAtmos(sections[k].id, nextSec ? nextSec.id : sections[k].id, t);
    const temp = t > 0.5 && nextSec ? nextSec.id : sections[k].id;
    if (temp !== lastTemp) {
      lastTemp = temp;
      // on the backdrop only: an attribute or custom property changed on <html> restyles everything
      if (backdrop) backdrop.dataset.temp = temp;
      window.dispatchEvent(new CustomEvent('bastion:section', { detail: { id: temp } }));
    }

    if (reduced) return;
    // seams: ignite around the viewport centre, sweep left -> right while crossing
    const W = vw * 1.6;
    for (const s of seams) {
      const D = vw * s.cfg.sag;
      const yv = s.y - sy; // seam position in the viewport
      if (yv < -vh * 0.4 || yv > vh * 1.4) {
        if (s.i !== 0) { s.i = 0; s.el.style.setProperty('--seam-i', '0'); }
        continue;
      }
      const p = 1 - yv / vh; // 0 at the bottom edge, 1 at the top
      const ig = smooth(clamp01(1 - Math.abs(p - 0.5) / 0.34));
      const dx = (p - 0.5) * vw * 0.9 * s.cfg.dir; // sweep (direction alternates per seam)
      const dy = (4 * D * dx * dx) / (W * W); // follow the arc
      s.i = ig;
      s.el.style.setProperty('--seam-i', ig.toFixed(3));
      s.flare.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scaleX(${(0.35 + 0.65 * ig).toFixed(3)})`;
    }
  };

  measure();
  const st = ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => update(self.progress),
    onRefresh: (self) => { measure(); update(self.progress); },
  });
  update(st.progress || 0);
  // no separate resize listener: ScrollTrigger refreshes on resize after reverting pins, and
  // onRefresh re-measures then (measuring mid-pin would read pinned, fixed positions)
}

// ---------- pointer light ----------
export function initPointerLight() {
  if (isTouch()) return;
  let x = 0;
  let y = 0;
  let target = null;
  let lit = null;
  let raf = 0;
  const flush = () => {
    raf = 0;
    if (lit && lit !== target) lit.classList.remove('is-lit');
    lit = target;
    if (lit) {
      const r = lit.getBoundingClientRect();
      lit.style.setProperty('--lx', `${(x - r.left).toFixed(1)}px`);
      lit.style.setProperty('--ly', `${(y - r.top).toFixed(1)}px`);
      lit.classList.add('is-lit');
    }
  };
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    x = e.clientX;
    y = e.clientY;
    target = e.target && e.target.closest ? e.target.closest('.glass, [data-glow]') : null;
    if (!target && !lit) return; // nothing to light and nothing lit: no frame at all
    if (!raf) raf = requestAnimationFrame(flush);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { target = null; if (!raf) raf = requestAnimationFrame(flush); });
}

// ---------- nav morph ----------
export function initNavMorph(nav = document.querySelector('[data-nav]')) {
  if (!nav) return;
  document.documentElement.classList.add('has-navk');
  let lastK = -1;
  // read the position directly: robust to refreshes and jumps (anchors, restored scroll)
  const set = () => {
    const k = Math.round(Math.min(1, Math.max(0, window.scrollY / 220)) * 100) / 100;
    if (k === lastK) return;
    lastK = k;
    nav.style.setProperty('--nav-k', String(k));
  };
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: set, onRefresh: set });
  window.addEventListener('scroll', set, { passive: true });
  set();
}
