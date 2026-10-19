#!/usr/bin/env node
// =============================================================
//  Pasta de cache do app desktop — asserções (BL-0007)
//
//  O app e o plugin precisam usar a MESMA pasta. Se divergirem,
//  o asset é baixado duas vezes e o in-use.json (que protege da
//  limpeza de cache) não vale entre os dois.
//
//  Uso:  node tools/test-cache-dir.js
// =============================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const { cacheDir, cineproBase } = require(path.join(__dirname, '..', 'desktop-app', 'cache-dir.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }
const eq = (a, b) => a === b || JSON.stringify(a) + ' ≠ ' + JSON.stringify(b);

group('Windows');
t('usa %APPDATA%\\CinePRO\\cache',
  () => eq(cacheDir('win32', { APPDATA: 'C:\\Users\\ana\\AppData\\Roaming' }, 'C:\\Users\\ana'),
           'C:\\Users\\ana\\AppData\\Roaming\\CinePRO\\cache'));
t('sem APPDATA cai em <home>\\AppData\\Roaming',
  () => eq(cacheDir('win32', {}, 'C:\\Users\\ana'),
           'C:\\Users\\ana\\AppData\\Roaming\\CinePRO\\cache'));
t('nunca usa Library no Windows',
  () => !/Library/.test(cacheDir('win32', { APPDATA: 'C:\\X' }, 'C:\\Users\\ana')) || 'tem Library');
t('in-use.json fica ao lado de cache/ (pasta-mãe)',
  () => eq(cineproBase('win32', { APPDATA: 'C:\\X' }, 'C:\\H'), 'C:\\X\\CinePRO'));

group('macOS');
t('usa ~/Library/Application Support/CinePRO/cache',
  () => eq(cacheDir('darwin', { APPDATA: 'ignorado' }, '/Users/ana'),
           '/Users/ana/Library/Application Support/CinePRO/cache'));
t('pasta-mãe é CinePRO/',
  () => eq(cineproBase('darwin', {}, '/Users/ana'), '/Users/ana/Library/Application Support/CinePRO'));

group('Igual ao plugin (jsx/hostscript.jsx getCacheDir)');
const jsx = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'hostscript.jsx'), 'utf8');
t('plugin usa Folder.appData + /CinePRO/cache no Windows',
  () => /Folder\.appData\.fsName \+ '\/CinePRO\/cache'/.test(jsx) || 'trecho não achado no hostscript.jsx');
t('plugin usa ~/Library/Application Support/CinePRO/cache no Mac',
  () => jsx.includes("'~/Library/Application Support/CinePRO/cache'") || 'trecho não achado no hostscript.jsx');

group('main.js usa a função');
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop-app', 'main.js'), 'utf8');
t('CACHE_DIR = cacheDir()', () => /const CACHE_DIR = cacheDir\(\);/.test(main) || 'CACHE_DIR não vem de cacheDir()');
t('cache-dir.js empacotado (package.json build.files)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'desktop-app', 'package.json'), 'utf8'));
  return pkg.build.files.includes('cache-dir.js') || 'cache-dir.js fora de build.files';
});

console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
process.exit(fail ? 1 : 0);
