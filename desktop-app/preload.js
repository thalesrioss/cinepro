// =============================================================
//  CinePRO Desktop — Preload (bridge segura main ↔ renderer)
// =============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cinepro', {
  openExternal:         (url) => ipcRenderer.invoke('open-external', url),
  openPremiere:         ()    => ipcRenderer.invoke('open-premiere'),
  cache: {
    size:  () => ipcRenderer.invoke('cache:size'),
    clear: () => ipcRenderer.invoke('cache:clear'),
  },
  isPluginInstalled:    ()    => ipcRenderer.invoke('check-plugin-installed'),
  appVersion:           ()    => ipcRenderer.invoke('app:version'),
  installAsset:         (a)   => ipcRenderer.invoke('install-asset', a),
  libraryDownload:      (a)   => ipcRenderer.invoke('library:download', a),
  resolveSend:          (a)   => ipcRenderer.invoke('resolve:send', a),
  resolveStatus:        ()    => ipcRenderer.invoke('resolve:status'),
  startDrag:            (p)   => ipcRenderer.send('library:dragstart', p),
  // Auto-update: baixa o instalador no próprio app e abre
  updateDownload:       (a)   => ipcRenderer.invoke('update:download', a),
  updateInstall:        (p)   => ipcRenderer.invoke('update:install', p),
  onUpdateProgress:     (cb)  => ipcRenderer.on('update:progress', (_e, pct) => cb(pct)),
  platform:             process.platform,
});
