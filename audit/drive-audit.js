#!/usr/bin/env node
/**
 * CinePRO — Drive Audit (read-only)
 *
 * Walks the entire Drive folder recursively and classifies every file:
 *   - VALID      → extensão suportada pelo plugin
 *   - UNKNOWN    → extensão fora da whitelist (pdf, txt, doc, zip, exe, rar...)
 *   - MAC_TRASH  → ._files e .DS_Store (resource forks macOS)
 *   - DUPLICATE  → mesmo nome em ≥2 pastas (mantém o primeiro, marca o resto)
 *   - EMPTY      → 0 bytes
 *   - HUGE       → > 500 MB
 *   - SKIPPED    → folder ignorado pelo plugin (/^_/, /leia/i, /previews?$/i)
 *
 * Saída:
 *   audit/drive-audit-full.csv   — TODOS os arquivos, uma linha cada
 *   audit/drive-audit-trash.csv  — só os candidatos a deletar
 *   audit/drive-audit-summary.txt — resumo agrupado
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────
const API_KEY    = 'AIzaSyDH8LOHaVtJdWXSc3WjxU-z4JyGhrqYu5o';
const ROOT_ID    = '16nWLu5vz2AB9LjuvwNp3vJP57UHBWfEz';
const PAGE_SIZE  = 1000;
const MAX_DEPTH  = 8;
const HUGE_BYTES = 500 * 1024 * 1024;

const OUT_DIR = __dirname;

// ── Mesma whitelist do plugin (js/main.js) ───────────────────────
const VALID_EXTS = {
  mp4:'video', mov:'video', avi:'video', mkv:'video', webm:'video', gif:'video',
  mp3:'audio', wav:'audio', m4a:'audio', aac:'audio', ogg:'audio',
  png:'image', jpg:'image', jpeg:'image', tif:'image', tiff:'image', psd:'image',
  mogrt:'mogrt', prfpset:'preset', prproj:'project',
  aep:'ae', cube:'lut', '3dl':'lut', drx:'lumetri',
};

const SKIP_FOLDER_REGEXES = [/^_/, /^00\s*-?\s*leia/i, /previews?$/i];

// ── Helpers ──────────────────────────────────────────────────────
function shouldSkipFolder(name) {
  return SKIP_FOLDER_REGEXES.some(rx => rx.test(name));
}

function isMacTrash(name) {
  return name === '.DS_Store' || name.startsWith('._');
}

function extOf(name) {
  const m = (name || '').match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

async function listFolderPage(folderId, pageToken) {
  const url = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent(`'${folderId}' in parents and trashed=false`)
    + '&fields=nextPageToken,files(id,name,mimeType,size,parents)'
    + '&pageSize=' + PAGE_SIZE
    + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '')
    + '&key=' + API_KEY;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Drive API ' + r.status + ' on folder ' + folderId);
  return r.json();
}

async function listFolderAll(folderId) {
  let all = [];
  let token = null;
  do {
    const data = await listFolderPage(folderId, token);
    all = all.concat(data.files || []);
    token = data.nextPageToken;
  } while (token);
  return all;
}

const isFolder = i => i.mimeType === 'application/vnd.google-apps.folder';

// ── Walker ───────────────────────────────────────────────────────
const records = [];      // todos os arquivos achados
let visitedFolders = 0;

async function walk(folderId, pathParts, depth, inSkipped) {
  if (depth > MAX_DEPTH) return;
  visitedFolders++;
  if (visitedFolders % 25 === 0) {
    process.stdout.write(`\r  ${visitedFolders} pastas, ${records.length} arquivos...`);
  }

  let items;
  try {
    items = await listFolderAll(folderId);
  } catch (e) {
    console.warn('\n[warn] folder ' + folderId + ': ' + e.message);
    return;
  }

  for (const it of items) {
    if (isFolder(it)) {
      const subSkipped = inSkipped || shouldSkipFolder(it.name);
      await walk(it.id, pathParts.concat([it.name]), depth + 1, subSkipped);
    } else {
      records.push({
        id:    it.id,
        name:  it.name,
        size:  parseInt(it.size || 0, 10),
        mime:  it.mimeType,
        path:  pathParts.join(' / '),
        depth: depth,
        inSkippedFolder: inSkipped,
      });
    }
  }
}

// ── Classify ─────────────────────────────────────────────────────
function classify(records) {
  // Dedup index: name (lowercased) → array of records
  const byName = new Map();
  for (const r of records) {
    const key = r.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }

  for (const r of records) {
    const reasons = [];
    const ext = extOf(r.name);

    if (isMacTrash(r.name))                       reasons.push('MAC_TRASH');
    if (r.inSkippedFolder)                        reasons.push('SKIPPED_FOLDER');
    if (r.size === 0)                             reasons.push('EMPTY');
    if (r.size > HUGE_BYTES)                      reasons.push('HUGE');
    if (!isMacTrash(r.name) && !(ext in VALID_EXTS) && ext !== '') reasons.push('UNKNOWN_EXT');
    if (!isMacTrash(r.name) && ext === '')        reasons.push('NO_EXT');

    // Duplicate: mesmo nome aparece em outro caminho
    const group = byName.get(r.name.toLowerCase());
    if (group.length > 1 && group[0].id !== r.id) reasons.push('DUPLICATE');

    r.reasons = reasons;
    r.ext     = ext || '(none)';
    r.isTrash = reasons.length > 0 && !(reasons.length === 1 && reasons[0] === 'DUPLICATE'
                                        && group[0].size === r.size);
    // DUPLICATE só conta como trash se for cópia real (mesmo tamanho do primeiro)
    if (reasons.includes('DUPLICATE')) {
      const first = group[0];
      if (first.size === r.size) r.isTrash = true;
    }
    if (reasons.length === 0) r.isTrash = false;
  }
}

// ── CSV ──────────────────────────────────────────────────────────
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function writeCsv(filepath, rows, columns) {
  const header = columns.join(',');
  const lines = [header];
  for (const row of rows) {
    lines.push(columns.map(c => csvEscape(row[c])).join(','));
  }
  fs.writeFileSync(filepath, lines.join('\n'));
}

// ── Main ─────────────────────────────────────────────────────────
(async function main() {
  const t0 = Date.now();
  console.log('CinePRO Drive Audit');
  console.log('Root:', ROOT_ID);
  console.log('Iniciando walk...\n');

  await walk(ROOT_ID, [], 0, false);
  console.log('\n\nWalk concluído.');
  console.log('  Pastas visitadas:', visitedFolders);
  console.log('  Arquivos achados:', records.length);

  classify(records);

  // Stats agrupados
  const byReason = {};
  let totalBytes = 0;
  let trashBytes = 0;
  for (const r of records) {
    totalBytes += r.size;
    if (r.isTrash) trashBytes += r.size;
    for (const reason of r.reasons) {
      byReason[reason] = byReason[reason] || { count: 0, bytes: 0, examples: [] };
      byReason[reason].count++;
      byReason[reason].bytes += r.size;
      if (byReason[reason].examples.length < 5) {
        byReason[reason].examples.push(`${r.path}/${r.name} (${fmtBytes(r.size)})`);
      }
    }
  }

  // Por extensão (somente UNKNOWN)
  const unknownByExt = {};
  for (const r of records) {
    if (r.reasons.includes('UNKNOWN_EXT')) {
      unknownByExt[r.ext] = unknownByExt[r.ext] || { count: 0, bytes: 0 };
      unknownByExt[r.ext].count++;
      unknownByExt[r.ext].bytes += r.size;
    }
  }

  // ── Output ─────────────────────────────────────────────────
  const cols = ['id', 'name', 'ext', 'size', 'path', 'depth', 'isTrash', 'reasons'];
  const fullRows = records.map(r => ({
    ...r,
    reasons: r.reasons.join('|'),
  }));
  writeCsv(path.join(OUT_DIR, 'drive-audit-full.csv'), fullRows, cols);
  writeCsv(path.join(OUT_DIR, 'drive-audit-trash.csv'),
           fullRows.filter(r => r.isTrash), cols);

  // Resumo legível
  const summaryLines = [];
  summaryLines.push('═══════════════════════════════════════════════════════════');
  summaryLines.push('  CinePRO — Drive Audit Summary');
  summaryLines.push('  ' + new Date().toISOString());
  summaryLines.push('═══════════════════════════════════════════════════════════');
  summaryLines.push('');
  summaryLines.push(`Pastas visitadas:    ${visitedFolders}`);
  summaryLines.push(`Arquivos no Drive:   ${records.length}`);
  summaryLines.push(`Tamanho total:       ${fmtBytes(totalBytes)}`);
  summaryLines.push(`Candidatos a apagar: ${fullRows.filter(r => r.isTrash).length}`);
  summaryLines.push(`Espaço a recuperar:  ${fmtBytes(trashBytes)}`);
  summaryLines.push('');
  summaryLines.push('───────────────────────────────────────────────────────────');
  summaryLines.push('  Por classificação');
  summaryLines.push('───────────────────────────────────────────────────────────');
  for (const [reason, data] of Object.entries(byReason).sort((a, b) => b[1].count - a[1].count)) {
    summaryLines.push(`\n[${reason}]  ${data.count} arquivos · ${fmtBytes(data.bytes)}`);
    for (const ex of data.examples) summaryLines.push('  · ' + ex);
  }

  summaryLines.push('');
  summaryLines.push('───────────────────────────────────────────────────────────');
  summaryLines.push('  Extensões desconhecidas (UNKNOWN_EXT)');
  summaryLines.push('───────────────────────────────────────────────────────────');
  for (const [ext, data] of Object.entries(unknownByExt).sort((a, b) => b[1].count - a[1].count)) {
    summaryLines.push(`  .${ext.padEnd(8)} ${String(data.count).padStart(5)} arquivos · ${fmtBytes(data.bytes)}`);
  }

  summaryLines.push('');
  summaryLines.push('───────────────────────────────────────────────────────────');
  summaryLines.push('  Arquivos:');
  summaryLines.push('───────────────────────────────────────────────────────────');
  summaryLines.push('  drive-audit-full.csv   — tudo (' + records.length + ' linhas)');
  summaryLines.push('  drive-audit-trash.csv  — só os candidatos a apagar (' + fullRows.filter(r => r.isTrash).length + ' linhas)');
  summaryLines.push('');
  summaryLines.push(`Tempo: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const summary = summaryLines.join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'drive-audit-summary.txt'), summary);
  console.log('\n' + summary);
})().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
