// =============================================================
//  CinePRO — Tamanho do acervo em um número só (BL-0038)
//
//  O app e a LP diziam números diferentes para o mesmo acervo. Agora o
//  número vem de `manifest.counts.total`,
//  arredondado para baixo no milhar ("11.636" → "11.000+").
//
//  FALLBACK_TOTAL é o total do manifest do repositório, usado antes do
//  manifest carregar (não assinante não baixa o manifest). O teste
//  tools/test-acervo-count.js confere que ele bate com
//  manifest/dist/manifest.json e que app e LP usam o mesmo rótulo.
// =============================================================
(function (global) {
  'use strict';

  var FALLBACK_TOTAL = 11636;

  // 11636 → "11.000+"; 11000 → "11.000"; 836 → "836".
  function acervoLabel(total) {
    var n = Math.floor(Number(total));
    if (!isFinite(n) || n <= 0) n = FALLBACK_TOTAL;
    if (n < 1000) return String(n);
    var mil = Math.floor(n / 1000);
    var milStr = String(mil).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return milStr + '.000' + (n % 1000 ? '+' : '');
  }

  // Preenche `.acervo-total` com o rótulo e o placeholder dos inputs com
  // `data-acervo-placeholder` (o "{n}" vira o rótulo).
  function fillAcervoTotal(root, total) {
    var label = acervoLabel(total);
    root.querySelectorAll('.acervo-total').forEach(function (el) {
      el.textContent = label;
    });
    root.querySelectorAll('[data-acervo-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', el.getAttribute('data-acervo-placeholder').replace('{n}', label));
    });
    return label;
  }

  var API = {
    FALLBACK_TOTAL: FALLBACK_TOTAL,
    acervoLabel: acervoLabel,
    fillAcervoTotal: fillAcervoTotal,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.CinePROAcervo = API;

})(typeof window !== 'undefined' ? window : globalThis);
