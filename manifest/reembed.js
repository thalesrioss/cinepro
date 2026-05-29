#!/usr/bin/env node
/**
 * CinePRO — Re-embed offline
 *
 * Recomputa os embeds semânticos de TODOS os arquivos a partir do
 * manifest.json já existente (sem tocar no Drive). Usa a lógica
 * compartilhada de concepts.js (normalização de acentos + match por
 * palavra). Regrava manifest.json + .gz mantendo todo o resto igual.
 *
 * Uso:
 *   node reembed.js            # aplica e regrava
 *   node reembed.js --dry-run  # só mostra o diff de stats
 *
 * Por que isso existe: o build-manifest.js completo precisa caminhar
 * o Drive inteiro via OAuth (lento + credenciais). Pra só recalcular
 * embeds (que dependem apenas de nome/categoria/path/tags já salvos
 * no manifest), isso é instantâneo e roda em qualquer máquina.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const CONCEPT_API = require('./concepts.js');
const CONCEPTS = CONCEPT_API.CONCEPTS;

const DRY = process.argv.includes('--dry-run');
const MANIFEST = path.join(__dirname, 'dist', 'manifest.json');

function blobFor(f) {
  return (
    (f.name || '') + ' ' +
    (f.category || '') + ' ' +
    (f.subcategory || '') + ' ' +
    ((f.path && f.path.join) ? f.path.join(' ') : '') + ' ' +
    ((f.tags && f.tags.join) ? f.tags.join(' ') : '')
  );
}

(function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('manifest.json não encontrado:', MANIFEST);
    process.exit(1);
  }
  const t0 = Date.now();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const files = manifest.files || [];
  console.log(`Carregado: ${files.length} arquivos, ${(manifest.concepts || []).length} conceitos antigos`);

  // Recomputa embeds
  let withEmbed = 0, totalConceptHits = 0, changed = 0;
  const conceptUsage = new Array(CONCEPTS.length).fill(0);

  for (const f of files) {
    const before = JSON.stringify(f.embed || {});
    const embed = CONCEPT_API.computeEmbedFromText(blobFor(f));
    const keys = Object.keys(embed);
    if (keys.length) {
      withEmbed++;
      totalConceptHits += keys.length;
      for (const k of keys) conceptUsage[+k]++;
    }
    if (JSON.stringify(embed) !== before) changed++;
    if (!DRY) f.embed = embed;
  }

  console.log(`\nEmbeds recomputados:`);
  console.log(`  Com embed não-vazio: ${withEmbed}/${files.length} (${(100*withEmbed/files.length).toFixed(1)}%)`);
  console.log(`  Conceitos/arquivo (média): ${(totalConceptHits/Math.max(withEmbed,1)).toFixed(2)}`);
  console.log(`  Arquivos com embed alterado: ${changed}`);

  // Conceitos órfãos (0 arquivos) — sinal de keys ruins
  const orphans = [];
  CONCEPTS.forEach((c, i) => { if (conceptUsage[i] === 0) orphans.push(c.name); });
  if (orphans.length) console.log(`  ⚠️  Conceitos sem nenhum arquivo: ${orphans.join(', ')}`);

  // Top conceitos
  const ranked = CONCEPTS.map((c, i) => ({ name: c.name, n: conceptUsage[i] }))
    .sort((a, b) => b.n - a.n).slice(0, 8);
  console.log(`  Top conceitos: ${ranked.map(r => r.name + '(' + r.n + ')').join(', ')}`);

  if (DRY) {
    console.log('\n[DRY-RUN] nada gravado.');
    return;
  }

  // Atualiza dict de conceitos no manifest (índices DEVEM bater com os embeds)
  manifest.concepts = CONCEPTS.map(c => ({ name: c.name, keys: c.keys }));
  manifest.reembeddedAt = new Date().toISOString();

  const json = JSON.stringify(manifest);
  fs.writeFileSync(MANIFEST, json);
  const gz = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(MANIFEST + '.gz', gz);

  console.log(`\n✓ Regravado:`);
  console.log(`  JSON:    ${(json.length/1024/1024).toFixed(2)} MB`);
  console.log(`  Gzip:    ${(gz.length/1024).toFixed(0)} KB`);
  console.log(`  Tempo:   ${((Date.now()-t0)/1000).toFixed(1)}s`);
})();
