'use strict';

const dgram = require('node:dgram');
const { httpRequest, xmlTag, xmlBlocks, xmlEscape, isPrivateIPv4, errMsg } = require('./util');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'ssdp:all'];
const MAX_MAPPINGS = 64;

function mSearch(st) {
  return Buffer.from(
    'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      `ST: ${st}\r\n` +
      'USER-AGENT: Bastion/0.1 UPnP/1.1\r\n\r\n',
  );
}

function parseHeaders(text) {
  const h = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return h;
}

// Sends M-SEARCH to the multicast group and straight to the gateway. Resolves after waitMs with
// [{ from, location, st, server, usn }] (deduplicated by LOCATION).
function ssdpSearch(localIp, gatewayIp, waitMs = 2500) {
  return new Promise((resolve) => {
    const found = new Map();
    const errors = [];
    let sock;
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (err) {
      resolve({ responses: [], errors: [`SSDP socket failed: ${errMsg(err)}`] });
      return;
    }
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      try {
        sock.close();
      } catch {
        // already closed
      }
      resolve({ responses: [...found.values()], errors });
    };
    let bound = false;
    // Armed before bind: a bind failure arrives as an async 'error' event and must not hang the scan.
    const timer = setTimeout(finish, waitMs + 500);
    sock.on('error', (err) => {
      if (err && err.code === 'ECONNRESET') return; // ICMP noise on Windows
      errors.push(`SSDP: ${errMsg(err)}`);
      if (!bound) {
        clearTimeout(timer);
        finish();
      }
    });
    sock.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8');
      if (!/^HTTP\/1\.[01]\s+200/i.test(text) && !/^NOTIFY/i.test(text)) return;
      const h = parseHeaders(text);
      if (!h.location) return;
      if (!found.has(h.location)) found.set(h.location, { from: rinfo.address, location: h.location, st: h.st || h.nt || '', server: h.server || '', usn: h.usn || '' });
    });
    const sendAll = () => {
      for (const st of SEARCH_TARGETS) {
        const buf = mSearch(st);
        sock.send(buf, SSDP_PORT, SSDP_ADDR, () => {});
        if (gatewayIp) sock.send(buf, SSDP_PORT, gatewayIp, () => {});
      }
    };
    try {
      sock.bind(0, () => {
        bound = true;
        try {
          if (localIp) sock.setMulticastInterface(localIp);
        } catch {
          // keep the default interface
        }
        try {
          sock.setMulticastTTL(2);
        } catch {
          // default TTL is fine
        }
        try {
          sendAll();
          setTimeout(() => !closed && sendAll(), 700); // UDP gets lost; ask twice
        } catch (err) {
          errors.push(`SSDP send failed: ${errMsg(err)}`);
        }
        clearTimeout(timer);
        setTimeout(finish, waitMs);
      });
    } catch (err) {
      errors.push(`SSDP bind failed: ${errMsg(err)}`);
      clearTimeout(timer);
      finish();
    }
  });
}

