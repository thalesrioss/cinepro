// =============================================================
//  CinePRO — main.js
//  Auth Firebase, Google Drive, drag-to-timeline, click-to-apply
// =============================================================

'use strict';

// ── Globals ──────────────────────────────────────────────────
var cs          = new CSInterface();
var firebaseApp = null;
var auth        = null;
var db          = null;
var currentUser = null;
var allEffects  = [];       // lista completa de efeitos do Drive
var activeCategory = 'all'; // categoria selecionada

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  initFirebase();
  bindLoginUI();
  bindAppUI();
  hydrateCacheFromDisk();
});

/**
 * Ao iniciar, carrega o índice de cache do localStorage e popula effectCache
 * pra todos os arquivos que ainda existem em disco. Assim o usuário já abre
 * com tudo "pronto pra arrastar" do que ele baixou em sessões anteriores.
 */
function hydrateCacheFromDisk() {
  var idx = getCacheIndex();
  var hits = 0;
  var ids  = Object.keys(idx);
  ids.forEach(function (id) {
    var path = idx[id];
    if (fileExistsLocal(path)) {
      effectCache[id] = path;
      hits++;
    } else {
      // Arquivo deletado externamente — remove do índice
      delete idx[id];
    }
  });
  if (hits !== ids.length) saveCacheIndex(idx);
  if (hits > 0) console.log('[CinePRO] hidratou cache com ' + hits + ' arquivos persistentes');
}

// ══ FIREBASE ══════════════════════════════════════════════════

function initFirebase() {
  try {
    firebaseApp = firebase.initializeApp(CINEPRO_CONFIG.FIREBASE);
    auth        = firebase.auth();
    db          = firebase.firestore();

    auth.onAuthStateChanged(function (user) {
      if (user) {
        currentUser = user;
        checkSubscription(user);
      } else {
        showScreen('login');
      }
    });
  } catch (e) {
    showError('Erro ao inicializar Firebase: ' + e.message);
    showScreen('login');
  }
}

/**
 * Verifica no Firestore se o usuário tem assinatura ativa.
 * Estrutura esperada no Firestore:
 *   users/{uid} → { subscriptionActive: true, email: '...' }
 *
 * O webhook da Ticto deve gravar/atualizar esse campo.
 */
function checkSubscription(user) {
  setStatus('loading', 'Verificando assinatura...');

  // Whitelist de admins (acesso vitalício, ignora assinatura)
  if (CINEPRO_CONFIG.ADMIN_EMAILS && CINEPRO_CONFIG.ADMIN_EMAILS.indexOf((user.email || '').toLowerCase()) !== -1) {
    showScreen('app');
    setUserBadge(user.email + ' (ADM)');
    loadEffects();
    return;
  }

  db.collection('users').doc(user.uid).get()
    .then(function (doc) {
      // Acesso por admin no documento OU assinatura ativa
      if (doc.exists && (doc.data().admin === true || doc.data().subscriptionActive === true)) {
        showScreen('app');
        var badge = user.email + (doc.data().admin === true ? ' (ADM)' : '');
        setUserBadge(badge);
        loadEffects();
      } else {
        showScreen('no-access');
      }
    })
    .catch(function (err) {
      showError('Erro ao verificar assinatura: ' + err.message);
      showScreen('no-access');
    });
}

// ══ LOGIN UI ═══════════════════════════════════════════════════

function bindLoginUI() {
  var btnLogin   = document.getElementById('btn-login');
  var emailInput = document.getElementById('login-email');
  var passInput  = document.getElementById('login-password');

  btnLogin.addEventListener('click', doLogin);

  [emailInput, passInput].forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doLogin();
    });
  });

  document.getElementById('link-subscribe').addEventListener('click', function (e) {
    e.preventDefault();
    openURL(CINEPRO_CONFIG.TICTO_CHECKOUT_URL);
  });

  document.getElementById('btn-subscribe').addEventListener('click', function () {
    openURL(CINEPRO_CONFIG.TICTO_CHECKOUT_URL);
  });

  document.getElementById('btn-logout-no-access').addEventListener('click', doLogout);

  var forgot = document.getElementById('link-forgot-password');
  if (forgot) forgot.addEventListener('click', function (e) {
    e.preventDefault();
    sendPasswordReset();
  });
}

function showLoginSuccess(msg) {
  var ok  = document.getElementById('login-success');
  var err = document.getElementById('login-error');
  if (ok)  { ok.textContent = msg; ok.classList.add('visible'); }
  if (err) err.classList.remove('visible');
}

function sendPasswordReset() {
  var email = document.getElementById('login-email').value.trim();
  if (!email) {
    showLoginError('Digite seu email primeiro pra eu mandar o link.');
    return;
  }
  if (!auth) {
    showLoginError('Conexão indisponível. Tente novamente.');
    return;
  }
  auth.sendPasswordResetEmail(email)
    .then(function () {
      showLoginSuccess('✓ Link enviado pra ' + email + '. Verifique seu email.');
    })
    .catch(function (e) {
      if (e.code === 'auth/user-not-found') {
        showLoginError('Email não cadastrado.');
      } else if (e.code === 'auth/invalid-email') {
        showLoginError('Email inválido.');
      } else {
        showLoginError(e.message);
      }
    });
}

function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass  = document.getElementById('login-password').value;
  var btn   = document.getElementById('btn-login');
  var errEl = document.getElementById('login-error');
  var okEl  = document.getElementById('login-success');

  if (!email || !pass) {
    showLoginError('Preencha e-mail e senha.');
    return;
  }

  errEl.classList.remove('visible');
  if (okEl) okEl.classList.remove('visible');
  btn.disabled    = true;
  btn.textContent = 'Entrando...';

  auth.signInWithEmailAndPassword(email, pass)
    .catch(function (err) {
      btn.disabled    = false;
      btn.textContent = 'Entrar';

      var msg = 'Erro ao fazer login.';
      if (err.code === 'auth/user-not-found') {
        msg = 'Email não cadastrado. Após pagar na Ticto, você recebe link de senha.';
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'Senha incorreta. Primeiro acesso? Use "Esqueci minha senha".';
      } else if (err.code === 'auth/invalid-email')     msg = 'E-mail inválido.';
      else if (err.code === 'auth/network-request-failed') msg = 'Sem conexão com internet.';
      else if (err.code === 'auth/too-many-requests') msg = 'Muitas tentativas. Aguarde.';

      showLoginError(msg);
    });
}

function doLogout() {
  auth.signOut().then(function () {
    currentUser = null;
    allEffects  = [];
    activeCategory = 'all';
    showScreen('login');
  });
}

function showLoginError(msg) {
  var el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.add('visible');
}

// ══ SCREENS ═══════════════════════════════════════════════════

function showScreen(name) {
  document.getElementById('login-overlay').classList.toggle('hidden',    name !== 'login');
  document.getElementById('no-access-overlay').classList.toggle('hidden', name !== 'no-access');
  document.getElementById('app-content').classList.toggle('hidden',       name !== 'app');

  if (name === 'login') {
    var btn = document.getElementById('btn-login');
    btn.disabled    = false;
    btn.textContent = 'Entrar';
    document.getElementById('login-error').classList.remove('visible');
  }
}

// ══ APP UI ════════════════════════════════════════════════════

function bindAppUI() {
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  bindGridDelegation();
  bindKeyboardShortcuts();
  scheduleUpdateCheck();
  // v1.3: carrega bundle manifest (assets pre-instalados)
  initBundleLookup();
  // v1.2 A5: pre-warm ExtendScript (primeira chamada demora 30-100ms)
  // Faz o Premiere já compilar o host script, deixando o primeiro apply rápido
  scheduleIdle(function () {
    try { cs.evalScript('hasActiveSequence()', function () {}); } catch (e) {}
  });

  var input = document.getElementById('search-input');
  var clear = document.getElementById('search-clear');

  // Debounce — só filtra 200ms depois da última tecla. Evita rodar
  // filtro em 12k items a cada caractere digitado.
  var searchTimer = null;
  input.addEventListener('input', function (e) {
    var val = e.target.value.trim();
    clear.style.display = val ? 'flex' : 'none';
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      filterEffects(val.toLowerCase());
    }, 200);
  });

  clear.addEventListener('click', function () {
    if (searchTimer) clearTimeout(searchTimer);
    input.value = '';
    clear.style.display = 'none';
    filterEffects('');
    input.focus();
  });
}

/**
 * Dispara check de update no GitHub Releases em background (idle).
 * Cache de 24h + dismiss de 7d gerenciados internamente pelo módulo.
 */
function scheduleUpdateCheck() {
  if (!global_CinePROUpdateChecker_available()) return;
  var current = (window.CINEPRO_CONFIG && CINEPRO_CONFIG.PLUGIN_VERSION) || '0.0.0';
  scheduleIdle(function () {
    window.CinePROUpdateChecker.check(current, function (release) {
      if (!release) return;
      var slot = document.getElementById('update-pill-slot');
      window.CinePROUpdateChecker.render(release, {
        pillHost:  slot || document.body,
        modalHost: document.body,
      });
      console.log('[CinePRO] update disponível:', release.tag);
    });
  });
}

function global_CinePROUpdateChecker_available() {
  return typeof window.CinePROUpdateChecker === 'object' &&
         typeof window.CinePROUpdateChecker.check === 'function';
}

function setUserBadge(email) {
  var parts = (email || '').split('@');
  document.getElementById('user-email-badge').textContent = parts[0] || email;
}

// ══ GOOGLE DRIVE ══════════════════════════════════════════════

// Formatos válidos do plugin (resto é ignorado)
var VALID_EXTS = {
  // Mídia que entra direto na timeline
  mp4:'video', mov:'video', avi:'video', mkv:'video', webm:'video', gif:'video',
  // Áudio
  mp3:'audio', wav:'audio', m4a:'audio', aac:'audio', ogg:'audio',
  // Imagem
  png:'image', jpg:'image', jpeg:'image', tif:'image', tiff:'image', psd:'image',
  // Adobe specifics
  mogrt:'mogrt',           // Motion Graphics Template
  prfpset:'preset',        // Premiere Effect Preset
  prproj:'project',        // Premiere Project
  aep:'ae',                // After Effects Project
  cube:'lut',              // LUT
  '3dl':'lut',
  drx:'lumetri',           // Lumetri preset
  // Arquivos a IGNORAR mesmo se aparecerem
  pdf: null, txt: null, doc: null, docx: null,
};

// Pastas que devem ser ignoradas (previews internos, leia-me)
var SKIP_FOLDERS = [
  /^_/,                    // pastas iniciadas com _
  /^00\s*-?\s*leia/i,      // "00 - LEIA-ME PRIMEIRO"
  /previews?$/i,
];

function shouldSkipFolder(name) {
  return SKIP_FOLDERS.some(function (rx) { return rx.test(name); });
}

function shouldSkipFile(name) {
  if (!name) return true;
  if (name.startsWith('._')) return true;          // macOS resource fork
  if (name === '.DS_Store') return true;
  if (/^MANUAL\s|^COMO\s+INSTALAR/i.test(name)) return true;  // tutoriais
  var ext = (name.split('.').pop() || '').toLowerCase();
  if (!(ext in VALID_EXTS)) return true;           // extensão desconhecida
  if (VALID_EXTS[ext] === null) return true;       // explicitamente ignorado
  return false;
}

/**
 * LAZY LOAD: Primeira carga só pega categorias top-level (rápido).
 * Os arquivos de cada categoria são carregados sob demanda quando o usuário
 * clica na aba dela. Aguenta os 12k+ arquivos sem travar a UI.
 */
var driveCategories = [];     // [{ id, name, loaded:false, count:0 }]
var driveLoadedCats = {};     // { categoryName: true } — categorias já totalmente carregadas

var MAX_DEPTH = 6;   // Drive tem até 8 níveis; 6 cobre tudo que importa
var DRIVE_PAGE_SIZE = 1000;   // máx da API

