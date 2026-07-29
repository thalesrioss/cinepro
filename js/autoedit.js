// =============================================================
//  CinePRO — AutoEdit
//
//  Transforma uma transcrição com tempo por palavra num PLANO de
//  corte: quais trechos ficam, quais saem. Não aplica nada — quem
//  aplica é o executor de cada editor (mesmo padrão do sfx-engine).
//
//  Por que reconstruir em vez de cortar: a API do Resolve não tem
//  razor. Mas tem CreateTimelineFromClips com in/out por trecho, o
//  que é MELHOR — a timeline original nunca é tocada. Um autoedit
//  que estraga a montagem do editor é pior que não ter autoedit.
//
//  Sem dependência de DOM/CEP — roda no plugin, no app e em teste.
// =============================================================

(function (global) {
  'use strict';

  // Padrões escolhidos pra fala natural em português:
  //  - abaixo de ~0,35s a pausa é respiração/ritmo, não silêncio morto.
  //    Cortar aí deixa a fala ofegante e denuncia a edição.
  //  - o padding evita o "corte na respiração", que soa amador: dá um
  //    respiro antes da primeira sílaba e depois da última.
  var DEFAULTS = {
    minSilence: 0.35,   // gap mínimo pra considerar silêncio
    padding: 0.08,      // respiro mantido nas bordas de cada fala
    minSegment: 0.20,   // trecho menor que isto vira picote, descarta
    maxGapKeep: 0.00,   // quanto do silêncio preservar (0 = corta todo)
  };

  function opt(o, k) {
    o = o || {};
    return (typeof o[k] === 'number' && isFinite(o[k])) ? o[k] : DEFAULTS[k];
  }

  /**
   * Lacunas de silêncio entre palavras.
   * @param {Array<{start,end}>} words
   * @returns {Array<{start,end,dur}>}
   */
  function detectSilences(words, options) {
    var minSil = opt(options, 'minSilence');
    var out = [];
    if (!words || words.length < 2) return out;
    for (var i = 0; i < words.length - 1; i++) {
      var gapStart = words[i].end;
      var gapEnd = words[i + 1].start;
      var dur = gapEnd - gapStart;
      if (dur >= minSil) out.push({ start: gapStart, end: gapEnd, dur: dur });
    }
    return out;
  }

  /**
   * Trechos que FICAM (o inverso dos silêncios), já com respiro e
   * mesclando o que encostou.
   *
   * @param {Array<{word,start,end}>} words
   * @param {object} options  {minSilence, padding, minSegment, duration}
   * @returns {Array<{start,end,dur,text}>}
   */
  function buildSegments(words, options) {
    if (!words || !words.length) return [];
    var minSil  = opt(options, 'minSilence');
    var pad     = opt(options, 'padding');
    var minSeg  = opt(options, 'minSegment');
    var keepGap = opt(options, 'maxGapKeep');
    var total   = (options && typeof options.duration === 'number') ? options.duration : null;

    // 1. agrupa palavras em blocos de fala, quebrando nos silêncios
    var blocks = [], cur = [words[0]];
    for (var i = 1; i < words.length; i++) {
      var gap = words[i].start - words[i - 1].end;
      if (gap >= minSil) { blocks.push(cur); cur = [words[i]]; }
      else cur.push(words[i]);
    }
    blocks.push(cur);

    // 2. cada bloco vira segmento com respiro nas bordas
    var segs = blocks.map(function (b) {
      var s = b[0].start - pad - keepGap / 2;
      var e = b[b.length - 1].end + pad + keepGap / 2;
      if (s < 0) s = 0;
      if (total !== null && e > total) e = total;
      return {
        start: Math.round(s * 1000) / 1000,
        end: Math.round(e * 1000) / 1000,
        text: b.map(function (w) { return String(w.word || '').trim(); }).join(' ').replace(/\s+/g, ' ').trim(),
      };
    });

    // 3. o respiro pode ter feito segmentos vizinhos se encostarem —
    //    mesclar evita corte de 1 frame, que o editor não consegue nem ver
    var merged = [];
    for (var j = 0; j < segs.length; j++) {
      var last = merged[merged.length - 1];
      if (last && segs[j].start <= last.end) {
        last.end = Math.max(last.end, segs[j].end);
        last.text = (last.text + ' ' + segs[j].text).trim();
      } else {
        merged.push(segs[j]);
      }
    }

    // 4. descarta picotes e calcula duração
    var out = [];
    for (var k = 0; k < merged.length; k++) {
      var d = merged[k].end - merged[k].start;
      if (d < minSeg) continue;
      merged[k].dur = Math.round(d * 1000) / 1000;
      out.push(merged[k]);
    }
    return out;
  }

  /**
   * Plano completo de autoedit. Devolve o que fica, o que sai e o
   * quanto encurta — o número que o editor quer ver antes de aceitar.
   */
  function buildPlan(words, options) {
    options = options || {};
    var segments = buildSegments(words, options);
    var silences = detectSilences(words, options);

    var total = typeof options.duration === 'number' ? options.duration
      : (words && words.length ? words[words.length - 1].end : 0);
    var kept = segments.reduce(function (a, s) { return a + s.dur; }, 0);

    return {
      segments: segments,
      silences: silences,
      stats: {
        original: Math.round(total * 100) / 100,
        final: Math.round(kept * 100) / 100,
        removed: Math.round((total - kept) * 100) / 100,
        percent: total > 0 ? Math.round((1 - kept / total) * 1000) / 10 : 0,
        cuts: Math.max(0, segments.length - 1),
        words: words ? words.length : 0,
      },
    };
  }

  /**
   * Converte segundos → frames com o frame rate do projeto.
   * Arredondar errado desalinha o corte da fala: sempre pro frame
   * mais próximo, e nunca abaixo de zero.
   */
  function toFrames(sec, fps) {
    var f = Math.round((Number(sec) || 0) * (Number(fps) || 24));
    return f < 0 ? 0 : f;
  }

  /**
   * Serializa o plano no formato que os executores consomem.
   * schemaVersion permite o script antigo recusar plano novo em vez
   * de aplicar errado.
   */
  function toExecutionPlan(plan, ctx) {
    ctx = ctx || {};
    var fps = Number(ctx.fps) || 24;
    return {
      schemaVersion: 1,
      kind: 'autoedit',
      fps: fps,
      source: ctx.source || null,
      timelineName: ctx.timelineName || 'CinePRO AutoEdit',
      stats: plan.stats,
      segments: plan.segments.map(function (s) {
        return {
          startFrame: toFrames(s.start, fps),
          endFrame: toFrames(s.end, fps),
          start: s.start,
          end: s.end,
          text: s.text,
        };
      }),
    };
  }

  var API = {
    detectSilences: detectSilences,
    buildSegments: buildSegments,
    buildPlan: buildPlan,
    toExecutionPlan: toExecutionPlan,
    toFrames: toFrames,
    DEFAULTS: DEFAULTS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.CinePROAutoEdit = API;

})(typeof window !== 'undefined' ? window : globalThis);
