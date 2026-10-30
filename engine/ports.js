'use strict';

const net = require('node:net');
const { isIPv4, mapLimit } = require('./util');

// TCP ports probed on the router. UDP services (UPnP SSDP on 1900) are covered by upnp.js.
const GATEWAY_PORTS = [
  { port: 21, service: 'FTP' },
  { port: 22, service: 'SSH' },
  { port: 23, service: 'Telnet' },
  { port: 53, service: 'DNS' },
  { port: 80, service: 'HTTP (admin page)' },
  { port: 443, service: 'HTTPS (admin page)' },
  { port: 4567, service: 'TR-069 (provider management, alternate)' },
  { port: 5000, service: 'UPnP / web service' },
  { port: 7547, service: 'TR-069 / CWMP (provider remote management)' },
  { port: 8080, service: 'HTTP (alternate admin)' },
  { port: 8291, service: 'MikroTik Winbox' },
  { port: 8443, service: 'HTTPS (alternate admin)' },
  { port: 9000, service: 'Web service' },
  { port: 30005, service: 'TR-069 (provider management, alternate)' },
  { port: 49152, service: 'UPnP control' },
  { port: 52869, service: 'UPnP (Realtek SDK)' },
];

// Resolves 'open' | 'closed' | 'filtered'.
function probe(host, port, timeout = 900) {
  return new Promise((resolve) => {
    let done = false;
    const sock = new net.Socket();
    const finish = (state) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(state);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish('open'));
    sock.once('timeout', () => finish('filtered'));
    sock.once('error', (err) => finish(err && err.code === 'ECONNREFUSED' ? 'closed' : 'filtered'));
    try {
      sock.connect(port, host);
    } catch {
      finish('filtered');
    }
  });
}

// { open: [{ port, service }], results: { [port]: state }, errors }
async function probeGateway(host, list = GATEWAY_PORTS) {
  if (!isIPv4(host)) return { open: [], results: {}, errors: ['No gateway address, so router ports were not probed.'] };
  const results = {};
  await mapLimit(list, 16, async ({ port }) => {
    results[port] = await probe(host, port);
  });
  const open = list.filter(({ port }) => results[port] === 'open').map(({ port, service }) => ({ port, service }));
  return { open, results, errors: [] };
}

module.exports = { probe, probeGateway, GATEWAY_PORTS };
