// Scroll reveal that never hides content.
//
//   import { reveal } from '../fx/reveal.js';
//   reveal(sectionEl);               // every [data-reveal] inside sectionEl (and sectionEl itself)
//
// Markup:
//   <h2 data-reveal>…</h2>                 quick rise + fade (default, no blur)
//   <div data-reveal="fade">…</div>        no movement, opacity only
//   <div data-reveal="scale">…</div>       slight rise and scale-up
//   <div data-reveal="left|right">…</div>  slides in from that side
//   <ul data-reveal-stagger="0.08">        children with [data-reveal] get increasing delays
//   <p data-reveal style="--reveal-delay:.2s">  explicit delay
//
// Resting state is fully visible. Only elements that are below the fold when reveal() runs get the
// "armed" class (hidden + offset); the observer adds .is-in as they enter, and safety nets (scroll
// settle, hash jumps, load, resize) settle anything that has reached the viewport regardless. Elements already on
// screen, reduced-motion users and browsers without IntersectionObserver are left untouched.
// Returns a cleanup function.

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function reveal(root = document, opts = {}) {
  if (!root || typeof window === 'undefined') return () => {};
  const { threshold = 0.01, rootMargin = '0px 0px -10% 0px' } = opts;

  const els = [];
  if (root.matches && root.matches('[data-reveal]')) els.push(root);
  root.querySelectorAll('[data-reveal]').forEach((el) => els.push(el));

  // stagger: give each [data-reveal] child of a [data-reveal-stagger] parent an increasing delay
  root.querySelectorAll('[data-reveal-stagger]').forEach((parent) => {
    const step = parseFloat(parent.getAttribute('data-reveal-stagger')) || 0.08;
    let i = 0;
    for (const child of parent.children) {
      if (!child.hasAttribute('data-reveal')) continue;
      if (!child.style.getPropertyValue('--reveal-delay')) {
        child.style.setProperty('--reveal-delay', `${(i * step).toFixed(3)}s`);
      }
      i++;
    }
  });

  if (!els.length || reduceMotion() || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('is-in'));
    return () => {};
  }

  const vh = window.innerHeight || document.documentElement.clientHeight;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { threshold, rootMargin },
  );

  for (const el of els) {
    if (el.classList.contains('is-in')) continue;
    const top = el.getBoundingClientRect().top;
    if (top < vh * 0.92) {
      // already on screen (or scrolled past): show as-is, no animation
      el.classList.add('is-in');
      continue;
    }
    el.classList.add('reveal-armed');
    io.observe(el);
  }

  // Jumping via an anchor or "find in page" can skip past elements; un-arm anything above the fold.
  let hashT = 0;
  const unarmPassed = () => {
    for (const el of els) {
      if (el.classList.contains('reveal-armed') && !el.classList.contains('is-in') &&
          el.getBoundingClientRect().top < window.innerHeight) {
        el.classList.add('is-in');
        io.unobserve(el);
      }
    }
  };
  const onHash = () => {
    clearTimeout(hashT);
    hashT = setTimeout(unarmPassed, 900); // after a smooth scroll has landed
  };
  window.addEventListener('hashchange', onHash);
  // Safety net: anything that has scrolled into view settles even if the observer misses it.
  let scrollT = 0;
  const onScroll = () => {
    clearTimeout(scrollT);
    scrollT = setTimeout(unarmPassed, 400);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  window.addEventListener('load', unarmPassed, { once: true });

  return () => {
    io.disconnect();
    clearTimeout(hashT);
    clearTimeout(scrollT);
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    window.removeEventListener('load', unarmPassed);
  };
}

export default reveal;
