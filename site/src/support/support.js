import { track } from '../track.js';
import './support.css';
import { reveal } from '../fx/reveal.js';
import { flare } from '../fx/flare.js';
import {
  PRODUCT, TIPS_ORIGIN, TIPS_EMBED, TIPS_CREATOR, TIPS_PAGE,
  FEEDBACK_ENDPOINT, FEEDBACK_EMAIL, FEEDBACK_SOURCE,
} from './config.js';

/* Support section: a Beyond Apps tip card (the shared embed, rendered into our own glass frame) and a
   small feedback form (idea / bug / love, message, rating, optional email). Self-mounting:

     import { mountSupport } from './support/support.js';
     mountSupport(document.getElementById('support'));

   Optional floating pill that opens the same tip card in a modal:

     import { mountSupportButton } from './support/support.js';
     mountSupportButton();
*/

const KINDS = [
  { id: 'idea', label: 'Idea', hint: 'What should Bastion check, explain or fix next?' },
  { id: 'bug', label: 'Bug', hint: 'What happened, what you expected, and your OS and router if you know them.' },
  { id: 'love', label: 'Love', hint: 'What worked for you? Kind words keep a small project going.' },
];
const RATING_LABELS = ['Poor', 'Meh', 'Good', 'Great', 'Excellent'];
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const MSG_MIN = 3;
const MSG_MAX = 4000;
const MAILTO_BODY_MAX = 1800;
const TIPS_TIMEOUT_MS = 9000;

const ICON = {
  heart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/></svg>',
  chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 18.5V6.8A2.3 2.3 0 0 1 7.3 4.5h9.4A2.3 2.3 0 0 1 19 6.8v6.4a2.3 2.3 0 0 1-2.3 2.3H9z"/><path d="M9 9.5h6M9 12h3.5"/></svg>',
  send: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12 19.5 4.5 15 19.5l-3.2-6.3z"/><path d="m11.8 13.2 7.7-8.7"/></svg>',
  out: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.4"/><path d="M15.5 8.5V6.4A1.9 1.9 0 0 0 13.6 4.5H6.4a1.9 1.9 0 0 0-1.9 1.9v7.2a1.9 1.9 0 0 0 1.9 1.9h2.1"/></svg>',
  star: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.13L12 16.86l-5.5 2.9 1.05-6.13L3.1 9.3l6.15-.9z" fill="currentColor"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

// ?tip=success|cancel comes back from Stripe Checkout. The embed strips it, so read it first.
function tipStatus() {
  try { return new URL(location.href).searchParams.get('tip'); } catch { return null; }
}

// When the embed never ran, nobody else strips ?tip, so a reload or a shared link would show the
// thank-you again and count another paid tip. Same clean-up embed.js does.
function clearTipStatus() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has('tip')) return;
    u.searchParams.delete('tip');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  } catch { /* history blocked */ }
}

/* ---------- tips: the shared Beyond Apps embed, inline mode ---------- */

function loadTips(card) {
  const frame = card.querySelector('.sp-tipframe');
  if (!frame || frame.dataset.state) return;
  frame.dataset.state = 'loading';

  let settled = false;
  const fail = () => {
    if (settled) return;
    settled = true;
    frame.dataset.state = 'failed';
    frame.querySelector('.sp-tipframe__fallback').hidden = false;
    clearTipStatus();
  };
  const ready = () => {
    if (settled) return;
    settled = true;
    frame.dataset.state = 'ready';
  };

  // A Content-Security-Policy block never reaches the iframe's error handler; catch it here.
  const onViolation = (e) => {
    if (typeof e.blockedURI === 'string' && e.blockedURI.startsWith(TIPS_ORIGIN)) fail();
  };
  document.addEventListener('securitypolicyviolation', onViolation);

  const watch = new MutationObserver(() => {
    const iframe = frame.querySelector('iframe');
    if (!iframe) return;
    watch.disconnect();
    iframe.loading = 'eager';
    iframe.title = `Tip ${PRODUCT} through Beyond Apps`;
    iframe.addEventListener('load', ready, { once: true });
  });
  watch.observe(frame, { childList: true });

  const s = document.createElement('script');
  s.src = TIPS_EMBED;
  s.async = true;
  s.dataset.creator = TIPS_CREATOR;
  s.dataset.target = '#support-tips';
  s.dataset.theme = 'dark';
  s.addEventListener('error', fail, { once: true });
  document.body.appendChild(s);

  setTimeout(() => {
    if (!settled) (frame.querySelector('iframe') ? ready : fail)();
    else if (!frame.querySelector('iframe')) clearTipStatus();
    document.removeEventListener('securitypolicyviolation', onViolation);
  }, TIPS_TIMEOUT_MS);
}

