// =============================================================
//  CinePRO — Dicionário de Conceitos
//
//  Cada conceito tem um índice (posição no array) e uma lista de
//  keywords (PT + EN) que disparam match. Builder do manifest
//  computa um vetor sparse por effect: { idx → count }.
//
//  Cliente faz o MESMO embed na query e roda cosine similarity.
//
//  IMPORTANTE: a lógica de match (normalizeConceptText + matchKeys)
//  é exportada daqui e usada IDENTICAMENTE no builder (Node) e no
//  plugin (CEP). Se mudar aqui, o re-embed regenera tudo consistente.
// =============================================================

'use strict';

const CONCEPTS = [
  // [0..7] — Mood
  { name: 'horror',       keys: ['horror','terror','scary','medo','dark','escuro','dread','eerie','ominous','sombrio','assombrado'] },
  { name: 'epic',         keys: ['epic','epico','cinematic','cinematografico','trailer','dramatic','dramatico','hollywood','grandioso','epica'] },
  { name: 'gentle',       keys: ['soft','suave','leve','light','gentle','calm','calmo','smooth','subtle','sutil','tranquilo','delicado'] },
  { name: 'aggressive',   keys: ['heavy','pesado','aggressive','agressivo','intense','intenso','brutal','hard','forte','violento'] },
  { name: 'mystery',      keys: ['mystery','misterio','enigma','strange','estranho','wonder','misterioso'] },
  { name: 'happy',        keys: ['happy','feliz','positive','positivo','upbeat','cheer','alegre','joyful','animado','festa','festivo'] },
  { name: 'sad',          keys: ['sad','triste','melancholic','melancolia','melancolico','emotional','emocional','tear','lagrima','nostalgia'] },
  { name: 'tense',        keys: ['tense','tensao','tension','anxious','ansioso','urgent','urgente','suspense','nervoso','aflito'] },

  // [8..17] — Sound type
  { name: 'whoosh',       keys: ['whoosh','woosh','swoosh','sweep','swish','passagem','passada'] },
  { name: 'impact',       keys: ['impact','impacto','hit','batida','boom','slam','crash','thud','punch','soco','smash','bang','pancada','colisao'] },
  { name: 'riser',        keys: ['riser','rise','build','buildup','climb','crescendo','subida','ascensao'] },
  { name: 'drop',         keys: ['drop','fall','queda','plummet','despencar'] },
  { name: 'transition',   keys: ['transition','transicao','wipe','transicion','virada'] },
  { name: 'glitch',       keys: ['glitch','distorcao','distortion','error','digital','ruido','falha','interferencia'] },
  { name: 'drone',        keys: ['drone','atmosphere','atmosfera','ambient','ambiente','texture','textura','pad'] },
  { name: 'metal',        keys: ['metal','metallic','metalico','iron','ferro','steel','aco'] },
  { name: 'glass',        keys: ['glass','vidro','crystal','cristal','shatter','quebrar','estilhaco'] },
  { name: 'wood',         keys: ['wood','madeira','plank','crack','rachadura'] },

  // [18..27] — Action / context
  { name: 'weapon',       keys: ['gun','weapon','arma','sword','espada','blade','lamina','shoot','tiro','slice','corte','disparo','faca'] },
  { name: 'footstep',     keys: ['footstep','passo','passos','walk','andar','run','correr','pisada'] },
  { name: 'vehicle',      keys: ['car','carro','engine','motor','vehicle','veiculo','dirigir','accelerate','acelerar','brake','freio','moto'] },
  { name: 'nature',       keys: ['nature','natureza','forest','floresta','bird','passaro','passaros','leaf','folha','jungle','selva','outdoor','campo','floresta'] },
  { name: 'crowd',        keys: ['crowd','multidao','applause','aplauso','torcida','people','pessoas','plateia'] },
  { name: 'vocal',        keys: ['scream','grito','voice','voz','laugh','risada','breath','respiracao','vocal','whisper','sussurro','fala'] },
  { name: 'ui',           keys: ['click','clique','type','tecla','keyboard','teclado','mouse','button','botao','beep','blip','notification','notificacao','interruptor','switch'] },
  { name: 'magic',        keys: ['magic','magia','spell','feitico','fairy','fada','sparkle','brilho','shimmer','encanto','magico'] },
  { name: 'sci-fi',       keys: ['scifi','space','espaco','laser','beam','energy','energia','future','futuro','cyber','cyberpunk','robot','robo','alien','espacial','futurista'] },
  { name: 'horror-creature', keys: ['monster','monstro','creature','criatura','zombie','demon','demonio','ghost','fantasma','besta'] },

  // [28..36] — Visual / video
  { name: 'overlay',      keys: ['overlay','overlap','filtro'] },
  { name: 'grain',        keys: ['grain','filme','film','35mm','16mm','8mm','vintage','granulado'] },
  { name: 'lens',         keys: ['lens','lente','flare','bokeh','blur','desfoque','focus','foco'] },
  { name: 'light',        keys: ['light','luz','leak','glow','brilho','sun','sol','sunset','sunrise','poente','iluminacao'] },
  { name: 'lut',          keys: ['lut','look','grade','grading','color','grading','tone','tonalidade','warm','cool','quente','frio','colorizacao'] },
  { name: 'frame',        keys: ['frame','quadro','border','borda','window','janela','mask','mascara','moldura'] },
  { name: 'distortion-fx',keys: ['shake','tremor','distort','warp','vhs','crt','scan','tremido'] },
  { name: 'text-anim',    keys: ['text','texto','title','titulo','typewriter','reveal','animation','animacao','escrita'] },
  { name: 'lower-third',  keys: ['lower','third','label','etiqueta','legenda'] },

  // [37..42] — Tempo / velocidade / tamanho
  { name: 'slow',         keys: ['slow','lento','slowmo','slowmotion','longo','demorado'] },
  { name: 'fast',         keys: ['fast','rapido','quick','rapida','short','curto','snap','veloz'] },
  { name: 'small',        keys: ['small','pequeno','tiny','mini','micro','pequena'] },
  { name: 'big',          keys: ['big','grande','huge','enorme','massive','large','giant','gigante','grandao'] },
  { name: 'deep',         keys: ['deep','profundo','grave','sub','bass','baixo','profunda'] },
  { name: 'high',         keys: ['high','alto','treble','agudo','sharp','aguda'] },

  // [43..46] — Estilo de produção
  { name: 'modern',       keys: ['modern','moderno','contemporary','contemporaneo','atual'] },
  { name: 'vintage',      keys: ['retro','old','antigo','classic','classico','velho'] },
  { name: 'minimal',      keys: ['minimal','minimalist','minimalista','clean','limpo','simple','simples'] },
  { name: 'dramatic',     keys: ['drama','dramatico','dramatica','comovente'] },

  // [47..51] — Natureza fina (split do antigo 'nature' p/ chuva≠fogo≠vento)
  { name: 'rain',         keys: ['rain','chuva','drizzle','garoa','droplet','gota','gotas','chuvoso','tempestade-chuva'] },
  { name: 'wind',         keys: ['wind','vento','breeze','brisa','gust','rajada','ventania','ar','aragem'] },
  { name: 'thunder',      keys: ['thunder','trovao','lightning','raio','relampago','storm','tempestade','trovoada'] },
  { name: 'fire',         keys: ['fire','fogo','flame','chama','burn','queimar','blaze','fogos','fogueira','incendio','queimada'] },
  { name: 'water',        keys: ['water','agua','splash','respingo','wave','onda','ondas','bubble','bolha','liquid','liquido','rio','mar','oceano'] },
];

