// Site chrome behaviour: nav condensing on scroll, mobile menu, active-section highlight.

export function initNav(nav = document.querySelector('[data-nav]')) {
  if (!nav) return;

  // condense once the page leaves the very top (sentinel instead of a scroll listener)
  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:48px;pointer-events:none;';
  document.body.prepend(sentinel);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => nav.classList.toggle('is-condensed', !e.isIntersecting)).observe(sentinel);
  } else {
    const onScroll = () => nav.classList.toggle('is-condensed', window.scrollY > 48);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // mobile menu
  const btn = nav.querySelector('.site-nav__menu-btn');
  const menu = nav.querySelector('#navMenu');
  if (btn && menu) {
    const setOpen = (open, { focusButton = false } = {}) => {
      menu.hidden = !open;
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (open) menu.querySelector('a')?.focus({ preventScroll: true });
      else if (focusButton) btn.focus({ preventScroll: true });
    };
    btn.addEventListener('click', () => setOpen(menu.hidden));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) setOpen(false, { focusButton: true });
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !nav.contains(e.target)) setOpen(false);
    });
    window.matchMedia('(min-width: 921px)').addEventListener?.('change', (m) => { if (m.matches) setOpen(false); });
  }

  // highlight the link for the section in view
  const links = [...nav.querySelectorAll('[data-nav-link]')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const byId = new Map(links.map((a) => [a.dataset.navLink, a]));
  const visible = new Map();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
      let best = null;
      let bestRatio = 0;
      for (const [id, r] of visible) if (r > bestRatio) { best = id; bestRatio = r; }
      for (const [id, a] of byId) {
        if (id === best) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    },
    { rootMargin: '-35% 0px -45% 0px', threshold: [0, 0.01, 0.25, 0.5, 0.75, 1] },
  );
  for (const id of byId.keys()) {
    const sec = document.getElementById(id);
    if (sec) io.observe(sec);
  }
}
