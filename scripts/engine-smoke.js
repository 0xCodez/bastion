'use strict';

// Runs the network engine against the real network of this computer (read-only checks).
// Usage: node scripts/engine-smoke.js [--speed]

const engine = require('../engine');

const withSpeed = process.argv.includes('--speed');

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { label, ms: Date.now() - t0, value };
  } catch (err) {
    return { label, ms: Date.now() - t0, value: { thrown: String((err && err.message) || err) } };
  }
}

function errorsOf(v) {
  return v && Array.isArray(v.errors) ? v.errors : [];
}

async function main() {
  const out = {};

  const ov = await timed('overview', () => engine.overview());
  out.overview = { ms: ov.ms, ...ov.value };

  const dev = await timed('devices', () => engine.devices());
  out.devices = { ms: dev.ms, count: dev.value.length, list: dev.value, errors: errorsOf(dev.value) };

  const con = await timed('connections', () => engine.connections());
  const list = Array.isArray(con.value) ? con.value : [];
  out.connections = {
    ms: con.ms,
    count: list.length,
    tcpEstablished: list.filter((c) => c.protocol === 'tcp' && c.state === 'ESTABLISHED').length,
    tcpListening: list.filter((c) => c.protocol === 'tcp' && c.state === 'LISTEN').length,
    udp: list.filter((c) => c.protocol === 'udp').length,
    withProcessName: list.filter((c) => c.process).length,
    sample: list.filter((c) => c.state === 'ESTABLISHED').slice(0, 3),
    errors: errorsOf(con.value),
  };

  const dns = await timed('dns', () => engine.dnsStatus());
  out.dns = { ms: dns.ms, ...dns.value };

  const wi = await timed('wifiInfo', () => engine.wifiInfo());
  out.wifiInfo = { ms: wi.ms, ...wi.value };

  const ws = await timed('wifiSurvey', () => engine.wifiSurvey());
  out.wifiSurvey = {
    ms: ws.ms,
    supported: ws.value.supported,
    networks: (ws.value.networks || []).length,
    current: ws.value.current,
    recommendation: ws.value.recommendation,
    errors: errorsOf(ws.value),
  };

  const progress = [];
  const sc = await timed('scan', () =>
    engine.scan((p) => {
      progress.push(p);
      process.stderr.write(`[scan ${p.index + 1}/${p.total}] ${p.id}${p.status ? ` -> ${p.status}` : ' ...'}\n`);
    }),
  );
  out.scan = {
    ms: sc.ms,
    progressEvents: progress.length,
    score: sc.value.score,
    openPorts: sc.value.openPorts,
    upnpMappings: sc.value.upnpMappings,
    checks: (sc.value.checks || []).map((c) => ({ id: c.id, status: c.status, severity: c.severity, title: c.title, evidence: c.evidence })),
    errors: sc.value.errors,
  };

  if (withSpeed) {
    const sp = await timed('speed', () =>
      engine.speedTest((p) => process.stderr.write(`[speed] ${p.phase} ${Math.round((p.progress || 0) * 100)}%\n`)),
    );
    out.speed = { ms: sp.ms, ...sp.value };
  }

  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`engine smoke failed: ${(err && err.stack) || err}\n`);
    process.exit(1);
  },
);
