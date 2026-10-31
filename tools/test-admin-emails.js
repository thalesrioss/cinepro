#!/usr/bin/env node
// BL-0129: a lista ADMIN_EMAILS do app desktop tem os admins vitalícios
// (Thales, Felipe Marques e Felipe Rodrigues), sem apagar nenhum, em
// minúsculas (app.js compara com email.toLowerCase()) e sem repetição.
// Rodar: node tools/test-admin-emails.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'desktop-app/renderer/js/config.js'), 'utf8');
const ctx = {};
vm.runInNewContext(src + '\nthis.CINEPRO_CONFIG = CINEPRO_CONFIG;', ctx);
const admins = ctx.CINEPRO_CONFIG.ADMIN_EMAILS;

let ok = 0, fail = 0;
function check(name, fn) {
  try { fn(); ok++; console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FALHA ' + name + ': ' + e.message); }
}

check('ADMIN_EMAILS é uma lista', () => {
  assert.ok(Array.isArray(admins), 'ADMIN_EMAILS não é array');
});

['thales.rioss@gmail.com', 'marquesfelipe059@gmail.com', 'feliperod003@gmail.com'].forEach((e) => {
  check('admin presente: ' + e, () => {
    assert.ok(admins.indexOf(e) !== -1, e + ' fora da lista');
  });
});

check('todos em minúsculas e sem espaços (app.js compara em minúsculas)', () => {
  admins.forEach((e) => assert.strictEqual(e, e.trim().toLowerCase(), e));
});

check('sem e-mail repetido', () => {
  assert.strictEqual(new Set(admins).size, admins.length);
});

console.log('\n' + ok + ' ok, ' + fail + ' falha(s)');
process.exit(fail ? 1 : 0);
