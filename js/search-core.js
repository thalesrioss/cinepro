// =============================================================
//  CinePRO — Busca da biblioteca (BL-0034)
//
//  Uma função só para o painel (js/main.js) e para o app desktop
//  (desktop-app/renderer/js/app.js). Antes eram duas: o painel casava
//  conceito mas por substring de prefixo; o app só fazia substring crua
//  ("lut" achava "Flutter", "chuva" não achava "rain").
//
//  Regras:
//   1. Palavra inteira: o termo casa um token do arquivo se for igual,
//      ou (termo >= 3 letras) se o token começar com ele, valendo menos
//      ("laugh" → "laughing"; "rain" não casa "train" nem "Grain";
//      "lut" não casa "flutter").
//   2. PT→EN: cada termo digitado vale também pelas traduções de
//      PT_EN (o acervo é quase todo nomeado em inglês).
//   3. Ordem: casar o termo digitado pesa mais que casar a tradução;
//      vários termos = todos precisam casar (E).
//   4. Conceitos do manifest só completam a lista quando o texto acha
//      pouco (< CONCEPT_FILL_BELOW), e aí a key do conceito igual ao
//      termo digitado (ou à tradução) vem antes das irmãs
//      ("risada" → "laugh" antes de "breath"/"scream", que também são
//      keys do conceito vocal).
//   5. Acerto pelo nome e "parecido" por conceito ficam separados
//      (searchSplit → {hits, related}, BL-0059): o contador conta só
//      os acertos; os parecidos aparecem numa seção própria. "tiro"
//      não tem nenhum arquivo com o nome; antes eram "58 resultados"
//      de espadas.
//   6. Empate: o termo no nome do arquivo vale mais que o termo só na
//      pasta ("suspense": "09 Suspense Hit B" antes dos arquivos da
//      pasta SFX>SUSPENSE).
//
//  Sem DOM/CEP: roda no painel, no app e em teste (tools/test-search-core.js).
//  O app empacota uma CÓPIA deste arquivo em
//  desktop-app/renderer/js/search-core.js (`npm run sync-shared` no
//  desktop-app); o teste falha se a cópia divergir.
// =============================================================

