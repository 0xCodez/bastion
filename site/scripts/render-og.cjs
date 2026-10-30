'use strict';

// Rasterises public/og-image.svg -> public/og-image.png (1200x630) and build/icon.svg ->
// public/apple-touch-icon.png (180x180) with the real web fonts embedded.
// Optional, run by hand after changing the artwork. Uses the Electron that the app already
// depends on, from the repo root:
//
//   npx electron site/scripts/render-og.cjs

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const site = path.join(__dirname, '..');
const repo = path.join(site, '..');
const nm = path.join(site, 'node_modules');

function font(family, file, weight) {
  const data = fs.readFileSync(path.join(nm, file)).toString('base64');
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2')}`;
}

const FONTS = [
  font('Bricolage Grotesque Variable', '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2', '200 800'),
  font('Plus Jakarta Sans', '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-500-normal.woff2', 500),
  font('JetBrains Mono', '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2', 500),
].join('');

const JOBS = [
  { svg: path.join(site, 'public', 'og-image.svg'), out: path.join(site, 'public', 'og-image.png'), w: 1200, h: 630, bg: '#07060E' },
  { svg: path.join(repo, 'build', 'icon.svg'), out: path.join(site, 'public', 'apple-touch-icon.png'), w: 180, h: 180, bg: '#000000' },
];

app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* keep running between jobs */ });

async function render(job) {
  const svg = fs.readFileSync(job.svg, 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
    html,body{margin:0;padding:0;overflow:hidden;background:${job.bg}}
    svg{display:block;width:${job.w}px;height:${job.h}px}</style></head><body>${svg}</body></html>`;
  const win = new BrowserWindow({
    width: job.w, height: job.h, useContentSize: true, show: false, frame: false,
    backgroundColor: job.bg,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((r) => setTimeout(r, 700));
  let image = await win.webContents.capturePage({ x: 0, y: 0, width: job.w, height: job.h });
  const size = image.getSize();
  if (size.width !== job.w || size.height !== job.h) image = image.resize({ width: job.w, height: job.h, quality: 'best' });
  fs.writeFileSync(job.out, image.toPNG());
  win.destroy();
  console.log(`render-og: ${path.relative(repo, job.out)} (${job.w}x${job.h})`);
}

app.whenReady().then(async () => {
  const timer = setTimeout(() => { console.error('render-og: timed out'); app.exit(1); }, 30000);
  try {
    for (const job of JOBS) await render(job);
    clearTimeout(timer);
    app.exit(0);
  } catch (err) {
    console.error(`render-og: ${err.message}`);
    app.exit(1);
  }
});
