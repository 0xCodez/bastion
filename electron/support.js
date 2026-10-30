'use strict';

// Tips and feedback (main process). Ported from Cleanly's services/tips.ts and services/feedback.ts.
//
// Tips: the Beyond Apps tips service (Stripe Checkout at beyond-media.ai). The profile (presets,
// limits, supporter count) is cached for 10 minutes; a tip creates a checkout session and opens it
// in the user's browser. Bastion never sees card details.
// Feedback: POST to FEEDBACK_ENDPOINT when one is configured, else the user's mail app (mailto),
// else a JSON file in <userData>/feedback. System info (app version, OS, arch) is attached only when
// the user turns the switch on; the home directory and the account name never leave the machine.
//
// Every IPC handler resolves with { ok: true, ... } or { ok: false, error } and never throws.

const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, shell, clipboard } = require('electron');

// Build-time endpoints. Empty strings disable the channel they configure.
const TIPS_API = 'https://beyond-media.ai/api/tips';
const TIPS_CREATOR = 'beyond-apps';
const TIPS_RETURN_URL = 'https://beyond-media.ai/tips?creator=beyond-apps';
const FEEDBACK_ENDPOINT = '';
const FEEDBACK_EMAIL = 'contact@beyond-media.ai';
const APP_ID = 'bastion';

const TIMEOUT_MS = 15000;
const PROFILE_TTL_MS = 10 * 60000;
const TIP_NAME_MAX = 60;
const TIP_MESSAGE_MAX = 280;
const FEEDBACK_MIN = 3;
const FEEDBACK_MAX = 2000; // same cap as the textarea in renderer/js/views/support.js
// Budget for the percent-encoded body: ShellExecute and Outlook fail on mailto URLs past ~2000 chars,
// and encoding grows text 3x (spaces, newlines) to 6x+ (non-Latin script).
const MAILTO_BODY_ENCODED_MAX = 1700;
const KINDS = ['idea', 'bug', 'love'];
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v, fallback) => (typeof v === 'string' ? v : fallback);
const errText = (err) => String((err && err.message) || err || 'Something went wrong.');

/* ------------------------------------------------------------------ system info */

/** Public system details only: no home directory, no user or host name. */
function systemInfo() {
  let osVersion = os.release();
  try {
    if (typeof os.version === 'function') osVersion = `${os.version()} (${os.release()})`;
  } catch {
    // os.version() is missing on very old runtimes; the release number is enough.
  }
  const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';
  return {
    platform,
    arch: process.arch,
    osVersion: String(osVersion).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 120),
    appVersion: app.getVersion(),
  };
}

/* ------------------------------------------------------------------ tips */

let cached = null; // { profile, at }
let inflight = null;
let checkoutBusy = false;

function serverMessage(body) {
  if (!isRecord(body)) return null;
  for (const k of ['error', 'message', 'detail']) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200);
    if (isRecord(v) && typeof v.message === 'string') return v.message.trim().slice(0, 200);
  }
  return null;
}

