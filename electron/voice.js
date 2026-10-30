'use strict';

// Push-to-talk support in the main process: microphone permission for Bastion's own page only
// (audio, never video), and the macOS microphone prompt. Speech is turned into text in the
// renderer (renderer/js/voice/), on this computer; no audio ever reaches this process.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { session, systemPreferences } = require('electron');

const RENDERER_DIR = pathToFileURL(path.join(__dirname, '..', 'renderer')).href + '/';

// Bastion's own file:// page (renderer/...). Case-insensitive on Windows paths.
function isOwnPage(url) {
  if (typeof url !== 'string' || !url.startsWith('file://')) return false;
  const u = process.platform === 'win32' ? url.toLowerCase() : url;
  const base = process.platform === 'win32' ? RENDERER_DIR.toLowerCase() : RENDERER_DIR;
  return u.startsWith(base);
}

function urlOf(webContents, details) {
  if (details && typeof details.requestingUrl === 'string' && details.requestingUrl) return details.requestingUrl;
  try { return webContents ? webContents.getURL() : ''; } catch { return ''; }
}

// Called once when the app is ready.
function setupPermissions(ses = session.defaultSession) {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const own = isOwnPage(urlOf(webContents, details));
    if (permission === 'media') {
      const types = (details && Array.isArray(details.mediaTypes)) ? details.mediaTypes : [];
      callback(own && types.length > 0 && types.every((t) => t === 'audio'));
      return;
    }
    // Everything else keeps Electron's default (granted), but only for Bastion's own page.
    callback(own);
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'media') {
      const type = details && details.mediaType;
      return type !== 'video' && isOwnPage(urlOf(webContents, details));
    }
    return isOwnPage(urlOf(webContents, details)) || requestingOrigin === 'file:///' || requestingOrigin === 'file://';
  });
}

// { granted, status }. macOS asks once (system prompt); Windows reports its privacy switch.
async function ensureMicAccess() {
  let status = 'unknown';
  try {
    if (typeof systemPreferences.getMediaAccessStatus === 'function') {
      status = systemPreferences.getMediaAccessStatus('microphone');
    }
  } catch {
    status = 'unknown';
  }
  if (process.platform === 'darwin' && status !== 'granted') {
    if (status === 'not-determined') {
      try {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        return { granted: Boolean(granted), status: granted ? 'granted' : 'denied', platform: 'darwin' };
      } catch {
        return { granted: false, status: 'unknown', platform: 'darwin' };
      }
    }
    return { granted: false, status, platform: 'darwin' };
  }
  return { granted: status !== 'denied' && status !== 'restricted', status, platform: process.platform };
}

function register(ipcMain) {
  ipcMain.handle('voice:ensure-mic-access', async (event) => {
    try {
      if (!isOwnPage(event.senderFrame ? event.senderFrame.url : '')) return { granted: false, status: 'denied' };
      return await ensureMicAccess();
    } catch (err) {
      return { granted: false, status: 'unknown', error: String((err && err.message) || err) };
    }
  });
}

module.exports = { register, setupPermissions, ensureMicAccess, isOwnPage };
