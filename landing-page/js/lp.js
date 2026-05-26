// =============================================================
//  CinePRO Landing Page — Detecção de SO + CTAs
// =============================================================

// IMPORTANTE: troque essas URLs depois de criar os Releases no GitHub
// Formato típico: https://github.com/SEU_USUARIO/cinepro/releases/latest/download/CinePRO-x.y.z.pkg
var DOWNLOADS = {
  mac:     'https://github.com/SEU_USUARIO/cinepro/releases/latest/download/CinePRO.pkg',
  windows: 'https://github.com/SEU_USUARIO/cinepro/releases/latest/download/CinePRO-Setup.exe',
};

document.addEventListener('DOMContentLoaded', function () {
  detectOSAndRenderCTAs();
  document.getElementById('year').textContent = new Date().getFullYear();
});

function detectOSAndRenderCTAs() {
  var ua = navigator.userAgent;
  var os = 'unknown';

  if (/Mac|iPhone|iPad/.test(ua) || navigator.platform.indexOf('Mac') !== -1) {
    os = 'mac';
  } else if (/Win/.test(ua) || /Windows/.test(ua)) {
    os = 'windows';
  } else if (/Linux/.test(ua)) {
    os = 'linux';
  }

  var primaryBtn   = document.getElementById('btn-download-primary');
  var primaryIcon  = document.getElementById('btn-download-icon');
  var primaryLabel = document.getElementById('btn-download-label');
  var secondaryBtn = document.getElementById('btn-download-secondary');
  var secondaryLbl = document.getElementById('btn-download-secondary-label');
  var meta         = document.getElementById('hero-meta');

  function setupAsLink(btn, url, target) {
    btn.onclick = function () { window.open(url, target || '_self'); };
  }

  if (os === 'mac') {
    primaryIcon.textContent  = '';  // SVG vai substituir
    primaryLabel.innerHTML   = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right:4px;vertical-align:-4px;"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>Baixar pra Mac';
    setupAsLink(primaryBtn, DOWNLOADS.mac);
    secondaryLbl.innerHTML   = 'Tem Windows? Clique aqui';
    setupAsLink(secondaryBtn, DOWNLOADS.windows);
    meta.innerHTML = '🍎 Detectamos macOS · 93 MB · Compatível com Premiere 2019+';
  } else if (os === 'windows') {
    primaryIcon.textContent  = '';
    primaryLabel.innerHTML   = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right:4px;vertical-align:-4px;"><path d="M2 12V6.59l8.5-1.13v6.45H2zm0 6.41V12.62h8.5v6.39L2 18.41zM11.05 12V5.32L22 4v8H11.05zm0 7.32V12.62H22V20l-10.95-.68z"/></svg>Baixar pra Windows';
    setupAsLink(primaryBtn, DOWNLOADS.windows);
    secondaryLbl.innerHTML   = 'Tem Mac? Clique aqui';
    setupAsLink(secondaryBtn, DOWNLOADS.mac);
    meta.innerHTML = '🪟 Detectamos Windows · ~90 MB · Compatível com Premiere 2019+';
  } else {
    primaryLabel.textContent = 'Baixar pra Mac';
    setupAsLink(primaryBtn, DOWNLOADS.mac);
    secondaryLbl.textContent = 'Baixar pra Windows';
    setupAsLink(secondaryBtn, DOWNLOADS.windows);
    meta.innerHTML = 'O CinePRO funciona no macOS e Windows';
  }
}