// ── MANIFEST PRE-GERADO ─────────────────────────────────────────
// Boot rápido: tenta carregar manifest JSON pré-gerado (1 HTTP call em
// vez de 962 chamadas pro Drive). Fallback pra Drive walk se manifest
// indisponível.
var MANIFEST_URLS = [
  // 1. CDN público via jsDelivr (cacheado globalmente, atualiza semanal)
  'https://cdn.jsdelivr.net/gh/thalesrioss/cinepro@main/manifest/dist/manifest.json',
  // 2. Bundled junto com o plugin (offline-safe)
  './manifest.json',
];

function loadEffects() {
  setStatus('loading', 'Carregando biblioteca...');
  allEffects = [];
  driveCategories = [];
  driveLoadedCats = {};

  return tryManifest(MANIFEST_URLS.slice())
    .then(function (manifest) {
      if (manifest) {
        applyManifest(manifest);
        var ageHours = ((Date.now() - new Date(manifest.builtAt).getTime()) / 3600000).toFixed(0);
        setStatus('ok', allEffects.length + ' efeitos prontos (manifest ' + ageHours + 'h atrás)');
        return;
      }
      console.warn('[CinePRO] Manifest indisponível, fallback pra Drive walk');
      return loadEffectsFromDriveLive();
    })
    .catch(function (err) {
      console.error('[CinePRO] loadEffects falhou:', err);
      return loadEffectsFromDriveLive();
    });
}

function tryManifest(urls) {
  if (!urls.length) return Promise.resolve(null);
  var url = urls.shift();
  return fetch(url, { cache: 'force-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (m) {
      if (!m || !m.files || !Array.isArray(m.files)) throw new Error('manifest inválido');
      console.log('[CinePRO] Manifest carregado de:', url, '· ' + m.files.length + ' arquivos · built ' + m.builtAt);
      return m;
    })
    .catch(function (e) {
      console.warn('[CinePRO] manifest miss em ' + url + ':', e.message);
      return tryManifest(urls);
    });
}

function applyManifest(manifest) {
  // Popula allEffects direto do manifest
  allEffects = manifest.files;
  // v1.2 Parte C: guarda dicionário de conceitos pra busca semântica
  CINEPRO_CONCEPTS_DICT = manifest.concepts || null;

  // Reconstrói driveCategories a partir da lista de categorias do manifest
  var seenCats = {};
  driveCategories = [];
  manifest.categories.forEach(function (catName) {
    if (seenCats[catName]) return;
    seenCats[catName] = true;
    driveCategories.push({ id: null, name: catName, loaded: true });
    driveLoadedCats[catName] = true;
  });
  // Garante categorias presentes nos files mas não no array (paranoia)
  allEffects.forEach(function (e) {
    if (!seenCats[e.category]) {
      seenCats[e.category] = true;
      driveCategories.push({ id: null, name: e.category, loaded: true });
      driveLoadedCats[e.category] = true;
    }
  });

  buildSearchIndex();
  buildCategoryTabs();
  renderEffects(allEffects);
}

// ── FALLBACK: Drive walk live (caso manifest off) ────────────────
function loadEffectsFromDriveLive() {
  setStatus('loading', 'Carregando categorias (modo lento)...');

  return listDriveFolderAll(CINEPRO_CONFIG.GOOGLE_DRIVE_FOLDER_ID)
    .then(function (rootItems) {
      var rootFolders = rootItems.filter(isFolder).filter(function (f) { return !shouldSkipFolder(f.name); });
      var rootFiles   = rootItems.filter(notFolder).filter(function (f) { return !shouldSkipFile(f.name); });

      // Arquivos soltos na raiz vão pra uma categoria "Essentials" branded
      var rootBucket = brandCategoryName('Geral');
      rootFiles.forEach(function (f) {
        allEffects.push(driveFileToEffect(f, rootBucket, null, []));
      });
      if (rootFiles.length) {
        driveCategories.push({ id: null, name: rootBucket, loaded: true });
        driveLoadedCats[rootBucket] = true;
      }

      // Cada subpasta vira uma categoria (lazy) — nome passa pelo branding.
      // Se 2+ pastas do Drive mapeiam pro mesmo nome branded, mescla numa só.
      rootFolders.forEach(function (cat) {
        var branded = brandCategoryName(cat.name);
        var existing = driveCategories.find(function (c) { return c.name === branded; });
        if (existing) {
          // anexa o folder id extra pra walker visitar os dois
          existing.extraIds = existing.extraIds || [];
          existing.extraIds.push(cat.id);
        } else {
          driveCategories.push({ id: cat.id, name: branded, loaded: false });
        }
      });
    })
    .then(function () {
      buildCategoryTabs();
      renderEffects(allEffects);
      setStatus('ok', driveCategories.length + ' categorias prontas — clique pra explorar');
    })
    .catch(function (err) {
      setStatus('error', 'Erro ao carregar');
      showToast('Erro: ' + err.message, 'error');
      renderEmpty('Não foi possível carregar.<br>Verifique a chave de API e a conexão.');
    });
}

/**
 * Carrega uma categoria inteira recursivamente (todos os subníveis).
 * Chamada quando o usuário clica numa aba pela primeira vez.
 */
function loadCategoryDeep(categoryName) {
  if (driveLoadedCats[categoryName]) return Promise.resolve();

  var cat = driveCategories.find(function (c) { return c.name === categoryName; });
  if (!cat || !cat.id) return Promise.resolve();

  setStatus('loading', 'Carregando "' + categoryName + '"...');

  // Lista de root ids dessa categoria (mescla pastas com mesmo brand name)
  var rootIds = [cat.id].concat(cat.extraIds || []);

  return Promise.all(rootIds.map(function (rid) {
    return walkFolder(rid, categoryName, [], 0);
  }))
    .then(function () {
      driveLoadedCats[categoryName] = true;
      cat.loaded = true;
      buildSearchIndex();  // rebuild com itens novos
      setStatus('ok', allEffects.filter(function(e){return e.category===categoryName;}).length + ' itens em "' + categoryName + '"');
      // Atualiza contadores nas abas
      var btn = document.querySelector('.tab-btn[data-cat="' + categoryName + '"] .tab-count');
      if (btn) {
        var n = allEffects.filter(function(e){return e.category===categoryName;}).length;
        btn.textContent = n;
      }
    })
    .catch(function (err) {
      console.error('[CinePRO] loadCategoryDeep erro:', err);
      setStatus('error', 'Falha ao carregar categoria');
    });
}

/**
 * Recursão profunda — caminha por toda a árvore da categoria,
 * coletando arquivos e respeitando MAX_DEPTH.
 */
function walkFolder(folderId, categoryName, path, depth) {
  if (depth >= MAX_DEPTH) return Promise.resolve();

  return listDriveFolderAll(folderId).then(function (items) {
    var folders = items.filter(isFolder).filter(function (f) { return !shouldSkipFolder(f.name); });
    var files   = items.filter(notFolder).filter(function (f) { return !shouldSkipFile(f.name); });

    // Arquivos desse nível
    files.forEach(function (f) {
      var sub = path.length > 0 ? cleanCategoryName(path[0]) : null;
      allEffects.push(driveFileToEffect(f, categoryName, sub, path));
    });

    // Recursão nos filhos
    return Promise.all(folders.map(function (sub) {
      return walkFolder(sub.id, categoryName, path.concat([sub.name]), depth + 1);
    }));
  });
}

function isFolder(i)    { return i.mimeType === 'application/vnd.google-apps.folder'; }
function notFolder(i)   { return i.mimeType !== 'application/vnd.google-apps.folder'; }

/** Remove prefixos como "01 - ", "02 -" do nome da pasta */
function cleanCategoryName(name) {
  return name.replace(/^\d+\s*[-_.]\s*/, '').trim();
}

/**
 * BRANDING: pega o nome de uma pasta RAIZ do Drive e aplica o mapa de
 * renames do config (regex-based). Subpastas NÃO passam por aqui —
 * mantêm o nome original do Drive pra continuarem descritivas.
 *
 * Catch-all: se nenhuma regex bater, prefixa "CinePRO " — garante que
 * nenhuma categoria raiz escape do branding.
 */
function brandCategoryName(name) {
  var clean = cleanCategoryName(name);
  var renames = (window.CINEPRO_CONFIG && CINEPRO_CONFIG.CATEGORY_RENAMES) || [];
  for (var i = 0; i < renames.length; i++) {
    var r = renames[i];
    if (r && r.match && r.match.test(clean)) return r.to;
  }
  // Fallback: já começa com CinePRO? mantém. Senão, prefixa.
  if (/^cinepro/i.test(clean)) return clean;
  return 'CinePRO ' + clean;
}

/**
 * Lista TUDO numa pasta, lidando com paginação (>1000 items).
 */
function listDriveFolderAll(folderId) {
  var results = [];
  function page(token) {
    return listDriveFolder(folderId, token).then(function (data) {
      results = results.concat(data.files || []);
      if (data.nextPageToken) return page(data.nextPageToken);
      return results;
    });
  }
  return page(null);
}

function listDriveFolder(folderId, pageToken) {
  var url = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent("'" + folderId + "' in parents and trashed=false")
    + '&fields=nextPageToken,files(id,name,mimeType,thumbnailLink,size)'
    + '&pageSize=' + DRIVE_PAGE_SIZE
    + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '')
    + '&key=' + CINEPRO_CONFIG.GOOGLE_DRIVE_API_KEY;

  return fetchWithRetry(url)
    .then(function (r) {
      if (!r.ok) throw new Error('Drive API status ' + r.status);
      return r.json();
    });
}

// Auto-tags extraídas dos nomes (top 20 do scan)
var AUTO_TAGS = [
  'whoosh','woosh','impacto','sfx','sci','cyberpunk','metal','atmosfera',
  'deep','riser','glitch','cinematic','dark','vintage','foley','passagem',
  'click','typing','keyboard','mouse','camera','medium','small','long',
  'slow','interno','externo','transição','ocular','luts','overlay','frame',
];

function extractTags(name) {
  var low = (name || '').toLowerCase();
  return AUTO_TAGS.filter(function (t) { return low.indexOf(t) !== -1; });
}

function driveFileToEffect(driveFile, category, subcategory, path) {
  var ext = (driveFile.name.split('.').pop() || '').toLowerCase();
  var cleanName = driveFile.name.replace(/\.[^.]+$/, '');
  return {
    id:          driveFile.id,
    name:        cleanName,
    ext:         ext,
    kind:        VALID_EXTS[ext],            // 'video' | 'audio' | 'image' | 'mogrt' | 'preset' | 'lut'...
    mimeType:    driveFile.mimeType,
    thumb:       driveFile.thumbnailLink || null,
    category:    category,
    subcategory: subcategory,
    path:        path || [],                  // hierarquia completa de pastas
    tags:        extractTags(cleanName),
    size:        parseInt(driveFile.size || 0),
  };
}

// ══ SIDEBAR (folder tree estilo Mister Horse) ═══════════════════

// Estado: { categoryName: true } — pastas abertas (expanded)
var sidebarExpanded = { '_all': true, '_favorites': true };

// Filtro adicional pra subcategoria selecionada (ex: "VISUAL DESIGN / Overlay")
var activeSubcategory = null;

function buildCategoryTabs() {  // mantém nome pra evitar quebra externa
  buildSidebarTree();
}

