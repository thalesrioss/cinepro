// =============================================================
//  CinePRO Desktop — Renderer (UI)
// =============================================================

var auth, db, currentUser;

document.addEventListener('DOMContentLoaded', function () {
  initFirebase();
  bindLogin();
  bindDashboard();
  loadVersion();
});

// ──────── Firebase ────────

function initFirebase() {
  try {
    firebase.initializeApp(CINEPRO_CONFIG.FIREBASE);
    auth = firebase.auth();
    db   = firebase.firestore();

    setLoginStatus('ok', 'Pronto');

    // Auth state listener — entra direto se já tem sessão
    auth.onAuthStateChanged(function (user) {
      if (user) {
        currentUser = user;
        checkSubscriptionAndShow();
      } else {
        showScreen('login');
      }
    });
  } catch (e) {
    setLoginStatus('error', 'Falha ao conectar: ' + e.message);
  }
}

// ──────── Login ────────

function bindLogin() {
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('link-subscribe-from-login').addEventListener('click', function (e) {
    e.preventDefault();
    window.cinepro.openExternal(CINEPRO_CONFIG.TICTO_CHECKOUT_URL);
  });
}

function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass  = document.getElementById('login-password').value;
  var err   = document.getElementById('login-error');
  err.classList.remove('visible');

  if (!email || !pass) {
    err.textContent = 'Preencha email e senha.';
    err.classList.add('visible');
    return;
  }

  var btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  auth.signInWithEmailAndPassword(email, pass)
    .then(function (cred) {
      currentUser = cred.user;
      checkSubscriptionAndShow();
    })
    .catch(function (e) {
      err.textContent = humanizeAuthError(e);
      err.classList.add('visible');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    });
}

function humanizeAuthError(e) {
  var code = e.code || '';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Senha incorreta.';
  if (code === 'auth/user-not-found')   return 'Usuário não encontrado.';
  if (code === 'auth/invalid-email')    return 'Email inválido.';
  if (code === 'auth/too-many-requests') return 'Muitas tentativas. Tente em alguns minutos.';
  return e.message || 'Erro ao entrar.';
}

function setLoginStatus(type, msg) {
  var dot  = document.getElementById('login-status-dot');
  var text = document.getElementById('login-status-text');
  if (!dot || !text) return;
  dot.className  = 'status-dot ' + type;
  text.textContent = msg;
}

// ──────── Subscription ────────

function checkSubscriptionAndShow() {
  showScreen('dashboard');
  document.getElementById('user-badge').textContent = currentUser.email;
  refreshSubscription();
  refreshPluginStatus();
  refreshCache();
}

function refreshSubscription() {
  var pill = document.getElementById('sub-status-pill');
  var text = document.getElementById('sub-status-text');
  var meta = document.getElementById('sub-meta');
  var btnSub  = document.getElementById('btn-subscribe');
  var btnMgmt = document.getElementById('btn-manage-sub');

  pill.className = 'status-pill loading';
  text.textContent = 'Verificando...';

  // Admin whitelist
  var isAdmin = CINEPRO_CONFIG.ADMIN_EMAILS &&
                CINEPRO_CONFIG.ADMIN_EMAILS.indexOf((currentUser.email || '').toLowerCase()) !== -1;

  if (isAdmin) {
    pill.className = 'status-pill active';
    text.textContent = '★ Admin — acesso vitalício';
    meta.textContent = 'Você tem acesso completo a todos os recursos.';
    btnSub.classList.add('hidden');
    btnMgmt.classList.add('hidden');
    return;
  }

  db.collection('users').doc(currentUser.uid).get()
    .then(function (doc) {
      var data = doc.exists ? doc.data() : null;
      var active = data && (data.admin === true || data.subscriptionActive === true);

      if (active) {
        pill.className = 'status-pill active';
        text.textContent = 'Assinatura ativa';
        meta.textContent = 'Você tem acesso completo aos efeitos. ' +
                           (data.lastEventAt ? 'Última atualização: ' + data.lastEventAt : '');
        btnSub.classList.add('hidden');
        btnMgmt.classList.remove('hidden');
      } else {
        pill.className = 'status-pill inactive';
        text.textContent = 'Assinatura inativa';
        meta.innerHTML = data && data.lastStatus
          ? 'Status: ' + data.lastStatus + '. Reative pra continuar usando o CinePRO.'
          : '<strong>3 dias grátis</strong> pra testar. Depois R$ 29,97/mês. Cancele quando quiser.';
        btnSub.textContent = data && data.lastStatus ? 'Reativar assinatura' : 'Começar trial grátis';
        btnSub.classList.remove('hidden');
        btnMgmt.classList.add('hidden');
      }
    })
    .catch(function (e) {
      pill.className = 'status-pill inactive';
      text.textContent = 'Falha ao verificar';
      meta.textContent = e.message;
    });
}

