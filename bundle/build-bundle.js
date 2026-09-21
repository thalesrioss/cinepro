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
 * DE ONDE BAIXA: do R2 (CDN público), não do Drive. Todos os 15
 * releases de v1.0.0 a v1.0.14 saíram com ~93 MB — o bundle vinha
 * VAZIO e o job ficava verde, porque o download pelo Drive falhava
 * arquivo a arquivo, cada erro era engolido, e o script saía com 0.
 * O R2 já tem tudo (mirror-assets.yml), não precisa de OAuth, e é a
 * mesma origem que o plugin usa em runtime. OAuth agora é só pras
 * thumbs — e opcional.
 *
 * E O SCRIPT FALHA se o bundle vier pequeno. Nunca mais "sucesso"
 * com zero arquivos.
 *
 * Uso local: `node build-bundle.js`
 * Uso CI: env CINEPRO_OAUTH_CLIENT + CINEPRO_OAUTH_TOKEN (só thumbs)
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
const CDN_FILES = 'https://pub-6ace91bcabf540f0a54bb6850d188ef4.r2.dev/';
// O r2.dev devolve 429 em rajada: concorrência 40 falhou em 8.105 de
// 10.037 pedidos (manifest/extract-durations.js). 8 + backoff funciona.
const CDN_CONCURRENCY = 8;
const CDN_MAX_RETRY = 5;
// Abaixo disto o bundle não presta: melhor o build quebrar do que
// sair um instalador que promete 500 efeitos e entrega zero.
const MIN_OK_RATIO = 0.9;
const MIN_TOTAL_MB = 100;
const MANIFEST_PATH = path.join(ROOT, 'manifest', 'dist', 'manifest.json');
const OUT_DIR = path.join(__dirname, 'dist');
const FILES_DIR = path.join(OUT_DIR, 'files');
const THUMBS_DIR = path.join(OUT_DIR, 'thumbs');
const BUNDLE_MANIFEST = path.join(OUT_DIR, 'manifest-bundle.json');

// BUNDLE_CAP_MB no env permite um build pequeno pra teste local.
const SIZE_CAP_MB = Number(process.env.BUNDLE_CAP_MB) || 450;   // bundle máximo 450MB (instalador final ~540MB)
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
    // Sem OAuth só as thumbs ficam de fora. Os arquivos vêm do R2.
    console.warn('  ⚠ sem credenciais OAuth — thumbs do Drive serão puladas');
    return null;
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

// ── Download paralelo controlado (R2, com backoff) ──────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadFile(fileId, ext, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    return { skipped: true, bytes: fs.statSync(destPath).size };
  }
  const url = CDN_FILES + fileId + '.' + ext;
  let wait = 500;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) throw new Error('resposta vazia');
      const tmpPath = destPath + '.tmp';
      fs.writeFileSync(tmpPath, buf);
      fs.renameSync(tmpPath, destPath);
      return { downloaded: true, bytes: buf.length };
    } catch (e) {
      const retryable = /HTTP 429|HTTP 5\d\d|timeout|ECONN|socket|fetch failed|aborted/i.test(e.message);
      if (!retryable || attempt >= CDN_MAX_RETRY) throw e;
      await sleep(wait + Math.random() * wait);
      wait = Math.min(wait * 2, 8000);
    }
  }
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

async function processBatch(items, fn, conc) {
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
  await Promise.all(Array.from({ length: conc || CONCURRENCY }, () => worker()));
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
  const drive = auth ? google.drive({ version: 'v3', auth }) : null;

  // ── Download dos arquivos (R2, sem auth) ──
  console.log('\n=== Baixando arquivos do R2 ===');
  const errosDownload = await processBatch(selected, async (f) => {
    const dest = path.join(FILES_DIR, `${f.id}.${f.ext}`);
    await downloadFile(f.id, f.ext, dest);
  }, CDN_CONCURRENCY);
  if (errosDownload.length) {
    console.warn(`\n  ⚠ ${errosDownload.length} download(s) falharam. Primeiros:`);
    for (const e of errosDownload.slice(0, 8)) console.warn(`    ${e.item.id}.${e.item.ext} — ${e.err}`);
  }

  // ── Cachear thumbs de TODOS os arquivos (incluindo não-bundled) ──
  const thumbCandidates = manifest.files.filter(f => f.thumb && (f.kind === 'video' || f.kind === 'image' || f.kind === 'mogrt'));
  if (drive) {
    console.log('\n\n=== Cacheando thumbs do Drive ===');
    console.log(`${thumbCandidates.length} candidatos a thumb`);
    await processBatch(thumbCandidates, async (f) => {
      const dest = path.join(THUMBS_DIR, `${f.id}.jpg`);
      await downloadThumb(drive, f.id, dest);
    });
  } else {
    console.log(`\n\n(sem OAuth: ${thumbCandidates.length} thumbs puladas)`);
  }

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

  // O guarda-costas: um bundle vazio NAO e sucesso. Foi assim que 15
  // releases sairam prometendo 500 efeitos e entregando zero.
  const nOk = Object.keys(bundleManifest.files).length;
  const ratio = selected.length ? nOk / selected.length : 0;
  const minMB = Math.min(MIN_TOTAL_MB, SIZE_CAP_MB * 0.5);
  if (ratio < MIN_OK_RATIO || filesSize / 1024 / 1024 < minMB) {
    console.error(`\n❌ BUNDLE INSUFICIENTE: ${nOk}/${selected.length} arquivos (${(ratio*100).toFixed(0)}%), ${(filesSize/1024/1024).toFixed(0)} MB.`);
    console.error(`   Minimo: ${(MIN_OK_RATIO*100).toFixed(0)}% e ${minMB} MB. O build PARA aqui de proposito.`);
    process.exit(1);
  }
})().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
