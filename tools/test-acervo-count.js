#!/usr/bin/env node
// BL-0038: um número só para o tamanho do acervo. O app lê
// manifest.counts.total e mostra arredondado para baixo ("11.000+"); o
// fallback do app e todos os números da LP batem com o manifest do
// repositório. Rodar: node tools/test-acervo-count.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const acervo = require('../desktop-app/renderer/js/acervo-count.js');

let ok = 0, fail = 0;
function check(name, fn) {
  try { fn(); ok++; console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FALHA ' + name + ': ' + e.message); }
}

check('acervoLabel arredonda para baixo no milhar', () => {
  assert.strictEqual(acervo.acervoLabel(11636), '11.000+');
  assert.strictEqual(acervo.acervoLabel(11999), '11.000+');
  assert.strictEqual(acervo.acervoLabel(11000), '11.000');
  assert.strictEqual(acervo.acervoLabel(12001), '12.000+');
  assert.strictEqual(acervo.acervoLabel(1001), '1.000+');
  assert.strictEqual(acervo.acervoLabel(836), '836');
  assert.strictEqual(acervo.acervoLabel(1234567), '1.234.000+');
});

check('acervoLabel sem total válido usa o fallback', () => {
  const fb = acervo.acervoLabel(acervo.FALLBACK_TOTAL);
  [undefined, null, 0, -5, 'abc', NaN].forEach((v) => {
    assert.strictEqual(acervo.acervoLabel(v), fb, String(v));
  });
});

const manifest = JSON.parse(read('manifest/dist/manifest.json'));
const total = manifest.counts && manifest.counts.total;
const label = acervo.acervoLabel(total);

check('manifest do repositório tem counts.total', () => {
  assert.ok(Number.isInteger(total) && total > 0, 'counts.total=' + total);
});

check('FALLBACK_TOTAL bate com manifest.counts.total', () => {
  assert.strictEqual(acervo.FALLBACK_TOTAL, total,
    'atualize FALLBACK_TOTAL em desktop-app/renderer/js/acervo-count.js');
});

// fillAcervoTotal com um DOM mínimo.
check('fillAcervoTotal preenche texto e placeholder', () => {
  const span = { textContent: 'x' };
  const attrs = { 'data-acervo-placeholder': 'Buscar em {n} efeitos…', placeholder: 'velho' };
  const input = {
    getAttribute: (k) => attrs[k],
    setAttribute: (k, v) => { attrs[k] = v; },
  };
  const fakeRoot = {
    querySelectorAll: (sel) => sel === '.acervo-total' ? [span]
      : sel === '[data-acervo-placeholder]' ? [input] : [],
  };
  assert.strictEqual(acervo.fillAcervoTotal(fakeRoot, 12500), '12.000+');
  assert.strictEqual(span.textContent, '12.000+');
  assert.strictEqual(attrs.placeholder, 'Buscar em 12.000+ efeitos…');
});

// Números de acervo escritos à mão ("12.000", "10.000+", "11.000+").
const NUM = /\b\d{1,3}(?:\.\d{3})+\+?/g;

check('app desktop: nenhum número de acervo diferente do manifest', () => {
  const html = read('desktop-app/renderer/index.html');
  const app = read('desktop-app/renderer/js/app.js');
  assert.ok(!/12\.000|10\.000\+/.test(html + app), 'ainda tem 12.000 ou 10.000+');
  const found = (html.match(NUM) || []).concat(app.match(NUM) || []);
  found.forEach((n) => assert.strictEqual(n, label, 'achado ' + n));
  assert.ok(html.includes('class="acervo-total"'), 'falta .acervo-total no preview');
  assert.ok(html.includes('data-acervo-placeholder="Buscar em {n}'), 'falta placeholder com {n}');
  assert.ok(/acervoLabel\(ACERVO_TOTAL\)/.test(app), 'contagem do preview não usa acervoLabel');
  assert.ok(/ACERVO_TOTAL = m && m\.counts && m\.counts\.total/.test(app), 'app não lê counts.total');
});

check('app desktop carrega acervo-count.js antes do app.js', () => {
  const html = read('desktop-app/renderer/index.html');
  const a = html.indexOf('js/acervo-count.js');
  const b = html.indexOf('js/app.js');
  assert.ok(a > 0 && a < b, 'ordem dos scripts');
});

check('LP: todo número de acervo é ' + label, () => {
  const files = ['landing-page/index.html'].concat(
    fs.readdirSync(path.join(root, 'landing-page/js'))
      .filter((f) => f.endsWith('.js')).map((f) => 'landing-page/js/' + f));
  // Só os "N.000+" de 10 mil para cima falam do acervo inteiro; os das
  // coleções (8.500+...) têm checagem própria abaixo e "~15.000" é de
  // concorrente.
  let n = 0;
  files.forEach((f) => {
    (read(f).match(NUM) || []).forEach((m) => {
      if (!m.endsWith('+') || parseInt(m.replace(/\D/g, ''), 10) < 10000) return;
      n++;
      assert.strictEqual(m, label, f + ': ' + m);
    });
  });
  assert.ok(n > 0, 'nenhum número de acervo na LP (regex quebrou?)');
  assert.ok(!/10\.000\+|12\.000/.test(read('landing-page/index.html')), 'ainda tem 10.000+ ou 12.000');
});

check('LP: card de coleção não promete mais que o manifest', () => {
  const html = read('landing-page/index.html');
  const cards = html.split('class="library-card"').slice(1);
  let n = 0;
  cards.forEach((c) => {
    const cat = (c.match(/library-num">([^<]+)</) || [])[1];
    const num = (c.match(/library-desc">([\d.]+)\+/) || [])[1];
    if (!cat || !num) return;
    const real = manifest.counts.byCategory[cat.trim()];
    assert.ok(Number.isInteger(real), 'coleção fora do manifest: ' + cat);
    assert.ok(parseInt(num.replace(/\./g, ''), 10) <= real, cat + ': ' + num + '+ > ' + real);
    n++;
  });
  assert.ok(n >= 3, 'esperava 3 cards de coleção, achei ' + n);
});

console.log('\n' + ok + ' ok, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
