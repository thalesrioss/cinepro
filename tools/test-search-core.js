#!/usr/bin/env node
// =============================================================
//  Busca da biblioteca (BL-0034) — asserções contra o acervo REAL
//
//  A mesma função (js/search-core.js) serve o painel e o app desktop;
//  o app empacota uma cópia, que tem que ser idêntica.
//
//  Uso:  node tools/test-search-core.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'js', 'search-core.js'));
const manifest = require(path.join(ROOT, 'manifest', 'dist', 'manifest.json'));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  →  ' + detail : '')); }
}

// Painel e app buscam só mídia (PLUGIN_KINDS em js/main.js, MEDIA em app.js).
const MEDIA = { video: 1, audio: 1, image: 1 };
const media = S.buildIndex(manifest.files.filter(f => MEDIA[f.kind]), manifest.concepts);
const all = S.buildIndex(manifest.files, manifest.concepts);

const names = (ix, q) => S.search(ix, q).map(i => ix.items[i].name);
const has = (re) => (n) => re.test(n);

console.log('\nCópia do app');
const copy = path.join(ROOT, 'desktop-app', 'renderer', 'js', 'search-core.js');
check('desktop-app/renderer/js/search-core.js idêntico a js/search-core.js (npm run sync-shared)',
  fs.existsSync(copy) && fs.readFileSync(copy, 'utf8') === fs.readFileSync(path.join(ROOT, 'js', 'search-core.js'), 'utf8'));

console.log('\nPalavra inteira');
const lut = S.search(all, 'lut').map(i => all.items[i]);
check('"lut" (acervo todo) só traz .cube', lut.length > 0 && lut.every(f => f.ext === 'cube'),
  lut.filter(f => f.ext !== 'cube').slice(0, 3).map(f => f.name).join(' | '));
check('"lut" não traz "Flutter"', !lut.some(f => /flutter/i.test(f.name)));
const chuva = names(media, 'chuva');
check('"chuva" não traz "Grain"/"train"/"Trainor"', !chuva.some(has(/grain|train/i)), chuva.filter(has(/grain|train/i)).slice(0, 3).join(' | '));
check('"chuva" ≥ 14 e todos de chuva (acervo tem 14 arquivos de chuva)', chuva.length >= 14 && chuva.every(has(/rain|chuva/i)),
  chuva.length + ': ' + chuva.filter(n => !/rain|chuva/i.test(n)).slice(0, 3).join(' | '));
check('"whoosh" continua 100+', names(media, 'whoosh').length >= 100);
check('"who" (digitando) já acha whoosh', names(media, 'who').slice(0, 5).some(has(/whoosh/i)));
check('"zzqx" → nada', names(media, 'zzqx').length === 0);
check('vazio → nada', S.search(media, '   ').length === 0);

console.log('\nPT → EN');
const risada = names(media, 'risada');
check('"risada" ≥ 20', risada.length >= 20, String(risada.length));
check('"risada": os 6 primeiros com "laugh"', risada.slice(0, 6).every(has(/laugh/i)), risada.slice(0, 6).join(' | '));
check('"transição" ≥ 50', names(media, 'transição').length >= 50);
check('"explosão" ≥ 20', names(media, 'explosão').length >= 20);
check('"porta" ≥ 40', names(media, 'porta').length >= 40);
const porta = names(media, 'porta');
check('"porta": palavra igual antes do prefixo ("Portal" não é o 1º)', !/portal/i.test(porta[0]), porta[0]);
check('"palmas" acha clap/applause', names(media, 'palmas').slice(0, 10).every(has(/clap|applause|palmas/i)));
check('"passos" acha footsteps', names(media, 'passos').slice(0, 5).every(has(/footstep|passo/i)));
check('"vidro" acha vidro/glass', names(media, 'vidro').slice(0, 5).every(has(/vidro|glass/i)));
check('"soco" sem acento e com: mesmo resultado de "SOCO"', names(media, 'soco').join() === names(media, 'SOCO').join());

console.log('\nOrdem e filtros');
const tr = S.translationsOf('passos');
check('plural resolvido ("portas" = "porta")', names(media, 'portas').length > 0 && S.translationsOf('portas').join() === S.translationsOf('porta').join());
check('tradução de "passos" tem footstep', tr.indexOf('footstep') !== -1);
const rs = names(media, 'rain storm');
const both = n => /rain/i.test(n) && /storm/i.test(n);
const lastBoth = rs.map(both).lastIndexOf(true), firstOther = rs.map(both).indexOf(false);
check('dois termos: quem casa os dois ("rain storm") vem antes de quem só tem o conceito',
  lastBoth >= 0 && (firstOther === -1 || firstOther > lastBoth), 'último com os dois: ' + lastBoth + ', primeiro sem: ' + firstOther);
const onlyAudio = S.search(media, 'whoosh', { accept: f => f.kind === 'audio' }).map(i => media.items[i]);
check('accept filtra (só áudio)', onlyAudio.length > 0 && onlyAudio.every(f => f.kind === 'audio'));
check('limit corta', S.search(media, 'whoosh', { limit: 7 }).length === 7);

// Conceito: completa só quando o texto acha pouco, key igual ao termo antes das irmãs.
const tiny = S.buildIndex([
  { name: 'Scream Long', embed: { 0: 1 } },
  { name: 'Breath Soft', embed: { 0: 1 } },
  { name: 'Laugh Kid', embed: { 0: 1 } },
], [{ name: 'vocal', keys: ['scream', 'laugh', 'breath', 'risada'] }]);
const tinyNames = S.search(tiny, 'risada').map(i => tiny.items[i].name);
check('conceito completa; "laugh" (tradução) antes das irmãs', tinyNames[0] === 'Laugh Kid' && tinyNames.length === 3, tinyNames.join(' | '));

console.log('\nDesempenho');
const t0 = Date.now();
for (const q of ['whoosh', 'risada', 'transição', 'chuva', 'porta', 'explosão', 'who', 'rain thunder', 'lut', 'zzqx']) S.search(media, q);
const ms = Date.now() - t0;
check('10 buscas no acervo de mídia < 500 ms', ms < 500, ms + ' ms');

console.log('\n' + pass + ' ok, ' + fail + ' falha(s)');
process.exit(fail ? 1 : 0);
