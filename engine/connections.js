'use strict';

const { isWin, isMac, run, runPowerShell, asArray, isLoopback, errMsg } = require('./util');

const MAX_UDP = 400;

function fmtLocal(addr, port) {
  return String(addr).includes(':') ? `[${addr}]:${port}` : `${addr}:${port}`;
}

// Splits "1.2.3.4:80", "[::1]:80" or "*:*" into { addr, port }.
function splitEndpoint(s) {
  const text = String(s || '').trim();
  let m = /^\[(.*)\]:(\d+|\*)$/.exec(text);
  if (!m) m = /^(.*):(\d+|\*)$/.exec(text);
  if (!m) return { addr: text, port: 0 };
  return { addr: m[1].replace(/%\w+$/, ''), port: m[2] === '*' ? 0 : Number(m[2]) };
}

function isUnspecified(addr) {
  return addr === '0.0.0.0' || addr === '::' || addr === '*' || addr === '';
}

// ---------- Windows ----------

const WIN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$procs = @{}
foreach ($p in Get-Process) { $procs[[string]$p.Id] = [string]$p.ProcessName }
$tcp = @(Get-NetTCPConnection | Where-Object { $_.State -eq 'Established' -or $_.State -eq 'Listen' } | ForEach-Object {
  [pscustomobject]@{ la = [string]$_.LocalAddress; lp = [int]$_.LocalPort; ra = [string]$_.RemoteAddress; rp = [int]$_.RemotePort; s = [string]$_.State; id = [int]$_.OwningProcess }
})
$udp = @(Get-NetUDPEndpoint | ForEach-Object {
  [pscustomobject]@{ la = [string]$_.LocalAddress; lp = [int]$_.LocalPort; id = [int]$_.OwningProcess }
})
ConvertTo-Json -InputObject ([pscustomobject]@{ tcp = $tcp; udp = $udp; procs = $procs }) -Depth 3 -Compress
`;

async function windowsViaPowerShell(errors) {
  const ps = await runPowerShell(WIN_SCRIPT, { timeout: 20000 });
  if (!ps.ok || !ps.data) {
    errors.push(`Connection list via PowerShell failed: ${ps.error}`);
    return null;
  }
  const procs = ps.data.procs || {};
  const name = (id) => (id != null && procs[String(id)] ? procs[String(id)] : null);
  const out = [];
  for (const c of asArray(ps.data.tcp)) {
    if (!c) continue;
    const listen = /listen/i.test(c.s);
    if (isLoopback(c.la) || (!listen && isLoopback(c.ra))) continue;
    out.push({
      process: name(c.id),
      pid: c.id || null,
      protocol: 'tcp',
      local: fmtLocal(c.la, c.lp),
      remoteIp: listen ? '*' : c.ra,
      remotePort: listen ? 0 : c.rp,
      state: listen ? 'LISTEN' : 'ESTABLISHED',
    });
  }
  let udpCount = 0;
  for (const u of asArray(ps.data.udp)) {
    if (!u || isLoopback(u.la) || /^fe80/i.test(u.la)) continue;
    if (++udpCount > MAX_UDP) break;
    out.push({ process: name(u.id), pid: u.id || null, protocol: 'udp', local: fmtLocal(u.la, u.lp), remoteIp: '*', remotePort: 0, state: null });
  }
  return out;
}

// netstat prints localized state names on some Windows languages.
const ESTABLISHED_NAMES = new Set([
  'ESTABLISHED', 'HERGESTELLT', 'УСТАНОВЛЕНО', 'ETABLI', 'ÉTABLI', 'ESTABLECIDO', 'ESTABELECIDA', 'STABILITO',
  'VASTGESTELD', 'NAWIĄZANO', 'USTANOWIONO', 'NAVÁZÁNO', 'KURULDU', 'ETABLERAD', 'OPRETTET', 'ETABLERT',
]);

async function windowsViaNetstat(errors) {
  const [tcp, udp, tasks] = await Promise.all([
    run('netstat', ['-ano', '-p', 'TCP']),
    run('netstat', ['-ano', '-p', 'UDP']),
    run('tasklist', ['/FO', 'CSV', '/NH']),
  ]);
  for (const r of [tcp, udp, tasks]) if (r.error) errors.push(r.error);
  const procs = new Map();
  for (const line of tasks.stdout.split(/\r?\n/)) {
    const m = /^"([^"]*)","(\d+)"/.exec(line);
    if (m) procs.set(Number(m[2]), m[1].replace(/\.exe$/i, ''));
  }
  const out = [];
  for (const line of tcp.stdout.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/i.exec(line);
    if (!m) continue;
    const l = splitEndpoint(m[1]);
    const r = splitEndpoint(m[2]);
    const pid = Number(m[4]);
    // State names are localized on some Windows languages; a zero remote port means listening.
    const listen = r.port === 0 && isUnspecified(r.addr);
    // Only rows whose state is known to mean "established" are kept; anything else is skipped rather than guessed.
    if (!listen && !ESTABLISHED_NAMES.has(m[3].toUpperCase())) continue;
    if (isLoopback(l.addr) || (!listen && isLoopback(r.addr))) continue;
    out.push({ process: procs.get(pid) || null, pid, protocol: 'tcp', local: fmtLocal(l.addr, l.port), remoteIp: listen ? '*' : r.addr, remotePort: listen ? 0 : r.port, state: listen ? 'LISTEN' : 'ESTABLISHED' });
  }
  let udpCount = 0;
  for (const line of udp.stdout.split(/\r?\n/)) {
    const m = /^\s*UDP\s+(\S+)\s+(\S+)\s+(\d+)\s*$/i.exec(line);
    if (!m) continue;
    const l = splitEndpoint(m[1]);
    if (isLoopback(l.addr) || /^fe80/i.test(l.addr)) continue;
    if (++udpCount > MAX_UDP) break;
    const pid = Number(m[3]);
    out.push({ process: procs.get(pid) || null, pid, protocol: 'udp', local: fmtLocal(l.addr, l.port), remoteIp: '*', remotePort: 0, state: null });
  }
  return out;
}

// ---------- macOS ----------

function parseLsof(text) {
  // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
  // Google\x20Chrome 512 me 23u IPv4 0x.. 0t0 TCP 192.168.1.5:52341->142.250.74.14:443 (ESTABLISHED)
  const out = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = /^(\S+)\s+(\d+)\s+\S+\s+\S+\s+(IPv4|IPv6)\s+\S+\s+\S+\s+(TCP|UDP)\s+(\S+)(?:\s+\((\w+)\))?/.exec(line);
    if (!m) continue;
    const proc = m[1].replace(/\\x([0-9a-f]{2})/gi, (_s, h) => String.fromCharCode(parseInt(h, 16)));
    const pid = Number(m[2]);
    const protocol = m[4].toLowerCase();
    const [localPart, remotePart] = m[5].split('->');
    const l = splitEndpoint(localPart);
    const state = m[6] ? m[6].toUpperCase() : null;
    let item;
    if (protocol === 'tcp') {
      if (state !== 'ESTABLISHED' && state !== 'LISTEN') continue;
      if (state === 'LISTEN' || !remotePart) {
        if (isLoopback(l.addr)) continue;
        item = { process: proc, pid, protocol, local: fmtLocal(l.addr, l.port), remoteIp: '*', remotePort: 0, state: 'LISTEN' };
      } else {
        const r = splitEndpoint(remotePart);
        if (isLoopback(l.addr) || isLoopback(r.addr)) continue;
        item = { process: proc, pid, protocol, local: fmtLocal(l.addr, l.port), remoteIp: r.addr, remotePort: r.port, state: 'ESTABLISHED' };
      }
    } else {
      if (isLoopback(l.addr)) continue;
      const r = remotePart ? splitEndpoint(remotePart) : { addr: '*', port: 0 };
      if (isLoopback(r.addr)) continue;
      item = { process: proc, pid, protocol, local: fmtLocal(l.addr, l.port), remoteIp: r.addr || '*', remotePort: r.port, state: null };
    }
    const key = `${item.protocol}|${item.pid}|${item.local}|${item.remoteIp}|${item.remotePort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function macConnections(errors) {
  const res = await run('lsof', ['-nP', '-i'], { timeout: 12000 });
  // lsof exits with 1 when it finds nothing; only report real failures.
  if (res.error && !res.stdout) errors.push(res.error);
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    errors.push('Partial list: without administrator rights macOS only shows connections of apps run by the current user.');
  }
  return parseLsof(res.stdout);
}

// ---------- public ----------

// Connection[] (enumerable `errors` property, kept over IPC). Listening sockets have remoteIp '*' and remotePort 0.
// On macOS, lsof without admin rights only sees processes owned by the current user.
async function connections() {
  const errors = [];
  let list = [];
  try {
    if (isWin) {
      list = (await windowsViaPowerShell(errors)) || (await windowsViaNetstat(errors));
    } else if (isMac) {
      list = await macConnections(errors);
    } else {
      errors.push(`Platform ${process.platform} is not supported`);
    }
  } catch (err) {
    errors.push(`Connection list failed: ${errMsg(err)}`);
  }
  list.errors = errors;
  return list;
}

module.exports = { connections, _internal: { parseLsof, splitEndpoint } };
