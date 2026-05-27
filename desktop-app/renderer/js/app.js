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
  document.getElementById('link-forgot-password').addEventListener('click', function (e) {
    e.preventDefault();
    sendPasswordReset();
  });
  document.getElementById('link-first-access').addEventListener('click', function (e) {
    e.preventDefault();
    sendPasswordReset(); // mesma ação — manda reset email
  });
}

function showLoginMessage(type, msg) {
  var err = document.getElementById('login-error');
  var ok  = document.getElementById('login-success');
  if (type === 'error') {
    err.textContent = msg;
    err.classList.add('visible');
    ok.classList.remove('visible');
  } else if (type === 'success') {
    ok.textContent = msg;
    ok.classList.add('visible');
    err.classList.remove('visible');
  } else {
    err.classList.remove('visible');
    ok.classList.remove('visible');
  }
}

function sendPasswordReset() {
  var email = document.getElementById('login-email').value.trim();
  if (!email) {
    showLoginMessage('error', 'Digite seu email primeiro pra eu mandar o link.');
    return;
  }
  if (!auth) {
    showLoginMessage('error', 'Conexão indisponível. Tente novamente.');
    return;
  }
  showLoginMessage(null);
  auth.sendPasswordResetEmail(email)
    .then(function () {
      showLoginMessage('success', '✓ Link enviado pra ' + email + '. Verifique a caixa de entrada e o spam.');
    })
    .catch(function (e) {
      if (e.code === 'auth/user-not-found') {
        showLoginMessage('error', 'Email não cadastrado. Verifique se digitou correto.');
      } else if (e.code === 'auth/invalid-email') {
        showLoginMessage('error', 'Email inválido.');
      } else {
        showLoginMessage('error', e.message);
      }
    });
}

function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass  = document.getElementById('login-password').value;

  showLoginMessage(null);

  if (!email || !pass) {
    showLoginMessage('error', 'Preencha email e senha.');
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
      var code = e.code || '';
      // Erros de senha = provavelmente primeiro acesso (Ticto criou conta com pass random)
      // Mostra mensagem amigável + sugere reset
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        showLoginMessage('error',
          'Senha incorreta. Se é seu primeiro acesso após pagar, ' +
          'use o link "Esqueci minha senha" abaixo pra criar uma.'
        );
      } else if (code === 'auth/user-not-found') {
        showLoginMessage('error',
          'Email não cadastrado. Após pagar na Ticto, você recebe um email com link de senha.'
        );
      } else if (code === 'auth/invalid-email') {
        showLoginMessage('error', 'Email inválido.');
      } else if (code === 'auth/too-many-requests') {
        showLoginMessage('error', 'Muitas tentativas. Tente em alguns minutos.');
      } else {
        showLoginMessage('error', e.message || 'Erro ao entrar.');
      }
      btn.disabled = false;
      btn.textContent = 'Entrar';
    });
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

// Categorias filtradas do preview (sem marcas de terceiros)
var EXCLUDE_FROM_PREVIEW = /ocular|mister\s*horse/i;
var PREVIEW_TARGET = 9;  // qtd de arquivos pra mostrar no grid

function driveListFolder(folderId) {
  var apiKey = CINEPRO_CONFIG.GOOGLE_DRIVE_API_KEY;
  var url = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent("'" + folderId + "' in parents and trashed=false")
    + '&fields=files(id,name,mimeType,thumbnailLink,hasThumbnail)'
    + '&pageSize=100&key=' + apiKey;
  return fetch(url).then(function (r) { return r.json(); });
}

