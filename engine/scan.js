'use strict';

const { isWin, isMac, errMsg } = require('./util');
const { defaultRoute, wifiAdapter } = require('./system');
const { devices } = require('./devices');
const { probeGateway } = require('./ports');
const { upnpStatus } = require('./upnp');
const { dnsStatus } = require('./dns');

// Loaded lazily so a missing or broken Wi-Fi module never breaks the scan.
function wifiModule() {
  try {
    return require('./wifi');
  } catch {
    return null;
  }
}

// Order is part of the contract (ScanProgress.index).
const CHECKS = [
  { id: 'tr069', title: 'Provider remote access (TR-069)' },
  { id: 'upnp', title: 'Automatic port opening (UPnP)' },
  { id: 'dns-plaintext', title: 'Who can read your DNS lookups' },
  { id: 'admin-default', title: 'Router admin password' },
  { id: 'wps', title: 'WPS PIN on the router' },
  { id: 'telnet', title: 'Telnet on the router' },
  { id: 'ssh', title: 'SSH on the router' },
  { id: 'web-admin-http', title: 'Router admin page encryption' },
  { id: 'location-map', title: 'Wi-Fi location mapping' },
  { id: 'mac-privacy', title: 'Wi-Fi MAC address privacy' },
  { id: 'wifi-security', title: 'Wi-Fi encryption' },
  { id: 'unknown-devices', title: 'Unidentified devices on your network' },
];

const WEIGHTS = { critical: 30, high: 15, medium: 8, low: 3, info: 0 };

