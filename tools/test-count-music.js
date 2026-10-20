#!/usr/bin/env node
// =============================================================
//  Contagem de trilhas do acervo — asserções (BL-0058)
//
//  O risco aqui é contar errado para o lead decidir o filtro
//  "Trilha": ambiência virar música, stem contar como faixa,
//  ou a PLAYLIST sumir porque o nome não diz "music".
//
//  Uso:  node tools/test-count-music.js
// =============================================================

'use strict';

const assert = require('assert');
const { isCandidate, classify, license, mood, count } = require('./count-music.js');

const a = (name, p, dur, extra) => Object.assign({ kind: 'audio', name, path: p.split('/'), dur, tags: [] }, extra);

let n = 0;
function t(desc, fn) { fn(); n++; console.log('ok  ' + desc); }

t('pasta PLAYLIST entra mesmo sem palavra no nome', () => {
  assert.ok(isCandidate(a('Lux-Inspira - Freedom', 'PLAYLIST/CINEMÁTICA', 199)));
});
t('palavra no nome entra fora das pastas de música', () => {
  assert.ok(isCandidate(a('Rain Storm Ambience Loop 01', 'Cityscapes Vol.1/City Park', 60)));
});
t('vídeo e áudio sem palavra/pasta ficam fora', () => {
  assert.ok(!isCandidate(Object.assign(a('x music', 'PLAYLIST/EPIC', 100), { kind: 'video' })));
  assert.ok(!isCandidate(a('Whoosh 03', 'SFX/TRANSIÇÃO', 1.2)));
});
t('classe: stem, ambiente, curto, sem-dur, música', () => {
  assert.strictEqual(classify(a('Dance like Mike STEMS BASS', 'PLAYLIST/HIPHOP/Dance like Mike', 180)), 'stem');
  assert.strictEqual(classify(a('Feeling Good - [vocals]', 'PLAYLIST/EPIC', 169)), 'stem');
  assert.strictEqual(classify(a('ABYSS Abyss ARP', 'Essentials/PLUS/Music/Stems', 52)), 'stem');
  assert.strictEqual(classify(a('Rain Storm Ambience Loop 01', 'Cityscapes Vol.1', 60)), 'ambiente');
  assert.strictEqual(classify(a('Unstoppable (short version)', 'PLAYLIST/CINEMÁTICA/VIOLIN', 14)), 'curto');
  assert.strictEqual(classify(a('Live in the DarkMain', 'PLAYLIST/ROCK/INSTRUMENTAL', undefined)), 'sem-dur');
  assert.strictEqual(classify(a('Lux-Inspira - Freedom', 'PLAYLIST/CINEMÁTICA', 199)), 'musica');
  assert.strictEqual(classify(a('Mist Resolve', 'Essentials/PLUS/Music', 20)), 'musica', '20 s exatos já é música');
});
t('licença: pasta FAMOSAS e nome de faixa comercial viram terceiro', () => {
  assert.strictEqual(license(a('Teto - Paypal', 'PLAYLIST/FAMOSAS/SLOWED', 226)), 'terceiro');
  assert.strictEqual(license(a('Imagine Dragons Believer Official Instrumental (320 kbps)', 'PLAYLIST/ROCK/INSTRUMENTAL', 204)), 'terceiro');
  assert.strictEqual(license(a('20 min de AGGRESSIVE PHONK 2023', 'PLAYLIST/PHONK', 1165)), 'terceiro');
  assert.strictEqual(license(a('Jan Sanejko - The Brave Ones', 'PLAYLIST/CINEMÁTICA', 103)), 'biblioteca');
});
t('clima: pasta abaixo de PLAYLIST; fora dela, banco de origem', () => {
  assert.strictEqual(mood(a('x', 'PLAYLIST/HIPHOP/sub', 100)), 'HIPHOP');
  assert.strictEqual(mood(a('x', 'PLAYLIST', 100)), 'PLAYLIST (sem clima)');
  assert.strictEqual(mood(a('x', 'Pendulum/Synth', 21)), 'Pendulum/Synth');
});
t('count soma por classe, licença e clima e só lista música', () => {
  const r = count([
    a('Lux-Inspira - Freedom', 'PLAYLIST/CINEMÁTICA', 199),
    a('Teto - Paypal', 'PLAYLIST/FAMOSAS', 226),
    a('Dance like Mike STEMS BASS', 'PLAYLIST/HIPHOP', 180),
    a('Rain Ambience Loop', 'Cityscapes Vol.1', 60),
    a('Whoosh 03', 'SFX', 1),
  ]);
  assert.strictEqual(r.candidates, 4);
  assert.strictEqual(r.byFolderOnly, 3);
  assert.deepStrictEqual(r.byClass, { musica: 2, stem: 1, ambiente: 1, curto: 0, 'sem-dur': 0 });
  assert.deepStrictEqual(r.music, { total: 2, biblioteca: 1, terceiro: 1 });
  assert.deepStrictEqual(r.byMood, { 'CINEMÁTICA': { biblioteca: 1, terceiro: 0 }, FAMOSAS: { biblioteca: 0, terceiro: 1 } });
  assert.strictEqual(r.list.length, 2);
});

console.log('\n' + n + ' casos ok');
