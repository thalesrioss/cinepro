#!/usr/bin/env node
// =============================================================
//  Diagnóstico de timeline — asserções
//
//  Diferente do AutoEdit, aqui nada é destrutivo. O risco não é
//  estragar o projeto, é DAR CONSELHO ERRADO — apontar problema
//  onde não tem, ou deixar passar o que importa. Os testes miram
//  isso.
//
//  Uso:  node tools/test-diagnostics.js
// =============================================================

'use strict';

const path = require('path');
const D = require(path.join(__dirname, '..', 'js', 'diagnostics.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }

const VERT = { width: 1080, height: 1920 };
const HORZ = { width: 1920, height: 1080 };
const tl = (cuts, duration, fmt) => Object.assign({ cuts, duration }, fmt || HORZ);

group('DETECÇÃO DE FORMATO (muda o limite)');
t('9:16 é vertical', () => D.isVertical(VERT) === true || 'errou');
t('16:9 é horizontal', () => D.isVertical(HORZ) === false || 'errou');
t('sem dimensão assume horizontal', () => D.isVertical({ cuts: [] }) === false || 'errou');
t('vertical usa limite de 2s', () => {
  const r = D.analyze(tl([1, 2, 3], 10, VERT));
  return r.stats.limit === 2 || r.stats.limit;
});
t('horizontal usa limite de 5s', () => {
  const r = D.analyze(tl([1, 2, 3], 10, HORZ));
  return r.stats.limit === 5 || r.stats.limit;
});

group('VÃOS DE RETENÇÃO');
t('ritmo bom no horizontal → sem achado de vão', () => {
  // cortes a cada 3s, limite 5s → nada a apontar
  const r = D.analyze(tl([3, 6, 9, 12, 15, 18], 20, HORZ));
  const gaps = r.findings.filter((f) => f.type === 'retention-gap');
  return gaps.length === 0 || JSON.stringify(gaps.map((g) => g.duration));
});
t('MESMO ritmo no vertical → aponta (limite 2s)', () => {
  const r = D.analyze(tl([3, 6, 9, 12, 15, 18], 20, VERT));
  const gaps = r.findings.filter((f) => f.type === 'retention-gap');
  return gaps.length > 0 || 'não apontou nada no vertical';
});
t('vão de 13s no meio é achado GRAVE', () => {
  const r = D.analyze(tl([2, 4, 17, 19], 22, HORZ));
  const g = r.findings.find((f) => f.type === 'retention-gap' && f.duration > 12);
  return (g && g.severity === 'high') || (g ? g.severity : 'não achou o vão');
});
t('conta o trecho FINAL (do último corte até o fim)', () => {
  const r = D.analyze(tl([2, 4], 30, HORZ));   // 26s sem nada depois
  const g = r.findings.find((f) => f.at === 4);
  return (g && g.duration > 25) || 'ignorou o fim do vídeo';
});
t('timeline sem corte nenhum → aponta o vídeo todo', () => {
  const r = D.analyze(tl([], 40, HORZ));
  return r.findings.some((f) => f.duration >= 39) || 'não apontou';
});

group('GANCHO (o começo decide)');
t('1º corte em 12s → gancho lento', () => {
  const r = D.analyze(tl([12, 14, 16], 20, HORZ));
  return r.findings.some((f) => f.type === 'slow-hook') || 'não apontou gancho';
});
t('1º corte em 2s → gancho ok', () => {
  const r = D.analyze(tl([2, 4, 6], 10, HORZ));
  return !r.findings.some((f) => f.type === 'slow-hook') || 'apontou gancho bom como ruim';
});
t('gancho muito lento é grave', () => {
  const r = D.analyze(tl([15], 20, HORZ));
  const h = r.findings.find((f) => f.type === 'slow-hook');
  return (h && h.severity === 'high') || (h ? h.severity : 'não achou');
});

group('PRIORIZAÇÃO (com teto, o que sobra tem que ser o pior)');
t('graves vêm primeiro', () => {
  const r = D.analyze(tl([2, 3, 4, 30], 40, HORZ));
  return r.findings[0].severity === 'high' || r.findings[0].severity;
});
t('respeita o teto de marcadores', () => {
  const cuts = [];
  for (let i = 0; i < 400; i++) cuts.push(i * 10);   // 400 vãos de 10s
  const r = D.analyze(tl(cuts, 4000, HORZ), { maxFindings: 12 });
  return (r.findings.length === 12 && r.stats.truncated === true)
    || `${r.findings.length} achados, truncated=${r.stats.truncated}`;
});
t('problema grave no FIM não é cortado pelo teto', () => {
  const cuts = [];
  for (let i = 1; i <= 30; i++) cuts.push(i * 6);    // vãos de 6s (médio)
  cuts.push(300);                                    // vão gigante no fim
  const r = D.analyze(tl(cuts, 320, HORZ), { maxFindings: 5 });
  return r.findings[0].duration > 100 || `pior achado tem ${r.findings[0].duration}s`;
});

group('CASOS-LIMITE');
t('timeline vazia não quebra', () => {
  const r = D.analyze({ cuts: [], duration: 0 });
  return Array.isArray(r.findings) || 'retorno inválido';
});
t('null não quebra', () => {
  const r = D.analyze(null);
  return Array.isArray(r.findings) && r.findings.length === 0 || 'quebrou';
});
t('duração zero não gera achado fantasma', () => {
  const r = D.analyze(tl([], 0, HORZ));
  return r.findings.length === 0 || 'gerou achado sem timeline';
});
t('cortes fora de ordem são normalizados', () => {
  const r = D.analyze(tl([9, 3, 6], 12, HORZ));
  return r.findings.every((f) => f.end >= f.at) || 'gerou intervalo invertido';
});
t('cortes duplicados não viram vão de 0s', () => {
  const b = D.attentionBeats({ cuts: [3, 3.01, 3.02, 6] });
  return b.length === 2 || `dedupe falhou: ${JSON.stringify(b)}`;
});
t('análise é determinística', () => {
  const a = JSON.stringify(D.analyze(tl([2, 9, 11, 25], 30, VERT)));
  const b = JSON.stringify(D.analyze(tl([2, 9, 11, 25], 30, VERT)));
  return a === b || 'variou entre execuções';
});

group('RITMO');
t('calcula média e mediana', () => {
  const r = D.analyze(tl([2, 4, 6, 8], 10, HORZ));
  return (r.rhythm && r.rhythm.cuts === 4 && r.rhythm.avgGap === 2) || JSON.stringify(r.rhythm);
});
t('corte único não gera ritmo', () => {
  const r = D.analyze(tl([5], 10, HORZ));
  return r.rhythm === null || 'inventou ritmo com 1 corte';
});

group('SAÍDAS');
t('marcadores em frame, nunca negativo', () => {
  const r = D.analyze(tl([2, 20], 30, HORZ));
  const m = D.toMarkers(r, 30);
  return m.every((x) => x.frame >= 0 && x.durationFrames >= 1) || 'frame inválido';
});
t('marcador carrega customData pra poder apagar só os nossos', () => {
  const m = D.toMarkers(D.analyze(tl([2, 20], 30, HORZ)), 24);
  return m.every((x) => /^cinepro:/.test(x.customData)) || 'sem customData';
});
t('duração do marcador é limitada (não polui a timeline)', () => {
  const m = D.toMarkers(D.analyze(tl([2], 300, HORZ)), 24);
  return m.every((x) => x.durationFrames <= 5 * 24) || 'marcador longo demais';
});
t('relatório sem problema é positivo', () => {
  const rep = D.toReport(D.analyze(tl([3, 6, 9, 12], 14, HORZ)));
  return /Nenhum trecho acima do limite/.test(rep) || rep.slice(0, 80);
});
t('relatório com problema traz tabela e timecode', () => {
  const rep = D.toReport(D.analyze(tl([2, 30], 40, HORZ)));
  return (/\| Tempo \|/.test(rep) && /0:\d\d/.test(rep)) || rep.slice(0, 120);
});

group('CENÁRIO REAL (Reels de 45s, corte lento demais)');
(function () {
  const cuts = [];
  for (let i = 1; i <= 12; i++) cuts.push(i * 3.5);   // corte a cada 3,5s
  const r = D.analyze(tl(cuts, 45, VERT));
  console.log(`  formato ${r.stats.format} · limite ${r.stats.limit}s · ` +
              `${r.stats.total} achados (${r.stats.high} graves) · ` +
              `ritmo médio ${r.rhythm.avgGap}s`);
  t('Reels com corte a cada 3,5s é apontado', () => r.stats.total > 0 || 'não apontou');
  t('nenhum achado é grave (3,5s não é catastrófico)', () => r.stats.high === 0 || `${r.stats.high} graves`);
})();

console.log('\n' + '─'.repeat(52));
console.log((fail ? '✗ ' : '✓ ') + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
