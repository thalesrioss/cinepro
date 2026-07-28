#!/usr/bin/env node
// =============================================================
//  Motor de auto-SFX (ADR-008) — asserções contra o acervo REAL
//
//  Cada teste aqui corresponde a um dos quatro defeitos medidos que
//  motivaram o ADR-008. Se algum voltar, isto quebra.
//
//  Uso:  node tools/test-sfx-engine.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'js', 'sfx-engine.js'));
const RC = require(path.join(ROOT, 'js', 'remote-config.js'));

const manifest = require(path.join(ROOT, 'manifest', 'dist', 'manifest.json'));
const PLUGIN_KINDS = { video: 1, audio: 1, image: 1 };
const effects = manifest.files.filter((f) => PLUGIN_KINDS[f.kind]);
const concepts = manifest.concepts;

const recipesRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'recipes.json'), 'utf8'));
const rolesRaw   = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'roles.json'), 'utf8'));
const recipes = RC.validateRecipes(recipesRaw).value;
const rolesV  = RC.validateRoles(rolesRaw).value;

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}

// Timeline sintética estilo Reels: cortes rápidos, ~1,5s
function reelsTimeline(n) {
  const cuts = [];
  for (let i = 0; i < n; i++) cuts.push(2 + i * 1.5);
  return { cuts: cuts, duration: 2 + n * 1.5 + 3, playhead: 0 };
}

const withDur = effects.filter((e) => e.kind === 'audio' && typeof e.dur === 'number');
console.log(`acervo: ${effects.length} itens | áudio com duração: ${withDur.length}\n`);

const plans = {};
recipes.forEach((r) => {
  plans[r.id] = E.buildPlan({
    effects, concepts, recipe: r, roles: rolesV.roles,
    limits: rolesV.limits, timeline: reelsTimeline(20),
  });
});

console.log('══ PLANOS POR PACK ══');
recipes.forEach((r) => {
  const p = plans[r.id];
  const cut = p.steps.find((s) => s.role === 'cut');
  console.log(`  ${r.id.padEnd(13)} ${String(p.stats.placements).padStart(2)} colocações · ` +
    `${p.stats.distinctFiles} arquivos distintos · pool(cut)=${p.stats.poolSizes.cut}` +
    (cut ? `\n${' '.repeat(16)}cut: "${cut.effect.name.slice(0, 44)}" ${cut.effect.dur}s` : '\n' + ' '.repeat(16) + 'cut: —'));
});

// ── Defeito 4: duração ignorada ──────────────────────────────
console.log('\n══ DEFEITO 4 — JANELA DE DURAÇÃO ══');
t('nenhum SFX de corte fora de 0,15..1,2s', () => {
  const bad = [];
  for (const id in plans) {
    plans[id].steps.filter((s) => s.role === 'cut').forEach((s) => {
      if (s.effect.dur < rolesV.roles.cut.minDur || s.effect.dur > rolesV.roles.cut.maxDur)
        bad.push(id + ':' + s.effect.name + '=' + s.effect.dur + 's');
    });
  }
  return bad.length === 0 || bad.slice(0, 3).join(' | ');
});
t('nenhum SFX passa do próximo corte (1,5s)', () => {
  const bad = [];
  for (const id in plans) {
    plans[id].steps.filter((s) => s.role === 'cut').forEach((s) => {
      if (s.effect.dur > 1.5) bad.push(id + ':' + s.effect.dur + 's');
    });
  }
  return bad.length === 0 || bad.slice(0, 3).join(' | ');
});
t('cama sonora tem >= 20s', () => {
  const bad = [];
  for (const id in plans) {
    plans[id].steps.filter((s) => s.role === 'bed').forEach((s) => {
      if (s.effect.dur < 20) bad.push(id + ':' + s.effect.dur + 's');
    });
  }
  return bad.length === 0 || bad.join(' | ');
});

