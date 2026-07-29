// =============================================================
//  CinePRO — Diagnóstico de timeline (ADR-011)
//
//  Varre a montagem e devolve ACHADOS — nunca altera nada. A
//  entrega é por marcador na timeline, então é 100% reversível:
//  o editor apaga os marcadores e não sobra vestígio.
//
//  Os limites vêm de knowledge/retencao-e-edicao.md, que por sua
//  vez veio do second brain do Thales (não de regra inventada):
//  o ciclo de atenção é ~8s, mas é preciso RECOMPRAR atenção a
//  cada 5s no horizontal e a cada 2s no vertical.
//
//  Só precisa dos CORTES pra funcionar — não depende de
//  transcrição. Por isso roda no Premiere hoje.
//
//  Sem dependência de DOM/CEP: roda no plugin, no app e em teste.
// =============================================================

(function (global) {
  'use strict';

  // Severidade → cor. Os executores mapeiam pro que cada editor aceita.
  var SEV = { high: 'red', medium: 'yellow', low: 'cyan', info: 'green' };

  var DEFAULTS = {
    // "comprar atenção" a cada N segundos, por formato
    limitVertical: 2,
    limitHorizontal: 5,
    // acima disto é o ciclo de atenção humano — perde a pessoa
    hardLimit: 8,
    // janela de gancho: o começo decide se a pessoa fica
    hookWindow: 5,
    // teto de marcadores: timeline poluída não é diagnóstico, é ruído
    maxFindings: 40,
  };

  function opt(o, k) {
    o = o || {};
    return (typeof o[k] === 'number' && isFinite(o[k])) ? o[k] : DEFAULTS[k];
  }

  function round(n) { return Math.round(n * 100) / 100; }

  /** Vertical quando a altura supera a largura (9:16, 4:5). */
  function isVertical(tl) {
    if (!tl) return false;
    if (typeof tl.width === 'number' && typeof tl.height === 'number' && tl.width > 0) {
      return tl.height > tl.width;
    }
    return false;
  }

  /**
   * Momentos que "recompram" a atenção. Hoje são os cortes; quando
   * houver leitura de lettering/efeito, entram aqui também — o resto
   * do motor não muda.
   */
  function attentionBeats(tl) {
    var beats = (tl && tl.cuts ? tl.cuts.slice() : []);
    if (tl && Array.isArray(tl.beats)) beats = beats.concat(tl.beats);
    beats.sort(function (a, b) { return a - b; });
    // dedupe com tolerância de 1 frame a 24fps
    var out = [];
    for (var i = 0; i < beats.length; i++) {
      if (out.length && Math.abs(beats[i] - out[out.length - 1]) < 0.04) continue;
      out.push(beats[i]);
    }
    return out;
  }

  /**
   * Trechos longos demais sem quebra de padrão.
   * @returns {Array} achados
   */
  function retentionGaps(tl, options) {
    var vert = isVertical(tl);
    var limit = vert ? opt(options, 'limitVertical') : opt(options, 'limitHorizontal');
    var hard = opt(options, 'hardLimit');
    var dur = (tl && tl.duration) || 0;
    var beats = attentionBeats(tl);
    var found = [];

    // Fronteiras: início da timeline e fim entram como limites do vão
    var pts = [0].concat(beats);
    if (dur > 0) pts.push(dur);

    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var gap = b - a;
      if (gap <= limit) continue;

      var sev = gap >= hard ? 'high' : (gap >= limit * 2 ? 'medium' : 'low');
      found.push({
        type: 'retention-gap',
        at: round(a),
        end: round(b),
        duration: round(gap),
        severity: sev,
        color: SEV[sev],
        title: round(gap) + 's sem quebra de padrão',
        note: 'Limite para ' + (vert ? 'vertical' : 'horizontal') + ': ' + limit + 's. ' +
              'Considere corte, lettering, B-roll ou SFX aqui.',
      });
    }
    return found;
  }

  /**
   * O começo decide se a pessoa fica. Se o primeiro corte demora, o
   * gancho está lento — o 7E pede 3-5s no bloco de antagonismo.
   */
  function hookCheck(tl, options) {
    var win = opt(options, 'hookWindow');
    var beats = attentionBeats(tl);
    var first = beats.length ? beats[0] : ((tl && tl.duration) || 0);
    if (first <= win) return [];
    return [{
      type: 'slow-hook',
      at: 0,
      end: round(first),
      duration: round(first),
      severity: first >= win * 2 ? 'high' : 'medium',
      color: first >= win * 2 ? SEV.high : SEV.medium,
      title: 'Gancho lento: ' + round(first) + 's até o 1º corte',
      note: 'O bloco de abertura (E1 do 7E) mira 3-5s. Corte antes ou ' +
            'comece o vídeo mais perto do conflito.',
    }];
  }

  /** Resumo do ritmo — informativo, não é problema por si só. */
  function cutRhythm(tl) {
    var beats = attentionBeats(tl);
    if (beats.length < 2) return null;
    var gaps = [];
    for (var i = 1; i < beats.length; i++) gaps.push(beats[i] - beats[i - 1]);
    gaps.sort(function (a, b) { return a - b; });
    var sum = gaps.reduce(function (a, b) { return a + b; }, 0);
    return {
      cuts: beats.length,
      avgGap: round(sum / gaps.length),
      medianGap: round(gaps[Math.floor(gaps.length / 2)]),
      shortest: round(gaps[0]),
      longest: round(gaps[gaps.length - 1]),
    };
  }

  /**
   * Análise completa.
   * @param {object} tl  {cuts:[], duration, width, height, beats?}
   * @returns {object} {findings, rhythm, stats}
   */
  function analyze(tl, options) {
    var findings = []
      .concat(hookCheck(tl, options))
      .concat(retentionGaps(tl, options));

    // Pior primeiro: com teto de marcadores, o que sobra tem que ser
    // o que mais dói. Ordenar por tempo aqui esconderia o problema
    // grave que está no fim do vídeo.
    var rank = { high: 0, medium: 1, low: 2, info: 3 };
    findings.sort(function (a, b) {
      if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
      return b.duration - a.duration;
    });

    var max = opt(options, 'maxFindings');
    var truncated = findings.length > max;
    if (truncated) findings = findings.slice(0, max);

    var vert = isVertical(tl);
    var worst = findings.length ? findings[0] : null;

    return {
      findings: findings,
      rhythm: cutRhythm(tl),
      stats: {
        format: vert ? 'vertical' : 'horizontal',
        limit: vert ? opt(options, 'limitVertical') : opt(options, 'limitHorizontal'),
        duration: round((tl && tl.duration) || 0),
        total: findings.length,
        high: findings.filter(function (f) { return f.severity === 'high'; }).length,
        truncated: truncated,
        worstGap: worst ? worst.duration : 0,
      },
    };
  }


  // ══ BRIEFING ════════════════════════════════════════════════
  // Apontar problema não muda edição. O que muda é dizer O QUE FAZER
  // e POR QUE — o "porquê" é o que ensina o editor a não repetir.
  // Toda prescrição aqui vem de knowledge/retencao-e-edicao.md.

  var PRESCRICOES = {
    'retention-gap': {
      acao: 'Insira uma quebra de padrão: corte, lettering, mudança de ' +
            'câmera, animação ou SFX.',
      porque: 'A atenção precisa ser recomprada em ciclos. Passar do limite ' +
              'do formato é onde a retenção cai.',
      cuidado: 'Não repita a mesma quebra que você usou antes — repetir o ' +
               'mesmo recurso derruba a atenção em vez de segurar. E B-roll ' +
               'de 3s não conta: o raciocínio precisa de fluxo contínuo.',
    },
    'slow-hook': {
      acao: 'Corte antes ou comece o vídeo mais perto do conflito.',
      porque: 'O bloco de abertura decide se a pessoa fica. No 7E, o ' +
              'Antagonismo mira 3-5s.',
      cuidado: 'Fórmula que funciona: "Enquanto [uns fazem X], [outros ' +
               'fazem Y]". Contraste faz o cérebro parar pra processar.',
    },
  };

  /**
   * Transforma achados em briefing de edição.
   * @returns {object} {verdict, tone, headline, cards, acoes, principio}
   */
  function buildBriefing(result) {
    var st = result.stats;
    var r = result.rhythm;
    var n = st.total, graves = st.high;

    var verdict, tone;
    if (!n) {
      verdict = 'Ritmo saudável';
      tone = 'ok';
    } else if (graves >= 3) {
      verdict = 'A retenção está vazando';
      tone = 'bad';
    } else if (graves >= 1) {
      verdict = 'Tem pontos que derrubam a retenção';
      tone = 'warn';
    } else {
      verdict = 'Quase lá — ajustes pontuais';
      tone = 'warn';
    }

    var headline = !n
      ? 'Nenhum trecho passa de ' + st.limit + 's sem quebra de padrão. ' +
        'O ritmo está segurando a atenção.'
      : n + (n === 1 ? ' trecho perde' : ' trechos perdem') + ' a atenção do ' +
        'espectador. O pior fica ' + st.worstGap + 's sem nenhuma quebra de ' +
        'padrão — o limite para ' + st.format + ' é ' + st.limit + 's.';

    var cards = [
      { label: 'Formato', value: st.format === 'vertical' ? 'Vertical' : 'Horizontal',
        hint: 'recompra a cada ' + st.limit + 's' },
      { label: 'Duração', value: fmtTime(st.duration), hint: 'da sequência' },
    ];
    if (r) {
      cards.push({ label: 'Cortes', value: String(r.cuts), hint: 'na timeline' });
      cards.push({
        label: 'Ritmo médio', value: r.avgGap + 's',
        hint: r.avgGap > st.limit ? 'acima do limite' : 'dentro do limite',
        bad: r.avgGap > st.limit,
      });
    }

    var acoes = result.findings.map(function (f) {
      var p = PRESCRICOES[f.type] || {};
      return {
        at: f.at,
        timecode: fmtTime(f.at),
        severity: f.severity,
        titulo: f.title,
        acao: p.acao || f.note,
        porque: p.porque || '',
        cuidado: p.cuidado || '',
      };
    });

    // O princípio fecha o briefing: é o que o editor leva pro próximo vídeo.
    var principio = st.format === 'vertical'
      ? 'Em Reels e Shorts a atenção precisa ser recomprada a cada 2 segundos. ' +
        'Interesse não é conquistado, é mantido.'
      : 'No YouTube a atenção precisa ser recomprada a cada 5 segundos. ' +
        'Curiosidade leva a interesse, e interesse leva a retenção.';

    return {
      verdict: verdict, tone: tone, headline: headline,
      cards: cards, acoes: acoes, principio: principio,
    };
  }

  function fmtTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** Achados → marcadores. `customData` permite apagar só os nossos. */
  function toMarkers(result, fps) {
    fps = Number(fps) || 24;
    return result.findings.map(function (f) {
      return {
        frame: Math.max(0, Math.round(f.at * fps)),
        durationFrames: Math.max(1, Math.round(Math.min(f.duration, 5) * fps)),
        color: f.color,
        name: 'CinePRO · ' + f.title,
        note: f.note,
        customData: 'cinepro:' + f.type,
      };
    });
  }

  /** Relatório em texto — o que o editor manda pro cliente dele. */
  function toReport(result) {
    var s = result.stats;
    var L = [];
    L.push('# Diagnóstico de retenção — CinePRO');
    L.push('');
    L.push('- Formato: **' + s.format + '** (recompra de atenção a cada ' + s.limit + 's)');
    L.push('- Duração: **' + s.duration + 's**');
    if (result.rhythm) {
      L.push('- Cortes: **' + result.rhythm.cuts + '** · intervalo médio **' +
             result.rhythm.avgGap + 's** (mediana ' + result.rhythm.medianGap + 's)');
    }
    L.push('- Pontos de atenção: **' + s.total + '**' + (s.high ? ' (' + s.high + ' graves)' : ''));
    L.push('');
    if (!result.findings.length) {
      L.push('✅ Nenhum trecho acima do limite. O ritmo está segurando a atenção.');
      return L.join('\n');
    }
    L.push('| Tempo | Duração | Gravidade | Observação |');
    L.push('|---|---|---|---|');
    result.findings.forEach(function (f) {
      var mm = Math.floor(f.at / 60), ss = Math.floor(f.at % 60);
      var tc = mm + ':' + (ss < 10 ? '0' : '') + ss;
      var sev = f.severity === 'high' ? 'alta' : (f.severity === 'medium' ? 'média' : 'baixa');
      L.push('| ' + tc + ' | ' + f.duration + 's | ' + sev + ' | ' + f.title + ' |');
    });
    if (s.truncated) L.push('\n_Lista limitada aos mais graves._');
    return L.join('\n');
  }

  var API = {
    analyze: analyze,
    buildBriefing: buildBriefing,
    fmtTime: fmtTime,
    retentionGaps: retentionGaps,
    hookCheck: hookCheck,
    cutRhythm: cutRhythm,
    attentionBeats: attentionBeats,
    isVertical: isVertical,
    toMarkers: toMarkers,
    toReport: toReport,
    DEFAULTS: DEFAULTS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.CinePRODiagnostics = API;

})(typeof window !== 'undefined' ? window : globalThis);