function buildSidebarTree() {
  var tree = document.getElementById('sidebar-tree');
  if (!tree) return;
  tree.innerHTML = '';

  // ─ Item "Todos" ─
  tree.appendChild(makeSidebarItem({
    label: 'Todos', icon: '▦',
    dataCat: 'all', dataSub: '',
    isActive: activeCategory === 'all' && !activeSubcategory,
    onClick: function () { setActiveCategory('all', null); },
    count: allEffects.length,
  }));

  // ─ Item "Favoritos" ─
  tree.appendChild(makeSidebarItem({
    label: 'Favoritos', icon: '★', isFav: true,
    dataCat: 'favorites', dataSub: '',
    isActive: activeCategory === 'favorites' && !activeSubcategory,
    onClick: function () { setActiveCategory('favorites', null); },
    count: getFavoriteIds().length,
  }));

  // ─ Item "Recentes" ─
  var recentsCount = getRecents().length;
  if (recentsCount > 0) {
    tree.appendChild(makeSidebarItem({
      label: 'Recentes', icon: '◷',
      dataCat: 'recents', dataSub: '',
      isActive: activeCategory === 'recents' && !activeSubcategory,
      onClick: function () { setActiveCategory('recents', null); },
      count: recentsCount,
    }));
  }

  // ─ Item "Mais usados" ─
  var mostUsedCount = getMostUsedIds(30).length;
  if (mostUsedCount > 0) {
    tree.appendChild(makeSidebarItem({
      label: 'Mais usados', icon: '⚡',
      dataCat: 'most-used', dataSub: '',
      isActive: activeCategory === 'most-used' && !activeSubcategory,
      onClick: function () { setActiveCategory('most-used', null); },
      count: mostUsedCount,
    }));
  }

  // ─ Separador ─
  var sep = document.createElement('div');
  sep.className = 'sidebar-sep';
  sep.textContent = 'Categorias';
  tree.appendChild(sep);

  // ─ Pastas de categorias ─
  driveCategories.forEach(function (cat) {
    var isExpanded = !!sidebarExpanded[cat.name];
    var subs = getSubcategoriesFor(cat.name);

    var item = makeSidebarItem({
      label: cat.name,
      icon: isExpanded ? '▾' : '▸',
      isFolder: true,
      dataCat: cat.name, dataSub: '',
      isActive: activeCategory === cat.name && !activeSubcategory,
      hasChildren: subs.length > 0,
      onClick: function () {
        if (!driveLoadedCats[cat.name]) {
          loadCategoryDeep(cat.name).then(function () {
            sidebarExpanded[cat.name] = true;
            buildSidebarTree();
            setActiveCategory(cat.name, null);
          });
        } else {
          sidebarExpanded[cat.name] = !sidebarExpanded[cat.name];
          buildSidebarTree();
          setActiveCategory(cat.name, null);
        }
      },
      count: cat.loaded ? allEffects.filter(function (e) { return e.category === cat.name; }).length : null,
    });
    tree.appendChild(item);

    if (isExpanded && subs.length) {
      subs.forEach(function (sub) {
        tree.appendChild(makeSidebarItem({
          label: sub.name, icon: '·', isSub: true,
          dataCat: cat.name, dataSub: sub.name,
          isActive: activeCategory === cat.name && activeSubcategory === sub.name,
          onClick: function () { setActiveCategory(cat.name, sub.name); },
          count: sub.count,
        }));
      });
    }
  });
}

/**
 * PERF: atualiza só a classe .is-active na sidebar SEM reconstruir o DOM.
 * Chamado por setActiveCategory quando estrutura não muda (caso comum).
 */
function updateSidebarActive() {
  var tree = document.getElementById('sidebar-tree');
  if (!tree) return;
  var items = tree.querySelectorAll('.sidebar-item');
  for (var i = 0; i < items.length; i++) {
    var el = items[i];
    var cat = el.dataset.cat;
    var sub = el.dataset.sub || null;
    var isActive = (cat === activeCategory && sub === (activeSubcategory || null) && (!sub || sub === activeSubcategory));
    el.classList.toggle('is-active', isActive);
  }
}

function makeSidebarItem(opts) {
  var btn = document.createElement('button');
  btn.className = 'sidebar-item'
    + (opts.isActive   ? ' is-active'   : '')
    + (opts.isFav      ? ' is-fav'      : '')
    + (opts.isFolder   ? ' is-folder'   : '')
    + (opts.isSub      ? ' is-sub'      : '');
  if (opts.dataCat != null) btn.dataset.cat = opts.dataCat;
  if (opts.dataSub != null) btn.dataset.sub = opts.dataSub;
  btn.innerHTML =
    '<span class="sidebar-icon">' + (opts.icon || '·') + '</span>' +
    '<span class="sidebar-label">' + opts.label + '</span>' +
    (opts.count != null
      ? '<span class="sidebar-count">' + opts.count + '</span>'
      : '');
  btn.addEventListener('click', opts.onClick);
  return btn;
}

function getSubcategoriesFor(categoryName) {
  var seen = {};
  var subs = [];
  allEffects.forEach(function (e) {
    if (e.category !== categoryName || !e.subcategory) return;
    if (!seen[e.subcategory]) {
      seen[e.subcategory] = 0;
      subs.push({ name: e.subcategory, count: 0 });
    }
    seen[e.subcategory]++;
  });
  subs.forEach(function (s) { s.count = seen[s.name]; });
  return subs.sort(function (a, b) { return a.name.localeCompare(b.name); });
}

/** Muda categoria/subcategoria ativa e re-renderiza */
function setActiveCategory(cat, sub) {
  activeCategory    = cat;
  activeSubcategory = sub;
  // PERF: limpa observer e fila de waveform — descarta trabalho da view antiga,
  // assim a nova view (qualquer categoria, não só "Geral") recebe waveform também.
  WAVEFORM_QUEUE = [];
  if (WAVEFORM_OBSERVER) {
    WAVEFORM_OBSERVER.disconnect();
    WAVEFORM_OBSERVER = null;
  }
  var search = document.getElementById('search-input').value.trim().toLowerCase();
  // PERF: diff em vez de wipe — só toggle de .is-active no DOM existente.
  // Estrutura da sidebar só muda em expand/collapse/load — quem cuida disso
  // chama buildSidebarTree() diretamente antes de chamar setActiveCategory.
  updateSidebarActive();
  filterEffects(search);
}

function countByCategory() {
  var counts = {};
  allEffects.forEach(function (e) {
    counts[e.category] = (counts[e.category] || 0) + 1;
  });
  return counts;
}

// ══ RECENTES & MAIS USADOS (localStorage) ══════════════════════
//
// Recentes: array de IDs em ordem de uso mais recente (max 50)
// Mais usados: { id: count } — incrementa por uso (apply)

var RECENTS_KEY = 'cinepro_recents_v1';
var USAGE_KEY   = 'cinepro_usage_v1';
var RECENTS_MAX = 50;

function getRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); }
  catch (e) { return []; }
}
function getUsage() {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); }
  catch (e) { return {}; }
}

function trackUsage(effectId) {
  // Recentes — push pro topo, dedupe, cap
  var rec = getRecents();
  var existing = rec.indexOf(effectId);
  if (existing !== -1) rec.splice(existing, 1);
  rec.unshift(effectId);
  if (rec.length > RECENTS_MAX) rec.length = RECENTS_MAX;
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(rec)); } catch (e) {}

  // Usage counter
  var u = getUsage();
  u[effectId] = (u[effectId] || 0) + 1;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch (e) {}
}

function getMostUsedIds(limit) {
  var u = getUsage();
  return Object.keys(u)
    .sort(function (a, b) { return u[b] - u[a]; })
    .slice(0, limit || 30);
}

// ══ FAVORITOS (localStorage) ════════════════════════════════════

var FAVS_KEY = 'cinepro_favorites_v1';

