'use strict';

const dgram = require('node:dgram');
const dns = require('node:dns');
const os = require('node:os');
const {
  isWin, run, normalizeMac, isRandomizedMac, isMulticastMac, isIPv4, isMulticastIPv4, ipToInt, intToIp,
  prefixToMask, isPrivateIPv4, withTimeout, mapLimit, errMsg,
} = require('./util');
const { vendorFor } = require('./vendors');
const { defaultRoute } = require('./system');

// ---------- ARP table ----------

function parseArpWindows(text) {
  // "Interface: 192.168.1.5 --- 0x7" (header word is localized, the rest is not)
  // "  192.168.1.1           aa-bb-cc-dd-ee-ff     dynamic"
  const entries = [];
  let ifaceIp = null;
  for (const line of text.split(/\r?\n/)) {
    const head = /^\S.*?:\s+(\d{1,3}(?:\.\d{1,3}){3})\s+---\s+0x[0-9a-f]+/i.exec(line);
    if (head) {
      ifaceIp = head[1];
      continue;
    }
    const m = /^\s+(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\S+)/i.exec(line);
    if (m) entries.push({ ip: m[1], mac: normalizeMac(m[2]), iface: ifaceIp, type: m[3].toLowerCase() });
  }
  return entries;
}

function parseArpMac(text) {
  // "? (192.168.1.1) at a:b:c:d:e:f on en0 ifscope [ethernet]"
  // "? (192.168.1.7) at (incomplete) on en0 ifscope [ethernet]"
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-f:]+)\s+on\s+(\S+)/i.exec(line);
    if (m) entries.push({ ip: m[1], mac: normalizeMac(m[2]), iface: m[3], type: /permanent/.test(line) ? 'static' : 'dynamic' });
  }
  return entries;
}

// { entries: [{ ip, mac, iface }], errors }
async function readArp() {
  const res = await run('arp', isWin ? ['-a'] : ['-an']);
  const errors = res.error ? [res.error] : [];
  const raw = isWin ? parseArpWindows(res.stdout) : parseArpMac(res.stdout);
  const entries = raw.filter((e) => {
    if (!e.mac || isMulticastMac(e.mac)) return false;
    if (isMulticastIPv4(e.ip) || e.ip === '255.255.255.255') return false;
    if (e.ip.endsWith('.255') && e.mac === 'ff:ff:ff:ff:ff:ff') return false;
    return true;
  });
  return { entries, errors };
}

// ---------- ARP warm-up sweep ----------

// The ARP table only lists devices this computer talked to recently. Sending one tiny UDP
// datagram to the discard port of every address in the local /24 makes the OS resolve each
// address via ARP, so devices that are present show up. Stays on the local network.
function sweepSubnet(ip, prefix, waitMs = 2000) {
  return new Promise((resolve) => {
    if (!isPrivateIPv4(ip)) {
      resolve(false);
      return;
    }
    const p = Math.max(prefix || 24, 24); // never more than 254 hosts
    const mask = prefixToMask(p);
    const net = ipToInt(ip) & mask;
    const hosts = [];
    for (let i = 1; i < 2 ** (32 - p) - 1; i++) {
      const h = intToIp((net + i) >>> 0);
      if (h !== ip) hosts.push(h);
    }
    let sock;
    try {
      sock = dgram.createSocket('udp4');
    } catch {
      resolve(false);
      return;
    }
    sock.on('error', () => {}); // ICMP unreachable replies surface as errors; they are expected
    const payload = Buffer.from([0]);
    let i = 0;
    const sendBatch = () => {
      const end = Math.min(i + 32, hosts.length);
      for (; i < end; i++) {
        try {
          sock.send(payload, 9, hosts[i], () => {});
        } catch {
          // ignore
        }
      }
      if (i < hosts.length) setTimeout(sendBatch, 5);
      else {
        setTimeout(() => {
          try {
            sock.close();
          } catch {
            // already closed
          }
          resolve(true);
        }, waitMs);
      }
    };
    sendBatch();
  });
}

