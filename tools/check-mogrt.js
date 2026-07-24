#!/usr/bin/env node
// =============================================================
//  CinePRO — Validador de template de legenda (.mogrt)
//
//  Confere se um template que VOCÊ autorou está pronto pro motor
//  de legendas antes de subir pro Drive. Roda offline, sem depender
//  do Premiere aberto.
//
//  Uso:  node tools/check-mogrt.js "caminho/Template.mogrt"
//        node tools/check-mogrt.js pasta/          (valida em lote)
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Tipos de controle no definition.json (schema da Adobe, apiVersion 2.x)
const TYPE = { 2: 'número', 4: 'cor', 5: 'posição', 6: 'fonte', 10: 'TEXTO' };

// O motor procura os campos de texto nesta ordem. Nomeie assim no
// Essential Graphics e o template funciona sem configuração nenhuma.
// Sufixo entre colchetes é permitido — "TEXTO 1 [Destaque]" é convenção
// útil pra marcar a linha em evidência. O motor casa só pelo número.
const EXPECTED = [/^TEXTO\s*(\d+)(\s*\[[^\]]*\])?$/i,
                  /^LINHA\s*(\d+)(\s*\[[^\]]*\])?$/i,
                  /^LINE\s*(\d+)(\s*\[[^\]]*\])?$/i];

function readDefinition(file) {
  // .mogrt/.cgt são ZIP. Node não lê zip nativamente e não queremos
  // dependência só pra isso — o unzip do sistema resolve.
  try {
    const buf = execFileSync('unzip', ['-p', file, 'definition.json'], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw new Error('não consegui ler definition.json (arquivo é mesmo um .mogrt?)');
  }
}

function localizedName(nm) {
  if (typeof nm === 'string') return nm;
  const db = nm && nm.strDB;
  if (Array.isArray(db) && db.length) return db[0].str || '';
  return '';
}

// clientControls é aninhado e varia entre versões — varremos tudo
// procurando nós que tenham type + nome.
function collectControls(node, out) {
  out = out || [];
  if (Array.isArray(node)) {
    node.forEach((n) => collectControls(n, out));
  } else if (node && typeof node === 'object') {
    // O rótulo vem em `uiName` (não displayName/name, que é o que a
    // documentação sugere) — validado contra .mogrt real, apiVersion 2.2
    const label = node.uiName || node.displayName || node.name;
    if ('type' in node && label) {
      out.push({ type: node.type, name: localizedName(label) });
    }
    Object.values(node).forEach((v) => {
      if (v && typeof v === 'object') collectControls(v, out);
    });
  }
  return out;
}

function check(file) {
  const label = path.basename(file);
  let def;
  try {
    def = readDefinition(file);
  } catch (e) {
    return { file: label, ok: false, errors: [e.message], warnings: [], texts: [] };
  }

  const controls = collectControls(def.clientControls);
  const texts = controls.filter((c) => c.type === 10);
  const errors = [];
  const warnings = [];

  if (!texts.length) {
    errors.push('nenhum campo de TEXTO editável — arraste a propriedade ' +
                '"Texto de Origem" da camada pro Essential Graphics');
  }

  // Os nomes precisam ser previsíveis: o script acha o campo POR NOME.
  const unnamed = texts.filter((t) => !EXPECTED.some((rx) => rx.test(t.name.trim())));
  if (unnamed.length) {
    warnings.push('campo(s) de texto com nome fora do padrão: ' +
      unnamed.map((t) => JSON.stringify(t.name)).join(', ') +
      ' — renomeie pra "TEXTO 1", "TEXTO 2"… no Essential Graphics');
  }

  // Numeração precisa começar em 1 e ser contígua
  const nums = texts.map((t) => {
    for (const rx of EXPECTED) { const m = rx.exec(t.name.trim()); if (m) return parseInt(m[1], 10); }
    return null;
  }).filter((n) => n !== null).sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      warnings.push('numeração dos textos com buraco (achei ' + nums.join(', ') +
                    ') — precisa ser 1, 2, 3… sem pular');
      break;
    }
  }

  if (def.usedFontsLocalized && Object.keys(def.usedFontsLocalized).length) {
    warnings.push('usa fonte customizada — quem instalar precisa ter a fonte, ' +
                  'ou o Premiere substitui e quebra o visual');
  }

  return {
    file: label,
    ok: errors.length === 0,
    errors, warnings, texts,
    lines: texts.length,
    name: def.capsuleName || '(sem nome)',
    author: def.authorApp || '?',
  };
}

// ── CLI ──────────────────────────────────────────────────────
const target = process.argv[2];
if (!target) {
  console.error('uso: node tools/check-mogrt.js <arquivo.mogrt | pasta>');
  process.exit(1);
}

let files = [];
if (fs.statSync(target).isDirectory()) {
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mogrt|cgt)$/i.test(e.name)) files.push(p);
    }
  })(target);
} else {
  files = [target];
}

if (!files.length) { console.error('nenhum .mogrt encontrado em ' + target); process.exit(1); }

let okCount = 0;
for (const f of files) {
  const r = check(f);
  const icon = r.ok ? (r.warnings.length ? '⚠' : '✓') : '✗';
  console.log(`\n${icon} ${r.file}`);
  if (r.texts) {
    console.log(`   ${r.lines} campo(s) de texto: ` +
      (r.texts.map((t) => t.name).join(' · ') || '—'));
  }
  r.errors.forEach((e) => console.log('   ERRO: ' + e));
  r.warnings.forEach((w) => console.log('   aviso: ' + w));
  if (r.ok) okCount++;
}
console.log(`\n${okCount}/${files.length} template(s) prontos pro CinePRO.`);
process.exit(okCount === files.length ? 0 : 1);
