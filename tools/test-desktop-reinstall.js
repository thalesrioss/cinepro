#!/usr/bin/env node
// =============================================================
//  App desktop — botão "Instalar/Reinstalar plugin" (BL-0009)
//
//  O botão dizia "Em breve isso será automático" e não fazia nada.
//  Agora abre a seção de download da LP no navegador. O teste
//  carrega config.js + app.js num vm com um DOM mínimo, clica no
//  botão e confere o que saiu pelo window.cinepro.
//
//  Uso:  node tools/test-desktop-reinstall.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'desktop-app', 'renderer', 'js');

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }

// DOM mínimo: cada id vira um elemento que guarda listeners e texto.
function makeEnv(pluginInstalled) {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, textContent: '', innerHTML: '', className: '', listeners: {},
    classList: { add() {}, remove() {} },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    click() { (this.listeners.click || []).forEach((fn) => fn({ preventDefault() {} })); },
  });
  const opened = [];
  const ctx = {
    console,
    setTimeout: () => 0,
    requestAnimationFrame: (fn) => fn(),
    confirm: () => false,
    document: { getElementById: el, addEventListener() {}, querySelectorAll: () => [] },
    window: {
      cinepro: {
        openExternal: (url) => { opened.push(url); return Promise.resolve(); },
        isPluginInstalled: () => Promise.resolve(pluginInstalled),
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'config.js'), 'utf8'), ctx, { filename: 'config.js' });
  vm.runInContext(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
  return { ctx, el, opened };
}

group('config');
const { ctx: c0 } = makeEnv(true);
const URL_ = vm.runInContext('CINEPRO_CONFIG.PLUGIN_DOWNLOAD_URL', c0);
t('PLUGIN_DOWNLOAD_URL é https', () => /^https:\/\//.test(URL_) || URL_);
t('aponta para a seção de download da LP (#signup)', () => /#signup$/.test(URL_) || URL_);
t('a LP do repositório tem a seção #signup com "Já tem conta?"', () => {
  const lp = fs.readFileSync(path.join(__dirname, '..', 'landing-page', 'index.html'), 'utf8');
  return (lp.includes('id="signup"') && lp.includes('id="signup-existing"')) || 'seção ausente';
});

group('clique em "Reinstalar plugin"');
{
  const { ctx, el, opened } = makeEnv(true);
  vm.runInContext('bindDashboard()', ctx);
  el('btn-reinstall').click();
  t('abre a página de download uma vez', () => (opened.length === 1 && opened[0] === URL_) || JSON.stringify(opened));
  t('toast não promete "Em breve"', () => !/em breve/i.test(el('toast').textContent) || el('toast').textContent);
  t('toast diz o próximo passo (fechar o Premiere)', () => /Premiere/.test(el('toast').textContent) || el('toast').textContent);
}

group('rótulo conforme o estado do plugin');
function labelFor(installed) {
  const { ctx, el } = makeEnv(installed);
  vm.runInContext('refreshPluginStatus()', ctx);
  return new Promise((r) => setImmediate(() => r(el('btn-reinstall').textContent)));
}

Promise.all([labelFor(true), labelFor(false)]).then(([yes, no]) => {
  t('instalado → "Reinstalar plugin"', () => yes === 'Reinstalar plugin' || yes);
  t('ausente → "Instalar plugin"', () => no === 'Instalar plugin' || no);
  t('nenhum toast "Em breve" sobrou no app', () => {
    const src = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    return !/em breve/i.test(src) || 'app.js ainda tem "Em breve"';
  });
  console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
  process.exit(fail ? 1 : 0);
});
