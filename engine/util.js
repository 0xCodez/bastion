'use strict';

const http = require('node:http');
const { execFile } = require('node:child_process');

const DEFAULT_TIMEOUT = 8000;
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// ---------- process helpers ----------

// Console tools on localized Windows print in the OEM codepage (cp866 for Russian).
// Prefer UTF-8 when the bytes are valid UTF-8, otherwise fall back to the OEM codepage.
function decode(buf) {
  if (!buf || !buf.length) return '';
  if (typeof buf === 'string') return buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // not UTF-8
  }
  try {
    return new TextDecoder(isWin ? 'ibm866' : 'latin1').decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

// Runs a command without a shell. Always resolves: { stdout, stderr, code, error }.
function run(cmd, args = [], opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  return new Promise((resolve) => {
    try {
      execFile(
        cmd,
        args,
        { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' },
        (err, stdout, stderr) => {
          const out = decode(stdout);
          const errText = decode(stderr);
          let code = 0;
          let error = null;
          if (err) {
            code = typeof err.code === 'number' ? err.code : -1;
            if (err.killed || err.signal) error = `${cmd} timed out after ${timeout} ms`;
            else if (err.code === 'ENOENT') error = `${cmd} is not available on this computer`;
            else if (code !== 0 && !out) error = `${cmd} failed: ${(errText || err.message || '').trim().split(/\r?\n/)[0]}`;
          }
          resolve({ stdout: out, stderr: errText, code, error });
        },
      );
    } catch (err) {
      resolve({ stdout: '', stderr: '', code: -1, error: `${cmd} could not start: ${err.message}` });
    }
  });
}

// Runs a PowerShell script and parses its JSON output. The script must print JSON
// (use ConvertTo-Json). Resolves { ok, data, error }.
async function runPowerShell(script, opts = {}) {
  if (!isWin) return { ok: false, data: null, error: 'PowerShell is only used on Windows' };
  const full = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$ProgressPreference = 'SilentlyContinue'\n" + script;
  // -EncodedCommand avoids every quoting problem of passing a script on the command line.
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  const res = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout: opts.timeout || 15000 },
  );
  const text = res.stdout.replace(/^﻿/, '').trim();
  if (!text) return { ok: false, data: null, error: res.error || 'PowerShell returned no data' };
  try {
    return { ok: true, data: JSON.parse(text), error: null };
  } catch {
    // Some cmdlets print warnings before the JSON; take the last JSON-looking block.
    const start = text.search(/[[{]/);
    if (start >= 0) {
      try {
        return { ok: true, data: JSON.parse(text.slice(start)), error: null };
      } catch {
        // fall through
      }
    }
    return { ok: false, data: null, error: res.error || 'PowerShell output was not valid JSON' };
  }
}

// PowerShell 5.1 turns one-element arrays into a bare object and empty arrays into null.
function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

// ---------- MAC / IP helpers ----------

// Returns 'aa:bb:cc:dd:ee:ff' or null. Accepts '-', ':' or '.' separators and unpadded octets (macOS).
function normalizeMac(mac) {
  if (!mac || typeof mac !== 'string') return null;
  const s = mac.trim().toLowerCase();
  let parts;
  if (/^[0-9a-f]{12}$/.test(s)) parts = s.match(/../g);
  else if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/.test(s)) parts = s.replace(/\./g, '').match(/../g);
  else parts = s.split(/[:-]/);
  if (parts.length !== 6 || parts.some((p) => !/^[0-9a-f]{1,2}$/.test(p))) return null;
  const out = parts.map((p) => p.padStart(2, '0')).join(':');
  if (out === '00:00:00:00:00:00') return null;
  return out;
}

// A MAC with the locally-administered bit set (second-lowest bit of the first octet)
// is not a burned-in vendor address: phones and laptops use these for Wi-Fi privacy.
function isRandomizedMac(mac) {
  const m = normalizeMac(mac);
  if (!m) return null;
  const first = parseInt(m.slice(0, 2), 16);
  if (first & 0x01) return false; // multicast, not a device address
  return (first & 0x02) !== 0;
}

function isMulticastMac(mac) {
  const m = normalizeMac(mac);
  if (!m) return false;
  return m === 'ff:ff:ff:ff:ff:ff' || (parseInt(m.slice(0, 2), 16) & 0x01) === 1;
}

function isIPv4(ip) {
  if (typeof ip !== 'string') return false;
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, p) => ((acc << 8) + Number(p)) >>> 0, 0);
}

