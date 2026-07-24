// =============================================================
//  CinePRO — Rebranding de NOMES DE ARQUIVO
//  Fonte única das regras. Usado pelo build-manifest (e testável
//  isolado via `node brand-names.test.js`).
//
//  Princípio: remover a MARCA de terceiro, preservar a DESCRIÇÃO
//  funcional do som. "Metal Impact Heavy 03_Ocular_Utility" vira
//  "Metal Impact Heavy 03" — o editor continua achando pelo que o
//  som É, sem carregar marca de outro produto.
//
//  CUIDADO validado em 2026-07: regra genérica de marca destrói
//  nomes legítimos. "boom" aparece em 51 arquivos como PALAVRA DE
//  SOM (Reverse Boom, StrongRumblingBooms) e não como a marca
//  Boom Library. Por isso toda regra aqui é ancorada (^ ou $) ou
//  exige separador — nunca casa no meio de uma palavra.
// =============================================================

'use strict';

// Linhas de produto da Ocular Sounds que aparecem como sufixo
// "_Ocular_<Linha>". Levantadas do manifest real (1.415 arquivos).
const OCULAR_LINES =
  'Utility|Velocity|Shift|Momentum|Aperture|Mechanica|Foundation|' +
  'Cityscapes(?:\\s*Vol\\s*\\d+)?|PENDULUM(?:_\\d+\\s*bpm)?|The\\s*Provence';

const FILE_BRAND_RULES = [
  // ── Ocular Sounds ──────────────────────────────────────────
  // Sufixo "_Ocular_<Linha>" (com repetição defensiva: existe ao
  // menos 1 arquivo com "_Ocular_Velocity_Ocular_Velocity")
  { rx: new RegExp('[_\\-\\s]*Ocular[_\\-\\s]*(?:' + OCULAR_LINES + ')\\s*$', 'i'), to: '' },
  // "_Ocular_" solto no meio/fim, ou "Ocular Sounds" por extenso
  { rx: /[_\-\s]*Ocular\s*Sounds?[_\-\s]*/ig, to: ' ' },
  { rx: /[_\-\s]+Ocular\s*$/i,                to: '' },
  { rx: /[_\-\s]+Ocular[_\-\s]+/ig,           to: ' ' },

  // ── Marketplaces / outros packs ────────────────────────────
  { rx: /^Motionarray[_\-\s]+/i,     to: '' },
  { rx: /^Floraphonic[_\-\s]+/i,     to: '' },
  { rx: /^Videohive[_\-\s]+/i,       to: '' },
  { rx: /^Envato[_\-\s]+/i,          to: '' },
  { rx: /^Artlist[_\-\s]+/i,         to: '' },
  { rx: /^Epidemic(\s*Sound)?[_\-\s]+/i, to: '' },
  { rx: /^Cinepacks?[_\-\s]+/i,      to: '' },
  { rx: /^Triune(\s*Films?|\s*Digital)?[_\-\s]+/i, to: '' },
  { rx: /^Production\s*Crate[_\-\s]+/i, to: '' },
  { rx: /^Mister\s*Horse[_\-\s]+/i,  to: '' },
  { rx: /^Big\s*Films?[_\-\s]+/i,    to: '' },
  // "Boom Library" só ancorado com a palavra Library — nunca o som "boom"
  { rx: /[_\-\s]*Boom\s*Library[_\-\s]*/ig, to: ' ' },
  { rx: /[_\-\s]*Sound\s*Ideas[_\-\s]*/ig,  to: ' ' },
  // \b protege "Morgan"/"Morgue" — só o token MORG/MORGs isolado sai
  { rx: /[_\-\s]*\bMORGs?\b[_\-\s]*/ig,     to: ' ' },
  { rx: /[_\-\s]*Zapsplat[_\-\s]*/ig,       to: ' ' },
  { rx: /[_\-\s]*Freesound[_\-\s]*/ig,      to: ' ' },

  // ── Ruído de distribuição (URL, copyright, "by fulano") ────
  { rx: /\s*[\(\[]?\s*(?:www\.)?[a-z0-9-]+\.(?:com|net|org|io|br)(?:\.br)?\s*[\)\]]?\s*/ig, to: ' ' },
  { rx: /\s*©.*$/,                    to: '' },
  { rx: /\s*[_\-]\s*copyright.*$/i,   to: '' },
];

// Extensão duplicada que veio do Drive: "Nome.wav.wav" → "Nome"
const DOUBLE_EXT = /(\.(?:wav|mp3|mov|mp4|aiff?|m4a|png|jpe?g))+$/i;

function scrub(n) {
  return n
    .replace(/[_\s]{2,}/g, ' ')      // espaços/underscores repetidos
    .replace(/\s*[-–]\s*$/, '')      // hífen solto no fim
    .replace(/^[\s_\-]+|[\s_\-]+$/g, '')
    .trim();
}

/**
 * Aplica o rebranding no nome (SEM extensão) de um arquivo.
 * Nunca devolve string vazia — se as regras comerem tudo, mantém o
 * nome original (melhor um nome com marca do que um item sem nome).
 *
 * @param {string} rawName    nome já sem a extensão
 * @param {string} [ctxName]  pasta-pai, usada só pra salvar nomes
 *                            inúteis de 1 caractere ("Z" → "Alphabet Z")
 * @returns {string}
 */
function brandFileName(rawName, ctxName) {
  const original = String(rawName || '');
  let n = original.replace(DOUBLE_EXT, '');
  for (const r of FILE_BRAND_RULES) n = n.replace(r.rx, r.to);
  n = scrub(n);

  if (n.length < 2) {
    // Nomes de 1 char ("Z", "9") vêm de packs de alfabeto/números e são
    // inúteis na busca. A pasta-pai dá o contexto que falta.
    const ctx = scrub(brandSubName(ctxName || ''));
    if (ctx && original.trim()) return ctx + ' ' + original.trim();
    return original;
  }
  return n;
}

// ── Subcategorias ────────────────────────────────────────────
// Aparecem como CABEÇALHO DE GRUPO no plugin, então carregam marca
// tão visível quanto o nome do arquivo ("Utility-Ocular-Sounds").
const SUB_RENAMES = [
  { rx: /morgs?\s*pro/i,          to: 'Lower Thirds' },
  { rx: /^morgs?$/i,              to: 'Lower Thirds' },   // pasta solta "MORGs"
  { rx: /cine\s*plus\s*pack/i,    to: 'Essentials' },
  { rx: /after\s*party\s*effect/i, to: 'Party FX' },
];

/**
 * Limpa marca de terceiro do rótulo de subcategoria.
 * "Momentum-Designed-Ocular-Sounds" → "Momentum Designed"
 */
function brandSubName(rawSub) {
  const original = String(rawSub || '');
  if (!original) return original;

  for (const r of SUB_RENAMES) if (r.rx.test(original)) return r.to;

  let n = original
    .replace(/[-_\s]*Ocular[-_\s]*Sounds?[-_\s]*/ig, ' ')
    .replace(/[-_\s]+Ocular[-_\s]*$/i, '')
    // \b garante que "Morgan"/"Morgue" não sejam tocados
    .replace(/[-_\s]*\bMORGs?\b[-_\s]*/ig, ' ');
  for (const r of FILE_BRAND_RULES) n = n.replace(r.rx, r.to);
  n = scrub(n.replace(/[-_]+/g, ' '));

  return n.length >= 2 ? n : original;
}

module.exports = { brandFileName, brandSubName, FILE_BRAND_RULES, SUB_RENAMES };
