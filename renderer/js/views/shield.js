// Shield view: exposure radar (WebGL glass disc around the router, 2D fallback), deep scan checks
// with guided fixes, score dial, UPnP mappings and open ports. Everything shown comes from the
// store; nothing is invented.
import { readPrefs, PREFS_EVENT } from './settings.js';
import { createExposureRadar } from '../viz/exposure-radar.js';

const DEG = Math.PI / 180;

const SHORT = {
  tr069: 'TR-069', upnp: 'UPnP', 'dns-plaintext': 'DNS', 'admin-default': 'Admin login', wps: 'WPS',
  telnet: 'Telnet', ssh: 'SSH', 'web-admin-http': 'HTTP admin', 'location-map': 'Location maps',
  'mac-privacy': 'MAC privacy', 'wifi-security': 'Wi-Fi security', 'unknown-devices': 'Devices',
};
// One word per status everywhere: radar label, legend, summary and row tag. Severity is secondary.
const STATUS_WORD = { risk: 'Open', warn: 'Review', ok: 'Sealed', unknown: 'Unknown' };
// Score arc: 270 degrees, same geometry as the reference speed gauge (centre 130,130, r 100).
const ARC_D = 'M59.29 200.71 A100 100 0 1 1 200.71 200.71';
const STATUS_RANK = { risk: 0, warn: 1, unknown: 2, ok: 3 };
const FIX_TARGET = {
  'router-admin': 'Opens your router admin page',
  'dns-settings': 'Opens the DNS settings of this computer',
  'wifi-settings': 'Opens the Wi-Fi settings of this computer',
  'mac-privacy': 'Opens the private Wi-Fi address settings',
};
const RISKY_PORTS = { 21: 'risk', 23: 'risk', 7547: 'risk', 22: 'warn', 80: 'warn', 8080: 'warn', 1900: 'warn', 5000: 'warn' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function errText(err) {
  return String((err && err.message) || err || 'Unknown error');
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isReport(r) {
  return !!(r && Array.isArray(r.checks));
}

function statusTag(c) {
  const word = STATUS_WORD[c.status] || 'Unknown';
  const sev = !c.liveOnly && (c.status === 'risk' || c.status === 'warn') && c.severity ? String(c.severity).toLowerCase() : '';
  return `<span class="${pillClass(c.status)}">${esc(word)}${sev ? `<span class="pill-sev">${esc(sev)}</span>` : ''}</span>`;
}

function pillClass(status) {
  if (status === 'risk') return 'pill pill--risk';
  if (status === 'warn') return 'pill pill--warn';
  if (status === 'ok') return 'pill pill--ok';
  return 'pill pill--unknown';
}
// Status glyphs for the check list: shield-check (sealed), exclamation in an octagon (open),
// eye (needs a look), question in a circle (unknown), plus checking and pending states.
const GLYPH = {
  ok: '<path d="M12 3.2l6.8 2.7v5.3c0 4.3-2.9 7.9-6.8 9.4-3.9-1.5-6.8-5.1-6.8-9.4V5.9z"/><path d="M9.1 12.2l2 2 3.9-4.2"/>',
  risk: '<path d="M8.5 3.6h7l5 5v7l-5 5h-7l-5-5v-7z"/><path d="M12 8.2v4.4"/><path d="M12 15.9v.05"/>',
  warn: '<path d="M2.9 12s3.3-6 9.1-6 9.1 6 9.1 6-3.3 6-9.1 6-9.1-6-9.1-6z"/><circle cx="12" cy="12" r="2.5"/>',
  unknown: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.7a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.9-2.2 3.3"/><path d="M12 16.5v.05"/>',
  checking: '<circle class="g-track" cx="12" cy="12" r="7.5"/><path class="g-arc" d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5"/>',
  pending: '<circle cx="12" cy="12" r="6.5" stroke-dasharray="1.6 3.1"/>',
};

function glyph(state) {
  return `<span class="sh-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${GLYPH[state] || GLYPH.unknown}</svg></span>`;
}

export function mount(el, ctx) {
  const { api, store } = ctx;
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const subs = [];
  let alive = true;
  let prefs = readPrefs();

  const st = {
    report: isReport(store.get('scan')) ? store.get('scan') : null,
    scanError: null,
    prog: null,
    progAt: 0,
    current: null,
    live: new Map(),
    busy: false,
  };
  const scanVal = store.get('scan');
  if (scanVal && !isReport(scanVal) && (scanVal.error || (Array.isArray(scanVal.errors) && scanVal.errors.length))) {
    st.scanError = scanVal.error || scanVal.errors.join('; ');
  }

  el.innerHTML = `
    <section class="v-shield view-pad" aria-labelledby="sh-title">
      <header class="sh-head">
        <div>
          <p class="eyebrow">Shield</p>
          <h1 class="h-display" id="sh-title">Close every backdoor.</h1>
        </div>
        <div class="sh-head-side">
          <p class="sh-lede" data-lede></p>
          <button class="btn btn--primary" type="button" data-run>Run deep scan</button>
        </div>
      </header>

      <div class="sh-console">
        <div class="sh-bar nv-glass">
          <span class="sh-live"><span class="sh-led" data-led></span><span data-bar-status>Idle</span></span>
          <span class="nv-tag" data-bar-gw>Gateway unknown</span>
          <span class="nv-tag sh-bar-right" data-bar-time></span>
          <div class="sh-progress" aria-hidden="true"><span data-progress></span></div>
        </div>

        <div class="sh-cells sh-cells--main">
          <div class="sh-card sh-map nv-glass">
            <div class="sh-card-h"><h2>Exposure radar</h2><span class="nv-tag" data-open-count></span></div>
            <div class="sh-radar" data-radar role="img" aria-label="Exposure radar around your router"></div>
            <div class="sh-legend">
              <span><i class="lg-risk"></i>Open</span>
              <span><i class="lg-warn"></i>Review</span>
              <span><i class="lg-ok"></i>Sealed</span>
              <span><i class="lg-unk"></i>Unknown</span>
              <span><i class="lg-dev"></i>Device</span>
              <span class="sh-legend-note">Closer to the rim means easier to reach from outside. Drag to tilt.</span>
            </div>
          </div>
          <div class="sh-card sh-checks nv-glass">
            <div class="sh-card-h"><h2>Deep scan</h2><span class="nv-tag" data-scan-meta></span></div>
            <p class="sh-step" data-step role="status" aria-live="polite"></p>
            <div class="sh-scroll" data-scroll>
              <div class="sh-sum" data-sum></div>
              <ul class="sh-list" data-list aria-label="Scan checks"></ul>
            </div>
            <div data-errors></div>
          </div>
        </div>

        <div class="sh-cells sh-cells--lower">
          <div class="sh-card sh-score nv-glass">
            <div class="sh-card-h"><h2>Score</h2><span class="nv-tag" data-score-meta></span></div>
            <div class="sh-dial" data-dial-wrap data-level="none">
              <svg viewBox="0 0 260 232" role="img" aria-label="Security score" data-dial>
                <defs><linearGradient id="shScoreGrad" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" style="stop-color:var(--sky)"/><stop offset=".55" style="stop-color:var(--violet)"/><stop offset="1" style="stop-color:var(--lavender)"/>
                </linearGradient></defs>
                <path class="sc-track" d="${ARC_D}" pathLength="100"/>
                <path class="sc-val" d="${ARC_D}" pathLength="100" stroke="url(#shScoreGrad)" stroke-dasharray="0 100" data-arc/>
                <g data-ticks></g>
              </svg>
              <div class="sh-dial-center"><b data-score>--</b><span data-score-word>No scan yet</span></div>
            </div>
            <p class="sh-fine" data-score-note></p>
          </div>
          <div class="sh-card sh-upnp nv-glass">
            <div class="sh-card-h"><h2>UPnP mappings</h2><span class="nv-tag" data-upnp-meta></span></div>
            <div data-upnp></div>
          </div>
          <div class="sh-card sh-ports nv-glass">
            <div class="sh-card-h"><h2>Open ports</h2><span class="nv-tag" data-ports-meta></span></div>
            <div data-ports></div>
          </div>
        </div>
      </div>
    </section>`;

  const $ = (sel) => el.querySelector(sel);
  const runBtn = $('[data-run]');
  // ---------- derived state ----------
  function progFrac() {
    const p = st.prog;
    if (!p || !p.total) return 0;
    const done = p.status ? Number(p.index) + 1 : Number(p.index);
    return Math.max(0, Math.min(1, done / p.total));
  }

  // The shell marks scanProgress.running; older payloads without it fall back to progress + recency.
  function isScanning() {
    if (st.busy) return true;
    if (!st.prog) return false;
    if (typeof st.prog.running === 'boolean') return st.prog.running;
    return progFrac() < 1 && Date.now() - st.progAt < 20000;
  }

  // Checks to plot and list: the last report, overlaid with what the running scan has found so far.
  function currentChecks() {
    const scanning = isScanning();
    const base = st.report ? st.report.checks.slice() : [];
    if (!scanning) return base.map((c) => ({ ...c, state: 'done' }));
    const out = base.map((c) => {
      if (st.live.has(c.id)) return { ...c, status: st.live.get(c.id), state: 'done' };
      if (st.current === c.id) return { ...c, state: 'checking' };
      return { ...c, state: 'pending' };
    });
    for (const [id, status] of st.live) {
      if (!out.some((c) => c.id === id)) out.push({ id, title: (st.titles && st.titles[id]) || SHORT[id] || id, status, severity: null, liveOnly: true, evidence: '', fix: null, state: 'done' });
    }
    if (st.current && !out.some((c) => c.id === st.current)) {
      out.push({ id: st.current, title: (st.titles && st.titles[st.current]) || SHORT[st.current] || st.current, status: 'unknown', severity: null, liveOnly: true, evidence: '', fix: null, state: 'checking' });
    }
    return out;
  }

  // ---------- exposure radar ----------
  let hotId = null;
  function markRow(id) {
    hotId = id;
    el.querySelectorAll('.sh-row.is-hot').forEach((r) => { if (r.dataset.id !== id) r.classList.remove('is-hot'); });
    if (id) {
      const row = el.querySelector(`.sh-row[data-id="${CSS.escape(id)}"]`);
      if (row) row.classList.add('is-hot');
    }
  }

  // A beacon click opens its row's fix steps and brings the whole row (steps included) into view.
  let revealTimer = 0;
  function openRow(id) {
    const row = el.querySelector(`.sh-row[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    const det = row.querySelector('details');
    const opening = det && !det.open;
    if (det) { expanded.add(id); det.open = true; }
    const behavior = RM ? 'auto' : 'smooth';
    row.scrollIntoView({ behavior, block: 'nearest' });
    clearTimeout(revealTimer);
    // the steps grow open over .4s; check again once they have their full height
    if (opening && !RM) revealTimer = setTimeout(() => { if (alive && row.isConnected) row.scrollIntoView({ behavior, block: 'nearest' }); }, 460);
    row.classList.remove('is-flash');
    void row.offsetWidth;
    row.classList.add('is-flash');
    // Focus the disclosure (or the row itself), never an action button: Enter must not launch a fix.
    let target = row.querySelector('details > summary');
    if (!target) { row.tabIndex = -1; target = row; }
    target.focus({ preventScroll: true });
  }

  const radarHost = $('[data-radar]');
  const radar = createExposureRadar(radarHost, {
    onHover: (id) => markRow(id),
    onSelect: (id) => openRow(id),
  });

  function feedRadar() {
    const devs = Array.isArray(store.get('devices')) ? store.get('devices') : [];
    const ov = store.get('overview');
    const checks = currentChecks();
    radar.setData({
      checks,
      devices: devs.filter((d) => d && !d.isGateway).map((d) => ({ key: d.mac || d.ip, self: !!d.isThisComputer })),
      gateway: ov && ov.gateway && ov.gateway.ip,
      scanning: isScanning(),
      progress: progFrac(),
      hasReport: !!st.report,
    });
    const done = checks.filter((c) => c.state === 'done');
    const n = (k) => done.filter((c) => c.status === k).length;
    radarHost.setAttribute('aria-label', !st.report && !isScanning()
      ? 'Exposure radar around your router. No scan yet.'
      : 'Exposure radar around your router: ' + n('risk') + ' open, ' + n('warn') + ' to review, ' + n('unknown') + ' unknown, ' + n('ok') + ' sealed. Details are in the Deep scan list.');
  }

  // ---------- head / bar ----------
  function renderHead() {
    const scanning = isScanning();
    const p = st.prog;
    runBtn.disabled = scanning;
    runBtn.textContent = scanning ? (p && p.total ? 'Scanning ' + Math.min(p.total, Number(p.index) + 1) + '/' + p.total : 'Scanning') : st.report ? 'Run deep scan again' : 'Run deep scan';
    $('[data-progress]').style.width = (scanning ? progFrac() * 100 : st.report ? 100 : 0) + '%';
    $('[data-led]').dataset.state = scanning ? 'scan' : !st.report ? 'idle' : st.report.checks.some((c) => c.status === 'risk') ? 'risk' : 'ok';
    $('[data-bar-status]').textContent = scanning ? 'Scanning' : st.report ? 'Last scan ' + (fmtTime(st.report.finishedAt) || 'time unknown') : 'No scan yet';
    const ov = store.get('overview');
    const gw = ov && ov.gateway;
    $('[data-bar-gw]').textContent = gw && gw.ip ? 'Gateway ' + gw.ip + (gw.vendor ? ' · ' + gw.vendor : '') : 'Gateway unknown';
    if (st.report && st.report.startedAt && st.report.finishedAt) {
      const secs = (new Date(st.report.finishedAt) - new Date(st.report.startedAt)) / 1000;
      $('[data-bar-time]').textContent = Number.isFinite(secs) && secs >= 0 ? 'Took ' + secs.toFixed(secs < 10 ? 1 : 0) + ' s' : '';
    } else {
      $('[data-bar-time]').textContent = '';
    }
    $('[data-lede]').textContent = st.report
      ? 'Each finding below shows what Bastion actually observed and how to close it. Bastion never changes your router on its own.'
      : 'A deep scan checks your router for remote-management channels, legacy shells, open port forwards and plain-text DNS. Read-only, no admin rights needed.';

    const step = $('[data-step]');
    if (scanning) {
      step.hidden = false;
      step.textContent = p && p.id && p.title ? 'Checking: ' + p.title : (p && p.title) || 'Starting scan';
    } else if (st.scanError) {
      step.hidden = false;
      step.textContent = 'Scan failed: ' + st.scanError;
    } else {
      step.hidden = true;
      step.textContent = '';
    }
    step.classList.toggle('sh-step--err', !scanning && !!st.scanError);

    // The counts live once, in the Deep scan summary; the radar header only says when it is live.
    $('[data-open-count]').textContent = scanning ? 'Live' : '';
    $('[data-scan-meta]').textContent = '';
  }

  // ---------- check list ----------
  const expanded = new Set();

  function renderSummary(checks, scanning) {
    const box = $('[data-sum]');
    const done = checks.filter((c) => c.state === 'done');
    if (!done.length && !scanning) { box.hidden = true; box.innerHTML = ''; return; }
    const n = (k) => done.filter((c) => c.status === k).length;
    const parts = ['risk', 'warn', 'unknown', 'ok'].map((k) => [k, n(k), STATUS_WORD[k]])
      .filter((p) => p[1] > 0 || p[0] === 'risk' || p[0] === 'warn');
    box.hidden = false;
    box.innerHTML = parts.map(([k, v, w]) => `<span class="sh-sum-i" data-k="${k}"${v ? '' : ' data-zero'}><i></i><b>${v}</b> ${w}</span>`).join('<span class="sh-sum-sep" aria-hidden="true"></span>')
      + (scanning ? `<span class="sh-sum-i sh-sum-scan">${done.length}/${(st.prog && st.prog.total) || checks.length}</span>` : '');
  }

  function renderList() {
    const list = $('[data-list]');
    const scanning = isScanning();
    const checks = currentChecks();
    renderSummary(checks, scanning);
    if (!checks.length) {
      list.innerHTML = scanning
        ? '<li class="sh-empty">Preparing checks.</li>'
        : `<li class="sh-empty">
             <p class="empty-state">No scan yet. A deep scan takes under a minute and only reads; it changes nothing.</p>
           </li>`;
      return;
    }
    const sorted = scanning ? checks : checks.slice().sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
    list.innerHTML = sorted.map((c) => {
      const state = c.state === 'done' ? c.status : c.state;
      const port = c.state === 'done' ? (String(c.evidence || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}:(\d{1,5})\b/) || [])[1] : null;
      const hasSteps = c.fix && Array.isArray(c.fix.steps) && c.fix.steps.length && c.status !== 'ok' && c.state === 'done';
      const canOpen = c.fix && c.fix.open && c.status !== 'ok' && c.state === 'done';
      const tag = c.state === 'pending' ? '<span class="pill pill--unknown">Pending</span>'
        : c.state === 'checking' ? '<span class="pill pill--info">Checking</span>'
        : statusTag(c);
      const extra = c.id === 'unknown-devices' && c.state === 'done'
        ? '<button class="nv-mini" type="button" data-go="devices">See devices</button>' : '';
      const upnpLink = c.id === 'upnp' && c.state === 'done' && st.report && Array.isArray(st.report.upnpMappings) && st.report.upnpMappings.length
        ? '<button class="nv-mini" type="button" data-jump="upnp">See mappings</button>' : '';
      return `
        <li class="sh-row${c.id === hotId ? ' is-hot' : ''}" data-state="${esc(state)}" data-id="${esc(c.id)}">
          ${glyph(state)}
          <div class="sh-what">
            <span class="sh-kicker">${esc(SHORT[c.id] || c.id)}${port ? `<span class="sh-port">:${esc(port)}</span>` : ''}</span>
            <b>${esc(c.title || SHORT[c.id] || c.id)}</b>
            ${c.evidence ? `<span class="sh-ev${prefs.advancedEvidence ? '' : ' sh-ev--clamp'}" title="${esc(c.evidence)}">${esc(c.evidence)}</span>` : ''}
          </div>
          <div class="sh-tag">${tag}</div>
          ${canOpen || extra || upnpLink ? `<div class="sh-act">
            ${canOpen ? `<button class="nv-mini${c.status === 'risk' ? ' nv-mini--go' : ''}" type="button" data-fix="${esc(c.fix.open)}" title="${esc(FIX_TARGET[c.fix.open] || '')}">${esc(c.fix.label || 'Open settings')}</button>` : ''}
            ${upnpLink}${extra}
          </div>` : ''}
          ${hasSteps ? `<details class="sh-steps"${expanded.has(c.id) ? ' open' : ''} data-steps="${esc(c.id)}">
            <summary><span>How to fix</span><span class="sh-steps-n">${c.fix.steps.length} step${c.fix.steps.length === 1 ? '' : 's'}</span><svg class="sh-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg></summary>
            <ol>${c.fix.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          </details>` : ''}
        </li>`;
    }).join('');
  }

  function renderErrors() {
    const box = $('[data-errors]');
    const errs = st.report && Array.isArray(st.report.errors) ? st.report.errors.filter(Boolean) : [];
    if (!errs.length || isScanning()) { box.innerHTML = ''; return; }
    if (!prefs.advancedEvidence) {
      box.innerHTML = `<p class="sh-fine">${errs.length} scan note${errs.length === 1 ? '' : 's'} hidden. Turn on "Show advanced evidence" in Settings to see them.</p>`;
      return;
    }
    box.innerHTML = `<details class="sh-notes"><summary>Scan notes · ${errs.length}</summary><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>`;
  }

  el.addEventListener('click', (e) => {
    const fixBtn = e.target.closest('[data-fix]');
    if (fixBtn) {
      const target = fixBtn.dataset.fix;
      fixBtn.disabled = true;
      Promise.resolve(api.fix.open(target))
        .then((r) => {
          if (r && r.ok) ctx.toast(FIX_TARGET[target] ? FIX_TARGET[target].replace('Opens', 'Opened') + '. Follow the steps below.' : 'Opened.', 'info');
          else ctx.toast('Bastion could not open that page. Follow the steps manually.' + (r && r.error ? ' (' + r.error + ')' : ''), 'warn');
        })
        .catch((err) => ctx.toast('Could not open: ' + errText(err), 'warn'))
        .finally(() => { fixBtn.disabled = false; });
      const row = fixBtn.closest('[data-id]');
      if (row) {
        expanded.add(row.dataset.id);
        const det = row.querySelector('details');
        if (det) det.open = true;
      }
      return;
    }
    const go = e.target.closest('[data-go]');
    if (go) { ctx.navigate(go.dataset.go); return; }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      const t = el.querySelector('.sh-' + jump.dataset.jump);
      if (t) t.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
    }
  });
  const listEl = $('[data-list]');
  const rowHover = (e) => {
    const row = e.target.closest && e.target.closest('.sh-row[data-id]');
    const id = row ? row.dataset.id : null;
    radar.setHighlight(id);
    markRow(id);
  };
  listEl.addEventListener('pointerover', rowHover);
  listEl.addEventListener('focusin', rowHover);
  listEl.addEventListener('pointerleave', () => { radar.setHighlight(null); markRow(null); });
  listEl.addEventListener('focusout', (e) => {
    if (!listEl.contains(e.relatedTarget)) { radar.setHighlight(null); markRow(null); }
  });

  el.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.steps) return;
    if (d.open) expanded.add(d.dataset.steps); else expanded.delete(d.dataset.steps);
  }, true);

  // ---------- score ----------
  (function buildTicks() {
    const g = $('[data-ticks]');
    const NS = 'http://www.w3.org/2000/svg';
    [0, 25, 50, 75, 100].forEach((v) => {
      const a = (135 + 270 * (v / 100)) * DEG;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', (130 + 124 * c).toFixed(1));
      t.setAttribute('y', (130 + 124 * s + 4).toFixed(1));
      t.setAttribute('text-anchor', Math.abs(c) < 0.2 ? 'middle' : c < 0 ? 'end' : 'start');
      t.setAttribute('class', 'sc-tick');
      t.textContent = String(v);
      g.appendChild(t);
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', (130 + 86 * c).toFixed(1)); ln.setAttribute('y1', (130 + 86 * s).toFixed(1));
      ln.setAttribute('x2', (130 + 80 * c).toFixed(1)); ln.setAttribute('y2', (130 + 80 * s).toFixed(1));
      ln.setAttribute('class', 'sc-mark');
      g.appendChild(ln);
    });
  })();

  function renderScore() {
    const arc = $('[data-arc]');
    const wrap = $('[data-dial-wrap]');
    const scanning = isScanning();
    const has = st.report && Number.isFinite(Number(st.report.score));
    const score = has ? Math.max(0, Math.min(100, Math.round(Number(st.report.score)))) : null;
    let level = 'none';
    let word = 'No scan yet';
    if (score != null) {
      if (score >= 80) { level = 'ok'; word = 'Well sealed'; } else if (score >= 50) { level = 'warn'; word = 'Needs attention'; } else { level = 'risk'; word = 'Exposed'; }
    }
    if (scanning) { word = 'Scanning'; level = 'none'; }
    wrap.dataset.level = level;
    arc.setAttribute('stroke-dasharray', score == null ? '0 100' : score + ' 100');
    arc.style.opacity = score == null || score === 0 ? '0' : '1';
    $('[data-dial]').setAttribute('aria-label', score == null ? 'Security score: no scan yet' : 'Security score ' + score + ' out of 100, ' + word.toLowerCase());
    $('[data-score]').textContent = score == null ? '--' : String(score);
    $('[data-score-word]').textContent = word;
    $('[data-score-meta]').textContent = score == null ? '' : 'out of 100';
    const unknown = st.report ? st.report.checks.filter((c) => c.status === 'unknown').length : 0;
    $('[data-score-note]').textContent = score == null
      ? 'The score appears after the first scan.'
      : unknown
        ? unknown + ' check' + (unknown === 1 ? ' was' : 's were') + ' not measurable from this computer and ' + (unknown === 1 ? 'is' : 'are') + ' not counted as safe.'
        : 'Every check returned a result.';
  }

  // ---------- tables ----------
  function renderTables() {
    const upBox = $('[data-upnp]');
    const portBox = $('[data-ports]');
    if (!st.report) {
      const msg = isScanning() ? 'Waiting for the scan to finish.' : 'Run a deep scan to read these from your router.';
      upBox.innerHTML = `<p class="empty-state">${msg}</p>`;
      portBox.innerHTML = `<p class="empty-state">${msg}</p>`;
      $('[data-upnp-meta]').textContent = '';
      $('[data-ports-meta]').textContent = '';
      return;
    }
    const maps = Array.isArray(st.report.upnpMappings) ? st.report.upnpMappings : [];
    const upnp = st.report.checks.find((c) => c.id === 'upnp');
    $('[data-upnp-meta]').textContent = maps.length ? maps.length + ' forward' + (maps.length === 1 ? '' : 's') : '';
    if (maps.length) {
      upBox.innerHTML = `
        <div class="sh-table-wrap"><table class="sh-table">
          <thead><tr><th>Proto</th><th>External</th><th>Internal client</th><th>Port</th><th>Description</th></tr></thead>
          <tbody>${maps.map((m) => `<tr>
            <td>${esc(String(m.protocol || '').toUpperCase() || '?')}</td>
            <td class="sh-n">${esc(m.externalPort)}</td>
            <td class="sh-n">${esc(m.internalClient || 'unknown')}</td>
            <td class="sh-n">${esc(m.internalPort)}</td>
            <td class="sh-desc">${esc(m.description || '')}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="sh-fine">Each line is a hole a device on your network asked the router to open to the internet.</p>`;
    } else if (upnp && upnp.status === 'unknown') {
      upBox.innerHTML = '<p class="empty-state">The router did not answer UPnP queries, so port forwards are unknown. If UPnP is on, check its port-forwarding page in the router admin.</p>';
    } else if (upnp && upnp.status === 'ok') {
      upBox.innerHTML = '<p class="empty-state">UPnP is off or the router reported no automatic port forwards.</p>';
    } else {
      upBox.innerHTML = '<p class="empty-state">The router reported no UPnP port forwards.</p>';
    }

    const ports = Array.isArray(st.report.openPorts) ? st.report.openPorts.slice().sort((a, b) => a.port - b.port) : [];
    $('[data-ports-meta]').textContent = ports.length ? ports.length + ' open' : '';
    portBox.innerHTML = ports.length
      ? `<ul class="sh-portlist">${ports.map((p) => `<li data-level="${RISKY_PORTS[p.port] || 'none'}">
            <span class="sh-n">${esc(p.port)}</span><span>${esc(p.service || 'unknown service')}</span></li>`).join('')}</ul>
         <p class="sh-fine">Ports on the router that answer from inside your network. Whether they are also reachable from the internet cannot be tested from this computer.</p>`
      : '<p class="empty-state">No open ports found on the router from this computer.</p>';
  }

  function renderAll() {
    if (!alive) return;
    renderHead();
    renderList();
    renderErrors();
    renderScore();
    renderTables();
    feedRadar();
  }

  // ---------- actions ----------
  async function runScan() {
    if (isScanning()) return;
    st.busy = true;
    st.scanError = null;
    st.live.clear();
    st.current = null;
    st.prog = null;
    renderAll();
    try {
      // The shell toasts the outcome; this view only reflects it.
      const r = await ctx.runScan({ depth: prefs.scanDepth });
      if (!alive) return;
      if (isReport(r)) st.report = r;
      else st.scanError = (r && (r.error || (Array.isArray(r.errors) && r.errors.join('; ')))) || 'The scanner returned no result.';
    } catch (err) {
      if (!alive) return;
      st.scanError = errText(err);
    } finally {
      st.busy = false;
      st.prog = null;
      st.current = null;
      st.live.clear();
      renderAll();
    }
  }
  runBtn.addEventListener('click', runScan);

  // ---------- store ----------
  st.titles = {};
  let lastIndex = -1;
  function applyProgress(p) {
    if (!p || typeof p !== 'object') { st.prog = null; st.current = null; return; }
    const idx = Number(p.index);
    const restarted = !st.prog || idx < lastIndex || (p.running === true && st.prog.running === false);
    if (restarted) st.live.clear();
    lastIndex = idx;
    st.prog = p;
    st.progAt = Date.now();
    st.staleShown = false;
    if (p.id && p.title) st.titles[p.id] = p.title;
    if (p.seen && typeof p.seen === 'object') {
      // Shell format: seen maps check id -> status, or 'checking' while it runs.
      st.live.clear();
      st.current = null;
      for (const [id, status] of Object.entries(p.seen)) {
        if (!id || id === 'null') continue;
        if (status === 'checking') st.current = id;
        else st.live.set(id, status);
      }
    } else if (p.id) {
      if (p.status) { st.live.set(p.id, p.status); st.current = null; } else st.current = p.id;
    }
    if (p.running === false && p.error && !st.busy) st.scanError = p.error;
  }
  subs.push(store.on('scanProgress', (p) => { applyProgress(p); renderAll(); }));
  subs.push(store.on('scan', (r) => {
    if (isReport(r)) { st.report = r; st.scanError = null; st.prog = null; st.current = null; st.live.clear(); }
    renderAll();
  }));
  subs.push(store.on('devices', () => feedRadar()));
  subs.push(store.on('overview', () => { renderHead(); feedRadar(); }));

  const onPrefs = () => { prefs = readPrefs(); renderList(); renderErrors(); };
  window.addEventListener(PREFS_EVENT, onPrefs);

  applyProgress(store.get('scanProgress'));

  // Reveal state for a scan already running (started from Home) through the fallback timeout in isScanning().
  const staleTimer = setInterval(() => {
    if (alive && st.prog && typeof st.prog.running !== 'boolean' && !st.busy && !isScanning() && !st.staleShown) { st.staleShown = true; renderAll(); }
  }, 5000);

  renderAll();

  return {
    unmount() {
      alive = false;
      clearTimeout(revealTimer);
      radar.dispose();
      clearInterval(staleTimer);
      window.removeEventListener(PREFS_EVENT, onPrefs);
      for (const off of subs) if (typeof off === 'function') off();
      el.innerHTML = '';
    },
  };
}