function intToIp(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function prefixToMask(prefix) {
  return prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

function maskToPrefix(mask) {
  if (!isIPv4(mask)) return null;
  let n = ipToInt(mask);
  let bits = 0;
  while (n & 0x80000000) {
    bits++;
    n = (n << 1) >>> 0;
  }
  return bits;
}

function sameSubnet(a, b, prefix) {
  if (!isIPv4(a) || !isIPv4(b) || prefix == null) return false;
  const mask = prefixToMask(prefix);
  return (ipToInt(a) & mask) === (ipToInt(b) & mask);
}

// RFC 1918 + link-local: addresses that only exist inside a local network.
function isPrivateIPv4(ip) {
  if (!isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function isLoopback(ip) {
  if (!ip) return false;
  const s = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  return s.startsWith('127.') || s === '::1' || s === '::ffff:127.0.0.1' || s === 'localhost';
}

function isMulticastIPv4(ip) {
  if (!isIPv4(ip)) return false;
  const a = Number(ip.split('.')[0]);
  return a >= 224 && a <= 239;
}

// ---------- async helpers ----------

function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Runs fn over items with at most `limit` in flight.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch {
        out[i] = undefined;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function errMsg(err) {
  return String((err && err.message) || err);
}

// Plain HTTP for talking to devices on the local network (routers often send
// slightly malformed HTTP, so the lenient parser is used). Never used for the internet.
function httpRequest(url, opts = {}) {
  const { method = 'GET', headers = {}, body = null, timeout = 3000, maxBytes = 2 * 1024 * 1024, privateOnly = false } = opts;
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      resolve({ status: 0, body: '', error: `Invalid URL: ${url}` });
      return;
    }
    if (u.protocol !== 'http:') {
      resolve({ status: 0, body: '', error: `Only plain HTTP on the local network is supported: ${url}` });
      return;
    }
    // privateOnly: the host must be a literal private IPv4 address, so nothing leaves the local network.
    if (privateOnly && !isPrivateIPv4(u.hostname)) {
      resolve({ status: 0, body: '', error: `Refused a request outside the local network: ${url}` });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let req;
    const timer = setTimeout(() => {
      if (req) req.destroy();
      finish({ status: 0, body: '', error: `HTTP ${method} ${url} timed out` });
    }, timeout);
    try {
      const payload = body == null ? null : Buffer.from(body, 'utf8');
      const h = { Connection: 'close', ...headers };
      if (payload) h['Content-Length'] = payload.length;
      req = http.request(
        {
          hostname: u.hostname,
          port: u.port || 80,
          path: (u.pathname || '/') + (u.search || ''),
          method,
          headers: h,
          insecureHTTPParser: true,
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size <= maxBytes) chunks.push(c);
          });
          res.on('end', () => finish({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), error: null }));
          res.on('error', (err) => finish({ status: 0, body: '', error: errMsg(err) }));
        },
      );
      req.on('error', (err) => finish({ status: 0, body: '', error: `HTTP ${method} ${url}: ${errMsg(err)}` }));
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      finish({ status: 0, body: '', error: errMsg(err) });
    }
  });
}

// ---------- XML (regex based, namespace tolerant) ----------

function xmlDecode(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// First <name>...</name> (any namespace prefix), decoded; null when missing.
function xmlTag(xml, name) {
  const re = new RegExp(`<(?:[\\w-]+:)?${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${escapeRe(name)}\\s*>`, 'i');
  const m = re.exec(xml || '');
  return m ? xmlDecode(m[1]) : null;
}

// Every <name>...</name> block, raw (not decoded) so it can be searched further.
function xmlBlocks(xml, name) {
  const re = new RegExp(`<(?:[\\w-]+:)?${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${escapeRe(name)}\\s*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml || ''))) out.push(m[1]);
  return out;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  DEFAULT_TIMEOUT,
  isWin,
  isMac,
  decode,
  run,
  runPowerShell,
  asArray,
  normalizeMac,
  isRandomizedMac,
  isMulticastMac,
  isIPv4,
  ipToInt,
  intToIp,
  prefixToMask,
  maskToPrefix,
  sameSubnet,
  isPrivateIPv4,
  isLoopback,
  isMulticastIPv4,
  withTimeout,
  mapLimit,
  errMsg,
  httpRequest,
  xmlDecode,
  xmlTag,
  xmlBlocks,
  xmlEscape,
};
