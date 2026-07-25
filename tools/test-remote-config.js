#!/usr/bin/env node
// =============================================================
//  Suíte de segurança da config remota (Fase 0 do ADR-009)
//
//  A config remota é dado vindo da rede. Esta suíte ataca o validador
//  com entrada hostil: valores absurdos, poluição de protótipo, DoS por
//  volume, tipos errados. Rodar antes de qualquer mudança em
//  js/remote-config.js ou nos JSON de data/.
//
//  Uso:  node tools/test-remote-config.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RC = require(path.join(ROOT, 'js', 'remote-config.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ── Arquivos reais do repo ───────────────────────────────────
group('ARQUIVOS REAIS');
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'recipes.json'), 'utf8'));
const O = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'roles.json'), 'utf8'));
t('recipes.json valida', () => { const v = RC.validateRecipes(R); return (v.ok && v.value.length === 8) || JSON.stringify(v.errors); });
t('roles.json valida',   () => { const v = RC.validateRoles(O);   return (v.ok && Object.keys(v.value.roles).length === 4) || JSON.stringify(v.errors); });
t('embarcado valida (piso)', () => { const v = RC.validateRoles(Object.assign({ schemaVersion: 1 }, RC.DEFAULT_ROLES)); return v.ok || JSON.stringify(v.errors); });

// ── Clamps: dado absurdo nunca vira ação absurda ─────────────
group('VALORES ABSURDOS → CLAMP');
t('peso 99999 → 10', () => {
  const v = RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: 'x', label: 'X', weights: { impact: 99999 } }] });
  return v.value[0].weights.impact === 10 || 'ficou ' + v.value[0].weights.impact; });
t('peso negativo → descartado', () => {
  const v = RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: 'x', label: 'X', weights: { impact: -50, riser: 2 } }] });
  return !own(v.value[0].weights, 'impact') || 'passou peso negativo'; });
t('maxPlacements 100000 → 200', () => {
  const v = RC.validateRoles({ schemaVersion: 1, roles: O.roles, limits: { maxPlacements: 100000 } });
  return v.value.limits.maxPlacements === 200 || 'ficou ' + v.value.limits.maxPlacements; });
t('maxTracksToCreate 9999 → 16', () => {
  const v = RC.validateRoles({ schemaVersion: 1, roles: O.roles, limits: { maxTracksToCreate: 9999 } });
  return v.value.limits.maxTracksToCreate === 16 || 'ficou ' + v.value.limits.maxTracksToCreate; });
t('duração 1e9 → 600', () => {
  const v = RC.validateRoles({ schemaVersion: 1, roles: { cut: { concepts: ['whoosh'], minDur: 0.1, maxDur: 1e9 } } });
  return v.value.roles.cut.maxDur === 600 || 'ficou ' + v.value.roles.cut.maxDur; });
// Infinity/NaN não são número útil: caem no PADRÃO (60), não no teto
// (200). É de propósito — o padrão é mais conservador que o máximo.
t('Infinity → padrão conservador (60)', () => {
  const v = RC.validateRoles({ schemaVersion: 1, roles: O.roles, limits: { maxPlacements: Infinity } });
  return v.value.limits.maxPlacements === 60 || 'ficou ' + v.value.limits.maxPlacements; });
t('-Infinity → padrão conservador (60)', () => {
  const v = RC.validateRoles({ schemaVersion: 1, roles: O.roles, limits: { maxPlacements: -Infinity } });
  return v.value.limits.maxPlacements === 60 || 'ficou ' + v.value.limits.maxPlacements; });
t('null → padrão conservador (60)', () => {
  const v = RC.validateRoles({ schemaVersion: 1, roles: O.roles, limits: { maxPlacements: null } });
  return v.value.limits.maxPlacements === 60 || 'ficou ' + v.value.limits.maxPlacements; });

// ── O defeito do ADR-008 não pode voltar por config ──────────
group('JANELA DE DURAÇÃO INVERTIDA');
t('minDur > maxDur → papel rejeitado', () => {
  const v = RC.validateRoles({ schemaVersion: 1, roles: { cut: { concepts: ['whoosh'], minDur: 6, maxDur: 1 } } });
  return v.ok === false || 'aceitou janela invertida'; });