function getFavoriteIds() {
  try {
    return JSON.parse(localStorage.getItem(FAVS_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function isFavorite(id) {
  return getFavoriteIds().indexOf(id) !== -1;
}

function toggleFavorite(effect, card) {
  var favs = getFavoriteIds();
  var idx = favs.indexOf(effect.id);
  if (idx === -1) {
    favs.push(effect.id);
    if (card) card.classList.add('is-fav');
    showToast('Adicionado aos favoritos ★', 'success');
  } else {
    favs.splice(idx, 1);
    if (card) card.classList.remove('is-fav');
    showToast('Removido dos favoritos', '');
  }
  localStorage.setItem(FAVS_KEY, JSON.stringify(favs));

  // Atualiza badge da aba Favoritos
  var favTab = document.querySelector('.tab-favorites .tab-count');
  if (favTab) favTab.textContent = favs.length;

  // Se tá vendo a aba de favoritos, re-renderiza
  if (activeCategory === 'favorites') {
    var search = document.getElementById('search-input').value.trim().toLowerCase();
    filterEffects(search);
  }
}

// ══ RENDER EFFECTS ════════════════════════════════════════════

// ── INVERTED INDEX PRA BUSCA ────────────────────────────────────
// Pré-construído na carga (1× por sessão). Cada token ≥2 chars vira chave
// num Map<token, Set<effectIdx>>. Lookup vira O(k) onde k = nº de tokens
// na query, em vez de O(n) sobre 11k strings.
var SEARCH_INDEX = null;       // Map<token, Set<effectIdx>>
var SEARCH_INDEX_NAMES = null; // Array<string lowercased> p/ matching de substring tardio

function buildSearchIndex() {
  var t0 = performance.now();
  SEARCH_INDEX = new Map();
  SEARCH_INDEX_NAMES = new Array(allEffects.length);

  for (var i = 0; i < allEffects.length; i++) {
    var e = allEffects[i];
    var blob = (
      e.name + ' ' + e.category + ' ' +
      (e.subcategory || '') + ' ' +
      ((e.path && e.path.join) ? e.path.join(' ') : '') + ' ' +
      ((e.tags && e.tags.join) ? e.tags.join(' ') : '')
    ).toLowerCase();
    SEARCH_INDEX_NAMES[i] = blob;

    // Tokenize por whitespace, hífen, underscore, pontos
    var tokens = blob.split(/[\s\-_\.\/\\\(\)\[\]\,]+/);
    var seen = Object.create(null);
    for (var t = 0; t < tokens.length; t++) {
      var tok = tokens[t];
      if (tok.length < 2 || seen[tok]) continue;
      seen[tok] = 1;
      var bucket = SEARCH_INDEX.get(tok);
      if (!bucket) { bucket = new Set(); SEARCH_INDEX.set(tok, bucket); }
      bucket.add(i);
      // Também adiciona prefixos curtos pra autocompletar (ws→whoosh)
      if (tok.length >= 3) {
        var pref = tok.slice(0, 3);
        var prefBucket = SEARCH_INDEX.get(pref);
        if (!prefBucket) { prefBucket = new Set(); SEARCH_INDEX.set(pref, prefBucket); }
        prefBucket.add(i);
      }
    }
  }
  console.log('[CinePRO] inverted index: ' + SEARCH_INDEX.size + ' tokens em ' +
              ((performance.now() - t0) | 0) + 'ms (' + allEffects.length + ' items)');
}

/**
 * Busca no índice: AND entre tokens da query.
 * Tokens curtos (<2) caem em scan linear no NAMES array como fallback.
 */
function searchIndices(query) {
  if (!SEARCH_INDEX || !query) return null;
  var qTokens = query.split(/[\s\-_\.]+/).filter(function (t) { return t.length >= 2; });
  if (!qTokens.length) {
    // query muito curta — scan linear simples
    var out = [];
    for (var i = 0; i < SEARCH_INDEX_NAMES.length; i++) {
      if (SEARCH_INDEX_NAMES[i].indexOf(query) !== -1) out.push(i);
    }
    return new Set(out);
  }

  // AND incremental — começa pelo bucket menor (otimização clássica)
  var buckets = qTokens.map(function (t) {
    // Token exato; senão tenta prefixo de 3 chars; senão fallback scan
    return SEARCH_INDEX.get(t) || SEARCH_INDEX.get(t.slice(0, 3)) || null;
  });
  if (buckets.some(function (b) { return b === null; })) {
    // Algum token não indexado — fallback scan
    var out2 = [];
    for (var j = 0; j < SEARCH_INDEX_NAMES.length; j++) {
      if (qTokens.every(function (qt) { return SEARCH_INDEX_NAMES[j].indexOf(qt) !== -1; })) {
        out2.push(j);
      }
    }
    return new Set(out2);
  }
  buckets.sort(function (a, b) { return a.size - b.size; });

  var result = new Set();
  var first = buckets[0];
  first.forEach(function (idx) {
    for (var k = 1; k < buckets.length; k++) {
      if (!buckets[k].has(idx)) return;
    }
    // Verificação de substring real (índice tem prefixos, refina aqui)
    var blob = SEARCH_INDEX_NAMES[idx];
    for (var q = 0; q < qTokens.length; q++) {
      if (blob.indexOf(qTokens[q]) === -1) return;
    }
    result.add(idx);
  });
  return result;
}

// v1.2 Parte C — dicionário de conceitos vindo do manifest
var CINEPRO_CONCEPTS_DICT = null;

/**
 * Embed da query: mesmo algoritmo do builder, sparse { idx → count }.
 */
function embedQuery(query) {
  if (!CINEPRO_CONCEPTS_DICT) return null;
  var q = (query || '').toLowerCase();
  var out = {};
  for (var i = 0; i < CINEPRO_CONCEPTS_DICT.length; i++) {
    var keys = CINEPRO_CONCEPTS_DICT[i].keys || [];
    var count = 0;
    for (var k = 0; k < keys.length; k++) {
      if (q.indexOf(keys[k]) !== -1) count++;
    }
    if (count > 0) out[i] = count;
  }
  return out;
}

/**
 * Cosine similarity entre dois sparse vectors. Retorna 0..1.
 */
function cosineSparse(a, b) {
  if (!a || !b) return 0;
  var aKeys = Object.keys(a);
  var bKeys = Object.keys(b);
  if (aKeys.length === 0 || bKeys.length === 0) return 0;
  var dot = 0, magA = 0, magB = 0;
  for (var i = 0; i < aKeys.length; i++) {
    var k = aKeys[i];
    var av = a[k];
    magA += av * av;
    if (b[k] !== undefined) dot += av * b[k];
  }
  for (var j = 0; j < bKeys.length; j++) magB += b[bKeys[j]] * b[bKeys[j]];
  var denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Busca semântica: scan O(n) com cosine similarity. Retorna top-K
 * (idx, score) ordenado por score desc. Threshold mínimo: 0.15
 * (filtra ruído sem perder hits relevantes).
 */
function semanticSearch(query, limit) {
  var qEmbed = embedQuery(query);
  if (!qEmbed || Object.keys(qEmbed).length === 0) return [];
  limit = limit || 60;

  var results = [];
  for (var i = 0; i < allEffects.length; i++) {
    var e = allEffects[i];
    if (!e.embed) continue;
    var score = cosineSparse(qEmbed, e.embed);
    if (score >= 0.15) results.push({ idx: i, score: score });
  }
  results.sort(function (a, b) { return b.score - a.score; });
  return results.slice(0, limit);
}

function filterEffects(query) {
  // Sets pré-computados pra evitar lookup repetido
  var favSet = activeCategory === 'favorites' ? new Set(getFavoriteIds()) : null;

  // "Recentes" e "Mais usados" são virtuais — ordem importa, então construímos lista direto.
  if (activeCategory === 'recents') return renderEffectsByIdOrder(getRecents(), query);
  if (activeCategory === 'most-used') return renderEffectsByIdOrder(getMostUsedIds(30), query);

  // Query? Usa inverted index. Sem query, scan direto (rápido pra check de categoria)
  if (!query) {
    var filtered = allEffects.filter(function (e) {
      var inCat = activeCategory === 'all'
                || (activeCategory === 'favorites' && favSet.has(e.id))
                || e.category === activeCategory;
      if (activeSubcategory) inCat = inCat && e.subcategory === activeSubcategory;
      return inCat;
    });
    renderEffects(filtered);
    return;
  }

  // ── Híbrido textual + semântico ─────────────────────────
  // 1. Roda busca textual normal (inverted index)
  // 2. Se <5 resultados textuais, complementa com busca semântica
  // 3. Categoria/sub continuam filtrando ambos
  var textualIndices = searchIndices(query) || new Set();
  var seen = new Set();
  var result = [];

  textualIndices.forEach(function (idx) {
    var e = allEffects[idx];
    if (!e) return;
    var inCat = activeCategory === 'all'
              || (activeCategory === 'favorites' && favSet.has(e.id))
              || e.category === activeCategory;
    if (activeSubcategory) inCat = inCat && e.subcategory === activeSubcategory;
    if (inCat && !seen.has(idx)) {
      seen.add(idx);
      result.push(e);
    }
  });

  // Complementa com semântica quando textual rasa
  var TEXTUAL_THRESHOLD = 5;
  if (result.length < TEXTUAL_THRESHOLD * 3 && CINEPRO_CONCEPTS_DICT) {
    var semResults = semanticSearch(query, 60);
    for (var s = 0; s < semResults.length && result.length < 120; s++) {
      if (seen.has(semResults[s].idx)) continue;
      var e2 = allEffects[semResults[s].idx];
      if (!e2) continue;
      var inCat2 = activeCategory === 'all'
                 || (activeCategory === 'favorites' && favSet.has(e2.id))
                 || e2.category === activeCategory;
      if (activeSubcategory) inCat2 = inCat2 && e2.subcategory === activeSubcategory;
      if (inCat2) {
        seen.add(semResults[s].idx);
        result.push(e2);
      }
    }
  }

  renderEffects(result);
}

/** Renderiza efeitos NA ORDEM dada por uma lista de IDs (recentes/mais usados) */
function renderEffectsByIdOrder(ids, query) {
  var qLower = (query || '').toLowerCase();
  var result = [];
  for (var i = 0; i < ids.length; i++) {
    var e = effectsById[ids[i]];
    if (!e) continue;
    if (qLower) {
      var blob = (e.name + ' ' + e.category + ' ' + (e.tags||[]).join(' ')).toLowerCase();
      if (blob.indexOf(qLower) === -1) continue;
    }
    result.push(e);
  }
  renderEffects(result);
}

// ── PAGINAÇÃO INTERNA POR CATEGORIA ────────────────────────────
// Pra não criar 5000+ DOM nodes de uma vez (causa freeze do CEP),
// renderiza só BATCH_SIZE itens e exibe um botão "Carregar mais"
// que renderiza o próximo lote em rAF (sem travar a UI).
var PAGE_SIZE = 60;     // primeiro lote — menor pra UI ficar responsiva
var PAGE_STEP = 60;     // cada "carregar mais"
var renderState = null; // { effects, groups, labels, rendered }

function renderEffects(effects) {
  var grid = document.getElementById('effects-grid');
  grid.innerHTML = '';

  if (effects.length === 0) {
    if (activeCategory === 'favorites') {
      renderEmpty('Você ainda não favoritou nada.<br>Passe o mouse num card e clique na ⭐ pra começar.');
    } else if (activeCategory === 'recents') {
      renderEmpty('Nenhum efeito usado ainda.<br>Os que você aplicar vão aparecer aqui em ordem.');
    } else if (activeCategory === 'most-used') {
      renderEmpty('Nenhum efeito usado ainda.<br>O top dos seus mais usados vai surgir aqui.');
    } else if (activeCategory === 'all') {
      renderEmpty('Clique numa categoria acima pra começar 👆<br>Os arquivos são carregados sob demanda.');
    } else {
      renderEmpty('Nenhum efeito encontrado.<br>Tente outra palavra ou categoria.');
    }
    return;
  }

  // Agrupa pela categoria original em "Favoritos"/"Todos";
  // numa categoria, agrupa por subcategoria.
  var groups = {};
  var groupByCat = (activeCategory === 'favorites' || activeCategory === 'all');
  effects.forEach(function (e) {
    var label = groupByCat
              ? (e.category || 'Geral')
              : (e.subcategory || e.category);
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  });

  // Estado pro lazy render
  renderState = {
    groups:   groups,
    labels:   Object.keys(groups),
    cursorLabel: 0,   // qual label tá renderizando
    cursorItem:  0,   // qual item dentro da label
    rendered:    0,   // total renderizado
    total:       effects.length,
  };

  // PERF v1.2: primeiro batch SUB-divido em micro-chunks de 12 cards por frame
  // (60fps). UI nunca trava — antes era ~80-120ms síncrono pra 60 cards.
  renderInChunks(PAGE_SIZE, 12);
}

// Renderiza `target` cards distribuídos em frames de `perFrame` cada.
// Frame 1 é síncrono pra ter feedback imediato; resto via rAF.
function renderInChunks(target, perFrame) {
  if (!renderState) return;
  var firstChunk = Math.min(perFrame, target);
  renderNextBatch(firstChunk);
  if (renderState.rendered >= target || renderState.rendered >= renderState.total) return;
  requestAnimationFrame(function loop() {
    if (!renderState) return;
    if (renderState.rendered >= target || renderState.rendered >= renderState.total) return;
    renderNextBatch(Math.min(perFrame, target - renderState.rendered));
    if (renderState.rendered < target && renderState.rendered < renderState.total) {
      requestAnimationFrame(loop);
    }
  });
}

// PERF: agendar próximo trabalho durante idle time do browser
var scheduleIdle = (typeof requestIdleCallback === 'function')
  ? function (cb) { return requestIdleCallback(cb, { timeout: 500 }); }
  : function (cb) { return setTimeout(cb, 0); };

function renderNextBatch(count) {
  if (!renderState) return;
  var grid = document.getElementById('effects-grid');
  // Remove sentinela e botão antigo (recriam depois se ainda há mais)
  var sentinel = document.getElementById('scroll-sentinel');
  if (sentinel) sentinel.remove();
  var moreBtn = document.getElementById('load-more-btn');
  if (moreBtn) moreBtn.remove();

  var groups = renderState.groups;
  var labels = renderState.labels;
  var batchDone = 0;

  // Usa DocumentFragment pra batch insertion (1 reflow em vez de N)
  var frag = document.createDocumentFragment();

  while (batchDone < count && renderState.cursorLabel < labels.length) {
    var label = labels[renderState.cursorLabel];
    var items = groups[label];

    // Se é o primeiro item desse label, insere o title
    if (renderState.cursorItem === 0 && labels.length > 1) {
      var title = document.createElement('div');
      title.className = 'section-title';
      title.style.gridColumn = '1 / -1';
      title.innerHTML = '<span class="section-bullet"></span>' + label + ' <span class="section-count">' + items.length + '</span>';
      frag.appendChild(title);
    }

    while (renderState.cursorItem < items.length && batchDone < count) {
      var effect = items[renderState.cursorItem];
      var card = createEffectCard(effect);
      frag.appendChild(card);

      if (effect.kind === 'audio' && card.querySelector('.effect-thumb-placeholder')) {
        observeForWaveform(card, effect);
      }

      renderState.cursorItem++;
      renderState.rendered++;
      batchDone++;
    }

    // Acabou esse label?
    if (renderState.cursorItem >= items.length) {
      renderState.cursorLabel++;
      renderState.cursorItem = 0;
    }
  }

  grid.appendChild(frag);

  // Se tem mais, monta sentinela invisível + botão fallback escondido.
  // O observer dispara renderNextBatch quando o usuário chega a 400px do fim.
  if (renderState.rendered < renderState.total) {
    var sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    sentinel.style.cssText = 'grid-column:1/-1;height:1px;';
    grid.appendChild(sentinel);

    // Fallback: se observer não disparar (ex: viewport gigante), botão aparece
    var btn = document.createElement('button');
    btn.id = 'load-more-btn';
    btn.className = 'load-more-btn';
    btn.style.cssText = 'grid-column:1/-1;';
    btn.innerHTML = '↓ Carregar mais <span style="opacity:0.6">(' +
                    (renderState.total - renderState.rendered) + ' restantes)</span>';
    btn.addEventListener('click', function () { renderNextBatch(PAGE_STEP); });
    grid.appendChild(btn);

    observeScrollSentinel(sentinel);
  }
}

// Observer global do scroll infinito — recriado a cada batch porque sentinela muda.
var SCROLL_OBSERVER = null;
var SCROLL_DEBOUNCE_TS = 0;
function observeScrollSentinel(sentinel) {
  if (!('IntersectionObserver' in window)) return;  // botão fallback funciona
  if (SCROLL_OBSERVER) SCROLL_OBSERVER.disconnect();
  SCROLL_OBSERVER = new IntersectionObserver(function (entries) {
    if (!entries[0] || !entries[0].isIntersecting) return;
    // v1.2 A3: debounce — coalesce triggers se observer disparar mais de 1×
    // num scroll rápido. 200ms cooldown.
    var now = Date.now();
    if (now - SCROLL_DEBOUNCE_TS < 200) return;
    SCROLL_DEBOUNCE_TS = now;

    if (SCROLL_OBSERVER) {
      SCROLL_OBSERVER.disconnect();
      SCROLL_OBSERVER = null;
    }
    // Idle scheduling: próximo lote roda quando o browser estiver ocioso,
    // evita stutter no scroll que ainda está acontecendo
    scheduleIdle(function () { renderNextBatch(PAGE_STEP); });
  }, { rootMargin: '400px' });
  SCROLL_OBSERVER.observe(sentinel);
}

// IntersectionObserver compartilhado pra waveform lazy
var WAVEFORM_OBSERVER = null;
function observeForWaveform(card, effect) {
  if (!('IntersectionObserver' in window)) {
    requestWaveform(effect, card);
    return;
  }
  if (!WAVEFORM_OBSERVER) {
    WAVEFORM_OBSERVER = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var c = e.target;
          var fx = c._cinepro_effect;
          if (fx) requestWaveform(fx, c);
          WAVEFORM_OBSERVER.unobserve(c);
        }
      });
    }, { rootMargin: '200px' });
  }
  card._cinepro_effect = effect;
  WAVEFORM_OBSERVER.observe(card);
}

