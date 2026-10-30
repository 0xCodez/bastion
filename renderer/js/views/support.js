// Support view: tips (Beyond Apps tip jar, Stripe Checkout in the browser) and feedback
// (idea / bug / love, rating, message, optional email, optional app version and OS).
// Talks only to api.support.* (electron/support.js); every call resolves { ok, ... } or { ok: false, error }.

import { initGlowKit } from '../glow-kit.js';

const NAME_MAX = 60;
const NOTE_MAX = 280;
const MSG_MIN = 3;
const MSG_MAX = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATING_LABELS = ['Not great', 'Could be better', 'It is okay', 'Pretty good', 'Love it'];
const PLACEHOLDERS = {
  idea: 'What would make Bastion more useful on your network?',
  bug: 'What happened, and what did you expect instead?',
  love: 'What do you like about Bastion?',
};
const SEND_SUB = { idea: 'Idea', bug: 'Bug report', love: 'Kind words' };
const DONE_TITLES = {
  endpoint: 'Sent. Thank you.',
  email: 'Your mail app is open with the message ready',
  saved: 'Saved on this computer. Thank you.',
};

const ICONS = {
  heart: '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/>',
  shield: '<path d="M12 2.5l8 3.2v5.6c0 5-3.4 9.1-8 10.7-4.6-1.6-8-5.7-8-10.7V5.7z"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4.5 7l7.5 6 7.5-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chat: '<path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z"/>',
  retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-8A5.5 5.5 0 0 0 7 9.5a4.5 4.5 0 0 0 0 9z"/>',
};
const icon = (name, cls = '') => `<svg class="su-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

const errMsg = (err, fallback) => String((err && err.message) || err || fallback);

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

function currencySymbol(currency) {
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).formatToParts(0);
    const p = parts.find((x) => x.type === 'currency');
    return p ? p.value : currency.toUpperCase();
  } catch {
    return currency.toUpperCase();
  }
}

/** Returns the amount, or an error message for the custom field. */
function parseCustom(raw, profile) {
  let text = raw.trim().replace(/\s+/g, '');
  // "1,000" or "1,000.50" is thousands grouping; any other single comma is a decimal comma ("7,50")
  text = /^\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return 'Use a number like 15 or 7.50';
  const n = Number(text);
  if (n < profile.min) return `The minimum is ${formatMoney(profile.min, profile.currency)}`;
  if (n > profile.max) return `The maximum is ${formatMoney(profile.max, profile.currency)}`;
  return Math.round(n * 100) / 100;
}

export function mount(el, ctx) {
  const { api, toast } = ctx;
  const support = api.support;
  let alive = true;

  // tip state
  let load = 'loading'; // 'loading' | 'error' | 'ready'
  let profile = null;
  let preset = null;
  let monthly = false;
  let tipBusy = false;
  let checkoutUrl = null;
  // feedback state
  let kind = 'idea';
  let rating = null;
  let hoverRating = null;
  let includeSys = false;
  let sending = false;
  let system = null;

  el.innerHTML = `
    <section class="v-support view-pad" aria-labelledby="su-title">
      <header class="su-head">
        <div>
          <p class="eyebrow">Support</p>
          <h1 class="h-display" id="su-title">Keep Bastion free.</h1>
        </div>
        <p class="su-lede">Bastion is free, with no ads, no account and no tracking. If it helped you close a door on your network, a small tip keeps it that way.</p>
      </header>

      <div class="su-grid">
        <section class="su-card su-hero" aria-label="About tips">
          <div class="su-orb" aria-hidden="true"><span class="su-orb__halo"></span><span class="su-orb__core">${icon('heart')}</span></div>
          <div class="su-hero__in">
            <p class="su-kicker"><span class="dot dot--ok"></span>Independent · ad-free</p>
            <h2 class="su-h2">A note from the maker</h2>
            <p class="su-note">I build Bastion on my own, in the evenings, because everyone deserves to know who can reach their router. Every tip, big or small, buys time for new checks, fixes and support for more routers. Thank you for being here.</p>
            <ul class="su-perks">
              <li>${icon('shield')}No ads, no tracking, no paywalls</li>
              <li>${icon('spark')}New checks, shaped by your feedback</li>
              <li>${icon('heart')}Built independently, with care</li>
            </ul>
            <div class="su-amount" aria-live="polite" data-amount hidden>
              <span class="su-label" data-amount-label>Your tip</span>
              <span class="su-big" data-big>-</span>
              <span class="su-supporters" data-supporters hidden><span class="su-dots" aria-hidden="true"><i></i><i></i><i></i></span><span data-supporters-text></span></span>
            </div>
          </div>
        </section>

        <section class="su-card su-tip" aria-label="Choose a tip" aria-busy="true" data-tip>
          <div class="su-skel" data-tip-loading aria-label="Loading"><i class="short"></i><i></i><i></i><i class="short"></i><i></i><i class="tall"></i></div>

          <div class="su-state" data-tip-error hidden>
            <span class="su-badge">${icon('cloud')}</span>
            <h3>Can't reach the tip jar</h3>
            <p data-tip-error-text>Something went wrong while loading. Please try again in a moment.</p>
            <div class="su-row"><button type="button" class="btn btn--outline" data-tip-retry>${icon('retry')}Try again</button></div>
          </div>

          <div class="su-state" data-tip-done role="status" hidden>
            <span class="su-badge su-badge--mint">${icon('heart')}</span>
            <h3>Checkout opened in your browser</h3>
            <p data-tip-done-text></p>
            <div class="su-row">
              <button type="button" class="btn btn--outline" data-tip-again>${icon('globe')}Open again</button>
              <button type="button" class="btn btn--ghost" data-tip-change>Change amount</button>
            </div>
          </div>

          <div class="su-form" data-tip-form hidden>
            <div class="su-sec">
              <div class="su-sec-h">
                <b id="su-amount-label">Amount</b>
                <div class="gk-segment su-seg" role="tablist" aria-label="Tip frequency" data-freq>
                  <button role="tab" aria-selected="true" data-value="once">One-time</button>
                  <button role="tab" aria-selected="false" data-value="monthly">Monthly</button>
                </div>
              </div>
              <div class="su-presets" role="group" aria-labelledby="su-amount-label" data-presets></div>
              <label class="su-field">
                <span class="su-label">Or your own amount</span>
                <span class="su-custom"><span class="su-cur" aria-hidden="true" data-cur>$</span><input class="field su-input" inputmode="decimal" maxlength="8" aria-describedby="su-custom-hint" data-custom></span>
                <span class="su-hint" id="su-custom-hint" data-custom-hint></span>
              </label>
            </div>
            <div class="su-two">
              <label class="su-field">
                <span class="su-label">Your name (optional)</span>
                <input class="field su-input" maxlength="${NAME_MAX}" placeholder="How we can thank you" data-name>
              </label>
              <label class="su-field">
                <span class="su-sec-h"><span class="su-label">A note (optional)</span><span class="su-count" data-note-count>0/${NOTE_MAX}</span></span>
                <textarea class="field su-textarea" rows="3" maxlength="${NOTE_MAX}" placeholder="Say hi, or tell us what to check next" data-note></textarea>
              </label>
            </div>
            <div class="su-actions">
              <button type="button" class="gk-btn gk-btn--primary su-go" data-tip-go disabled>${icon('heart')}<span data-tip-go-label>Tip</span></button>
              <span class="su-hint" data-tip-go-hint>Opens Stripe Checkout in your browser.</span>
            </div>
            <p class="su-foot">${icon('lock')}<span>Payments are handled by Stripe via beyond-media.ai. Bastion never sees your card.</span></p>
          </div>
        </section>

        <section class="su-card su-fb" aria-labelledby="su-fb-title">
          <div class="su-fb-h">
            <div>
              <p class="su-kicker"><span class="dot dot--info"></span>Read by a human</p>
              <h2 class="su-h2" id="su-fb-title">Tell us anything</h2>
            </div>
            <p class="su-fine">Ideas, bugs, or a kind word. Every message is read, and it shapes what comes next.</p>
          </div>

          <div class="su-state" data-fb-done role="status" hidden>
            <span class="su-badge su-badge--mint" data-fb-done-badge>${icon('check')}</span>
            <h3 data-fb-done-title></h3>
            <p data-fb-done-text></p>
            <div class="su-row"><button type="button" class="btn btn--outline" data-fb-again>${icon('chat')}Send another</button></div>
          </div>

          <form class="su-form" data-fb-form novalidate>
            <div class="su-sec su-sec--row">
              <div class="su-sec-h">
                <b>What is it about?</b>
                <div class="gk-segment su-seg" role="tablist" aria-label="Feedback type" data-kind>
                  <button role="tab" aria-selected="true" data-value="idea">Idea</button>
                  <button role="tab" aria-selected="false" data-value="bug">Bug</button>
                  <button role="tab" aria-selected="false" data-value="love">Love</button>
                </div>
              </div>
              <div class="su-sec-h">
                <b>How is Bastion working for you?</b>
                <div class="su-rate">
                  <div class="su-stars" role="radiogroup" aria-label="Rating" data-stars>
                    ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" class="su-star" aria-checked="false" tabindex="${n === 1 ? 0 : -1}" aria-label="${n} ${n === 1 ? 'star' : 'stars'}, ${RATING_LABELS[n - 1]}" data-star="${n}">${STAR}</button>`).join('')}
                  </div>
                  <span class="su-rate-label" aria-hidden="true" data-rate-label>Optional</span>
                </div>
              </div>
            </div>

            <label class="su-field">
              <span class="su-sec-h"><span class="su-label">Message</span><span class="su-count" data-msg-count>0/${MSG_MAX}</span></span>
              <textarea class="field su-textarea" rows="5" maxlength="${MSG_MAX}" placeholder="${PLACEHOLDERS.idea}" aria-describedby="su-msg-hint" data-msg></textarea>
              <span class="su-hint" id="su-msg-hint" data-msg-hint>Ctrl + Enter to send</span>
            </label>

            <div class="su-two">
              <label class="su-field">
                <span class="su-label">Email (optional, only if you want a reply)</span>
                <input class="field su-input" type="email" maxlength="120" placeholder="you@example.com" aria-describedby="su-email-hint" data-email>
                <span class="su-hint" id="su-email-hint" data-email-hint></span>
              </label>
              <div class="su-field su-sys">
                <div class="su-switch">
                  <span class="su-switch__txt">
                    <b id="su-sys-label">Include app version and OS</b>
                    <span data-sys-hint>Off unless you turn it on. Nothing else from your computer is sent.</span>
                  </span>
                  <button class="gk-toggle" type="button" role="switch" aria-checked="false" aria-labelledby="su-sys-label" data-sys></button>
                </div>
                <pre class="su-pre" aria-label="System info that will be included" data-sys-pre hidden></pre>
              </div>
            </div>

            <div class="su-actions">
              <button type="submit" class="gk-btn gk-btn--primary su-go" data-fb-go disabled>${icon('chat')}<span>Send</span><small data-fb-go-sub>Idea</small></button>
              <span class="su-hint" data-fb-go-hint>Write at least ${MSG_MIN} characters to send.</span>
            </div>
          </form>

          <ul class="su-promises" aria-label="How feedback is handled">
            <li>${icon('lock')}Only what you see on this page is sent.</li>
            <li>${icon('shield')}No scan results, device lists or addresses are attached.</li>
            <li>${icon('mail')}Leave an email if you would like a reply.</li>
          </ul>
        </section>
      </div>
    </section>`;

  const $ = (sel) => el.querySelector(sel);
  const glowCleanup = initGlowKit(el);

  /* ---------------------------------------------------------------- tips */

  const tipCard = $('[data-tip]');
  const customIn = $('[data-custom]');
  const nameIn = $('[data-name]');
  const noteIn = $('[data-note]');

  function currentAmount() {
    if (!profile) return { amount: null, error: null };
    if (customIn.value.trim() !== '') {
      const parsed = parseCustom(customIn.value, profile);
      return typeof parsed === 'string' ? { amount: null, error: parsed } : { amount: parsed, error: null };
    }
    return { amount: preset, error: null };
  }

  function renderTip() {
    tipCard.setAttribute('aria-busy', String(load === 'loading'));
    $('[data-tip-loading]').hidden = load !== 'loading';
    $('[data-tip-error]').hidden = load !== 'error';
    $('[data-tip-done]').hidden = !(load === 'ready' && checkoutUrl);
    $('[data-tip-form]').hidden = !(load === 'ready' && !checkoutUrl);
    $('[data-amount]').hidden = load !== 'ready';
    if (load !== 'ready') return;

    const { amount, error } = currentAmount();
    const valid = amount !== null && amount >= profile.min && amount <= profile.max;
    const money = amount !== null ? formatMoney(amount, profile.currency) : null;
    const per = monthly ? ' / month' : '';

    $('[data-amount-label]').textContent = checkoutUrl ? 'Thank you' : 'Your tip';
    $('[data-big]').innerHTML = '';
    $('[data-big]').append(money || '-');
    if (money && monthly) {
      const s = document.createElement('small');
      s.textContent = ' / month';
      $('[data-big]').append(s);
    }
    const n = profile.supporterCount;
    $('[data-supporters]').hidden = !(n > 0);
    $('[data-supporters-text]').textContent = `${n.toLocaleString('en-US')} ${n === 1 ? 'person has' : 'people have'} chipped in`;

    const usingCustom = customIn.value.trim() !== '';
    for (const b of el.querySelectorAll('[data-preset]')) {
      b.setAttribute('aria-pressed', String(!usingCustom && Number(b.dataset.preset) === preset));
    }
    const hint = $('[data-custom-hint]');
    hint.textContent = error || `Anything from ${formatMoney(profile.min, profile.currency)} to ${formatMoney(profile.max, profile.currency)}`;
    hint.classList.toggle('is-err', !!error);
    customIn.setAttribute('aria-invalid', String(!!error));
    $('[data-note-count]').textContent = `${noteIn.value.length}/${NOTE_MAX}`;
    $('[data-note-count]').classList.toggle('is-near', noteIn.value.length > NOTE_MAX - 30);

    const go = $('[data-tip-go]');
    go.disabled = !valid || tipBusy;
    go.classList.toggle('is-busy', tipBusy);
    $('[data-tip-go-label]').textContent = tipBusy ? 'Opening checkout' : (valid && money ? `Tip ${money}${per}` : 'Tip');
    $('[data-tip-go-hint]').textContent = monthly ? 'Billed monthly until you cancel. Cancel anytime.' : 'Opens Stripe Checkout in your browser.';
    if (checkoutUrl) $('[data-tip-done-text]').textContent = `Finish your ${money || ''}${monthly ? ' monthly' : ''} tip on the secure Stripe page. Thank you for keeping Bastion free.`;
  }

  function buildPresets() {
    const host = $('[data-presets]');
    host.innerHTML = '';
    for (const p of profile.presets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'su-chip';
      b.dataset.preset = String(p);
      b.setAttribute('aria-pressed', 'false');
      b.textContent = formatMoney(p, profile.currency);
      host.append(b);
    }
    $('[data-cur]').textContent = currencySymbol(profile.currency);
    customIn.placeholder = `${profile.min} - ${profile.max}`;
  }

  async function fetchProfile() {
    load = 'loading';
    renderTip();
    let res = null;
    try {
      res = support ? await support.tipsProfile() : { ok: false, error: 'Tips are not available in this build.' };
    } catch (err) {
      res = { ok: false, error: errMsg(err, 'Could not load tips.') };
    }
    if (!alive) return;
    if (res && res.ok && res.profile) {
      profile = res.profile;
      if (preset === null) preset = profile.presets.includes(10) ? 10 : (profile.presets[1] ?? profile.presets[0] ?? null);
      buildPresets();
      load = 'ready';
    } else {
      load = 'error';
      $('[data-tip-error-text]').textContent = !navigator.onLine
        ? 'You seem to be offline. Connect to the internet and try again.'
        : ((res && res.error) || 'Something went wrong while loading. Please try again in a moment.');
    }
    renderTip();
  }

  async function startTip() {
    const { amount } = currentAmount();
    if (tipBusy || amount === null || !profile || amount < profile.min || amount > profile.max) return;
    tipBusy = true;
    renderTip();
    let res = null;
    try {
      res = await support.startTip({
        amount,
        monthly,
        name: nameIn.value.trim() || undefined,
        message: noteIn.value.trim() || undefined,
      });
    } catch (err) {
      res = { ok: false, error: errMsg(err, 'Could not open checkout.') };
    }
    if (!alive) return;
    tipBusy = false;
    if (res && res.ok && res.url) {
      checkoutUrl = res.url;
      el.querySelector('.su-orb').classList.add('is-thanks');
    } else {
      toast(!navigator.onLine ? 'You seem to be offline. Connect and try again.' : ((res && res.error) || 'Could not open checkout.'), 'risk');
    }
    renderTip();
  }

  $('[data-presets]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    preset = Number(b.dataset.preset);
    customIn.value = '';
    renderTip();
  });
  customIn.addEventListener('input', () => {
    const clean = customIn.value.replace(/[^\d.,]/g, '');
    if (clean !== customIn.value) customIn.value = clean;
    renderTip();
  });
  customIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') startTip(); });
  noteIn.addEventListener('input', renderTip);
  $('[data-freq]').addEventListener('change', (e) => { monthly = e.detail && e.detail.value === 'monthly'; renderTip(); });
  $('[data-tip-go]').addEventListener('click', startTip);
  $('[data-tip-retry]').addEventListener('click', fetchProfile);
  $('[data-tip-change]').addEventListener('click', () => {
    checkoutUrl = null;
    el.querySelector('.su-orb').classList.remove('is-thanks');
    renderTip();
  });
  $('[data-tip-again]').addEventListener('click', async () => {
    if (!checkoutUrl) return;
    try {
      await api.app.openExternal(checkoutUrl);
    } catch {
      toast('Could not open your browser.', 'risk');
    }
  });

  /* ---------------------------------------------------------------- feedback */

  const form = $('[data-fb-form]');
  const msgIn = $('[data-msg]');
  const emailIn = $('[data-email]');
  const sysToggle = $('[data-sys]');
  const stars = [...el.querySelectorAll('[data-star]')];

  function renderSys() {
    const pre = $('[data-sys-pre]');
    pre.hidden = !includeSys;
    if (!includeSys) return;
    pre.textContent = system
      ? [['app', `Bastion ${system.appVersion}`], ['os', system.osVersion], ['platform', `${system.platform} / ${system.arch}`]]
        .map(([k, v]) => `${k.padEnd(10)}${v}`).join('\n')
      : 'System details are still loading.';
  }

  function renderSysHint() {
    $('[data-sys-hint]').textContent = kind === 'bug' && !includeSys
      ? 'Off. Turning this on helps us reproduce bugs. Nothing else from your computer is sent.'
      : 'Off unless you turn it on. Nothing else from your computer is sent.';
  }

  function renderStars() {
    const shown = hoverRating ?? rating ?? 0;
    stars.forEach((b, i) => {
      const n = i + 1;
      b.classList.toggle('is-lit', shown >= n);
      b.setAttribute('aria-checked', String(rating === n));
      b.tabIndex = (rating ?? 1) === n ? 0 : -1;
    });
    $('[data-rate-label]').textContent = shown ? RATING_LABELS[shown - 1] : 'Optional';
  }

  function renderFb() {
    const trimmed = msgIn.value.trim();
    const tooShort = trimmed.length < MSG_MIN;
    const email = emailIn.value.trim();
    const emailBad = email !== '' && !EMAIL_RE.test(email);
    $('[data-msg-count]').textContent = `${msgIn.value.length}/${MSG_MAX}`;
    $('[data-msg-count]').classList.toggle('is-near', msgIn.value.length > MSG_MAX - 100);
    const msgHint = $('[data-msg-hint]');
    msgHint.textContent = tooShort && msgIn.value.length > 0 ? `A few more characters, please (at least ${MSG_MIN})` : 'Ctrl + Enter to send';
    const emailHint = $('[data-email-hint]');
    emailHint.textContent = emailBad ? 'That email does not look right' : '';
    emailHint.classList.toggle('is-err', emailBad);
    emailIn.setAttribute('aria-invalid', String(emailBad));
    const go = $('[data-fb-go]');
    go.disabled = tooShort || emailBad || sending;
    go.classList.toggle('is-busy', sending);
    $('[data-fb-go-sub]').textContent = sending ? 'Sending' : SEND_SUB[kind];
    $('[data-fb-go-hint]').hidden = !tooShort;
    msgIn.placeholder = PLACEHOLDERS[kind];
  }

  async function send() {
    const message = msgIn.value.trim();
    const email = emailIn.value.trim();
    if (sending || message.length < MSG_MIN || (email && !EMAIL_RE.test(email))) return;
    sending = true;
    renderFb();
    let res = null;
    try {
      res = await support.sendFeedback({ kind, message, rating, email: email || undefined, includeSystemInfo: includeSys });
    } catch (err) {
      res = { ok: false, error: errMsg(err, 'Could not send your feedback.') };
    }
    if (!alive) return;
    sending = false;
    if (res && res.ok) {
      const via = DONE_TITLES[res.via] ? res.via : 'endpoint';
      $('[data-fb-done-title]').textContent = DONE_TITLES[via];
      $('[data-fb-done-text]').textContent = res.message || '';
      $('[data-fb-done-badge]').innerHTML = icon(via === 'email' ? 'mail' : 'check');
      $('[data-fb-done-badge]').classList.toggle('su-badge--mint', via !== 'email');
      $('[data-fb-done]').hidden = false;
      form.hidden = true;
    } else {
      toast((res && res.error) || 'Could not send your feedback.', 'risk');
    }
    renderFb();
  }

  function resetFb() {
    $('[data-fb-done]').hidden = true;
    form.hidden = false;
    msgIn.value = '';
    rating = null;
    hoverRating = null;
    includeSys = false;
    sysToggle.checked = false;
    const first = el.querySelector('[data-kind] [data-value="idea"]');
    if (first && first.getAttribute('aria-selected') !== 'true') first.click();
    kind = 'idea';
    renderStars();
    renderSys();
    renderSysHint();
    renderFb();
    msgIn.focus();
  }

  $('[data-kind]').addEventListener('change', (e) => {
    kind = (e.detail && e.detail.value) || 'idea';
    // opt-in only: for a bug report, suggest the switch instead of turning it on
    renderSysHint();
    renderFb();
  });
  sysToggle.addEventListener('change', (e) => {
    includeSys = !!(e.detail && e.detail.checked);
    renderSysHint();
    renderSys();
  });
  const starsHost = $('[data-stars]');
  starsHost.addEventListener('mouseleave', () => { hoverRating = null; renderStars(); });
  stars.forEach((b, i) => {
    const n = i + 1;
    b.addEventListener('mouseenter', () => { hoverRating = n; renderStars(); });
    b.addEventListener('click', () => { rating = rating === n ? null : n; renderStars(); });
    b.addEventListener('keydown', (e) => {
      const cur = rating ?? 0;
      const next = { ArrowRight: Math.min(5, cur + 1), ArrowUp: Math.min(5, cur + 1), ArrowLeft: Math.max(1, cur - 1), ArrowDown: Math.max(1, cur - 1), Home: 1, End: 5 }[e.key];
      if (next) {
        e.preventDefault();
        rating = next;
        renderStars();
        stars[next - 1].focus();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        rating = null;
        renderStars();
      }
    });
  });
  msgIn.addEventListener('input', renderFb);
  msgIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  emailIn.addEventListener('input', renderFb);
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('[data-fb-again]').addEventListener('click', resetFb);

  /* ---------------------------------------------------------------- start */

  renderTip();
  renderStars();
  renderSys();
  renderFb();
  fetchProfile();
  if (support && support.systemInfo) {
    support.systemInfo().then((res) => {
      if (!alive || !res || !res.ok) return;
      system = res.system;
      renderSys();
    }).catch(() => {});
  }

  return {
    unmount() {
      alive = false;
      try { glowCleanup && glowCleanup(); } catch { /* already gone */ }
    },
  };
}
