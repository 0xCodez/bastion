// Entry point. Order matters: fonts and shared styles first, then section styles.
import './styles/fonts.css';
import './styles/base.css';
import './styles/chrome.css';

// Scroll engine first: registers GSAP ScrollTrigger and creates the single Lenis instance that the
// section modules import from './fx/scroll.js'.
import { ScrollTrigger, requestRefresh } from './fx/scroll.js';
import { initNav } from './chrome.js';
import { sectionJs } from './section-modules.js';
import { initBackdrop } from './fx/backdrop.js';
import { initTransitions, initPointerLight, initNavMorph } from './fx/transitions.js';

// Section order on the page. Each id has a <section id="<id>"> in index.html, a module
// src/sections/<id>.js exporting mount(el), and a stylesheet src/sections/<id>.css.
export const SECTIONS = ['hero', 'problem', 'features', 'demo', 'agents', 'steps', 'privacy', 'faq', 'cta'];

// Section modules and CSS come from ./section-modules.js (imported after base styles above).

function mountAll() {
  for (const id of SECTIONS) {
    const el = document.getElementById(id);
    const mod = sectionJs[`./sections/${id}.js`];
    if (!el) continue;
    if (!mod || typeof mod.mount !== 'function') {
      if (import.meta.env.DEV) console.warn(`[bastion-site] section "${id}" has no mount() yet`);
      continue;
    }
    try {
      mod.mount(el);
    } catch (err) {
      // one broken section must not take the rest of the page down
      console.error(`[bastion-site] section "${id}" failed to mount`, err);
    }
  }
}

// Global effects are decoration: a failure there must never stop the page.
function safe(name, fn) {
  try { fn(); } catch (err) { console.error(`[bastion-site] ${name} failed`, err); }
}

function start() {
  document.documentElement.classList.add('js');
  safe('backdrop', initBackdrop);
  initNav();
  mountAll();
  // after the sections mounted (and any pinned ones were wrapped), so seams land between them
  safe('transitions', () => initTransitions(SECTIONS));
  safe('pointer light', initPointerLight);
  safe('nav morph', () => initNavMorph());
  requestRefresh(0);
  // late layout changes (lazy canvases, images, fonts) keep triggers in place
  if ('ResizeObserver' in window) {
    let lastH = 0;
    new ResizeObserver(() => {
      const h = document.documentElement.scrollHeight;
      if (Math.abs(h - lastH) > 4) { lastH = h; requestRefresh(); }
    }).observe(document.getElementById('main') || document.body);
  }
  if (import.meta.env.DEV) window.ScrollTrigger = ScrollTrigger;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
