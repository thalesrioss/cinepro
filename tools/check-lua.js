#!/usr/bin/env node
// =============================================================
//  Checagem estrutural do painel Lua do Resolve.
//
//  POR QUE ISTO EXISTE: não há interpretador Lua nesta máquina, e
//  um `end` faltando só apareceria dentro do DaVinci do usuário —
//  com o painel não abrindo e nenhuma pista no Console. Já
//  aconteceu antes (o painel ficou mudo por um erro de runtime).
//
//  O QUE ELE PEGA: string/comentário longo sem fechar, parêntese
//  ou chave desbalanceada, `end` a mais ou a menos, `function`
//  solta no fim do arquivo.
//
//  O QUE ELE NÃO PEGA: erro de semântica (variável não declarada,
//  método que não existe na API do Resolve). Isso só o Resolve
//  responde — por isso o painel roda autoTesteDiag() ao abrir.
//
//  Uso:  node tools/check-lua.js [arquivo.lua]
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const ALVO = process.argv[2] ||
  path.join(__dirname, '..', 'desktop-app', 'resolve', 'CinePRO.lua');

const src = fs.readFileSync(ALVO, 'utf8');

// Palavras que abrem bloco. `function`, `if`...`then`, `do`, `for`,
// `while` fecham com `end`; `repeat` fecha com `until`.
const ABRE = new Set(['function', 'if', 'do', 'while', 'for']);

const erros = [];
const tokens = [];

let i = 0;
let linha = 1;

function linhaDe(pos) {
  let n = 1;
  for (let k = 0; k < pos && k < src.length; k++) if (src[k] === '\n') n++;
  return n;
}

/** `[[ ]]`, `[=[ ]=]` — usado em string longa E em comentário longo. */
function colcheteLongo(pos) {
  if (src[pos] !== '[') return null;
  let k = pos + 1, iguais = 0;
  while (src[k] === '=') { iguais++; k++; }
  if (src[k] !== '[') return null;
  const fecha = ']' + '='.repeat(iguais) + ']';
  const fim = src.indexOf(fecha, k + 1);
  if (fim === -1) return { erro: true, inicio: pos };
  return { fim: fim + fecha.length };
}

while (i < src.length) {
  const c = src[i];

  // Comentário
  if (c === '-' && src[i + 1] === '-') {
    const longo = colcheteLongo(i + 2);
    if (longo) {
      if (longo.erro) {
        erros.push(`linha ${linhaDe(i)}: comentário longo sem fechar`);
        break;
      }
      i = longo.fim;
      continue;
    }
    while (i < src.length && src[i] !== '\n') i++;
    continue;
  }

  // String longa
  if (c === '[') {
    const longo = colcheteLongo(i);
    if (longo) {
      if (longo.erro) {
        erros.push(`linha ${linhaDe(i)}: string longa [[…]] sem fechar`);
        break;
      }
      i = longo.fim;
      continue;
    }
  }

  // String curta
  if (c === '"' || c === "'") {
    const abriu = i;
    i++;
    let fechou = false;
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '\n') break;         // Lua não aceita quebra crua
      if (src[i] === c) { fechou = true; i++; break; }
      i++;
    }
    if (!fechou) {
      erros.push(`linha ${linhaDe(abriu)}: string sem fechar`);
      break;
    }
    continue;
  }

  // Identificador / palavra-chave
  if (/[A-Za-z_]/.test(c)) {
    let k = i;
    while (k < src.length && /[A-Za-z0-9_]/.test(src[k])) k++;
    tokens.push({ txt: src.slice(i, k), pos: i });
    i = k;
    continue;
  }

  if ('()[]{}'.includes(c)) tokens.push({ txt: c, pos: i });
  i++;
}

if (!erros.length) {
  // ── Balanço de blocos ──
  const pilha = [];
  let par = 0, chave = 0, colch = 0;

  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n].txt;

    if (t === '(') par++;
    else if (t === ')') { par--; if (par < 0) { erros.push(`linha ${linhaDe(tokens[n].pos)}: ')' sobrando`); par = 0; } }
    else if (t === '{') chave++;
    else if (t === '}') { chave--; if (chave < 0) { erros.push(`linha ${linhaDe(tokens[n].pos)}: '}' sobrando`); chave = 0; } }
    else if (t === '[') colch++;
    else if (t === ']') { colch--; if (colch < 0) { erros.push(`linha ${linhaDe(tokens[n].pos)}: ']' sobrando`); colch = 0; } }

    // `elseif` fecha o `then` anterior e abre outro — não mexe na pilha.
    else if (t === 'elseif' || t === 'else' || t === 'then') continue;
    else if (t === 'repeat') pilha.push({ tipo: 'repeat', pos: tokens[n].pos });
    else if (t === 'until') {
      const topo = pilha.pop();
      if (!topo || topo.tipo !== 'repeat') {
        erros.push(`linha ${linhaDe(tokens[n].pos)}: 'until' sem 'repeat'`);
      }
    } else if (ABRE.has(t)) {
      // `for`/`while` são seguidos por um `do` que abriria de novo.
      // Contamos só o `do` — assim o par é sempre do…end / function…end.
      if (t === 'for' || t === 'while') continue;
      pilha.push({ tipo: t, pos: tokens[n].pos });
    } else if (t === 'end') {
      const topo = pilha.pop();
      if (!topo) erros.push(`linha ${linhaDe(tokens[n].pos)}: 'end' sem bloco aberto`);
    }
  }

  if (par !== 0) erros.push(`${par} parêntese(s) sem fechar`);
  if (chave !== 0) erros.push(`${chave} chave(s) '{' sem fechar`);
  if (colch !== 0) erros.push(`${colch} colchete(s) '[' sem fechar`);
  for (const b of pilha) {
    erros.push(`linha ${linhaDe(b.pos)}: '${b.tipo}' sem 'end'`);
  }
}

const nome = path.basename(ALVO);
if (erros.length) {
  console.error(`✗ ${nome}`);
  for (const e of erros) console.error('  ' + e);
  process.exit(1);
}

const linhas = src.split('\n').length;
console.log(`✓ ${nome} — ${linhas} linhas, blocos balanceados, nenhuma string aberta`);
console.log('  (checagem estrutural; a semântica quem responde é o Resolve)');
