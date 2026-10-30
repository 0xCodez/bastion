// Cookieless visit and download tracking for the private dashboard (/dashboard).
// A visitor is a salted hash of IP + browser + day, so nobody can be followed across days and no
// IP address or other personal data is ever stored. Only daily counters live in Redis.
import { createHash } from 'node:crypto';
import { pipeline, readBody, day, secret } from './_redis.js';
import { PLATFORMS } from './_platform.js';

const BOTS =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|vercel|lighthouse|headless|phantom|puppeteer|playwright|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|httpclient|monitor|uptime/i;
const TTL = 60 * 60 * 24 * 400; // keep about 13 months
const LIVE_TTL = 60 * 60; // the "live" set only needs the last few minutes
const DOWNLOADS = new Set(PLATFORMS);
// Where a download button sits: the page's [data-section] ids plus the site chrome.
const PLACES = new Set(['hero', 'problem', 'features', 'demo', 'agents', 'steps', 'privacy', 'faq', 'support', 'cta', 'nav', 'menu', 'footer', 'other']);
const KEY = /^[a-z0-9:_-]{1,40}$/;
// Field names that would collide with Object.prototype if anything ever aggregates into a plain object.
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof']);
const safeKey = (k) => typeof k === 'string' && KEY.test(k) && !RESERVED.has(k.toLowerCase());
// Pages the site really serves; anything else a script posts is folded into 'other'.
const PAGES = new Map([['/', '/'], ['/index.html', '/']]);
// Named sources are a fixed list; raw referrer hosts and utm values are capped per day so a script
// cannot grow the database (or the dashboard's read) without bound.
const NAMED_SOURCES = new Set(['direct', 'x', 'telegram', 'linkedin', 'reddit', 'hacker news', 'product hunt', 'github', 'youtube', 'google', 'search', 'ai assistant', 'other']);
const MAX_SOURCES = 200;

function source(ref, utm, ownHost) {
  if (utm) {
    const v = utm.toLowerCase().replace(/[^a-z0-9 ._-]/g, '').slice(0, 30);
    return !v ? 'direct' : RESERVED.has(v) ? 'other' : v;
  }
  if (!ref) return 'direct';
  let host;
  try {
    host = new URL(ref).hostname.replace(/^www\./, '');
  } catch {
    return 'direct';
  }
  // moving around the site itself, or a Vercel preview of it
  if (host === ownHost || /^bastion[a-z0-9-]*\.vercel\.app$|localhost|127\.0\.0\.1/.test(host)) return null;
  if (/^(t\.co|x\.com|twitter\.com)$/.test(host)) return 'x';
  if (/(^|\.)t\.me$|telegram/.test(host)) return 'telegram';
  if (/linkedin\.com$|lnkd\.in$/.test(host)) return 'linkedin';
  if (/(^|\.)reddit\.com$/.test(host)) return 'reddit';
  if (/news\.ycombinator\.com$/.test(host)) return 'hacker news';
  if (/producthunt\.com$/.test(host)) return 'product hunt';
  if (/(^|\.)github\.com$/.test(host)) return 'github';
  if (/(^|\.)youtube\.com$|youtu\.be$/.test(host)) return 'youtube';
  if (/(^|\.)google\./.test(host)) return 'google';
  if (/bing\.com$|duckduckgo\.com$|yandex\.|search\.|ecosia\.org$|kagi\.com$/.test(host)) return 'search';
  if (/chatgpt\.com$|openai\.com$|claude\.ai$|perplexity\.ai$|gemini\.google\.com$/.test(host)) return 'ai assistant';
  const h = host.slice(0, 40);
  return RESERVED.has(h) ? 'other' : h;
}

const device = (ua) => (/iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop');

// Which system the visitor is on: the number that matters for a Windows + macOS app.
function system(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  if (/CrOS/i.test(ua)) return 'chromeos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

const header = (req, name) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v || '';
};

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-robots-tag', 'noindex, nofollow');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    return res.end();
  }
  const ua = header(req, 'user-agent');
  if (!ua || BOTS.test(ua)) {
    res.statusCode = 204;
    return res.end();
  }

  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') {
    res.statusCode = 400;
    return res.end();
  }

  const d = day();
  const ip = String(header(req, 'x-real-ip') || header(req, 'x-forwarded-for') || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();
  const id = createHash('sha256').update(`${secret}|${ip}|${ua}|${d}`).digest('hex').slice(0, 16);
  const exp = (k) => ['EXPIRE', k, TTL];
  const live = [['ZADD', 'live', Date.now(), id], ['EXPIRE', 'live', LIVE_TTL]];

  try {
    if (data.t === 'pv') {
      const path = PAGES.get(String(data.p || '/').split(/[?#]/)[0]) || 'other';
      const ownHost = header(req, 'host').split(':')[0].replace(/^www\./, '');
      let src = source(String(data.r || ''), data.u ? String(data.u) : '', ownHost);
      if (src && !NAMED_SOURCES.has(src)) {
        const [len, known] = await pipeline([['HLEN', `src:${d}`], ['HEXISTS', `src:${d}`, src]]);
        if (!+known && +len >= MAX_SOURCES) src = 'other';
      }
      const [, isNew] = await pipeline([
        ['INCR', `pv:${d}`],
        ['PFADD', `uv:${d}`, id],
        ['HINCRBY', `pages:${d}`, path, 1],
        ...live,
        exp(`pv:${d}`),
        exp(`uv:${d}`),
        exp(`pages:${d}`),
      ]);
      const more = [];
      if (src) more.push(['HINCRBY', `src:${d}`, src, 1], exp(`src:${d}`));
      // country, device and system are counted once per visitor per day
      if (isNew) {
        const country = String(header(req, 'x-vercel-ip-country') || 'XX').slice(0, 2).toUpperCase();
        more.push(
          ['HINCRBY', `cty:${d}`, /^[A-Z]{2}$/.test(country) ? country : 'XX', 1],
          ['HINCRBY', `dev:${d}`, device(ua), 1],
          ['HINCRBY', `os:${d}`, system(ua), 1],
          exp(`cty:${d}`),
          exp(`dev:${d}`),
          exp(`os:${d}`),
        );
      }
      await pipeline(more);
    } else if (data.t === 'dl' && data.k === 'page') {
      // an older tracker sent releases-page links as downloads: count them as a click
      await pipeline([['HINCRBY', `clicks:${d}`, 'releases-page', 1], ...live, exp(`clicks:${d}`)]);
    } else if (data.t === 'dl' && DOWNLOADS.has(data.k)) {
      const place = PLACES.has(data.w) ? data.w : 'other';
      await pipeline([
        ['HINCRBY', `dl:${d}`, data.k, 1],
        ['HINCRBY', `dlw:${d}`, place, 1],
        ['PFADD', `dlu:${d}`, id],
        ...live,
        exp(`dl:${d}`),
        exp(`dlw:${d}`),
        exp(`dlu:${d}`),
      ]);
    } else if (data.t === 'click' && safeKey(data.k)) {
      await pipeline([['HINCRBY', `clicks:${d}`, data.k, 1], ...live, exp(`clicks:${d}`)]);
    } else if (data.t === 'hb') {
      await pipeline(live); // still on the page: keeps "live now" honest for long visits
    }
  } catch {
    // analytics must never break the site
  }
  res.statusCode = 204;
  res.end();
}
