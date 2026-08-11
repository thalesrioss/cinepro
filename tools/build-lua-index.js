#!/usr/bin/env node
// =============================================================
//  Gera o índice que o painel do Resolve consome.
//
//  POR QUE NÃO JSON: o Lua do Resolve não tem biblioteca JSON
//  (confirmado por teste na máquina — `json` global e
//  `require('json')` ambos ausentes). Escrever um parser em Lua
//  puro pra um manifest de 3,1MB com 11.636 entradas seria lento
//  e frágil.
//
//  Formato: uma linha por efeito, campos separados por TAB.
//    id \t nome \t ext \t duração \t categoria \t subcategoria \t packs
//  O Lua lê linha a linha com string.match — rápido e sem parser.
//
//  A coluna `packs` é pré-calculada AQUI, com o mesmo motor que o
//  plugin do Premiere usa (js/sfx-engine.js). Assim o painel do
//  Resolve tem os mesmos packs sem precisar do motor em Lua — e não
//  existem duas implementações da regra pra divergir.
//
//  Uso:  node tools/build-lua-index.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'js', 'sfx-engine.js'));
const RC = require(path.join(ROOT, 'js', 'remote-config.js'));
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'manifest', 'dist', 'manifest.json'), 'utf8')
);

// Só áudio COM duração: o painel coloca SFX no playhead, e sem
// duração não dá pra saber se cabe no intervalo até o próximo corte.
const itens = manifest.files.filter(
  (f) => f.kind === 'audio' && typeof f.dur === 'number' && f.dur > 0
);

// ── Packs: mesma pontuação do plugin (cosseno sobre os conceitos) ──
const recipes = RC.validateRecipes(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'recipes.json'), 'utf8'))
).value;
const cIdx = E.conceptIndex(manifest.concepts);

// Pra cada pack, os N melhores. Um efeito pode estar em vários.
const PACK_TAM = 120;
const packDe = new Map();
for (const r of recipes) {
  const pontuados = itens
    .map((f) => ({ f, s: E.genreFit(f, r, cIdx) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, PACK_TAM);
  for (const { f } of pontuados) {
    if (!packDe.has(f.id)) packDe.set(f.id, []);
    packDe.get(f.id).push(r.id);
  }
}

const limpa = (s) => String(s || '').replace(/[\t\r\n]+/g, ' ').trim();

const linhas = itens.map((f) => {
  // TAB e quebra de linha destruiriam o formato — o nome vem do
  // Drive e já teve surpresa antes (nome com barra, com aspas).
  const nome = limpa(f.name);
  const cat = limpa(f.category);
  // Subcategoria: é o que faz a categoria da lateral EXPANDIR, igual
  // ao Premiere. Sem ela o painel do Resolve teria hierarquia rasa.
  const sub = limpa(f.subcategory);
  const packs = (packDe.get(f.id) || []).join(',');
  return [f.id, nome, f.ext, f.dur, cat, sub, packs].join('\t');
});

// Ordena por nome pra busca ficar previsível
linhas.sort((a, b) => a.split('\t')[1].localeCompare(b.split('\t')[1], 'pt'));

const saida = path.join(ROOT, 'data', 'lua-index.tsv');
const conteudo = linhas.join('\n') + '\n';
fs.writeFileSync(saida, conteudo, 'utf8');

const kb = (conteudo.length / 1024).toFixed(0);
const gz = (zlib.gzipSync(conteudo).length / 1024).toFixed(0);
console.log(`✓ ${linhas.length} efeitos → data/lua-index.tsv`);
console.log(`  ${kb}KB (${gz}KB gzip)`);

// Verificação de integridade: nenhum campo pode ter TAB a mais
const ruins = linhas.filter((l) => l.split('\t').length !== 7);
if (ruins.length) {
  console.error(`✗ ${ruins.length} linha(s) com número errado de campos`);
  process.exit(1);
}
console.log('  ✓ todas as linhas com 7 campos');
const comPack = linhas.filter((l) => l.split('\t')[6]).length;
console.log(`  ${comPack} efeitos em pelo menos um pack`);
const comSub = linhas.filter((l) => l.split('\t')[5]).length;
console.log(`  ${comSub} efeitos com subcategoria (expandem na lateral)`);

const curtos = itens.filter((f) => f.dur <= 1.2).length;
const longos = itens.filter((f) => f.dur >= 20).length;
console.log(`  ${curtos} curtos (cabem em corte) · ${longos} longos (cama sonora)`);

// ── Config pro painel (chave<TAB>valor) ──────────────────────
// O Lua do Resolve não tem parser JSON, e o diagnóstico precisa dos
// MESMOS limites que o plugin usa. Em vez de repetir os números no
// Lua (que divergiriam na primeira mudança), exportamos daqui —
// data/diagnostics.json continua sendo a única fonte de verdade.
const diag = RC.validateDiagnostics(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'diagnostics.json'), 'utf8'))
).value;

const cfg = Object.entries(diag).map(([k, v]) => `${k}\t${v}`);
for (const r of recipes) cfg.push(`pack.${r.id}\t${r.label}`);

fs.writeFileSync(path.join(ROOT, 'data', 'lua-config.tsv'), cfg.join('\n') + '\n', 'utf8');
console.log(`✓ config do painel → data/lua-config.tsv (${cfg.length} chaves)`);
