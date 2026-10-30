'use strict';

const { isWin, isMac, run, runPowerShell, asArray, isIPv4, isPrivateIPv4, errMsg } = require('./util');
const { defaultRoute } = require('./system');

const PROVIDERS = {
  '1.1.1.1': 'Cloudflare', '1.0.0.1': 'Cloudflare', '1.1.1.2': 'Cloudflare', '1.0.0.2': 'Cloudflare',
  '1.1.1.3': 'Cloudflare', '1.0.0.3': 'Cloudflare',
  '8.8.8.8': 'Google', '8.8.4.4': 'Google',
  '9.9.9.9': 'Quad9', '149.112.112.112': 'Quad9', '9.9.9.10': 'Quad9', '9.9.9.11': 'Quad9',
  '94.140.14.14': 'AdGuard', '94.140.15.15': 'AdGuard',
  '208.67.222.222': 'OpenDNS', '208.67.220.220': 'OpenDNS',
  '77.88.8.8': 'Yandex', '77.88.8.1': 'Yandex',
  '2606:4700:4700::1111': 'Cloudflare', '2606:4700:4700::1001': 'Cloudflare',
  '2001:4860:4860::8888': 'Google', '2001:4860:4860::8844': 'Google',
  '2620:fe::fe': 'Quad9', '2620:fe::9': 'Quad9',
};

function providerFor(servers, gateway) {
  if (!servers.length) return null;
  const first = servers[0];
  if (PROVIDERS[first]) return PROVIDERS[first];
  if (first === gateway || isPrivateIPv4(first) || /^fe80:|^fd|^fc/i.test(first)) return 'ISP / router';
  return 'Other (probably your provider)';
}

// ---------- Windows ----------

function winScript(ifIndex, guid) {
  const idx = Number.isInteger(ifIndex) ? ifIndex : -1;
  const g = /^\{?[0-9a-f-]{36}\}?$/i.test(guid || '') ? guid.replace(/[{}]/g, '') : '';
  return `
$ErrorActionPreference = 'SilentlyContinue'
$idx = ${idx}
$guid = '${g}'
if ($idx -lt 0) {
  $r = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -PolicyStore ActiveStore | Sort-Object { [int]$_.RouteMetric + [int]$_.InterfaceMetric } | Select-Object -First 1
  $idx = [int]$r.InterfaceIndex
}
if (-not $guid) { $guid = [string](Get-NetAdapter -InterfaceIndex $idx).InterfaceGuid }
$guid = $guid.Trim('{','}')
$v4 = @((Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4).ServerAddresses)
$v6 = @((Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv6).ServerAddresses)
$doh = @(Get-DnsClientDohServerAddress | ForEach-Object { [pscustomobject]@{ ip = [string]$_.ServerAddress; template = [string]$_.DohTemplate; auto = [bool]$_.AutoUpgrade; fallback = [bool]$_.AllowFallbackToUdp } })
$base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\{' + $guid + '}'
$perIf = @()
foreach ($kind in @('DohProfileSettings', 'DohInterfaceSettings')) {
  foreach ($fam in @('Doh', 'Doh6')) {
    foreach ($k in @(Get-ChildItem -Path ($base + '\\' + $kind + '\\' + $fam))) {
      $p = Get-ItemProperty -Path $k.PSPath
      $perIf += [pscustomobject]@{ ip = [string]$k.PSChildName; flags = [int64]$p.DohFlags; template = [string]$p.DohTemplate }
    }
  }
}
$auto = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\Parameters').EnableAutoDoh
ConvertTo-Json -InputObject ([pscustomobject]@{ idx = $idx; v4 = $v4; v6 = $v6; doh = $doh; perIf = $perIf; autoDoh = $auto }) -Depth 3 -Compress
`;
}

async function windowsStatus(route, errors) {
  const ps = await runPowerShell(winScript(route.ifIndex, route.guid));
  if (!ps.ok || !ps.data) {
    errors.push(`DNS settings lookup failed: ${ps.error}`);
    return { servers: [], encrypted: null };
  }
  const d = ps.data;
  const v4 = asArray(d.v4).map(String).filter(Boolean);
  const v6 = asArray(d.v6).map(String).filter((s) => s && !/^fec0:/i.test(s));
  const servers = v4.length ? v4 : v6;
  const known = new Map(asArray(d.doh).filter(Boolean).map((x) => [String(x.ip).toLowerCase(), x]));
  const perIf = new Map(asArray(d.perIf).filter(Boolean).map((x) => [String(x.ip).toLowerCase(), x]));

  // Encrypted only with evidence: the adapter has a DoH entry for the server it uses
  // (set in Settings > Network > DNS encryption), or automatic DoH is on for a known template.
  let encrypted = null;
  if (servers.length) {
    const evidence = servers.map((s) => {
      const key = s.toLowerCase();
      const entry = perIf.get(key);
      if (entry && (entry.flags > 0 || entry.template)) return true;
      const k = known.get(key);
      if (k && k.auto && Number(d.autoDoh) === 2) return true;
      return false;
    });
    // No DoH setting for the server in use means Windows sends classic DNS on port 53.
    encrypted = Boolean(evidence[0]);
  }
  return { servers, encrypted };
}

// ---------- macOS ----------

async function macStatus(errors) {
  const res = await run('scutil', ['--dns'], { timeout: 5000 });
  if (res.error) errors.push(res.error);
  // The first "DNS configuration" section, resolver #1, is the default resolver.
  const main = res.stdout.split(/DNS configuration \(for scoped queries\)/i)[0];
  const servers = [];
  const blocks = main.split(/\nresolver #\d+/i);
  for (const block of blocks.slice(1)) {
    if (/domain\s*:\s*\S+/i.test(block) && !/search domain/i.test(block)) continue; // skip per-domain resolvers (e.g. local)
    const re = /nameserver\[\d+\]\s*:\s*(\S+)/g;
    let m;
    while ((m = re.exec(block))) if (!servers.includes(m[1])) servers.push(m[1]);
    if (servers.length) break;
  }
  return { servers, encrypted: null };
}

// ---------- public ----------

async function dnsStatus() {
  const errors = [];
  const out = { servers: [], gatewayIsResolver: false, encrypted: null, provider: null, note: null, errors };
  try {
    const route = await defaultRoute();
    const st = isWin ? await windowsStatus(route, errors) : isMac ? await macStatus(errors) : { servers: [], encrypted: null };
    if (!isWin && !isMac) errors.push(`Platform ${process.platform} is not supported`);
    out.servers = st.servers;
    out.encrypted = st.encrypted;
    out.provider = providerFor(st.servers, route.gateway);
    out.gatewayIsResolver = st.servers.some((s) => s === route.gateway || (isIPv4(s) && isPrivateIPv4(s)));
    if (isMac) {
      out.note = 'macOS does not show whether an encrypted DNS profile is active without admin tools, so encryption is reported as unknown.';
    } else if (isWin && st.encrypted === false) {
      out.note = 'Windows sends DNS for this connection unencrypted. Browsers with their own secure DNS setting are not covered by this check.';
    }
    if (!st.servers.length) errors.push('No DNS servers found for the active connection.');
  } catch (err) {
    errors.push(`DNS check failed: ${errMsg(err)}`);
  }
  return out;
}

module.exports = { dnsStatus, providerFor, PROVIDERS };
