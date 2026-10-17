#!/usr/bin/env node
// =============================================================
//  Estado vazio da lista (BL-0004) — js/empty-state.js
//
//  "Limpar busca" só quando há busca; Favoritos/Recentes/Mais usados
//  e o estado inicial nunca oferecem o botão. Texto do estado inicial
//  sem "acima" (a lista de categorias fica ao lado, e some no painel estreito).
//
//  Uso:  node tools/test-empty-state.js
// =============================================================

'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'js', 'empty-state.js'));

let ok = 0, fail = 0;
function t(name, fn) {
  try { fn(); ok++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
function has(s, sub) { if (s.indexOf(sub) === -1) throw new Error(JSON.stringify(s) + ' não contém ' + JSON.stringify(sub)); }
function hasNot(s, sub) { if (s.indexOf(sub) !== -1) throw new Error(JSON.stringify(s) + ' contém ' + JSON.stringify(sub)); }

console.log('empty-state');

t('busca sem resultado: Nada para "<termo>" + sugestão + Limpar busca', () => {
  const r = S.emptyStateFor('all', 'zzqx');
  has(r.html, 'Nada para "zzqx"');
  has(r.html, 'Tente em inglês ou escolha uma categoria');
  eq(r.clearSearch, true);
});

t('busca sem resultado dentro de uma categoria também oferece Limpar busca', () => {
  eq(S.emptyStateFor('SFX', 'zzqx').clearSearch, true);
  eq(S.emptyStateFor('favorites', 'zzqx').clearSearch, true);
});

t('termo com espaços nas pontas aparece aparado', () => {
  has(S.emptyStateFor('all', '  chuva  ').html, 'Nada para "chuva"');
});

t('termo com HTML é escapado', () => {
  const r = S.emptyStateFor('all', '<img src=x onerror=1>"');
  hasNot(r.html, '<img');
  has(r.html, '&lt;img');
  has(r.html, '&quot;');
});

for (const cat of ['favorites', 'recents', 'most-used', 'all', 'SFX', undefined]) {
  t('sem busca (' + cat + '): nunca Limpar busca', () => {
    eq(S.emptyStateFor(cat, '').clearSearch, false);
    eq(S.emptyStateFor(cat, '   ').clearSearch, false);
    eq(S.emptyStateFor(cat, null).clearSearch, false);
    hasNot(S.emptyStateFor(cat, '').html, 'Nada para');
  });
}

t('Favoritos vazio fala de favoritar', () => {
  has(S.emptyStateFor('favorites', '').html, 'favoritou');
});

t('estado inicial: "Clique numa categoria" sem "acima" nem 👆', () => {
  const h = S.emptyStateFor('all', '').html;
  has(h, 'Clique numa categoria');
  hasNot(h, 'acima');
  hasNot(h, '👆');
});

t('"Clique numa categoria" só no estado inicial', () => {
  for (const cat of ['favorites', 'recents', 'most-used', 'SFX']) {
    hasNot(S.emptyStateFor(cat, '').html, 'Clique numa categoria');
  }
  hasNot(S.emptyStateFor('all', 'zzqx').html, 'Clique numa categoria');
});

console.log('\n' + ok + ' ok, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
