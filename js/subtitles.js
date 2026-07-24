// =============================================================
//  CinePRO — Motor de Legendas
//  Parsing SRT/VTT + quebra de linhas. Camada 100% compartilhada
//  entre Premiere (MOGRT) e DaVinci (Text+/track de legenda): só a
//  renderização muda, o entendimento do texto é o mesmo.
//
//  Sem dependência de DOM/CEP — roda no plugin, no app e em teste.
// =============================================================

(function (global) {
  'use strict';

  // ── Tempo ───────────────────────────────────────────────────
  // SRT usa "00:01:02,500" (vírgula) e VTT "00:01:02.500" (ponto);
  // VTT também aceita "01:02.500" sem hora. Aceitamos os três.
  var TIME_RX = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/;

  function parseTime(str) {
    var m = TIME_RX.exec(String(str || '').trim());
    if (!m) return null;
    var h = parseInt(m[1] || '0', 10);
    var min = parseInt(m[2], 10);
    var s = parseInt(m[3], 10);
    // "5" em ".5" são 500ms, não 5ms — normaliza pra 3 casas
    var ms = parseInt((m[4] + '00').slice(0, 3), 10);
    return h * 3600 + min * 60 + s + ms / 1000;
  }

  function formatTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    var ms = Math.round((sec - Math.floor(sec)) * 1000);
    function p(n, w) { return String(n).padStart(w || 2, '0'); }
    return p(h) + ':' + p(m) + ':' + p(s) + ',' + p(ms, 3);
  }

  // ── Limpeza de texto ────────────────────────────────────────
  // Legendas trazem markup que NÃO pode virar texto visível no
  // template: tags de estilo, posicionamento e ruído de ASR.
  function cleanText(raw) {
    return String(raw || '')
      .replace(/<[^>]+>/g, '')                 // <i>, <b>, <font color=…>
      .replace(/\{\\[^}]*\}/g, '')             // ASS/SSA override {\an8}
      .replace(/^-\s*/gm, '')                  // travessão de diálogo
      .replace(/​|﻿/g, '')           // zero-width / BOM
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /**
   * Faz o parse de SRT ou WebVTT numa lista de cues.
   * Tolerante de propósito: arquivos de ASR (Whisper, CapCut, YouTube)
   * costumam vir com numeração faltando, CRLF misturado e blocos vazios.
   *
   * @returns {Array<{index, start, end, dur, text, lines}>}
   */
  function parse(content) {
    var txt = String(content || '')
      .replace(/\r\n?/g, '\n')                 // CRLF/CR → LF
      .replace(/^﻿/, '')                  // BOM
      .replace(/^WEBVTT[^\n]*\n/, '');         // cabeçalho VTT

    var blocks = txt.split(/\n{2,}/);
    var cues = [];

    for (var b = 0; b < blocks.length; b++) {
      var lines = blocks[b].split('\n').filter(function (l) { return l.trim() !== ''; });
      if (!lines.length) continue;

      // A numeração é opcional: se a 1ª linha é só dígitos, descarta
      if (/^\d+$/.test(lines[0].trim()) && lines.length > 1) lines.shift();
      if (!lines.length) continue;

      var mt = /(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/.exec(lines[0]);
      if (!mt) continue;                       // bloco sem timecode → ignora

      var start = parseTime(mt[1]);
      var end   = parseTime(mt[2]);
      if (start === null || end === null) continue;
      if (end <= start) end = start + 1;       // cue degenerado → 1s de piso

      var body = cleanText(lines.slice(1).join('\n'));
      if (!body) continue;                     // cue vazio não vira legenda

      cues.push({
        index: cues.length + 1,
        start: start,
        end: end,
        dur: end - start,
        text: body.replace(/\n/g, ' '),
        lines: body.split('\n'),
      });
    }

    return cues;
  }

  /**
   * Quebra o texto em N linhas equilibradas, respeitando palavras.
   * Templates de legenda têm um número FIXO de campos de texto (1, 2,
   * 3 linhas...), então o texto precisa caber exatamente — e quebrar
   * pelo meio de uma palavra é o erro mais visível que existe.
   *
   * Usa o MENOR número de linhas que caiba em maxCharsPerLine (42 é o
   * padrão de broadcast EBU/Netflix) e só então equilibra pela maior
   * linha. Otimizar só pelo equilíbrio quebraria "Cue invertido" em
   * duas linhas sem necessidade — mais linhas sempre reduzem a maior.
   */
  var DEFAULT_MAX_CHARS = 42;

  function fitLines(text, maxLines, maxCharsPerLine) {
    var words = String(text || '').trim().split(/\s+/).filter(Boolean);
    maxLines = Math.max(1, maxLines || 1);
    maxCharsPerLine = maxCharsPerLine || DEFAULT_MAX_CHARS;
    if (!words.length) return [];
    if (maxLines === 1) return [words.join(' ')];

    var best = null;

    // Empacota com uma largura máxima fixa (greedy simples).
    function pack(width) {
      var out = [], cur = '';
      for (var i = 0; i < words.length; i++) {
        var next = cur ? cur + ' ' + words[i] : words[i];
        if (cur && next.length > width) { out.push(cur); cur = words[i]; }
        else cur = next;
      }
      if (cur) out.push(cur);
      return out;
    }

    // Menor largura que ainda cabe em n linhas → linhas equilibradas.
    // Greedy com alvo fixo despejava o resto na última linha (33 vs 49
    // chars); a busca binária na largura dá a partição ótima.
    function split(n) {
      var lo = words.reduce(function (a, w) { return Math.max(a, w.length); }, 0);
      var hi = words.join(' ').length;
      var out = pack(hi);
      while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        var p = pack(mid);
        if (p.length <= n) { out = p; hi = mid - 1; } else { lo = mid + 1; }
      }
      return out;
    }

    // Primeiro n que couber vence — menos linhas é sempre melhor leitura
    for (var n = 1; n <= maxLines; n++) {
      var cand = split(n);
      if (cand.length > maxLines) continue;
      var longest = Math.max.apply(null, cand.map(function (l) { return l.length; }));
      if (!best) best = { lines: cand, longest: longest };   // fallback
      if (longest <= maxCharsPerLine) return cand;
    }

    // Nada coube (texto longo demais): usa o máximo de linhas permitido
    return split(maxLines);
  }

  /**
   * Aplica regras editoriais nas cues antes de ir pra timeline.
   *  - minDur: cue curta demais pisca e não dá tempo de ler
   *  - gap: cues coladas viram um borrão; separa por alguns frames
   *  - maxLines/maxChars: encaixa no template escolhido
   */
  function normalize(cues, opts) {
    opts = opts || {};
    var minDur  = opts.minDur  != null ? opts.minDur  : 0.7;
    var gap     = opts.gap     != null ? opts.gap     : 0.04;  // ~1 frame
    var maxLines = opts.maxLines || 2;
    var maxChars = opts.maxChars || 0;

    var out = cues.map(function (c) {
      var o = {
        index: c.index, start: c.start, end: c.end, dur: c.dur, text: c.text,
      };
      o.lines = fitLines(c.text, maxLines, maxChars);
      return o;
    });

    for (var i = 0; i < out.length; i++) {
      if (out[i].end - out[i].start < minDur) out[i].end = out[i].start + minDur;
      // Não deixa invadir a próxima: encurta em vez de sobrepor
      if (i + 1 < out.length && out[i].end > out[i + 1].start - gap) {
        out[i].end = Math.max(out[i].start + 0.2, out[i + 1].start - gap);
      }
      out[i].dur = out[i].end - out[i].start;
    }
    return out;
  }

  function stats(cues) {
    if (!cues.length) return { count: 0, duration: 0, chars: 0, cps: 0 };
    var chars = cues.reduce(function (a, c) { return a + c.text.length; }, 0);
    var span = cues[cues.length - 1].end - cues[0].start;
    var spoken = cues.reduce(function (a, c) { return a + c.dur; }, 0);
    return {
      count: cues.length,
      duration: span,
      chars: chars,
      // caracteres por segundo falado — acima de ~20 fica ilegível
      cps: spoken > 0 ? Math.round((chars / spoken) * 10) / 10 : 0,
    };
  }

  var API = { parse: parse, normalize: normalize, fitLines: fitLines,
              cleanText: cleanText, parseTime: parseTime, formatTime: formatTime,
              stats: stats };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.CinePROSubtitles = API;

})(typeof window !== 'undefined' ? window : globalThis);
