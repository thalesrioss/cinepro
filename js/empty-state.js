// =============================================================
//  CinePRO — Estado vazio da lista de efeitos (BL-0004)
//
//  Uma função só decide o que a lista mostra quando não há nada:
//  busca sem resultado tem estado próprio (com "Limpar busca");
//  Favoritos/Recentes/Mais usados vazios e o estado inicial nunca
//  oferecem "Limpar busca", porque não há busca para limpar.
//
//  emptyStateFor(categoria, termo) → { html, clearSearch }
//    html        — texto do .state-desc (termo já escapado)
//    clearSearch — true quando o botão "Limpar busca" deve aparecer
// =============================================================

(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function emptyStateFor(category, query) {
    var q = String(query == null ? '' : query).trim();
    if (q) {
      return {
        html: 'Nada para "' + escapeHtml(q) + '".<br>Tente em inglês ou escolha uma categoria.',
        clearSearch: true
      };
    }
    if (category === 'favorites') {
      return { html: 'Você ainda não favoritou nada.<br>Passe o mouse num card e clique na ⭐ pra começar.', clearSearch: false };
    }
    if (category === 'recents') {
      return { html: 'Nenhum efeito usado ainda.<br>Os que você aplicar vão aparecer aqui em ordem.', clearSearch: false };
    }
    if (category === 'most-used') {
      return { html: 'Nenhum efeito usado ainda.<br>O top dos seus mais usados vai surgir aqui.', clearSearch: false };
    }
    if (!category || category === 'all') {
      return { html: 'Clique numa categoria pra começar.<br>Os arquivos são carregados sob demanda.', clearSearch: false };
    }
    return { html: 'Nenhum efeito nesta categoria ainda.', clearSearch: false };
  }

  var API = { emptyStateFor: emptyStateFor, escapeHtml: escapeHtml };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.CinePROEmptyState = API;

})(typeof window !== 'undefined' ? window : globalThis);
