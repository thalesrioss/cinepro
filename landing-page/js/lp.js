// =============================================================
//  CinePRO Landing Page — Signup + Download
//  Download BLOQUEADO até signup/login com sucesso no Firebase.
// =============================================================

// URLs estáveis — apontam sempre pro release mais recente
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

// ──────── OS Detection ────────

function setupDownloads() {
  var ua = navigator.userAgent;
  var os = 'mac';

  if (/Mac|iPhone|iPad/.test(ua) || (navigator.platform || '').indexOf('Mac') !== -1) {
    os = 'mac';
  } else if (/Win/.test(ua) || /Windows/.test(ua)) {
    os = 'windows';
  } else if (/Linux/.test(ua)) {
    os = 'linux';
  }

  var osLabel = document.getElementById('os-detect');
  if (osLabel) {
    osLabel.textContent = os === 'mac'     ? '🍎 Você está no macOS'
                       : os === 'windows'  ? '🪟 Você está no Windows'
                       :                     '💻 Disponível pra Mac e Windows';
  }

  var macBtn = document.getElementById('btn-download-mac');
  var winBtn = document.getElementById('btn-download-win');

  // URLs ficam SEM href até o signup (segurança extra)
  // Setamos só depois que unlock é disparado em revealDownloads()
  if (os === 'mac' && macBtn) macBtn.classList.add('is-detected');
  else if (os === 'windows' && winBtn) winBtn.classList.add('is-detected');
}

// ──────── Signup form ────────

function setupSignupForm() {
  var form = document.getElementById('signup-form');
  var existingBtn = document.getElementById('signup-existing');

  if (!form) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    doSignup();
  });

  // Botão "Já tem conta?" — faz LOGIN (não pula sem auth!)
  if (existingBtn) {
    existingBtn.addEventListener('click', function (e) {
      e.preventDefault();
      doExistingLogin();
    });
  }
}

function getCreds() {
  return {
    email: document.getElementById('signup-email').value.trim().toLowerCase(),
    pass:  document.getElementById('signup-password').value,
  };
}

function showErr(msg) {
  var err = document.getElementById('signup-error');
  err.textContent = msg;
  err.classList.add('visible');
  document.getElementById('signup-success').classList.remove('visible');
}
function clearErr() {
  document.getElementById('signup-error').classList.remove('visible');
}
function setBtnLoading(loading, label) {
  var btn = document.getElementById('signup-submit');
  btn.disabled = !!loading;
  btn.textContent = label || 'Criar conta';
}

function doSignup() {
  var c = getCreds();
  clearErr();

  if (!c.email || !c.pass || c.pass.length < 6) {
    return showErr('Preencha email válido e senha de pelo menos 6 caracteres.');
  }
  if (!auth) {
    // Sem Firebase, libera download mesmo assim (degrade gracioso)
    return revealDownloads('Conta criada localmente. Baixa o instalador agora →');
  }

  setBtnLoading(true, 'Criando conta...');

  auth.createUserWithEmailAndPassword(c.email, c.pass)
    .then(function (cred) {
      revealDownloads('Conta criada! Use ' + cred.user.email + ' pra logar no app.');
    })
    .catch(function (e) {
      if (e.code === 'auth/email-already-in-use') {
        // Conta já existe: tenta logar com a senha informada
        setBtnLoading(true, 'Entrando...');
        return auth.signInWithEmailAndPassword(c.email, c.pass)
          .then(function (cred) {
            revealDownloads('Bem-vindo de volta, ' + cred.user.email + '!');
          })
          .catch(function () {
            showErr('Esse email já tem conta com outra senha. Use a senha original ou outro email.');
            setBtnLoading(false);
          });
      }
      if (e.code === 'auth/invalid-email')   showErr('Email inválido.');
      else if (e.code === 'auth/weak-password') showErr('Senha muito fraca. Use ao menos 6 caracteres.');
      else                                    showErr(e.message || 'Falha ao criar conta. Tente de novo.');
      setBtnLoading(false);
    });
}

function doExistingLogin() {
  var c = getCreds();
  clearErr();

  if (!c.email || !c.pass) {
    return showErr('Preencha email e senha pra entrar.');
  }
  if (!auth) {
    return revealDownloads('Bem-vindo! Baixa o instalador →');
  }

  setBtnLoading(true, 'Entrando...');

  auth.signInWithEmailAndPassword(c.email, c.pass)
    .then(function (cred) {
      revealDownloads('Bem-vindo de volta, ' + cred.user.email + '!');
    })
    .catch(function (e) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        showErr('Senha incorreta.');
      } else if (e.code === 'auth/user-not-found') {
        showErr('Email não encontrado. Crie uma conta nova.');
      } else {
        showErr(e.message || 'Falha ao entrar.');
      }
      setBtnLoading(false);
    });
}

// ──────── Reveal downloads (após auth com sucesso) ────────

function revealDownloads(message) {
  var dlBlock    = document.getElementById('signup-download');
  var lockState  = document.getElementById('download-locked');
  var unlockState = document.getElementById('download-unlocked');
  var success    = document.getElementById('signup-success');

  success.textContent = '✓ ' + message;
  success.classList.add('visible');

  // Troca os estados
  dlBlock.classList.remove('is-locked');
  dlBlock.classList.add('is-unlocked');
  if (lockState)   lockState.style.display = 'none';
  if (unlockState) unlockState.style.display = 'block';

  // SÓ AGORA seta as URLs reais (segurança: não dá pra forçar clique antes)
  var macBtn = document.getElementById('btn-download-mac');
  var winBtn = document.getElementById('btn-download-win');
  if (macBtn) macBtn.href = DOWNLOADS.mac;
  if (winBtn) winBtn.href = DOWNLOADS.windows;

  // Esconde o link "Já tem conta?" (já não faz sentido)
  var existing = document.getElementById('signup-existing');
  if (existing && existing.parentElement) existing.parentElement.style.display = 'none';

  // Desabilita o form pra evitar resubmits
  var form = document.getElementById('signup-form');
  if (form) {
    Array.prototype.forEach.call(form.querySelectorAll('input, button'), function (el) {
      el.disabled = true;
    });
  }

  // Scroll suave pro bloco de download
  setTimeout(function () {
    dlBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 200);
}
