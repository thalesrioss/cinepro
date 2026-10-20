#!/usr/bin/env node
// =============================================================
//  LP — cadastro sem Firebase e erros em português (BL-0070)
//
//  Com bloqueador de anúncios o SDK do Firebase não carrega e a LP
//  dizia "Conta criada" sem criar conta nenhuma (o app exige login).
//  E os erros não mapeados mostravam e.message cru ("Firebase: ...").
//  O teste carrega config.js + lp.js num vm com um DOM mínimo, sem
//  SDK ou com um firebase falso, e confere o que aparece na tela.
//
//  Uso:  node tools/test-lp-auth.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'landing-page', 'js');

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
async function ta(name, fn) {
  try {
    const r = await fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }
const flush = () => new Promise((r) => setImmediate(r));

// DOM mínimo. firebaseErr: undefined = sem SDK; senão o código que as
// chamadas de auth rejeitam.
function makeEnv(firebaseErr) {
  const els = {};
  const el = (id) => {
    if (id === 'exit-popup') return null;   // pula o popup de saída
    return els[id] || (els[id] = {
      id, textContent: '', value: '', href: '', disabled: false,
      style: {}, parentElement: { style: {} }, listeners: {}, classes: new Set(),
      classList: {
        add(c) { this._o.classes.add(c); }, remove(c) { this._o.classes.delete(c); },
        contains(c) { return this._o.classes.has(c); },
      },
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      querySelectorAll: () => [],
      scrollIntoView() {},
    });
  };
  const fix = (o) => { o.classList._o = o; return o; };
  const getEl = (id) => { const o = el(id); return o ? fix(o) : o; };
  const docListeners = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
    URLSearchParams,
    fetch: () => Promise.resolve(),
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    navigator: { userAgent: 'Macintosh', platform: 'MacIntel' },
    document: {
      getElementById: getEl, referrer: '',
      querySelectorAll: () => [],
      addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    },
  };
  ctx.window = ctx;
  ctx.window.location = { search: '' };
  if (firebaseErr !== undefined) {
    const rej = () => Promise.reject({ code: firebaseErr, message: 'Firebase: Error (' + firebaseErr + ').' });
    ctx.firebase = {
      initializeApp() {},
      auth: () => ({ createUserWithEmailAndPassword: rej, signInWithEmailAndPassword: rej }),
    };
  }
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'config.js'), 'utf8'), ctx, { filename: 'config.js' });
  vm.runInContext(fs.readFileSync(path.join(JS, 'lp.js'), 'utf8'), ctx, { filename: 'lp.js' });
  let revealed = 0;
  const realReveal = ctx.revealDownloads;
  ctx.revealDownloads = function () { revealed++; return realReveal.apply(this, arguments); };
  (docListeners.DOMContentLoaded || []).forEach((fn) => fn());
  getEl('signup-email').value = 'editor@exemplo.com';
  getEl('signup-password').value = 'segredo123';
  return {
    ctx, el: getEl,
    revealed: () => revealed,
    err: () => getEl('signup-error'),
    ok: () => getEl('signup-success'),
    submit() { getEl('signup-form').listeners.submit.forEach((fn) => fn({ preventDefault() {} })); },
    login() { getEl('signup-existing').listeners.click.forEach((fn) => fn({ preventDefault() {} })); },
  };
}

const UNAVAILABLE = 'Não conseguimos falar com o servidor de cadastro. Desative o bloqueador de anúncios neste site ou tente outro navegador.';

(async () => {
  group('sem SDK do Firebase (auth nulo)');
  {
    const e = makeEnv();
    e.submit();
    t('criar conta não libera download', () => e.revealed() === 0 || 'revealDownloads chamado');
    t('criar conta mostra o erro do bloqueador', () => e.err().textContent === UNAVAILABLE || e.err().textContent);
    t('erro visível', () => e.err().classes.has('visible') || 'sem .visible');
    t('sem "Conta criada"', () => !/Conta criada|Bem-vindo/.test(e.ok().textContent) || e.ok().textContent);
    t('botão volta ao normal', () => (!e.el('signup-submit').disabled && e.el('signup-submit').textContent === 'Criar conta') || 'botão travado');
    t('links de download sem href', () => e.el('btn-download-mac').href === '' || e.el('btn-download-mac').href);
  }
  {
    const e = makeEnv();
    e.login();
    t('entrar não libera download', () => e.revealed() === 0 || 'revealDownloads chamado');
    t('entrar mostra o erro do bloqueador', () => e.err().textContent === UNAVAILABLE || e.err().textContent);
    t('sem "Bem-vindo"', () => !/Bem-vindo/.test(e.ok().textContent) || e.ok().textContent);
  }

  group('authErrorMessage (função pura)');
  {
    const m = makeEnv().ctx.authErrorMessage;
    t('network-request-failed', () => m('auth/network-request-failed') === 'Sem conexão com o servidor. Confira a internet e tente de novo.' || m('auth/network-request-failed'));
    t('too-many-requests', () => m('auth/too-many-requests') === 'Muitas tentativas. Espere alguns minutos e tente de novo.' || m('auth/too-many-requests'));
    t('códigos já tratados mantêm o texto', () =>
      (m('auth/invalid-email') === 'Email inválido.' &&
       m('auth/weak-password') === 'Senha muito fraca. Use ao menos 6 caracteres.' &&
       m('auth/wrong-password') === 'Senha incorreta.' &&
       m('auth/invalid-credential') === 'Senha incorreta.' &&
       m('auth/user-not-found') === 'Email não encontrado. Crie uma conta nova.') || 'texto mudou');
    const unk = m('auth/internal-error');
    t('código desconhecido → frase genérica em português', () => (unk && !/Firebase|auth\//.test(unk)) || unk);
    t('sem código → frase genérica', () => m(undefined) === unk || m(undefined));
  }

  group('erros do Firebase na tela (sem e.message cru)');
  for (const code of ['auth/network-request-failed', 'auth/too-many-requests', 'auth/internal-error']) {
    for (const action of ['submit', 'login']) {
      await ta(action + ' + ' + code, async () => {
        const e = makeEnv(code);
        e[action]();
        await flush(); await flush();
        const txt = e.err().textContent;
        if (e.revealed() !== 0) return 'revealDownloads chamado';
        if (/Firebase/.test(txt)) return 'mostrou e.message cru: ' + txt;
        return txt === e.ctx.authErrorMessage(code) || txt;
      });
    }
  }

  console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
  process.exit(fail ? 1 : 0);
})();
