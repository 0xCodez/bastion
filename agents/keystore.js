'use strict';

// API keys for AI providers, encrypted at rest with Electron safeStorage
// (DPAPI on Windows, Keychain on macOS). Keys are only ever decrypted inside
// the main process, right before a request. They are never returned to the
// renderer and never logged.

const fs = require('node:fs');
const path = require('node:path');

const KEYS_FILE = 'agent-keys.json';
const SETTINGS_FILE = 'agent-settings.json';

let baseDir = null;

function init(userDataDir) {
  baseDir = typeof userDataDir === 'string' && userDataDir ? userDataDir : null;
  if (baseDir) {
    try {
      fs.mkdirSync(baseDir, { recursive: true });
    } catch {
      // Reported later as a write error.
    }
  }
  return { ok: Boolean(baseDir) };
}

// Electron is required lazily so plain Node scripts can load this module.
// Outside Electron, require('electron') resolves to the binary path string,
// which has no safeStorage: treated as "encryption unavailable".
function safeStorage() {
  try {
    const electron = require('electron');
    if (electron && typeof electron === 'object' && electron.safeStorage) return electron.safeStorage;
  } catch {
    // Not running inside Electron.
  }
  return null;
}

function encryptionAvailable() {
  const ss = safeStorage();
  try {
    return Boolean(ss && ss.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function filePath(name) {
  return baseDir ? path.join(baseDir, name) : null;
}

function readJson(name) {
  const p = filePath(name);
  if (!p) return {};
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// Atomic write: temp file + rename, owner-only permissions where supported.
function writeJson(name, data) {
  const p = filePath(name);
  if (!p) return { ok: false, error: 'Key storage is not initialized.' };
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, p);
    return { ok: true };
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Nothing to clean up.
    }
    return { ok: false, error: `Could not save settings: ${(err && err.code) || 'write failed'}` };
  }
}

function setKey(id, key) {
  if (!baseDir) return { ok: false, error: 'Key storage is not initialized.' };
  if (!encryptionAvailable()) {
    return {
      ok: false,
      error: 'Secure storage is not available right now, so the key was not saved. '
        + 'Bastion only stores keys encrypted by the system (Windows DPAPI or macOS Keychain). '
        + 'Make sure you are signed in to your own user account and try again.',
    };
  }
  let encrypted;
  try {
    encrypted = safeStorage().encryptString(key).toString('base64');
  } catch {
    return { ok: false, error: 'Could not encrypt the key.' };
  }
  const keys = readJson(KEYS_FILE);
  keys[id] = { v: 1, data: encrypted, savedAt: new Date().toISOString() };
  return writeJson(KEYS_FILE, keys);
}

// Returns the decrypted key or null. Main-process use only.
function getKey(id) {
  const entry = readJson(KEYS_FILE)[id];
  if (!entry || typeof entry.data !== 'string') return null;
  const ss = safeStorage();
  if (!ss || !encryptionAvailable()) return null;
  try {
    const key = ss.decryptString(Buffer.from(entry.data, 'base64'));
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}

// Presence only; does not decrypt.
function hasKey(id) {
  const entry = readJson(KEYS_FILE)[id];
  return Boolean(entry && typeof entry.data === 'string' && entry.data);
}

function clearKey(id) {
  if (!baseDir) return { ok: false, error: 'Key storage is not initialized.' };
  const keys = readJson(KEYS_FILE);
  if (!(id in keys)) return { ok: true };
  delete keys[id];
  return writeJson(KEYS_FILE, keys);
}

function getModel(id) {
  const entry = readJson(SETTINGS_FILE)[id];
  return entry && typeof entry.model === 'string' && entry.model ? entry.model : null;
}

function setModel(id, model) {
  if (!baseDir) return { ok: false, error: 'Key storage is not initialized.' };
  const settings = readJson(SETTINGS_FILE);
  settings[id] = { ...(settings[id] || {}), model };
  return writeJson(SETTINGS_FILE, settings);
}

module.exports = { init, setKey, getKey, hasKey, clearKey, getModel, setModel, encryptionAvailable };