t('minDur == maxDur → rejeitado', () => {
  const v = RC.validateRoles({ schemaVersion: 1, roles: { cut: { concepts: ['whoosh'], minDur: 2, maxDur: 2 } } });
  return v.ok === false || 'aceitou janela degenerada'; });

// ── Poluição de protótipo ────────────────────────────────────
group('POLUIÇÃO DE PROTÓTIPO');
t('__proto__ em weights não polui', () => {
  RC.validateRecipes(JSON.parse('{"schemaVersion":1,"recipes":[{"id":"x","label":"X","weights":{"__proto__":{"polluted":1},"impact":2}}]}'));
  return {}.polluted === undefined || 'PROTÓTIPO POLUÍDO'; });
t('__proto__ como nome de papel não polui', () => {
  RC.validateRoles(JSON.parse('{"schemaVersion":1,"roles":{"__proto__":{"concepts":["a"],"minDur":1,"maxDur":2},"cut":{"concepts":["whoosh"],"minDur":0.1,"maxDur":1}}}'));
  return {}.concepts === undefined || 'PROTÓTIPO POLUÍDO'; });
t('constructor não entra como own property', () => {
  const v = RC.validateRecipes(JSON.parse('{"schemaVersion":1,"recipes":[{"id":"x","label":"X","weights":{"constructor":5,"impact":2}}]}'));
  return !own(v.value[0].weights, 'constructor') || 'passou constructor'; });
t('prototype filtrado', () => {
  const v = RC.validateRecipes(JSON.parse('{"schemaVersion":1,"recipes":[{"id":"x","label":"X","weights":{"prototype":5,"impact":2}}]}'));
  return !own(v.value[0].weights, 'prototype') || 'passou prototype'; });
// Regressão: o mapa {__proto__:1} antigo fazia chaves HERDADAS do
// Object.prototype (toString, valueOf) parecerem proibidas.
t('chave legítima "tostring" NÃO é bloqueada', () => {
  const v = RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: 'x', label: 'X', weights: { tostring: 3 } }] });
  return v.ok && v.value[0].weights.tostring === 3 || 'bloqueou chave legítima'; });
t('chave legítima "valueof" NÃO é bloqueada', () => {
  const v = RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: 'x', label: 'X', weights: { valueof: 3 } }] });
  return v.ok && v.value[0].weights.valueof === 3 || 'bloqueou chave legítima'; });

// ── DoS por volume ───────────────────────────────────────────
group('DoS POR VOLUME');
t('10.000 receitas → rejeitado', () => {
  const big = { schemaVersion: 1, recipes: Array.from({ length: 10000 }, (_, i) => ({ id: 'r' + i, label: 'R', weights: { impact: 1 } })) };
  return RC.validateRecipes(big).ok === false || 'aceitou 10k receitas'; });
t('500 conceitos numa receita → teto 30', () => {
  const w = {}; for (let i = 0; i < 500; i++) w['c' + i] = 1;
  const v = RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: 'x', label: 'X', weights: w }] });
  return Object.keys(v.value[0].weights).length <= 30 || 'ficou ' + Object.keys(v.value[0].weights).length; });
t('200 papéis → teto 20', () => {
  const rr = {}; for (let i = 0; i < 200; i++) rr['p' + i] = { concepts: ['whoosh'], minDur: 0.1, maxDur: 1 };
  const v = RC.validateRoles({ schemaVersion: 1, roles: rr });
  return Object.keys(v.value.roles).length <= 20 || 'ficou ' + Object.keys(v.value.roles).length; });
t('100 conceitos num papel → teto 10', () => {
  const v = RC.validateRoles({ schemaVersion: 1, roles: { cut: { concepts: Array.from({ length: 100 }, (_, i) => 'c' + i), minDur: 0.1, maxDur: 1 } } });
  return v.value.roles.cut.concepts.length <= 10 || 'ficou ' + v.value.roles.cut.concepts.length; });

