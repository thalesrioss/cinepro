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

// ── v1.6: Instalar LUT / MOGRT / Preset nas pastas do Premiere ──────
// Cada tipo vai pra pasta padrão do USUÁRIO (sem admin) que o Premiere lê.
const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';
const ADOBE_COMMON = IS_WIN
  ? path.join(HOME, 'AppData', 'Roaming', 'Adobe', 'Common')
  : path.join(HOME, 'Library', 'Application Support', 'Adobe', 'Common');

// Acha as pastas de Presets dos perfis do Premiere (Documents/Adobe/Premiere Pro/<ver>/Profile-*/Presets).
// Retorna todas as encontradas (instala em todas → aparece em qualquer versão aberta).
function findPresetDirs() {
  var base = path.join(HOME, 'Documents', 'Adobe', 'Premiere Pro');
  var out = [];
  try {
    if (!fs.existsSync(base)) return out;
    for (const ver of fs.readdirSync(base)) {
      const verDir = path.join(base, ver);
      if (!fs.statSync(verDir).isDirectory()) continue;
      for (const entry of fs.readdirSync(verDir)) {
        if (entry.indexOf('Profile-') === 0) {
          out.push(path.join(verDir, entry, 'Presets'));
        }
      }
    }
  } catch (e) {/* ignora */}
  return out;
}

// v1.6.1: pasta de LUTs do DaVinci Resolve — só entra se o Resolve existir
// na máquina (não cria pastas órfãs pra quem não usa Resolve).
function resolveLutDirs() {
  const candidates = IS_WIN
    ? [path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'LUT')]
    : [path.join('/Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', 'LUT'),
       path.join(HOME, 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', 'LUT')];
  const out = [];
  for (const base of candidates) {
    try { if (fs.existsSync(base)) out.push(path.join(base, 'CinePRO')); } catch (e) {}
  }
  return out;
}

// Resolve o(s) diretório(s) de destino por tipo de arquivo.
function destDirsFor(kind, ext) {
  ext = (ext || '').toLowerCase();
  if (kind === 'lut' || ext === 'cube' || ext === '3dl') {
    // Premiere sempre; Resolve também, se instalado (LUT é formato universal)
    return [path.join(ADOBE_COMMON, 'LUTs', 'Creative')].concat(resolveLutDirs());
  }
  if (kind === 'mogrt' || ext === 'mogrt') {
    return [path.join(ADOBE_COMMON, 'Motion Graphics Templates')];
  }
  if (kind === 'preset' || ext === 'prfpset') {
    return findPresetDirs();
  }
  return [];
}

// Download seguro com failover entre URLs (CDN → Drive). Segue redirect.
function downloadBuffer(urls) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    let i = 0;
    function tryNext() {
      if (i >= urls.length) return reject(new Error('todas as rotas falharam'));
      const url = urls[i++];
      const req = https.get(url, { timeout: 60000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // redirect (usercontent) → segue
          https.get(res.headers.location, (r2) => collect(r2, resolve, tryNext)).on('error', tryNext);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); return tryNext(); }
        collect(res, resolve, tryNext);
      });
      req.on('error', tryNext);
      req.on('timeout', () => { req.destroy(); tryNext(); });
    }
    function collect(res, ok, fail) {
      const ct = (res.headers['content-type'] || '');
      if (ct.indexOf('text/html') !== -1) { res.resume(); return fail(); } // não é o arquivo
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok(Buffer.concat(chunks)));
      res.on('error', fail);
    }
    tryNext();
  });
}

ipcMain.handle('install-asset', async (_e, asset) => {
  try {
    const { kind, ext, name, urls } = asset || {};
    if (!urls || !urls.length) return { ok: false, error: 'sem URL de download' };
    const dirs = destDirsFor(kind, ext);
    if (!dirs.length) {
      return { ok: false, error: kind === 'preset'
        ? 'Nenhum perfil do Premiere encontrado. Abra o Premiere ao menos uma vez e tente de novo.'
        : 'Tipo não suportado pra instalação.' };
    }
    const buf = await downloadBuffer(urls);
    const safe = String(name || 'arquivo').replace(/[^a-zA-Z0-9_\-\. ]/g, '_');
    const fileName = safe.toLowerCase().endsWith('.' + ext) ? safe : safe + '.' + ext;
    let written = 0;
    for (const dir of dirs) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fileName), buf);
        written++;
      } catch (e) {/* tenta os outros */}
    }
    if (!written) return { ok: false, error: 'sem permissão de escrita na pasta do Premiere' };
    return { ok: true, dir: dirs[0], count: written };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// ── App lifecycle ────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