function resolveUrl(base, rel) {
  try {
    return new URL(rel, base).toString();
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Finds WANIPConnection / WANPPPConnection services in a device description.
// URLBase and controlURL come from whatever LAN device answered, so a control URL is kept only when it
// points at the same private address that served the description (never off the local network).
function findWanServices(xml, location) {
  const base = xmlTag(xml, 'URLBase') || location;
  const home = hostOf(location);
  const out = [];
  for (const block of xmlBlocks(xml, 'service')) {
    const type = xmlTag(block, 'serviceType') || '';
    if (!/WAN(IP|PPP)Connection/i.test(type)) continue;
    const control = xmlTag(block, 'controlURL');
    const url = control ? resolveUrl(base, control) : null;
    const host = url ? hostOf(url) : null;
    if (url && host && host === home && isPrivateIPv4(host)) out.push({ type, controlUrl: url });
  }
  return out;
}

async function soap(service, action, args = {}) {
  const argXml = Object.entries(args).map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`).join('');
  const body =
    '<?xml version="1.0"?>\r\n' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${service.type}">${argXml}</u:${action}></s:Body></s:Envelope>`;
  return httpRequest(service.controlUrl, {
    privateOnly: true,
    method: 'POST',
    timeout: 3000,
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${service.type}#${action}"` },
    body,
  });
}

// { mappings, readable, problem }. readable is false when the router would not list its table at all,
// so "no mappings" cannot be claimed.
async function listMappings(service) {
  const mappings = [];
  let readable = true;
  let problem = null;
  for (let i = 0; i < MAX_MAPPINGS; i++) {
    const res = await soap(service, 'GetGenericPortMappingEntry', { NewPortMappingIndex: i });
    if (res.status !== 200) {
      // A SOAP fault 713 (SpecifiedArrayIndexInvalid) or 714 marks the end of the table.
      const code = res.status === 500 ? xmlTag(res.body, 'errorCode') : null;
      if (code !== '713' && code !== '714') {
        // At index 0 nothing was read; later, the list stopped early and may be incomplete.
        readable = false;
        const why = res.status === 0 ? `no answer (${res.error})` : `UPnP error ${code || res.status}`;
        problem = i === 0 ? why : `the list stopped after ${i} entr${i === 1 ? 'y' : 'ies'}: ${why}`;
      }
      break;
    }
    const port = Number(xmlTag(res.body, 'NewExternalPort'));
    if (!port) {
      if (i === 0) {
        readable = false;
        problem = 'the router answered without a readable entry';
      }
      break;
    }
    mappings.push({
      protocol: (xmlTag(res.body, 'NewProtocol') || '').toUpperCase(),
      externalPort: port,
      internalClient: xmlTag(res.body, 'NewInternalClient') || '',
      internalPort: Number(xmlTag(res.body, 'NewInternalPort')) || null,
      description: xmlTag(res.body, 'NewPortMappingDescription') || '',
      enabled: xmlTag(res.body, 'NewEnabled') !== '0',
      remoteHost: xmlTag(res.body, 'NewRemoteHost') || '',
    });
  }
  return { mappings, readable, problem };
}

// { found, location, server, friendlyName, manufacturer, modelName, externalIp, services, mappings, errors }
async function upnpStatus({ localIp = null, gatewayIp = null } = {}) {
  const result = {
    found: false, location: null, server: null, friendlyName: null, manufacturer: null, modelName: null,
    externalIp: null, services: [], mappings: [], mappingsReadable: true, mappingsProblem: null, errors: [],
  };
  try {
    const search = await ssdpSearch(localIp, gatewayIp);
    result.errors.push(...search.errors);

    // Only look at descriptions served from the local network; prefer the gateway's.
    const candidates = search.responses
      .filter((r) => {
        try {
          return isPrivateIPv4(new URL(r.location).hostname);
        } catch {
          return false;
        }
      })
      .sort((a, b) => Number(b.from === gatewayIp) - Number(a.from === gatewayIp) || Number(/InternetGatewayDevice/i.test(b.st)) - Number(/InternetGatewayDevice/i.test(a.st)));

    for (const c of candidates.slice(0, 12)) {
      const desc = await httpRequest(c.location, { timeout: 3000, privateOnly: true });
      if (desc.status !== 200 || !/InternetGatewayDevice/i.test(desc.body)) continue;
      const services = findWanServices(desc.body, c.location);
      result.found = true;
      result.location = c.location;
      result.server = c.server || null;
      result.friendlyName = xmlTag(desc.body, 'friendlyName');
      result.manufacturer = xmlTag(desc.body, 'manufacturer');
      result.modelName = xmlTag(desc.body, 'modelName');
      result.services = services.map((s) => s.type);
      if (!services.length) {
        result.mappingsReadable = false;
        result.mappingsProblem = 'the router did not describe a WAN connection service on its own address';
      }
      const seenMap = new Set();
      let anyReadable = false;
      for (const s of services) {
        const ext = await soap(s, 'GetExternalIPAddress');
        if (ext.status === 200 && !result.externalIp) result.externalIp = xmlTag(ext.body, 'NewExternalIPAddress') || null;
        const maps = await listMappings(s);
        // WANIPConnection and WANPPPConnection often share one table; list each mapping once.
        for (const m of maps.mappings) {
          const key = `${m.protocol}|${m.externalPort}|${m.remoteHost}`;
          if (seenMap.has(key)) continue;
          seenMap.add(key);
          result.mappings.push(m);
        }
        if (maps.readable) anyReadable = true;
        else if (!result.mappingsProblem) result.mappingsProblem = maps.problem;
      }
      if (services.length) result.mappingsReadable = anyReadable;
      if (anyReadable) result.mappingsProblem = null;
      break;
    }
  } catch (err) {
    result.errors.push(`UPnP check failed: ${errMsg(err)}`);
  }
  return result;
}

module.exports = { upnpStatus, ssdpSearch, _internal: { findWanServices, parseHeaders } };
