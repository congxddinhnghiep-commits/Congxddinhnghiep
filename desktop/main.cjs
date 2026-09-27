// Electron shell (Phase 2 – not built yet). Starts the same Express server locally
// and opens it in a desktop window. See desktop/README.md.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
process.env.LOCAL_MODE = 'true';
process.env.DATA_DIR = process.env.DATA_DIR || path.join(app.getPath('userData'), 'data');

async function start() {
  await import(path.join(__dirname, '..', 'packages', 'server', 'dist', 'index.js'));
  const win = new BrowserWindow({ width: 1400, height: 900, title: 'DUTOAN-AI' });
  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
