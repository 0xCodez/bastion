// Private analytics dashboard (/dashboard). Reads /api/dashboard with the password from the gate,
// which is kept in sessionStorage (this tab only). ?demo previews the layout with made-up numbers.
import '../styles/fonts.css';
import './dashboard.css';

const KEY_STORE = 'bastion-dash-key';
const RANGE_STORE = 'bastion-dash-days';
const REFRESH_MS = 60 * 1000;

// Categorical order is fixed: a colour always means the same installer. Validated for dark mode
// against the card surface (lightness band, chroma, CVD and normal-vision separation, contrast).
const PLATFORMS = [
  { key: 'mac-arm64', label: 'macOS, Apple silicon', short: 'Mac ARM', color: 'var(--c1)' },
  { key: 'mac-x64', label: 'macOS, Intel', short: 'Mac Intel', color: 'var(--c2)' },
  { key: 'windows-x64', label: 'Windows x64', short: 'Win x64', color: 'var(--c3)' },
  { key: 'windows-arm64', label: 'Windows ARM64', short: 'Win ARM', color: 'var(--c4)' },
  { key: 'mac-universal', label: 'macOS, universal', short: 'Mac univ.', color: 'var(--c-other)' },
];
const PLATFORM = Object.fromEntries(PLATFORMS.map((p) => [p.key, p]));

const NAMES = {
  systems: { mac: 'macOS', windows: 'Windows', ios: 'iPhone / iPad', android: 'Android', linux: 'Linux', chromeos: 'ChromeOS', other: 'Other' },
  devices: { desktop: 'Desktop', mobile: 'Phone', tablet: 'Tablet' },
  platforms: Object.fromEntries(PLATFORMS.map((p) => [p.key, p.label])),
  places: {
    hero: 'Hero',
    problem: 'Problem section',
    features: 'Features',
    demo: 'Demo',
    agents: 'AI watchers',
    steps: 'How it works',
    privacy: 'Privacy',
    faq: 'FAQ',
    support: 'Support section',
    cta: 'Final call to action',
    nav: 'Top navigation',
    menu: 'Mobile menu',
    footer: 'Footer',
    other: 'Elsewhere',
  },
  clicks: {
    github: 'Opened GitHub',
    'github-issues': 'Opened GitHub issues',
    'github-discussions': 'Opened GitHub discussions',
    'github-security': 'Opened the security policy',
    'github-license': 'Opened the license',
    'github-other': 'Opened another GitHub page',
    'releases-page': 'Opened the releases page',
    'tips-open': 'Opened the tip jar',
    'tips-card': 'Used the tip card',
    'tips-link': 'Clicked a tips link',
    'tips-paid': 'Came back after tipping',
    'feedback-mail': 'Opened feedback email',
    'feedback-sent': 'Sent feedback',
  },
  sources: {
    direct: 'Direct or unknown',
    x: 'X',
    'hacker news': 'Hacker News',
    'product hunt': 'Product Hunt',
    'ai assistant': 'AI assistants',
    github: 'GitHub',
    reddit: 'Reddit',
    google: 'Google',
    youtube: 'YouTube',
    linkedin: 'LinkedIn',
    telegram: 'Telegram',
    search: 'Other search engines',
  },
  pages: { '/': 'Home' },
};

const $ = (id) => document.getElementById(id);
const store = (area) => ({
  get(k) {
    try {
      return window[area].getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) window[area].removeItem(k);
      else window[area].setItem(k, v);
    } catch {
      // storage blocked: the session still works, it just will not be remembered
    }
  },
});
const session = store('sessionStorage');
const prefs = store('localStorage');

const demo = new URLSearchParams(location.search).has('demo');
let key = session.get(KEY_STORE);
let days = [7, 30, 90].includes(Number(prefs.get(RANGE_STORE))) ? Number(prefs.get(RANGE_STORE)) : 30;
let timer = 0;
let last = null;
let loading = false;

// ---------- formatting ----------

