#!/usr/bin/env node
/**
 * CinePRO — Manifest Builder
 *
 * Walka o Drive 1x, aplica skip/branding rules, gera dist/manifest.json
 * que o plugin consome em boot (substitui live Drive walk de ~2min por ~2s fetch).
 *
 * Uso:
 *   node build-manifest.js              # usa OAuth token local
 *   GOOGLE_APPLICATION_CREDENTIALS=...  node build-manifest.js  # CI com service account
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');

// ── Config ───────────────────────────────────────────────────────
const ROOT_ID = '16nWLu5vz2AB9LjuvwNp3vJP57UHBWfEz';
const PAGE_SIZE = 1000;
const MAX_DEPTH = 8;
const OUT_DIR  = path.join(__dirname, 'dist');

// MESMA lógica do plugin (js/main.js) — mantém comportamento idêntico ─
const VALID_EXTS = {
  mp4:'video', mov:'video', avi:'video', mkv:'video', webm:'video', gif:'video',
  mp3:'audio', wav:'audio', m4a:'audio', aac:'audio', ogg:'audio',
  png:'image', jpg:'image', jpeg:'image', tif:'image', tiff:'image', psd:'image',
  mogrt:'mogrt', prfpset:'preset', prproj:'project',
  aep:'ae', cube:'lut', '3dl':'lut', drx:'lumetri',
};

const SKIP_FOLDER_REGEXES = [/^_/, /^00\s*-?\s*leia/i, /previews?$/i];

const CATEGORY_RENAMES = [
  { match: /ocular|sound\s*lib/i,            to: 'CinePRO Sound Library' },
  { match: /mister\s*horse/i,                to: 'CinePRO Motion' },
  { match: /sfx|sound\s*(effect|design)/i,   to: 'CinePRO Sound Design' },
  { match: /\bfoley\b/i,                     to: 'CinePRO Foley' },
  { match: /music|soundtrack|trilha/i,       to: 'CinePRO Music' },
  { match: /preset|prfpset/i,                to: 'CinePRO Presets' },
  { match: /\blut\b|color\s*grading|look/i,  to: 'CinePRO Looks' },
  { match: /transi/i,                        to: 'CinePRO Transitions' },
  { match: /overlay/i,                       to: 'CinePRO Overlays' },
  { match: /template|mogrt|motion\s*graph/i, to: 'CinePRO Templates' },
  { match: /\bmotion\b|animac/i,             to: 'CinePRO Motion' },
  { match: /visual|vfx|efeito\s*visual/i,    to: 'CinePRO Visual' },
  { match: /^geral$/i,                       to: 'CinePRO Essentials' },
];

const AUTO_TAGS = [
  'whoosh','woosh','impacto','sfx','sci','cyberpunk','metal','atmosfera',
  'deep','riser','glitch','cinematic','dark','vintage','foley','passagem',
  'click','typing','keyboard','mouse','camera','medium','small','long',
  'slow','interno','externo','transição','luts','overlay','frame',
];

// ── Helpers ──────────────────────────────────────────────────────
function cleanCategoryName(name) {
  return name.replace(/^\d+\s*[-_.]\s*/, '').trim();
}
function brandCategoryName(name) {
  const clean = cleanCategoryName(name);
  for (const r of CATEGORY_RENAMES) if (r.match.test(clean)) return r.to;
  if (/^cinepro/i.test(clean)) return clean;
  return 'CinePRO ' + clean;  // fallback: nada escapa do branding
}
function shouldSkipFolder(name) {
  return SKIP_FOLDER_REGEXES.some(rx => rx.test(name));
}
function shouldSkipFile(name) {
  if (!name) return true;
  if (name.startsWith('._')) return true;
  if (name === '.DS_Store') return true;
  if (/^MANUAL\s|^COMO\s+INSTALAR/i.test(name)) return true;
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!(ext in VALID_EXTS)) return true;
  if (VALID_EXTS[ext] === null) return true;
  return false;
}
function extractTags(name) {
  const low = (name || '').toLowerCase();
  return AUTO_TAGS.filter(t => low.indexOf(t) !== -1);
}

// ── Auth ─────────────────────────────────────────────────────────
async function getAuth() {
  // 1. CI: OAuth via env vars (refresh_token flow, sem login interativo)
  if (process.env.CINEPRO_OAUTH_CLIENT && process.env.CINEPRO_OAUTH_TOKEN) {
    const client = JSON.parse(process.env.CINEPRO_OAUTH_CLIENT);
    const cfg = client.installed || client.web;
    const oAuth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
    oAuth2.setCredentials(JSON.parse(process.env.CINEPRO_OAUTH_TOKEN));
    return oAuth2;
  }
  // 2. CI: service account JSON em $GOOGLE_APPLICATION_CREDENTIALS
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    return auth.getClient();
  }
  // 3. CI: service account JSON inline em $GCP_SA_KEY (precisa do Drive root compartilhado com o SA)
  if (process.env.GCP_SA_KEY) {
    const creds = JSON.parse(process.env.GCP_SA_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    return auth.getClient();
  }
  // 4. Local: usa o OAuth token que o trash já gerou
  const tokenFile = path.join(__dirname, '..', 'audit', '.oauth-token.json');
  const clientFile = path.join(__dirname, '..', 'audit', 'oauth-client.json');
  if (!fs.existsSync(tokenFile) || !fs.existsSync(clientFile)) {
    console.error('Sem credenciais. Configure CINEPRO_OAUTH_CLIENT + CINEPRO_OAUTH_TOKEN (CI) ou rode antes audit/drive-trash.js pra gerar OAuth token local.');
    process.exit(1);
  }
  const client = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
  const cfg = client.installed || client.web;
  const oAuth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
  oAuth2.setCredentials(JSON.parse(fs.readFileSync(tokenFile, 'utf8')));
  return oAuth2;
}

