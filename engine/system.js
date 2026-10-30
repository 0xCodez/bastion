'use strict';

const os = require('node:os');
const {
  isWin, isMac, run, runPowerShell, asArray, normalizeMac, isRandomizedMac, isIPv4, sameSubnet,
  maskToPrefix, errMsg,
} = require('./util');
const { vendorFor } = require('./vendors');

const ROUTE_TTL_MS = 10000;
let routeCache = null;

// ---------- default route ----------

// Windows: every IPv4 default route with its adapter, so physical adapters can win over VPN/virtual ones.
const WIN_ROUTE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$out = @()
foreach ($r in @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -PolicyStore ActiveStore)) {
  $a = Get-NetAdapter -InterfaceIndex $r.InterfaceIndex
  $ip = @(Get-NetIPAddress -InterfaceIndex $r.InterfaceIndex -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254.*' }) | Select-Object -First 1
  $out += [pscustomobject]@{
    gateway = [string]$r.NextHop
    ifIndex = [int]$r.InterfaceIndex
    alias = [string]$r.InterfaceAlias
    metric = [int]$r.RouteMetric + [int]$r.InterfaceMetric
    ip = [string]$ip.IPAddress
    prefix = [int]$ip.PrefixLength
    mac = [string]$a.MacAddress
    media = [string]$a.PhysicalMediaType
    virtual = [bool]$a.Virtual
    hardware = [bool]$a.HardwareInterface
    status = [string]$a.Status
    guid = [string]$a.InterfaceGuid
  }
}
ConvertTo-Json -InputObject @($out) -Compress
`;

function ifaceFromNode(match) {
  // Finds the os.networkInterfaces() entry for an IP or interface name.
  const all = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(all)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      if (match(name, a)) {
        return { iface: name, ip: a.address, prefix: a.cidr ? Number(a.cidr.split('/')[1]) : maskToPrefix(a.netmask), mac: normalizeMac(a.mac) };
      }
    }
  }
  return null;
}

async function winRoute(errors) {
  const ps = await runPowerShell(WIN_ROUTE_SCRIPT);
  if (ps.ok) {
    const routes = asArray(ps.data).filter((r) => r && isIPv4(r.gateway) && r.gateway !== '0.0.0.0' && isIPv4(r.ip));
    const physical = (r) => /802\.3|802\.11/.test(r.media || '') && !r.virtual && r.hardware;
    routes.sort((a, b) => Number(physical(b)) - Number(physical(a)) || a.metric - b.metric);
    const r = routes[0];
    if (r) {
      return {
        gateway: r.gateway,
        iface: r.alias || null,
        ifIndex: r.ifIndex,
        ip: r.ip,
        prefix: r.prefix || 24,
        mac: normalizeMac(r.mac),
        wifi: /802\.11/.test(r.media || ''),
        guid: r.guid || null,
      };
    }
  } else if (ps.error) {
    errors.push(`Route lookup via PowerShell failed: ${ps.error}`);
  }

  // Fallback: route print -4 (language independent: only numbers are parsed).
  const res = await run('route', ['print', '-4']);
  if (res.error) errors.push(res.error);
  let best = null;
  for (const line of res.stdout.split(/\r?\n/)) {
    const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/.exec(line);
    if (m && (!best || Number(m[3]) < best.metric)) best = { gateway: m[1], ip: m[2], metric: Number(m[3]) };
  }
  if (!best) return null;
  const n = ifaceFromNode((_name, a) => a.address === best.ip);
  return {
    gateway: best.gateway,
    iface: n ? n.iface : null,
    ifIndex: null,
    ip: best.ip,
    prefix: n ? n.prefix : 24,
    mac: n ? n.mac : null,
    wifi: n ? /wi-?fi|wlan|wireless|беспровод/i.test(n.iface) : null,
    guid: null,
  };
}

async function macRoute(errors) {
  const res = await run('route', ['-n', 'get', 'default']);
  if (res.error) errors.push(res.error);
  const gw = /gateway:\s*(\S+)/.exec(res.stdout);
  const ifm = /interface:\s*(\S+)/.exec(res.stdout);
  const iface = ifm ? ifm[1] : null;
  let gateway = gw && isIPv4(gw[1]) ? gw[1] : null;
  let n = iface ? ifaceFromNode((name) => name === iface) : null;
  // A VPN (utun) can own the default route; fall back to the first physical interface.
  if (!gateway || !n) {
    const alt = ifaceFromNode((name) => /^en\d+$/.test(name));
    if (alt) {
      n = alt;
      if (!gateway) {
        const r2 = await run('ipconfig', ['getoption', alt.iface, 'router']);
        if (isIPv4(r2.stdout.trim())) gateway = r2.stdout.trim();
      }
    }
  }
  if (!n && !gateway) return null;
  let wifi = null;
  if (n) {
    const hw = await run('networksetup', ['-listallhardwareports'], { timeout: 5000 });
    const m = /Hardware Port:\s*(?:Wi-Fi|AirPort)\s*\r?\nDevice:\s*(\S+)/i.exec(hw.stdout);
    if (m) wifi = m[1] === n.iface;
  }
  return {
    gateway,
    iface: n ? n.iface : iface,
    ifIndex: null,
    ip: n ? n.ip : null,
    prefix: n ? n.prefix : 24,
    mac: n ? n.mac : null,
    wifi,
    guid: null,
  };
}

// { gateway, iface, ifIndex, ip, prefix, mac, wifi, guid, errors } - cached for 10 s.
async function defaultRoute(force = false) {
  if (!force && routeCache && Date.now() - routeCache.at < ROUTE_TTL_MS) return routeCache.value;
  const errors = [];
  let r = null;
  try {
    if (isWin) r = await winRoute(errors);
    else if (isMac) r = await macRoute(errors);
    else errors.push(`Platform ${process.platform} is not supported`);
  } catch (err) {
    errors.push(`Route lookup failed: ${errMsg(err)}`);
  }
  if (!r) {
    // Last resort: any private IPv4 interface, gateway unknown.
    const n = ifaceFromNode(() => true);
    r = n ? { gateway: null, ifIndex: null, wifi: null, guid: null, ...n } : null;
    errors.push('No default route found: this computer may be offline.');
  }
  // The route may not report the subnet; fill it in from Node if we can.
  if (r && r.ip && (!r.mac || !r.prefix)) {
    const n = ifaceFromNode((_name, a) => a.address === r.ip);
    if (n) {
      r.mac = r.mac || n.mac;
      r.prefix = r.prefix || n.prefix;
    }
  }
  const value = { gateway: null, iface: null, ifIndex: null, ip: null, prefix: null, mac: null, wifi: null, guid: null, ...(r || {}), errors };
  if (value.gateway && value.ip && value.prefix && !sameSubnet(value.gateway, value.ip, value.prefix)) {
    errors.push(`Gateway ${value.gateway} is outside the local subnet ${value.ip}/${value.prefix} (VPN or unusual setup).`);
  }
  routeCache = { at: Date.now(), value };
  return value;
}

// ---------- Wi-Fi adapter MAC (for the MAC privacy check) ----------

// { connected: boolean, iface, mac, randomized, errors }
async function wifiAdapter() {
  const errors = [];
  try {
    if (isWin) {
      const ps = await runPowerShell(`
$ErrorActionPreference = 'SilentlyContinue'
$a = @(Get-NetAdapter | Where-Object { $_.PhysicalMediaType -eq 'Native 802.11' -or $_.MediaType -eq 'Native 802.11' })
ConvertTo-Json -InputObject @($a | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; mac = [string]$_.MacAddress; status = [string]$_.Status } }) -Compress
`);
      if (!ps.ok) {
        errors.push(`Wi-Fi adapter lookup failed: ${ps.error}`);
        return { connected: false, iface: null, mac: null, randomized: null, errors };
      }
      const list = asArray(ps.data);
      const up = list.find((a) => a.status === 'Up') || null;
      if (!up) return { connected: false, iface: list[0] ? list[0].name : null, mac: null, randomized: null, errors };
      const mac = normalizeMac(up.mac);
      return { connected: true, iface: up.name, mac, randomized: isRandomizedMac(mac), errors };
    }
    if (isMac) {
      const hw = await run('networksetup', ['-listallhardwareports'], { timeout: 5000 });
      const m = /Hardware Port:\s*(?:Wi-Fi|AirPort)\s*\r?\nDevice:\s*(\S+)/i.exec(hw.stdout);
      if (!m) return { connected: false, iface: null, mac: null, randomized: null, errors };
      const ifc = await run('ifconfig', [m[1]], { timeout: 4000 });
      const ether = /\bether\s+([0-9a-f:]+)/i.exec(ifc.stdout);
      const active = /status:\s*active/i.test(ifc.stdout);
      const mac = ether ? normalizeMac(ether[1]) : null;
      return { connected: active, iface: m[1], mac, randomized: mac ? isRandomizedMac(mac) : null, errors };
    }
  } catch (err) {
    errors.push(`Wi-Fi adapter lookup failed: ${errMsg(err)}`);
  }
  return { connected: false, iface: null, mac: null, randomized: null, errors };
}

// ---------- public IP ----------

async function publicIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ip: null, error: `Public IP lookup returned HTTP ${res.status}` };
    const json = await res.json();
    return { ip: typeof json.ip === 'string' ? json.ip : null, error: null };
  } catch (err) {
    return { ip: null, error: `Public IP lookup failed (offline or blocked): ${errMsg(err)}` };
  }
}

// ---------- overview ----------

async function overview() {
  const errors = [];
  try {
    const [route, pub] = await Promise.all([defaultRoute(), publicIp()]);
    errors.push(...route.errors);
    if (pub.error) errors.push(pub.error);

    let gatewayMac = null;
    if (route.gateway) {
      const { readArp } = require('./devices');
      const arp = await readArp();
      errors.push(...arp.errors);
      const hit = arp.entries.find((e) => e.ip === route.gateway);
      gatewayMac = hit ? hit.mac : null;
      if (!hit) errors.push(`Gateway ${route.gateway} is not in the ARP table yet, so its MAC address is unknown.`);
    }

    return {
      hostname: os.hostname(),
      local: {
        ip: route.ip || '',
        iface: route.iface || '',
        mac: route.mac || '',
        macRandomized: route.mac ? isRandomizedMac(route.mac) : null,
      },
      gateway: { ip: route.gateway || null, mac: gatewayMac, vendor: gatewayMac ? vendorFor(gatewayMac) : null },
      publicIp: pub.ip,
      errors,
    };
  } catch (err) {
    errors.push(`Overview failed: ${errMsg(err)}`);
    return {
      hostname: os.hostname(),
      local: { ip: '', iface: '', mac: '', macRandomized: null },
      gateway: { ip: null, mac: null, vendor: null },
      publicIp: null,
      errors,
    };
  }
}

module.exports = { overview, defaultRoute, wifiAdapter, publicIp };
