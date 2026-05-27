#!/usr/bin/env node
/**
 * CinePRO — Drive Trash (OAuth, recuperável)
 *
 * Envia arquivos pra LIXEIRA do Drive (não deleta permanentemente).
 * Janela de recuperação: 30 dias.
 *
 * Uso:
 *   node drive-trash.js --dry-run          # mostra o que faria
 *   node drive-trash.js                    # roda de verdade
 *   node drive-trash.js --restore <log>    # restaura tudo de um log anterior
 *
 * Pré-requisito UMA VEZ:
 *   1. Vá em https://console.cloud.google.com/apis/credentials?project=cinepro-42971
 *   2. CREATE CREDENTIALS → OAuth client ID → Desktop app
 *   3. DOWNLOAD JSON → salve como ./oauth-client.json nesta pasta
 *   4. Garanta que a Drive API está habilitada:
 *      https://console.cloud.google.com/apis/library/drive.googleapis.com?project=cinepro-42971
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const url  = require('url');
const { exec } = require('child_process');
const { google } = require('googleapis');

const TOKEN_FILE  = path.join(__dirname, '.oauth-token.json');
const CLIENT_FILE = path.join(__dirname, 'oauth-client.json');
const LIST_CSV    = path.join(__dirname, 'drive-delete-list.csv');
const LOG_DIR     = path.join(__dirname, 'trash-logs');
const SCOPES      = ['https://www.googleapis.com/auth/drive'];

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const RESTORE = argv.includes('--restore');
const RESTORE_LOG = RESTORE ? argv[argv.indexOf('--restore') + 1] : null;

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

// ── OAuth flow ──────────────────────────────────────────────────
async function getAuth() {
  if (!fs.existsSync(CLIENT_FILE)) {
    console.error('\n[ERRO] Falta o arquivo oauth-client.json.');
    console.error('Como obter:');
    console.error('  1. https://console.cloud.google.com/apis/credentials?project=cinepro-42971');
    console.error('  2. CREATE CREDENTIALS → OAuth client ID → Application type: Desktop app');
    console.error('  3. DOWNLOAD JSON → salve como ' + CLIENT_FILE);
    console.error('  4. Garanta que a Drive API esta ativa:');
    console.error('     https://console.cloud.google.com/apis/library/drive.googleapis.com?project=cinepro-42971');
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
  const config = creds.installed || creds.web;
  const oAuth2 = new google.auth.OAuth2(config.client_id, config.client_secret, 'http://localhost:53682/');

  if (fs.existsSync(TOKEN_FILE)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    oAuth2.setCredentials(token);
    return oAuth2;
  }

  // Browser flow
  const authUrl = oAuth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

  console.log('\nAbrindo navegador pra autorizar acesso ao Drive...');
  console.log('Se nao abrir, cole este URL no browser:\n  ' + authUrl + '\n');
  exec((process.platform === 'darwin' ? 'open ' : (process.platform === 'win32' ? 'start ' : 'xdg-open ')) + '"' + authUrl + '"');

  // Local callback server
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.query.code) {
        res.end('<html><body style="font-family:system-ui;padding:40px;background:#0e1a26;color:#e6f3ff"><h2>Autorizado ✓</h2><p>Pode fechar essa aba e voltar ao terminal.</p></body></html>');
        server.close();
        resolve(parsed.query.code);
      } else if (parsed.query.error) {
        res.end('Erro: ' + parsed.query.error);
        server.close();
        reject(new Error(parsed.query.error));
      }
    }).listen(53682, () => console.log('Aguardando autorizacao no navegador (porta 53682)...'));
  });

  const { tokens } = await oAuth2.getToken(code);
  oAuth2.setCredentials(tokens);
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  fs.chmodSync(TOKEN_FILE, 0o600);
  console.log('Token salvo em ' + TOKEN_FILE + ' (chmod 600)\n');
  return oAuth2;
}

// ── CSV parsing ──────────────────────────────────────────────────
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
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
    else { if (c === ',') { out.push(cur); cur = ''; } else if (c === '"') inQ = true; else cur += c; }
  }
  out.push(cur); return out;
}

// ── Trash batch ──────────────────────────────────────────────────
async function trashFiles(drive, items) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, 'trash-' + stamp + '.json');
  const log = { startedAt: new Date().toISOString(), trashed: [], failed: [] };
  let processed = 0, totalBytes = 0;

  // Pre-flight: salva o log header
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log('Log: ' + logPath + '\n');

  for (const item of items) {
    try {
      await drive.files.update({ fileId: item.id, requestBody: { trashed: true } });
      log.trashed.push({ id: item.id, name: item.name, size: item.size, path: item.path });
      totalBytes += parseInt(item.size || 0);
    } catch (e) {
      log.failed.push({ id: item.id, name: item.name, error: e.message });
    }
    processed++;
    if (processed % 25 === 0 || processed === items.length) {
      process.stdout.write('\r  ' + processed + '/' + items.length + ' (' + fmtBytes(totalBytes) + ' lixeira, ' + log.failed.length + ' falhas)   ');
      // Persiste o log incrementalmente — se travar, não perdemos contexto
      fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    }
  }
  log.finishedAt = new Date().toISOString();
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log('\n\nResumo:');
  console.log('  ' + log.trashed.length + ' arquivos pra lixeira');
  console.log('  ' + fmtBytes(totalBytes) + ' recuperaveis');
  console.log('  ' + log.failed.length + ' falhas');
  console.log('  Log: ' + logPath);
  console.log('\nJanela de restauracao: 30 dias (Drive Trash)');
  console.log('Restore com: node drive-trash.js --restore ' + path.basename(logPath));
}

async function restore(drive, logFilename) {
  const logPath = path.join(LOG_DIR, logFilename);
  if (!fs.existsSync(logPath)) {
    console.error('Log nao encontrado: ' + logPath);
    process.exit(1);
  }
  const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  console.log('Restaurando ' + log.trashed.length + ' arquivos...\n');
  let ok = 0, fail = 0;
  for (const item of log.trashed) {
    try {
      await drive.files.update({ fileId: item.id, requestBody: { trashed: false } });
      ok++;
    } catch (e) {
      fail++;
    }
    if ((ok + fail) % 25 === 0) process.stdout.write('\r  ' + (ok + fail) + '/' + log.trashed.length);
  }
  console.log('\n\nRestaurados: ' + ok + ' | Falhas: ' + fail);
}

// ── Main ─────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

(async () => {
  const auth = await getAuth();
  const drive = google.drive({ version: 'v3', auth });

  if (RESTORE) {
    await restore(drive, RESTORE_LOG);
    return;
  }

  if (!fs.existsSync(LIST_CSV)) {
    console.error('Falta drive-delete-list.csv. Rode build-delete-list.js primeiro.');
    process.exit(1);
  }

  const items = parseCsv(LIST_CSV);
  let bytes = 0;
  for (const r of items) bytes += parseInt(r.size || 0);

  console.log('CinePRO Drive Trash');
  console.log('  Arquivos:  ' + items.length);
  console.log('  Tamanho:   ' + fmtBytes(bytes));
  console.log('  Modo:      ' + (DRY_RUN ? 'DRY-RUN (não vai apagar)' : 'AO VIVO — trash'));
  console.log('');

  if (DRY_RUN) {
    console.log('[dry-run] sample dos 10 primeiros:');
    items.slice(0, 10).forEach(r => console.log('  ' + r.reasons.padEnd(25) + r.name + ' (' + fmtBytes(parseInt(r.size||0)) + ')'));
    console.log('\nNada foi alterado. Rode sem --dry-run pra aplicar.');
    return;
  }

  // Verificação dupla antes de ir
  console.log('Iniciando em 5s... Ctrl+C pra cancelar.');
  await new Promise(r => setTimeout(r, 5000));
  await trashFiles(drive, items);
})().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