function renderEmpty(msg) {
  var grid = document.getElementById('effects-grid');
  grid.innerHTML = '<div class="state-box" style="grid-column:1/-1"><div class="state-icon">🎬</div><div class="state-desc">' + msg + '</div></div>';
}

// Cache de arquivos já baixados nessa sessão (effect.id → localPath)
var effectCache = {};

// Índice global pra event delegation conseguir achar o effect a partir do data-id
var effectsById = Object.create(null);

// IntersectionObserver pra thumbnails lazy (substitui loading="lazy" nativo,
// que dispara cedo demais com content-visibility:auto)
var THUMB_OBSERVER = null;
function ensureThumbObserver() {
  if (THUMB_OBSERVER || !('IntersectionObserver' in window)) return THUMB_OBSERVER;
  THUMB_OBSERVER = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var img = entry.target;
      var src = img.dataset.src;
      if (src && !img.src) {
        img.src = src;
        img.removeAttribute('data-src');
      }
      THUMB_OBSERVER.unobserve(img);
    });
  }, { rootMargin: '300px' });
  return THUMB_OBSERVER;
}

/**
 * v1.2 A2: fallback automático quando thumb do Drive expira.
 * O thumbnailLink tem token que expira em ~horas. Quando manifest está velho
 * (entre rebuilds semanais), muitos thumbs voltam 403/404. Fallback usa o
 * endpoint público de thumb do Drive baseado no ID (sempre válido).
 */
function attachThumbErrorFallback(imgEl, effectId) {
  imgEl.addEventListener('error', function () {
    if (imgEl.dataset.refreshed) {
      // Já tentou fallback — não há mais nada a fazer, esconde o broken icon
      imgEl.style.opacity = '0';
      return;
    }
    imgEl.dataset.refreshed = '1';
    imgEl.src = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(effectId) + '&sz=w320';
  }, { once: false });
}

/**
 * Card slim — DOM minimalista (6 nodes vs 16 antes).
 * SEM listeners individuais: tudo via delegation no grid (ver bindGridDelegation).
 */
function createEffectCard(effect) {
  effectsById[effect.id] = effect;

  var cached = !!effectCache[effect.id];
  var isFav  = isFavorite(effect.id);
  var canPreview = (effect.kind === 'audio' || effect.kind === 'video' || effect.kind === 'image');

  var card = document.createElement('div');
  card.className  = 'effect-card' + (cached ? ' cached' : '') + (isFav ? ' is-fav' : '');
  card.draggable  = true;
  card.dataset.id   = effect.id;
  card.dataset.ext  = effect.ext || '';
  card.dataset.kind = effect.kind || '';

  var thumbHtml;
  // v1.3: prefere thumb do bundle (instantâneo, nunca expira)
  var bundleThumb = getBundleThumbPath(effect.id);
  if (bundleThumb) {
    var fileUrl = 'file://' + bundleThumb.split('/').map(encodeURIComponent).join('/');
    thumbHtml = '<img class="thumb-img" data-src="' + fileUrl + '" alt="" decoding="async">';
  } else if (effect.thumb) {
    thumbHtml = '<img class="thumb-img" data-src="' + effect.thumb + '" alt="" decoding="async" fetchpriority="low">';
  } else {
    thumbHtml = '<div class="effect-thumb-placeholder">' + thumbForKind(effect.kind) + '</div>';
  }

  var typeBadge = effect.ext ? '<span class="effect-type-badge ' + effect.ext + '">' + effect.ext.toUpperCase() + '</span>' : '';
  var previewBtn = canPreview
    ? '<button class="btn btn--floating btn--icon btn-preview" data-action="preview" title="Preview" aria-label="Preview">▶</button>'
    : '';

  card.innerHTML =
    '<button class="btn btn--floating btn--icon btn--sm btn-fav" data-action="fav" title="Favoritar" aria-label="Favoritar">' +
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round">' +
        '<polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2"/>' +
      '</svg>' +
    '</button>' +
    '<div class="effect-thumb">' + thumbHtml + previewBtn + '<span class="drag-hint">' + (cached ? '⇲ arrastar' : '⇩ preparar') + '</span></div>' +
    /* v1.2 A4: download-overlay agora é lazy — só injetado quando download começa */
    '<div class="effect-card-body">' +
      '<div class="effect-name" title="' + effect.name + '">' + effect.name + '</div>' +
      '<div class="effect-meta">' + typeBadge + '<button class="btn btn--soft btn--xs btn-apply" data-action="apply">Aplicar</button></div>' +
    '</div>';

  // Lazy thumb observer + fallback on-error pra thumbs expirados
  if (effect.thumb) {
    var imgEl = card.querySelector('.thumb-img');
    attachThumbErrorFallback(imgEl, effect.id);
    var obs = ensureThumbObserver();
    if (obs) obs.observe(imgEl);
    else imgEl.src = effect.thumb;  // fallback sem observer
  }

  return card;
}

/**
 * Event delegation: UM listener no #effects-grid pra TODOS os cards.
 * Antes: 4-5 listeners × 60 cards = 240+ listeners. Agora: 4 no container.
 */
var GRID_DELEGATION_BOUND = false;
var HOVER_PREFETCH_TIMER = null;
var HOVER_PREFETCH_LAST_ID = null;
function bindGridDelegation() {
  if (GRID_DELEGATION_BOUND) return;
  GRID_DELEGATION_BOUND = true;
  var grid = document.getElementById('effects-grid');
  if (!grid) return;

  // Hover prefetch: 500ms parado sobre o card dispara download silencioso.
  // Quando user arrasta depois, arquivo já tá em disco = drag instantâneo.
  grid.addEventListener('mouseover', function (e) {
    var card = e.target.closest('.effect-card');
    if (!card) return;
    var effectId = card.dataset.id;
    if (!effectId || effectId === HOVER_PREFETCH_LAST_ID) return;
    if (effectCache[effectId]) return;  // já tá em cache
    HOVER_PREFETCH_LAST_ID = effectId;
    if (HOVER_PREFETCH_TIMER) clearTimeout(HOVER_PREFETCH_TIMER);
    HOVER_PREFETCH_TIMER = setTimeout(function () {
      var effect = effectsById[effectId];
      if (effect) silentPrefetch(effect, card);
    }, 500);
  });
  grid.addEventListener('mouseout', function (e) {
    var card = e.target.closest('.effect-card');
    if (!card) return;
    if (HOVER_PREFETCH_TIMER) {
      clearTimeout(HOVER_PREFETCH_TIMER);
      HOVER_PREFETCH_TIMER = null;
    }
    HOVER_PREFETCH_LAST_ID = null;
  });

  // Click — apply / fav / preview
  grid.addEventListener('click', function (e) {
    var actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    var card = actionBtn.closest('.effect-card');
    if (!card) return;
    var effect = effectsById[card.dataset.id];
    if (!effect) return;
    e.stopPropagation();
    e.preventDefault();
    switch (actionBtn.dataset.action) {
      case 'apply':   applyEffect(effect, card); break;
      case 'fav':     toggleFavorite(effect, card); break;
      case 'preview': togglePlayInline(effect, card); break;
    }
  });

  // Mousedown — drag-to-timeline (precisa ser SÍNCRONO no CEP)
  grid.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('[data-action]')) return;
    var card = e.target.closest('.effect-card');
    if (!card) return;
    var effectId = card.dataset.id;
    var localPath = effectCache[effectId];
    if (localPath && window.__adobe_cep__) {
      try {
        window.__adobe_cep__.dispatchEvent({
          type: 'com.adobe.cep.dragdrop', scope: 'GLOBAL', appId: 'PPRO',
        });
        window.__adobe_cep__.startDragToExternal(localPath, null, null, null);
      } catch (err) {
        console.error('[CinePRO] drag falhou:', err);
      }
    }
  });

  // Dragstart — fallback pra preparar se não tem cache
  grid.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.effect-card');
    if (!card) return;
    var effect = effectsById[card.dataset.id];
    if (!effect) return;
    if (effectCache[effect.id]) return;  // já tem, deixa drag rolar
    e.preventDefault();
    prepareForDrag(effect, card);
  });

  // Cmd/Ctrl+click ou Shift+click → seleção (em vez de iniciar drag)
  // Click normal num card vazio não faz nada (drag é via mousedown nativo)
  grid.addEventListener('click', function (e) {
    if (e.target.closest('[data-action]')) return;  // botões tratam acima
    var card = e.target.closest('.effect-card');
    if (!card) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleCardSelection(card);
    } else if (e.shiftKey) {
      e.preventDefault();
      selectRangeTo(card);
    } else if (selection.size > 0) {
      // Click sem modificador com seleção ativa → limpa seleção
      clearSelection();
    }
  });
}

// ══ MULTI-SELECT ════════════════════════════════════════════════
// Cmd/Ctrl+click toggle; Shift+click range; Esc limpa.
// Floating button "Aplicar (N)" aparece quando selection.size > 0.

var selection = new Set();        // effect.id Set
var lastSelectedId = null;        // pra Shift+click range
var APPLY_FLOATING_BTN = null;

function toggleCardSelection(card) {
  var id = card.dataset.id;
  if (!id) return;
  if (selection.has(id)) {
    selection.delete(id);
    card.classList.remove('is-selected');
  } else {
    selection.add(id);
    card.classList.add('is-selected');
    lastSelectedId = id;
  }
  updateApplyFloating();
}

