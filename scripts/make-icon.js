'use strict';

// Renders build/icon.svg to build/icon.png (1024x1024, transparent corners).
// Run with: npm run icon   (or: npx electron scripts/make-icon.js)

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const SIZE = 1024;
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'build', 'icon.svg');
const pngPath = path.join(root, 'build', 'icon.png');

app.disableHardwareAcceleration();

function fail(message) {
  console.error(`make-icon: ${message}`);
  app.exit(1);
}

app.whenReady().then(async () => {
  let svg;
  try {
    svg = fs.readFileSync(svgPath, 'utf8');
  } catch (err) {
    fail(`cannot read ${svgPath}: ${err.message}`);
    return;
  }

  const html = '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;padding:0;background:transparent;overflow:hidden}'
    + `svg{display:block;width:${SIZE}px;height:${SIZE}px}`
    + '</style></head><body>' + svg + '</body></html>';

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const timer = setTimeout(() => fail('timed out while rendering'), 20000);

  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Give the compositor a couple of frames so blur filters are painted.
    await new Promise((resolve) => setTimeout(resolve, 600));
    let image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
    const { width, height } = image.getSize();
    if (!width || !height) throw new Error('captured an empty image');
    if (width !== SIZE || height !== SIZE) image = image.resize({ width: SIZE, height: SIZE, quality: 'best' });
    fs.writeFileSync(pngPath, image.toPNG());
    clearTimeout(timer);
    console.log(`make-icon: wrote ${path.relative(root, pngPath)} (${SIZE}x${SIZE})`);
    app.exit(0);
  } catch (err) {
    clearTimeout(timer);
    fail(String((err && err.message) || err));
  }
});
