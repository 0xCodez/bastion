// Entry point. Order matters: fonts and shared styles first, then section styles.
import './styles/fonts.css';
import './styles/base.css';
import './styles/chrome.css';

import { initNav } from './chrome.js';
import { sectionJs } from './section-modules.js';

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

function start() {
  document.documentElement.classList.add('js');
  initNav();
  mountAll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