function selectRangeTo(card) {
  var id = card.dataset.id;
  if (!id) return;
  if (!lastSelectedId) { toggleCardSelection(card); return; }
  // Acha índices visíveis dos dois cards
  var cards = document.querySelectorAll('#effects-grid .effect-card');
  var a = -1, b = -1;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].dataset.id === lastSelectedId) a = i;
    if (cards[i].dataset.id === id) b = i;
  }
  if (a < 0 || b < 0) { toggleCardSelection(card); return; }
  var from = Math.min(a, b), to = Math.max(a, b);
  for (var j = from; j <= to; j++) {
    var c = cards[j];
    selection.add(c.dataset.id);
    c.classList.add('is-selected');
  }
  lastSelectedId = id;
  updateApplyFloating();
}

function clearSelection() {
  selection.forEach(function (id) {
    var el = document.querySelector('.effect-card[data-id="' + cssEscape(id) + '"]');
    if (el) el.classList.remove('is-selected');
  });
  selection.clear();
  lastSelectedId = null;
  updateApplyFloating();
}

function cssEscape(s) {
  // Drive IDs são alfanum + _- — seguros, mas defensivo
  return String(s).replace(/[^a-zA-Z0-9_\-]/g, '');
}

function updateApplyFloating() {
  var n = selection.size;
  if (n === 0) {
    if (APPLY_FLOATING_BTN) APPLY_FLOATING_BTN.classList.remove('is-visible');
    return;
  }
  if (!APPLY_FLOATING_BTN) {
    APPLY_FLOATING_BTN = document.createElement('button');
    APPLY_FLOATING_BTN.id = 'apply-floating-btn';
    APPLY_FLOATING_BTN.className = 'apply-floating-btn';
    APPLY_FLOATING_BTN.addEventListener('click', applySelection);
    document.body.appendChild(APPLY_FLOATING_BTN);
  }
  APPLY_FLOATING_BTN.innerHTML =
    '<span class="apply-floating-count">' + n + '</span>' +
    '<span>Aplicar selecionados</span>' +
    '<span class="apply-floating-x" title="Limpar seleção (Esc)">✕</span>';
  // X interno limpa sem aplicar
  APPLY_FLOATING_BTN.querySelector('.apply-floating-x').onclick = function (ev) {
    ev.stopPropagation();
    clearSelection();
  };
  APPLY_FLOATING_BTN.classList.add('is-visible');
}

/**
 * Aplica todos os selecionados em ORDEM (na fila — sequencial pra evitar
 * conflito de import no Premiere). Mantém ordem visual da seleção.
 */
function applySelection() {
  if (selection.size === 0) return;
  // Ordena pela ordem visual atual (mesmo loop usado em selectRangeTo)
  var cards = Array.prototype.slice.call(document.querySelectorAll('#effects-grid .effect-card'));
  var ordered = cards.filter(function (c) { return selection.has(c.dataset.id); });

  showToast('Aplicando ' + ordered.length + ' efeito' + (ordered.length > 1 ? 's' : '') + '...', '');

  var queue = ordered.slice();
  function next() {
    if (!queue.length) {
      showToast('✓ ' + ordered.length + ' efeito' + (ordered.length > 1 ? 's aplicados' : ' aplicado'), 'success');
      clearSelection();
      return;
    }
    var card = queue.shift();
    var effect = effectsById[card.dataset.id];
    if (!effect) return next();
    applyEffectSilent(effect, card).then(next, next);
  }
  next();
}

/** applyEffect sem toast individual (usado em batch). Devolve Promise. */
function applyEffectSilent(effect, card) {
  return new Promise(function (resolve, reject) {
    if (card.classList.contains('downloading')) return resolve();
    var cachedPath = effectCache[effect.id];
    var dl = cachedPath ? Promise.resolve(cachedPath)
                        : downloadEffectFile(effect).then(function (p) { effectCache[effect.id] = p; return p; });

    card.classList.add('downloading');
  ensureDownloadOverlay(card);
    dl.then(function (localPath) {
      card.classList.remove('downloading');
      removeDownloadOverlay(card);
      card.classList.add('cached');
      cs.evalScript(
        'applyEffectToSelection("' + escapePath(localPath) + '", "' + effect.ext + '")',
        function (result) {
          if (!result || result.startsWith('ERR:')) {
            console.warn('[CinePRO] batch fail:', effect.name, result);
            reject(result);
          } else {
            trackUsage(effect.id);
            resolve(result);
          }
        }
      );
    }).catch(function (err) {
      card.classList.remove('downloading');
      removeDownloadOverlay(card);
      console.warn('[CinePRO] batch download fail:', effect.name, err.message);
      reject(err);
    });
  });
}

// ══ KEYBOARD SHORTCUTS ═════════════════════════════════════════
// ⌘F busca · ↑↓←→ navega · Enter aplica · Espaço preview
// ⌘D fav · Esc limpa seleção/busca

var focusedCardEl = null;  // card atualmente "focado" pelo teclado

function setFocusedCard(card) {
  if (focusedCardEl) focusedCardEl.classList.remove('is-focused');
  focusedCardEl = card;
  if (card) {
    card.classList.add('is-focused');
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function moveFocusBy(deltaCol, deltaRow) {
  var cards = Array.prototype.slice.call(document.querySelectorAll('#effects-grid .effect-card'));
  if (!cards.length) return;
  if (!focusedCardEl) { setFocusedCard(cards[0]); return; }

  var idx = cards.indexOf(focusedCardEl);
  if (idx === -1) { setFocusedCard(cards[0]); return; }

  // Calcula colunas medindo cards na primeira linha
  var firstTop = cards[0].offsetTop;
  var cols = 0;
  for (var i = 0; i < cards.length && cards[i].offsetTop === firstTop; i++) cols++;
  if (cols < 1) cols = 1;

  var next = idx + deltaCol + (deltaRow * cols);
  if (next < 0) next = 0;
  if (next >= cards.length) next = cards.length - 1;
  setFocusedCard(cards[next]);
}

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', function (e) {
    // Não captura quando user tá digitando num input
    var t = e.target;
    var isTyping = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    var meta = e.metaKey || e.ctrlKey;

    // ⌘F → foca busca
    if (meta && (e.key === 'f' || e.key === 'F')) {
      var input = document.getElementById('search-input');
      if (input) {
        e.preventDefault();
        input.focus();
        input.select();
      }
      return;
    }

    // Esc → limpa busca / seleção / fecha modais
    if (e.key === 'Escape') {
      var modal = document.querySelector('.update-modal.is-open');
      if (modal) { modal.classList.remove('is-open'); return; }
      if (isTyping && t.id === 'search-input') {
        t.value = '';
        var clear = document.getElementById('search-clear');
        if (clear) clear.style.display = 'none';
        filterEffects('');
        t.blur();
        return;
      }
      if (selection.size > 0) { clearSelection(); return; }
      if (focusedCardEl) { setFocusedCard(null); return; }
    }

    if (isTyping) return;  // resto dos atalhos só funcionam fora de input

    // ↑↓←→ navegação no grid
    if (e.key === 'ArrowRight') { e.preventDefault(); moveFocusBy(1, 0); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); moveFocusBy(-1, 0); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveFocusBy(0, 1); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveFocusBy(0, -1); return; }

    // Enter → aplica o focado (ou tudo da seleção se > 0)
    if (e.key === 'Enter') {
      if (selection.size > 0) { e.preventDefault(); applySelection(); return; }
      if (focusedCardEl) {
        var fx = effectsById[focusedCardEl.dataset.id];
        if (fx) { e.preventDefault(); applyEffect(fx, focusedCardEl); }
      }
      return;
    }

    // Espaço → preview
    if (e.key === ' ' && focusedCardEl) {
      e.preventDefault();
      var fx2 = effectsById[focusedCardEl.dataset.id];
      if (fx2) togglePlayInline(fx2, focusedCardEl);
      return;
    }

    // ⌘D → favorita o focado
    if (meta && (e.key === 'd' || e.key === 'D') && focusedCardEl) {
      e.preventDefault();
      var fx3 = effectsById[focusedCardEl.dataset.id];
      if (fx3) toggleFavorite(fx3, focusedCardEl);
      return;
    }

    // / sem modificador → foca busca (UX padrão tipo GitHub)
    if (e.key === '/' && !meta) {
      var input2 = document.getElementById('search-input');
      if (input2) { e.preventDefault(); input2.focus(); }
    }
  });
}

// ══ PREVIEW INLINE (sem modal) ══════════════════════════════════
// Click no ▶ toca o áudio/vídeo direto no card. Click de novo → pausa.
// Outro card → fecha o anterior automaticamente.

var currentlyPlaying = null;  // referência ao card que tá tocando

function togglePlayInline(effect, card) {
  // Se esse card já tá tocando → pausa
  if (currentlyPlaying === card) {
    stopInline(card);
    return;
  }

  // Se outro card tá tocando → para ele
  if (currentlyPlaying) {
    stopInline(currentlyPlaying);
  }

  // PERF: se já temos o arquivo em cache local, toca por file:// (instantâneo).
  // Senão, stream do Drive E dispara prefetch silencioso pra próxima play ser instantânea.
  var url;
  var localPath = effectCache[effect.id];
  if (localPath) {
    url = 'file://' + localPath.split('/').map(encodeURIComponent).join('/');
  } else {
    url = 'https://www.googleapis.com/drive/v3/files/' + effect.id
        + '?alt=media&key=' + CINEPRO_CONFIG.GOOGLE_DRIVE_API_KEY;
    // background — não bloqueia o play atual
    silentPrefetch(effect, card);
  }

  if (effect.kind === 'audio') {
    var audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    card._audio = audio;
    audio.addEventListener('ended', function () { stopInline(card); });
    audio.addEventListener('error', function () {
      console.warn('[CinePRO] preview falhou:', effect.name, audio.error && audio.error.code);
      showToast('Preview indisponível pra "' + effect.name + '". Use Aplicar.', 'error');
      stopInline(card);
    });
    audio.play().catch(function (err) {
      console.warn('[CinePRO] play falhou:', effect.name, err && err.message);
      showToast('Preview falhou: ' + (err && err.message || 'erro desconhecido'), 'error');
      stopInline(card);
    });
  } else if (effect.kind === 'video' || effect.kind === 'image') {
    // Pra vídeo: cria um <video> sobre o thumb e toca
    var thumb = card.querySelector('.effect-thumb');
    var existing = card.querySelector('.inline-video');
    if (existing) existing.remove();
    if (effect.kind === 'video') {
      var v = document.createElement('video');
      v.className = 'inline-video';
      v.src = url;
      v.autoplay = true;
      v.loop = true;
      v.muted = false;
      v.playsInline = true;
      v.controls = false;
      v.addEventListener('error', function () {
        console.warn('[CinePRO] preview video falhou:', effect.name, v.error && v.error.code);
        showToast('Preview indisponível pra "' + effect.name + '". Use Aplicar.', 'error');
        stopInline(card);
      });
      thumb.appendChild(v);
      card._video = v;
    }
    // image: já mostra o thumb, não precisa fazer nada extra
  }

  card.classList.add('is-playing');
  // Troca o ícone do botão pra ⏸
  var btn = card.querySelector('.btn-preview');
  if (btn) btn.textContent = '⏸';

  currentlyPlaying = card;
}

function stopInline(card) {
  if (!card) return;
  if (card._audio) { card._audio.pause(); card._audio = null; }
  if (card._video) { card._video.pause(); card._video.remove(); card._video = null; }
  card.classList.remove('is-playing');
  var btn = card.querySelector('.btn-preview');
  if (btn) btn.textContent = '▶';
  if (currentlyPlaying === card) currentlyPlaying = null;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
  return (bytes/1024/1024/1024).toFixed(2) + ' GB';
}

// (modal preview foi removido — preview agora é inline no card)

// ══ WAVEFORM (Web Worker + IndexedDB) ══════════════════════════
// v1.0.12: decode em Worker (UI nunca trava); cache persistente
// em IndexedDB (sobrevive a restart do Premiere).

var WAVEFORM_PENDING = {};   // id → [thumbEl, thumbEl...] (deduplica + multi-target)
var WAVEFORM_QUEUE = [];     // throttling
var WAVEFORM_PROCESSING = 0;
var WAVEFORM_MAX_CONCURRENT = 3;  // worker offload permite mais paralelo

