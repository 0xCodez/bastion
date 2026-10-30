// Hero: the app's real 3D router scene behind one big statement and the download buttons.
// The CSS planet horizon is the resting state (first paint, no WebGL, reduced data, failures);
// the three.js scene is loaded after first paint and cross-fades in over it.

const RELEASES = 'https://github.com/0xCodez/bastion/releases/latest';
const REPO = 'https://github.com/0xCodez/bastion';

const AGENTS = [
  { id: 'claude', label: 'Claude', active: true },
  { id: 'openai', label: 'ChatGPT', active: true },
  { id: 'grok', label: 'Grok', active: true },
];

const ICON_DL =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/></svg>';
const ICON_GH =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.5 9.5 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2.2z"/></svg>';
const ICON_ARROW =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>';

function detectOS() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = (nav.userAgent || '').toLowerCase();
  const platform = ((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '').toLowerCase();
  if (/iphone|ipad|ipod|android|mobile/.test(ua)) return 'mobile';
  // iPadOS reports a Mac user agent; touch points give it away.
  if ((platform.includes('mac') || ua.includes('mac os x')) && (nav.maxTouchPoints || 0) > 1) return 'mobile';
  if (platform.includes('mac') || ua.includes('mac os x')) return 'mac';
  if (platform.includes('win') || ua.includes('windows')) return 'win';
  return 'other';
}

function prefersReduced() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canTry3D(os) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  if (nav.connection && nav.connection.saveData) return false;
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency < 3) return false;
  // Phones and tablets keep the CSS horizon: the app can't be installed there, so they
  // shouldn't pay for the 3D bundle. hero3d falls back by itself when WebGL fails.
  if (os === 'mobile') return false;
  if (typeof matchMedia === 'function' && matchMedia('(max-width: 760px), (pointer: coarse)').matches) return false;
  return true;
}

// After the first paint and once the browser is idle, so the 3D bundle never competes with LCP.
function afterFirstPaint(fn) {
  const go = () => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 4000 });
        else setTimeout(fn, 1200);
      }, 0);
    });
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

export function mount(el) {
  if (!el) return;
  const os = detectOS();
  // No download is emphasised on phones and tablets: neither installs there.
  const primary = os === 'mobile' ? null : os === 'mac' ? 'mac' : 'win';
  const reduced = prefersReduced();

  el.setAttribute('aria-labelledby', 'hero-title');
  el.innerHTML = `
    <div class="hero__sky" aria-hidden="true">
      <div class="hero__stars"></div>
      <div class="hero__planet"></div>
      <div class="hero__pool"></div>
    </div>
    <div class="hero__stage" aria-hidden="true"></div>
    <div class="hero__veil" aria-hidden="true"></div>

    <div class="container hero__inner">
      <div class="hero__copy">
        <p class="eyebrow hero__eyebrow hero__rise">Free · open source · Windows &amp; macOS</p>
        <h1 class="hero__title" id="hero-title">
          <span class="hero__line hero__rise">Your router has doors you never opened.</span>
          <span class="hero__line hero__line--grad hero__rise">Bastion closes them.</span>
        </h1>
        <p class="lead hero__lead hero__rise">A free desktop app that finds the ways into your home network you never asked for, explains each one in plain words and shows you how to shut it. It never logs in to your router and never changes a setting on its own.</p>

        <div class="hero__actions hero__rise">
          <div class="hero__ctas">
            <a class="btn btn--lg hero__dl" data-os="win" href="${RELEASES}" rel="noopener">${ICON_DL}<span>Download for Windows</span></a>
            <a class="btn btn--lg hero__dl" data-os="mac" href="${RELEASES}" rel="noopener">${ICON_DL}<span>Download for macOS</span></a>
          </div>
          <a class="hero__gh" href="${REPO}" rel="noopener">${ICON_GH}<span>View on GitHub</span>${ICON_ARROW}</a>
        </div>
        <p class="hero__note" ${os === 'mobile' ? '' : 'hidden'}>Bastion is a desktop app. Open this page on a Windows PC or a Mac to install it.</p>

        <ul class="hero__trust hero__rise" role="list" aria-label="Good to know">
          <li>MIT licensed</li>
          <li>Your API keys stay on your computer</li>
          <li>No account</li>
        </ul>
      </div>
    </div>
  `;

  // Emphasise the download for the visitor's OS; the other stays one tap away.
  const ctas = el.querySelector('.hero__ctas');
  ctas.querySelectorAll('.hero__dl').forEach((a) => {
    const isPrimary = a.dataset.os === primary;
    a.classList.add(isPrimary ? 'btn--primary' : 'btn--ghost');
    a.classList.toggle('is-primary', isPrimary);
    if (isPrimary) ctas.prepend(a);
  });

  if (!reduced) el.classList.add('is-intro');

  const stage = el.querySelector('.hero__stage');
  let hero = null;
  let disposed = false;
  let inView = true;
  let flareTimer = 0;
  let storyTimer = 0;
  let flareIndex = 0;

  function call(name, ...args) {
    if (!hero || typeof hero[name] !== 'function') return;
    try {
      hero[name](...args);
    } catch (err) {
      console.warn(`[hero] ${name} failed`, err);
    }
  }

  function scheduleFlares() {
    clearInterval(flareTimer);
    if (reduced) return;
    flareTimer = setInterval(() => {
      if (document.hidden || !inView) return;
      call('flareAgent', AGENTS[flareIndex % AGENTS.length].id);
      flareIndex += 1;
    }, 4200);
  }

  function useFallback(reason) {
    if (reason) console.warn('[hero] 3D scene unavailable, keeping the CSS horizon:', reason);
    el.classList.add('is-flat');
    el.classList.add('is-closed');
  }

  function start3D() {
    if (disposed) return;
    if (!canTry3D(os)) {
      useFallback();
      return;
    }
    import('../vendor/hero3d.js')
      .then((mod) => {
        if (disposed) return;
        const api = mod.initRouterHero(stage, {
          focusY: 0.34,
          // The story: doors open first, then Bastion closes them.
          threat: reduced ? 0 : 2,
          shield: true,
          agents: AGENTS,
          intro: !reduced,
        });
        // hero3d draws its own static backdrop when WebGL setup fails; ours is the same idea
        // and is already on screen, so drop theirs.
        if (stage.querySelector('[data-hero-fallback]')) {
          try { api.dispose(); } catch { /* nothing to release */ }
          useFallback('WebGL setup failed');
          return;
        }
        hero = api;
        call('setAgents', AGENTS);
        call('setSignal', null);
        call('setShield', true);
        requestAnimationFrame(() => el.classList.add('is-3d'));

        if (reduced) {
          el.classList.add('is-closed');
          return;
        }
        storyTimer = setTimeout(() => {
          call('setThreat', 0);
          call('pulse');
          el.classList.add('is-closed');
          call('flareAgent', 'claude');
          flareIndex = 1;
          scheduleFlares();
        }, 4200); // after the 3.5 s intro, so the closing pulse plays in the final framing
      })
      .catch((err) => useFallback(err && err.message ? err.message : String(err)));
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      inView = entries[0].isIntersecting;
    });
    io.observe(el);
  }

  if (reduced) el.classList.add('is-closed');
  afterFirstPaint(start3D);

  // Vite HMR / SPA hygiene: release the WebGL context if the section is torn down.
  el.addEventListener('bastion:unmount', () => {
    disposed = true;
    clearInterval(flareTimer);
    clearTimeout(storyTimer);
    call('dispose');
    hero = null;
  });
}

export default mount;
