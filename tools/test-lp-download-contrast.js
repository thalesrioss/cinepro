#!/usr/bin/env node
// BL-0071: o título dos botões "Baixar pra Mac/Windows" da LP tem cor própria
// com contraste >= 4,5:1 contra o fundo do botão (card e estado .is-detected).
// Lê as cores de landing-page/css/tokens.css e lp.css; sem navegador.
// Rodar: node tools/test-lp-download-contrast.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const tokensCss = read('landing-page/css/tokens.css');
const lpCss = read('landing-page/css/lp.css');

const tokens = {};
for (const m of tokensCss.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();

function resolve(v) {
  const m = v.match(/^var\((--[\w-]+)\)$/);
  return m ? resolve(tokens[m[1]]) : v;
}
function color(v) {
  v = resolve(v);
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  throw new Error('cor não reconhecida: ' + v);
}
function over(top, base) {
  const a = top.a;
  return { r: top.r * a + base.r * (1 - a), g: top.g * a + base.g * (1 - a), b: top.b * a + base.b * (1 - a), a: 1 };
}
function lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// Valor de uma propriedade num bloco cujo seletor é exatamente `selector`.
function prop(css, selector, name) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp('(^|\\n)' + esc + '\\s*\\{([^}]*)\\}'));
  if (!block) return null;
  const m = block[2].match(new RegExp('(^|[\\s;])' + name + '\\s*:\\s*([^;]+);'));
  return m ? m[2].replace(/!important/, '').trim() : null;
}

let ok = 0, fail = 0;
function check(name, fn) {
  try { fn(); ok++; console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FALHA ' + name + ': ' + e.message); }
}

check('contrast() bate com valores conhecidos', () => {
  assert.strictEqual(+contrast(color('#FFFFFF'), color('#000000')).toFixed(1), 21);
  assert.strictEqual(+contrast(color('#0000EE'), color('#0E1218')).toFixed(1), 2);
});

const card = color(prop(lpCss, '.signup-download', 'background') || prop(lpCss, '.signup-form,\n.signup-download', 'background'));
const strongColor = prop(lpCss, '.download-btn .download-text strong', 'color');

check('título do botão tem cor própria (não herda o azul de link)', () => {
  assert.ok(strongColor, '.download-btn .download-text strong sem color');
});

check('botão tem cor de texto (a sem cor herda #0000EE)', () => {
  assert.ok(prop(lpCss, '.download-btn', 'color'), '.download-btn sem color');
});

check('contraste >= 4,5:1 no botão comum (fundo do card)', () => {
  const r = contrast(color(strongColor), card);
  assert.ok(r >= 4.5, 'contraste ' + r.toFixed(2));
});

check('contraste >= 4,5:1 no botão .is-detected', () => {
  const bg = over(color(prop(lpCss, '.download-btn.is-detected', 'background')), card);
  const r = contrast(color(strongColor), bg);
  assert.ok(r >= 4.5, 'contraste ' + r.toFixed(2));
});

console.log(`\n${ok} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
