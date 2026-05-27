// =============================================================
//  CinePRO — Dicionário de Conceitos
//
//  Cada conceito tem um índice (posição no array) e uma lista de
//  keywords (PT + EN) que disparam match. Builder do manifest
//  computa um vetor sparse por effect: { idx → count }.
//
//  Cliente faz o mesmo embed na query e roda cosine similarity.
// =============================================================

'use strict';

const CONCEPTS = [
  // [0..9] — Mood
  { name: 'horror',       keys: ['horror','terror','scary','medo','dark','escuro','dread','eerie','ominous','suspense'] },
  { name: 'epic',         keys: ['epic','epico','cinematic','cinematografico','trailer','dramatic','dramatico','hollywood'] },
  { name: 'gentle',       keys: ['soft','suave','leve','light','gentle','calm','calmo','smooth','subtle','sutil'] },
  { name: 'aggressive',   keys: ['heavy','pesado','aggressive','agressivo','intense','intenso','brutal','hard','forte'] },
  { name: 'mystery',      keys: ['mystery','misterio','enigma','strange','estranho','wonder'] },
  { name: 'happy',        keys: ['happy','feliz','positive','positivo','upbeat','cheer','alegre','joyful'] },
  { name: 'sad',          keys: ['sad','triste','melancholic','melancolia','emotional','emocional','tear'] },
  { name: 'tense',        keys: ['tense','tensao','tension','anxious','ansioso','urgent','urgente'] },

  // [10..19] — Sound type
  { name: 'whoosh',       keys: ['whoosh','woosh','swoosh','sweep','wind','vento','air','aero','swish'] },
  { name: 'impact',       keys: ['impact','impacto','hit','batida','boom','slam','crash','thud','punch','soco','smash','bang'] },
  { name: 'riser',        keys: ['riser','rise','build','buildup','climb','crescendo'] },
  { name: 'drop',         keys: ['drop','fall','queda','plummet'] },
  { name: 'transition',   keys: ['transition','transicao','passagem','wipe','transicion'] },
  { name: 'glitch',       keys: ['glitch','distorcao','distortion','error','digital','noise','ruido'] },
  { name: 'drone',        keys: ['drone','atmosphere','atmosfera','ambient','ambiente','bed','pad','texture','textura'] },
  { name: 'metal',        keys: ['metal','metallic','metalico','iron','ferro','steel','aco'] },
  { name: 'glass',        keys: ['glass','vidro','crystal','cristal','shatter','quebrar'] },
  { name: 'wood',         keys: ['wood','madeira','plank','crack'] },

  // [20..29] — Action / context
  { name: 'weapon',       keys: ['gun','weapon','arma','sword','espada','blade','lamina','shoot','tiro','slice','cut','corte'] },
  { name: 'footstep',     keys: ['footstep','step','passo','walk','andar','run','correr','foot'] },
  { name: 'vehicle',      keys: ['car','carro','engine','motor','vehicle','veiculo','drive','dirigir','accelerate','acelerar','brake'] },
  { name: 'nature',       keys: ['nature','natureza','wind','vento','rain','chuva','water','agua','thunder','trovao','storm','tempestade','fire','fogo'] },
  { name: 'crowd',        keys: ['crowd','multidao','applause','aplauso','cheer','torcida','people','pessoas'] },
  { name: 'vocal',        keys: ['scream','grito','voice','voz','laugh','risada','breath','respiracao','vocal','whisper','sussurro'] },
  { name: 'ui',           keys: ['click','clique','type','tecla','keyboard','teclado','mouse','button','botao','beep','blip','notification','notificacao','interruptor','switch'] },
  { name: 'magic',        keys: ['magic','magia','spell','feitico','fairy','fada','sparkle','brilho','shimmer'] },
  { name: 'sci-fi',       keys: ['sci','scifi','space','espaco','laser','beam','energy','energia','future','futuro','tech','cyber','cyberpunk','robot','robo','alien'] },
  { name: 'horror-creature', keys: ['monster','monstro','creature','criatura','zombie','demon','ghost','fantasma'] },

  // [30..39] — Visual / video
  { name: 'overlay',      keys: ['overlay','overlap','filter','filtro'] },
  { name: 'grain',        keys: ['grain','noise','filme','film','35mm','16mm','8mm','vintage'] },
  { name: 'lens',         keys: ['lens','lente','flare','glow','bokeh','blur','desfoque','focus'] },
  { name: 'light',        keys: ['light','luz','leak','glow','brilho','sun','sol','sunset','sunrise'] },
  { name: 'lut',          keys: ['lut','look','grade','grading','color','cor','cinematic','tone','tonalidade','warm','cool','quente','frio'] },
  { name: 'frame',        keys: ['frame','quadro','border','borda','window','janela','mask','mascara'] },
  { name: 'distortion-fx',keys: ['shake','tremor','distort','warp','glitch','vhs','crt','scan'] },
  { name: 'text-anim',    keys: ['text','texto','title','titulo','typewriter','reveal','animation','animacao'] },
  { name: 'lower-third',  keys: ['lower','third','name','nome','label','tag'] },

  // [40..49] — Tempo / velocidade / tamanho
  { name: 'slow',         keys: ['slow','lento','slowmo','slowmotion','long','longo'] },
  { name: 'fast',         keys: ['fast','rapido','quick','rapida','short','curto','snap'] },
  { name: 'small',        keys: ['small','pequeno','tiny','mini','micro'] },
  { name: 'big',          keys: ['big','grande','huge','enorme','massive','large','giant','gigante'] },
  { name: 'deep',         keys: ['deep','profundo','low','grave','sub','bass','baixo'] },
  { name: 'high',         keys: ['high','alto','treble','agudo','sharp','agudo'] },

  // [46..49] — Estilo de produção
  { name: 'modern',       keys: ['modern','moderno','contemporary'] },
  { name: 'vintage',      keys: ['vintage','retro','old','antigo','classic','classico'] },
  { name: 'minimal',      keys: ['minimal','minimalist','clean','limpo','simple','simples'] },
  { name: 'dramatic',     keys: ['dramatic','drama','intense','intenso','emotional','emocional'] },
];

// Exporta como JSON-ready se require'd no Node (builder).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONCEPTS;
}
// E também global pro plugin (browser/CEP) caso seja carregado direto via <script>
if (typeof globalThis !== 'undefined') {
  globalThis.CINEPRO_CONCEPTS = CONCEPTS;
}
