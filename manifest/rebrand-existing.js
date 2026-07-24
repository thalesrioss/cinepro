// =============================================================
//  CinePRO — Aplica o rebranding de nomes no manifest JÁ gerado
//
//  O build-manifest só roda contra o Drive (1x/dia). Este script
//  aplica as MESMAS regras de brand-names.js no dist/manifest.json
//  existente, pra o rebrand valer na hora sem esperar o sync.
//
//  Idempotente: rodar duas vezes não muda nada na segunda.
//  Uso:  node rebrand-existing.js [--dry]
// =============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { brandFileName, brandSubName } = require('./brand-names.js');

const DRY  = process.argv.includes('--dry');
const FILE = path.join(__dirname, 'dist', 'manifest.json');

const manifest = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let renamed = 0, subFixed = 0;
const samples = [];
const subMap = new Map();

for (const f of manifest.files) {
  const parent = (f.path && f.path.length) ? f.path[f.path.length - 1] : f.category;
  const newName = brandFileName(f.name, parent);
  if (newName !== f.name) {
    if (samples.length < 10) samples.push([f.name, newName]);
    f.name = newName;
    renamed++;
  }
  if (f.subcategory) {
    const ns = brandSubName(f.subcategory);
    if (ns !== f.subcategory) {
      subMap.set(f.subcategory, ns);
      f.subcategory = ns;
      subFixed++;
    }
  }
  if (Array.isArray(f.path)) f.path = f.path.map(p => brandSubName(p));
}

console.log(`arquivos renomeados : ${renamed}`);
console.log(`subcategorias limpas: ${subFixed} (${subMap.size} rótulos distintos)`);
for (const [a, b] of subMap) console.log(`   ${a}  →  ${b}`);
console.log('\nexemplos de arquivo:');
for (const [a, b] of samples) console.log(`   ${a}\n     → ${b}`);

if (DRY) { console.log('\n[--dry] nada foi escrito.'); process.exit(0); }

const json = JSON.stringify(manifest);
fs.writeFileSync(FILE, json);
fs.writeFileSync(FILE + '.gz', zlib.gzipSync(json, { level: 9 }));
console.log(`\n✓ manifest.json (${(json.length / 1048576).toFixed(1)}MB) + .gz reescritos`);
