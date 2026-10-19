#!/usr/bin/env node
// =============================================================
//  "Abrir Premiere" do app desktop (BL-0006)
//
//  pickNewestPremiere é pura; findPremiere recebe fs/execFileSync
//  falsos, então nada aqui depende do Premiere estar instalado.
//
//  Uso:  node tools/test-premiere-locate.js
// =============================================================

'use strict';

const path = require('path');
const L = require(path.join(__dirname, '..', 'desktop-app', 'premiere-locate.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function eq(got, want) { return got === want ? true : JSON.stringify(got) + ' ≠ ' + JSON.stringify(want); }

// fs falso a partir de um mapa { pasta: [nomes] } e um conjunto de arquivos.
function fakeFs(dirs, files) {
  return {
    readdirSync(d) { if (!dirs[d]) throw new Error('ENOENT ' + d); return dirs[d].slice(); },
    existsSync(p) { return (files || []).indexOf(p) >= 0; },
  };
}
function mdfindReturns(out) { return function () { return out; }; }
function mdfindFails() { throw new Error('mdfind: índice desligado'); }

const MAC = (y) => '/Applications/Adobe Premiere Pro ' + y + '/Adobe Premiere Pro ' + y + '.app';
const WIN = (y) => 'C:\\Program Files\\Adobe\\Adobe Premiere Pro ' + y + '\\Adobe Premiere Pro.exe';

console.log('pickNewestPremiere');
t('2024/2025/2026 → 2026 (Mac)', () => eq(L.pickNewestPremiere([MAC(2024), MAC(2026), MAC(2025)]), MAC(2026)));
t('2024/2025/2026 → 2026 (Windows)', () => eq(L.pickNewestPremiere([WIN(2025), WIN(2024), WIN(2026)]), WIN(2026)));
t('lista vazia → null', () => eq(L.pickNewestPremiere([]), null));
t('undefined → null', () => eq(L.pickNewestPremiere(undefined), null));
t('lixo na lista é ignorado', () => eq(L.pickNewestPremiere([null, '', 42, MAC(2025)]), MAC(2025)));
t('Beta perde para o estável do mesmo ano', () => eq(L.pickNewestPremiere([
  '/Applications/Adobe Premiere Pro (Beta)/Adobe Premiere Pro 2026 (Beta).app', MAC(2026)]), MAC(2026)));
t('Beta mais novo ganha de estável mais velho', () => eq(L.pickNewestPremiere([
  MAC(2025), '/Applications/Adobe Premiere Pro (Beta)/Adobe Premiere Pro 2026 (Beta).app']),
  '/Applications/Adobe Premiere Pro (Beta)/Adobe Premiere Pro 2026 (Beta).app'));
t('sem ano fica por último', () => eq(L.pickNewestPremiere([
  '/Applications/Adobe Premiere Pro.app', MAC(2024)]), MAC(2024)));
t('só sem ano → ele mesmo', () => eq(L.pickNewestPremiere(['/Applications/Adobe Premiere Pro.app']),
  '/Applications/Adobe Premiere Pro.app'));
t('ano de pasta acima do app não conta (ex.: /Users/x/2030/...)', () => eq(L.premiereYear(
  '/Users/x/2030/Applications/Adobe Premiere Pro 2025/Adobe Premiere Pro 2025.app'), 2025));
t('2027 (versão futura) ganha sem mudar código', () => eq(L.pickNewestPremiere([MAC(2026), MAC(2027)]), MAC(2027)));

console.log('findPremiere — macOS');
t('Spotlight acha 2025 e 2026 → 2026; plugin do After Effects ignorado', () => eq(L.findPremiere('darwin', {
  fs: fakeFs({}),
  execFileSync: mdfindReturns([
    '/Applications/Adobe After Effects 2026/Plug-ins/Format/PremiereProImport.plugin',
    MAC(2025), MAC(2026), ''].join('\n')),
}), MAC(2026)));
t('Spotlight vazio → varre /Applications (pasta com .app dentro)', () => eq(L.findPremiere('darwin', {
  fs: fakeFs({
    '/Applications': ['Safari.app', 'Adobe Premiere Pro 2024', 'Adobe Premiere Pro 2026', 'Adobe Photoshop 2026'],
    '/Applications/Adobe Premiere Pro 2024': ['Adobe Premiere Pro 2024.app', 'Uninstall'],
    '/Applications/Adobe Premiere Pro 2026': ['Adobe Premiere Pro 2026.app', 'Presets'],
  }),
  execFileSync: mdfindReturns(''),
}), MAC(2026)));
t('mdfind com erro → varredura também funciona', () => eq(L.findPremiere('darwin', {
  fs: fakeFs({
    '/Applications': ['Adobe Premiere Pro 2025'],
    '/Applications/Adobe Premiere Pro 2025': ['Adobe Premiere Pro 2025.app'],
  }),
  execFileSync: mdfindFails,
}), MAC(2025)));
t('.app solto em /Applications também conta', () => eq(L.findPremiere('darwin', {
  fs: fakeFs({ '/Applications': ['Adobe Premiere Pro.app'] }),
  execFileSync: mdfindFails,
}), '/Applications/Adobe Premiere Pro.app'));
t('nada instalado → null', () => eq(L.findPremiere('darwin', {
  fs: fakeFs({ '/Applications': ['Safari.app', 'Adobe After Effects 2026'] }),
  execFileSync: mdfindReturns(''),
}), null));
t('/Applications ilegível → null, sem exceção', () => eq(L.findPremiere('darwin', {
  fs: fakeFs({}), execFileSync: mdfindFails,
}), null));

console.log('findPremiere — Windows');
t('2024/2025/2026 instalados → 2026', () => eq(L.findPremiere('win32', {
  fs: fakeFs({ 'C:\\Program Files\\Adobe': ['Adobe Premiere Pro 2024', 'Adobe Premiere Pro 2026',
    'Adobe Premiere Pro 2025', 'Adobe Media Encoder 2026'] }, [WIN(2024), WIN(2025), WIN(2026)]),
  programFilesDirs: ['C:\\Program Files'],
}), WIN(2026)));
t('pasta sem o .exe (desinstalação pela metade) é pulada', () => eq(L.findPremiere('win32', {
  fs: fakeFs({ 'C:\\Program Files\\Adobe': ['Adobe Premiere Pro 2025', 'Adobe Premiere Pro 2026'] }, [WIN(2025)]),
  programFilesDirs: ['C:\\Program Files'],
}), WIN(2025)));
t('sem pasta Adobe → null', () => eq(L.findPremiere('win32', {
  fs: fakeFs({}), programFilesDirs: ['C:\\Program Files'],
}), null));
t('Windows não chama mdfind', () => {
  let called = false;
  L.findPremiere('win32', { fs: fakeFs({}), programFilesDirs: ['C:\\Program Files'],
    execFileSync() { called = true; return ''; } });
  return eq(called, false);
});

console.log('findPremiere — outra plataforma');
t('linux → null', () => eq(L.findPremiere('linux', { fs: fakeFs({}), execFileSync: mdfindFails }), null));

console.log('\n' + pass + ' ok, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
