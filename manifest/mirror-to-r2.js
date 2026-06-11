#!/usr/bin/env node
/**
 * CinePRO — Mirror Drive → Cloudflare R2
 *
 * Espelha todos os arquivos do manifest pro bucket R2, que serve como
 * CDN própria (egress zero, sem lock de download por arquivo, sem API
 * key exposta). O Drive vira só staging/fonte-da-verdade.
 *
 * Key no bucket: {driveId}.{ext}  — mesma fórmula que o plugin usa em
 * assetUrlChain() (js/main.js). Se mudar aqui, mude lá.
 *
 * Idempotente: lista o bucket 1x e pula keys que já existem. Re-rodar
 * continua de onde parou — seguro pra timeout/retry de CI.
 *
 * Uso:
 *   node mirror-to-r2.js              # espelha o que falta
 *   node mirror-to-r2.js --dry-run    # só mostra o diff
 *   node mirror-to-r2.js --limit 20   # smoke test com N arquivos
 *
 * Env obrigatório:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_BUCKET (default: cinepro-assets)
 *   + credenciais Drive (CINEPRO_OAUTH_CLIENT/TOKEN ou token local do audit/)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const MANIFEST = path.join(__dirname, 'dist', 'manifest.json');
const DRY    = process.argv.includes('--dry-run');
const LIMIT  = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1] || '0', 10)
  : 0;
const CONCURRENCY = 6;

const CONTENT_TYPES = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', webm: 'video/webm', gif: 'image/gif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  aac: 'audio/aac', ogg: 'audio/ogg',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  tif: 'image/tiff', tiff: 'image/tiff', psd: 'image/vnd.adobe.photoshop',
};

function isTransient(msg) {
  return /ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|ENOTFOUND|network|503|429|rateLimit|userRateLimit|backendError|internalError|SlowDown/i.test(msg);
}

async function withRetry(fn, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = e.message || String(e);
      if (!isTransient(msg) || i === tries - 1) throw e;
      const wait = 500 * Math.pow(2, i) + Math.floor(Math.random() * 300);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Auth Drive — mesmo padrão do build-manifest.js
async function getDriveAuth() {
  if (process.env.CINEPRO_OAUTH_CLIENT && process.env.CINEPRO_OAUTH_TOKEN) {
    const client = JSON.parse(process.env.CINEPRO_OAUTH_CLIENT);
    const cfg = client.installed || client.web;
    const oAuth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
    oAuth2.setCredentials(JSON.parse(process.env.CINEPRO_OAUTH_TOKEN));
    return oAuth2;
  }
  const tokenFile  = path.join(__dirname, '..', 'audit', '.oauth-token.json');
  const clientFile = path.join(__dirname, '..', 'audit', 'oauth-client.json');
  if (!fs.existsSync(tokenFile) || !fs.existsSync(clientFile)) {
    console.error('Sem credenciais Drive. Configure CINEPRO_OAUTH_CLIENT + CINEPRO_OAUTH_TOKEN.');
    process.exit(1);
  }
  const client = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
  const cfg = client.installed || client.web;
  const oAuth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
  oAuth2.setCredentials(JSON.parse(fs.readFileSync(tokenFile, 'utf8')));
  return oAuth2;
}

function getS3() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error('Sem credenciais R2. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
    process.exit(1);
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

async function listExistingKeys(s3, bucket) {
  const keys = new Set();
  let token;
  do {
    const res = await withRetry(() => s3.send(new ListObjectsV2Command({
      Bucket: bucket, ContinuationToken: token, MaxKeys: 1000,
    })));
    (res.Contents || []).forEach(o => keys.add(o.Key));
    token = res.IsTruncated ? res.NextContinuationToken : null;
  } while (token);
  return keys;
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm' + (s % 60) + 's';
}

(async function main() {
  const t0 = Date.now();
  const BUCKET = process.env.R2_BUCKET || 'cinepro-assets';

  if (!fs.existsSync(MANIFEST)) {
    console.error('manifest.json não encontrado:', MANIFEST);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const files = manifest.files || [];
  console.log(`Manifest: ${files.length} arquivos`);

  const s3 = getS3();
  console.log(`Listando bucket "${BUCKET}"...`);
  const existing = await listExistingKeys(s3, BUCKET);
  console.log(`  Já no R2: ${existing.size}`);

  let pending = files.filter(f => !existing.has(f.id + '.' + f.ext));
  console.log(`  Faltando: ${pending.length}`);
  if (LIMIT > 0) {
    pending = pending.slice(0, LIMIT);
    console.log(`  [--limit] processando só ${pending.length}`);
  }
  if (DRY) {
    const bytes = pending.reduce((a, f) => a + (f.size || 0), 0);
    console.log(`\n[DRY-RUN] subiria ${pending.length} arquivos (${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB). Nada enviado.`);
    return;
  }
  if (pending.length === 0) {
    console.log('\n✓ Espelho completo — nada a fazer.');
    return;
  }

  const auth = await getDriveAuth();
  const drive = google.drive({ version: 'v3', auth });

  let done = 0, failed = 0, bytesUp = 0;
  const fails = [];
  let qi = 0;

  async function worker() {
    while (qi < pending.length) {
      const f = pending[qi++];
      const key = f.id + '.' + f.ext;
      try {
        const res = await withRetry(() =>
          drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' })
        );
        const body = Buffer.from(res.data);
        await withRetry(() => s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: body,
          ContentType: CONTENT_TYPES[f.ext] || 'application/octet-stream',
          CacheControl: 'public, max-age=31536000, immutable',
        })));
        done++;
        bytesUp += body.length;
      } catch (e) {
        failed++;
        if (fails.length < 10) fails.push({ name: f.name, error: e.message || String(e) });
      }
      const n = done + failed;
      if (n % 25 === 0 || n === pending.length) {
        const eta = (Date.now() - t0) / n * (pending.length - n);
        process.stdout.write(`\r  ${n}/${pending.length} — ${done} ok, ${failed} fail, ${(bytesUp / 1024 / 1024).toFixed(0)} MB — ETA ${fmtElapsed(eta)}   `);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\n\n✓ Mirror:`);
  console.log(`  Enviados: ${done} (${(bytesUp / 1024 / 1024 / 1024).toFixed(2)} GB)`);
  console.log(`  Falhas:   ${failed}`);
  console.log(`  Tempo:    ${fmtElapsed(Date.now() - t0)}`);
  if (fails.length) {
    console.log('\nPrimeiras falhas:');
    fails.forEach(f => console.log('  -', f.name, '|', f.error));
  }
  // Falha o job se sobrou pendência — CI re-roda e continua (idempotente)
  if (failed > 0) process.exit(2);
})().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
