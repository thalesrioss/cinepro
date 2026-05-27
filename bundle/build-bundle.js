#!/usr/bin/env node
/**
 * CinePRO — Bundle Builder
 *
 * Seleciona ~750 arquivos universais do manifest e baixa pra dist/files/.
 * Bundle vai dentro do instalador → plugin checa local antes de Drive.
 *
 * Heurística de seleção:
 *   1. Universal por keyword (whoosh, impact, riser, transition, hit, click,
 *      lens flare, light leak, grain, glitch...)
 *   2. Top N por subcategoria
 *   3. TODOS os presets/LUTs/mogrt (small + high-value)
 *   4. Thumbs do Drive pra TODOS os 11.6k cards (file mode)
 *
 * Uso local: `node build-bundle.js`
 * Uso CI: env CINEPRO_OAUTH_CLIENT + CINEPRO_OAUTH_TOKEN
 *
 * Output:
 *   bundle/dist/files/<id>.<ext>       — assets baixados
 *   bundle/dist/thumbs/<id>.jpg         — thumbs do Drive cacheados
 *   bundle/dist/manifest-bundle.json    — mapa de IDs → caminhos relativos
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'manifest', 'dist', 'manifest.json');
const OUT_DIR = path.join(__dirname, 'dist');
const FILES_DIR = path.join(OUT_DIR, 'files');
const THUMBS_DIR = path.join(OUT_DIR, 'thumbs');
const BUNDLE_MANIFEST = path.join(OUT_DIR, 'manifest-bundle.json');

const SIZE_CAP_MB = 450;   // bundle máximo 450MB (instalador final ~540MB)
const CONCURRENCY = 6;

// ── Heurística: keywords universais (sempre baixar tudo que casa) ──
const UNIVERSAL_KEYWORDS = [
  // Audio
  'whoosh', 'woosh', 'swoosh', 'swish',
  'impact', 'impacto', 'hit', 'boom', 'slam', 'crash', 'thud', 'punch',
  'riser', 'rise', 'crescendo',
  'transition', 'transicao', 'wipe', 'sweep',
  'click', 'tap', 'beep', 'blip',
  'glitch', 'distortion',
  'atmosphere', 'atmosfera', 'ambient',
  'drop', 'fall',
  // Visual
  'lens flare', 'flare',
  'light leak', 'leak',
  'grain',
  'overlay',
  'film burn',
];

// Por kind — máximo de arquivos a bundlar
const KIND_CAPS = {
  audio: 280,
  video: 100,
  image: 30,
  mogrt: 250,    // todos (são leves)
  preset: 20,    // todos os .prfpset
  lut: 200,      // todos os .cube/.3dl
  project: 0,
  ae: 0,
  lumetri: 50,
};

// ── Auth (mesmo padrão do manifest builder) ─────────────────────
async function getAuth() {
  // Diagnóstico explícito: mostra exatamente quais env vars estão presentes
  const clientEnv = process.env.CINEPRO_OAUTH_CLIENT;
  const tokenEnv = process.env.CINEPRO_OAUTH_TOKEN;
  console.log('Auth check:');
  console.log('  CINEPRO_OAUTH_CLIENT:', clientEnv ? ('present (' + clientEnv.length + ' chars)') : 'MISSING');
  console.log('  CINEPRO_OAUTH_TOKEN: ', tokenEnv ? ('present (' + tokenEnv.length + ' chars)') : 'MISSING');

  if (clientEnv && tokenEnv) {
    try {
      const client = JSON.parse(clientEnv);
      const cfg = client.installed || client.web;
      if (!cfg || !cfg.client_id) {
        throw new Error('OAUTH_CLIENT json não tem .installed.client_id nem .web.client_id');
      }
      const oAuth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
      const tokenObj = JSON.parse(tokenEnv);
      if (!tokenObj.refresh_token && !tokenObj.access_token) {
        throw new Error('OAUTH_TOKEN json sem refresh_token nem access_token');
      }
      oAuth2.setCredentials(tokenObj);
      console.log('  ✓ OAuth via env vars (CI mode)');
      return oAuth2;
    } catch (e) {
      console.error('  ✗ Erro parseando secrets: ' + e.message);
      throw e;
    }
  }

  // Fallback local: usa arquivos do audit/
  const tokenFile = path.join(ROOT, 'audit', '.oauth-token.json');
  const clientFile = path.join(ROOT, 'audit', 'oauth-client.json');
  if (!fs.existsSync(tokenFile) || !fs.existsSync(clientFile)) {
    console.error('\n❌ SEM CREDENCIAIS OAUTH.');
    console.error('   No CI: precisa dos secrets CINEPRO_OAUTH_CLIENT e CINEPRO_OAUTH_TOKEN');
    console.error('   Local: precisa de audit/oauth-client.json e audit/.oauth-token.json');
    process.exit(1);
  }
  const client = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
  const cfg = client.installed || client.web;
  const oAuth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
  oAuth2.setCredentials(JSON.parse(fs.readFileSync(tokenFile, 'utf8')));
  console.log('  ✓ OAuth via arquivos locais (audit/)');
  return oAuth2;
}

// ── Heurística de seleção ───────────────────────────────────────
function selectFiles(allFiles) {
  console.log('Selecionando arquivos...');

  // Set de IDs selecionados
  const selected = new Set();
  const reasons = {};  // id → reason

  function pick(id, reason) {
    if (!selected.has(id)) {
      selected.add(id);
      reasons[id] = reason;
    }
  }

  // 1. UNIVERSAL: arquivos que matcham keywords universais
  for (const f of allFiles) {
    const name = (f.name + ' ' + (f.path || []).join(' ')).toLowerCase();
    for (const kw of UNIVERSAL_KEYWORDS) {
      if (name.indexOf(kw) !== -1) { pick(f.id, 'kw:' + kw); break; }
    }
  }

  // 2. Por kind — TODOS de tipos pequenos+raros (preset, lut, mogrt)
  for (const f of allFiles) {
    if (selected.has(f.id)) continue;
    if (f.kind === 'preset' || f.kind === 'lut' || f.kind === 'mogrt' || f.kind === 'lumetri') {
      pick(f.id, 'kind:' + f.kind);
    }
  }

  // 3. Top N por subcategoria pra cobrir o resto
  const bySubcat = {};
  for (const f of allFiles) {
    const key = f.category + '|' + (f.subcategory || '_root');
    if (!bySubcat[key]) bySubcat[key] = [];
    bySubcat[key].push(f);
  }
  // Tipos visuais ganham mais slots (sao mais raros, mais valiosos)
  for (const key of Object.keys(bySubcat)) {
    const slots = key.indexOf('Visual') !== -1 ? 8 : 4;
    const top = bySubcat[key].slice(0, slots);
    for (const f of top) pick(f.id, 'subcat-top');
  }

  // Aplica caps por kind
  const byKind = {};
  for (const f of allFiles) {
    if (!selected.has(f.id)) continue;
    if (!byKind[f.kind]) byKind[f.kind] = [];
    byKind[f.kind].push(f);
  }

  const finalSelection = new Set();
  for (const kind of Object.keys(byKind)) {
    const cap = KIND_CAPS[kind] !== undefined ? KIND_CAPS[kind] : 0;
    const sorted = byKind[kind]
      .map(f => ({ f, score: scoreFile(f, reasons[f.id]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, cap);
    for (const item of sorted) finalSelection.add(item.f.id);
  }

  const result = allFiles.filter(f => finalSelection.has(f.id));
  console.log(`Selecionados: ${result.length} arquivos`);
  console.log('Por kind:');
  const stats = {};
  for (const f of result) stats[f.kind] = (stats[f.kind] || 0) + 1;
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(8)} ${v}`);

  return result;
}

function scoreFile(f, reason) {
  // Score maior = mais provavel ficar no cap
  let s = 0;
  if (reason && reason.startsWith('kw:')) s += 100;  // universal keyword é prioritário
  if (reason && reason.startsWith('kind:')) s += 80;  // tipos raros
  if (reason === 'subcat-top') s += 50;
  // Arquivo pequeno é mais barato bundlar
  const sizeMB = (f.size || 0) / 1024 / 1024;
  if (sizeMB < 1) s += 20;
  if (sizeMB > 5) s -= 50;   // penaliza arquivos gigantes
  if (sizeMB > 20) s -= 200;
  return s;
}

// ── Download paralelo controlado ────────────────────────────────
async function downloadFile(drive, fileId, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    return { skipped: true, bytes: fs.statSync(destPath).size };
  }
  const tmpPath = destPath + '.tmp';
  const stream = fs.createWriteStream(tmpPath);
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    res.data.on('end', resolve).on('error', reject).pipe(stream);
  });
  await new Promise(r => stream.on('finish', r));
  fs.renameSync(tmpPath, destPath);
  return { downloaded: true, bytes: fs.statSync(destPath).size };
}

async function downloadThumb(drive, fileId, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) return { skipped: true };
  const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w320`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { failed: true };
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return { downloaded: true, bytes: buf.length };
  } catch (e) {
    return { failed: true };
  }
}

async function processBatch(items, fn) {
  let i = 0;
  let done = 0;
  const total = items.length;
  const errors = [];
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx]); }
      catch (e) { errors.push({ item: items[idx], err: e.message }); }
      done++;
      if (done % 25 === 0 || done === total) {
        process.stdout.write(`\r  ${done}/${total} (${errors.length} erros)   `);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return errors;
}

// ── Main ────────────────────────────────────────────────────────
(async function main() {
  const t0 = Date.now();
  console.log('CinePRO Bundle Builder');
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('Manifest não encontrado em', MANIFEST_PATH);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  console.log(`Manifest: ${manifest.files.length} arquivos`);

  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const selected = selectFiles(manifest.files);

  // Check cap
  let projectedMB = selected.reduce((s, f) => s + (f.size || 0), 0) / 1024 / 1024;
  console.log(`\nTamanho projetado: ${projectedMB.toFixed(0)} MB`);
  if (projectedMB > SIZE_CAP_MB) {
    console.log(`⚠️ Excede cap de ${SIZE_CAP_MB}MB — cortando os maiores`);
    selected.sort((a, b) => (a.size || 0) - (b.size || 0));  // ordena por tamanho asc
    const trimmed = [];
    let acc = 0;
    for (const f of selected) {
      const mb = (f.size || 0) / 1024 / 1024;
      if (acc + mb > SIZE_CAP_MB) break;
      trimmed.push(f);
      acc += mb;
    }
    selected.length = 0;
    selected.push(...trimmed);
    projectedMB = acc;
    console.log(`Após trim: ${selected.length} arquivos, ${projectedMB.toFixed(0)} MB`);
  }

  const auth = await getAuth();
  const drive = google.drive({ version: 'v3', auth });

  // ── Download dos arquivos ──
  console.log('\n=== Baixando arquivos ===');
  await processBatch(selected, async (f) => {
    const ext = f.ext;
    const dest = path.join(FILES_DIR, `${f.id}.${ext}`);
    await downloadFile(drive, f.id, dest);
  });

  // ── Cachear thumbs de TODOS os arquivos (incluindo não-bundled) ──
  console.log('\n\n=== Cacheando thumbs do Drive ===');
  const thumbCandidates = manifest.files.filter(f => f.thumb && (f.kind === 'video' || f.kind === 'image' || f.kind === 'mogrt'));
  console.log(`${thumbCandidates.length} candidatos a thumb`);
  await processBatch(thumbCandidates, async (f) => {
    const dest = path.join(THUMBS_DIR, `${f.id}.jpg`);
    await downloadThumb(drive, f.id, dest);
  });

  // ── Gera bundle manifest ──
  const bundleManifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    sourceManifestBuiltAt: manifest.builtAt,
    files: {},
    thumbs: {},
  };

  for (const f of selected) {
    const localFile = path.join(FILES_DIR, `${f.id}.${f.ext}`);
    if (fs.existsSync(localFile) && fs.statSync(localFile).size > 0) {
      bundleManifest.files[f.id] = `files/${f.id}.${f.ext}`;
    }
  }

  const thumbFiles = fs.readdirSync(THUMBS_DIR);
  for (const t of thumbFiles) {
    const id = t.replace(/\.jpg$/, '');
    if (fs.statSync(path.join(THUMBS_DIR, t)).size > 0) {
      bundleManifest.thumbs[id] = `thumbs/${t}`;
    }
  }

  fs.writeFileSync(BUNDLE_MANIFEST, JSON.stringify(bundleManifest, null, 2));

  // ── Stats finais ──
  const filesSize = fs.readdirSync(FILES_DIR).reduce((s, f) => s + fs.statSync(path.join(FILES_DIR, f)).size, 0);
  const thumbsSize = fs.readdirSync(THUMBS_DIR).reduce((s, f) => s + fs.statSync(path.join(THUMBS_DIR, f)).size, 0);
  const totalMB = (filesSize + thumbsSize) / 1024 / 1024;

  console.log('\n\n✓ Bundle gerado:');
  console.log(`  Arquivos bundle:    ${Object.keys(bundleManifest.files).length}`);
  console.log(`  Thumbs cacheadas:   ${Object.keys(bundleManifest.thumbs).length}`);
  console.log(`  Tamanho files/:     ${(filesSize/1024/1024).toFixed(0)} MB`);
  console.log(`  Tamanho thumbs/:    ${(thumbsSize/1024/1024).toFixed(0)} MB`);
  console.log(`  Total bundle:       ${totalMB.toFixed(0)} MB`);
  console.log(`  Tempo:              ${((Date.now()-t0)/1000).toFixed(0)}s`);
  console.log(`  Saída:              ${OUT_DIR}`);
})().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
