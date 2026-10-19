#!/usr/bin/env node
// =============================================================
//  ⚡ "Aplicar em todos os cortes" — asserções (BL-0060)
//
//  O risco aqui é MENTIR: dizer "25 de 25" quando a timeline tem
//  200 cortes, ou pôr whoosh no começo de cada título e B-roll.
//  As funções vivem no .jsx (ExtendScript) e no main.js do painel;
//  o teste extrai o código-fonte delas e roda no Node.
//
//  Uso:  node tools/test-cut-points.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// Extrai `function nome(...) { ... }` de um arquivo, casando as chaves.
function extract(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(name + ' não encontrada em ' + file);
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return new Function(src.slice(at, i + 1) + '\nreturn ' + name + ';')();
}

const cutPointsForSfx = extract('jsx/hostscript.jsx', 'cutPointsForSfx');
const cutsResultMessage = extract('js/main.js', 'cutsResultMessage');

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }

// Trilha com clipes começando nos tempos dados
const track = (starts) => ({ clips: starts.map((s) => ({ start: s })) });
// n clipes de 1,5 s a partir de 0 → n-1 cortes (o 0 não é corte)
const montagem = (n) => track(Array.from({ length: n }, (_, i) => i * 1.5));

group('CONTAGEM HONESTA');
t('201 clipes em V1 (200 cortes) → 25 colocados e total 200', () => {
  const r = cutPointsForSfx([montagem(201)], 25, 0);
  return (r.cuts.length === 25 && r.total === 200 && r.left === 175) ||
    JSON.stringify({ n: r.cuts.length, total: r.total, left: r.left });
});
t('timeline curta: tudo coberto, nada sobra', () => {
  const r = cutPointsForSfx([track([0, 2, 4, 6])], 25, 0);
  return (r.cuts.length === 3 && r.total === 3 && r.left === 0) || JSON.stringify(r);
});

group('SÓ A TRILHA DA MONTAGEM');
t('V1 com 4 cortes + V2 com 6 + V3 com 3 → 4', () => {
  const v1 = track([0, 3, 6, 9, 12]);
  const v2 = track([1, 2.5, 4, 5.5, 7, 8.5]);
  const v3 = track([10, 11, 13]);
  const r = cutPointsForSfx([v1, v2, v3], 25, 0);
  return (r.total === 4 && r.cuts.join() === '3,6,9,12') || JSON.stringify(r);
});
t('V1 vazia e V2 com clipes → usa V2', () => {
  const r = cutPointsForSfx([track([]), track([0, 5, 10])], 25, 0);
  return (r.total === 2 && r.cuts.join() === '5,10') || JSON.stringify(r);
});
t('sem nenhum clipe → total 0', () => {
  const r = cutPointsForSfx([track([]), track([])], 25, 0);
  return (r.total === 0 && r.cuts.length === 0) || JSON.stringify(r);
});

group('A PARTIR DA AGULHA');
t('agulha em 80 s → só cortes depois de 80 s', () => {
  const r = cutPointsForSfx([montagem(201)], 25, 80);
  return (r.cuts.every((c) => c > 80) && r.cuts[0] === 81 && r.cuts.length === 25 && r.total === 200) ||
    JSON.stringify(r.cuts.slice(0, 3));
});
t('agulha depois do último corte → nada a colocar, total segue', () => {
  const r = cutPointsForSfx([track([0, 5, 10])], 25, 30);
  return (r.cuts.length === 0 && r.total === 2 && r.left === 0) || JSON.stringify(r);
});

group('DEDUPLICAÇÃO');
t('dois cortes a 0,02 s → um', () => {
  const r = cutPointsForSfx([track([0, 5, 5.02, 10])], 25, 0);
  return (r.total === 2 && r.cuts.join() === '5,10') || JSON.stringify(r);
});
t('início da sequência (0 s) não é corte', () => {
  const r = cutPointsForSfx([track([0.01, 4])], 25, 0);
  return (r.cuts.join() === '4') || JSON.stringify(r);
});

group('TEXTO DO PAINEL');
t('sobrou corte → diz até onde foi e como continuar', () => {
  const s = cutsResultMessage('Whoosh', 'OK:CUTS_25_OF_200_UNTIL_75.40_LEFT_175');
  return s === '⚡ "Whoosh" em 25 de 200 cortes (até 1:15). Ponha a agulha depois de 1:15 e clique de novo para continuar.' || s;
});
t('cobriu tudo → só a contagem', () => {
  const s = cutsResultMessage('Whoosh', 'OK:CUTS_12_OF_12_UNTIL_40.00_LEFT_0');
  return s === '⚡ "Whoosh" em 12 de 12 cortes' || s;
});
t('segunda leva a partir da agulha cobre o resto → sem "clique de novo"', () => {
  const s = cutsResultMessage('Whoosh', 'OK:CUTS_10_OF_35_UNTIL_52.50_LEFT_0');
  return s.indexOf('clique de novo') === -1 || s;
});
t('formato antigo (sem UNTIL) não quebra', () => {
  const s = cutsResultMessage('Hit', 'OK:CUTS_3_OF_3');
  return s === '⚡ "Hit" em 3 de 3 cortes' || s;
});

console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
process.exit(fail ? 1 : 0);
