#!/usr/bin/env node
/**
 * CinePRO — Drive Permission Sweep
 *
 * Itera todos os 11.6k arquivos do manifest e garante que cada um
 * tem permissão "anyone with link can view". Resolve os HTTP 403
 * que o plugin (que usa API Key, não OAuth) tomava em arquivos com
 * permissão individual restrita.
 *
 * Uso:
 *   node fix-drive-perms.js --dry-run    # só lista, não modifica
 *   node fix-drive-perms.js              # aplica
 *   node fix-drive-perms.js --check N    # só testa N aleatórios primeiro
 *
 * Idempotente: arquivos que já têm a perm "anyone" são pulados.
 * Throttle: 8 req/s pra ficar bem abaixo do limite (1000/100s = 10/s).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const TOKEN_FILE  = path.join(__dirname, '.oauth-token.json');
const CLIENT_FILE = path.join(__dirname, 'oauth-client.json');
const MANIFEST    = path.join(__dirname, '..', 'manifest', 'dist', 'manifest.json');
const LOG_DIR     = path.join(__dirname, 'perm-fix-logs');
const SCOPES = ['https://www.googleapis.com/auth/drive'];

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const CHECK_ONLY = argv.includes('--check');
const CHECK_COUNT = CHECK_ONLY ? parseInt(argv[argv.indexOf('--check') + 1] || '20', 10) : 0;
const CONCURRENCY = 8;     // ~8 req/s — bem abaixo do limite
const PROGRESS_EVERY = 50;

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

async function getAuth() {
  if (!fs.existsSync(CLIENT_FILE) || !fs.existsSync(TOKEN_FILE)) {
    console.error('Sem credenciais OAuth. Rode audit/drive-trash.js primeiro pra gerar token.');
    process.exit(1);
  }
  const client = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
  const cfg = client.installed || client.web;
  const oAuth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
  oAuth2.setCredentials(JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')));
  return oAuth2;
}

// Erros de rede transientes que valem retry
function isTransient(msg) {
  return /ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|ENOTFOUND|network|503|429|rateLimit|userRateLimit|backendError|internalError/i.test(msg);
}

async function withRetry(fn, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e.message || String(e);
      if (!isTransient(msg) || i === tries - 1) throw e;
      // backoff exponencial com jitter: 400ms, 800ms, 1600ms...
      const wait = 400 * Math.pow(2, i) + Math.floor(Math.random() * 250);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function hasAnyonePermission(drive, fileId) {
  try {
    const res = await withRetry(() => drive.permissions.list({
      fileId,
      fields: 'permissions(id,type,role)',
      pageSize: 100,
    }));
    const perms = res.data.permissions || [];
    return perms.some(p => p.type === 'anyone' && (p.role === 'reader' || p.role === 'writer'));
  } catch (e) {
    // Se a listagem falha, vamos tentar criar mesmo assim
    return false;
  }
}

async function grantAnyonePermission(drive, fileId) {
  try {
    await withRetry(() => drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      sendNotificationEmail: false,
    }));
    return { ok: true };
  } catch (e) {
    const msg = e.message || String(e);
    // Already exists é OK
    if (msg.indexOf('already') !== -1 || msg.indexOf('cannot be granted') !== -1) {
      return { ok: true, note: 'já existe' };
    }
    return { ok: false, error: msg };
  }
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm' + (s % 60) + 's';
}

(async () => {
  const t0 = Date.now();
  if (!fs.existsSync(MANIFEST)) {
    console.error('manifest.json não encontrado:', MANIFEST);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let files = manifest.files;

  if (CHECK_ONLY) {
    // Amostra aleatória
    const sample = [];
    const indices = new Set();
    while (sample.length < CHECK_COUNT && sample.length < files.length) {
      const idx = Math.floor(Math.random() * files.length);
      if (indices.has(idx)) continue;
      indices.add(idx);
      sample.push(files[idx]);
    }
    files = sample;
    console.log(`[CHECK MODE] ${files.length} arquivos aleatórios`);
  } else {
    console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'AO VIVO'}`);
    console.log(`Total no manifest: ${files.length}`);
  }

  const auth = await getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, 'perm-fix-' + stamp + '.json');
  const log = { startedAt: new Date().toISOString(), dryRun: DRY_RUN, granted: [], alreadyOk: [], failed: [] };

  let processed = 0;
  let queueIdx = 0;
  let lastSave = Date.now();

  async function worker() {
    while (queueIdx < files.length) {
      const f = files[queueIdx++];
      try {
        const hasIt = await hasAnyonePermission(drive, f.id);
        if (hasIt) {
          log.alreadyOk.push(f.id);
        } else if (DRY_RUN) {
          log.granted.push({ id: f.id, name: f.name, note: 'would-grant' });
        } else {
          const r = await grantAnyonePermission(drive, f.id);
          if (r.ok) log.granted.push({ id: f.id, name: f.name });
          else log.failed.push({ id: f.id, name: f.name, error: r.error });
        }
      } catch (e) {
        log.failed.push({ id: f.id, name: f.name, error: e.message });
      }
      processed++;
      if (processed % PROGRESS_EVERY === 0 || processed === files.length) {
        const eta = (Date.now() - t0) / processed * (files.length - processed);
        process.stdout.write(
          `\r  ${processed}/${files.length} — ` +
          `${log.granted.length} grant, ${log.alreadyOk.length} ok, ${log.failed.length} fail — ETA ${fmtElapsed(eta)}   `
        );
        // Salva log incremental a cada 5s
        if (Date.now() - lastSave > 5000) {
          fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
          lastSave = Date.now();
        }
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  log.finishedAt = new Date().toISOString();
  log.totalElapsedMs = Date.now() - t0;
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log('\n\n✓ Sweep completo:');
  console.log(`  Granted "anyone reader":  ${log.granted.length}`);
  console.log(`  Já estavam OK:            ${log.alreadyOk.length}`);
  console.log(`  Falharam:                 ${log.failed.length}`);
  console.log(`  Tempo total:              ${fmtElapsed(log.totalElapsedMs)}`);
  console.log(`  Log:                      ${logPath}`);

  if (log.failed.length) {
    console.log('\nPrimeiros 5 fails:');
    log.failed.slice(0, 5).forEach(f => console.log('  -', f.name, '|', f.error));
  }
})().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
