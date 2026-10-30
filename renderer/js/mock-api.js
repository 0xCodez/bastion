// Browser-preview stand-in for window.bastion. Sample data lives ONLY here.
// It implements the full surface from docs/CONTRACT.md with realistic timing so the
// UI can be developed and reviewed without Electron. Never imported inside the app.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (ms, spread = 0.25) => ms * (1 - spread + Math.random() * spread * 2);
const clone = (v) => JSON.parse(JSON.stringify(v));

const GATEWAY_IP = '192.168.1.1';
const THIS_IP = '192.168.1.23';
const SSID = 'HomeNet-5G';

/* ------------------------------------------------------------------ network */

const overview = {
  hostname: 'MacBook-Pro',
  local: { ip: THIS_IP, iface: 'en0', mac: 'a4:83:e7:2c:91:5e', macRandomized: false },
  gateway: { ip: GATEWAY_IP, mac: '30:b5:c2:4a:10:7f', vendor: 'TP-Link' },
  publicIp: '89.204.137.66',
  errors: [],
};

const deviceSeed = [
  ['30:b5:c2:4a:10:7f', 'TP-Link', 'router.lan', { isGateway: true }],
  ['a4:83:e7:2c:91:5e', 'Apple', 'MacBook-Pro', { isThisComputer: true }],
  ['f0:18:98:11:42:a0', 'Apple', 'iPhone'],
  ['3c:22:fb:7d:03:19', 'Apple', 'iPad'],
  ['b8:27:eb:5a:c4:02', 'Raspberry Pi', 'pihole'],
  ['18:b4:30:9e:2f:11', 'Nest Labs', null],
  ['44:65:0d:8a:73:5c', 'Amazon', 'echo-kitchen'],
  ['fc:a6:67:01:be:44', 'Amazon', 'fire-tv'],
  ['50:ec:50:3f:9a:12', 'Xiaomi', 'MiBox-S'],
  ['00:17:88:4b:2c:e1', 'Philips Lighting', 'hue-bridge'],
  ['5c:aa:fd:22:8b:30', 'Sonos', 'sonos-living'],
  ['5c:aa:fd:22:8b:44', 'Sonos', 'sonos-bedroom'],
  ['8c:79:f5:61:0d:2e', 'Samsung', 'Galaxy-S23'],
  ['cc:6e:a4:19:77:b3', 'Samsung', '[TV] Samsung Q80'],
  ['24:0a:c4:9d:5e:01', 'Espressif', null],
  ['24:0a:c4:9d:61:7c', 'Espressif', null],
  ['84:f3:eb:2a:00:9b', 'Espressif', 'plug-desk'],
  ['dc:a6:32:08:4f:d2', 'Raspberry Pi', 'octopi'],
  ['98:41:5c:c3:1e:02', 'Nintendo', 'Switch'],
  ['f8:4d:89:70:aa:15', 'Apple', 'Apple-TV'],
  ['64:16:66:2d:9f:48', 'Nest Labs', 'nest-cam'],
  ['00:11:32:8a:4c:77', 'Synology', 'nas'],
  ['ac:bc:32:7e:51:0c', 'Apple', 'Watch'],
  ['70:3a:cb:44:10:e8', 'Google', 'Nest-Mini'],
  ['e4:5f:01:3a:2b:9c', 'Raspberry Pi', null],
  ['3c:5a:b4:9e:0f:61', 'Google', 'Chromecast'],
  ['d8:3a:dd:06:71:c2', 'Intel', 'DESKTOP-7Q2K'],
  ['b0:be:76:3e:52:88', 'TP-Link', 'tapo-c200'],
  ['7a:1e:93:c4:05:d2', null, null, { randomizedMac: true }],
];

const devices = deviceSeed.map(([mac, vendor, hostname, extra = {}], i) => {
  let ip = `192.168.1.${100 + i}`;
  if (extra.isGateway) ip = GATEWAY_IP;
  if (extra.isThisComputer) ip = THIS_IP;
  if (extra.randomizedMac) ip = '192.168.1.57';
  return {
    ip,
    mac,
    vendor,
    randomizedMac: Boolean(extra.randomizedMac),
    isGateway: Boolean(extra.isGateway),
    isThisComputer: Boolean(extra.isThisComputer),
    hostname,
  };
});

