// Numbers for /dashboard. Locked behind DASHBOARD_PASSWORD (a Vercel env var), sent in the
// x-dash-key header and compared in constant time.
import { timingSafeEqual, createHash } from 'node:crypto';
import { pipeline, connected, day, sendJson, secret } from './_redis.js';
import { platformOf, PLATFORMS } from './_platform.js';

const HASHES = ['pages', 'src', 'cty', 'dev', 'os', 'dl', 'dlw', 'clicks'];
const LIVE_WINDOW = 5 * 60 * 1000;
const REPO = '0xCodez/bastion';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const RELEASES_TTL = 10 * 60 * 1000;
// Wrong passwords: after MAX_FAILS from one address in FAIL_WINDOW seconds, answer 429 until it expires.
const MAX_FAILS = 10;
const FAIL_WINDOW = 15 * 60;
const INSTALLERS = new Set(PLATFORMS);
const num = (v) => (Number.isFinite(+v) ? +v : 0);

const same = (a, b) => {
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(a), h(b));
};

// Downloads straight from GitHub Releases, which also count people who never visit the site.
// Cached per function instance so a busy dashboard stays well under GitHub's 60 requests/hour
// (unauthenticated) limit. GITHUB_TOKEN is optional and only raises that limit.
let releasesCache = { at: 0, data: null };
async function releases() {
  if (releasesCache.data && Date.now() - releasesCache.at < RELEASES_TTL) return releasesCache.data;
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'bastion-dashboard' };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(RELEASES_URL, { headers, signal: AbortSignal.timeout(6000) });
    if (res.status === 404) {
      releasesCache = { at: Date.now(), data: [] }; // repo private or no releases yet
      return releasesCache.data;
    }
    if (!res.ok) throw new Error(`github ${res.status}`);
    const list = await res.json();
    const data = list
      .filter((r) => !r.draft)
      .map((r) => ({
        tag: r.tag_name,
        date: r.published_at,
        prerelease: Boolean(r.prerelease),
        assets: (r.assets || [])
          .map((a) => ({ name: a.name, platform: platformOf(a.name), count: a.download_count || 0 }))
          .filter((a) => a.platform),
      }));
    releasesCache = { at: Date.now(), data };
    return data;
  } catch {
    return releasesCache.data; // stale beats nothing; null if GitHub never answered
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, { error: 'method' }, 405);
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return sendJson(res, { error: 'no-password' }, 503);
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();
  const failKey = `authfail:${createHash('sha256').update(`${secret}|${ip}`).digest('hex').slice(0, 16)}`;
  let fails = 0;
  try {
    [fails] = await pipeline([['GET', failKey]]);
  } catch {
    // storage down: the password check below still applies
  }
  if (num(fails) >= MAX_FAILS) {
    res.setHeader('retry-after', String(FAIL_WINDOW));
    return sendJson(res, { error: 'too-many-attempts' }, 429);
  }
  const given = req.headers['x-dash-key'];
  if (!same(Array.isArray(given) ? given[0] : given || '', password)) {
    try {
      await pipeline([['INCR', failKey], ['EXPIRE', failKey, FAIL_WINDOW]]);
    } catch {
      // best effort
    }
    return sendJson(res, { error: 'unauthorized' }, 401);
  }

  const params = new URL(req.url, 'http://x').searchParams;
  const n = Math.min(Math.max(parseInt(params.get('days'), 10) || 30, 1), 90);
  const now = Date.now();
  const days = Array.from({ length: n }, (_, i) => day(new Date(now - (n - 1 - i) * 864e5)));

  const cmds = [];
  for (const d of days) {
    cmds.push(['GET', `pv:${d}`], ['PFCOUNT', `uv:${d}`], ['PFCOUNT', `dlu:${d}`]);
    for (const h of HASHES) cmds.push(['HGETALL', `${h}:${d}`]);
  }
  cmds.push(['PFCOUNT', ...days.map((d) => `uv:${d}`)]); // unique visitors over the whole range
  cmds.push(['PFCOUNT', ...days.map((d) => `dlu:${d}`)]); // unique downloaders over the whole range
  cmds.push(['ZREMRANGEBYSCORE', 'live', 0, now - LIVE_WINDOW], ['ZCOUNT', 'live', now - LIVE_WINDOW, '+inf']);

  let out;
  let gh;
  try {
    [out, gh] = await Promise.all([pipeline(cmds), releases()]);
  } catch {
    return sendJson(res, { error: 'storage' }, 502);
  }

  const per = 3 + HASHES.length;
  // Prototype-free maps: field names come from visitors, so 'constructor' or '__proto__' must stay plain keys.
  const bag = () => Object.create(null);
  const totals = bag();
  HASHES.forEach((h) => (totals[h] = bag()));
  const series = days.map((d, i) => {
    const row = out.slice(i * per, i * per + per);
    const byHash = bag();
    HASHES.forEach((h, j) => {
      const flat = row[3 + j] || [];
      byHash[h] = bag();
      for (let k = 0; k < flat.length; k += 2) {
        const field = String(flat[k]);
        const v = num(flat[k + 1]);
        // only real installers count as downloads ('page' rows from an older tracker are dropped)
        if (h === 'dl' && !INSTALLERS.has(field)) continue;
        byHash[h][field] = v;
        totals[h][field] = (totals[h][field] || 0) + v;
      }
    });
    return { d, pv: num(row[0]), uv: num(row[1]), dlu: num(row[2]), dl: { ...byHash.dl } };
  });
  const tail = out.slice(days.length * per);
  const top = (o, limit = 50) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

  sendJson(res, {
    storage: connected ? 'upstash' : 'memory',
    days: n,
    visitors: num(tail[0]),
    downloaders: num(tail[1]),
    pageviews: series.reduce((s, r) => s + r.pv, 0),
    downloads: Object.values(totals.dl).reduce((s, v) => s + v, 0),
    online: num(tail[3]),
    series,
    pages: top(totals.pages),
    sources: top(totals.src),
    countries: top(totals.cty),
    devices: top(totals.dev),
    systems: top(totals.os),
    platforms: top(totals.dl),
    places: top(totals.dlw),
    clicks: top(totals.clicks),
    releases: gh,
    generated: new Date(now).toISOString(),
  });
}