// ── Walker ───────────────────────────────────────────────────────
let totalScanned = 0;

async function listFolderAll(drive, folderId) {
  let all = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,thumbnailLink)',
      pageSize: PAGE_SIZE,
      pageToken,
    });
    all = all.concat(res.data.files || []);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return all;
}

const isFolder = i => i.mimeType === 'application/vnd.google-apps.folder';

async function walkCategory(drive, folderId, categoryName, pathParts, depth) {
  if (depth >= MAX_DEPTH) return [];
  const items = await listFolderAll(drive, folderId);
  const out = [];

  for (const it of items) {
    if (isFolder(it)) {
      if (shouldSkipFolder(it.name)) continue;
      const subFiles = await walkCategory(drive, it.id, categoryName, pathParts.concat([it.name]), depth + 1);
      out.push(...subFiles);
    } else {
      if (shouldSkipFile(it.name)) continue;
      const ext = (it.name.split('.').pop() || '').toLowerCase();
      const cleanName = it.name.replace(/\.[^.]+$/, '');
      out.push({
        id: it.id,
        name: cleanName,
        ext,
        kind: VALID_EXTS[ext],
        thumb: it.thumbnailLink || null,
        category: categoryName,
        subcategory: pathParts.length > 0 ? cleanCategoryName(pathParts[0]) : null,
        path: pathParts,
        tags: extractTags(cleanName),
        size: parseInt(it.size || 0, 10),
      });
      totalScanned++;
      if (totalScanned % 250 === 0) process.stdout.write(`\r  ${totalScanned} arquivos...`);
    }
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────
(async function main() {
  const t0 = Date.now();
  console.log('CinePRO Manifest Builder');
  console.log('Root:', ROOT_ID);

  const auth = await getAuth();
  const drive = google.drive({ version: 'v3', auth });

  console.log('Listando categorias raiz...');
  const rootItems = await listFolderAll(drive, ROOT_ID);
  const rootFolders = rootItems.filter(i => isFolder(i) && !shouldSkipFolder(i.name));
  const rootFiles   = rootItems.filter(i => !isFolder(i) && !shouldSkipFile(i.name));

  // Agrupa pastas raiz por brand name (mescla pastas que viram o mesmo rótulo)
  const catGroups = new Map(); // brandedName → [folderId, folderId, ...]
  for (const f of rootFolders) {
    const branded = brandCategoryName(f.name);
    if (!catGroups.has(branded)) catGroups.set(branded, { ids: [], originalNames: [] });
    catGroups.get(branded).ids.push(f.id);
    catGroups.get(branded).originalNames.push(f.name);
  }

  const allFiles = [];

  // Arquivos da raiz vão pra "CinePRO Essentials"
  if (rootFiles.length) {
    const essentialsName = brandCategoryName('Geral');
    for (const f of rootFiles) {
      if (shouldSkipFile(f.name)) continue;
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const cleanName = f.name.replace(/\.[^.]+$/, '');
      allFiles.push({
        id: f.id, name: cleanName, ext, kind: VALID_EXTS[ext],
        thumb: f.thumbnailLink || null,
        category: essentialsName, subcategory: null, path: [],
        tags: extractTags(cleanName), size: parseInt(f.size || 0, 10),
      });
    }
  }

  console.log(`\nCategorias: ${catGroups.size}`);
  for (const [branded, info] of catGroups) {
    console.log(`  ${branded}  (${info.originalNames.join(', ')})`);
    for (const folderId of info.ids) {
      const files = await walkCategory(drive, folderId, branded, [], 0);
      allFiles.push(...files);
    }
  }

  // Stats por categoria
  const stats = {};
  for (const f of allFiles) {
    stats[f.category] = (stats[f.category] || 0) + 1;
  }

  // Output
  const manifest = {
    version: 2,
    builtAt: new Date().toISOString(),
    rootId: ROOT_ID,
    counts: {
      total: allFiles.length,
      byCategory: stats,
    },
    categories: Array.from(catGroups.keys()).concat(rootFiles.length ? [brandCategoryName('Geral')] : []),
    files: allFiles,
  };

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(outFile, JSON.stringify(manifest));
  const compactBytes = fs.statSync(outFile).size;

  // Pretty + gzip stats
  const zlib = require('zlib');
  const gz = zlib.gzipSync(JSON.stringify(manifest), { level: 9 });
  fs.writeFileSync(outFile + '.gz', gz);

  console.log(`\n\n✓ Manifest gerado:`);
  console.log(`  Arquivos:   ${allFiles.length}`);
  console.log(`  Categorias: ${manifest.categories.length}`);
  console.log(`  JSON:       ${(compactBytes/1024).toFixed(0)} KB (${(compactBytes/1024/1024).toFixed(2)} MB)`);
  console.log(`  Gzipped:    ${(gz.length/1024).toFixed(0)} KB (-${Math.round((1 - gz.length/compactBytes)*100)}%)`);
  console.log(`  Tempo:      ${((Date.now()-t0)/1000).toFixed(1)}s`);
  console.log(`  Saída:      ${outFile}`);
})().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
