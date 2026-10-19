// =============================================================
//  CinePRO Desktop — acha o Premiere Pro instalado (BL-0006)
//
//  Antes o "Abrir Premiere" tinha 2024/2025 fixos no código e
//  dizia "Abrindo..." mesmo sem achar nada. Aqui:
//   - pickNewestPremiere: função pura, escolhe o mais novo de uma
//     lista de caminhos (ano no nome; Beta perde para o estável
//     do mesmo ano; sem ano fica por último).
//   - findPremiere: lista os candidatos da plataforma. Recebe
//     fs/exec por injeção para dar para testar fora do Electron.
// =============================================================

'use strict';

const path = require('path');

// Ano do Premiere pelo nome ("Adobe Premiere Pro 2026.app") ou,
// sem ano, 0. Funciona para caminho de Mac e de Windows.
function premiereYear(p) {
  const base = String(p).split(/[\\/]/).filter(Boolean).slice(-2).join(' ');
  const m = base.match(/(20\d\d)/g);
  return m ? Math.max.apply(null, m.map(Number)) : 0;
}

function isBeta(p) {
  return /\bbeta\b/i.test(String(p).split(/[\\/]/).filter(Boolean).slice(-2).join(' '));
}

// Lista de caminhos → o mais novo, ou null se a lista vier vazia.
function pickNewestPremiere(paths) {
  const list = (paths || []).filter(function (p) { return typeof p === 'string' && p; });
  if (!list.length) return null;
  return list.slice().sort(function (a, b) {
    return (premiereYear(b) - premiereYear(a)) ||
           ((isBeta(a) ? 1 : 0) - (isBeta(b) ? 1 : 0)) ||
           (a < b ? -1 : a > b ? 1 : 0);
  })[0];
}

function safeReaddir(fs, dir) {
  try { return fs.readdirSync(dir); } catch (e) { return []; }
}

// macOS: Spotlight pelo bundle id (com.adobe.PremierePro.<versão>);
// se o Spotlight não devolver nada (índice desligado), varre
// /Applications/Adobe Premiere Pro */Adobe Premiere Pro *.app.
function macCandidates(deps) {
  const fs = deps.fs;
  let found = [];
  try {
    const out = deps.execFileSync('mdfind',
      ["kMDItemCFBundleIdentifier == 'com.adobe.PremierePro*'"],
      { encoding: 'utf8', timeout: 5000 });
    found = String(out).split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return /\.app$/.test(s) && /Premiere Pro/i.test(path.basename(s)); });
  } catch (e) { found = []; }
  if (found.length) return found;

  const apps = deps.applicationsDir || '/Applications';
  safeReaddir(fs, apps).forEach(function (name) {
    if (/^Adobe Premiere Pro/i.test(name) && /\.app$/.test(name)) {
      found.push(path.join(apps, name));
      return;
    }
    if (!/^Adobe Premiere Pro/i.test(name)) return;
    safeReaddir(fs, path.join(apps, name)).forEach(function (inner) {
      if (/^Adobe Premiere Pro.*\.app$/i.test(inner)) found.push(path.join(apps, name, inner));
    });
  });
  return found;
}

// Windows: Program Files\Adobe\Adobe Premiere Pro *\Adobe Premiere Pro.exe
function winCandidates(deps) {
  const fs = deps.fs;
  const roots = deps.programFilesDirs || [process.env.ProgramFiles || 'C:\\Program Files'];
  const found = [];
  roots.forEach(function (root) {
    const adobe = path.win32.join(root, 'Adobe');
    safeReaddir(fs, adobe).forEach(function (name) {
      if (!/^Adobe Premiere Pro/i.test(name)) return;
      const exe = path.win32.join(adobe, name, 'Adobe Premiere Pro.exe');
      if (fs.existsSync(exe)) found.push(exe);
    });
  });
  return found;
}

// Caminho do Premiere mais novo instalado, ou null.
function findPremiere(platform, deps) {
  deps = deps || {};
  if (!deps.fs) deps.fs = require('fs');
  if (!deps.execFileSync) deps.execFileSync = require('child_process').execFileSync;
  if (platform === 'darwin') return pickNewestPremiere(macCandidates(deps));
  if (platform === 'win32') return pickNewestPremiere(winCandidates(deps));
  return null;
}

module.exports = { pickNewestPremiere, premiereYear, findPremiere };
