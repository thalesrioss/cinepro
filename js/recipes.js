// =============================================================
//  CinePRO — Receitas de Packs (gerado de knowledge/receitas/generos.md)
//
//  Cada receita = pesos sobre os conceitos do manifest. O plugin ranqueia
//  a biblioteca: score(arquivo) = Σ peso[conceito] × embed[conceito].
//  Fundamentos psicoacústicos: knowledge/som-e-mente.md.
//  Se mudar os pesos aqui, atualize o MD (fonte editorial) e vice-versa.
// =============================================================

(function (global) {
  'use strict';

  global.CINEPRO_RECIPES = [
    {
      id: 'trailer', label: 'Trailer Cinematográfico', icon: '🎬',
      desc: 'Risers que resolvem em impacto. Sub-grave pra escala.',
      weights: { impact: 3, riser: 3, deep: 2, epic: 2, whoosh: 2, tense: 1, drone: 1 },
    },
    {
      id: 'terror', label: 'Terror / Suspense', icon: '🕯',
      desc: 'Cama de drone + silêncio antes do susto.',
      weights: { horror: 3, tense: 3, drone: 2, impact: 1, glass: 1, 'horror-creature': 1 },
    },
    {
      id: 'vlog', label: 'Vlog Dinâmico', icon: '📹',
      desc: 'Whoosh na virada de assunto, leveza no resto.',
      weights: { whoosh: 3, happy: 2, transition: 2, ui: 1, fast: 1 },
    },
    {
      id: 'reels', label: 'Reels / TikTok', icon: '⚡',
      desc: 'Hook sonoro no segundo 0. Reset de atenção a cada 3-5s.',
      weights: { impact: 2, whoosh: 2, glitch: 2, riser: 2, ui: 1, fast: 1 },
    },
    {
      id: 'gaming', label: 'Gaming / Highlights', icon: '🎮',
      desc: 'Impactos exagerados, risers de clutch, UI de score.',
      weights: { impact: 3, glitch: 2, riser: 2, ui: 2, fast: 1, 'sci-fi': 1 },
    },
    {
      id: 'tutorial', label: 'Tutorial / Educacional', icon: '🎓',
      desc: 'O som serve a voz. Pontuação discreta, nunca por cima da fala.',
      weights: { ui: 3, whoosh: 2, transition: 1, gentle: 1, minimal: 1 },
    },
    {
      id: 'corporativo', label: 'Corporativo', icon: '💼',
      desc: 'Autoridade sem drama. Transições suaves, zero glitch.',
      weights: { gentle: 2, modern: 2, whoosh: 2, transition: 1, minimal: 1 },
    },
    {
      id: 'documentario', label: 'Documentário / Emocional', icon: '🎞',
      desc: 'A emoção vem do espaço, não do hit. Camas longas.',
      weights: { drone: 3, sad: 2, gentle: 2, nature: 1, deep: 1, epic: 1 },
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