// ── Schema e tipos ───────────────────────────────────────────
group('SCHEMA E TIPOS');
t('schemaVersion 99 → rejeita',      () => RC.validateRecipes({ schemaVersion: 99, recipes: [] }).ok === false || 'aceitou');
t('schemaVersion ausente → rejeita', () => RC.validateRecipes({ recipes: [] }).ok === false || 'aceitou');
t('schemaVersion "1" string → rejeita', () => RC.validateRecipes({ schemaVersion: '1', recipes: [] }).ok === false || 'aceitou string');
t('raiz array → rejeita',   () => RC.validateRecipes([]).ok === false || 'aceitou');
t('raiz null → rejeita',    () => RC.validateRecipes(null).ok === false || 'aceitou');
t('raiz string → rejeita',  () => RC.validateRecipes('{}').ok === false || 'aceitou');
t('weights string → descarta receita', () => RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: 'x', label: 'X', weights: 'impact' }] }).ok === false || 'aceitou');
t('id com path traversal → rejeita',   () => RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: '../../etc/passwd', label: 'X', weights: { impact: 1 } }] }).ok === false || 'aceitou path');
t('label 5000 chars → rejeita',        () => RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: 'x', label: 'A'.repeat(5000), weights: { impact: 1 } }] }).ok === false || 'aceitou');
t('NaN em peso → descartado', () => {
  const v = RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: 'x', label: 'X', weights: { impact: 'abc', riser: 2 } }] });
  return !own(v.value[0].weights, 'impact') || 'passou NaN'; });
t('id duplicado → mantém um', () => {
  const v = RC.validateRecipes({ schemaVersion: 1, recipes: [{ id: 'x', label: 'A', weights: { impact: 1 } }, { id: 'x', label: 'B', weights: { riser: 1 } }] });
  return v.value.length === 1 || 'ficaram ' + v.value.length; });

// ── Conceitos inexistentes ───────────────────────────────────
group('CONCEITO INEXISTENTE NO DICIONÁRIO');
const DICT = [{ name: 'whoosh' }, { name: 'impact' }, { name: 'drop' }];
t('conceito fantasma descartado', () => {
  const roles = { cut: { concepts: ['whoosh', 'nao_existe'], minDur: 0.1, maxDur: 1 } };
  RC.pruneUnknownConcepts(roles, DICT);
  return roles.cut.concepts.length === 1 && roles.cut.concepts[0] === 'whoosh' || JSON.stringify(roles.cut.concepts); });
t('papel 100% desconhecido é marcado INERTE', () => {
  const roles = { riser: { concepts: ['riser', 'outro'], minDur: 1, maxDur: 4 } };
  const w = RC.pruneUnknownConcepts(roles, DICT);
  return w.some(x => /INERTE/.test(x)) || 'não avisou: ' + JSON.stringify(w); });
t('dicionário vazio não destrói papéis', () => {
  const roles = { cut: { concepts: ['whoosh'], minDur: 0.1, maxDur: 1 } };
  RC.pruneUnknownConcepts(roles, []);
  return roles.cut.concepts.length === 1 || 'destruiu'; });

// ── Garantia estrutural: nada executa código ─────────────────
group('NENHUMA EXECUÇÃO DE CÓDIGO');
let src = fs.readFileSync(path.join(ROOT, 'js', 'remote-config.js'), 'utf8');
// remove comentários antes de varrer, senão o próprio aviso no cabeçalho
// ("não usa eval, new Function") faz o teste falhar sozinho
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
t('sem eval(',              () => !/[^a-zA-Z_.]eval\s*\(/.test(code) || 'achei eval');
t('sem new Function',       () => !/new\s+Function/.test(code) || 'achei new Function');
t('sem setTimeout(string)', () => !/setTimeout\s*\(\s*['"]/.test(code) || 'achei setTimeout com string');
t('sem injeção de <script>',() => !/createElement\(\s*['"]script/i.test(code) || 'achei injeção de script');
t('sem innerHTML',          () => !/innerHTML/.test(code) || 'achei innerHTML');
t('sem require dinâmico',   () => !/require\s*\(\s*[^'")]/.test(code) || 'achei require dinâmico');

console.log('\n' + '─'.repeat(52));
console.log((fail ? '✗ ' : '✓ ') + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
