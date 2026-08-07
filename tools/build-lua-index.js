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
//    id \t nome \t ext \t duração
//  O Lua lê com string.gmatch линha a linha — rápido e sem parser.
//
//  Uso:  node tools/build-lua-index.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'manifest', 'dist', 'manifest.json'), 'utf8')
);

// Só áudio COM duração: o painel coloca SFX no playhead, e sem
// duração não dá pra saber se cabe no intervalo até o próximo corte.
const itens = manifest.files.filter(
  (f) => f.kind === 'audio' && typeof f.dur === 'number' && f.dur > 0
);

const linhas = itens.map((f) => {
  // TAB e quebra de linha destruiriam o formato — o nome vem do
  // Drive e já teve surpresa antes (nome com barra, com aspas).
  const nome = String(f.name).replace(/[\t\r\n]+/g, ' ').trim();
  return [f.id, nome, f.ext, f.dur].join('\t');
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
const ruins = linhas.filter((l) => l.split('\t').length !== 4);
if (ruins.length) {
  console.error(`✗ ${ruins.length} linha(s) com número errado de campos`);
  process.exit(1);
}
console.log('  ✓ todas as linhas com 4 campos');

const curtos = itens.filter((f) => f.dur <= 1.2).length;
const longos = itens.filter((f) => f.dur >= 20).length;
console.log(`  ${curtos} curtos (cabem em corte) · ${longos} longos (cama sonora)`);