// ──────── Plugin install check ────────

function refreshPluginStatus() {
  var desc = document.getElementById('plugin-status-desc');
  var btn  = document.getElementById('btn-reinstall');

  window.cinepro.isPluginInstalled().then(function (ok) {
    if (ok) {
      desc.innerHTML = '<span style="color: var(--success);">✓ Instalado e pronto</span>';
      btn.textContent = 'Reinstalar plugin';
    } else {
      desc.innerHTML = '<span style="color: var(--danger);">✕ Plugin não encontrado</span>';
      btn.textContent = 'Instalar plugin';
    }
  });
}

// ──────── Cache ────────

function refreshCache() {
  var desc = document.getElementById('cache-desc');
  window.cinepro.cache.size().then(function (info) {
    if (info.count === 0) {
      desc.textContent = 'Cache vazio. Arquivos baixados na primeira aplicação ficam aqui.';
    } else {
      desc.innerHTML = '<strong>' + info.count + ' arquivos</strong> · ' + formatBytes(info.bytes);
    }
  });
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  if (b < 1024*1024*1024) return (b/1024/1024).toFixed(1) + ' MB';
  return (b/1024/1024/1024).toFixed(2) + ' GB';
}

// ──────── Dashboard actions ────────

function bindDashboard() {
  document.getElementById('btn-logout').addEventListener('click', function () {
    auth.signOut().then(function () {
      currentUser = null;
      showScreen('login');
    });
  });

  document.getElementById('btn-subscribe').addEventListener('click', function () {
    window.cinepro.openExternal(CINEPRO_CONFIG.TICTO_CHECKOUT_URL);
  });

  document.getElementById('btn-manage-sub').addEventListener('click', function () {
    window.cinepro.openExternal('https://app.ticto.com.br/minhas-compras');
  });

  document.getElementById('btn-open-premiere').addEventListener('click', function () {
    window.cinepro.openPremiere();
    showToast('Abrindo Premiere... Procure CinePRO em Janela → Extensões', 'success');
  });

  document.getElementById('btn-reinstall').addEventListener('click', function () {
    showToast('Pra reinstalar, rode o instalador novamente. Em breve isso será automático.', '');
  });

  document.getElementById('btn-clear-cache').addEventListener('click', function () {
    if (!confirm('Limpar todo o cache de arquivos baixados? Os arquivos serão re-baixados na próxima vez que você usar.')) return;
    window.cinepro.cache.clear().then(function (info) {
      showToast(info.removed + ' arquivos removidos', 'success');
      refreshCache();
    });
  });

  document.getElementById('btn-support').addEventListener('click', function () {
    window.cinepro.openExternal('mailto:suporte@cinepro.com?subject=Ajuda%20CinePRO');
  });
}

// ──────── Navegação ────────

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
  document.getElementById('screen-' + name).classList.remove('hidden');
}

function loadVersion() {
  window.cinepro.appVersion().then(function (v) {
    document.getElementById('topbar-version').textContent = 'v' + v;
  });
}

// ──────── Toast ────────

function showToast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast ' + (type || '');
  requestAnimationFrame(function () {
    t.classList.add('visible');
    setTimeout(function () { t.classList.remove('visible'); }, 3500);
  });
}
