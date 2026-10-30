'use strict';

// Network engine entry point: exactly the surface electron/main.js calls.
// Every function resolves (never rejects) with the shapes defined in docs/CONTRACT.md.

const { errMsg } = require('./util');
const system = require('./system');
const devicesMod = require('./devices');
const connectionsMod = require('./connections');
const dnsMod = require('./dns');
const scanMod = require('./scan');
const fixes = require('./fixes');

// Wi-Fi and speed live in their own modules; a load failure degrades to "unsupported", never a crash.
function load(name) {
  try {
    return { mod: require(name), error: null };
  } catch (err) {
    return { mod: null, error: `${name} failed to load: ${errMsg(err)}` };
  }
}
const wifi = load('./wifi');
const speed = load('./speed');

function emptyWifiInfo(errors) {
  return {
    supported: false, ssid: null, bssid: null, band: null, channel: null, widthMHz: null, rssi: null, signalPct: null,
    rxMbps: null, txMbps: null, security: null, nomap: null, errors,
  };
}

function emptySurvey(errors) {
  return { supported: false, networks: [], congestion: [], current: { channel: null, band: null }, recommendation: null, errors };
}

// Nothing was measured: numbers are null (not 0) so the UI shows "not measured" instead of "0 Mbps".
function emptySpeed(errors) {
  return { supported: false, pingMs: null, jitterMs: null, downMbps: null, upMbps: null, server: '', at: new Date().toISOString(), errors };
}

// An empty list whose `errors` explain why; empty plus errors means "unknown", not "none".
function emptyList(errors) {
  const list = [];
  list.errors = errors;
  return list;
}

async function guard(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    return fallback([errMsg(err)]);
  }
}

module.exports = {
  overview: () => system.overview(),
  devices: () => guard(() => devicesMod.devices(), emptyList),
  connections: () => guard(() => connectionsMod.connections(), emptyList),
  scan: (onProgress) =>
    guard(() => scanMod.scan(onProgress), (errors) => {
      const now = new Date().toISOString();
      return { startedAt: now, finishedAt: now, score: 0, checks: [], upnpMappings: [], openPorts: [], errors };
    }),
  wifiInfo: () => (wifi.mod ? guard(() => wifi.mod.wifiInfo(), emptyWifiInfo) : Promise.resolve(emptyWifiInfo([wifi.error]))),
  wifiSurvey: () => (wifi.mod ? guard(() => wifi.mod.wifiSurvey(), emptySurvey) : Promise.resolve(emptySurvey([wifi.error]))),
  dnsStatus: () => dnsMod.dnsStatus(),
  speedTest: (onProgress) => (speed.mod ? guard(() => speed.mod.speedTest(onProgress), emptySpeed) : Promise.resolve(emptySpeed([speed.error]))),
  cancelSpeedTest: () => {
    try {
      if (speed.mod) speed.mod.cancelSpeedTest();
    } catch {
      // nothing running
    }
  },
  openFix: (target, shell) => fixes.openFix(target, shell),
};
