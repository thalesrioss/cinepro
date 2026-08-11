#!/usr/bin/env node
// =============================================================
//  O painel do Resolve tem a ÚNICA reimplementação de uma regra
//  nossa: o diagnóstico, portado pra Lua porque não dá pra chamar
//  JS de dentro do Resolve. Duas implementações da mesma regra é
//  exatamente o que a arquitetura evita em todo o resto.
//
//  A defesa é dupla:
//   1. o painel roda autoTesteDiag() ao abrir, no interpretador do
//      Resolve, contra valores fixos;
//   2. ESTE teste lê esses mesmos valores DE DENTRO do .lua e
//      confere com js/diagnostics.js.
//
//  Ou seja: se alguém mexer no motor JS, aqui quebra e diz que o
//  Lua ficou pra trás. Sem isso, o painel do Resolve seguiria
//  dando conselho com a régra antiga e ninguém notaria.
//
//  Uso:  node tools/test-lua-diag-fixture.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'js', 'diagnostics.js'));
const LUA = fs.readFileSync(
  path.join(ROOT, 'desktop-app', 'resolve', 'CinePRO.lua'), 'utf8'
);

let pass = 0, fail = 0;
function t(nome, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + nome); }
    else { fail++; console.log('  ✗ ' + nome + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + nome + '  EXCEÇÃO: ' + e.message); }
}

// ── Extrai o bloco de casos do autoTesteDiag ────────────────
const bloco = LUA.match(/local function autoTesteDiag\(\)([\s\S]*?)\n  local falhas/);
if (!bloco) {
  console.error('✗ não achei autoTesteDiag() no CinePRO.lua — o painel perdeu o auto-teste?');
  process.exit(1);
}
const corpo = bloco[1];

// Os DEFAULTS que o auto-teste usa têm que ser os do motor JS.
const lim = {};
for (const m of corpo.matchAll(/(\w+)\s*=\s*(\d+(?:\.\d+)?)[,\s}]/g)) {
  if (m[1] in D.DEFAULTS) lim[m[1]] = Number(m[2]);
}

// Um regex só não dá conta: `esp` é tabela de tabelas, e qualquer
// `}` não-guloso fecha no primeiro item. Fatiamos por caso primeiro.
const casos = corpo.split(/\{\s*tl\s*=/).slice(1).map((pedaco) => {
  const num = (re) => {
    const m = pedaco.match(re);
    return m ? Number(m[1]) : null;
  };
  const cortes = pedaco.match(/cortes\s*=\s*\{([^}]*)\}/);
  const esp = [];
  // Os pares de `esp` são os únicos {"sev", n, n} do pedaço.
  for (const e of pedaco.matchAll(/\{\s*"(\w+)"\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\}/g)) {
    esp.push({ sev: e[1], at: Number(e[2]), dur: Number(e[3]) });
  }
  const lista = (cortes && cortes[1].trim())
    ? cortes[1].split(',').map((x) => Number(x.trim()))
    : [];
  return {
    cuts: lista,
    duration: num(/\bdur\s*=\s*([\d.]+)/),
    width: num(/\bw\s*=\s*(\d+)/),
    height: num(/\bh\s*=\s*(\d+)/),
    formato: (pedaco.match(/formato\s*=\s*"(\w+)"/) || [])[1],
    total: num(/\btotal\s*=\s*(\d+)/),
    altos: num(/\baltos\s*=\s*(\d+)/),
    pior: num(/\bpior\s*=\s*([\d.]+)/),
    esp,
  };
});

console.log('\n══ FIXTURE DO PAINEL LUA vs MOTOR JS ══');

t('os limites do auto-teste são os DEFAULTS do motor', () => {
  for (const k of Object.keys(D.DEFAULTS)) {
    if (lim[k] !== D.DEFAULTS[k]) {
      return `${k}: lua=${lim[k]} js=${D.DEFAULTS[k]} — atualize autoTesteDiag() no CinePRO.lua`;
    }
  }
  return true;
});

t('o auto-teste tem casos (não virou casca vazia)', () =>
  casos.length >= 3 || `só ${casos.length} caso(s)`);

