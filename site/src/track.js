// Cookieless analytics for the private dashboard (/dashboard). The server keeps only daily counts;
// nothing here sets a cookie or stores an ID. Off on local hosts and when Do Not Track or Global
// Privacy Control is on.
//
// What is counted:
//   page view on load, a light "still here" ping while the tab is visible (for "live now"),
//   download clicks: links to github.com/0xCodez/bastion/releases (platform from data-platform or
//     the file name; placement from data-place, else the closest [data-section], nav or footer),
//   links to the releases page itself (a click, 'releases-page', never a download),
//   GitHub repo links, tips links, the tips button and the first touch of the inline tip card,
//   feedback mailto links, any element with data-track="<key>" (lowercase letters, digits, - _ :),
//   and anything a module reports with track('<key>') (e.g. a feedback form after it sends).
import { platformOfUrl } from '../api/_platform.js';

const ENDPOINT = '/api/track';
const HEARTBEAT_MS = 2 * 60 * 1000;
const HEARTBEAT_MAX = 15; // stop pinging after about 30 minutes on one page

const host = location.hostname;
const local =
  location.protocol === 'file:' ||
  /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)$/.test(host) ||
  host.endsWith('.localhost') ||
  host.endsWith('.local') ||
  host.endsWith('.test');
const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
const enabled = !local && !dnt;

function send(event) {
  if (!enabled) return;
  const body = JSON.stringify(event);
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
  } catch {
    // fall through to fetch
  }
  fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
}

const KEY = /^[a-z0-9:_-]{1,40}$/;
const click = (k) => KEY.test(k) && send({ t: 'click', k });
const once = new Set();

// For actions that are not link clicks (a form that sends, a mail app opened from script).
export function track(key) {
  click(String(key || '').toLowerCase());
}

function placeOf(el) {
  const own = el.closest('[data-place]')?.dataset.place;
  if (own) return own;
  if (el.closest('#navMenu')) return 'menu';
  if (el.closest('[data-nav], .site-nav')) return 'nav';
  if (el.closest('.site-footer, footer')) return 'footer';
  return el.closest('[data-section]')?.dataset.section || 'other';
}

function onClick(event) {
  const target = event.target instanceof Element ? event.target : null;

  // The tips button lives in a shadow root, so a click only reaches us retargeted to its host.
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  if (path.some((n) => n.classList && (n.classList.contains('fab') || n.classList.contains('bt-fab')))) click('tips-open');
  // The inline tip card (support section): count the first interaction per page load, not every tap.
  if (!once.has('tips-card') && path.some((n) => n.classList && n.classList.contains('sp-tipframe'))) {
    once.add('tips-card');
    click('tips-card');
  }

  if (!target) return;
  const tagged = target.closest('[data-track]');
  if (tagged) click(String(tagged.dataset.track).toLowerCase());

  const link = target.closest('a[href]');
  if (!link) return;
  const href = link.href;

  const platform = link.dataset.platform || platformOfUrl(href);
  if (platform === 'page') return click('releases-page');
  if (platform) {
    send({ t: 'dl', k: platform, w: placeOf(link) });
    return;
  }
  if (tagged) return; // already counted under its own key

  if (/beyond-media\.ai\/tips/i.test(href)) return click('tips-link');
  if (/^mailto:/i.test(href)) return click('feedback-mail');
  const gh = href.match(/github\.com\/0xCodez\/bastion(\/[^?#]*)?/i);
  if (gh) {
    const rest = (gh[1] || '').replace(/\/+$/, '');
    if (!rest) return click('github');
    if (/^\/issues/.test(rest)) return click('github-issues');
    if (/^\/discussions/.test(rest)) return click('github-discussions');
    if (/security/.test(rest)) return click('github-security');
    if (/license/i.test(rest)) return click('github-license');
    return click('github-other');
  }
}

function heartbeat() {
  let beats = 0;
  let timer = 0;
  const tick = () => {
    if (document.visibilityState !== 'visible' || beats >= HEARTBEAT_MAX) return;
    beats++;
    send({ t: 'hb' });
  };
  const arm = () => {
    clearInterval(timer);
    if (document.visibilityState === 'visible') timer = setInterval(tick, HEARTBEAT_MS);
  };
  document.addEventListener('visibilitychange', arm);
  arm();
}

export function initTracking() {
  if (!enabled || window.__bastionTrack) return;
  window.__bastionTrack = true;

  const params = new URLSearchParams(location.search);
  send({
    t: 'pv',
    p: location.pathname,
    r: document.referrer,
    u: params.get('utm_source') || params.get('ref') || undefined,
  });
  // Stripe sends people back with ?tip=success (the tips embed strips it later, so read it now).
  if (params.get('tip') === 'success') click('tips-paid');

  document.addEventListener('click', onClick, { capture: true });
  // middle-click / ctrl-click opening a download in a new tab
  document.addEventListener('auxclick', (e) => e.button === 1 && onClick(e), { capture: true });
  heartbeat();
}

// Loading the module is enough: `import './track.js'` from main.js, or a module script tag.
initTracking();
