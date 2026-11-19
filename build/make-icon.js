// Renders build/icon.svg to build/icon.png (512×512) using Electron itself.
// Run: npx electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8').replace('<svg', '<svg width="512" height="512"');
  const w = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  w.webContents.setZoomFactor(1);
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`));
  await new Promise(r => setTimeout(r, 600));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  console.log('icon.png written', img.getSize());
  app.quit();
});