const connectionSeed = [
  ['Google Chrome', 4120, 'tcp', '142.250.185.78', 443, 'ESTABLISHED'],
  ['Google Chrome', 4120, 'tcp', '142.250.185.110', 443, 'ESTABLISHED'],
  ['Google Chrome', 4120, 'udp', '172.217.16.142', 443, null],
  ['Google Chrome', 4120, 'tcp', '151.101.1.140', 443, 'ESTABLISHED'],
  ['Google Chrome', 4120, 'tcp', '104.16.132.229', 443, 'ESTABLISHED'],
  ['Slack', 5532, 'tcp', '3.120.88.14', 443, 'ESTABLISHED'],
  ['Slack', 5532, 'tcp', '54.93.211.7', 443, 'ESTABLISHED'],
  ['Spotify', 6011, 'tcp', '35.186.224.25', 443, 'ESTABLISHED'],
  ['Spotify', 6011, 'tcp', '104.199.65.124', 4070, 'ESTABLISHED'],
  ['Dropbox', 712, 'tcp', '162.125.66.18', 443, 'ESTABLISHED'],
  ['Dropbox', 712, 'tcp', '162.125.19.131', 443, 'CLOSE_WAIT'],
  ['apsd', 302, 'tcp', '17.57.146.52', 5223, 'ESTABLISHED'],
  ['identityservicesd', 388, 'tcp', '17.248.211.66', 443, 'ESTABLISHED'],
  ['Microsoft Teams', 7023, 'tcp', '52.112.95.4', 443, 'ESTABLISHED'],
  ['Microsoft Teams', 7023, 'udp', '52.115.223.67', 3478, null],
  ['zoom.us', 6620, 'tcp', '170.114.52.2', 443, 'ESTABLISHED'],
  ['Code Helper', 8810, 'tcp', '140.82.112.25', 443, 'ESTABLISHED'],
  ['Code Helper', 8810, 'tcp', '13.107.42.18', 443, 'TIME_WAIT'],
  ['mDNSResponder', 211, 'udp', '224.0.0.251', 5353, null],
  ['syncthing', 9204, 'tcp', '192.168.1.121', 22000, 'ESTABLISHED'],
  [null, null, 'tcp', '185.199.108.133', 443, 'TIME_WAIT'],
];

function makeConnections() {
  return connectionSeed.map(([process, pid, protocol, remoteIp, remotePort, state]) => ({
    process,
    pid,
    protocol,
    local: `${THIS_IP}:${49152 + Math.floor(Math.random() * 16000)}`,
    remoteIp,
    remotePort,
    state,
  }));
}

/* ------------------------------------------------------------------ scan */

