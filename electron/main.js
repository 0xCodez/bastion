'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');

const engine = require('../engine');
const agents = require('../agents');
const icons = require('../engine/icons');

const isDev = process.argv.includes('--dev');
let win = null;

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#07060E',
    show: false,
    title: 'Bastion',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: '#07060E', symbolColor: '#ABA6CB', height: 64 } : undefined,
    trafficLightPosition: { x: 20, y: 25 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !process.env.BASTION_SNAPSHOT, // QA snapshots render in a hidden window
      spellcheck: false,
    },
  });

  // QA snapshot runs (BASTION_SNAPSHOT) stay invisible so they never pop up on the desktop.
  if (!process.env.BASTION_SNAPSHOT) win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  // Renderer warnings and errors go to stdout so they show up in terminal runs.
  win.webContents.on('console-message', (event) => {
    const level = event.level;
    if (level === 'warning' || level === 'error' || level === 2 || level === 3) {
      console.log(`[renderer:${level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    }
  });

  // BASTION_SNAPSHOT=<dir> saves screenshots of every view after start-up (used for QA runs).
  const snapshotDir = process.env.BASTION_SNAPSHOT;
  if (snapshotDir) {
    win.webContents.once('did-finish-load', () => takeSnapshots(snapshotDir));
  }

  // Links never navigate the app window; https links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

async function takeSnapshots(dir) {
  const fs = require('node:fs');
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shoot = async (name) => {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
  };
  // BASTION_SNAPSHOT_VIEWS=shield,speed limits the views; every view is also shot scrolled down.
  const views = (process.env.BASTION_SNAPSHOT_VIEWS || 'home,shield,speed,devices,agents,settings').split(',');
  const scrollAll = (y) => win.webContents.executeJavaScript(`(() => {
    const els = [document.scrollingElement, ...document.querySelectorAll('*')].filter((el) => el && el.scrollHeight > el.clientHeight + 40 && (el === document.scrollingElement || /auto|scroll/.test(getComputedStyle(el).overflowY)));
    els.forEach((el) => { el.scrollTop = ${y}; });
  })()`);
  await wait(14000); // first scan + intro
  for (const id of views) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-view="${id}"]')?.click()`);
    await wait(3000);
    await shoot(id);
    await scrollAll(760);
    await wait(1500);
    await shoot(`${id}-2`);
    await scrollAll(0);
  }
  console.log(`[snapshot] saved to ${dir}`);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Wraps a handler so the renderer always gets data, never an unhandled rejection.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), errors: [String((err && err.message) || err)] };
    }
  });
}

function registerIpc() {
  handle('network:overview', () => engine.overview());
  handle('network:devices', () => engine.devices());
  handle('network:connections', () => engine.connections());
  handle('network:scan', () => engine.scan((p) => send('network:scan-progress', p)));

  handle('wifi:info', () => engine.wifiInfo());
  handle('wifi:survey', () => engine.wifiSurvey());

  handle('dns:status', () => engine.dnsStatus());

  handle('speed:run', () => engine.speedTest((p) => send('speed:progress', p)));
  handle('speed:cancel', () => engine.cancelSpeedTest());

  handle('fix:open', (target) => engine.openFix(target, shell));
  handle('app:open-external', (url) => {
    if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url);
    return { ok: true };
  });

  // { refresh: true } (Settings "Check again") re-checks the subscription CLIs now.
  handle('agents:providers', (opts) => agents.providers({ refresh: Boolean(opts && opts.refresh === true) }));
  handle('agents:set-key', (id, key) => agents.setKey(id, key));
  handle('agents:clear-key', (id) => agents.clearKey(id));
  handle('agents:set-model', (id, model) => agents.setModel(id, model));
  handle('agents:test', (id) => agents.test(id));
  handle('agents:ask', (id, question, snapshot) => agents.ask(id, question, snapshot));
  handle('agents:cancel', (id) => agents.cancel(id));

  // App icons from the user's installed applications (see engine/icons.js).
  handle('icons:processes', (list, opts) => icons.forProcesses(Array.isArray(list) ? list.slice(0, 400) : [], {
    known: opts && Array.isArray(opts.known) ? opts.known.slice(0, 2000) : [],
  }));
  handle('icons:providers', async () => {
    let keyIds = [];
    try {
      const list = await agents.providers();
      // A ready subscription CLI counts like a saved key for its provider's icon.
      const BASE = { 'claude-cli': 'claude', 'codex-cli': 'openai' };
      if (Array.isArray(list)) keyIds = [...new Set(list.filter((p) => p && p.hasKey).map((p) => BASE[p.id] || p.id))];
    } catch {
      keyIds = [];
    }
    return icons.providers({ keyIds });
  });

  // Tips and feedback (electron/support.js).
  require('./support').register(ipcMain);

  // Push-to-talk: macOS microphone prompt (electron/voice.js).
  require('./voice').register(ipcMain);
}

app.whenReady().then(() => {
  agents.init(app.getPath('userData'));
  require('./voice').setupPermissions(); // microphone (audio only) for Bastion's own page
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// No Claude Code / Codex run outlives Bastion (they run in their own process
// group, and their timeouts live in this process).
app.on('before-quit', () => {
  agents.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
