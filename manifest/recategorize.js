#!/usr/bin/env node
/**
 * CinePRO — Recategorização para 5 macro-pastas
 *
 * Colapsa as ~12 categorias fragmentadas em 5 macro-categorias derivadas
 * do TIPO do arquivo (ext), não de regex de nome de pasta. Determinístico:
 *   audio                       -> Sound Effects
 *   mogrt                       -> MOGRT
 *   prfpset                     -> Presets
 *   cube/3dl                    -> LUTs
 *   resto (video/img/ae/...)    -> Visual Effects
 *
 * Achata: subcategorias somem (busca vira o caminho principal). Reescreve
 * manifest.categories + cada file.category, regrava json + .gz.
 *
 * A MESMA função vive em build-manifest.js (macroCategoryFor) — se mudar
 * aqui, mude lá pra o rebuild semanal não reverter.
 *
 * Uso: node recategorize.js [--dry-run]
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const DRY = process.argv.includes('--dry-run');
const MANIFEST = path.join(__dirname, 'dist', 'manifest.json');

// Ordem = ordem no sidebar
const MACRO_ORDER = ['Sound Effects', 'Visual Effects', 'LUTs', 'Presets', 'MOGRT'];
const AUDIO = { mp3:1, wav:1, m4a:1, aac:1, ogg:1, aif:1, aiff:1 };

function macroCategoryFor(ext) {
  ext = (ext || '').toLowerCase();
  if (AUDIO[ext]) return 'Sound Effects';
  if (ext === 'mogrt') return 'MOGRT';
  if (ext === 'prfpset') return 'Presets';
  if (ext === 'cube' || ext === '3dl') return 'LUTs';
  return 'Visual Effects';
}

(function main() {
  if (!fs.existsSync(MANIFEST)) { console.error('manifest.json não encontrado'); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const files = manifest.files || [];

  const counts = {};
  MACRO_ORDER.forEach(c => counts[c] = 0);
  let changed = 0;
  for (const f of files) {
    const macro = macroCategoryFor(f.ext);
    counts[macro]++;
    if (f.category !== macro) changed++;
    if (!DRY) { f.category = macro; f.subcategory = null; }
  }

  console.log(`Arquivos: ${files.length} | recategorizados: ${changed}`);
  console.log('Distribuição nas 5 macro-pastas:');
  MACRO_ORDER.forEach(c => console.log(`  ${c.padEnd(16)} ${counts[c]}`));

  if (DRY) { console.log('\n[DRY-RUN] nada gravado.'); return; }

  // Só mantém no sidebar as categorias que têm arquivos, na ordem canônica
  manifest.categories = MACRO_ORDER.filter(c => counts[c] > 0);
  manifest.recategorizedAt = new Date().toISOString();

  const json = JSON.stringify(manifest);
  fs.writeFileSync(MANIFEST, json);
  fs.writeFileSync(MANIFEST + '.gz', zlib.gzipSync(json, { level: 9 }));
  console.log(`\n✓ Regravado: ${(json.length/1024/1024).toFixed(2)} MB | categorias: ${manifest.categories.join(', ')}`);
})();
