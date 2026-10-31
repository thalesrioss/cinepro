#!/usr/bin/env node
// =============================================================
//  CinePRO — quantas trilhas de fundo de verdade o acervo tem
//  (spike BL-0058, antes de qualquer filtro "Trilha" no painel)
//
//  Só contagem: lê manifest/dist/manifest.json e classifica cada
//  áudio candidato a trilha. Não muda nada no produto.
//
//  Candidato = casa a busca por palavra (music/música/trilha/
//  soundtrack/bgm/loop em nome, subcategoria, caminho ou tags)
//  OU está numa pasta de música do acervo (PLAYLIST/…, Essentials/
//  PLUS/Music). A palavra sozinha erra para os dois lados: pega
//  ambiência ("Ambience Loop") e perde a PLAYLIST quase inteira.
//
//  Classe de cada candidato:
//    musica   ≥ 20 s, faixa inteira (ou versão curta/longa dela)
//    stem     parte de uma faixa (Drums, Bass, [vocals], Stems…)
//    ambiente ambiência/paisagem sonora ("Ambience", Cityscapes)
//    curto    < 20 s (loop, riser, golpe)
//    sem-dur  manifest sem duração
//
//  Licença (heurística por nome/pasta, NÃO é parecer):
//    terceiro  música comercial de artista (FAMOSAS, "Official",
//              "Slowed", "Remix", "kbps"…): não dá para oferecer
//              como trilha licenciada sem o chefe confirmar
//    biblioteca o resto (nomes de banco de trilha: ES_, MA_, source…)
//
//  Uso:  node tools/count-music.js            (relatório)
//        node tools/count-music.js --json     (dados)
//        node tools/count-music.js --list     (lista as músicas)
// =============================================================

'use strict';

const path = require('path');

const KEYWORD = /music|m[uú]sica|trilha|soundtrack|bgm|loop/i;
const MUSIC_FOLDER = /^(PLAYLIST|Essentials\/PLUS\/Music)(\/|$)/;
const STEM = /\bstems?\b|\[(vocals|music)\]|\b(drums|bass|melody|vox|guitars?|synths?|sfx)\b/i;
const AMBIENCE = /ambi[eê]nce|ambiente|cityscapes|provence/i;
const THIRD_PARTY_FOLDER = /^PLAYLIST\/(FAMOSAS|PLAYLIST VOCAL E BEAT TRILHA)(\/|$)/;
const THIRD_PARTY_NAME = /official|slowed|speed ?up|sped ?up|remix|\(\d+ kbps\)|\bmin de\b|\bft\.? |feat\.? |\bmc /i;
const MIN_MUSIC_S = 20;

function pathOf(f) { return (f.path || []).join('/'); }

function isCandidate(f) {
  if (f.kind !== 'audio') return false;
  const hay = [f.name, f.subcategory, pathOf(f), (f.tags || []).join(' ')].join(' ');
  return KEYWORD.test(hay) || MUSIC_FOLDER.test(pathOf(f));
}

function classify(f) {
  const p = pathOf(f);
  // Stem só conta pelo nome ou pela pasta "Stems"; "Bass" no nome de
  // uma faixa inteira é raro no acervo e cai em stem (erra para menos).
  if (STEM.test(f.name) || /(^|\/)stems(\/|$)/i.test(p)) return 'stem';
  if (AMBIENCE.test(f.name + ' ' + p)) return 'ambiente';
  if (typeof f.dur !== 'number') return 'sem-dur';
  if (f.dur < MIN_MUSIC_S) return 'curto';
  return 'musica';
}

function license(f) {
  if (THIRD_PARTY_FOLDER.test(pathOf(f)) || THIRD_PARTY_NAME.test(f.name)) return 'terceiro';
  return 'biblioteca';
}

// Clima = pasta logo abaixo de PLAYLIST (CINEMÁTICA, HIPHOP…); fora
// dela, a pasta do banco de origem (Essentials/PLUS, Pendulum…).
function mood(f) {
  const parts = f.path || [];
  if (parts[0] === 'PLAYLIST') return parts[1] && parts[1] !== 'PLAYLIST VOCAL E BEAT TRILHA' ? parts[1] : 'PLAYLIST (sem clima)';
  return parts.slice(0, 2).join('/') || '(raiz)';
}

function count(files) {
  const out = {
    candidates: 0, byKeyword: 0, byFolderOnly: 0,
    byClass: { musica: 0, stem: 0, ambiente: 0, curto: 0, 'sem-dur': 0 },
    music: { total: 0, biblioteca: 0, terceiro: 0 },
    byMood: {},
    list: [],
  };
  for (const f of files) {
    if (!isCandidate(f)) continue;
    out.candidates++;
    const hay = [f.name, f.subcategory, pathOf(f), (f.tags || []).join(' ')].join(' ');
    if (KEYWORD.test(hay)) out.byKeyword++; else out.byFolderOnly++;
    const c = classify(f);
    out.byClass[c]++;
    if (c !== 'musica') continue;
    const lic = license(f);
    out.music.total++;
    out.music[lic]++;
    const m = mood(f);
    const row = out.byMood[m] || (out.byMood[m] = { biblioteca: 0, terceiro: 0 });
    row[lic]++;
    out.list.push({ id: f.id, name: f.name, dur: f.dur, mood: m, license: lic, path: pathOf(f) });
  }
  return out;
}

function report(r) {
  const lines = [];
  lines.push('Candidatos a trilha (áudio): ' + r.candidates
    + ' (' + r.byKeyword + ' pela palavra, ' + r.byFolderOnly + ' só pela pasta de música)');
  lines.push('Por classe: ' + Object.entries(r.byClass).map(([k, v]) => k + ' ' + v).join(', '));
  lines.push('Músicas (≥ ' + MIN_MUSIC_S + ' s, faixa inteira ou versão): ' + r.music.total
    + ' — biblioteca ' + r.music.biblioteca + ', artista/comercial ' + r.music.terceiro);
  lines.push('');
  lines.push('Clima                          biblioteca  terceiro');
  const moods = Object.entries(r.byMood).sort((a, b) => (b[1].biblioteca + b[1].terceiro) - (a[1].biblioteca + a[1].terceiro));
  for (const [m, v] of moods) lines.push(m.padEnd(30) + String(v.biblioteca).padStart(11) + String(v.terceiro).padStart(10));
  return lines.join('\n');
}

module.exports = { isCandidate, classify, license, mood, count, report };

if (require.main === module) {
  const manifest = require(path.join(__dirname, '..', 'manifest', 'dist', 'manifest.json'));
  const r = count(manifest.files || []);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(report(r));
    if (process.argv.includes('--list')) {
      console.log('');
      for (const m of r.list) console.log([m.license, m.mood, m.dur, m.name].join('\t'));
    }
  }
}
