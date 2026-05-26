// =============================================================
//  CinePRO Desktop — Main process (Electron)
// =============================================================

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const APP_NAME = 'CinePRO';
const CACHE_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'CinePRO', 'cache');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  920,
    height: 640,
    minWidth:  720,
    minHeight: 540,
    backgroundColor: '#07090F',
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Abrir links externos no navegador padrão
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── IPC handlers ─────────────────────────────────────────

ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));

ipcMain.handle('open-premiere', () => {
  // macOS: usa `open -a` pra abrir o Premiere
  // Windows: tenta achar o .exe padrão
  if (process.platform === 'darwin') {
    require('child_process').exec('open -a "Adobe Premiere Pro 2024" || open -a "Adobe Premiere Pro 2025" || open -a "Adobe Premiere Pro"');
  } else {
    const candidates = [
      'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2025\\Adobe Premiere Pro.exe',
      'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2024\\Adobe Premiere Pro.exe',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        require('child_process').spawn(p, [], { detached: true });
        return true;
      }
    }
  }
  return true;
});

ipcMain.handle('cache:size', () => {
  try {
    if (!fs.existsSync(CACHE_DIR)) return { bytes: 0, count: 0 };
    let bytes = 0, count = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      const stat = fs.statSync(path.join(CACHE_DIR, f));
      if (stat.isFile()) { bytes += stat.size; count++; }
    }
    return { bytes, count };
  } catch (e) {
    return { bytes: 0, count: 0, error: e.message };
  }
});

ipcMain.handle('cache:clear', async () => {
  try {
    if (!fs.existsSync(CACHE_DIR)) return { removed: 0 };
    let removed = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      const p = path.join(CACHE_DIR, f);
      if (fs.statSync(p).isFile()) {
        fs.unlinkSync(p);
        removed++;
      }
    }
    return { removed };
  } catch (e) {
    return { removed: 0, error: e.message };
  }
});

ipcMain.handle('check-plugin-installed', () => {
  const pluginPaths = [
    '/Library/Application Support/Adobe/CEP/extensions/CinePRO',
    path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', 'CinePRO'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Adobe', 'CEP', 'extensions', 'CinePRO'),
  ];
  return pluginPaths.some(p => fs.existsSync(p));
});

ipcMain.handle('app:version', () => app.getVersion());

// ── App lifecycle ────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
