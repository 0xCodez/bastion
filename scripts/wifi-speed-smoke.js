'use strict';

// Smoke test for engine/wifi.js and engine/speed.js on the current machine.
// Usage: node scripts/wifi-speed-smoke.js [--speed]
// Read-only. With --speed it runs one bounded speed test (at most ~100 MB down, ~50 MB up).

const { wifiInfo, wifiSurvey } = require('../engine/wifi');
const { speedTest, cancelSpeedTest } = require('../engine/speed');

async function main() {
  console.log('== wifiInfo ==');
  const t0 = Date.now();
  const info = await wifiInfo();
  console.log(JSON.stringify(info, null, 2));
  console.log(`(${Date.now() - t0} ms)`);

  console.log('\n== wifiSurvey ==');
  const t1 = Date.now();
  const survey = await wifiSurvey();
  console.log(`supported: ${survey.supported}, networks: ${survey.networks.length}, current: ${JSON.stringify(survey.current)}`);
  for (const n of survey.networks.slice(0, 20)) {
    const name = n.ssid || '(hidden)';
    console.log(`  ${String(n.band).padEnd(4)} ch ${String(n.channel).padStart(3)}  ${String(n.signalPct ?? '?').padStart(3)}%  ${String(n.rssi ?? '?').padStart(4)} dBm  ${n.bssid || '-'}  ${name}`);
  }
  if (survey.networks.length > 20) console.log(`  ... ${survey.networks.length - 20} more`);
  console.log('congestion: ' + survey.congestion.map((c) => `${c.band}/${c.channel}=${c.count}`).join('  '));
  console.log('recommendation: ' + JSON.stringify(survey.recommendation, null, 2));
  console.log('errors: ' + JSON.stringify(survey.errors));
  console.log(`(${Date.now() - t1} ms)`);

  if (!process.argv.includes('--speed')) return;

  console.log('\n== speedTest ==');
  process.on('SIGINT', () => {
    console.log('\ncancelling...');
    cancelSpeedTest();
  });
  let lastLine = 0;
  let lastPhase = '';
  const t2 = Date.now();
  const result = await speedTest((p) => {
    const now = Date.now();
    // Print about twice a second plus every phase change, to keep the log readable.
    if (p.phase !== lastPhase || now - lastLine >= 500) {
      lastLine = now;
      lastPhase = p.phase;
      const parts = [`${p.phase.padEnd(8)}`, `progress ${(p.progress * 100).toFixed(0).padStart(3)}%`];
      if (p.mbps != null) parts.push(`${p.mbps.toFixed(1)} Mbps`);
      if (p.pingMs != null) parts.push(`ping ${p.pingMs} ms`);
      console.log('  ' + parts.join('  '));
    }
  });
  console.log(JSON.stringify(result, null, 2));
  console.log(`(${((Date.now() - t2) / 1000).toFixed(1)} s)`);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exitCode = 1;
});