const checkDefs = [
  {
    id: 'tr069',
    title: 'Your provider can reach into your router',
    status: 'risk',
    severity: 'critical',
    evidence: `TCP ${GATEWAY_IP}:7547 open and answering (CWMP / TR-069 management port, HTTP 401).`,
    fix: {
      label: 'Close remote management',
      open: 'router-admin',
      steps: [
        `Open the router admin page (${GATEWAY_IP}) and sign in.`,
        'Find "TR-069", "CWMP", "ACS" or "Remote management" (often under Advanced > System or Administration).',
        'Turn it off and save. If the option is missing, ask your provider to disable remote management.',
        'Run the scan again to confirm port 7547 is closed.',
      ],
    },
  },
  {
    id: 'upnp',
    title: 'Devices can open doors in your router on their own',
    status: 'risk',
    severity: 'high',
    evidence: `UPnP IGD answered at ${GATEWAY_IP}:1900. 3 active port mappings: 3074/udp, 3478/udp, 3479/udp.`,
    fix: {
      label: 'Turn off UPnP',
      open: 'router-admin',
      steps: [
        'Open the router admin page and sign in.',
        'Find "UPnP" (often under Advanced > NAT Forwarding).',
        'Turn it off. If a game console needs open ports, add those exact ports manually instead.',
      ],
    },
  },
  {
    id: 'telnet',
    title: 'Telnet is open on your router',
    status: 'risk',
    severity: 'high',
    evidence: `TCP ${GATEWAY_IP}:23 open. Banner: "BusyBox v1.19.4 built-in shell".`,
    fix: {
      label: 'Disable Telnet',
      open: 'router-admin',
      steps: [
        'Open the router admin page and sign in.',
        'Look for "Telnet" under Administration, System Tools or Services and turn it off.',
        'If there is no switch, update the router firmware; if it stays open, consider replacing the router.',
      ],
    },
  },
  {
    id: 'dns-plaintext',
    title: 'Your lookups go to your provider in plain text',
    status: 'warn',
    severity: 'medium',
    evidence: `DNS server ${GATEWAY_IP} (router, forwards to ISP). No DNS over HTTPS or TLS configured on this computer.`,
    fix: {
      label: 'Switch to encrypted DNS',
      open: 'dns-settings',
      steps: [
        'Open DNS settings for this computer.',
        'Set DNS to 1.1.1.1 and 1.0.0.1 (Cloudflare) or 9.9.9.9 (Quad9).',
        'Turn on encrypted DNS (DNS over HTTPS) if your system offers it.',
      ],
    },
  },
  {
    id: 'admin-default',
    title: 'Router admin password not verified',
    status: 'unknown',
    severity: 'high',
    evidence: `Admin page at http://${GATEWAY_IP} asks for a login. Bastion never tries passwords, so it cannot tell if the factory password is still set.`,
    fix: {
      label: 'Check admin password',
      open: 'router-admin',
      steps: [
        'Open the router admin page.',
        'If the password printed on the router label still works, change it to a long unique one.',
        'Store it in your password manager.',
      ],
    },
  },
  {
    id: 'wps',
    title: 'WPS may be switched on',
    status: 'unknown',
    severity: 'medium',
    evidence: 'WPS state is not visible from this computer without router access.',
    fix: {
      label: 'Check WPS',
      open: 'router-admin',
      steps: ['Open the router admin page.', 'Find "WPS" under Wireless settings and turn it off.'],
    },
  },
  {
    id: 'web-admin-http',
    title: 'Router admin page uses plain HTTP',
    status: 'warn',
    severity: 'medium',
    evidence: `http://${GATEWAY_IP}:80 serves the login form. Nothing answers on 443.`,
    fix: {
      label: 'Enable HTTPS admin',
      open: 'router-admin',
      steps: ['Open the router admin page.', 'Turn on HTTPS for local management if available, and turn off remote (WAN) management.'],
    },
  },
  {
    id: 'unknown-devices',
    title: 'A new device joined with a hidden identity',
    status: 'warn',
    severity: 'medium',
    evidence: '192.168.1.57 uses a randomized MAC (7a:1e:93:c4:05:d2), no vendor, first seen today.',
    fix: {
      label: 'Review devices',
      steps: ['Open Devices and check who owns 192.168.1.57.', 'Phones with private Wi-Fi addresses look like this; if nobody recognises it, change the Wi-Fi password.'],
    },
  },
  {
    id: 'location-map',
    title: 'Your Wi-Fi can be used to locate your home',
    status: 'warn',
    severity: 'low',
    evidence: `SSID "${SSID}" does not end with _nomap, so public location services may record it.`,
    fix: {
      label: 'Add _nomap',
      open: 'router-admin',
      steps: [`Rename the network to "${SSID}_nomap" in the router Wireless settings.`, 'Reconnect your devices to the new name.'],
    },
  },
  {
    id: 'mac-privacy',
    title: 'This Mac uses its real hardware address',
    status: 'warn',
    severity: 'low',
    evidence: 'en0 a4:83:e7:2c:91:5e is a factory (globally unique) address.',
    fix: {
      label: 'Turn on private address',
      open: 'mac-privacy',
      steps: ['Open Wi-Fi settings, select this network, and set Private Wi-Fi address to Rotating or Fixed.'],
    },
  },
  {
    id: 'ssh',
    title: 'SSH is closed on your router',
    status: 'ok',
    severity: 'info',
    evidence: `TCP ${GATEWAY_IP}:22 closed.`,
    fix: null,
  },
  {
    id: 'wifi-security',
    title: 'Wi-Fi encryption is strong',
    status: 'ok',
    severity: 'info',
    evidence: 'WPA2 Personal (AES-CCMP) on 5 GHz.',
    fix: null,
  },
];