const ROUTER_LOGIN_STEP = (gw) =>
  `Open the router admin page${gw ? ` (http://${gw}/)` : ''} and sign in. The address and password are usually on a sticker on the router.`;

function check(id, status, severity, evidence, fix = null, title = null) {
  const def = CHECKS.find((c) => c.id === id);
  return { id, title: title || def.title, status, severity, evidence, fix };
}

function scoreOf(checks) {
  let score = 100;
  for (const c of checks) {
    const w = WEIGHTS[c.severity] || 0;
    if (c.status === 'risk') score -= w;
    else if (c.status === 'warn') score -= w / 2;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------- individual checks ----------

// True when the router answered none of the probes (every port timed out or was unreachable).
// Then "not open" proves nothing: a VPN kill-switch, client isolation or a drop-all firewall looks the same.
function routerSilent(ports) {
  const states = Object.values((ports && ports.results) || {});
  return states.length > 0 && states.every((s) => s === 'filtered');
}
const SILENT_EVIDENCE = (gw) =>
  `The router (${gw}) did not answer any connection attempt from this computer, so Bastion cannot tell which of its ports are open. ` +
  'A VPN, Wi-Fi client isolation or a firewall that drops all traffic to the router can cause this.';

function checkTr069(ctx) {
  const { gw, ports } = ctx;
  if (!gw || !ports) return check('tr069', 'unknown', 'critical', 'The router address is unknown, so the provider management port could not be tested.');
  if (routerSilent(ports)) return check('tr069', 'unknown', 'critical', SILENT_EVIDENCE(gw));
  const open = [7547, 4567, 30005].filter((p) => ports.results[p] === 'open');
  if (!open.length) {
    return check('tr069', 'ok', 'critical',
      `TCP ${gw}:7547, 4567 and 30005 do not answer on your local network. This test runs from inside your network, so it cannot prove what the router allows from the internet side.`,
      null, 'Provider management port is closed');
  }
  const p = open[0];
  return check('tr069', 'risk', 'critical',
    `TCP ${gw}:${p} answers on your local network. This is the TR-069/CWMP remote-management port your provider uses to change router settings and firmware. ` +
      'Bastion cannot prove from inside your network whether it is also reachable from the internet; providers normally keep it reachable for themselves.' +
      (open.length > 1 ? ` Also open: ${open.slice(1).join(', ')}.` : ''),
    {
      label: 'Turn off provider remote management',
      steps: [
        ROUTER_LOGIN_STEP(gw),
        'Look for a section called TR-069, CWMP, Remote management, ACS or "Provider settings" (often under Advanced, System or Management).',
        'Disable it and save, if the router allows it.',
        'If your provider locks this setting, put your own router behind the provider box (provider box in bridge mode, or your router plugged into it) so the provider can only manage its own device.',
        'Run the scan again to confirm the port no longer answers.',
      ],
      open: 'router-admin',
    },
    'Your provider can reach your router');
}

function checkUpnp(ctx) {
  const { upnp, gw } = ctx;
  if (!upnp) return check('upnp', 'unknown', 'high', 'The UPnP check could not run.');
  const steps = [
    ROUTER_LOGIN_STEP(gw),
    'Find UPnP (usually under Advanced, NAT forwarding or Network).',
    'Turn it off and save. Games or apps that need open ports can be given manual port-forwarding rules instead.',
  ];
  if (!upnp.found) {
    return check('upnp', 'ok', 'medium', 'No UPnP Internet Gateway Device answered on the local network within 2.5 seconds, so apps cannot open router ports automatically.', null, 'UPnP port opening is off');
  }
  const who = [upnp.manufacturer, upnp.modelName].filter(Boolean).join(' ') || upnp.friendlyName || 'Your router';
  if (upnp.mappings.length) {
    const list = upnp.mappings.slice(0, 8)
      .map((m) => `${m.protocol} ${m.externalPort} -> ${m.internalClient}:${m.internalPort}${m.description ? ` (${m.description})` : ''}`)
      .join('; ');
    return check('upnp', 'warn', 'high',
      `${who} accepts UPnP requests and currently has ${upnp.mappings.length} port${upnp.mappings.length === 1 ? '' : 's'} opened to the internet by devices on your network: ${list}${upnp.mappings.length > 8 ? '; ...' : ''}.`,
      { label: 'Turn off UPnP', steps, open: 'router-admin' },
      'Devices have opened ports to the internet');
  }
  const now = upnp.mappingsReadable === false
    ? `The router would not list its current port openings (${upnp.mappingsProblem}), so Bastion cannot tell whether any are open right now.`
    : 'No ports are open through it right now.';
  return check('upnp', 'warn', 'medium',
    `${who} accepts UPnP requests (${upnp.location}). ${now} Any app or infected device on your network can open a port to the internet without asking.`,
    { label: 'Turn off UPnP', steps, open: 'router-admin' },
    'Any device can open ports on your router');
}

function checkDns(ctx) {
  const { dns } = ctx;
  if (!dns || !dns.servers.length) return check('dns-plaintext', 'unknown', 'high', 'The DNS servers for this connection could not be read.');
  const servers = dns.servers.join(', ');
  const steps = isMac
    ? [
        'Open System Settings > Network, select your connection, then Details > DNS.',
        'Replace the servers with a privacy-focused resolver such as 1.1.1.1 and 1.0.0.1 (Cloudflare) or 9.9.9.9 (Quad9).',
        'For encryption, install that provider\'s encrypted DNS profile from its website (Cloudflare and Quad9 publish one), or turn on Secure DNS in your browser.',
      ]
    : [
        'Open Settings > Network & internet, choose your connection, then Hardware properties > DNS server assignment > Edit.',
        'Switch to Manual, turn on IPv4 and enter 1.1.1.1 / 1.0.0.1 (Cloudflare) or 9.9.9.9 / 149.112.112.112 (Quad9).',
        'Set DNS over HTTPS to "On (automatic template)" for both servers and save.',
      ];
  const fix = { label: 'Switch to encrypted DNS', steps, open: 'dns-settings' };
  if (dns.encrypted === true) {
    return check('dns-plaintext', 'ok', 'high', `DNS goes to ${servers} (${dns.provider}) over an encrypted connection.`, null, 'Your DNS lookups are encrypted');
  }
  if (dns.gatewayIsResolver && dns.encrypted === false) {
    return check('dns-plaintext', 'risk', 'high',
      `This computer sends every website name it looks up to ${servers} (your router, which forwards to your provider) without encryption. Your provider can log and alter these lookups.`,
      fix, 'Your provider sees every site you visit');
  }
  const how = dns.encrypted === false ? 'without encryption' : 'and Bastion cannot confirm whether the lookups are encrypted';
  return check('dns-plaintext', 'warn', dns.gatewayIsResolver ? 'high' : 'medium',
    `DNS goes to ${servers} (${dns.provider || 'unknown provider'}) ${how}.${dns.note ? ` ${dns.note}` : ''}`,
    fix, 'Your DNS lookups may be readable');
}

function checkAdminDefault(ctx) {
  const { gw, ports } = ctx;
  const plainHttp = ports && ports.results[80] === 'open' && ports.results[443] !== 'open';
  return check('admin-default', 'unknown', 'medium',
    'Bastion never tries passwords on your router, so it cannot tell whether the factory password is still set.' +
      (plainHttp ? ` The admin page at http://${gw}/ is plain HTTP, so the password also travels unencrypted on your network.` : ''),
    {
      label: 'Change the router admin password',
      steps: [
        ROUTER_LOGIN_STEP(gw),
        'Find Administration, System or Management > Password.',
        'Set a long unique password (a password manager can generate one). Do not reuse the one on the sticker or your Wi-Fi password.',
        'If the router offers remote/WAN administration, turn it off.',
      ],
      open: 'router-admin',
    },
    'Router admin password not verified');
}

function checkWps(ctx) {
  return check('wps', 'unknown', 'medium',
    'Whether WPS is on can only be seen in the router settings. The WPS PIN can be brute-forced in hours on many routers.',
    {
      label: 'Turn off WPS',
      steps: [
        ROUTER_LOGIN_STEP(ctx.gw),
        'Find WPS (usually under Wireless or Wi-Fi settings).',
        'Turn WPS off completely, or at least disable the PIN method, and save. Connect new devices with the Wi-Fi password instead.',
      ],
      open: 'router-admin',
    },
    'WPS status not verified');
}

function portCheck(ctx, id, port, openStatus, severity, openTitle, okTitle, openEvidence, fix) {
  const { gw, ports } = ctx;
  if (!gw || !ports) return check(id, 'unknown', severity, 'The router address is unknown, so this port could not be tested.');
  if (routerSilent(ports)) return check(id, 'unknown', severity, SILENT_EVIDENCE(gw));
  if (ports.results[port] === 'open') return check(id, openStatus, severity, openEvidence(gw), fix, openTitle);
  return check(id, 'ok', severity, `TCP ${gw}:${port} does not answer.`, null, okTitle);
}

function checkTelnet(ctx) {
  return portCheck(ctx, 'telnet', 23, 'risk', 'high', 'Telnet is open on your router', 'Telnet is closed',
    (gw) => `TCP ${gw}:23 answers. Telnet sends the router password unencrypted and is a favourite target of router botnets such as Mirai.`,
    {
      label: 'Turn off Telnet',
      steps: [ROUTER_LOGIN_STEP(ctx.gw), 'Find Telnet (often under System, Management or Remote access).', 'Disable it and save. If there is no switch, ask your provider or update the firmware.'],
      open: 'router-admin',
    });
}

function checkSsh(ctx) {
  return portCheck(ctx, 'ssh', 22, 'warn', 'low', 'SSH is open on your router', 'SSH is closed',
    (gw) => `TCP ${gw}:22 answers. SSH is encrypted, but it is one more login that can be guessed if the password is weak.`,
    {
      label: 'Turn off SSH if you do not use it',
      steps: [ROUTER_LOGIN_STEP(ctx.gw), 'Find SSH or Remote access in the management settings.', 'Disable it, or make sure it uses a strong unique password and is not reachable from the internet.'],
      open: 'router-admin',
    });
}

function checkWebAdmin(ctx) {
  const { gw, ports } = ctx;
  if (!gw || !ports) return check('web-admin-http', 'unknown', 'medium', 'The router address is unknown, so the admin page could not be tested.');
  if (routerSilent(ports)) return check('web-admin-http', 'unknown', 'medium', SILENT_EVIDENCE(gw));
  const http = ports.results[80] === 'open';
  const https = ports.results[443] === 'open';
  if (http && !https) {
    return check('web-admin-http', 'warn', 'medium',
      `The router admin page answers on http://${gw}/ (TCP 80) and not on HTTPS (TCP 443), so the admin password crosses your network unencrypted.`,
      {
        label: 'Use the admin page only over a wired or trusted connection',
        steps: [
          ROUTER_LOGIN_STEP(gw),
          'If the router has an option for HTTPS management, turn it on and use https:// from now on.',
          'Otherwise change router settings only from a computer you trust, and never with guests on your Wi-Fi.',
        ],
        open: 'router-admin',
      },
      'Router admin page is not encrypted');
  }
  if (https) return check('web-admin-http', 'ok', 'medium', `The router admin page answers over HTTPS (TCP ${gw}:443).`, null, 'Router admin page supports HTTPS');
  return check('web-admin-http', 'ok', 'medium', `No admin page answers on TCP ${gw}:80 or 443.`, null, 'No plain-HTTP admin page found');
}

function checkLocationMap(ctx) {
  const ssid = ctx.wifi && ctx.wifi.ssid;
  if (!ssid) return check('location-map', 'unknown', 'low', 'The Wi-Fi network name is not available (not connected over Wi-Fi, or the system hides it).');
  const lower = ssid.toLowerCase();
  if (lower.endsWith('_nomap') || lower.includes('_optout')) {
    return check('location-map', 'ok', 'low', `Network "${ssid}" opts out of location mapping.`, null, 'Your Wi-Fi is not used to map your home');
  }
  return check('location-map', 'warn', 'low',
    `Network "${ssid}" does not end in _nomap, so phones passing by report its address to location databases that pin it to your home.`,
    {
      label: 'Opt your Wi-Fi out of location mapping',
      steps: [
        ROUTER_LOGIN_STEP(ctx.gw),
        `Rename the Wi-Fi network so the name ends in _nomap, for example "${ssid.slice(0, 26)}_nomap". Google and Apple honour this.`,
        'Reconnect your devices to the renamed network (the password stays the same).',
      ],
      open: 'router-admin',
    },
    'Your Wi-Fi helps map your home location');
}

function checkMacPrivacy(ctx) {
  const a = ctx.wifiAdapter;
  if (!a || !a.connected || !a.mac) return check('mac-privacy', 'unknown', 'low', 'This computer is not connected over Wi-Fi, so its Wi-Fi address could not be checked.');
  if (a.randomized) return check('mac-privacy', 'ok', 'low', `This computer uses a private (randomized) Wi-Fi address ${a.mac}.`, null, 'This computer uses a private Wi-Fi address');
  const steps = isWin
    ? ['Open Settings > Network & internet > Wi-Fi.', 'Turn on "Random hardware addresses" (and for this network under its properties, choose On or Change daily).', 'Reconnect to the network.']
    : ['Open System Settings > Wi-Fi and click Details next to your network.', 'Set "Private Wi-Fi address" to Fixed or Rotating.', 'Reconnect to the network.'];
  return check('mac-privacy', 'warn', 'low',
    `This computer connects with its factory Wi-Fi address ${a.mac}, which lets networks and passers-by recognise it everywhere it goes.`,
    { label: 'Turn on a private Wi-Fi address', steps, open: 'mac-privacy' },
    'This computer can be tracked by its Wi-Fi address');
}

function checkWifiSecurity(ctx) {
  const sec = ctx.wifi && ctx.wifi.security;
  if (!sec) return check('wifi-security', 'unknown', 'high', 'The Wi-Fi encryption type is not available (not connected over Wi-Fi, or the system hides it).');
  const s = sec.toUpperCase();
  const routerFix = (label, extra) => ({
    label,
    steps: [ROUTER_LOGIN_STEP(ctx.gw), 'Open the Wireless security settings.', ...extra, 'Save, then reconnect your devices.'],
    open: 'router-admin',
  });
  if (/WPA3|SAE|OWE/.test(s)) return check('wifi-security', 'ok', 'info', `Your Wi-Fi uses ${sec}.`, null, 'Your Wi-Fi uses the newest encryption');
  if (/WPA2/.test(s) && !/TKIP/.test(s)) {
    return check('wifi-security', 'ok', 'info', `Your Wi-Fi uses ${sec}. That is safe with a long password; WPA3 is better if all your devices support it.`,
      routerFix('Upgrade to WPA3 if available', ['Choose WPA2/WPA3 mixed or WPA3-Personal.']), 'Your Wi-Fi encryption is solid');
  }
  if (/OPEN|NONE|ОТКРЫТ|WEP/.test(s)) {
    return check('wifi-security', 'risk', 'critical', `Your Wi-Fi uses ${sec}: anyone nearby can join or read the traffic.`,
      routerFix('Turn on WPA2 or WPA3', ['Choose WPA2-Personal (AES) or WPA3-Personal and set a long password.']), 'Your Wi-Fi is effectively open');
  }
  if (/TKIP|WPA/.test(s)) {
    return check('wifi-security', 'risk', 'high', `Your Wi-Fi uses ${sec}, an outdated mode that can be broken.`,
      routerFix('Switch to WPA2 (AES) or WPA3', ['Choose WPA2-Personal with AES/CCMP only, or WPA3-Personal.']), 'Your Wi-Fi uses outdated encryption');
  }
  return check('wifi-security', 'unknown', 'high', `Bastion does not recognise the Wi-Fi security type "${sec}".`);
}

function checkUnknownDevices(ctx) {
  const list = ctx.devices;
  if (!list) return check('unknown-devices', 'unknown', 'low', 'The device list could not be read.');
  const others = list.filter((d) => !d.isGateway && !d.isThisComputer);
  const randomized = others.filter((d) => d.randomizedMac);
  const unknownVendor = others.filter((d) => !d.randomizedMac && !d.vendor);
  const total = randomized.length + unknownVendor.length;
  if (!others.length) {
    const errs = Array.isArray(list.errors) ? list.errors : [];
    if (errs.length) return check('unknown-devices', 'unknown', 'low', `Device discovery did not complete (${errs[0]}), so Bastion cannot tell who is on your network.`);
    return check('unknown-devices', 'ok', 'info', 'No other devices answered on your network during this scan. Devices that are asleep or switched off do not show up.', null, 'No other devices answered');
  }
  if (!total) {
    return check('unknown-devices', 'ok', 'info', `All ${others.length} other device${others.length === 1 ? '' : 's'} seen on your network have a recognised maker.`, null, 'Every device is identified');
  }
  const parts = [];
  if (randomized.length) parts.push(`${randomized.length} ${randomized.length === 1 ? 'uses' : 'use'} a private (randomized) address, which is normal for phones, tablets and laptops`);
  if (unknownVendor.length) parts.push(`${unknownVendor.length} ${unknownVendor.length === 1 ? 'has' : 'have'} a maker that is not in Bastion's built-in list (${unknownVendor.slice(0, 6).map((d) => d.ip).join(', ')}${unknownVendor.length > 6 ? ', ...' : ''})`);
  const fix = {
    label: 'Check who is on your network',
    steps: [
      'Compare the list in the Devices view with the devices you own; a device that is switched off disappears from the list.',
      ROUTER_LOGIN_STEP(ctx.gw) + ' The router\'s client list often shows device names.',
      'If you find a device you do not recognise, change the Wi-Fi password (and turn off WPS) so it is kicked off.',
    ],
    open: 'router-admin',
  };
  return check('unknown-devices', 'warn', 'info',
    `${total} of ${others.length} other device${others.length === 1 ? '' : 's'} could not be identified by maker: ${parts.join('; ')}.`,
    fix, `${total} device${total === 1 ? '' : 's'} could not be identified`);
}

const RUNNERS = {
  tr069: { needs: ['ports'], run: checkTr069 },
  upnp: { needs: ['upnp'], run: checkUpnp },
  'dns-plaintext': { needs: ['dns'], run: checkDns },
  'admin-default': { needs: ['ports'], run: checkAdminDefault },
  wps: { needs: [], run: checkWps },
  telnet: { needs: ['ports'], run: checkTelnet },
  ssh: { needs: ['ports'], run: checkSsh },
  'web-admin-http': { needs: ['ports'], run: checkWebAdmin },
  'location-map': { needs: ['wifi'], run: checkLocationMap },
  'mac-privacy': { needs: ['wifiAdapter'], run: checkMacPrivacy },
  'wifi-security': { needs: ['wifi'], run: checkWifiSecurity },
  'unknown-devices': { needs: ['devices'], run: checkUnknownDevices },
};

// ---------- scan ----------

async function scan(onProgress) {
  const startedAt = new Date().toISOString();
  const errors = [];
  const emit = (p) => {
    try {
      if (typeof onProgress === 'function') onProgress(p);
    } catch {
      // a broken listener must not stop the scan
    }
  };

  const route = await defaultRoute();
  errors.push(...route.errors);
  const gw = route.gateway;

  // Start every data source at once; each check waits only for what it needs.
  const take = (label, promise, pick = (x) => x) =>
    promise.then(
      (v) => {
        if (v && Array.isArray(v.errors)) errors.push(...v.errors);
        return pick(v);
      },
      (err) => {
        errors.push(`${label} failed: ${errMsg(err)}`);
        return null;
      },
    );
  const wifiMod = wifiModule();
  if (!wifiMod) errors.push('Wi-Fi module is not available.');
  const sources = {
    ports: gw ? take('Router port probe', probeGateway(gw)) : Promise.resolve(null),
    upnp: take('UPnP check', upnpStatus({ localIp: route.ip, gatewayIp: gw })),
    dns: take('DNS check', dnsStatus()),
    wifi: wifiMod ? take('Wi-Fi info', Promise.resolve().then(() => wifiMod.wifiInfo())) : Promise.resolve(null),
    wifiAdapter: take('Wi-Fi adapter lookup', wifiAdapter()),
    devices: take('Device discovery', devices()),
  };

  const checks = [];
  const total = CHECKS.length;
  for (let i = 0; i < total; i++) {
    const def = CHECKS[i];
    emit({ index: i, total, id: def.id, title: def.title });
    let result;
    try {
      const runner = RUNNERS[def.id];
      const ctx = { gw, route };
      for (const n of runner.needs) ctx[n] = await sources[n];
      result = runner.run(ctx);
    } catch (err) {
      errors.push(`Check ${def.id} failed: ${errMsg(err)}`);
      result = check(def.id, 'unknown', 'info', `This check could not run: ${errMsg(err)}`);
    }
    checks.push(result);
    emit({ index: i, total, id: def.id, title: result.title, status: result.status });
  }

  const [ports, upnp] = await Promise.all([sources.ports, sources.upnp]);
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    score: scoreOf(checks),
    checks,
    upnpMappings: upnp
      ? upnp.mappings.map((m) => ({ protocol: m.protocol, externalPort: m.externalPort, internalClient: m.internalClient, internalPort: m.internalPort, description: m.description }))
      : [],
    openPorts: ports ? ports.open : [],
    errors: [...new Set(errors)],
  };
}

module.exports = { scan, CHECKS, scoreOf };
