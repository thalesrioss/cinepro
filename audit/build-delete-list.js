#!/usr/bin/env node
/**
 * Combina os filtros que o usuário pediu, dedupa por ID e gera:
 *   - drive-delete-list.csv → id,name,size,path,reason (set final, único)
 *   - drive-delete-keep.csv → primeiros de cada grupo de duplicatas (PRESERVAR)
 */
'use strict';

const fs = require('fs');
const path = require('path');

function parseCsv(p) {
  const txt = fs.readFileSync(p, 'utf8');
  const lines = txt.split('\n');
  const header = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((h, idx) => row[h] = cols[idx]);
    rows.push(row);
  }
  return rows;
}
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

const full = parseCsv(path.join(__dirname, 'drive-audit-full.csv'));
console.log('Total no Drive:', full.length);

const toDelete = new Map(); // id → record
const reasonStats = {};

function flag(r, reason) {
  if (toDelete.has(r.id)) {
    toDelete.get(r.id).reasons += '|' + reason;
  } else {
    toDelete.set(r.id, { ...r, reasons: reason });
  }
  reasonStats[reason] = (reasonStats[reason] || 0) + 1;
}

// ── 1. Tudo em _Mister Horse Previews/ ────────────────────────
for (const r of full) {
  if (r.path && r.path.includes('_Mister Horse Previews')) flag(r, 'MISTER_HORSE_PREVIEWS');
}

// ── 2. Todos os .webp (independente de pasta) ─────────────────
for (const r of full) {
  if (r.ext === 'webp') flag(r, 'WEBP_THUMB');
}

// ── 3. Empty (0 bytes) ─────────────────────────────────────────
for (const r of full) {
  if (parseInt(r.size || 0) === 0) flag(r, 'EMPTY');
}

// ── 4. PDFs, TXTs, RTFs, ZIPs e outros docs/arquivos ──────────
const DOC_EXTS = new Set(['pdf','txt','rtf','zip','rar','doc','docx','exe','dmg']);
for (const r of full) {
  if (DOC_EXTS.has(r.ext)) flag(r, 'DOC_OR_ARCHIVE');
}

// ── 5. HUGE > 500MB ────────────────────────────────────────────
for (const r of full) {
  if (parseInt(r.size || 0) > 500 * 1024 * 1024) flag(r, 'HUGE');
}

// ── 6. Duplicatas: mantém a 1ª de cada grupo (case-insensitive) ─
// Agrupa por nome (lowercased) + tamanho idêntico = cópia real.
const groups = new Map();
for (const r of full) {
  const key = r.name.toLowerCase() + '|' + r.size;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const kept = new Set();
const dups = [];
for (const [, items] of groups) {
  if (items.length > 1) {
    // mantém o de path mais curto (caminho "principal")
    items.sort((a, b) => (a.path || '').length - (b.path || '').length);
    const keep = items[0];
    kept.add(keep.id);
    for (let i = 1; i < items.length; i++) {
      flag(items[i], 'DUPLICATE');
      dups.push({ keep: keep.path + '/' + keep.name, drop: items[i].path + '/' + items[i].name });
    }
  }
}

// Garante que nenhum "kept" entrou na lista por outro motivo (não deveria, mas seguro)
for (const id of kept) {
  if (toDelete.has(id) && toDelete.get(id).reasons === 'DUPLICATE') {
    toDelete.delete(id);
  }
}

// ── Stats ─────────────────────────────────────────────────────
let totalBytes = 0;
for (const r of toDelete.values()) totalBytes += parseInt(r.size || 0);

console.log('\nA deletar (dedupado por ID):', toDelete.size);
console.log('Espaço a recuperar:', fmtBytes(totalBytes));
console.log('\nPor reason:');
for (const [k, v] of Object.entries(reasonStats).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + k.padEnd(28) + String(v).padStart(6));
}

// ── Sample de duplicatas pra revisar ──────────────────────────
console.log('\n5 exemplos de duplicatas (keep → drop):');
for (let i = 0; i < Math.min(5, dups.length); i++) {
  console.log('  KEEP:', dups[i].keep);
  console.log('  DROP:', dups[i].drop);
  console.log('  ---');
}

// ── Write CSV ─────────────────────────────────────────────────
const cols = ['id', 'name', 'ext', 'size', 'path', 'reasons'];
const header = cols.join(',');
function esc(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const lines = [header];
for (const r of toDelete.values()) lines.push(cols.map(c => esc(r[c])).join(','));
fs.writeFileSync(path.join(__dirname, 'drive-delete-list.csv'), lines.join('\n'));
console.log('\nGravado: drive-delete-list.csv (' + toDelete.size + ' linhas)');

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