const SCORE = 41;

/* ------------------------------------------------------------------ wifi */

const wifiInfo = {
  supported: true,
  ssid: SSID,
  bssid: '30:b5:c2:4a:10:80',
  band: '5',
  channel: 36,
  widthMHz: 80,
  rssi: -61,
  signalPct: 72,
  rxMbps: 866,
  txMbps: 780,
  security: 'WPA2 Personal',
  nomap: false,
  errors: [],
};

const surveyNetworks = [
  { ssid: SSID, bssid: '30:b5:c2:4a:10:80', channel: 36, band: '5', signalPct: 72, rssi: -61 },
  { ssid: 'FRITZ!Box 7590 KL', bssid: '2c:91:ab:10:44:02', channel: 36, band: '5', signalPct: 48, rssi: -74 },
  { ssid: 'Vodafone-4C2A', bssid: '9c:c7:a6:2e:10:4a', channel: 36, band: '5', signalPct: 41, rssi: -77 },
  { ssid: 'DIRECT-7F-HP OfficeJet', bssid: '86:2a:fd:7f:19:22', channel: 36, band: '5', signalPct: 37, rssi: -79 },
  { ssid: 'o2-WLAN81', bssid: 'e0:28:6d:3b:01:9e', channel: 40, band: '5', signalPct: 33, rssi: -81 },
  { ssid: 'Telekom_FON', bssid: '62:91:ab:10:44:05', channel: 36, band: '5', signalPct: 44, rssi: -76 },
  { ssid: 'MagentaWLAN-8K1P', bssid: '60:31:97:aa:42:01', channel: 44, band: '5', signalPct: 30, rssi: -82 },
  { ssid: 'TP-Link_2F90', bssid: '50:c7:bf:1e:2f:90', channel: 48, band: '5', signalPct: 28, rssi: -83 },
  { ssid: 'HomeNet', bssid: '30:b5:c2:4a:10:7f', channel: 6, band: '2.4', signalPct: 80, rssi: -55 },
  { ssid: 'FRITZ!Box 7590 KL', bssid: '2c:91:ab:10:44:01', channel: 1, band: '2.4', signalPct: 52, rssi: -72 },
  { ssid: 'Vodafone-4C2A', bssid: '9c:c7:a6:2e:10:49', channel: 6, band: '2.4', signalPct: 46, rssi: -75 },
  { ssid: 'EasyBox-221943', bssid: 'a0:66:10:22:19:43', channel: 11, band: '2.4', signalPct: 35, rssi: -80 },
];

const survey = {
  supported: true,
  networks: surveyNetworks,
  congestion: [
    { channel: 36, band: '5', count: 7 },
    { channel: 40, band: '5', count: 1 },
    { channel: 44, band: '5', count: 1 },
    { channel: 48, band: '5', count: 1 },
    { channel: 149, band: '5', count: 0 },
    { channel: 1, band: '2.4', count: 1 },
    { channel: 6, band: '2.4', count: 1 },
    { channel: 11, band: '2.4', count: 1 },
  ],
  current: { channel: 36, band: '5' },
  recommendation: {
    channel: 149,
    band: '5',
    reason: 'Channel 36 overlaps with 7 nearby networks at 80 MHz. Channel 149 has none in range.',
    neighboursNow: 7,
    neighboursThere: 0,
  },
  errors: [],
};

const dnsStatus = {
  servers: [GATEWAY_IP],
  gatewayIsResolver: true,
  encrypted: false,
  provider: 'ISP / router',
  errors: [],
};

/* ------------------------------------------------------------------ agents */