// Worker compartilhado (criado sob demanda)
var WAVEFORM_WORKER = null;
var WAVEFORM_WORKER_CALLBACKS = {};  // id → { resolve, reject }
function getWaveformWorker() {
  if (WAVEFORM_WORKER || typeof Worker === 'undefined') return WAVEFORM_WORKER;
  try {
    WAVEFORM_WORKER = new Worker('js/waveform-worker.js');
    WAVEFORM_WORKER.onmessage = function (e) {
      var data = e.data || {};
      var cb = WAVEFORM_WORKER_CALLBACKS[data.id];
      if (!cb) return;
      delete WAVEFORM_WORKER_CALLBACKS[data.id];
      if (data.error) cb.reject(new Error(data.error));
      else cb.resolve(data);
    };
    WAVEFORM_WORKER.onerror = function (err) {
      console.warn('[CinePRO] waveform worker erro:', err.message);
    };
  } catch (e) {
    console.warn('[CinePRO] Worker indisponível, fallback main thread');
    WAVEFORM_WORKER = false;  // marca como tentado
  }
  return WAVEFORM_WORKER;
}

function requestWaveform(effect, card) {
  if (effect.kind !== 'audio') return;

  var thumbEl = card.querySelector('.effect-thumb-placeholder');
  if (!thumbEl) return;

  // Cache hit em IndexedDB? (assíncrono mas geralmente instantâneo)
  idbGet('waveform:' + effect.id).then(function (cached) {
    if (cached) {
      renderWaveformImg(thumbEl, cached);
      return;
    }
    // Já tem renderização nesse card? (re-render de categoria)
    if (thumbEl.querySelector('.waveform-img')) return;

    if (WAVEFORM_PENDING[effect.id]) {
      WAVEFORM_PENDING[effect.id].push(thumbEl);
      return;
    }
    WAVEFORM_PENDING[effect.id] = [thumbEl];
    WAVEFORM_QUEUE.push({ effect: effect, thumbEl: thumbEl });
    pumpWaveformQueue();
  });
}

function pumpWaveformQueue() {
  while (WAVEFORM_PROCESSING < WAVEFORM_MAX_CONCURRENT && WAVEFORM_QUEUE.length) {
    (function () {
      var task = WAVEFORM_QUEUE.shift();
      WAVEFORM_PROCESSING++;
      generateWaveform(task.effect).then(function (dataUrl) {
        if (dataUrl) {
          // Persiste no IndexedDB (não bloqueia)
          idbSet('waveform:' + task.effect.id, dataUrl);
          var targets = WAVEFORM_PENDING[task.effect.id] || [task.thumbEl];
          targets.forEach(function (t) { renderWaveformImg(t, dataUrl); });
        }
      }).catch(function (err) {
        console.warn('[CinePRO] waveform falhou:', task.effect.name, err && err.message);
      }).then(function () {
        delete WAVEFORM_PENDING[task.effect.id];
        WAVEFORM_PROCESSING--;
        pumpWaveformQueue();
      });
    })();
  }
}

function renderWaveformImg(thumbEl, dataUrl) {
  thumbEl.innerHTML = '<img class="waveform-img" src="' + dataUrl + '" alt="">';
}

/**
 * Tenta Worker primeiro (UI nunca trava); se Worker indisponível,
 * decoda no main thread como fallback.
 */
function generateWaveform(effect) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + effect.id
          + '?alt=media&key=' + CINEPRO_CONFIG.GOOGLE_DRIVE_API_KEY;

  var worker = getWaveformWorker();
  if (worker) {
    return new Promise(function (resolve, reject) {
      WAVEFORM_WORKER_CALLBACKS[effect.id] = { resolve: function (data) {
        // Worker mandou amps normalizadas → desenha no main (canvas precisa DOM)
        try { resolve(drawWaveformFromAmps(data.amps, data.width)); }
        catch (e) { reject(e); }
      }, reject: reject };
      worker.postMessage({ id: effect.id, url: url });
      // timeout 30s
      setTimeout(function () {
        if (WAVEFORM_WORKER_CALLBACKS[effect.id]) {
          var cb = WAVEFORM_WORKER_CALLBACKS[effect.id];
          delete WAVEFORM_WORKER_CALLBACKS[effect.id];
          cb.reject(new Error('worker timeout'));
        }
      }, 30000);
    });
  }

  // Fallback: main thread (legado)
  return fetchWithRetry(url)
    .then(function (r) { return r.arrayBuffer(); })
    .then(function (buf) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      var ctx = new AC();
      return ctx.decodeAudioData(buf).then(function (audioBuffer) {
        ctx.close();
        return drawWaveformFromBuffer(audioBuffer);
      });
    });
}

/** Desenha waveform a partir de array de amps já normalizadas (vindo do Worker) */
function drawWaveformFromAmps(amps, width) {
  var W = width || 320, H = 64;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  var g = canvas.getContext('2d');
  var gradient = g.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, '#4DD2FF');
  gradient.addColorStop(1, '#0088CC');
  g.fillStyle = gradient;
  var barW = 2, gap = 1;
  var count = Math.floor(W / (barW + gap));
  for (var b = 0; b < count; b++) {
    var idx = Math.floor((b / count) * W);
    var amp = amps[idx] || 0;
    var barH = Math.max(2, amp * H * 0.9);
    var x = b * (barW + gap);
    var y = (H - barH) / 2;
    g.fillRect(x, y, barW, barH);
  }
  return canvas.toDataURL('image/png');
}

/** Fallback: extrai amps de AudioBuffer no main thread + desenha */
function drawWaveformFromBuffer(audioBuffer) {
  var W = 320;
  var data = audioBuffer.getChannelData(0);
  var step = Math.floor(data.length / W);
  if (step < 1) step = 1;
  var amps = new Float32Array(W);
  for (var i = 0; i < W; i++) {
    var sum = 0;
    var base = i * step;
    for (var j = 0; j < step; j++) sum += Math.abs(data[base + j] || 0);
    amps[i] = sum / step;
  }
  var max = 0;
  for (var k = 0; k < W; k++) if (amps[k] > max) max = amps[k];
  if (max > 0) for (var n = 0; n < W; n++) amps[n] /= max;
  return drawWaveformFromAmps(amps, W);
}

function thumbForKind(kind) {
  // SVGs limpos — sem emoji. Estilo line-icon consistente com o resto da UI.
  var common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  var icons = {
    audio:  '<svg ' + common + '><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    video:  '<svg ' + common + '><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    image:  '<svg ' + common + '><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    mogrt:  '<svg ' + common + '><path d="M4 4h16v16H4z"/><path d="M4 9h16"/><path d="M9 4v16"/></svg>',
    preset: '<svg ' + common + '><path d="M12 2l2.4 6.9L21 9.3l-5.4 4.6L17.4 21 12 17.3 6.6 21l1.8-7.1L3 9.3l6.6-.4z"/></svg>',
    lut:    '<svg ' + common + '><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18"/></svg>',
    ae:     '<svg ' + common + '><circle cx="12" cy="12" r="9"/><path d="M9 16l3-9 3 9M10 13h4"/></svg>',
    project:'<svg ' + common + '><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    lumetri:'<svg ' + common + '><circle cx="12" cy="12" r="9"/><path d="M3 12a9 9 0 0 1 18 0"/></svg>',
  };
  return icons[kind] || icons.video;
}

// ══ APPLY / DRAG ══════════════════════════════════════════════

/**
 * Baixa o arquivo para temp e o insere na timeline via ExtendScript
 */
// v1.2 A4: injeta overlay de download sob demanda (era estático no DOM)
function ensureDownloadOverlay(card) {
  var existing = card.querySelector('.download-overlay');
  if (existing) return existing;
  var ov = document.createElement('div');
  ov.className = 'download-overlay';
  ov.innerHTML = '<div class="download-spinner"></div><div class="download-label">Baixando...</div>';
  card.appendChild(ov);
  return ov;
}
function removeDownloadOverlay(card) {
  var ov = card.querySelector('.download-overlay');
  if (ov) ov.remove();
}

function applyEffect(effect, card) {
  if (card.classList.contains('downloading')) return;

  // Se já tá em cache, pula download
  var cachedPath = effectCache[effect.id];
  var downloadPromise = cachedPath
    ? Promise.resolve(cachedPath)
    : downloadEffectFile(effect).then(function (p) { effectCache[effect.id] = p; return p; });

  card.classList.add('downloading');
  ensureDownloadOverlay(card);
  setStatus('loading', cachedPath ? 'Inserindo...' : 'Baixando "' + effect.name + '"...');

  downloadPromise
    .then(function (localPath) {
      card.classList.remove('downloading');
      removeDownloadOverlay(card);
      card.classList.add('cached');
      setStatus('loading', 'Inserindo na timeline...');

      // v1.2 Parte B: applyEffectToSelection é smart — se há clips selecionados,
      // aplica no IN POINT deles; senão, fallback pra playhead. Função única
      // cobre os dois casos sem duplicar lógica.
      cs.evalScript(
        'applyEffectToSelection("' + escapePath(localPath) + '", "' + effect.ext + '")',
        function (result) {
          if (!result || result.startsWith('ERR:')) {
            var msg = result ? result.replace('ERR:', '') : 'Erro desconhecido';
            setStatus('error', 'Erro: ' + msg);
            showToast('Erro ao inserir: ' + humanizeError(msg), 'error');
          } else {
            setStatus('ok', '"' + effect.name + '" pronto!');
            showToast(successMessage(effect, result), 'success');
            trackUsage(effect.id);  // Recentes + counter
          }
        }
      );
    })
    .catch(function (err) {
      card.classList.remove('downloading');
      removeDownloadOverlay(card);
      setStatus('error', 'Erro no download');
      showToast('Falha ao baixar: ' + err.message, 'error');
    });
}

/**
 * Pré-cache silencioso (hover, preview). Não mostra toast nem status global,
 * só ativa o ícone de "cached" no card quando termina.
 */
var prefetchQueue = {};  // id → Promise (deduplica downloads concorrentes)

function silentPrefetch(effect, card) {
  if (effectCache[effect.id]) return Promise.resolve(effectCache[effect.id]);
  if (prefetchQueue[effect.id]) return prefetchQueue[effect.id];

  if (card) card.classList.add('prefetching');

  var p = downloadEffectFile(effect)
    .then(function (localPath) {
      effectCache[effect.id] = localPath;
      delete prefetchQueue[effect.id];
      if (card) {
        card.classList.remove('prefetching');
        card.classList.add('cached');
        var hint = card.querySelector('.drag-hint');
        if (hint) hint.textContent = '⇲ arrastar';
      }
      return localPath;
    })
    .catch(function (err) {
      delete prefetchQueue[effect.id];
      if (card) card.classList.remove('prefetching');
      // sem toast — é background
      console.warn('[CinePRO] prefetch falhou:', err.message);
    });

  prefetchQueue[effect.id] = p;
  return p;
}

/**
 * Pré-baixa o arquivo e marca o card como "pronto pra arrastar".
 * O drag de verdade acontece em outro mousedown do usuário.
 */
function prepareForDrag(effect, card) {
  if (card.classList.contains('downloading')) return;
  if (effectCache[effect.id]) return;  // já tá pronto

  card.classList.add('downloading');
  ensureDownloadOverlay(card);
  setStatus('loading', 'Preparando "' + effect.name + '"...');

  downloadEffectFile(effect)
    .then(function (localPath) {
      effectCache[effect.id] = localPath;
      card.classList.remove('downloading');
      removeDownloadOverlay(card);
      card.classList.add('cached');
      card.querySelector('.drag-hint').textContent = '⇲ arrastar';
      setStatus('ok', '✓ Pronto');
      showToast('"' + effect.name + '" pronto — arraste agora pra timeline', 'success');
    })
    .catch(function (err) {
      card.classList.remove('downloading');
      removeDownloadOverlay(card);
      showToast('Falha ao preparar: ' + err.message, 'error');
    });
}

