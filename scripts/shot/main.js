// Usage: SHOT_URL=http://localhost:4173/ SHOT_SCROLLS=0,600 npx electron scripts/shot
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Config comes from env vars: the Electron CLI treats URL arguments as apps to open.
const { SHOT_URL: url, SHOT_OUT: outDir = '.shots', SHOT_W: w = '1440', SHOT_H: h = '900', SHOT_SCROLLS: scrolls = '0' } = process.env;

app.whenReady().then(async () => { try {
  const win = new BrowserWindow({
    width: Number(w), height: Number(h), show: false, useContentSize: true,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadURL(url);
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(9000);
  for (const y of scrolls.split(',').map(Number)) {
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${y})`);
    await wait(2500);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `shot-${w}-${y}.png`), img.toPNG());
  }
  } catch (err) { console.error("shot failed:", err); }
  app.quit();
});
