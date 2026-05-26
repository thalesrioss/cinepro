// =============================================================
//  CinePRO Landing Page — Signup + Download
// =============================================================

// URLs estáveis — apontam sempre pro release mais recente (sem versão no nome)
var DOWNLOADS = {
  mac:     'https://github.com/thalesrioss/cinepro/releases/latest/download/CinePRO.pkg',
  windows: 'https://github.com/thalesrioss/cinepro/releases/latest/download/CinePRO-Setup.exe',
};

var auth = null;

document.addEventListener('DOMContentLoaded', function () {
  initFirebase();
  setupDownloads();
  setupSignupForm();
  document.getElementById('year').textContent = new Date().getFullYear();
});

// ──────── Firebase ────────

function initFirebase() {
  try {
    if (typeof firebase === 'undefined') {
      console.warn('[CinePRO LP] Firebase SDK não carregou');
      return;
    }
    firebase.initializeApp(CINEPRO_CONFIG.FIREBASE);
    auth = firebase.auth();
  } catch (e) {
    console.error('[CinePRO LP] init Firebase falhou:', e);
  }
}

// ──────── OS Detection + Download URLs ────────

function setupDownloads() {
  var ua = navigator.userAgent;
  var os = 'mac';  // padrão otimista

  if (/Mac|iPhone|iPad/.test(ua) || (navigator.platform || '').indexOf('Mac') !== -1) {
    os = 'mac';
  } else if (/Win/.test(ua) || /Windows/.test(ua)) {
    os = 'windows';
  } else if (/Linux/.test(ua)) {
    os = 'linux';
  }

  // Atualiza texto de detecção
  var osLabel = document.getElementById('os-detect');
  if (osLabel) {
    osLabel.textContent = os === 'mac' ? '🍎 Você está no macOS'
                       : os === 'windows' ? '🪟 Você está no Windows'
                       : '💻 Disponível pra Mac e Windows';
  }

  // Atribui URLs reais nos botões
  var macBtn = document.getElementById('btn-download-mac');
  var winBtn = document.getElementById('btn-download-win');
  if (macBtn) macBtn.href = DOWNLOADS.mac;
  if (winBtn) winBtn.href = DOWNLOADS.windows;

  // Destaca o botão do SO detectado
  if (os === 'mac' && macBtn) {
    macBtn.classList.add('is-detected');
  } else if (os === 'windows' && winBtn) {
    winBtn.classList.add('is-detected');
  }
}

// ──────── Signup form ────────

function setupSignupForm() {
  var form    = document.getElementById('signup-form');
  var skipBtn = document.getElementById('signup-skip');
  var dlBlock = document.getElementById('signup-download');

  if (!form) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    doSignup();
  });

  skipBtn.addEventListener('click', function (e) {
    e.preventDefault();
    revealDownloads('Bom retorno! Baixa agora →');
  });
}

function doSignup() {
  var email   = document.getElementById('signup-email').value.trim().toLowerCase();
  var pass    = document.getElementById('signup-password').value;
  var err     = document.getElementById('signup-error');
  var success = document.getElementById('signup-success');
  var btn     = document.getElementById('signup-submit');

  err.textContent = '';
  err.classList.remove('visible');
  success.classList.remove('visible');

  if (!email || !pass || pass.length < 6) {
    err.textContent = 'Preencha email válido e senha de pelo menos 6 caracteres.';
    err.classList.add('visible');
    return;
  }
  if (!auth) {
    // Sem Firebase, segue direto pro download (degrada bem)
    revealDownloads('Pronto! Baixa o instalador agora →');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Criando conta...';

  auth.createUserWithEmailAndPassword(email, pass)
    .then(function (cred) {
      // Sucesso — conta criada
      revealDownloads('Conta criada! Use ' + email + ' pra logar no app.');
    })
    .catch(function (e) {
      var code = e.code || '';
      if (code === 'auth/email-already-in-use') {
        // Usuário já existe — tentar login pra validar a senha
        return auth.signInWithEmailAndPassword(email, pass)
          .then(function () {
            revealDownloads('Bem-vindo de volta! Baixa o instalador →');
          })
          .catch(function () {
            err.textContent = 'Esse email já tem conta. Use a senha original ou outro email.';
            err.classList.add('visible');
            btn.disabled = false;
            btn.textContent = 'Criar conta';
          });
      }
      if (code === 'auth/invalid-email') err.textContent = 'Email inválido.';
      else if (code === 'auth/weak-password') err.textContent = 'Senha muito fraca. Use ao menos 6 caracteres.';
      else err.textContent = e.message || 'Falha ao criar conta. Tente de novo.';
      err.classList.add('visible');
      btn.disabled = false;
      btn.textContent = 'Criar conta';
    });
}

function revealDownloads(message) {
  var success = document.getElementById('signup-success');
  var dlBlock = document.getElementById('signup-download');
  var form    = document.getElementById('signup-form');

  success.textContent = '✓ ' + message;
  success.classList.add('visible');

  dlBlock.classList.add('unlocked');

  // Scroll suave pra o bloco de download
  setTimeout(function () {
    dlBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 200);
}