/* ---------- feedback ---------- */

function validate(form) {
  const kind = form.elements.kind.value;
  const message = form.elements.message.value.replace(/\r\n/g, '\n').trim();
  const email = form.elements.email.value.trim();
  const ratingEl = form.querySelector('input[name="rating"]:checked');
  const rating = ratingEl ? Number(ratingEl.value) : null;

  if (!KINDS.some((k) => k.id === kind)) return { error: 'Pick what kind of note this is.', field: form.querySelector('input[name="kind"]') };
  if (message.length < MSG_MIN) return { error: 'Write a little more so we know what you mean.', field: form.elements.message };
  if (message.length > MSG_MAX) return { error: `Keep it under ${MSG_MAX} characters, please.`, field: form.elements.message };
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) return { error: 'That email address does not look right.', field: form.elements.email };
  return { data: { kind, message, rating, email: email || null } };
}

function mailtoUrl(fb) {
  const parts = [fb.message];
  if (fb.rating) parts.push(`Rating: ${fb.rating}/5`);
  if (fb.email) parts.push(`Reply to: ${fb.email}`);
  parts.push(`Sent from the ${PRODUCT} website`);
  let body = parts.join('\n\n');
  if (body.length > MAILTO_BODY_MAX) body = `${body.slice(0, MAILTO_BODY_MAX)}...`;
  const subject = `${PRODUCT} feedback: ${fb.kind}`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function postFeedback(fb) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : 0;
  try {
    let res;
    try {
      res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          ...fb,
          source: FEEDBACK_SOURCE,
          app: PRODUCT.toLowerCase(),
          page: location.pathname,
          lang: navigator.language || null,
        }),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (err) {
      // Network and CSP failures are TypeErrors with browser-specific text ('Failed to fetch').
      if (err && err.name === 'AbortError') throw err;
      throw new Error('Could not reach the inbox. Check your connection.');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body && typeof body.error === 'string' ? body.error : `The inbox answered with an error (${res.status}).`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function initFeedback(card) {
  const form = card.querySelector('form');
  const status = card.querySelector('.sp-status');
  const send = form.querySelector('.sp-send');
  const message = form.elements.message;
  const counter = card.querySelector('.sp-count');
  const stars = form.querySelector('.sp-stars');
  const rateLabel = form.querySelector('.sp-rate-label');
  const done = card.querySelector('.sp-done');

  const say = (text, tone = '') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  // kind: swap the message prompt
  form.addEventListener('change', (e) => {
    if (e.target.name === 'kind') {
      const k = KINDS.find((x) => x.id === e.target.value);
      if (k) message.placeholder = k.hint;
    }
  });

  // rating: a checked star can be clicked again to clear it
  let current = 0;
  const paint = (n, preview = false) => {
    stars.querySelectorAll('.sp-star').forEach((s, i) => s.classList.toggle('is-on', i < n));
    stars.classList.toggle('is-preview', preview);
    rateLabel.textContent = n ? RATING_LABELS[n - 1] : 'Optional';
  };
  stars.addEventListener('click', (e) => {
    const input = e.target.closest('.sp-star') && e.target.closest('.sp-star').querySelector('input');
    if (!input || e.target !== input) return;
    const n = Number(input.value);
    if (n === current) { input.checked = false; current = 0; } else current = n;
    paint(current);
  });
  stars.addEventListener('change', () => {
    const c = stars.querySelector('input:checked');
    current = c ? Number(c.value) : 0;
    paint(current);
  });
  stars.addEventListener('pointerover', (e) => {
    const s = e.target.closest('.sp-star');
    if (s && e.pointerType === 'mouse') paint(Number(s.querySelector('input').value), true);
  });
  stars.addEventListener('pointerleave', () => paint(current));

  const count = () => {
    const n = message.value.trim().length;
    counter.textContent = `${n} / ${MSG_MAX}`;
    counter.classList.toggle('is-over', n > MSG_MAX);
  };
  message.addEventListener('input', count);
  count();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (send.disabled) return;
    const v = validate(form);
    if (v.error) {
      say(v.error, 'error');
      if (v.field) v.field.focus();
      return;
    }
    const fb = v.data;

    if (!FEEDBACK_ENDPOINT) {
      track('feedback-mail');
      location.href = mailtoUrl(fb);
      say(`Your mail app should open with the note ready to send. If it did not, write to ${FEEDBACK_EMAIL}.`, 'ok');
      return;
    }

    send.disabled = true;
    form.setAttribute('aria-busy', 'true');
    say('Sending…');
    try {
      await postFeedback(fb);
      track('feedback-sent');
      form.reset();
      current = 0;
      paint(0);
      count();
      say('');
      form.hidden = true;
      done.hidden = false;
      done.querySelector('.sp-done__title').focus();
    } catch (err) {
      const why = err && err.name === 'AbortError' ? 'The inbox took too long to answer.' : (err && err.message) || 'Could not send right now.';
      say(`${why} You can send it by email instead.`, 'error');
      card.querySelector('.sp-mailbtn').hidden = false;
      card.querySelector('.sp-mailbtn').href = mailtoUrl(fb);
    } finally {
      send.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });

  done.querySelector('.sp-again').addEventListener('click', () => {
    done.hidden = true;
    form.hidden = false;
    message.focus();
  });

  // copy the inbox address
  const copyBtn = card.querySelector('.sp-copy');
  copyBtn.addEventListener('click', async () => {
    const addr = card.querySelector('.sp-addr');
    let ok = false;
    try { await navigator.clipboard.writeText(FEEDBACK_EMAIL); ok = true; } catch { /* clipboard blocked */ }
    if (!ok) {
      const r = document.createRange();
      r.selectNodeContents(addr);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    copyBtn.dataset.copied = ok ? 'true' : 'select';
    copyBtn.setAttribute('aria-label', ok ? 'Address copied' : 'Address selected, press Ctrl+C to copy');
    setTimeout(() => {
      delete copyBtn.dataset.copied;
      copyBtn.setAttribute('aria-label', 'Copy the address');
    }, 2200);
  });
}

/* ---------- markup ---------- */

function template(thanks) {
  const kinds = KINDS.map((k, i) => `
    <label class="sp-seg__opt">
      <input type="radio" name="kind" value="${k.id}"${i === 0 ? ' checked' : ''}>
      <span>${k.label}</span>
    </label>`).join('');
  const stars = [1, 2, 3, 4, 5].map((n) => `
    <label class="sp-star" title="${RATING_LABELS[n - 1]}">
      <input type="radio" name="rating" value="${n}" aria-label="${n} ${n === 1 ? 'star' : 'stars'}, ${RATING_LABELS[n - 1]}">
      ${ICON.star}
    </label>`).join('');

  return `
    <div class="sp-sky" aria-hidden="true">
      <div class="sp-glow"></div>
      <div class="sp-flare"><i class="sp-flare__haze"></i><i class="sp-flare__core"></i></div>
    </div>
    <div class="container sp">
      <header class="sec-head sec-head--center sp-head" data-reveal>
        <p class="eyebrow">Support ${PRODUCT}</p>
        <h2 class="display-l sp-title" id="support-title">Free stays free <span class="iris-text">because of you.</span></h2>
        <p class="lead">${PRODUCT} has no ads, no account and no upsell. A tip keeps it that way, and a short note tells us what to fix next.</p>
      </header>

      <div class="sp-grid" data-reveal-stagger="0.1">
        <article class="glass sp-card sp-card--tips" data-reveal="scale" aria-labelledby="sp-tips-title">
          <div class="sp-card__head">
            <span class="sp-badge sp-badge--tips">${ICON.heart}</span>
            <div>
              <h3 class="display-s" id="sp-tips-title">Leave a tip</h3>
              <p class="body-s">One-time or monthly, paid securely through Stripe. Any amount from $1.</p>
            </div>
          </div>
          <p class="sp-thanks pill pill--ok" role="status"${thanks ? '' : ' hidden'}>Thank you. Your tip went through.</p>
          <div class="sp-tipframe" id="support-tips">
            <div class="sp-tipframe__skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <div class="sp-tipframe__fallback" hidden>
              <p class="body-s">The tip card could not load on this page.</p>
              <a class="btn btn--primary" href="${TIPS_PAGE}" target="_blank" rel="noopener noreferrer">${ICON.out}Open the tip page</a>
            </div>
          </div>
          <p class="sp-note body-s dim">Tips go to Beyond Apps, the small team behind ${PRODUCT}. <a href="${TIPS_PAGE}" target="_blank" rel="noopener noreferrer">Open in a new tab</a></p>
        </article>

        <article class="glass sp-card sp-card--fb" data-reveal="scale" aria-labelledby="sp-fb-title">
          <div class="sp-card__head">
            <span class="sp-badge sp-badge--fb">${ICON.chat}</span>
            <div>
              <h3 class="display-s" id="sp-fb-title">Tell us anything</h3>
              <p class="body-s">Ideas, bugs or a kind word. Every note is read.</p>
            </div>
          </div>

          <form class="sp-form" novalidate>
            <fieldset class="sp-seg">
              <legend class="sr-only">Kind of note</legend>
              ${kinds}
            </fieldset>

            <label class="sp-field">
              <span class="sp-field__label">Message <span class="sp-count mono" aria-hidden="true"></span></span>
              <textarea name="message" rows="5" maxlength="${MSG_MAX + 200}" required placeholder="${KINDS[0].hint}"></textarea>
            </label>

            <div class="sp-row">
              <fieldset class="sp-rate">
                <legend class="sp-field__label">Rating <span class="sp-rate-label dim">Optional</span></legend>
                <div class="sp-stars">${stars}</div>
              </fieldset>
              <label class="sp-field sp-field--email">
                <span class="sp-field__label">Email <span class="dim">Optional, for a reply</span></span>
                <input type="email" name="email" autocomplete="email" inputmode="email" maxlength="254" placeholder="you@example.com">
              </label>
            </div>

            <div class="sp-actions">
              <button class="btn btn--primary sp-send" type="submit">${ICON.send}Send</button>
              <a class="btn btn--ghost sp-mailbtn" href="mailto:${FEEDBACK_EMAIL}" hidden>Send by email</a>
              <p class="sp-status body-s" role="status" aria-live="polite"></p>
            </div>
          </form>

          <div class="sp-done" hidden>
            <span class="sp-badge sp-badge--ok">${ICON.check}</span>
            <h4 class="display-s sp-done__title" tabindex="-1">Sent. Thank you.</h4>
            <p class="body-s">Your note is in the inbox. If you left an email, we may write back.</p>
            <button class="btn btn--ghost btn--sm sp-again" type="button">Send another</button>
          </div>

          <p class="sp-mail body-s">Prefer email? Write to
            <span class="sp-addr mono">${FEEDBACK_EMAIL}</span>
            <button class="sp-copy" type="button" aria-label="Copy the address">${ICON.copy}</button>
          </p>
        </article>
      </div>
    </div>`;
}

export function mountSupport(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = 'true';
  el.classList.add('sec', 'sec--support');
  el.setAttribute('aria-labelledby', 'support-title');

  const status = tipStatus();
  el.innerHTML = template(status === 'success');

  const tips = el.querySelector('.sp-card--tips');
  const fb = el.querySelector('.sp-card--fb');
  initFeedback(fb);

  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    el.querySelectorAll('.sp-send').forEach((b) => flare(b, { y: 0.5, color: '#ffffff' }));
  }

  // The embed is a third-party script: load it only as the section comes near, or straight away
  // when the visitor is coming back from Checkout or jumped here by link.
  const now = status || location.hash === '#support' || !('IntersectionObserver' in window);
  if (now) loadTips(tips);
  else {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); loadTips(tips); }
    }, { rootMargin: '700px 0px' });
    io.observe(el);
  }
  if (status === 'success') requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));

  reveal(el);
}

// Floating "Support Bastion" pill (bottom corner) that opens the tip card in a modal.
export function mountSupportButton({ label = `Support ${PRODUCT}`, position = 'right' } = {}) {
  if (document.querySelector('script[data-sp-button]')) return;
  // Back from Checkout with the inline section on the page: let that one embed take ?tip, or the
  // button's embed may strip it first and pop its modal over the section's thank-you.
  if (tipStatus() && (document.getElementById('support-tips') || document.getElementById('support'))) return;
  const s = document.createElement('script');
  s.src = TIPS_EMBED;
  s.async = true;
  s.dataset.spButton = '';
  s.dataset.creator = TIPS_CREATOR;
  s.dataset.mode = 'button';
  s.dataset.theme = 'dark';
  s.dataset.label = label;
  if (position === 'left') s.dataset.position = 'left';
  document.body.appendChild(s);
}

export default mountSupport;
