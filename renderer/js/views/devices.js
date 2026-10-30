// Devices view: devices this computer can see on the local network (neighbour table),
// plus this computer's own live connections grouped by process.

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'named', label: 'Named' },
  { id: 'unknown', label: 'Unknown vendor' },
  { id: 'random', label: 'Randomized MAC' },
];
const PORT_NAMES = {
  20: 'FTP data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 80: 'HTTP', 110: 'POP3',
  123: 'NTP', 143: 'IMAP', 443: 'HTTPS', 465: 'SMTPS', 587: 'Mail submit', 853: 'DNS over TLS', 993: 'IMAPS',
  995: 'POP3S', 1900: 'SSDP', 3389: 'Remote Desktop', 3478: 'STUN', 5222: 'XMPP', 5228: 'Google push', 5353: 'mDNS',
  5223: 'Apple push', 7547: 'TR-069', 8080: 'HTTP alt', 8443: 'HTTPS alt',
};
const GROUP_PREVIEW = 8;
const ICONS = {
  gateway: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 13V9M17 13V9"/><path d="M8.5 6.5a5 5 0 0 1 7 0M6.3 4.3a8 8 0 0 1 11.4 0"/><circle cx="7" cy="16.5" r=".6"/><circle cx="10" cy="16.5" r=".6"/>',
  me: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  device: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
};
function icon(kind) {
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[kind] + '</svg>';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function errText(err) {
  return String((err && err.message) || err || 'Unknown error');
}

// Error text from an { ok:false, error } / { errors: [] } answer.
function errOf(v, fallback) {
  return (v && (v.error || (Array.isArray(v.errors) && v.errors.join('; ')))) || fallback;
}

function ipToNum(ip) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(ip || ''));
  if (!m) return Number.MAX_SAFE_INTEGER;
  return ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + +m[4];
}

function scope(ip) {
  const s = String(ip || '').toLowerCase();
  if (!s || s === '*' || s === '0.0.0.0' || s === '::') return 'none';
  if (s.startsWith('127.') || s === '::1' || s.startsWith('::ffff:127.')) return 'loopback';
  const v4 = s.startsWith('::ffff:') ? s.slice(7) : s;
  const m = /^(\d+)\.(\d+)\./.exec(v4);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return 'lan';
    if (a >= 224 && a <= 239) return 'multicast';
    return 'internet';
  }
  if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return 'lan';
  if (s.startsWith('ff')) return 'multicast';
  return 'internet';
}

function fmtRemote(ip, port) {
  const s = String(ip || '');
  const host = s.includes(':') && !s.startsWith('[') ? '[' + s + ']' : s;
  return port ? host + ':' + port : host;
}

// Upgrades gk-* markup; hands back the kit's cleanup so the view can release its observers.
function upgradeGlow(el, onCleanup) {
  import('../glow-kit.js')
    .then((m) => {
      if (!m || typeof m.initGlowKit !== 'function') return;
      const cleanup = m.initGlowKit(el);
      if (typeof cleanup === 'function') onCleanup(cleanup);
    })
    .catch(() => {});
}