function loadLibrarySamples() {
  if (LIBRARY_SAMPLE_CACHE) {
    renderLibrarySamples(LIBRARY_SAMPLE_CACHE);
    return;
  }

  var rootId = CINEPRO_CONFIG.GOOGLE_DRIVE_FOLDER_ID;

  // 1. Pega categorias top-level permitidas
  driveListFolder(rootId)
    .then(function (data) {
      var folders = (data.files || []).filter(function (f) {
        return f.mimeType === 'application/vnd.google-apps.folder'
          && !f.name.startsWith('_')
          && !/leia/i.test(f.name)
          && !EXCLUDE_FROM_PREVIEW.test(f.name);
      });

      // 2. Pra cada categoria, busca conteúdo (1 nível extra dentro pra pegar arquivos reais)
      return Promise.all(folders.map(function (cat) {
        return driveListFolder(cat.id).then(function (sub) {
          var items = sub.files || [];
          var files = items.filter(function (f) { return f.mimeType !== 'application/vnd.google-apps.folder'; });
          var subfolders = items.filter(function (f) {
            return f.mimeType === 'application/vnd.google-apps.folder'
              && !f.name.startsWith('_')
              && !EXCLUDE_FROM_PREVIEW.test(f.name);
          });

          // Se tem arquivos direto, usa esses
          if (files.length >= 3) {
            return files.slice(0, 6).map(function (f) { return tagFile(f, cat.name); });
          }

          // Senão, entra na primeira subpasta com conteúdo
          if (subfolders.length === 0) return [];
          return driveListFolder(subfolders[0].id).then(function (sub2) {
            return (sub2.files || [])
              .filter(function (f) { return f.mimeType !== 'application/vnd.google-apps.folder'; })
              .slice(0, 6)
              .map(function (f) { return tagFile(f, cat.name); });
          });
        }).catch(function () { return []; });
      }));
    })
    .then(function (chunks) {
      // Embaralha e pega N items priorizando os com thumbnail
      var all = [].concat.apply([], chunks);
      var withThumb = all.filter(function (f) { return f.hasThumbnail; });
      var withoutThumb = all.filter(function (f) { return !f.hasThumbnail; });
      shuffle(withThumb);
      shuffle(withoutThumb);
      // 2/3 com thumb + 1/3 sem (variedade visual)
      var nThumb = Math.min(withThumb.length, Math.ceil(PREVIEW_TARGET * 0.66));
      var nNo = PREVIEW_TARGET - nThumb;
      var samples = withThumb.slice(0, nThumb).concat(withoutThumb.slice(0, nNo));
      shuffle(samples);

      LIBRARY_SAMPLE_CACHE = samples;
      renderLibrarySamples(samples);
    })
    .catch(function (e) {
      var grid = document.getElementById('library-preview-grid');
      if (grid) grid.innerHTML = '<div class="library-preview-error">Não foi possível carregar a prévia. Verifique sua conexão.</div>';
    });
}

// Anexa metadados úteis ao arquivo
function tagFile(file, categoryName) {
  var ext = (file.name.split('.').pop() || '').toLowerCase();
  var kind = /mp4|mov|webm|gif/.test(ext) ? 'video'
           : /mp3|wav|m4a/.test(ext)       ? 'audio'
           : /png|jpe?g|tif/.test(ext)     ? 'image'
           : /mogrt/.test(ext)             ? 'mogrt'
           : /prfpset/.test(ext)           ? 'preset'
           : /cube|3dl/.test(ext)          ? 'lut'
           : 'file';
  return {
    id:       file.id,
    name:     file.name.replace(/\.[^.]+$/, ''),
    ext:      ext,
    kind:     kind,
    thumb:    file.thumbnailLink,
    hasThumbnail: !!file.hasThumbnail && !!file.thumbnailLink,
    category: categoryName.replace(/^\d+\s*[-_.]\s*/, ''),
  };
}

function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

function kindIcon(kind) {
  return ({
    audio: '🎵', video: '🎬', image: '🖼',
    mogrt: '📝', preset: '✨', lut: '🎨',
  }[kind]) || '📄';
}

function kindColor(kind) {
  return ({
    audio: 'cyan', video: 'purple', image: 'blue',
    mogrt: 'green', preset: 'gold', lut: 'red',
  }[kind]) || 'blue';
}

function renderLibrarySamples(samples) {
  var grid = document.getElementById('library-preview-grid');
  var count = document.getElementById('library-preview-count');
  if (!grid) return;

  grid.innerHTML = '';
  samples.forEach(function (f) {
    var card = document.createElement('div');
    card.className = 'lib-card';
    var thumbHtml = f.hasThumbnail
      ? '<img src="' + f.thumb.replace(/=s\d+$/, '=s320') + '" alt="" referrerpolicy="no-referrer">'
      : '<span>' + kindIcon(f.kind) + '</span>';
    card.innerHTML =
      '<div class="lib-card-thumb ' + (f.hasThumbnail ? 'has-thumb' : kindColor(f.kind)) + '">' + thumbHtml + '</div>' +
      '<div class="lib-card-meta">' +
        '<div class="lib-card-num">' + (f.category || '').toUpperCase() + ' · ' + f.ext.toUpperCase() + '</div>' +
        '<div class="lib-card-name">' + f.name + '</div>' +
      '</div>';
    grid.appendChild(card);
  });

  if (count) count.textContent = 'Amostra · 12.000 efeitos no total';
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