const providers = [
  { id: 'claude', name: 'Claude', hasKey: true, model: 'claude-sonnet-4-5', models: ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'] },
  { id: 'openai', name: 'ChatGPT', hasKey: false, model: 'gpt-5', models: ['gpt-5', 'gpt-5-mini'] },
  { id: 'grok', name: 'Grok', hasKey: false, model: 'grok-4', models: ['grok-4', 'grok-4-fast'] },
  // Subscription CLIs: the browser preview cannot look for them, so they show as not installed.
  {
    id: 'claude-cli', name: 'Claude (my subscription)', kind: 'cli', hasKey: false, model: 'default', models: ['default', 'opus', 'sonnet', 'haiku'],
    cli: { installed: false, ready: false, version: null, loggedIn: null, path: null, authMethod: null, product: 'Claude Code', installCommand: 'npm install -g @anthropic-ai/claude-code', loginCommand: 'claude auth login', error: "Claude Code isn't installed. Install it with: npm install -g @anthropic-ai/claude-code", note: null },
  },
  {
    id: 'codex-cli', name: 'ChatGPT (my subscription)', kind: 'cli', hasKey: false, model: 'default', models: ['default'],
    cli: { installed: false, ready: false, version: null, loggedIn: null, path: null, authMethod: null, product: 'Codex', installCommand: 'npm install -g @openai/codex', loginCommand: 'codex login', error: "Codex isn't installed. Install it with: npm install -g @openai/codex", note: null },
  },
];

function findProvider(id) {
  return providers.find((p) => p.id === id);
}

function mockAnswer(question, snap) {
  const q = String(question || '').toLowerCase();
  const scan = snap && snap.scan;
  const risks = scan && Array.isArray(scan.checks) ? scan.checks.filter((c) => c.status === 'risk') : [];
  const wifi = snap && snap.wifi;
  const rec = snap && snap.survey && snap.survey.recommendation;
  const speed = snap && snap.speed;
  const deviceCount = snap && snap.devices ? snap.devices.count : null;

  const lines = [];
  if (/wifi|wi-fi|slow|speed|channel/.test(q)) {
    if (wifi && wifi.channel) lines.push(`You are on channel ${wifi.channel} (${wifi.band} GHz) at ${wifi.signalPct}% signal.`);
    if (rec) lines.push(`${rec.neighboursNow} neighbouring networks share that channel. Moving to channel ${rec.channel} puts you next to ${rec.neighboursThere}, which should cut retries in the evening.`);
    if (speed) lines.push(`Your last test measured ${Math.round(speed.downMbps)} down / ${Math.round(speed.upMbps)} up at ${Math.round(speed.pingMs)} ms.`);
    lines.push('Proposed action: change the 5 GHz channel in the router admin page, then rerun the speed test.');
  } else if (/device|who|unknown|new/.test(q)) {
    lines.push(`I can see ${deviceCount ?? 'several'} devices on your network.`);
    lines.push('One of them, 192.168.1.57, uses a randomized MAC and no hostname. That is usually a phone with Private Wi-Fi Address turned on, but nobody has claimed it yet.');
    lines.push('Proposed action: check which phones joined today. If nobody recognises it, change the Wi-Fi password.');
  } else {
    if (risks.length) {
      lines.push(`${risks.length} things on your router are open that should not be:`);
      risks.slice(0, 3).forEach((c, i) => lines.push(`${i + 1}. ${c.title} (${c.evidence})`));
      lines.push('The most urgent is the TR-069 port 7547: it lets whoever runs the management server push settings and firmware to your router.');
      lines.push('Proposed action: open the router admin page and turn off remote management (TR-069 / CWMP) and UPnP. I will rescan afterwards to confirm.');
    } else {
      lines.push('Nothing on the last scan looks open. Keep the admin password long and unique and rescan after firmware updates.');
    }
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ events */

function emitter() {
  const subs = new Set();
  return {
    emit(payload) {
      for (const cb of [...subs]) {
        try { cb(payload); } catch (err) { console.error(err); }
      }
    },
    on(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

const scanEvents = emitter();
const speedEvents = emitter();
let speedCancelled = false;
let speedRunning = null;

async function runScan() {
  const startedAt = new Date().toISOString();
  const total = checkDefs.length;
  for (let i = 0; i < total; i += 1) {
    const c = checkDefs[i];
    scanEvents.emit({ index: i, total, id: c.id, title: c.title });
    await wait(jitter(500));
    scanEvents.emit({ index: i, total, id: c.id, title: c.title, status: c.status });
  }
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    score: SCORE,
    checks: clone(checkDefs),
    upnpMappings: [
      { protocol: 'UDP', externalPort: 3074, internalClient: '192.168.1.118', internalPort: 3074, description: 'Xbox' },
      { protocol: 'UDP', externalPort: 3478, internalClient: '192.168.1.118', internalPort: 3478, description: 'PSN' },
      { protocol: 'UDP', externalPort: 3479, internalClient: '192.168.1.118', internalPort: 3479, description: 'PSN' },
    ],
    openPorts: [
      { port: 23, service: 'telnet' },
      { port: 53, service: 'dns' },
      { port: 80, service: 'http' },
      { port: 1900, service: 'upnp' },
      { port: 7547, service: 'cwmp (TR-069)' },
    ],
    errors: [],
  };
}

async function runSpeed() {
  speedCancelled = false;
  const at = new Date().toISOString();
  const errors = [];
  const pingTarget = 14 + Math.random() * 4;
  const downTarget = 290 + Math.random() * 40;
  const upTarget = 38 + Math.random() * 8;

  // Ping: ~1 s
  for (let i = 1; i <= 5; i += 1) {
    if (speedCancelled) break;
    await wait(200);
    speedEvents.emit({ phase: 'ping', pingMs: pingTarget + (Math.random() - 0.5) * 6, progress: (i / 5) * 0.1 });
  }
  // Download: ~3.5 s, ramps up then settles
  for (let i = 1; i <= 18 && !speedCancelled; i += 1) {
    await wait(195);
    const ramp = 1 - Math.exp(-i / 4);
    speedEvents.emit({ phase: 'download', mbps: downTarget * ramp * (0.94 + Math.random() * 0.12), progress: 0.1 + (i / 18) * 0.5 });
  }
  // Upload: ~3.5 s
  for (let i = 1; i <= 18 && !speedCancelled; i += 1) {
    await wait(195);
    const ramp = 1 - Math.exp(-i / 3);
    speedEvents.emit({ phase: 'upload', mbps: upTarget * ramp * (0.92 + Math.random() * 0.16), progress: 0.6 + (i / 18) * 0.4 });
  }
  if (speedCancelled) errors.push('Cancelled');
  speedEvents.emit({ phase: 'done', progress: 1 });
  return {
    pingMs: Math.round(pingTarget * 10) / 10,
    jitterMs: Math.round((2 + Math.random() * 2) * 10) / 10,
    downMbps: speedCancelled ? 0 : Math.round(downTarget * 10) / 10,
    upMbps: speedCancelled ? 0 : Math.round(upTarget * 10) / 10,
    server: 'Cloudflare (sample)',
    at,
    errors,
  };
}

/* ------------------------------------------------------------------ surface */

const mock = {
  platform: 'browser-mock',
  version: '0.1.0-preview',

  network: {
    async overview() { await wait(jitter(350)); return clone(overview); },
    async devices() { await wait(jitter(900)); return clone(devices); },
    async connections() { await wait(jitter(300)); return makeConnections(); },
    scan: () => runScan(),
    onScanProgress: (cb) => scanEvents.on(cb),
  },

  wifi: {
    async info() {
      await wait(jitter(250));
      const info = clone(wifiInfo);
      info.rssi = -61 + Math.round((Math.random() - 0.5) * 4);
      info.signalPct = Math.max(0, Math.min(100, 2 * (info.rssi + 100) - 6));
      return info;
    },
    async survey() { await wait(jitter(1400)); return clone(survey); },
  },

  dns: {
    async status() { await wait(jitter(200)); return clone(dnsStatus); },
  },

  speed: {
    run() {
      if (!speedRunning) speedRunning = runSpeed().finally(() => { speedRunning = null; });
      return speedRunning;
    },
    async cancel() { speedCancelled = true; },
    onProgress: (cb) => speedEvents.on(cb),
  },

  fix: {
    async open(target) {
      await wait(120);
      console.info('[mock] fix.open', target);
      return { ok: ['router-admin', 'dns-settings', 'wifi-settings', 'mac-privacy'].includes(target) };
    },
  },

  app: {
    async openExternal(url) {
      if (typeof url === 'string' && url.startsWith('https://')) window.open(url, '_blank', 'noopener');
    },
  },

  agents: {
    async providers() { await wait(80); return clone(providers); },
    async setKey(id, key) {
      await wait(300);
      const p = findProvider(id);
      if (!p) return { ok: false, error: 'Unknown provider' };
      if (p.kind === 'cli') return { ok: false, error: `${p.name} uses your ${p.cli.product} login, not an API key.` };
      if (typeof key !== 'string' || key.trim().length < 12) return { ok: false, error: 'That does not look like an API key.' };
      p.hasKey = true;
      return { ok: true };
    },
    async clearKey(id) {
      const p = findProvider(id);
      if (p && p.kind === 'cli') return { ok: false, error: `${p.name} has no API key.` };
      if (p) p.hasKey = false;
      return { ok: true };
    },
    async setModel(id, model) {
      const p = findProvider(id);
      if (!p || !p.models.includes(model)) return { ok: false };
      p.model = model;
      return { ok: true };
    },
    async test(id) {
      await wait(jitter(900));
      const p = findProvider(id);
      if (!p) return { ok: false, error: 'Unknown provider' };
      if (p.kind === 'cli' && !p.hasKey) return { ok: false, model: p.model, error: p.cli.error };
      if (!p.hasKey) return { ok: false, error: `No ${p.name} key saved.` };
      return { ok: true, model: p.model };
    },
    async cancel() { return { ok: true, cancelled: false }; },
    async ask(id, question, snapshot) {
      await wait(jitter(1500, 0.15));
      const p = findProvider(id);
      if (!p) return { ok: false, provider: String(id), model: '', text: '', error: 'Unknown provider' };
      if (p.kind === 'cli' && !p.hasKey) return { ok: false, provider: p.id, model: p.model, text: '', error: p.cli.error };
      if (!p.hasKey) return { ok: false, provider: p.id, model: p.model, text: '', error: `No ${p.name} key saved. Add one in Settings.` };
      return { ok: true, provider: p.id, model: p.model, text: mockAnswer(question, snapshot) };
    },
  },

  // The browser preview cannot read installed apps, so every icon is unknown and the UI shows monograms.
  icons: {
    async forProcesses(list) {
      const processes = {};
      for (const item of Array.isArray(list) ? list : []) if (item && item.pid != null) processes[item.pid] = { exe: null, product: null, description: null };
      return { processes, icons: {} };
    },
    async providers() { return { claude: null, openai: null, grok: null }; },
  },

  // Tips and feedback. Nothing is sent and no checkout opens in the preview.
  support: {
    async tipsProfile() {
      await wait(jitter(450));
      return {
        ok: true,
        profile: { name: 'Beyond Apps', tagline: 'Independent, ad-free apps', currency: 'usd', presets: [3, 5, 10, 25], min: 1, max: 500, supporterCount: 1284 },
      };
    },
    async startTip(req) {
      await wait(jitter(700));
      const amount = req && req.amount;
      if (typeof amount !== 'number' || !Number.isFinite(amount)) return { ok: false, error: 'Please choose an amount.' };
      if (amount < 1 || amount > 500) return { ok: false, error: 'Please choose an amount between 1 and 500 USD.' };
      console.info('[mock] support.startTip', req);
      return { ok: true, url: 'https://checkout.stripe.com/c/pay/sample' };
    },
    async sendFeedback(payload) {
      await wait(jitter(800));
      const kinds = ['idea', 'bug', 'love'];
      const message = payload && typeof payload.message === 'string' ? payload.message.trim() : '';
      if (!payload || !kinds.includes(payload.kind)) return { ok: false, error: 'Please pick what kind of feedback this is.' };
      if (message.length < 3) return { ok: false, error: 'Please write a little more so we know what you mean.' };
      if (message.length > 2000) return { ok: false, error: 'That message is a bit long. Please keep it under 2000 characters.' };
      if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.email).trim())) return { ok: false, error: 'That email address does not look right.' };
      console.info('[mock] support.sendFeedback', payload);
      return { ok: true, via: 'email', message: 'Preview only: in the app your mail app opens with the message ready to send.' };
    },
    async systemInfo() {
      return { ok: true, system: { platform: 'darwin', arch: 'arm64', osVersion: 'Darwin 24.1.0 (sample)', appVersion: '0.1.0-preview' } };
    },
  },

  // Push-to-talk: the browser asks for the microphone itself.
  voice: {
    async ensureMicAccess() { return { granted: true, status: 'unknown' }; },
  },
};

export default mock;