// ── Índice de cache persistente ──────────────────────────────
// Mapa { effectId: localPath } salvo em localStorage. Sobrevive a restart.
var CACHE_INDEX_KEY = 'cinepro_cache_index_v1';
var cacheDirCached  = null;  // memoização do path da pasta de cache

function getCacheIndex() {
  try { return JSON.parse(localStorage.getItem(CACHE_INDEX_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveCacheIndex(idx) {
  localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(idx));
}

function getCacheDir() {
  return new Promise(function (resolve) {
    if (cacheDirCached) return resolve(cacheDirCached);
    cs.evalScript('getCacheDir()', function (dir) {
      cacheDirCached = (dir && dir !== 'undefined') ? dir : '/tmp';
      resolve(cacheDirCached);
    });
  });
}

function fileExistsLocal(path) {
  // Tenta via Node.js (mais rápido)
  try {
    var nodeFs = window.require ? window.require('fs') : null;
    if (nodeFs) return nodeFs.existsSync(path);
  } catch (e) {}
  // Fallback via ExtendScript (síncrono mas funciona)
  return false;
}

/**
 * Baixa o arquivo do Google Drive pra pasta de cache permanente.
 * Se já estiver em disco (índice + verificação), retorna o path direto.
 * Persiste entre reinicializações do Premiere.
 */
function downloadEffectFile(effect) {
  // 0. v1.3: checa bundle (assets pre-instalados via .pkg/.exe)
  var bundlePath = getBundleFilePath(effect.id, effect.ext);
  if (bundlePath) return Promise.resolve(bundlePath);

  // 1. Checa índice de cache (sync) — arquivos baixados em sessões anteriores
  var idx = getCacheIndex();
  var cachedPath = idx[effect.id];
  if (cachedPath && fileExistsLocal(cachedPath)) {
    return Promise.resolve(cachedPath);
  }

  var downloadUrl = 'https://www.googleapis.com/drive/v3/files/' + effect.id
    + '?alt=media&key=' + CINEPRO_CONFIG.GOOGLE_DRIVE_API_KEY;

  // 2. Retry com backoff exponencial — até 3 tentativas em 5xx/network
  return _downloadWithRetry(effect, downloadUrl, 3);
}

// ── BUNDLE LOOKUP (v1.3) ─────────────────────────────────────────
// O instalador coloca ~750 arquivos universais + thumbs em:
//   macOS:   /Library/Application Support/CinePRO/bundle/
//   Windows: %APPDATA%/CinePRO/bundle/
//
// Plugin carrega manifest-bundle.json no boot e usa essa lookup
// pra retornar caminho local SEM passar por Drive.

var BUNDLE_MANIFEST = null;        // { files: {id: relPath}, thumbs: {id: relPath} }
var BUNDLE_ROOT_PATH = null;       // resolvido via hostscript getBundleDir()

function initBundleLookup() {
  // Pergunta ao hostscript onde está o bundle local
  cs.evalScript('getBundleDir()', function (dir) {
    if (!dir || dir === 'undefined') { console.log('[CinePRO] bundle indisponível'); return; }
    BUNDLE_ROOT_PATH = dir;
    var manifestPath = dir + '/manifest-bundle.json';
    if (!fileExistsLocal(manifestPath)) {
      console.log('[CinePRO] bundle dir existe mas sem manifest:', dir);
      return;
    }
    try {
      var nodeFs = window.require ? window.require('fs') : null;
      if (!nodeFs) return;
      BUNDLE_MANIFEST = JSON.parse(nodeFs.readFileSync(manifestPath, 'utf8'));
      var fileCount = Object.keys(BUNDLE_MANIFEST.files || {}).length;
      var thumbCount = Object.keys(BUNDLE_MANIFEST.thumbs || {}).length;
      console.log('[CinePRO] bundle carregado: ' + fileCount + ' arquivos + ' + thumbCount + ' thumbs');
    } catch (e) {
      console.warn('[CinePRO] bundle manifest inválido:', e.message);
    }
  });
}

function getBundleFilePath(effectId, ext) {
  if (!BUNDLE_MANIFEST || !BUNDLE_ROOT_PATH) return null;
  var rel = BUNDLE_MANIFEST.files && BUNDLE_MANIFEST.files[effectId];
  if (!rel) return null;
  var full = BUNDLE_ROOT_PATH + '/' + rel;
  if (!fileExistsLocal(full)) return null;
  return full;
}

function getBundleThumbPath(effectId) {
  if (!BUNDLE_MANIFEST || !BUNDLE_ROOT_PATH) return null;
  var rel = BUNDLE_MANIFEST.thumbs && BUNDLE_MANIFEST.thumbs[effectId];
  if (!rel) return null;
  return BUNDLE_ROOT_PATH + '/' + rel;
}

function _downloadWithRetry(effect, downloadUrl, attempts) {
  var delay = 800;
  function attempt(n) {
    return _downloadOnce(effect, downloadUrl).catch(function (err) {
      // Não retry em 4xx
      if (err && err.code === 'CLIENT_ERROR') throw err;
      if (n + 1 >= attempts) throw err;
      var wait = delay * Math.pow(2, n);
      console.warn('[CinePRO] download retry em ' + wait + 'ms (' + (n+1) + '/' + attempts + '): ' + (err && err.message));
      return new Promise(function (r) { setTimeout(r, wait); }).then(function () { return attempt(n + 1); });
    });
  }
  return attempt(0);
}

function _downloadOnce(effect, downloadUrl) {
  return new Promise(function (resolve, reject) {
    getCacheDir().then(function (cacheDir) {
      var safeName = effect.name.replace(/[^a-zA-Z0-9_\-\.]/g, '_') + '.' + effect.ext;
      var localPath = cacheDir + '/' + effect.id.slice(0, 8) + '_' + safeName;
      var tmpPath   = localPath + '.tmp';

      var xhr = new XMLHttpRequest();
      xhr.open('GET', downloadUrl, true);
      xhr.responseType = 'arraybuffer';

      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            var nodeFs = window.require ? window.require('fs') : null;
            if (!nodeFs) return reject(new Error('Node.js não disponível no CEP'));

            // Escreve em .tmp, depois renomeia atomicamente
            var bytes = new Uint8Array(xhr.response);
            nodeFs.writeFileSync(tmpPath, Buffer.from(bytes));
            nodeFs.renameSync(tmpPath, localPath);

            var idx2 = getCacheIndex();
            idx2[effect.id] = localPath;
            saveCacheIndex(idx2);
            resolve(localPath);
          } catch (e) {
            reject(e);
          }
        } else if (xhr.status >= 400 && xhr.status < 500) {
          var err = new Error('HTTP ' + xhr.status);
          err.code = 'CLIENT_ERROR';
          reject(err);
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { reject(new Error('Falha de rede')); };
      xhr.ontimeout = function () { reject(new Error('Timeout')); };
      xhr.timeout = 60000;
      xhr.send();
    });
  });
}

// ══ INDEXED DB ════════════════════════════════════════════════
// Wrapper minimalista. 1 store key-value pra waveforms e qualquer
// outro cache pesado. Sobrevive a restart do Premiere (≠ sessionStorage).
var IDB_DB_NAME = 'cinepro';
var IDB_STORE   = 'cache';
var IDB_VERSION = 1;
var idbPromise = null;

function idb() {
  if (idbPromise) return idbPromise;
  if (typeof indexedDB === 'undefined') {
    idbPromise = Promise.reject(new Error('IndexedDB indisponível'));
    return idbPromise;
  }
  idbPromise = new Promise(function (resolve, reject) {
    var req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
  return idbPromise;
}

function idbGet(key) {
  return idb().then(function (db) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror   = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }).catch(function () { return null; });
}

function idbSet(key, value) {
  return idb().then(function (db) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror    = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }).catch(function () { return false; });
}

// ── FETCH com retry exponential backoff ─────────────────────────
// Útil pra qualquer chamada flaky (Drive API às vezes dá 5xx).
// Retry apenas em 5xx + erro de rede. 4xx não — falha de input.
function fetchWithRetry(url, opts, attempts) {
  opts = opts || {};
  attempts = attempts || 3;
  var delay = 800;
  function attempt(n) {
    return fetch(url, opts).then(function (r) {
      if (r.ok) return r;
      if (r.status >= 400 && r.status < 500) return r;  // não retry 4xx
      if (n + 1 >= attempts) return r;
      return new Promise(function (resolve) { setTimeout(resolve, delay * Math.pow(2, n)); })
        .then(function () { return attempt(n + 1); });
    }).catch(function (err) {
      if (n + 1 >= attempts) throw err;
      return new Promise(function (resolve) { setTimeout(resolve, delay * Math.pow(2, n)); })
        .then(function () { return attempt(n + 1); });
    });
  }
  return attempt(0);
}

// ══ UTILITIES ═════════════════════════════════════════════════

function setStatus(type, msg) {
  var dot  = document.getElementById('status-dot');
  var text = document.getElementById('status-text');
  if (!dot || !text) return;

  dot.className = 'status-dot ' + type;
  text.textContent = msg;
}

function showToast(msg, type) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className   = 'toast ' + (type || '');

  requestAnimationFrame(function () {
    toast.classList.add('visible');
    setTimeout(function () {
      toast.classList.remove('visible');
    }, 3000);
  });
}

function showError(msg) {
  console.error('[CinePRO]', msg);
}

function escapePath(p) {
  return (p || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function openURL(url) {
  if (window.cep && window.cep.util) {
    window.cep.util.openURLInDefaultBrowser(url);
  } else {
    cs.openURLInDefaultBrowser(url);
  }
}

function humanizeError(err) {
  if (!err) return 'Erro desconhecido';
  if (err.indexOf('NO_SEQUENCE')    !== -1) return 'Abra uma sequência no Premiere primeiro.';
  if (err.indexOf('FILE_NOT_FOUND') !== -1) return 'Arquivo não encontrado no cache.';
  if (err.indexOf('NO_VIDEO_TRACK') !== -1) return 'Crie uma trilha de vídeo na timeline.';
  if (err.indexOf('NO_AUDIO_TRACK') !== -1) return 'Crie uma trilha de áudio na timeline.';
  if (err.indexOf('AUDIO:')         !== -1) return 'Falha ao inserir áudio: ' + err.replace('AUDIO:', '').trim();
  if (err.indexOf('CLIP:')          !== -1) return 'Falha ao inserir clip: ' + err.replace('CLIP:', '').trim();
  if (err.indexOf('PRESET')         !== -1) return 'Falha ao importar o preset.';
  if (err.indexOf('LUT')            !== -1) return 'Falha ao instalar o LUT.';
  if (err.indexOf('MOGRT')          !== -1) return 'Falha ao importar o MOGRT.';
  return err;
}

/** Mensagem amigável de sucesso por tipo */
function successMessage(effect, result) {
  if (result.indexOf('PRESET_IMPORTED') !== -1)
    return '"' + effect.name + '" adicionado em Efeitos → Predefinições';
  if (result.indexOf('LUT_INSTALLED') !== -1)
    return '"' + effect.name + '" instalado em Lumetri Color';
  if (result.indexOf('APPLIED_TO_') !== -1) {
    var n = result.replace(/.*APPLIED_TO_/, '').trim();
    return '"' + effect.name + '" aplicado em ' + n + ' clip' + (n === '1' ? '' : 's') + ' selecionado' + (n === '1' ? '' : 's');
  }
  if (result.indexOf('AUDIO_INSERTED') !== -1)
    return '"' + effect.name + '" adicionado à trilha de áudio ✓';
  return '"' + effect.name + '" adicionado à timeline ✓';
}