t('há caso vertical, horizontal e sem achado', () => {
  const temVert = casos.some((c) => c.formato === 'vertical');
  const temHoriz = casos.some((c) => c.formato === 'horizontal');
  const temLimpo = casos.some((c) => c.total === 0);
  return (temVert && temHoriz && temLimpo) ||
    `vertical=${temVert} horizontal=${temHoriz} limpo=${temLimpo}`;
});

casos.forEach((c, n) => {
  const r = D.analyze(
    { cuts: c.cuts, duration: c.duration, width: c.width, height: c.height },
    D.DEFAULTS
  );

  t(`caso ${n + 1}: formato/limite`, () =>
    r.stats.format === c.formato || `js=${r.stats.format} lua=${c.formato}`);

  t(`caso ${n + 1}: total e graves`, () => {
    if (r.stats.total !== c.total) return `total js=${r.stats.total} lua=${c.total}`;
    if (r.stats.high !== c.altos) return `graves js=${r.stats.high} lua=${c.altos}`;
    return true;
  });

  t(`caso ${n + 1}: pior achado`, () =>
    r.stats.worstGap === c.pior || `js=${r.stats.worstGap} lua=${c.pior}`);

  t(`caso ${n + 1}: cada achado (ordem, gravidade, tempo, duração)`, () => {
    if (r.findings.length !== c.esp.length) {
      return `js=${r.findings.length} achados, lua espera ${c.esp.length}`;
    }
    for (let i = 0; i < r.findings.length; i++) {
      const f = r.findings[i], e = c.esp[i];
      if (f.severity !== e.sev || f.at !== e.at || f.duration !== e.dur) {
        return `#${i + 1} js=${f.severity} ${f.at} ${f.duration}s / lua=${e.sev} ${e.at} ${e.dur}s`;
      }
    }
    return true;
  });
});

// ── Guardas do porte que não aparecem no fixture ────────────
console.log('\n══ REGRAS QUE O PORTE PRECISA MANTER ══');

t('o piso do CFG bate com os DEFAULTS do motor', () => {
  // Se o download do lua-config.tsv falhar, o painel roda com estes
  // números. Errados, ele dá conselho errado sem avisar ninguém.
  const m = LUA.match(/local CFG = \{([\s\S]*?)\}/);
  if (!m) return 'CFG sumiu do Lua';
  for (const [k, v] of Object.entries(D.DEFAULTS)) {
    const achado = m[1].match(new RegExp(k + '\\s*=\\s*([\\d.]+)'));
    if (!achado) return `CFG não tem ${k}`;
    if (Number(achado[1]) !== v) return `${k}: piso=${achado[1]} js=${v}`;
  }
  return true;
});

t('as cores de severidade do Lua cobrem o motor', () => {
  const mapa = LUA.match(/local SEV_COR = \{([^}]*)\}/);
  if (!mapa) return 'SEV_COR sumiu do Lua';
  for (const sev of ['high', 'medium', 'low']) {
    if (!new RegExp(sev + '\\s*=').test(mapa[1])) return `falta ${sev}`;
  }
  return true;
});

t('o Lua lê os limites do config, não os fixa no código', () => {
  // Fora do autoTesteDiag, nenhum limite pode estar escrito na mão:
  // a fonte é data/diagnostics.json via lua-config.tsv.
  const semTeste = LUA.replace(/local function autoTesteDiag\(\)[\s\S]*?\n  return falhas\nend/, '');
  const corpoAnalise = semTeste.match(/local function analisarRitmo[\s\S]*?\n^end/m);
  if (!corpoAnalise) return 'analisarRitmo sumiu';
  return !/limit(Vertical|Horizontal)\s*=\s*\d/.test(corpoAnalise[0]) ||
    'limite escrito na mão dentro de analisarRitmo';
});

t('o marcador leva customData cinepro: (pra apagar só os nossos)', () =>
  /"cinepro:" \.\. a\.tipo/.test(LUA) || 'AddMarker sem customData nosso');

t('limparMarcadores cobre os dois tipos de achado', () => {
  const m = LUA.match(/local function limparMarcadores[\s\S]*?\nend/);
  if (!m) return 'limparMarcadores sumiu';
  return (/cinepro:slow-hook/.test(m[0]) && /cinepro:retention-gap/.test(m[0])) ||
    'algum tipo de marcador ficaria órfão na timeline';
});

console.log('\n' + '─'.repeat(52));
console.log((fail ? '✗ ' : '✓ ') + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