// ── Defeito 1: pontuação premiava nome verboso ───────────────
console.log('\n══ DEFEITO 1 — VIÉS DE NOME VERBOSO ══');
t('nenhum arquivo é o "cut" de 5+ packs', () => {
  const count = {};
  for (const id in plans) {
    const c = plans[id].steps.find((s) => s.role === 'cut');
    if (c) count[c.effect.name] = (count[c.effect.name] || 0) + 1;
  }
  const worst = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  if (!worst) return 'nenhum cut escolhido';
  return worst[1] < 5 || `"${worst[0]}" domina ${worst[1]} packs`;
});
t('cosseno normaliza: embed maior não vence sozinho', () => {
  const cIdx = E.conceptIndex(concepts);
  const recipe = { weights: { whoosh: 3 } };
  const focado = { kind: 'audio', dur: 0.5, embed: { [cIdx.whoosh]: 1 } };
  const verboso = { kind: 'audio', dur: 0.5, embed: { [cIdx.whoosh]: 1, [cIdx.metal]: 3, [cIdx.vintage]: 3 } };
  return E.genreFit(focado, recipe, cIdx) > E.genreFit(verboso, recipe, cIdx)
    || `focado=${E.genreFit(focado, recipe, cIdx).toFixed(2)} verboso=${E.genreFit(verboso, recipe, cIdx).toFixed(2)}`;
});

// ── Defeito 2: inanição de papel ─────────────────────────────
console.log('\n══ DEFEITO 2 — INANIÇÃO DE PAPEL ══');
t('TODO pack tem candidato de corte', () => {
  const empty = Object.keys(plans).filter((id) => plans[id].stats.poolSizes.cut === 0);
  return empty.length === 0 || 'sem cut: ' + empty.join(', ');
});
// Corrige uma afirmação errada do ADR-008: eu citei "26 whooshes de
// terror ignorados", mas TODOS têm 6s+ — nenhum cabe na janela de corte
// (0,15..1,2s). Nem o chamado "Whoosh_Terror_short", que tem 6s. Então
// cair num whoosh curto neutro é o comportamento CORRETO; o errado seria
// enfiar 6s num corte de 1,5s. O teste certo é: SE existir candidato com
// sabor do gênero dentro da janela, ele tem que ser preferido.
t('prefere sabor do gênero QUANDO cabe na janela', () => {
  const cIdx = E.conceptIndex(concepts);
  const roleCut = rolesV.roles.cut;
  const problemas = [];
  for (const r of recipes) {
    const c = plans[r.id].steps.find((s) => s.role === 'cut');
    if (!c) continue;
    // existe candidato elegível que casa algum conceito da receita?
    const temSabor = effects.some((e) => e.kind === 'audio' && e.embed &&
      typeof e.dur === 'number' && e.dur >= roleCut.minDur && e.dur <= roleCut.maxDur &&
      E.roleStrength(e, roleCut, cIdx) > 0 && E.genreFit(e, r, cIdx) > 0);
    if (temSabor && E.genreFit(c.effect, r, cIdx) === 0)
      problemas.push(r.id + ' ignorou candidato com sabor');
  }
  return problemas.length === 0 || problemas.join(' | ');
});
t('whooshes longos de terror viram RISER, não corte', () => {
  const longos = effects.filter((e) => e.kind === 'audio' && e.embed && typeof e.dur === 'number' &&
    e.dur > rolesV.roles.cut.maxDur);
  const usadosComoCorte = [];
  for (const id in plans)
    plans[id].steps.filter((s) => s.role === 'cut').forEach((s) => {
      if (longos.some((l) => l.id === s.effect.id)) usadosComoCorte.push(id);
    });
  return usadosComoCorte.length === 0 || 'usou longo como corte: ' + usadosComoCorte.join(', ');
});
t('riser resolve NO impacto (princípio 3 do MD)', () => {
  const problemas = [];
  for (const id in plans) {
    const riser = plans[id].steps.find((s) => s.role === 'riser');
    const imp = plans[id].steps.find((s) => s.role === 'impact');
    if (!riser) continue;
    if (!imp) { problemas.push(id + ': riser sem impacto pra resolver'); continue; }
    const fim = riser.at + riser.effect.dur;
    if (Math.abs(fim - imp.at) > 0.05) problemas.push(id + ': riser termina em ' + fim.toFixed(2) + 's, impacto em ' + imp.at + 's');
    if (riser.at < 0) problemas.push(id + ': riser comeca antes de 0');
  }
  return problemas.length === 0 || problemas.join(' | ');
});