const fmt = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const big = (n) => (n >= 10000 ? compact.format(n) : fmt.format(n));
const regions = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const dayLabel = (d, opts = { month: 'short', day: 'numeric' }) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const longDay = (d) => dayLabel(d, { weekday: 'short', month: 'short', day: 'numeric' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function country(code) {
  if (!code || code === 'XX') return 'Unknown';
  try {
    return `${regions?.of(code) || code}`;
  } catch {
    return code;
  }
}

function label(group, raw) {
  if (group === 'countries') return country(raw);
  const names = NAMES[group];
  return (names && Object.hasOwn(names, raw) && names[raw]) || raw;
}

// ---------- data ----------

async function load() {
  if (demo) return demoData(days);
  const res = await fetch(`/api/dashboard?days=${days}`, { headers: { 'x-dash-key': key || '' }, cache: 'no-store' }).catch(() => null);
  if (!res) throw Object.assign(new Error('offline'), { code: 'offline' });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
  if (!res.ok) throw Object.assign(new Error(body.error || 'error'), { code: body.error || 'error' });
  return body;
}

async function refresh(manual) {
  if (loading) return;
  loading = true;
  const button = $('refresh');
  if (manual) button.classList.add('is-spinning');
  try {
    last = await load();
    showApp(); // first: charts are drawn at their container's size, which is 0 while hidden
    render(last);
  } catch (err) {
    if (err.code === 'unauthorized') return signOut('That password did not work.');
    if (err.code === 'too-many-attempts') return signOut('Too many wrong passwords. Wait 15 minutes, then try again.');
    if (err.code === 'no-password') return signOut('Set DASHBOARD_PASSWORD in Vercel (bastion, Settings, Environment Variables), then redeploy.');
    if (!last) return signOut(err.code === 'storage' ? 'The analytics database did not answer. Try again in a moment.' : 'Could not reach the dashboard API. Try again in a moment.');
    $('footer').textContent = 'Could not refresh. Showing the last numbers.';
  } finally {
    loading = false;
    button.classList.remove('is-spinning');
    clearTimeout(timer);
    if (key || demo) timer = setTimeout(() => refresh(false), REFRESH_MS);
  }
}

// ---------- sign in / out ----------

function showApp() {
  $('gate').hidden = true;
  $('app').hidden = false;
}

function signOut(message) {
  clearTimeout(timer);
  key = null;
  last = null;
  session.set(KEY_STORE, null);
  $('app').hidden = true;
  $('gate').hidden = false;
  $('gateError').textContent = message || '';
  $('gatePassword').value = '';
  $('gatePassword').focus();
}

$('gateForm').addEventListener('submit', (event) => {
  event.preventDefault();
  key = $('gatePassword').value;
  $('gateError').textContent = '';
  session.set(KEY_STORE, key);
  refresh(true);
});
$('signOut').addEventListener('click', () => signOut(''));
$('refresh').addEventListener('click', () => refresh(true));

function renderRange() {
  $('range').querySelectorAll('button').forEach((b) => {
    const on = Number(b.dataset.days) === days;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
}

$('range').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-days]');
  if (!button) return;
  days = Number(button.dataset.days);
  prefs.set(RANGE_STORE, String(days));
  renderRange();
  refresh(true);
});
$('range').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const buttons = [...$('range').querySelectorAll('button')];
  const i = buttons.findIndex((b) => Number(b.dataset.days) === days);
  const next = buttons[(i + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
  next.focus();
  next.click();
});

// ---------- rendering ----------

function render(data) {
  $('notice').hidden = data.storage !== 'memory' || demo;

  const conversion = data.visitors ? Math.min(100, (data.downloaders / data.visitors) * 100) : 0;
  $('kVisitors').textContent = big(data.visitors);
  $('kVisitorsSub').textContent = `unique, last ${data.days} days`;
  $('kPageviews').textContent = big(data.pageviews);
  $('kPageviewsSub').textContent = data.visitors ? `${(data.pageviews / data.visitors).toFixed(1)} per visitor` : 'no visits yet';
  $('kDownloads').textContent = big(data.downloads);
  $('kDownloadsSub').textContent = data.downloads ? `${big(data.downloaders)} unique people` : 'no download clicks yet';
  $('kConversion').textContent = data.visitors ? `${conversion.toFixed(conversion >= 10 || conversion === 0 ? 0 : 1)}%` : '–';
  $('kOnline').textContent = fmt.format(data.online);

  if (data.releases) {
    const total = data.releases.reduce((s, r) => s + r.assets.reduce((a, b) => a + b.count, 0), 0);
    $('kGithub').textContent = big(total);
    $('kGithubSub').textContent = data.releases.length
      ? `${data.releases.length} release${data.releases.length === 1 ? '' : 's'}, all time`
      : 'no published releases yet';
  } else {
    $('kGithub').textContent = '–';
    $('kGithubSub').textContent = 'GitHub did not answer';
  }

  drawVisitors(data.series);
  drawDownloads(data.series);
  bars('platforms', data.platforms, (raw) => PLATFORM[raw]?.color);
  bars('places', data.places);
  bars('sources', data.sources);
  bars('countries', data.countries);
  bars('systems', data.systems);
  bars('devices', data.devices);
  bars('clicks', data.clicks);
  bars('pages', data.pages);
  releasesTable(data.releases);

  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const where = demo ? 'demo data' : data.storage === 'memory' ? 'in-memory storage' : 'Upstash Redis';
  $('footer').textContent = `Updated ${time} · ${where} · refreshes every minute · cookieless, no IP addresses stored`;
}

function bars(id, rows, colorOf) {
  const list = $(id);
  const total = rows.reduce((s, [, v]) => s + v, 0);
  if (!total) {
    list.innerHTML = '<li class="none">Nothing yet in this range</li>';
    return;
  }
  const max = rows[0][1];
  const shown = rows.slice(0, 8);
  const rest = rows.slice(8).reduce((s, [, v]) => s + v, 0);
  if (rest) shown.push(['__other', rest]);
  list.innerHTML = shown
    .map(([raw, v]) => {
      const name = raw === '__other' ? 'Everything else' : label(id, raw);
      const color = colorOf?.(raw);
      return `<li title="${esc(name)}: ${fmt.format(v)}">
        <span class="bars__fill" style="width:${Math.max(2, Math.min(100, (v / max) * 100))}%"></span>
        <span class="bars__label">${color ? `<i class="swatch" style="background:${color}"></i>` : ''}${esc(name)}</span>
        <span class="bars__num">${big(v)}</span>
        <span class="bars__pct">${Math.round((v / total) * 100)}%</span>
      </li>`;
    })
    .join('');
}

function releasesTable(releases) {
  const table = $('releasesTable');
  if (!releases?.length) {
    table.innerHTML = `<tbody><tr><td class="none">${
      releases ? 'No published releases yet. Draft releases are not counted.' : 'Could not load releases from GitHub. Try again in a few minutes.'
    }</td></tr></tbody>`;
    return;
  }
  const used = PLATFORMS.filter((p) => releases.some((r) => r.assets.some((a) => a.platform === p.key)));
  const head = `<thead><tr><th>Release</th><th>Published</th>${used
    .map((p) => `<th class="num"><i class="swatch" style="background:${p.color}"></i>${p.short}</th>`)
    .join('')}<th class="num">Total</th></tr></thead>`;
  const body = releases
    .map((r) => {
      const counts = used.map((p) => r.assets.filter((a) => a.platform === p.key).reduce((s, a) => s + a.count, 0));
      const names = r.assets.map((a) => `${a.name}: ${fmt.format(a.count)}`).join('\n');
      const date = r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '–';
      return `<tr title="${esc(names)}"><td class="mono">${esc(r.tag)}${r.prerelease ? ' <span class="tag">pre</span>' : ''}</td><td>${date}</td>${counts
        .map((c) => `<td class="num">${fmt.format(c)}</td>`)
        .join('')}<td class="num"><b>${fmt.format(counts.reduce((a, b) => a + b, 0))}</b></td></tr>`;
    })
    .join('');
  table.innerHTML = head + `<tbody>${body}</tbody>`;
}

// ---------- SVG charts ----------

const SVG = 'http://www.w3.org/2000/svg';
const PAD = { top: 14, right: 12, bottom: 28, left: 42 };

function svgEl(tag, attrs, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
}

// Clean round ticks: 0, 5, 10... or 0, 200, 400...
function niceMax(v) {
  if (v <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(v / 4));
  return [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s * 4 >= v) * 4;
}

function frame(container, max, title) {
  container.innerHTML = '';
  const w = Math.max(240, container.clientWidth);
  const h = Math.max(160, container.clientHeight);
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', 'aria-label': title }, container);
  const plot = { x: PAD.left, y: PAD.top, w: w - PAD.left - PAD.right, h: h - PAD.top - PAD.bottom };
  const yMax = niceMax(max);
  for (let i = 0; i <= 4; i++) {
    const y = plot.y + plot.h - (plot.h * i) / 4;
    svgEl('line', { class: i === 0 ? 'baseline' : 'gridline', x1: plot.x, x2: plot.x + plot.w, y1: y, y2: y }, svg);
    const t = svgEl('text', { class: 'tick', x: plot.x - 10, y: y + 4, 'text-anchor': 'end' }, svg);
    t.textContent = compact.format((yMax * i) / 4);
  }
  return { svg, plot, y: (v) => plot.y + plot.h - (v / yMax) * plot.h };
}

function xLabels(svg, plot, series, xOf) {
  const n = series.length;
  const picks = n <= 7 ? series.map((_, i) => i) : n <= 31 ? [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1] : [0, Math.floor(n / 2), n - 1];
  for (const i of picks) {
    const anchor = n > 7 && i === 0 ? 'start' : n > 7 && i === n - 1 ? 'end' : 'middle';
    const t = svgEl('text', { class: 'tick', x: xOf(i), y: plot.y + plot.h + 20, 'text-anchor': anchor }, svg);
    t.textContent = dayLabel(series[i].d);
  }
}

function emptyText(svg, plot, text) {
  const t = svgEl('text', { class: 'empty', x: plot.x + plot.w / 2, y: plot.y + plot.h / 2, 'text-anchor': 'middle' }, svg);
  t.textContent = text;
}

function tooltip(html, clientX, clientY) {
  const tip = $('tooltip');
  if (!html) {
    tip.hidden = true;
    return;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const { width, height } = tip.getBoundingClientRect();
  const x = clientX + 16 + width > window.innerWidth ? clientX - width - 16 : clientX + 16;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, clientY - height - 12)}px`;
}

const dlTotal = (r) => Object.values(r.dl || {}).reduce((a, b) => a + b, 0);

function drawVisitors(series) {
  const container = $('visitorsChart');
  const max = Math.max(0, ...series.map((r) => r.uv));
  const { svg, plot, y } = frame(container, max, 'Unique visitors per day');
  const step = series.length > 1 ? plot.w / (series.length - 1) : 0;
  const xOf = (i) => (series.length > 1 ? plot.x + i * step : plot.x + plot.w / 2);
  const pts = series.map((r, i) => [xOf(i), y(r.uv)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('');

  const defs = svgEl('defs', {}, svg);
  const grad = svgEl('linearGradient', { id: 'areaGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svgEl('stop', { offset: '0', style: 'stop-color:var(--c1);stop-opacity:.34' }, grad);
  svgEl('stop', { offset: '1', style: 'stop-color:var(--c1);stop-opacity:0' }, grad);
  svgEl('path', { class: 'area', d: `${line}L${pts.at(-1)[0]} ${y(0)}L${pts[0][0]} ${y(0)}Z`, fill: 'url(#areaGrad)' }, svg);
  svgEl('path', { class: 'line', d: line }, svg);
  if (!max) emptyText(svg, plot, 'No visitors yet in this range');
  const [ex, ey] = pts.at(-1);
  svgEl('circle', { class: 'dot', cx: ex, cy: ey, r: 4.5 }, svg);
  xLabels(svg, plot, series, xOf);

  const cross = svgEl('line', { class: 'crosshair', y1: plot.y, y2: plot.y + plot.h, visibility: 'hidden' }, svg);
  const dot = svgEl('circle', { class: 'dot', r: 5.5, visibility: 'hidden' }, svg);
  const hit = svgEl('rect', { class: 'hit', x: plot.x - Math.max(step / 2, 8), y: plot.y, width: plot.w + Math.max(step, 16), height: plot.h }, svg);
  hit.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width || 1;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(((e.clientX - box.left) / scale - plot.x) / (step || 1))));
    const [px, py] = pts[i];
    cross.setAttribute('x1', px);
    cross.setAttribute('x2', px);
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', py);
    dot.setAttribute('visibility', 'visible');
    const r = series[i];
    tooltip(
      `<div class="tt__title">${longDay(r.d)}</div>
       <div class="tt__row"><i style="background:var(--c1)"></i>Visitors<b>${fmt.format(r.uv)}</b></div>
       <div class="tt__row">Page views<b>${fmt.format(r.pv)}</b></div>
       <div class="tt__row">Download clicks<b>${fmt.format(dlTotal(r))}</b></div>`,
      e.clientX,
      e.clientY,
    );
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tooltip(null);
  });

  $('visitorsTable').innerHTML =
    '<thead><tr><th>Day</th><th class="num">Visitors</th><th class="num">Page views</th><th class="num">Downloads</th></tr></thead><tbody>' +
    [...series]
      .reverse()
      .map((r) => `<tr><td>${longDay(r.d)}</td><td class="num">${fmt.format(r.uv)}</td><td class="num">${fmt.format(r.pv)}</td><td class="num">${fmt.format(dlTotal(r))}</td></tr>`)
      .join('') +
    '</tbody>';
}

// Bar with a 4px rounded data end and a square base.
function topRounded(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

function drawDownloads(series) {
  const container = $('downloadsChart');
  // only installers that appear in this range get a legend entry (colour stays tied to the installer)
  const present = PLATFORMS.filter((p) => series.some((r) => r.dl?.[p.key]));
  const legendItems = present.length ? present : PLATFORMS.slice(0, 4);
  $('downloadsLegend').innerHTML = legendItems.map((p) => `<li><i style="background:${p.color}"></i>${p.label}</li>`).join('');

  const totals = series.map(dlTotal);
  const max = Math.max(0, ...totals);
  const { svg, plot, y } = frame(container, max, 'Download clicks per day by installer');
  const band = plot.w / series.length;
  const barW = Math.max(3, Math.min(26, band * 0.62));
  const xOf = (i) => plot.x + band * i + band / 2;
  const GAP = 2;

  series.forEach((r, i) => {
    const hover = svgEl('rect', { class: 'band-hover', x: plot.x + band * i, y: plot.y, width: band, height: plot.h, rx: 6, opacity: 0 }, svg);
    let base = y(0);
    const filled = PLATFORMS.filter((p) => r.dl?.[p.key]);
    filled.forEach((p, j) => {
      const h = y(0) - y(r.dl[p.key]);
      const top = base - h;
      const segH = Math.max(1, h - (j > 0 ? GAP : 0)); // 2px surface gap between stacked segments
      const isTop = j === filled.length - 1;
      svgEl(
        'path',
        { d: isTop ? topRounded(xOf(i) - barW / 2, top, barW, segH, 4) : `M${xOf(i) - barW / 2} ${top}h${barW}v${segH}h${-barW}Z`, style: `fill:${p.color}` },
        svg,
      );
      base = top;
    });
    const hit = svgEl('rect', { class: 'hit', x: plot.x + band * i, y: plot.y, width: band, height: plot.h }, svg);
    hit.addEventListener('pointermove', (e) => {
      hover.setAttribute('opacity', 1);
      tooltip(
        `<div class="tt__title">${longDay(r.d)}</div>` +
          (filled.length
            ? filled.map((p) => `<div class="tt__row"><i style="background:${p.color}"></i>${p.label}<b>${fmt.format(r.dl[p.key])}</b></div>`).join('')
            : '<div class="tt__row">No download clicks</div>') +
          (filled.length > 1 ? `<div class="tt__row tt__total">Total<b>${fmt.format(totals[i])}</b></div>` : ''),
        e.clientX,
        e.clientY,
      );
    });
    hit.addEventListener('pointerleave', () => {
      hover.setAttribute('opacity', 0);
      tooltip(null);
    });
  });
  if (!max) emptyText(svg, plot, 'No download clicks yet in this range');
  xLabels(svg, plot, series, xOf);

  const cols = present.length ? present : PLATFORMS.slice(0, 4);
  $('downloadsTable').innerHTML =
    `<thead><tr><th>Day</th>${cols.map((p) => `<th class="num">${p.short}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>` +
    series
      .map((r, i) => ({ r, i }))
      .reverse()
      .map(({ r, i }) => `<tr><td>${longDay(r.d)}</td>${cols.map((p) => `<td class="num">${fmt.format(r.dl?.[p.key] || 0)}</td>`).join('')}<td class="num">${fmt.format(totals[i])}</td></tr>`)
      .join('') +
    '</tbody>';
}

// Charts are drawn at the container's pixel size, so redraw when it changes.
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if (last && !$('app').hidden) {
      drawVisitors(last.series);
      drawDownloads(last.series);
    }
  });
}).observe($('app'));

