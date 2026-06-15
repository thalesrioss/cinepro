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
  PLUGIN_VERSION: '1.5.3',

  // -- CDN própria (Cloudflare R2) --
  // Quando preenchido (ex: 'https://cdn.cinepro.app'), downloads tentam a CDN
  // PRIMEIRO e só caem pro Drive se ela falhar. Vazio = só Drive.
  CDN_BASE: 'https://pub-6ace91bcabf540f0a54bb6850d188ef4.r2.dev',

  // -- Admins (acesso vitalício, ignora assinatura) --
  // Coloque aqui os emails que sempre terão acesso, mesmo sem comprar
  ADMIN_EMAILS: [
    'thales.rioss@gmail.com',
    'marquesfelipe059@gmail.com',
  ],
};
