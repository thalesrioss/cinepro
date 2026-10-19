// =============================================================
//  CinePRO — Estado do catálogo (BL-0010)
//
//  Decide em que modo a biblioteca abriu e o que o editor lê na
//  barra de status. Três modos:
//   - full     manifest carregou: acervo completo, ponto verde.
//   - reduced  manifest falhou, Drive respondeu: navegação lenta e
//              parcial, ponto amarelo e "Tentar de novo".
//   - offline  nada respondeu: ponto vermelho e "Tentar de novo".
//
//  Sem DOM aqui: main.js passa as etapas (manifest, Drive) e pinta
//  o resultado. Assim dá para testar em node (tools/test-catalog-status.js).
// =============================================================

(function (global) {
  'use strict';

  var TEXT = {
    loading: 'Carregando biblioteca...',
    reduced: 'Biblioteca em modo reduzido (sem conexão com o acervo completo)',
    offline: 'Sem conexão com a biblioteca.',
    offlineHint: 'Confira a internet e toque em "Tentar de novo".',
    retry: 'Tentar de novo',
    sidebarOffline: 'As categorias aparecem quando a conexão voltar.',
  };

  /**
   * Roda as etapas em ordem: manifest → (falhou) Drive → (falhou) offline.
   *  steps.manifest()        → Promise<manifest|null>
   *  steps.applyManifest(m)  → número de efeitos aplicados
   *  steps.drive()           → Promise (rejeita se o Drive falhar)
   * Resolve sempre (nunca rejeita) com { mode, count, builtAt, error }.
   */
  function load(steps) {
    function viaDrive(reason) {
      return Promise.resolve()
        .then(function () { return steps.drive(); })
        .then(function () { return { mode: 'reduced', count: 0, builtAt: null, error: reason || null }; })
        .catch(function (err) { return { mode: 'offline', count: 0, builtAt: null, error: err }; });
    }
    return Promise.resolve()
      .then(function () { return steps.manifest(); })
      .then(function (m) {
        if (!m) return viaDrive(null);
        var count = steps.applyManifest(m);
        return { mode: 'full', count: count, builtAt: m.builtAt || null, error: null };
      })
      .catch(function (err) { return viaDrive(err); });
  }

  /**
   * O que mostrar para um resultado de load().
   * → { dot: 'ok'|'warn'|'error', text, retry: bool, empty: string|null }
   * `empty` é a mensagem da grade quando não há nada para mostrar.
   */
  function describe(result, now) {
    if (result.mode === 'full') {
      var text = result.count + ' efeitos prontos';
      var built = result.builtAt ? new Date(result.builtAt).getTime() : NaN;
      if (!isNaN(built)) {
        var hours = Math.max(0, Math.round(((now || Date.now()) - built) / 3600000));
        text += ' (manifest ' + hours + 'h atrás)';
      }
      return { dot: 'ok', text: text, retry: false, empty: null };
    }
    if (result.mode === 'reduced') {
      return { dot: 'warn', text: TEXT.reduced, retry: true, empty: null };
    }
    return {
      dot: 'error',
      text: TEXT.offline,
      retry: true,
      empty: TEXT.offline + '<br>' + TEXT.offlineHint,
    };
  }

  var API = { load: load, describe: describe, TEXT: TEXT };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.CinePROCatalogStatus = API;

})(typeof window !== 'undefined' ? window : globalThis);
