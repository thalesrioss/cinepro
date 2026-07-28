// =============================================================
//  CinePRO — Motor de auto-SFX (ADR-008)
//
//  Substitui a seleção antiga, que tinha quatro defeitos medidos:
//   1. pontuava por SOMA de conceitos → premiava nome verboso
//      ("Transition_Riser_Whoosh" casava 3 e vencia em 5 dos 8 packs)
//   2. ranqueava por gênero e cortava no top-40 ANTES de procurar o
//      papel → Terror ficava com 0 whooshes tendo 26 na biblioteca
//   3. usava 2,28% do acervo (229 de 10.037 áudios)
//   4. não olhava duração → riser de 4,14s em corte de 1,5s
//
//  Aqui a ordem é invertida: filtra a biblioteca INTEIRA pelo papel
//  (conceito + janela de duração) e só então ordena por afinidade com
//  o gênero, usando cosseno — que normaliza pelo tamanho do embed e
//  mata o viés de nome comprido.
//
//  Sem dependência de DOM/CEP: roda no plugin e em teste.
// =============================================================

(function (global) {
  'use strict';

  // Hash estável de string → inteiro. Só serve pra dar a cada pack um
  // ponto de partida próprio no conjunto de candidatos; não é seguro
  // nem precisa ser.
  function hashSeed(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function conceptIndex(dict) {
    var idx = {};
    for (var i = 0; i < (dict || []).length; i++) idx[String(dict[i].name).toLowerCase()] = i;
    return idx;
  }

  /**
   * Afinidade com o gênero por similaridade de cosseno.
   *
   * O acerto está no denominador: dividir pela norma do embed faz um
   * arquivo que casa 3 conceitos NÃO valer automaticamente 3x mais que
   * um que casa 1 bem. Era exatamente esse viés que fazia o mesmo
   * "Transition_Riser_Whoosh" vencer em quase todo pack.
   *
   * @returns {number} 0..1
   */
  function genreFit(effect, recipe, cIdx) {
    var embed = effect.embed;
    if (!embed) return 0;
    var dot = 0, nEmbed = 0, nWeights = 0;
    for (var k in embed) {
      if (!Object.prototype.hasOwnProperty.call(embed, k)) continue;
      var v = embed[k];
      nEmbed += v * v;
    }
    for (var name in recipe.weights) {
      if (!Object.prototype.hasOwnProperty.call(recipe.weights, name)) continue;
      var w = recipe.weights[name];
      nWeights += w * w;
      var ci = cIdx[name];
      if (ci !== undefined && embed[ci]) dot += w * embed[ci];
    }
    if (!dot || !nEmbed || !nWeights) return 0;
    return dot / (Math.sqrt(nEmbed) * Math.sqrt(nWeights));
  }

  /** Quão forte o arquivo é NO PAPEL (soma dos conceitos do papel). */
  function roleStrength(effect, role, cIdx) {
    var embed = effect.embed;
    if (!embed) return 0;
    var s = 0;
    for (var i = 0; i < role.concepts.length; i++) {
      var ci = cIdx[role.concepts[i]];
      if (ci !== undefined && embed[ci]) s += embed[ci];
    }
    return s;
  }

  /**
   * Candidatos para um papel, da biblioteca INTEIRA.
   *
   * Ordem correta: papel primeiro (conceito + duração), gênero depois.
   * O inverso — que era o código antigo — deixava o papel escolher de
   * um conjunto já filtrado por outro critério e causava inanição.
   *
   * A afinidade de gênero domina a ordenação; a força no papel entra
   * só como desempate leve. Isso é o que faz um whoosh de terror ganhar
   * de um whoosh genérico mais "whooshy" num pack de terror.
   */
  function buildPool(effects, role, recipe, cIdx, size) {
    var scored = [];
    for (var i = 0; i < effects.length; i++) {
      var e = effects[i];
      if (e.kind !== 'audio' || !e.embed) continue;
      if (typeof e.dur !== 'number' || !isFinite(e.dur)) continue;   // sem duração não entra
      if (e.dur < role.minDur || e.dur > role.maxDur) continue;      // janela do papel
      var rs = roleStrength(e, role, cIdx);
      if (rs <= 0) continue;                                          // não serve ao papel
      var fit = genreFit(e, recipe, cIdx);
      scored.push({ effect: e, score: fit + 0.15 * Math.min(rs, 3) / 3, fit: fit, rs: rs });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, Math.max(1, size || 5));
  }

  /**
   * Monta o PLANO de aplicação — não aplica nada. Devolver o plano
   * antes de executar é o que transforma o botão de caixa-preta em
   * algo revisável (e depurável na mão do cliente).
   *
   * @param {object} o  {effects, concepts, recipe, roles, limits, timeline}
   * @returns {object}  {steps, pools, warnings, stats}
   */
  function buildPlan(o) {
    var effects  = o.effects || [];
    var recipe   = o.recipe;
    var roles    = o.roles || {};
    var limits   = o.limits || { maxPlacements: 60, minGapSameFile: 10 };
    var tl       = o.timeline || { cuts: [], duration: 0, playhead: 0 };
    var cIdx     = conceptIndex(o.concepts);
    var warnings = [];
    var pools    = {};

    if (!recipe) return { steps: [], pools: {}, warnings: ['receita ausente'], stats: {} };

    ['cut', 'impact', 'bed', 'riser'].forEach(function (name) {
      if (!roles[name]) { warnings.push('papel "' + name + '" não definido'); return; }
      pools[name] = buildPool(effects, roles[name], recipe, cIdx, roles[name].poolSize);
      if (!pools[name].length) warnings.push('nenhum candidato para "' + name + '"');
    });

    var steps = [];
    var cuts = (tl.cuts || []).slice();
    var maxN = limits.maxPlacements;
    var minGap = limits.minGapSameFile;

    // 1. Cama sonora em 0s — só quando a receita realmente pede
    if (pools.bed && pools.bed.length && recipe.weights && recipe.weights.drone >= 2) {
      steps.push({ role: 'bed', effect: pools.bed[hashSeed(recipe.id) % Math.min(2, pools.bed.length)].effect, at: 0,
                   reason: 'cama sonora do início' });
    }

    // 2. Impacto no 1º corte (ou no playhead se a timeline não tem corte)
    var impactAt = null;
    if (pools.impact && pools.impact.length) {
      impactAt = cuts.length ? cuts[0] : (tl.playhead || 0);
      steps.push({ role: 'impact', effect: pools.impact[hashSeed(recipe.id + 'i') % Math.min(2, pools.impact.length)].effect, at: impactAt,
                   reason: cuts.length ? 'impacto no 1º corte' : 'impacto no playhead' });
    }

    // 2b. Riser que RESOLVE no impacto.
    //
    // Executa o princípio 3 de knowledge/som-e-mente.md: riser é
    // antecipação e precisa resolver. O motor antigo tratava riser como
    // som de passagem e o soltava em todo corte, sem resolução — o
    // oposto do que o estudo diz. Aqui ele termina exatamente onde o
    // impacto começa, e só aparece se a receita realmente pedir.
    //
    // Também dá destino aos arquivos longos (6s+) que são bons risers
    // mas nunca caberiam como passagem de corte.
    if (impactAt !== null && pools.riser && pools.riser.length &&
        recipe.weights && recipe.weights.riser >= 2) {
      for (var ri = 0; ri < pools.riser.length; ri++) {
        var rEff = pools.riser[ri].effect;
        var start = impactAt - rEff.dur;
        if (start >= 0) {
          steps.push({ role: 'riser', effect: rEff, at: Math.round(start * 100) / 100,
                       reason: 'riser resolvendo no impacto' });
          break;
        }
      }
    }

    // 3. Passagem nos cortes — com variação e consciência de ritmo
    if (pools.cut && pools.cut.length && cuts.length) {
      var lastUsedAt = {};   // effectId → instante do último uso
      // Gêneros vizinhos (Tutorial e Corporativo, p.ex.) têm receitas
      // quase iguais e caíam no MESMO conjunto — trocar de pack não
      // mudava nada pro editor. Em vez de fingir que os gêneros são
      // mais distintos do que são, cada pack começa em um ponto
      // diferente do conjunto. Continua determinístico: mesma receita,
      // mesmo plano.
      var rot = hashSeed(recipe.id) % pools.cut.length;

      // Densidade: gênero que pede pontuação discreta não leva SFX em
      // todo corte. Sem isto, Tutorial e Corporativo produziam exatamente
      // o mesmo resultado — e Tutorial atropelava a narração.
      var every = Math.max(1, Math.round(recipe.cutEvery || 1));

      for (var i = 0; i < cuts.length && steps.length < maxN; i++) {
        if (i % every !== 0) continue;
        var t = cuts[i];
        // O SFX não pode passar do próximo corte: era isso que empilhava
        // áudio e estourava as trilhas (riser de 4,14s em corte de 1,5s).
        var gap = (i + 1 < cuts.length) ? (cuts[i + 1] - t) : (tl.duration ? tl.duration - t : 99);

        var chosen = null;
        // 1ª passada: cabe no intervalo E respeita o descanso do arquivo
        for (var p = 0; p < pools.cut.length && !chosen; p++) {
          var c = pools.cut[(rot + p) % pools.cut.length];
          if (c.effect.dur > gap) continue;
          var last = lastUsedAt[c.effect.id];
          if (last !== undefined && (t - last) < minGap) continue;
          chosen = c;
        }
        // 2ª passada: relaxa o descanso, mas nunca o encaixe no intervalo
        for (var p2 = 0; p2 < pools.cut.length && !chosen; p2++) {
          var c2 = pools.cut[(rot + p2) % pools.cut.length];
          if (c2.effect.dur <= gap) chosen = c2;
        }
        if (!chosen) continue;   // nada cabe nesse corte — pula, não atropela

        lastUsedAt[chosen.effect.id] = t;
        rot++;
        steps.push({ role: 'cut', effect: chosen.effect, at: t,
                     reason: 'corte ' + (i + 1) });
      }
    }

    var distinct = {};
    steps.forEach(function (s) { distinct[s.effect.id] = 1; });

    return {
      steps: steps,
      pools: pools,
      warnings: warnings,
      stats: {
        placements: steps.length,
        distinctFiles: Object.keys(distinct).length,
        cuts: cuts.length,
        poolSizes: {
          cut:    pools.cut    ? pools.cut.length    : 0,
          impact: pools.impact ? pools.impact.length : 0,
          bed:    pools.bed    ? pools.bed.length    : 0,
        },
      },
    };
  }

  var API = { buildPlan: buildPlan, hashSeed: hashSeed, buildPool: buildPool, genreFit: genreFit,
              roleStrength: roleStrength, conceptIndex: conceptIndex };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.CinePROSfxEngine = API;

})(typeof window !== 'undefined' ? window : globalThis);
