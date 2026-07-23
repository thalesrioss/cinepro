// =============================================================
//  CinePRO — Configurações
//  Preencha as chaves abaixo antes de distribuir o plugin
// =============================================================

const CINEPRO_CONFIG = {

  // -- Google Drive --
  // Crie um projeto em console.cloud.google.com, habilite a Drive API
  // e gere uma API Key restrita ao domínio do plugin
  GOOGLE_DRIVE_API_KEY: 'AIzaSyDH8LOHaVtJdWXSc3WjxU-z4JyGhrqYu5o',
  GOOGLE_DRIVE_FOLDER_ID: '16nWLu5vz2AB9LjuvwNp3vJP57UHBWfEz',

  // -- Firebase --
  // Crie um projeto em console.firebase.google.com
  // Ative Authentication (Email/Senha) e Firestore Database
  FIREBASE: {
    apiKey: 'AIzaSyAN3Ggu6G4baVygJHWX9XyatfpgeP8rUiE',
    authDomain: 'cinepro-42971.firebaseapp.com',
    projectId: 'cinepro-42971',
    storageBucket: 'cinepro-42971.firebasestorage.app',
    messagingSenderId: '1049378331282',
    appId: '1:1049378331282:web:9874f0bf54cda67aa6e44b',
    measurementId: 'G-DFNKN12C62',
  },

  // -- Ticto --
  // URL da sua página de vendas na Ticto
  TICTO_CHECKOUT_URL: 'https://checkout.ticto.app/O292AD8B4',

  // -- App --
  PLUGIN_VERSION: '1.0.5',

  // -- CDN própria (Cloudflare R2) --
  // Quando preenchido (ex: 'https://cdn.cinepro.app'), downloads tentam a CDN
  // PRIMEIRO e só caem pro Drive se ela falhar. Vazio = só Drive (com failover
  // entre os dois endpoints do Drive). Os arquivos no R2 usam a key {id}.{ext}.
  CDN_BASE: 'https://pub-6ace91bcabf540f0a54bb6850d188ef4.r2.dev',

  // -- Admins (acesso vitalício, ignora assinatura) --
  // Coloque aqui os emails que sempre terão acesso, mesmo sem comprar
  ADMIN_EMAILS: [
    'thales.rioss@gmail.com',
    'marquesfelipe059@gmail.com',
  ],

  // -- Branding de Categorias --
  // Renomeia pastas raiz do Drive pra rótulos branded CinePRO na sidebar.
  // Avaliado em ordem: primeira regex que casar vence. Subpastas NÃO são renomeadas.
  // Os arquivos no Drive ficam intocados — só muda o rótulo no plugin.
  CATEGORY_RENAMES: [
    { match: /ocular|sound\s*lib/i,            to: 'CinePRO Sound Library' },
    { match: /mister\s*horse/i,                to: 'CinePRO Motion' },
    { match: /sfx|sound\s*(effect|design)/i,   to: 'CinePRO Sound Design' },
    { match: /\bfoley\b/i,                     to: 'CinePRO Foley' },
    { match: /music|soundtrack|trilha/i,       to: 'CinePRO Music' },
    { match: /preset|prfpset/i,                to: 'CinePRO Presets' },
    { match: /\blut\b|color\s*grading|look/i,  to: 'CinePRO Looks' },
    { match: /transi/i,                        to: 'CinePRO Transitions' },
    { match: /overlay/i,                       to: 'CinePRO Overlays' },
    { match: /template|mogrt|motion\s*graph/i, to: 'CinePRO Templates' },
    { match: /\bmotion\b|animac/i,             to: 'CinePRO Motion' },
    { match: /visual|vfx|efeito\s*visual/i,    to: 'CinePRO Visual' },
    { match: /^geral$/i,                       to: 'CinePRO Essentials' },
  ],
};