async function request(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const name = err && err.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new Error('The tips service took too long to answer. Please try again.');
    throw new Error('Could not reach the tips service. Check your internet connection.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(serverMessage(body) || `The tips service returned an error (${res.status}).`);
  return body;
}

function toProfile(body) {
  if (!isRecord(body) || !isRecord(body.creator)) throw new Error('The tips service sent an unexpected answer.');
  const c = body.creator;
  const min = Math.max(0, num(c.min, 1));
  const max = Math.max(min, num(c.max, 500));
  const presets = Array.isArray(c.presets)
    ? c.presets.filter((p) => typeof p === 'number' && Number.isFinite(p) && p >= min && p <= max).slice(0, 8)
    : [];
  const currency = str(c.currency, 'usd').toLowerCase();
  return {
    name: str(c.name, 'Beyond Apps').slice(0, 80),
    tagline: str(c.tagline, '').slice(0, 200),
    currency: /^[a-z]{3}$/.test(currency) ? currency : 'usd',
    presets,
    min,
    max,
    supporterCount: Math.max(0, Math.round(num(body.supporterCount, 0))),
  };
}

function getTipsProfile() {
  if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return Promise.resolve(cached.profile);
  if (!inflight) {
    inflight = request(`${TIPS_API}?creator=${encodeURIComponent(TIPS_CREATOR)}`, { headers: { accept: 'application/json' } })
      .then(toProfile)
      .then((profile) => {
        cached = { profile, at: Date.now() };
        return profile;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  // strip control characters, collapse whitespace runs
  return v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validates a tip request against the profile limits. Returns the clean request or throws. */
function validateTip(req, profile) {
  if (!isRecord(req)) throw new Error('Invalid tip.');
  const amount = req.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Please choose an amount.');
  if (Math.round(amount * 100) !== Math.round(amount * 100 * 1e6) / 1e6) throw new Error('Use at most two decimals.');
  if (amount < profile.min || amount > profile.max) {
    throw new Error(`Please choose an amount between ${profile.min} and ${profile.max} ${profile.currency.toUpperCase()}.`);
  }
  return {
    amount: Math.round(amount * 100) / 100,
    name: cleanText(req.name, TIP_NAME_MAX),
    message: cleanText(req.message, TIP_MESSAGE_MAX),
    monthly: req.monthly === true,
  };
}

async function createTipCheckout(req) {
  const profile = (cached && cached.profile) || (await getTipsProfile());
  const tip = validateTip(req, profile);
  const body = await request(TIPS_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ creator: TIPS_CREATOR, ...tip, returnUrl: TIPS_RETURN_URL }),
  });
  const url = isRecord(body) ? body.url : null;
  if (typeof url !== 'string') throw new Error('The tips service did not return a checkout link.');
  if (!isHttps(url)) throw new Error('The tips service returned an invalid checkout link.');
  return { url };
}

/* ------------------------------------------------------------------ feedback */

function validateFeedback(payload) {
  if (!isRecord(payload)) throw new Error('Invalid feedback.');
  if (!KINDS.includes(payload.kind)) throw new Error('Please pick what kind of feedback this is.');

  const message = typeof payload.message === 'string' ? payload.message.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim() : '';
  if (message.length < FEEDBACK_MIN) throw new Error('Please write a little more so we know what you mean.');
  if (message.length > FEEDBACK_MAX) throw new Error(`That message is a bit long. Please keep it under ${FEEDBACK_MAX} characters.`);

  let rating = null;
  if (payload.rating !== null && payload.rating !== undefined) {
    if (!Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5) throw new Error('Rating must be from 1 to 5.');
    rating = payload.rating;
  }

  let email = null;
  if (typeof payload.email === 'string' && payload.email.trim()) {
    email = payload.email.trim();
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new Error('That email address does not look right.');
  }

  return { kind: payload.kind, message, rating, email, includeSystemInfo: payload.includeSystemInfo === true };
}

function systemLines(sys) {
  return [`App: Bastion ${sys.appVersion}`, `OS: ${sys.platform} ${sys.osVersion}`, `Arch: ${sys.arch}`].join('\n');
}

async function viaEndpoint(fb, sys) {
  let res;
  try {
    res = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        kind: fb.kind,
        message: fb.message,
        rating: fb.rating,
        email: fb.email,
        system: fb.includeSystemInfo ? sys : null,
        app: APP_ID,
        version: app.getVersion(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error('Could not send feedback. Check your internet connection and try again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(serverMessage(body) || `Could not send feedback (${res.status}). Please try again later.`);
  }
  return { via: 'endpoint', message: 'Sent. Thanks for helping make Bastion better.' };
}

/**
 * Metadata (rating, reply-to, system info) goes first so it is never cut; only the message is
 * shortened, by whole code points, until the percent-encoded body fits MAILTO_BODY_ENCODED_MAX.
 */
function mailtoParts(fb, sys) {
  const meta = [];
  if (fb.rating) meta.push(`Rating: ${fb.rating}/5`);
  if (fb.email) meta.push(`Reply to: ${fb.email}`);
  if (fb.includeSystemInfo) meta.push(systemLines(sys));
  const head = meta.length ? `${meta.join('\n')}\n\n` : '';
  const chars = Array.from(fb.message);
  let keep = chars.length;
  let body = head + fb.message;
  let truncated = false;
  while (encodeURIComponent(body).length > MAILTO_BODY_ENCODED_MAX && keep > 0) {
    const ratio = MAILTO_BODY_ENCODED_MAX / encodeURIComponent(body).length;
    keep = Math.max(0, Math.min(keep - 1, Math.floor(keep * ratio)));
    body = `${head}${chars.slice(0, keep).join('')}... [shortened: the full text is on your clipboard]`;
    truncated = true;
  }
  const subject = `Bastion feedback: ${fb.kind}`;
  return { url: `mailto:${encodeURIComponent(FEEDBACK_EMAIL)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, truncated };
}

const mailtoUrl = (fb, sys) => mailtoParts(fb, sys).url;

async function viaEmail(fb, sys) {
  const { url, truncated } = mailtoParts(fb, sys);
  try {
    await shell.openExternal(url);
  } catch {
    // no mail app (or it rejected the link): keep the message on disk instead of losing it
    return saveLocally(fb, sys, `Could not open your mail app, so your message was saved. Please send it to ${FEEDBACK_EMAIL}.`);
  }
  if (truncated) {
    clipboard.writeText(fb.message);
    return { via: 'email', message: 'Your mail app is open. The message was too long for an email link, so the full text is on your clipboard: paste it over the shortened part.' };
  }
  return { via: 'email', message: 'Your mail app is open with the message ready to send.' };
}

async function saveLocally(fb, sys, lead) {
  const dir = path.join(app.getPath('userData'), 'feedback');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}.json`);
  const record = { ...fb, system: fb.includeSystemInfo ? sys : null, app: APP_ID, version: app.getVersion(), createdAt: Date.now() };
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(record, null, 2), { encoding: 'utf8', flag: 'wx' });
  } catch {
    throw new Error(lead ? `Could not open your mail app. You can write to ${FEEDBACK_EMAIL} directly.` : 'Could not save your feedback on this computer.');
  }
  if (lead) {
    shell.showItemInFolder(file);
    return { via: 'saved', path: file, message: `${lead} File: ${file}` };
  }
  return { via: 'saved', path: file, message: 'Saved on this computer. Thanks.' };
}

let feedbackBusy = false;

async function sendFeedback(payload) {
  const fb = validateFeedback(payload);
  if (feedbackBusy) throw new Error('Your last message is still being sent.');
  feedbackBusy = true;
  try {
    const sys = systemInfo();
    if (FEEDBACK_ENDPOINT) return await viaEndpoint(fb, sys);
    if (FEEDBACK_EMAIL) return await viaEmail(fb, sys);
    return await saveLocally(fb, sys);
  } finally {
    feedbackBusy = false;
  }
}

/* ------------------------------------------------------------------ IPC */

/** Only Bastion's own page (a file:// URL) may call these handlers. */
function fromApp(event) {
  try {
    const frame = event && event.senderFrame;
    return !!frame && new URL(frame.url).protocol === 'file:';
  } catch {
    return false;
  }
}

function register(ipcMain) {
  const on = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!fromApp(event)) return { ok: false, error: 'Blocked: not Bastion\'s own window.' };
      try {
        return { ok: true, ...(await fn(...args)) };
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    });
  };

  on('support:tips-profile', async () => ({ profile: await getTipsProfile() }));
  on('support:start-tip', async (req) => {
    if (checkoutBusy) throw new Error('A checkout is already being opened.');
    checkoutBusy = true;
    try {
      const { url } = await createTipCheckout(req);
      await shell.openExternal(url);
      return { url };
    } finally {
      checkoutBusy = false;
    }
  });
  on('support:send-feedback', (payload) => sendFeedback(payload));
  on('support:system-info', async () => ({ system: systemInfo() }));
}

module.exports = {
  register,
  // exported for scripts/support-smoke.js style harnesses; not used by main.js
  _internal: { toProfile, validateTip, validateFeedback, cleanText, mailtoUrl, mailtoParts, systemInfo, isHttps },
};