// ---------- demo data (?demo) for previewing the layout without the API ----------

function demoData(n) {
  const series = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.now() - (n - 1 - i) * 864e5).toISOString().slice(0, 10);
    const wave = Math.max(4, Math.round(36 + 26 * Math.sin(i / 3) + i * 3 + (i % 7 === 5 ? 54 : 0)));
    const arm = Math.round(wave * 0.09);
    return {
      d,
      uv: wave,
      pv: Math.round(wave * 1.6),
      dlu: Math.round(wave * 0.17),
      dl: { 'mac-arm64': arm, 'mac-x64': Math.round(arm * 0.3), 'windows-x64': Math.round(arm * 0.9), 'windows-arm64': i % 4 === 0 ? 1 : 0 },
    };
  });
  const sum = (f) => series.reduce((s, r) => s + f(r), 0);
  const plat = (k) => sum((r) => r.dl[k]);
  return {
    storage: 'upstash',
    days: n,
    visitors: Math.round(sum((r) => r.uv) * 0.86),
    downloaders: Math.round(sum((r) => r.dlu) * 0.9),
    pageviews: sum((r) => r.pv),
    downloads: sum(dlTotal),
    online: 6,
    series,
    platforms: [['mac-arm64', plat('mac-arm64')], ['windows-x64', plat('windows-x64')], ['mac-x64', plat('mac-x64')], ['windows-arm64', plat('windows-arm64')]],
    places: [['hero', 151], ['cta', 63], ['nav', 31], ['faq', 9]],
    sources: [['x', 388], ['direct', 201], ['hacker news', 97], ['github', 54], ['reddit', 31], ['google', 18]],
    countries: [['US', 240], ['DE', 96], ['GB', 61], ['NL', 44], ['IN', 40], ['XX', 9]],
    systems: [['windows', 412], ['mac', 301], ['ios', 96], ['android', 41], ['linux', 12]],
    devices: [['desktop', 690], ['mobile', 150], ['tablet', 22]],
    clicks: [['github', 58], ['tips-open', 21], ['github-issues', 12], ['feedback-mail', 7], ['tips-paid', 3]],
    pages: [['/', 980]],
    releases: [
      {
        tag: 'v0.2.0',
        date: new Date().toISOString(),
        assets: [
          { name: 'Bastion-mac-arm64.dmg', platform: 'mac-arm64', count: 142 },
          { name: 'Bastion-mac-x64.dmg', platform: 'mac-x64', count: 31 },
          { name: 'Bastion-setup-x64.exe', platform: 'windows-x64', count: 118 },
          { name: 'Bastion-setup-arm64.exe', platform: 'windows-arm64', count: 6 },
        ],
      },
      {
        tag: 'v0.1.0',
        date: new Date(Date.now() - 9 * 864e5).toISOString(),
        assets: [
          { name: 'Bastion-0.1.0-mac-universal.dmg', platform: 'mac-universal', count: 64 },
          { name: 'Bastion-0.1.0-win-x64.exe', platform: 'windows-x64', count: 49 },
        ],
      },
    ],
  };
}

// ---------- start ----------

renderRange();
if (key || demo) refresh(false);
else signOut('');
