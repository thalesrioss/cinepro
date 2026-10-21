#!/usr/bin/env node
// =============================================================
//  LP — detecção do sistema no bloco de download (BL-0086)
//
//  No iPhone a LP dizia "🍎 Você está no macOS" e marcava o botão do
//  Mac como "Recomendado". Celular e tablet viram 'mobile': frase
//  própria e nenhum botão detectado. Mac e Windows de computador
//  seguem como antes. Carrega lp.js num vm com um DOM mínimo.
//
//  Uso:  node tools/test-lp-detect-os.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LP = path.join(__dirname, '..', 'landing-page', 'js', 'lp.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  // iPad com "site para computador" (padrão no iPadOS): igual ao Safari do Mac
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

function run(ua, platform, maxTouchPoints) {
  const els = {};
  const el = (id) => id === 'exit-popup' ? null : els[id] || (els[id] = {
    id, textContent: '', classes: new Set(), style: {}, parentElement: { style: {} },
    classList: { add(c) { els[id].classes.add(c); }, remove(c) { els[id].classes.delete(c); } },
    addEventListener() {}, querySelectorAll: () => [],
  });
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
    URLSearchParams,
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    navigator: { userAgent: ua, platform, maxTouchPoints },
    document: { getElementById: el, addEventListener() {}, querySelectorAll: () => [] },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(LP, 'utf8'), ctx, { filename: 'lp.js' });
  ctx.setupDownloads();
  const detected = ['btn-download-mac', 'btn-download-win'].filter((id) => el(id).classes.has('is-detected'));
  return { os: ctx.downloadPlatform(ua, platform, maxTouchPoints), leadOS: ctx.detectOS(), label: el('os-detect').textContent, detected };
}

const MOBILE_LABEL = '📱 Você está no celular: o CinePRO instala no Mac ou no Windows';

group('celular e tablet: nenhum botão recomendado');
for (const [nome, ua, plat, touch] of [
  ['iPhone', UA.iphone, 'iPhone', 5],
  ['iPad', UA.ipad, 'iPad', 5],
  ['iPad em modo computador (MacIntel + toque)', UA.ipadDesktop, 'MacIntel', 5],
  ['Android', UA.android, 'Linux armv8l', 5],
]) {
  t(nome, () => {
    const r = run(ua, plat, touch);
    if (r.os !== 'mobile') return 'os=' + r.os;
    if (r.label !== MOBILE_LABEL) return 'texto: ' + r.label;
    return r.detected.length === 0 || 'detectado: ' + r.detected;
  });
}

group('computador: igual a antes');
t('Mac (Chrome)', () => {
  const r = run(UA.mac, 'MacIntel', 0);
  return (r.os === 'mac' && r.label === '🍎 Você está no macOS' && r.detected.join() === 'btn-download-mac') || JSON.stringify(r);
});
t('Mac sem maxTouchPoints (navegador antigo)', () => run(UA.mac, 'MacIntel', undefined).os === 'mac' || 'não é mac');
t('Windows', () => {
  const r = run(UA.win, 'Win32', 0);
  return (r.os === 'windows' && r.label === '🪟 Você está no Windows' && r.detected.join() === 'btn-download-win') || JSON.stringify(r);
});
t('Windows com tela de toque continua Windows', () => run(UA.win, 'Win32', 10).os === 'windows' || 'não é windows');
t('Linux de computador: frase genérica, nada recomendado', () => {
  const r = run(UA.linux, 'Linux x86_64', 0);
  return (r.os === 'linux' && r.label === '💻 Disponível pra Mac e Windows' && r.detected.length === 0) || JSON.stringify(r);
});

group('lead da planilha não muda (detectOS de sendLeadToSheets)');
t('iPhone continua "mac" no lead', () => run(UA.iphone, 'iPhone', 5).leadOS === 'mac' || 'mudou');
t('Android continua "linux" no lead', () => run(UA.android, 'Linux armv8l', 5).leadOS === 'linux' || 'mudou');

console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
process.exit(fail ? 1 : 0);
