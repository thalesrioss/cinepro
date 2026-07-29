#!/usr/bin/env node
// =============================================================
//  AutoEdit — asserções do motor de corte
//
//  É a feature mais destrutiva do produto: erra e o editor perde a
//  fala. Por isso o teste cobre principalmente os casos em que o
//  corte NÃO pode acontecer.
//
//  Uso:  node tools/test-autoedit.js
// =============================================================

'use strict';

const path = require('path');
const A = require(path.join(__dirname, '..', 'js', 'autoedit.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }

// Helper: monta transcrição a partir de [texto, início, fim]
const W = (arr) => arr.map(([word, start, end]) => ({ word, start, end }));

// Fala com dois silêncios claros (1,5s e 2,0s) e uma pausa curta (0,2s)
const FALA = W([
  ['Fala',    0.00, 0.30],
  ['pessoal', 0.30, 0.90],
  ['tudo',    1.10, 1.40],   // pausa curta 0,2s — NÃO é silêncio
  ['bem',     1.40, 1.80],
  ['hoje',    3.30, 3.80],   // silêncio de 1,5s antes
  ['vamos',   3.80, 4.20],
  ['editar',  6.20, 6.90],   // silêncio de 2,0s antes
]);

group('DETECÇÃO DE SILÊNCIO');
t('acha os 2 silêncios reais', () => {
  const s = A.detectSilences(FALA);
  return s.length === 2 || `achou ${s.length}: ${JSON.stringify(s.map(x => x.dur))}`;
});
t('NÃO corta pausa curta de 0,2s (respiração)', () => {
  const s = A.detectSilences(FALA);
  return s.every((x) => x.dur >= 0.35) || 'cortou pausa natural';
});
t('limiar configurável: 0,15s acha 3', () => {
  const s = A.detectSilences(FALA, { minSilence: 0.15 });
  return s.length === 3 || `achou ${s.length}`;
});
t('limiar alto (5s) não acha nenhum', () => {
  return A.detectSilences(FALA, { minSilence: 5 }).length === 0 || 'achou silêncio';
});

group('SEGMENTOS QUE FICAM');
t('gera 3 blocos de fala', () => {
  const s = A.buildSegments(FALA, { duration: 7 });
  return s.length === 3 || `gerou ${s.length}: ${JSON.stringify(s.map(x => [x.start, x.end]))}`;
});
t('mantém o texto de cada bloco', () => {
  const s = A.buildSegments(FALA, { duration: 7 });
  return s[0].text === 'Fala pessoal tudo bem' || `texto: "${s[0].text}"`;
});
t('respiro aplicado nas bordas', () => {
  const s = A.buildSegments(FALA, { duration: 7, padding: 0.1 });
  // 1º bloco começa em 0.00 → padding não pode ir abaixo de 0
  return s[0].start === 0 && Math.abs(s[1].start - (3.30 - 0.1)) < 0.001
    || `start=${s[0].start} seg2=${s[1].start}`;
});
t('respiro NUNCA cria tempo negativo', () => {
  const s = A.buildSegments(W([['oi', 0.05, 0.4]]), { padding: 1.0 });
  return s[0].start >= 0 || `start=${s[0].start}`;
});
t('respiro NUNCA passa da duração', () => {
  const s = A.buildSegments(W([['oi', 5.0, 5.5]]), { padding: 2.0, duration: 6.0 });
  return s[0].end <= 6.0 || `end=${s[0].end}`;
});
t('segmentos que encostam são mesclados', () => {
  // silêncio de 0,4s com respiro de 0,3s de cada lado → sobrepõe, mescla
  const w = W([['a', 0, 1], ['b', 1.4, 2]]);
  const s = A.buildSegments(w, { minSilence: 0.35, padding: 0.3, duration: 3 });
  return s.length === 1 || `ficaram ${s.length} — deveria mesclar`;
});
t('descarta picote menor que minSegment', () => {
  const w = W([['a', 0, 2], ['b', 5, 5.05]]);
  const s = A.buildSegments(w, { padding: 0, minSegment: 0.5, duration: 6 });
  return s.length === 1 || `ficaram ${s.length}`;
});

group('CASOS-LIMITE (onde o corte destrói)');
t('lista vazia → nenhum segmento', () => A.buildSegments([]).length === 0 || 'gerou segmento');
t('lista vazia → plano não quebra', () => {
  const p = A.buildPlan([], { duration: 10 });
  return p.segments.length === 0 && p.stats.cuts === 0 || JSON.stringify(p.stats);
});
t('null não quebra', () => A.buildSegments(null).length === 0 || 'gerou segmento');
t('uma palavra só → um segmento', () => {
  return A.buildSegments(W([['oi', 1, 2]]), { duration: 3 }).length === 1 || 'errou';
});
t('fala contínua sem silêncio → 1 segmento (não corta nada)', () => {
  const w = W([['a', 0, 1], ['b', 1, 2], ['c', 2, 3]]);
  const p = A.buildPlan(w, { duration: 3 });
  return p.stats.cuts === 0 && p.segments.length === 1 || `cortes=${p.stats.cuts}`;
});
t('nunca devolve segmento com duração <= 0', () => {
  const p = A.buildPlan(FALA, { duration: 7 });
  return p.segments.every((s) => s.dur > 0) || 'segmento degenerado';
});
t('segmentos ficam em ordem e sem sobreposição', () => {
  const p = A.buildPlan(FALA, { duration: 7 });
  for (let i = 1; i < p.segments.length; i++) {
    if (p.segments[i].start < p.segments[i - 1].end) return `sobreposição em ${i}`;
  }
  return true;
});
t('palavra fora de ordem não gera segmento invertido', () => {
  const w = W([['a', 5, 6], ['b', 1, 2]]);
  const p = A.buildPlan(w, { duration: 7 });
  return p.segments.every((s) => s.end > s.start) || 'gerou segmento invertido';
});

group('ESTATÍSTICA (o número que o editor decide em cima)');
t('calcula quanto encurta', () => {
  const p = A.buildPlan(FALA, { duration: 7 });
  const st = p.stats;
  return (st.original === 7 && st.final < st.original && st.removed > 0 && st.percent > 0)
    || JSON.stringify(st);
});
t('percentual bate com os tempos', () => {
  const p = A.buildPlan(FALA, { duration: 7 });
  const esperado = Math.round((1 - p.stats.final / p.stats.original) * 1000) / 10;
  return Math.abs(p.stats.percent - esperado) < 0.2 || `${p.stats.percent} vs ${esperado}`;
});
t('sem silêncio → 0% removido', () => {
  const w = W([['a', 0, 1], ['b', 1, 2]]);
  const p = A.buildPlan(w, { duration: 2, padding: 0 });
  return p.stats.percent === 0 || `${p.stats.percent}%`;
});

group('CONVERSÃO PRA FRAMES');
t('23,976 → arredonda pro frame mais próximo', () => {
  return A.toFrames(1.0, 23.976) === 24 || A.toFrames(1.0, 23.976);
});
t('29,97 correto', () => A.toFrames(2.0, 29.97) === 60 || A.toFrames(2.0, 29.97));
t('nunca negativo', () => A.toFrames(-5, 24) === 0 || 'negativo');
t('fps ausente usa 24', () => A.toFrames(1, null) === 24 || A.toFrames(1, null));

group('PLANO DE EXECUÇÃO');
t('serializa com schemaVersion', () => {
  const p = A.buildPlan(FALA, { duration: 7 });
  const x = A.toExecutionPlan(p, { fps: 30, timelineName: 'T' });
  return x.schemaVersion === 1 && x.kind === 'autoedit' || JSON.stringify(x).slice(0, 80);
});
t('frames coerentes com os segundos', () => {
  const p = A.buildPlan(FALA, { duration: 7 });
  const x = A.toExecutionPlan(p, { fps: 30 });
  return x.segments.every((s) => s.endFrame > s.startFrame) || 'frame invertido';
});
t('plano é determinístico', () => {
  const a = JSON.stringify(A.buildPlan(FALA, { duration: 7 }));
  const b = JSON.stringify(A.buildPlan(FALA, { duration: 7 }));
  return a === b || 'variou entre execuções';
});

group('CENÁRIO REAL (talking head de 60s com muita pausa)');
(function () {
  const w = [];
  let tsec = 0;
  for (let f = 0; f < 20; f++) {           // 20 frases
    for (let i = 0; i < 8; i++) {           // 8 palavras cada
      w.push({ word: 'p' + i, start: tsec, end: tsec + 0.25 });
      tsec += 0.28;
    }
    tsec += 1.2;                            // pausa entre frases
  }
  const p = A.buildPlan(w, { duration: tsec });
  console.log(`  original ${p.stats.original}s → final ${p.stats.final}s ` +
              `(−${p.stats.percent}%, ${p.stats.cuts} cortes, ${p.stats.words} palavras)`);
  t('encurta entre 10% e 60% (faixa plausível)', () =>
    (p.stats.percent > 10 && p.stats.percent < 60) || `${p.stats.percent}%`);
  t('1 segmento por frase', () => p.segments.length === 20 || `${p.segments.length}`);
})();

console.log('\n' + '─'.repeat(52));
console.log((fail ? '✗ ' : '✓ ') + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
