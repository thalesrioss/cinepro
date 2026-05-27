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
        hideLibraryPreview();
      } else {
        pill.className = 'status-pill inactive';
        text.textContent = 'Assinatura inativa';
        meta.innerHTML = data && data.lastStatus
          ? 'Status: ' + data.lastStatus + '. Reative pra continuar usando o CinePRO.'
          : '<strong>3 dias grátis</strong> pra testar. Depois R$ 29,97/mês. Cancele quando quiser.';
        btnSub.textContent = data && data.lastStatus ? 'Reativar assinatura' : 'Começar trial grátis';
        btnSub.classList.remove('hidden');
        btnMgmt.classList.add('hidden');
        showLibraryPreview();
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

// ════════════════ LIBRARY PREVIEW ════════════════════════════════
// Quando o usuario nao tem sub ativa, mostra um grid de samples do Drive
// pra cria desejo + contexto antes de assinar.

var LIBRARY_SAMPLE_CACHE = null;  // cache em memoria pra evitar re-fetch

function showLibraryPreview() {
  var el = document.getElementById('library-preview');
  if (!el) return;
  el.classList.remove('hidden');
  loadLibrarySamples();
}

function hideLibraryPreview() {
  var el = document.getElementById('library-preview');
  if (el) el.classList.add('hidden');
}

function loadLibrarySamples() {
  if (LIBRARY_SAMPLE_CACHE) {
    renderLibrarySamples(LIBRARY_SAMPLE_CACHE);
    return;
  }

  var rootId = CINEPRO_CONFIG.GOOGLE_DRIVE_FOLDER_ID;
  var apiKey = CINEPRO_CONFIG.GOOGLE_DRIVE_API_KEY;

  // Lista as 6 categorias top-level
  var url = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent("'" + rootId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
    + '&fields=files(id,name)'
    + '&pageSize=20&key=' + apiKey;

  // Categorias que NAO aparecem no preview pra nao usar marcas de terceiros
  // como sales pitch. Plugin no Premiere continua mostrando tudo pra clientes ativos.
  var EXCLUDE_FROM_PREVIEW = /ocular|mister\s*horse/i;

  fetch(url)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var folders = (data.files || []).filter(function (f) {
        return !f.name.startsWith('_')
          && !/leia/i.test(f.name)
          && !EXCLUDE_FROM_PREVIEW.test(f.name);
      });
      LIBRARY_SAMPLE_CACHE = folders.slice(0, 6);
      renderLibrarySamples(LIBRARY_SAMPLE_CACHE);
    })
    .catch(function (e) {
      var grid = document.getElementById('library-preview-grid');
      if (grid) grid.innerHTML = '<div class="library-preview-error">Não foi possível carregar a prévia. Verifique sua conexão.</div>';
    });
}

function renderLibrarySamples(folders) {
  var grid = document.getElementById('library-preview-grid');
  var count = document.getElementById('library-preview-count');
  if (!grid) return;

  // Mapeamento de cor + ícone por nome (mesma identidade da LP)
  var palette = {
    '01': { color: 'gold',   icon: '🎨', desc: 'Presets de efeito Premiere' },
    '02': { color: 'purple', icon: '🖼',  desc: 'Overlays, transições, LUTs' },
    '03': { color: 'cyan',   icon: '🎵', desc: 'SFX e trilhas premium' },
    '04': { color: 'red',    icon: '👁',  desc: 'Som cinematográfico Ocular' },
    '05': { color: 'green',  icon: '🎬', desc: 'Mister Horse Previews' },
  };

  grid.innerHTML = '';
  folders.forEach(function (folder, i) {
    var prefix = (folder.name.match(/^(\d+)/) || [])[1];
    var meta = palette[prefix] || { color: 'blue', icon: '✨', desc: 'Atualizações contínuas' };
    var cleanName = folder.name.replace(/^\d+\s*[-_.]\s*/, '');

    var card = document.createElement('div');
    card.className = 'lib-card';
    card.innerHTML =
      '<div class="lib-card-thumb ' + meta.color + '"><span>' + meta.icon + '</span></div>' +
      '<div class="lib-card-meta">' +
        '<div class="lib-card-num">0' + (i + 1) + '</div>' +
        '<div class="lib-card-name">' + cleanName + '</div>' +
        '<div class="lib-card-desc">' + meta.desc + '</div>' +
      '</div>';
    grid.appendChild(card);
  });

  if (count) count.textContent = folders.length + ' categorias · 12.000 efeitos no total';
}

// Bind extra dos botoes do preview
document.addEventListener('DOMContentLoaded', function () {
  var refresh = document.getElementById('btn-refresh-preview');
  if (refresh) refresh.addEventListener('click', function () {
    LIBRARY_SAMPLE_CACHE = null;
    loadLibrarySamples();
  });
  var sub2 = document.getElementById('btn-subscribe-2');
  if (sub2) sub2.addEventListener('click', function () {
    window.cinepro.openExternal(CINEPRO_CONFIG.TICTO_CHECKOUT_URL);
  });
});