// ── Defeito 3: diversidade ───────────────────────────────────
console.log('\n══ DEFEITO 3 — DIVERSIDADE ══');
t('cada pack usa >= 3 arquivos distintos', () => {
  const bad = Object.keys(plans).filter((id) => plans[id].stats.distinctFiles < 3);
  return bad.length === 0 || bad.map((b) => b + '=' + plans[b].stats.distinctFiles).join(', ');
});
t('não repete o mesmo arquivo em cortes seguidos', () => {
  for (const id in plans) {
    const cuts = plans[id].steps.filter((s) => s.role === 'cut');
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i].effect.id === cuts[i - 1].effect.id) return id + ' repetiu em sequência';
    }
  }
  return true;
});
// A asserção anterior ("nenhum par acima de 70%") estava errada: gêneros
// VIZINHOS devem mesmo soar parecidos, e forçar diferença artificial seria
// pior. O que importa é o conjunto não colapsar globalmente e gêneros
// DISTANTES não se confundirem.
function jaccard(a, b) {
  const A = new Set(plans[a].steps.map((s) => s.effect.id));
  const B = new Set(plans[b].steps.map((s) => s.effect.id));
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 0;
}
t('sobreposição MÉDIA entre packs é baixa', () => {
  const ids = Object.keys(plans); const rs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) rs.push(jaccard(ids[i], ids[j]));
  const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
  return avg < 0.30 || `média ${(avg * 100).toFixed(0)}%`;
});
t('gêneros distantes não se confundem', () => {
  const pares = [['terror', 'vlog'], ['documentario', 'gaming'], ['terror', 'reels']];
  const ruins = pares.filter(([a, b]) => jaccard(a, b) > 0.25)
                     .map(([a, b]) => `${a}/${b}=${(jaccard(a, b) * 100).toFixed(0)}%`);
  return ruins.length === 0 || ruins.join(' | ');
});
t('densidade separa Tutorial de Reels (princípio do MD)', () => {
  const dens = (id) => plans[id].steps.filter((s) => s.role === 'cut').length;
  return dens('tutorial') < dens('reels')
    || `tutorial=${dens('tutorial')} reels=${dens('reels')} — som deveria ser mais esparso no tutorial`;
});
t('documentário é o mais esparso', () => {
  const dens = (id) => plans[id].steps.filter((s) => s.role === 'cut').length;
  const todos = Object.keys(plans).map((id) => [id, dens(id)]).sort((a, b) => a[1] - b[1]);
  return todos[0][0] === 'documentario' || `mais esparso foi ${todos[0][0]}`;
});

// ── Limites e robustez ───────────────────────────────────────
console.log('\n══ LIMITES E ROBUSTEZ ══');
t('respeita maxPlacements', () => {
  const p = E.buildPlan({ effects, concepts, recipe: recipes[0], roles: rolesV.roles,
    limits: rolesV.limits, timeline: reelsTimeline(500) });
  return p.stats.placements <= rolesV.limits.maxPlacements || 'colocou ' + p.stats.placements;
});
t('timeline sem cortes não quebra', () => {
  const p = E.buildPlan({ effects, concepts, recipe: recipes[0], roles: rolesV.roles,
    limits: rolesV.limits, timeline: { cuts: [], duration: 30, playhead: 5 } });
  return Array.isArray(p.steps) || 'retorno inválido';
});
t('acervo vazio não quebra', () => {
  const p = E.buildPlan({ effects: [], concepts, recipe: recipes[0], roles: rolesV.roles,
    limits: rolesV.limits, timeline: reelsTimeline(5) });
  return p.steps.length === 0 && p.warnings.length > 0 || 'não avisou';
});
t('arquivo sem duração é ignorado', () => {
  const fake = [{ id: 'x', kind: 'audio', name: 'sem dur', embed: { 8: 5 } }];
  const p = E.buildPlan({ effects: fake, concepts, recipe: recipes[0], roles: rolesV.roles,
    limits: rolesV.limits, timeline: reelsTimeline(5) });
  return p.steps.length === 0 || 'usou arquivo sem duração';
});
t('plano é determinístico', () => {
  const a = E.buildPlan({ effects, concepts, recipe: recipes[2], roles: rolesV.roles, limits: rolesV.limits, timeline: reelsTimeline(10) });
  const b = E.buildPlan({ effects, concepts, recipe: recipes[2], roles: rolesV.roles, limits: rolesV.limits, timeline: reelsTimeline(10) });
  return JSON.stringify(a.steps.map((s) => s.effect.id)) === JSON.stringify(b.steps.map((s) => s.effect.id)) || 'variou entre execuções';
});

console.log('\n' + '─'.repeat(52));
console.log((fail ? '✗ ' : '✓ ') + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
