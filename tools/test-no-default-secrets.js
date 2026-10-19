#!/usr/bin/env node
// =============================================================
//  Segredos sem valor padrão no código — asserções (BL-0011)
//
//  O repositório é público. Segredo lido do ambiente não pode
//  cair num literal (`process.env.X_SECRET || 'algo'`): se a
//  variável faltar no deploy, o serviço sobe com um segredo que
//  qualquer um lê no GitHub. Fallback vazio ('') é aceito.
//
//  Uso:  node tools/test-no-default-secrets.js
// =============================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }

// process.env.ALGO_SECRET || 'literal não vazio'  (também TOKEN, KEY, PASS)
const DEFAULT_SECRET = /process\.env\.([A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASS)[A-Z0-9_]*)\s*(?:\|\||\?\?)\s*(['"`])(?!\2)/;

function findDefaultSecrets(source) {
  const hits = [];
  source.split('\n').forEach((line, i) => {
    const m = line.match(DEFAULT_SECRET);
    if (m) hits.push({ line: i + 1, name: m[1] });
  });
  return hits;
}

// segredo-exemplo do rascunho removido; montado em partes para este arquivo não casar no grep
const PLACEHOLDER = ['seu', 'secret', 'key', 'aqui'].join('-');

function trackedJsFiles() {
  const out = execFileSync('git', ['ls-files', '*.js'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(f => f && !f.includes('node_modules/') && fs.existsSync(path.join(ROOT, f)));
}

group('detector');
t('acha segredo com literal padrão',
  () => findDefaultSecrets("const S = process.env.TICTO_WEBHOOK_SECRET || 'troque-aqui';").length === 1 || 'não achou');
t('acha com ?? e aspas duplas',
  () => findDefaultSecrets('const k = process.env.API_KEY ?? "abc";').length === 1 || 'não achou');
t('aceita fallback vazio',
  () => findDefaultSecrets("const k = process.env.DRIVE_API_KEY || '';").length === 0 || 'acusou vazio');
t('ignora variável que não é segredo',
  () => findDefaultSecrets("const p = process.env.NODE_ENV || 'development';").length === 0 || 'acusou NODE_ENV');

group('repositório');
const files = trackedJsFiles();
t('lista arquivos .js versionados', () => files.length > 0 || 'nenhum arquivo');
const offenders = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const h of findDefaultSecrets(src)) offenders.push(f + ':' + h.line + ' ' + h.name);
  if (src.includes(PLACEHOLDER)) offenders.push(f + ' contém o segredo-exemplo do rascunho');
}
t('nenhum segredo com valor padrão no código', () => offenders.length === 0 || offenders.join('; '));
t('rascunho webhook/ticto-webhook-handler.js removido',
  () => !fs.existsSync(path.join(ROOT, 'webhook', 'ticto-webhook-handler.js')) || 'arquivo ainda existe');
t('handler real tictoWebhook continua em firebase/functions/index.js',
  () => /exports\.tictoWebhook\s*=/.test(fs.readFileSync(path.join(ROOT, 'firebase', 'functions', 'index.js'), 'utf8')) || 'sumiu');

console.log('\n' + pass + ' ok, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
