import { reveal } from '../fx/reveal.js';

/* cta: final statement and downloads over a planet-horizon glow (CSS only, no canvas). */

const REPO = 'https://github.com/0xCodez/bastion';
const RELEASES = `${REPO}/releases/latest`;

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

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'cta-title');

  el.innerHTML = `
    <div class="ct-sky" aria-hidden="true">
      <div class="ct-stars"></div>
      <div class="ct-glow"></div>
      <div class="ct-planet"><div class="ct-surface"></div></div>
      <div class="ct-rim"></div>
    </div>
    <div class="container ct" data-reveal>
      <span class="ct-mark" aria-hidden="true">${ICON.shield}</span>
      <p class="eyebrow ct-eyebrow">Free · open source · Windows and macOS</p>
      <h2 class="display-xl grad-text ct-title" id="cta-title">Close the doors you didn’t know were open.</h2>
      <p class="lead ct-lead">Download Bastion, run one scan, and see what your router has been doing. No account, no subscription, nothing changed without you.</p>
      <div class="ct-actions">
        <a class="btn btn--primary btn--lg" data-os="win" href="${RELEASES}" rel="noopener">${ICON.down}Download for Windows</a>
        <a class="btn btn--primary btn--lg" data-os="mac" href="${RELEASES}" rel="noopener">${ICON.down}Download for macOS</a>
        <a class="btn btn--ghost btn--lg ct-gh" href="${REPO}" rel="noopener">${ICON.code}View source on GitHub</a>
      </div>
      <p class="ct-meta mono">Windows 10 and 11 · macOS 13 and later · MIT licence</p>
    </div>`;

  // Lead with the visitor's own system; the other download becomes a quieter button.
  const os = platform();
  if (os === 'win' || os === 'mac') {
    const actions = el.querySelector('.ct-actions');
    const mine = actions.querySelector(`[data-os="${os}"]`);
    const other = actions.querySelector(`[data-os="${os === 'win' ? 'mac' : 'win'}"]`);
    actions.prepend(mine);
    other.classList.remove('btn--primary');
    other.classList.add('btn--ghost');
  }

  // Let the slow surface drift only while the section is on screen.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      for (const e of es) el.classList.toggle('ct-live', e.isIntersecting);
    }).observe(el);
  }

  reveal(el);
}
