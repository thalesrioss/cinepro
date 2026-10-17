#!/usr/bin/env node
// =============================================================
//  Decisão de acesso pela leitura da assinatura (BL-0043)
//
//  Erro de leitura do Firestore não pode virar "assinatura inativa";
//  tolerância offline de 3 dias só para o mesmo uid.
//
//  Uso:  node tools/test-subscription-status.js
// =============================================================

'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'js', 'subscription-status.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function eq(got, want) {
  return JSON.stringify(got) === JSON.stringify(want) || ('veio ' + JSON.stringify(got) + ', esperado ' + JSON.stringify(want));
}

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 9, 17, 10, 0, 0);
const ERRO = { uid: 'u1', erro: 'Failed to get document because the client is offline.' };
const ONTEM_U1 = { uid: 'u1', em: AGORA - DIA };
const R = S.resultadoAssinatura;

console.log('══ resultadoAssinatura ══');
t('leitura ok e ativa → ativo', () => eq(R({ uid: 'u1', ativo: true }, null, AGORA), { estado: 'ativo' }));
t('leitura ok e inativa → inativo (mesmo com registro recente)', () => eq(R({ uid: 'u1', ativo: false }, ONTEM_U1, AGORA), { estado: 'inativo' }));
t('doc inexistente (ativo ausente) → inativo', () => eq(R({ uid: 'u1' }, null, AGORA), { estado: 'inativo' }));
t('erro sem registro → offline-bloqueado', () => eq(R(ERRO, null, AGORA), { estado: 'offline-bloqueado' }));
t('erro com registro de ontem → offline-liberado até ontem + 3 dias', () => eq(R(ERRO, ONTEM_U1, AGORA), { estado: 'offline-liberado', ate: ONTEM_U1.em + 3 * DIA }));
t('erro com registro de exatos 3 dias → offline-liberado', () => eq(R(ERRO, { uid: 'u1', em: AGORA - 3 * DIA }, AGORA).estado, 'offline-liberado'));
t('erro com registro de 4 dias → offline-bloqueado', () => eq(R(ERRO, { uid: 'u1', em: AGORA - 4 * DIA }, AGORA), { estado: 'offline-bloqueado' }));
t('erro com registro de outro uid → offline-bloqueado', () => eq(R(ERRO, { uid: 'u2', em: AGORA - DIA }, AGORA), { estado: 'offline-bloqueado' }));
t('erro com registro no futuro → offline-bloqueado', () => eq(R(ERRO, { uid: 'u1', em: AGORA + DIA }, AGORA), { estado: 'offline-bloqueado' }));
t('erro com registro sem data → offline-bloqueado', () => eq(R(ERRO, { uid: 'u1' }, AGORA), { estado: 'offline-bloqueado' }));

console.log('\n══ registro no storage ══');
function fakeStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m };
}
t('salvar e ler devolve uid + data', () => {
  const st = fakeStorage();
  S.salvarUltimaAtiva(st, 'u1', AGORA);
  return eq(S.lerUltimaAtiva(st), { uid: 'u1', em: AGORA });
});
t('apagar (logout) zera o registro', () => {
  const st = fakeStorage();
  S.salvarUltimaAtiva(st, 'u1', AGORA);
  S.apagarUltimaAtiva(st);
  return eq(S.lerUltimaAtiva(st), null);
});
t('registro corrompido → null', () => {
  const st = fakeStorage();
  st.setItem(S.STORAGE_KEY, '{nao-json');
  return eq(S.lerUltimaAtiva(st), null);
});
t('storage que lança (CEP sem localStorage) não quebra', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  S.salvarUltimaAtiva(bad, 'u1', AGORA);
  S.apagarUltimaAtiva(bad);
  return eq(S.lerUltimaAtiva(bad), null);
});

console.log('\n' + '─'.repeat(52));
console.log((fail ? '✗ ' : '✓ ') + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
