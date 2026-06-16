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
  platform:             process.platform,
});
