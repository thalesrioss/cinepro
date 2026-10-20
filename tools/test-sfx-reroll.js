#!/usr/bin/env node
// =============================================================
//  "↻ Outra opção" por papel no preview do pack (BL-0068)
//
//  rerollRole(o, plano, papel) refaz só os passos daquele papel;
//  os outros papéis continuam com os mesmos sons nos mesmos tempos.
//  Papel sem candidato novo → changed:false e exhausted[papel].
//
//  Uso:  node tools/test-sfx-reroll.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'js', 'sfx-engine.js'));
const RC = require(path.join(ROOT, 'js', 'remote-config.js'));

const manifest = require(path.join(ROOT, 'manifest', 'dist', 'manifest.json'));
const effects = manifest.files.filter((f) => f.kind === 'audio' || f.kind === 'video' || f.kind === 'image');
const concepts = manifest.concepts;
const rolesV = RC.validateRoles(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'roles.json'), 'utf8'))).value;

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}

// Receita que liga os 4 papéis (cama pede drone >= 2, riser pede riser >= 2)
const recipe4 = { id: 'teste-4-papeis', label: 'Teste', cutEvery: 1,
  weights: { drone: 2, riser: 2, impact: 2, whoosh: 2, dark: 1 } };
const cuts = [];
for (let i = 0; i < 12; i++) cuts.push(6 + i * 1.5);
const opts = { effects, concepts, recipe: recipe4, roles: rolesV.roles, limits: rolesV.limits,
  timeline: { cuts, duration: 6 + 12 * 1.5 + 3, playhead: 0 } };

const sig = (steps) => steps.map((s) => s.role + '@' + s.at + ':' + s.effect.id).join('|');
const ofRole = (plan, role) => plan.steps.filter((s) => s.role === role);

const plan = E.buildPlan(opts);
const papeis = ['bed', 'impact', 'riser', 'cut'].filter((r) => ofRole(plan, r).length);

console.log('══ PLANO COM 4 PAPÉIS ══');
t('plano de teste tem os 4 papéis', () => papeis.length === 4 || 'papéis: ' + papeis.join(','));

console.log('\n══ ↻ NO IMPACTO ══');
const r1 = E.rerollRole(opts, plan, 'impact');
t('changed = true', () => r1.changed === true || 'changed=' + r1.changed);
t('só os passos impact mudam de efeito', () => {
  const a = ofRole(plan, 'impact').map((s) => s.effect.id);
  const b = ofRole(r1.plan, 'impact').map((s) => s.effect.id);
  if (b.some((id) => a.indexOf(id) > -1)) return 'impacto repetiu ' + b;
  return true;
});
t('impacto continua no mesmo instante', () =>
  ofRole(plan, 'impact')[0].at === ofRole(r1.plan, 'impact')[0].at || 'instante mudou');
['bed', 'riser', 'cut'].forEach((r) => {
  t(r + ' não muda', () => sig(ofRole(plan, r)) === sig(ofRole(r1.plan, r)) || 'mudou');
});
t('plano original intacto (função pura)', () => sig(plan.steps) === sig(E.buildPlan(opts).steps) || 'plano mexido');
t('stats refeitos', () => r1.plan.stats.placements === r1.plan.steps.length || 'placements desatualizado');

console.log('\n══ ↻ REPETIDO ══');
t('2º ↻ não volta para o som do 1º plano', () => {
  const r2 = E.rerollRole(opts, r1.plan, 'impact');
  if (!r2.changed) return true;   // esgotou: também não repete
  const usados = ofRole(plan, 'impact').concat(ofRole(r1.plan, 'impact')).map((s) => s.effect.id);
  return ofRole(r2.plan, 'impact').every((s) => usados.indexOf(s.effect.id) < 0) || 'repetiu som já visto';
});
t('20 ↻ seguidos no impacto: 21 sons distintos, cortes intactos', () => {
  let p = plan; const vistos = {};
  ofRole(p, 'impact').forEach((s) => { vistos[s.effect.id] = 1; });
  for (let n = 0; n < 20; n++) {
    const res = E.rerollRole(opts, p, 'impact');
    if (!res.changed) return 'acabou na troca ' + (n + 1);
    p = res.plan;
    const id = ofRole(p, 'impact')[0].effect.id;
    if (vistos[id]) return 'repetiu ' + id + ' na troca ' + (n + 1);
    vistos[id] = 1;
  }
  return sig(ofRole(p, 'cut')) === sig(ofRole(plan, 'cut')) || 'cortes mudaram no caminho';
});
t('↻ nos cortes troca só os cortes', () => {
  const r = E.rerollRole(opts, plan, 'cut');
  if (!r.changed) return 'sem outra opção nos cortes com o acervo inteiro';
  const antes = ofRole(plan, 'cut').map((s) => s.effect.id);
  if (ofRole(r.plan, 'cut').some((s) => antes.indexOf(s.effect.id) > -1)) return 'repetiu som de corte';
  return ['bed', 'impact', 'riser'].every((x) => sig(ofRole(plan, x)) === sig(ofRole(r.plan, x))) || 'outro papel mudou';
});

console.log('\n══ PAPEL COM 1 CANDIDATO ══');
// Acervo mínimo: 1 impacto e 1 whoosh. Índices dos conceitos do dicionário real.
const ci = (n) => concepts.findIndex((c) => String(c.name).toLowerCase() === n);
const tiny = [
  { id: 'imp1', kind: 'audio', name: 'Impacto único', dur: 1, embed: { [ci('impact')]: 2 } },
  { id: 'wh1', kind: 'audio', name: 'Whoosh A', dur: 0.5, embed: { [ci('whoosh')]: 2 } },
  { id: 'wh2', kind: 'audio', name: 'Whoosh B', dur: 0.6, embed: { [ci('whoosh')]: 2 } },
];
const tinyOpts = Object.assign({}, opts, { effects: tiny,
  recipe: { id: 'tiny', label: 'T', cutEvery: 1, weights: { impact: 1, whoosh: 1 } } });
const tp = E.buildPlan(tinyOpts);
t('plano mínimo tem impacto e cortes', () => ofRole(tp, 'impact').length === 1 && ofRole(tp, 'cut').length > 0 || 'plano: ' + sig(tp.steps));
const tr = E.rerollRole(tinyOpts, tp, 'impact');
t('impacto com 1 candidato → changed false', () => tr.changed === false || 'trocou');
t('exhausted.impact marcado para a linha dizer "sem outra opção"', () => tr.plan.exhausted && tr.plan.exhausted.impact === true || 'sem flag');
t('plano continua igual (aplicar segue como antes)', () => sig(tr.plan.steps) === sig(tp.steps) || 'passos mudaram');
t('cortes com 2 whooshes já usados → sem outra opção', () => {
  const r = E.rerollRole(tinyOpts, tp, 'cut');
  return r.changed === false && r.plan.exhausted.cut === true || 'changed=' + r.changed;
});
t('papel ausente do plano → sem outra opção', () => {
  const r = E.rerollRole(tinyOpts, tp, 'bed');
  return r.changed === false || 'inventou cama';
});

console.log('\n' + '─'.repeat(52));
console.log((fail ? '✗ ' : '✓ ') + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
