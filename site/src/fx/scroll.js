// Shared scroll engine: GSAP + ScrollTrigger, driven by one Lenis instance.
//
//   import { gsap, ScrollTrigger, lenis, isReduced, isNarrow, isTouch, motionOK, requestRefresh, scrollToTarget } from '../fx/scroll.js';
//
// - gsap / ScrollTrigger: registered once here. Never create a second Lenis or register again.
// - lenis: the Lenis instance, or null when smooth scrolling is off (reduced motion, touch / coarse
//   pointer, no window). Code must work with lenis === null (native scroll; ScrollTrigger still works).
// - isReduced(): prefers-reduced-motion: reduce. Static, fully legible layout; no pinning, no scrubbing.
// - isNarrow(): narrow screen (<= 820px) OR touch / coarse pointer. Use the stacked layout:
//   no pinning, no horizontal scroll.
// - motionOK(): !isReduced() && !isNarrow(); the gate for pinned / scroll-jacked sequences.
// - requestRefresh(): debounced ScrollTrigger.refresh(); call after a lazy canvas or late content
//   changes layout.
// - scrollToTarget(elOrSelectorOrY): smooth scroll with the fixed-nav offset (Lenis or native).

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

const hasWindow = typeof window !== 'undefined';
const mq = (q) => hasWindow && !!window.matchMedia && window.matchMedia(q).matches;

export const isReduced = () => mq('(prefers-reduced-motion: reduce)');
export const isTouch = () => mq('(pointer: coarse)') || mq('(hover: none)');
export const isNarrow = () => mq('(max-width: 820px)') || isTouch();
export const motionOK = () => !isReduced() && !isNarrow();

function navOffset() {
  if (!hasWindow) return 0;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'));
  return (Number.isFinite(v) ? v : 76) + 12;
}

function createLenis() {
  if (!hasWindow || isReduced() || isTouch()) return null;
  try {
    const l = new Lenis({
      lerp: 0.11,
      wheelMultiplier: 1,
      smoothWheel: true,
      syncTouch: false,
      autoRaf: false,
      anchors: false, // handled below so the nav offset and focus are right
    });
    l.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => l.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    return l;
  } catch (err) {
    console.error('[bastion-site] smooth scroll unavailable', err);
    return null;
  }
}

export const lenis = createLenis();

let refreshT = 0;
export function requestRefresh(delay = 120) {
  if (!hasWindow) return;
  clearTimeout(refreshT);
  refreshT = setTimeout(() => ScrollTrigger.refresh(), delay);
}

function resolveTarget(target) {
  if (typeof target === 'number') return target;
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  return el || null;
}

export function scrollToTarget(target, { onDone } = {}) {
  const t = resolveTarget(target);
  if (t === null) return;
  const off = typeof t === 'number' ? 0 : -navOffset();
  const isHero = t && t.id === 'hero';
  if (lenis) {
    lenis.scrollTo(isHero ? 0 : t, { offset: isHero ? 0 : off, duration: 1.4, onComplete: onDone });
    return;
  }
  const y = typeof t === 'number' ? t : isHero ? 0 : t.getBoundingClientRect().top + window.scrollY + off;
  window.scrollTo({ top: y, behavior: isReduced() ? 'auto' : 'smooth' });
  if (onDone) setTimeout(onDone, isReduced() ? 0 : 900);
}

// In-page anchor links (nav, footer, buttons): smooth scroll with the nav offset, keep the URL hash
// in sync, then move focus to the target so keyboard users continue from there.
function wireAnchors() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.classList.contains('skip-link')) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    if (history.pushState) history.pushState(null, '', `#${id}`);
    scrollToTarget(el, {
      onDone: () => {
        if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
          el.setAttribute('tabindex', '-1');
        }
        el.focus({ preventScroll: true });
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      },
    });
  });
}

if (hasWindow) {
  document.documentElement.classList.toggle('has-lenis', !!lenis);
  wireAnchors();
  // Positions depend on web fonts and late images; refresh once they settle.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestRefresh(60));
  window.addEventListener('load', () => requestRefresh(60), { once: true });
  // Landing on /#section: Lenis starts at the native position; nothing else to do.
}

export { gsap, ScrollTrigger };
export default lenis;