// ---------- reverse DNS ----------

// PTR lookups reveal the home network's addresses to whoever answers them, so they only go to
// resolvers on the local network: the system's own servers when all are private, else the gateway.
function lanResolverServers(gateway) {
  let servers = [];
  try {
    servers = dns.getServers();
  } catch {
    servers = [];
  }
  const local = (s) => isPrivateIPv4(s) || /^127\./.test(s) || s === '::1' || /^f[cd]|^fe80/i.test(s);
  if (servers.length && servers.every(local)) return servers;
  return gateway && isPrivateIPv4(gateway) ? [gateway] : null;
}

async function reverseNames(ips, gateway) {
  const names = new Map();
  const servers = lanResolverServers(gateway);
  if (!servers || !ips.length) return names;
  let resolver;
  try {
    resolver = new dns.promises.Resolver({ timeout: 1200, tries: 1 });
    resolver.setServers(servers);
  } catch {
    return names;
  }
  await mapLimit(ips, 24, async (ip) => {
    const result = await withTimeout(resolver.reverse(ip), 1800, []);
    const name = Array.isArray(result) && result[0] ? String(result[0]).replace(/\.$/, '') : null;
    if (name && name !== ip) names.set(ip, name);
  });
  try {
    resolver.cancel();
  } catch {
    // nothing pending
  }
  return names;
}

// ---------- devices ----------

async function devices(opts = {}) {
  const sweep = opts.sweep !== false;
  const errors = [];
  try {
    const route = await defaultRoute();
    errors.push(...route.errors);
    if (sweep && route.ip) await sweepSubnet(route.ip, route.prefix);
    const arp = await readArp();
    errors.push(...arp.errors);

    // Keep only the neighbours on the interface that carries the default route.
    let entries = arp.entries;
    if (route.ip) {
      const onRoute = entries.filter((e) => (isWin ? e.iface === route.ip : e.iface === route.iface));
      if (onRoute.length) entries = onRoute;
    }

    const seen = new Set();
    const list = [];
    for (const e of entries) {
      if (seen.has(e.ip)) continue;
      seen.add(e.ip);
      list.push({
        ip: e.ip,
        mac: e.mac,
        vendor: vendorFor(e.mac),
        randomizedMac: Boolean(isRandomizedMac(e.mac)),
        isGateway: e.ip === route.gateway,
        // macOS lists this computer's own address as a permanent ARP entry; Windows does not.
        isThisComputer: e.ip === route.ip,
        hostname: e.ip === route.ip ? os.hostname() : null,
      });
    }
    if (route.ip && !seen.has(route.ip)) {
      list.push({
        ip: route.ip,
        mac: route.mac || '',
        vendor: route.mac ? vendorFor(route.mac) : null,
        randomizedMac: Boolean(route.mac && isRandomizedMac(route.mac)),
        isGateway: false,
        isThisComputer: true,
        hostname: os.hostname(),
      });
    }

    const names = await reverseNames(list.filter((d) => !d.isThisComputer && isIPv4(d.ip)).map((d) => d.ip), route.gateway);
    for (const d of list) if (!d.hostname) d.hostname = names.get(d.ip) || null;

    list.sort((a, b) => Number(b.isGateway) - Number(a.isGateway) || Number(b.isThisComputer) - Number(a.isThisComputer) || ipToInt(a.ip) - ipToInt(b.ip));
    // The contract types this as Device[]; problems ride along as an enumerable `errors` property,
    // which survives Electron's structured clone over IPC (JSON.stringify drops it).
    list.errors = errors;
    return list;
  } catch (err) {
    errors.push(`Device discovery failed: ${errMsg(err)}`);
    const list = [];
    list.errors = errors;
    return list;
  }
}

module.exports = { devices, readArp, sweepSubnet, _internal: { parseArpWindows, parseArpMac } };
