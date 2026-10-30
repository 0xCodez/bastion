'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');

const engine = require('../engine');
const agents = require('../agents');

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
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
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
  await wait(14000); // first scan + intro
  await shoot('home');
  for (const id of ['shield', 'speed', 'devices', 'agents', 'settings']) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-view="${id}"]')?.click()`);
    await wait(2500);
    await shoot(id);
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

  handle('agents:providers', () => agents.providers());
  handle('agents:set-key', (id, key) => agents.setKey(id, key));
  handle('agents:clear-key', (id) => agents.clearKey(id));
  handle('agents:set-model', (id, model) => agents.setModel(id, model));
  handle('agents:test', (id) => agents.test(id));
  handle('agents:ask', (id, question, snapshot) => agents.ask(id, question, snapshot));
}

app.whenReady().then(() => {
  agents.init(app.getPath('userData'));
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