(function (global) {
  'use strict';

  // Dicionário PT→EN para o vocabulário de SFX/visual do acervo.
  // Chaves já normalizadas (sem acento, minúsculas). Plural simples
  // ("passos", "portas") é resolvido em translationsOf.
  var PT_EN = {
    chuva: ['rain'], garoa: ['drizzle', 'rain'], tempestade: ['storm', 'thunder'],
    trovao: ['thunder'], trovoes: ['thunder'], raio: ['lightning', 'thunder'],
    vento: ['wind'], brisa: ['breeze', 'wind'], fogo: ['fire'], chama: ['flame', 'fire'],
    agua: ['water'], onda: ['wave'], mar: ['ocean', 'sea', 'waves'], oceano: ['ocean'],
    rio: ['river', 'stream'], neve: ['snow'], gelo: ['ice'], fumaca: ['smoke'],
    floresta: ['forest'], passaro: ['bird'], natureza: ['nature'],
    explosao: ['explosion', 'explode', 'boom'], explosoes: ['explosion', 'explode', 'boom'],
    tiro: ['gunshot', 'gun', 'gunfire'], tiros: ['gunshot', 'gun', 'gunfire'], arma: ['gun', 'weapon'],
    espada: ['sword'], faca: ['knife'], soco: ['punch'], socos: ['punch'],
    chute: ['kick'], tapa: ['slap'], batida: ['hit', 'impact'], impacto: ['impact', 'hit'],
    queda: ['fall', 'drop'], pancada: ['hit', 'thud'],
    palma: ['clap', 'applause'], palmas: ['clap', 'applause'], aplauso: ['applause', 'clap'],
    multidao: ['crowd'], torcida: ['crowd', 'cheer'],
    passo: ['footstep', 'footsteps', 'steps'], passos: ['footstep', 'footsteps', 'steps'],
    pisada: ['footstep', 'steps'],
    porta: ['door'], janela: ['window'], vidro: ['glass'], madeira: ['wood'], metal: ['metal'],
    papel: ['paper'], moeda: ['coin'], dinheiro: ['money', 'cash'], caixa: ['box'],
    risada: ['laugh'], risadas: ['laugh'], riso: ['laugh'], gargalhada: ['laugh'],
    grito: ['scream'], gritos: ['scream'], choro: ['cry'], respiracao: ['breath'],
    sussurro: ['whisper'], suspiro: ['sigh'], beijo: ['kiss'], voz: ['voice'],
    coracao: ['heartbeat', 'heart'], batimento: ['heartbeat'],
    sino: ['bell'], campainha: ['doorbell', 'bell'], telefone: ['phone'], celular: ['phone'],
    relogio: ['clock', 'tick'], alarme: ['alarm'], sirene: ['siren'], buzina: ['horn'],
    notificacao: ['notification'], clique: ['click'], tecla: ['keyboard', 'typing'],
    teclado: ['keyboard', 'typing'], digitando: ['typing'], camera: ['camera', 'shutter'],
    carro: ['car'], moto: ['motorcycle'], motor: ['engine'], freio: ['brake'],
    aviao: ['plane', 'airplane'], trem: ['train'],
    cachorro: ['dog'], gato: ['cat'], cavalo: ['horse'],
    transicao: ['transition'], transicoes: ['transition'], subida: ['riser', 'rise'],
    zumbido: ['buzz', 'hum'], estalo: ['snap', 'crack'], estalar: ['snap'],
    magia: ['magic'], brilho: ['sparkle', 'shimmer', 'glow'], fogos: ['fireworks'],
    tambor: ['drum'], tambores: ['drum'], musica: ['music'],
    epico: ['epic', 'cinematic'], epica: ['epic', 'cinematic'], terror: ['horror'], medo: ['horror', 'scary'], suspense: ['suspense', 'tension'],
    luz: ['light'], lente: ['lens'], poeira: ['dust'], particula: ['particle'],
    particulas: ['particle'], textura: ['texture'], granulado: ['grain'], filme: ['film'],
    titulo: ['title'], texto: ['text'], legenda: ['subtitle', 'caption'],
  };

  var CONCEPT_FILL_BELOW = 15;
  var CONCEPT_LIMIT = 60;

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function tokenize(normText) {
    var out = [];
    var toks = normText.split(/[^a-z0-9]+/);
    for (var i = 0; i < toks.length; i++) if (toks[i] && toks[i].length >= 2) out.push(toks[i]);
    return out;
  }

  function translationsOf(term) {
    var t = PT_EN[term];
    if (!t && term.length > 3 && term.charAt(term.length - 1) === 's') t = PT_EN[term.slice(0, -1)];
    return t || [];
  }

  // Termo casa token? Igual, ou prefixo quando o termo tem >= 4 letras.
  function wordHit(term, tok) {
    return tok === term || (term.length >= 4 && tok.length > term.length && tok.indexOf(term) === 0);
  }

  function anyWordHit(term, tokens) {
    for (var i = 0; i < tokens.length; i++) if (wordHit(term, tokens[i])) return true;
    return false;
  }

  // Texto pesquisável de um arquivo do manifest (ou efeito do painel).
  function itemText(it) {
    return it.name + ' ' + (it.category || '') + ' ' + (it.subcategory || '') + ' ' +
      ((it.path && it.path.join) ? it.path.join(' ') : '') + ' ' +
      ((it.tags && it.tags.join) ? it.tags.join(' ') : '');
  }

  // Termo no nome do arquivo (não só na pasta/categoria): palavra igual,
  // ou prefixo a partir de 3 letras, como em hitsFor.
  function nameHit(term, nameToks) {
    for (var i = 0; i < nameToks.length; i++) {
      var w = nameToks[i];
      if (w === term || (term.length >= 3 && w.length > term.length && w.indexOf(term) === 0)) return true;
    }
    return false;
  }
  var NAME_BONUS = 0.25;

  /**
   * Índice: tokens de cada item + mapa token→itens para o caminho rápido
   * (termo curto casa só token igual: lookup direto, sem varrer 11k).
   */
  function buildIndex(items, concepts) {
    var tokens = new Array(items.length);
    var nameTokens = new Array(items.length);
    var byToken = Object.create(null);
    var vocab = [];
    for (var i = 0; i < items.length; i++) {
      var toks = tokenize(normalize(itemText(items[i])));
      tokens[i] = toks;
      nameTokens[i] = tokenize(normalize(items[i].name));
      for (var t = 0; t < toks.length; t++) {
        var list = byToken[toks[t]];
        if (!list) { list = byToken[toks[t]] = []; vocab.push(toks[t]); }
        if (list[list.length - 1] !== i) list.push(i);
      }
    }
    return { items: items, tokens: tokens, nameTokens: nameTokens, byToken: byToken, vocab: vocab, concepts: concepts || null };
  }

  // Itens que casam o termo por palavra inteira: { idx: 1 (palavra igual) | 0.5 (prefixo) }.
  // Palavra igual vem antes: "porta" acha "SFX - Porta Rangendo" antes de "Portal Jump".
  function hitsFor(index, term) {
    var out = Object.create(null);
    // Aqui o prefixo vale a partir de 3 letras (enquanto digita, "who" já
    // acha "whoosh"), mas sempre depois da palavra igual.
    var words = term.length >= 3
      ? index.vocab.filter(function (w) { return w === term || (w.length > term.length && w.indexOf(term) === 0); })
      : [term];
    for (var w = 0; w < words.length; w++) {
      var list = index.byToken[words[w]];
      if (!list) continue;
      var v = words[w] === term ? 1 : 0.5;
      for (var k = 0; k < list.length; k++) if (!(out[list[k]] >= v)) out[list[k]] = v;
    }
    return out;
  }

  // Termo que nomeia um tipo de arquivo filtra por esse tipo, se o índice
  // tiver algum: "lut" = só .cube (sem os clipes de exemplo da pasta
  // "Filmkid16 LUT"). No painel, que não lista LUT, vale o texto.
  var TYPE_TERMS = { lut: 'lut', luts: 'lut', cube: 'lut', mogrt: 'mogrt', mogrts: 'mogrt' };

  // Conceitos que algum dos termos (digitados ou traduzidos) é key.
  // Guarda quais termos dispararam para dar peso a quem tem o termo no nome.
  function conceptMatches(concepts, terms) {
    var out = [];
    if (!concepts) return out;
    for (var c = 0; c < concepts.length; c++) {
      var keys = (concepts[c].keys || []).map(normalize);
      var direct = [];
      for (var t = 0; t < terms.length; t++) if (keys.indexOf(terms[t]) !== -1) direct.push(terms[t]);
      if (direct.length) out.push({ idx: c, terms: direct });
    }
    return out;
  }

  /**
   * Busca. Devolve índices de `index.items` em ordem de relevância:
   * acertos pelo nome primeiro, parecidos por conceito depois.
   * opts.accept(item) filtra (categoria, tipo); opts.limit corta.
   */
  function search(index, query, opts) {
    var r = searchSplit(index, query, opts);
    return r.hits.concat(r.related);
  }

  /**
   * Busca separada: { hits, related }. `hits` = casou o texto (nome,
   * pasta, tags, com tradução); `related` = só o conceito do manifest
   * (preenchimento quando o texto acha pouco). opts.limit vale para a
   * soma, acertos primeiro.
   */
  function searchSplit(index, query, opts) {
    opts = opts || {};
    var userAccept = opts.accept || null;
    var limit = opts.limit || Infinity;
    var qTerms = tokenize(normalize(query));
    if (!qTerms.length) return { hits: [], related: [] };

    var kind = null;
    for (var qt = 0; qt < qTerms.length; qt++) {
      var tk = TYPE_TERMS[qTerms[qt]];
      if (tk && index.items.some(function (it) { return it.kind === tk; })) { kind = tk; break; }
    }
    var accept = !kind ? userAccept : function (it) {
      return it.kind === kind && (!userAccept || userAccept(it));
    };

    // Por termo: termo digitado vale 3 (palavra igual) ou 2,5 (prefixo);
    // tradução vale 2 ou 1,5. O termo de tipo ("lut") já filtrou: vale 3 para todos.
    var groups = qTerms.map(function (term) {
      var score = Object.create(null);
      if (kind && TYPE_TERMS[term] === kind) {
        for (var a = 0; a < index.items.length; a++) if (index.items[a].kind === kind) score[a] = 3;
        return score;
      }
      var tr = translationsOf(term);
      for (var j = 0; j < tr.length; j++) {
        var h = hitsFor(index, tr[j]);
        for (var id in h) {
          var st = 1 + h[id] + (nameHit(tr[j], index.nameTokens[id]) ? NAME_BONUS : 0);
          if (!(score[id] >= st)) score[id] = st;
        }
      }
      var hd = hitsFor(index, term);
      for (var id2 in hd) {
        var sd = 2 + hd[id2] + (nameHit(term, index.nameTokens[id2]) ? NAME_BONUS : 0);
        if (!(score[id2] >= sd)) score[id2] = sd;
      }
      return score;
    });

    var ranked = [];
    var first = groups[0];
    for (var key in first) {
      var total = 0, ok = true;
      for (var g = 0; g < groups.length; g++) {
        var s = groups[g][key];
        if (!s) { ok = false; break; }
        total += s;
      }
      if (!ok) continue;
      var i = +key;
      if (accept && !accept(index.items[i])) continue;
      ranked.push({ idx: i, score: total });
    }
    ranked.sort(function (a, b) { return b.score - a.score || a.idx - b.idx; });
    var result = ranked.map(function (r) { return r.idx; });
    var related = [];

    // Pouco texto: completa com conceitos.
    if (result.length < CONCEPT_FILL_BELOW && index.concepts) {
      var allTerms = [];
      qTerms.forEach(function (t) { allTerms.push(t); allTerms = allTerms.concat(translationsOf(t)); });
      var cms = conceptMatches(index.concepts, allTerms);
      if (cms.length) {
        var seen = Object.create(null);
        result.forEach(function (r) { seen[r] = true; });
        var extra = [];
        for (var n = 0; n < index.items.length; n++) {
          if (seen[n]) continue;
          var it = index.items[n];
          var emb = it.embed;
          if (!emb) continue;
          var sc = 0;
          for (var m = 0; m < cms.length; m++) {
            if (!emb[cms[m].idx]) continue;
            sc += 1;
            // key igual ao termo (ou tradução) no próprio texto do item: vem antes das irmãs
            for (var q = 0; q < cms[m].terms.length; q++) {
              if (anyWordHit(cms[m].terms[q], index.tokens[n])) { sc += 1; break; }
            }
          }
          if (!sc) continue;
          if (accept && !accept(it)) continue;
          extra.push({ idx: n, score: sc });
        }
        extra.sort(function (a, b) { return b.score - a.score || a.idx - b.idx; });
        for (var x = 0; x < extra.length && x < CONCEPT_LIMIT; x++) related.push(extra[x].idx);
      }
    }
    if (result.length > limit) result = result.slice(0, limit);
    if (result.length + related.length > limit) related = related.slice(0, limit - result.length);
    return { hits: result, related: related };
  }

  // Textos da busca, iguais no painel e no app.
  function hitsLabel(n, query, capped) {
    var q = String(query == null ? '' : query).trim();
    if (capped) return n + '+ resultados para "' + q + '" — refine a busca';
    return n + (n === 1 ? ' resultado' : ' resultados') + ' para "' + q + '"';
  }
  function relatedTitle(nHits, query) {
    var q = String(query == null ? '' : query).trim();
    return nHits ? 'Parecidos' : 'Nada com "' + q + '" no nome. Parecidos:';
  }

  var API = {
    PT_EN: PT_EN,
    normalize: normalize,
    tokenize: tokenize,
    translationsOf: translationsOf,
    wordHit: wordHit,
    buildIndex: buildIndex,
    search: search,
    searchSplit: searchSplit,
    hitsLabel: hitsLabel,
    relatedTitle: relatedTitle,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.CinePROSearch = API;

})(typeof window !== 'undefined' ? window : globalThis);