// ── Matching compartilhado (builder + plugin DEVEM usar isto idêntico) ──

// Remove acentos/diacríticos e baixa caixa. "Épico" → "epico", "Transição" → "transicao".
function normalizeConceptText(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Conta quantas keys de um conceito casam com o texto normalizado.
// Matching POR TOKEN (palavra), não substring cru — mata falsos positivos
// clássicos: "rain" NÃO casa "train", "cut" NÃO casa "executar".
//   - key composta (com espaço/hífen): substring na string toda.
//   - senão: casa se algum token do texto for == key, OU (key>=4) o token
//     COMEÇAR com a key (morfologia: "epico" startsWith "epic" ✓;
//     "train" NÃO startsWith "rain" ✓).
// `tokens` é um array de palavras normalizadas do texto.
function matchKeys(normText, tokens, keys) {
  var count = 0;
  for (var k = 0; k < keys.length; k++) {
    var nk = normalizeConceptText(keys[k]);
    if (!nk) continue;
    if (nk.indexOf(' ') !== -1 || nk.indexOf('-') !== -1) {
      if (normText.indexOf(nk) !== -1) count++;
      continue;
    }
    var matched = false;
    for (var t = 0; t < tokens.length; t++) {
      var tok = tokens[t];
      if (tok === nk || (nk.length >= 4 && tok.length > nk.length && tok.indexOf(nk) === 0)) {
        matched = true;
        break;
      }
    }
    if (matched) count++;
  }
  return count;
}

// Tokeniza texto normalizado em array de palavras (>=2 chars).
function tokenizeNorm(normText) {
  var out = [];
  var toks = normText.split(/[^a-z0-9]+/);
  for (var i = 0; i < toks.length; i++) {
    if (toks[i] && toks[i].length >= 2) out.push(toks[i]);
  }
  return out;
}

// Computa embed sparse { conceptIdx → count } pra um blob de texto.
function computeEmbedFromText(blob) {
  var normText = normalizeConceptText(blob);
  var tokenSet = tokenizeNorm(normText);
  var out = {};
  for (var i = 0; i < CONCEPTS.length; i++) {
    var c = matchKeys(normText, tokenSet, CONCEPTS[i].keys);
    if (c > 0) out[i] = c;
  }
  return out;
}

var CONCEPT_API = {
  CONCEPTS: CONCEPTS,
  normalizeConceptText: normalizeConceptText,
  matchKeys: matchKeys,
  tokenizeNorm: tokenizeNorm,
  computeEmbedFromText: computeEmbedFromText,
};

// Node (builder / reembed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONCEPT_API;
  // retrocompat: alguns scripts faziam `require('./concepts.js')` esperando o array
  module.exports.default = CONCEPTS;
}
// Global pro plugin (browser/CEP)
if (typeof globalThis !== 'undefined') {
  globalThis.CINEPRO_CONCEPTS = CONCEPTS;
  globalThis.CINEPRO_CONCEPT_API = CONCEPT_API;
}