export function mount(el, ctx) {
  const { api, store } = ctx;
  const subs = [];
  const timers = new Set();
  let alive = true;
  let glowCleanup = null;
  let filter = 'all';
  let query = '';
  let busy = false;
  let connBusy = false;
  let hideLocal = true;
  let live = false;
  let liveTimer = 0;
  let lastAt = null;
  let devErr = '';
  let connErr = '';
  const openGroups = new Set();

  el.innerHTML = `
    <section class="v-devices view-pad" aria-labelledby="dv-title">
      <header class="dv-head">
        <div>
          <p class="eyebrow">Devices</p>
          <h1 class="h-display" id="dv-title">Who is on your network.</h1>
        </div>
        <div class="dv-head-side">
          <p class="dv-lede">Devices this computer has recently seen on your local network, and where this computer itself is connected right now.</p>
          <div class="dv-head-actions">
            <button class="btn btn--primary" type="button" data-refresh>Refresh</button>
            <span class="nv-tag" data-updated></span>
          </div>
        </div>
      </header>

      <div class="dv-console">
        <div class="dv-numerals">
          <div class="nv-glass nv-stat"><span class="nv-stat-k"><i class="dv-kdot dv-kdot--lav"></i>Devices seen</span><span class="nv-stat-v" data-n="devices">--</span><span class="nv-stat-u" data-u="devices"></span></div>
          <div class="nv-glass nv-stat"><span class="nv-stat-k"><i class="dv-kdot dv-kdot--lav"></i>Randomized MAC</span><span class="nv-stat-v" data-n="random">--</span><span class="nv-stat-u">private addresses</span></div>
          <div class="nv-glass nv-stat"><span class="nv-stat-k"><i class="dv-kdot dv-kdot--dim"></i>Unknown vendor</span><span class="nv-stat-v" data-n="unknown">--</span><span class="nv-stat-u">no maker match</span></div>
          <div class="nv-glass nv-stat"><span class="nv-stat-k"><i class="dv-kdot dv-kdot--sky"></i>Live connections</span><span class="nv-stat-v" data-n="conns">--</span><span class="nv-stat-u" data-u="conns"></span></div>
        </div>

        <div class="dv-card nv-glass">
          <div class="dv-card-h">
            <h2>Local network</h2>
            <div class="dv-tools">
              <div class="dv-filters" role="group" aria-label="Filter devices">
                ${FILTERS.map((f) => `<button type="button" class="dv-filter" data-filter="${f.id}" aria-pressed="${f.id === 'all'}">${f.label}</button>`).join('')}
              </div>
              <label class="dv-search">
                <span class="dv-sr">Search devices and connections</span>
                <input type="search" placeholder="Search name, IP, vendor, MAC, process" autocomplete="off" spellcheck="false" data-search>
              </label>
            </div>
          </div>
          <div data-devices></div>
          <p class="dv-note">Bastion reads this computer's neighbour table, so a device appears once it has talked on the network recently. Sleeping devices and devices on a guest network may be missing. Seeing what other devices send and receive needs router integration, which is coming in a later version.</p>
        </div>

        <div class="dv-card dv-conns nv-glass">
          <div class="dv-card-h">
            <h2>This computer's connections</h2>
            <div class="dv-tools">
              <div class="dv-switch">
                <span id="dv-sw-local">Hide local and loopback</span>
                <button class="gk-toggle" type="button" role="switch" aria-checked="true" aria-labelledby="dv-sw-local" data-toggle="local"></button>
              </div>
              <div class="dv-switch">
                <span id="dv-sw-live">Auto-refresh every 10 s</span>
                <button class="gk-toggle" type="button" role="switch" aria-checked="false" aria-labelledby="dv-sw-live" data-toggle="live"></button>
              </div>
            </div>
          </div>
          <div data-conns></div>
        </div>
      </div>
    </section>`;

  const $ = (sel) => el.querySelector(sel);

  // Store convention: undefined = not loaded yet, null = load failed. devErr/connErr keep this view's own error text.
  function devicesValue() {
    const v = store.get('devices');
    if (Array.isArray(v)) return { list: v };
    if (v === undefined || (v === null && busy)) return { loading: true };
    if (v === null) return { error: devErr || 'Bastion could not read the devices on this network. Press Refresh to try again.' };
    return { error: (v && (v.error || (Array.isArray(v.errors) && v.errors.join('; ')))) || 'Unexpected answer from the scanner.' };
  }

  function connsValue() {
    const v = store.get('connections');
    if (Array.isArray(v)) return { list: v };
    if (v === undefined || (v === null && busy)) return { loading: true };
    if (v === null) return { error: connErr || 'Bastion could not list the connections on this computer. Press Refresh to try again.' };
    return { error: (v && (v.error || (Array.isArray(v.errors) && v.errors.join('; ')))) || 'Unexpected answer from the system.' };
  }

  function deviceName(d) {
    if (d.hostname) return d.hostname;
    if (d.isThisComputer) {
      const ov = store.get('overview');
      if (ov && ov.hostname) return ov.hostname;
    }
    if (d.isGateway) return 'Router';
    if (d.vendor) return d.vendor + ' device';
    return 'Unknown device';
  }

  function matches(text) {
    if (!query) return true;
    return String(text).toLowerCase().includes(query);
  }

  // ---------- numerals ----------
  function renderNumerals() {
    const dv = devicesValue();
    const cv = connsValue();
    const n = (k, v) => { $('[data-n="' + k + '"]').textContent = v; };
    if (dv.list) {
      n('devices', String(dv.list.length));
      n('random', String(dv.list.filter((d) => d.randomizedMac).length));
      n('unknown', String(dv.list.filter((d) => !d.vendor).length));
      $('[data-u="devices"]').textContent = 'on this network';
    } else {
      ['devices', 'random', 'unknown'].forEach((k) => n(k, '--'));
      $('[data-u="devices"]').textContent = dv.loading ? 'reading' : 'unavailable';
    }
    if (cv.list) {
      // Listening and unbound sockets have no remote end; they are not live connections.
      const active = cv.list.filter((c) => scope(c.remoteIp) !== 'none');
      const ext = active.filter((c) => scope(c.remoteIp) === 'internet').length;
      n('conns', String(active.length));
      $('[data-u="conns"]').textContent = ext + ' to the internet';
    } else {
      n('conns', '--');
      $('[data-u="conns"]').textContent = cv.loading ? 'reading' : 'unavailable';
    }
    $('[data-updated]').textContent = lastAt ? 'Updated ' + lastAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  }

  // ---------- devices ----------
  function renderDevices() {
    const box = $('[data-devices]');
    const dv = devicesValue();
    if (dv.loading) { box.innerHTML = '<p class="empty-state">Reading the neighbour table.</p>'; return; }
    if (dv.error) { box.innerHTML = `<p class="empty-state">Could not list devices: ${esc(dv.error)}</p>`; return; }
    if (!dv.list.length) {
      box.innerHTML = '<p class="empty-state">No other devices have been seen yet. Open a web page or wait a minute so devices talk on the network, then press Refresh.</p>';
      return;
    }
    let list = dv.list.slice();
    if (filter === 'named') list = list.filter((d) => d.hostname);
    if (filter === 'unknown') list = list.filter((d) => !d.vendor);
    if (filter === 'random') list = list.filter((d) => d.randomizedMac);
    list = list.filter((d) => matches([deviceName(d), d.ip, d.vendor, d.mac, d.hostname].join(' ')));
    list.sort((a, b) => (b.isGateway - a.isGateway) || (b.isThisComputer - a.isThisComputer) || ipToNum(a.ip) - ipToNum(b.ip));
    if (!list.length) {
      box.innerHTML = '<p class="empty-state">No devices match this filter.</p>';
      return;
    }
    box.innerHTML = `
      <div class="dv-table" role="table" aria-label="Devices">
        <div class="dv-tr dv-th" role="row">
          <span role="columnheader">Device</span><span role="columnheader">IP</span><span role="columnheader">Vendor</span><span role="columnheader">MAC</span>
        </div>
        ${list.map((d) => `
          <div class="dv-tr${d.isGateway ? ' is-gw' : ''}${d.isThisComputer ? ' is-me' : ''}" role="row">
            <span class="dv-name" role="cell">
              <span class="dv-ic" aria-hidden="true">${icon(d.isGateway ? 'gateway' : d.isThisComputer ? 'me' : d.randomizedMac ? 'phone' : 'device')}</span>
              <span class="dv-name-t">
                <b>${esc(deviceName(d))}</b>
                <span class="dv-badges">
                  ${d.isGateway ? '<span class="pill pill--sky">Gateway</span>' : ''}
                  ${d.isThisComputer ? '<span class="pill pill--ok">This computer</span>' : ''}
                  ${d.randomizedMac ? '<span class="pill pill--info" title="This device uses a private, randomized hardware address, so the maker cannot be identified.">Randomized MAC</span>' : ''}
                </span>
              </span>
            </span>
            <span class="dv-mono dv-ip" role="cell"><span class="dv-label">IP</span>${esc(d.ip || 'unknown')}</span>
            <span role="cell" class="dv-vendor${d.vendor ? '' : ' dv-unknown'}"><span class="dv-label">Vendor</span>${esc(d.vendor || 'unknown')}</span>
            <span class="dv-mono dv-mac" role="cell"><span class="dv-label">MAC</span>${esc(d.mac || 'unknown')}</span>
          </div>`).join('')}
      </div>
      ${dv.list.some((d) => d.randomizedMac) ? '<p class="dv-fine">Randomized MAC addresses are a privacy feature of modern phones and laptops. They are normal, but they also mean Bastion cannot tell the maker.</p>' : ''}`;
  }

  // ---------- connections ----------
  // Rebuilding the list on each background poll must not drop keyboard focus from a "Show all" button.
  function renderConns() {
    const box = $('[data-conns]');
    const a = document.activeElement;
    const key = a && box.contains(a) && a.dataset ? a.dataset.group : undefined;
    renderConnsInner(box);
    if (key === undefined) return;
    const target = [...box.querySelectorAll('[data-group]')].find((b) => b.dataset.group === key);
    if (target) target.focus();
  }

  function renderConnsInner(box) {
    const cv = connsValue();
    if (cv.loading) { box.innerHTML = '<p class="empty-state">Reading this computer\'s connections.</p>'; return; }
    if (cv.error) { box.innerHTML = `<p class="empty-state">Could not list connections: ${esc(cv.error)}</p>`; return; }
    let list = cv.list.filter((c) => scope(c.remoteIp) !== 'none');
    if (hideLocal) list = list.filter((c) => { const s = scope(c.remoteIp); return s !== 'loopback' && s !== 'lan' && s !== 'multicast'; });
    list = list.filter((c) => matches([c.process, c.pid, c.remoteIp, c.remotePort, c.state, c.local, PORT_NAMES[c.remotePort]].join(' ')));
    if (!list.length) {
      box.innerHTML = `<p class="empty-state">${cv.list.length ? 'No connections match.' + (hideLocal ? ' Local and loopback connections are hidden.' : '') : 'No active connections right now.'}</p>`;
      return;
    }
    const groups = new Map();
    for (const c of list) {
      const key = (c.process || 'Unknown process') + '|' + (c.pid == null ? '' : c.pid);
      if (!groups.has(key)) groups.set(key, { name: c.process || null, pid: c.pid, items: [] });
      groups.get(key).items.push(c);
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1].items.length - a[1].items.length || String(a[1].name).localeCompare(String(b[1].name)));
    const unnamed = list.filter((c) => !c.process).length;
    box.innerHTML = `
      <div class="dv-groups">
        ${sorted.map(([key, g]) => {
          const open = openGroups.has(key);
          const shown = open ? g.items : g.items.slice(0, GROUP_PREVIEW);
          const ext = g.items.filter((c) => scope(c.remoteIp) === 'internet').length;
          return `
            <div class="dv-group">
              <div class="dv-group-h">
                <span class="dv-proc-ic" aria-hidden="true">${esc(String(g.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
                <span class="dv-group-t">
                  <b>${esc(g.name || 'Unknown process')}</b>
                  ${g.pid != null ? `<span class="dv-mono dv-dim">PID ${esc(g.pid)}</span>` : ''}
                </span>
                <span class="nv-tag dv-group-n">${g.items.length} connection${g.items.length === 1 ? '' : 's'}${ext ? ' · ' + ext + ' internet' : ''}</span>
              </div>
              <ul class="dv-conn-list">
                ${shown.map((c) => {
                  const sc = scope(c.remoteIp);
                  const svc = PORT_NAMES[c.remotePort];
                  return `<li class="dv-conn">
                    <span class="dv-proto">${esc(String(c.protocol || '').toUpperCase())}</span>
                    <span class="dv-mono dv-remote">${esc(fmtRemote(c.remoteIp, c.remotePort))}</span>
                    <span class="dv-svc">${esc(svc || '')}</span>
                    <span class="dv-scope" data-scope="${sc}">${sc === 'internet' ? 'Internet' : sc === 'lan' ? 'Local' : sc === 'loopback' ? 'Loopback' : sc === 'multicast' ? 'Multicast' : ''}</span>
                    <span class="dv-state">${esc(c.state || (c.protocol === 'udp' ? 'UDP' : ''))}</span>
                  </li>`;
                }).join('')}
              </ul>
              ${g.items.length > GROUP_PREVIEW ? `<button class="dv-more" type="button" data-group="${esc(key)}">${open ? 'Show fewer' : 'Show all ' + g.items.length}</button>` : ''}
            </div>`;
        }).join('')}
      </div>
      ${unnamed ? `<p class="dv-fine">${unnamed} connection${unnamed === 1 ? ' has' : 's have'} no process name. The system did not say which program owns them. This is common for system services when Bastion runs without admin rights.</p>` : ''}
      <p class="dv-fine">Remote addresses are shown as numbers. This view does not look them up, so listing connections sends nothing off this computer.</p>`;
  }

  // ---------- actions ----------
  async function refreshAll() {
    if (busy) return;
    busy = true;
    paintBusy();
    try {
      const [devs, conns, ov] = await Promise.all([
        api.network.devices().catch((err) => ({ ok: false, error: errText(err) })),
        api.network.connections().catch((err) => ({ ok: false, error: errText(err) })),
        store.get('overview') ? Promise.resolve(null) : api.network.overview().catch(() => null),
      ]);
      if (!alive) return;
      // Only lists go into the shared store; errors stay local to this view.
      devErr = Array.isArray(devs) ? '' : errOf(devs, 'Unexpected answer from the scanner.');
      connErr = Array.isArray(conns) ? '' : errOf(conns, 'Unexpected answer from the system.');
      if (Array.isArray(devs)) store.set('devices', devs);
      else if (store.get('devices') === undefined) store.set('devices', null);
      if (Array.isArray(conns)) store.set('connections', conns);
      else if (store.get('connections') === undefined) store.set('connections', null);
      if (ov) store.set('overview', ov);
      lastAt = new Date();
    } finally {
      busy = false;
      if (alive) { paintBusy(); renderAll(); }
    }
  }

  async function refreshConns() {
    if (connBusy || busy || document.hidden) return;
    connBusy = true;
    try {
      const conns = await api.network.connections();
      if (!alive || !Array.isArray(conns)) return;
      connErr = '';
      store.set('connections', conns);
      lastAt = new Date();
      renderNumerals();
    } catch {
      // A failed background poll is not worth a toast; the next one retries.
    } finally {
      connBusy = false;
    }
  }

  function paintBusy() {
    const b = $('[data-refresh]');
    b.disabled = busy;
    b.textContent = busy ? 'Refreshing' : 'Refresh';
  }

  function setLive(on) {
    live = on;
    if (liveTimer) { clearInterval(liveTimer); liveTimer = 0; }
    if (live) liveTimer = setInterval(refreshConns, 10000);
  }

  $('[data-refresh]').addEventListener('click', refreshAll);
  el.querySelectorAll('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      filter = b.dataset.filter;
      el.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderDevices();
    });
  });
  const search = $('[data-search]');
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderDevices();
    renderConns();
  });
  el.querySelectorAll('[data-toggle]').forEach((t) => {
    t.addEventListener('click', () => {
      let next;
      if (t.dataset.toggle === 'local') { hideLocal = !hideLocal; next = hideLocal; renderConns(); } else { setLive(!live); next = live; if (live) refreshConns(); }
      // Set after any other click handlers (the glow kit may toggle the attribute itself).
      const id = setTimeout(() => { timers.delete(id); t.setAttribute('aria-checked', String(next)); }, 0);
      timers.add(id);
    });
  });
  el.addEventListener('click', (e) => {
    const more = e.target.closest('[data-group]');
    if (!more) return;
    const key = more.dataset.group;
    if (openGroups.has(key)) openGroups.delete(key); else openGroups.add(key);
    renderConns();
  });

  function renderAll() {
    if (!alive) return;
    renderNumerals();
    renderDevices();
    renderConns();
  }

  subs.push(store.on('devices', () => { renderNumerals(); renderDevices(); }));
  subs.push(store.on('connections', () => { renderNumerals(); renderConns(); }));
  subs.push(store.on('overview', () => renderDevices()));

  renderAll();
  upgradeGlow(el, (c) => { if (alive) glowCleanup = c; else c(); });
  if (store.get('devices') == null || store.get('connections') == null) refreshAll();

  return {
    unmount() {
      alive = false;
      if (glowCleanup) glowCleanup();
      setLive(false);
      for (const id of timers) clearTimeout(id);
      for (const off of subs) if (typeof off === 'function') off();
      el.innerHTML = '';
    },
  };
}
