'use strict';

const { isWin, isMac, isIPv4, isPrivateIPv4, errMsg } = require('./util');
const { defaultRoute } = require('./system');

const TARGETS = {
  win32: {
    'dns-settings': 'ms-settings:network-status',
    'wifi-settings': 'ms-settings:network-wifi',
    'mac-privacy': 'ms-settings:network-wifi',
  },
  darwin: {
    'dns-settings': 'x-apple.systempreferences:com.apple.Network-Settings.extension',
    'wifi-settings': 'x-apple.systempreferences:com.apple.wifi-settings-extension',
    'mac-privacy': 'x-apple.systempreferences:com.apple.wifi-settings-extension',
  },
};

// Opens the settings page or router admin page for a guided fix. Never changes anything itself.
// `shell` is Electron's shell module (passed in so the engine stays free of Electron).
async function openFix(target, shell) {
  try {
    if (!shell || typeof shell.openExternal !== 'function') return { ok: false, error: 'No shell available to open the page.' };
    let url = null;
    if (target === 'router-admin') {
      const route = await defaultRoute();
      // Plain HTTP is fine here: the router lives on the local network.
      if (!isIPv4(route.gateway) || !isPrivateIPv4(route.gateway)) {
        return { ok: false, error: 'The router address is unknown or not on the local network.' };
      }
      url = `http://${route.gateway}/`;
    } else if (isWin || isMac) {
      url = (TARGETS[process.platform] || {})[target] || null;
    }
    if (!url) return { ok: false, error: `Unknown fix target: ${String(target)}` };
    await shell.openExternal(url);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

module.exports = { openFix };
