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
  bindPreviewModal();
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
    loadEffectsFromDrive();
    return;
  }

  db.collection('users').doc(user.uid).get()
    .then(function (doc) {
      // Acesso por admin no documento OU assinatura ativa
      if (doc.exists && (doc.data().admin === true || doc.data().subscriptionActive === true)) {
        showScreen('app');
        var badge = user.email + (doc.data().admin === true ? ' (ADM)' : '');
        setUserBadge(badge);
        loadEffectsFromDrive();
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
}

function doLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass  = document.getElementById('login-password').value;
  var btn   = document.getElementById('btn-login');
  var errEl = document.getElementById('login-error');

  if (!email || !pass) {
    showLoginError('Preencha e-mail e senha.');
    return;
  }

  errEl.classList.remove('visible');
  btn.disabled    = true;
  btn.textContent = 'Entrando...';

  auth.signInWithEmailAndPassword(email, pass)
    .catch(function (err) {
      btn.disabled    = false;
      btn.textContent = 'Entrar';

      var msg = 'Erro ao fazer login.';
      if (err.code === 'auth/user-not-found')    msg = 'E-mail não cadastrado.';
      if (err.code === 'auth/wrong-password')    msg = 'Senha incorreta.';
      if (err.code === 'auth/invalid-email')     msg = 'E-mail inválido.';
      if (err.code === 'auth/network-request-failed') msg = 'Sem conexão com internet.';
      if (err.code === 'auth/too-many-requests') msg = 'Muitas tentativas. Aguarde.';

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

  var input = document.getElementById('search-input');
  var clear = document.getElementById('search-clear');

  input.addEventListener('input', function (e) {
    var val = e.target.value.trim();
    clear.style.display = val ? 'flex' : 'none';
    filterEffects(val.toLowerCase());
  });

  clear.addEventListener('click', function () {
    input.value = '';
    clear.style.display = 'none';
    filterEffects('');
    input.focus();
  });
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

function loadEffectsFromDrive() {
  setStatus('loading', 'Carregando categorias...');
  allEffects = [];
  driveCategories = [];
  driveLoadedCats = {};

  listDriveFolderAll(CINEPRO_CONFIG.GOOGLE_DRIVE_FOLDER_ID)
    .then(function (rootItems) {
      var rootFolders = rootItems.filter(isFolder).filter(function (f) { return !shouldSkipFolder(f.name); });
      var rootFiles   = rootItems.filter(notFolder).filter(function (f) { return !shouldSkipFile(f.name); });

      // Arquivos soltos na raiz vão pra categoria "Geral"
      rootFiles.forEach(function (f) {
        allEffects.push(driveFileToEffect(f, 'Geral', null, []));
      });
      if (rootFiles.length) {
        driveCategories.push({ id: null, name: 'Geral', loaded: true });
        driveLoadedCats['Geral'] = true;
      }

      // Cada subpasta vira uma categoria (lazy)
      rootFolders.forEach(function (cat) {
        driveCategories.push({
          id:     cat.id,
          name:   cleanCategoryName(cat.name),
          loaded: false,
        });
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

  return walkFolder(cat.id, categoryName, [], 0)
    .then(function () {
      driveLoadedCats[categoryName] = true;
      cat.loaded = true;
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

  return fetch(url)
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

// ══ CATEGORIES ════════════════════════════════════════════════

function buildCategoryTabs() {
  // Categorias vêm de driveCategories (descobertas no boot), não de allEffects (que pode tá vazio até lazy load)
  var cats = ['all', 'favorites'].concat(driveCategories.map(function (c) { return c.name; }));

  var container = document.getElementById('category-tabs');
  container.innerHTML = '';

  cats.forEach(function (cat) {
    var btn = document.createElement('button');
    btn.className = 'tab-btn' + (cat === activeCategory ? ' active' : '') + (cat === 'favorites' ? ' tab-favorites' : '');
    var label = cat === 'all'        ? 'Todos'
              : cat === 'favorites'  ? '★ Favoritos'
              :                        cat;
    var n = cat === 'all'       ? allEffects.length
          : cat === 'favorites' ? getFavoriteIds().length
          :                       allEffects.filter(function(e){return e.category===cat;}).length;
    btn.innerHTML = label + ' <span class="tab-count">' + n + '</span>';
    btn.dataset.cat = cat;
    btn.addEventListener('click', function () {
      activeCategory = cat;
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      // Lazy load: se for categoria do Drive e ainda não carregou, busca agora
      var needsLoad = cat !== 'all' && cat !== 'favorites' && !driveLoadedCats[cat];
      var ready = needsLoad ? loadCategoryDeep(cat) : Promise.resolve();

      ready.then(function () {
        var search = document.getElementById('search-input').value.trim().toLowerCase();
        filterEffects(search);
      });
    });
    container.appendChild(btn);
  });
}

function countByCategory() {
  var counts = {};
  allEffects.forEach(function (e) {
    counts[e.category] = (counts[e.category] || 0) + 1;
  });
  return counts;
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

function filterEffects(query) {
  var favSet = activeCategory === 'favorites' ? new Set(getFavoriteIds()) : null;

  var filtered = allEffects.filter(function (e) {
    var inCat = activeCategory === 'all'
              || (activeCategory === 'favorites' && favSet.has(e.id))
              || e.category === activeCategory;
    if (!query) return inCat;
    var haystack = (
      e.name + ' ' +
      e.category + ' ' +
      (e.subcategory || '') + ' ' +
      (e.path || []).join(' ') + ' ' +
      (e.tags || []).join(' ')
    ).toLowerCase();
    return inCat && haystack.includes(query);
  });
  renderEffects(filtered);
}

function renderEffects(effects) {
  var grid = document.getElementById('effects-grid');
  grid.innerHTML = '';

  if (effects.length === 0) {
    if (activeCategory === 'favorites') {
      renderEmpty('Você ainda não favoritou nada.<br>Passe o mouse num card e clique na ⭐ pra começar.');
    } else if (activeCategory === 'all') {
      renderEmpty('Clique numa categoria acima pra começar 👆<br>Os arquivos são carregados sob demanda.');
    } else {
      renderEmpty('Nenhum efeito encontrado.<br>Tente outra palavra ou categoria.');
    }
    return;
  }

  // Agrupa pela categoria original quando estamos vendo "Favoritos" ou "Todos";
  // numa categoria específica, agrupa pela subcategoria pra dar profundidade.
  var groups = {};
  var groupByCat = (activeCategory === 'favorites' || activeCategory === 'all');
  effects.forEach(function (e) {
    var label = groupByCat
              ? (e.category || 'Geral')
              : (e.subcategory || e.category);
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  });

  var labels = Object.keys(groups);
  labels.forEach(function (label) {
    if (labels.length > 1) {
      var title = document.createElement('div');
      title.className = 'section-title';
      title.style.gridColumn = '1 / -1';
      title.innerHTML = '<span class="section-bullet"></span>' + label + ' <span class="section-count">' + groups[label].length + '</span>';
      grid.appendChild(title);
    }
    groups[label].forEach(function (effect) {
      grid.appendChild(createEffectCard(effect));
    });
  });
}

function renderEmpty(msg) {
  var grid = document.getElementById('effects-grid');
  grid.innerHTML = '<div class="state-box" style="grid-column:1/-1"><div class="state-icon">🎬</div><div class="state-desc">' + msg + '</div></div>';
}

// Cache de arquivos já baixados nessa sessão (effect.id → localPath)
var effectCache = {};

function createEffectCard(effect) {
  var cached = !!effectCache[effect.id];
  var isFav  = isFavorite(effect.id);

  var card = document.createElement('div');
  card.className  = 'effect-card' + (cached ? ' cached' : '') + (isFav ? ' is-fav' : '');
  card.draggable  = true;
  card.dataset.id   = effect.id;
  card.dataset.ext  = effect.ext;
  card.dataset.name = effect.name;
  card.dataset.kind = effect.kind || '';

  var typeBadge = effect.ext ? '<span class="effect-type-badge ' + effect.ext + '">' + effect.ext.toUpperCase() + '</span>' : '';
  var dragHint  = cached ? '⇲ arrastar' : '⇩ preparar';

  // Preview só pra áudio/vídeo
  var canPreview = (effect.kind === 'audio' || effect.kind === 'video' || effect.kind === 'image');
  var previewBtn = canPreview ? '<button class="btn btn--floating btn--icon btn-preview" title="Preview" aria-label="Preview">▶</button>' : '';

  card.innerHTML = [
    '<button class="btn btn--floating btn--icon btn--sm btn-fav" title="Favoritar" aria-label="Favoritar">',
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round">',
        '<polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2"/>',
      '</svg>',
    '</button>',
    '<div class="effect-thumb">',
      effect.thumb
        ? '<img src="' + effect.thumb + '" alt="' + effect.name + '" loading="lazy">'
        : '<div class="effect-thumb-placeholder">' + thumbForKind(effect.kind) + '</div>',
      previewBtn,
      '<span class="drag-hint">' + dragHint + '</span>',
    '</div>',
    '<div class="download-overlay">',
      '<div class="download-spinner"></div>',
      '<div class="download-label">Baixando...</div>',
    '</div>',
    '<div class="effect-card-body">',
      '<div class="effect-name" title="' + effect.name + '">' + effect.name + '</div>',
      '<div class="effect-meta">',
        typeBadge,
        '<button class="btn btn--soft btn--xs btn-apply" data-id="' + effect.id + '">Aplicar</button>',
      '</div>',
    '</div>',
  ].join('');

  // Botão Aplicar
  card.querySelector('.btn-apply').addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    applyEffect(effect, card);
  });

  // Botão Favoritar
  card.querySelector('.btn-fav').addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    toggleFavorite(effect, card);
  });

  // Botão Preview — abre modal E dispara pré-cache silencioso
  if (canPreview) {
    card.querySelector('.btn-preview').addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      openPreview(effect);
      silentPrefetch(effect, card);  // se o usuário quer ver, provavelmente vai usar
    });
  }

  // ── PRÉ-CACHE NO HOVER ────────────────────────────────
  // Se o usuário hover por >600ms, baixa em background.
  // Evita disparar download em scroll rápido.
  var hoverTimer = null;
  card.addEventListener('mouseenter', function () {
    if (effectCache[effect.id]) return;
    hoverTimer = setTimeout(function () {
      silentPrefetch(effect, card);
    }, 600);
  });
  card.addEventListener('mouseleave', function () {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  });

  // ── DRAG-AND-DROP ────────────────────────────────────
  // CEP só inicia drag externo se chamado SÍNCRONO no mousedown.
  // Por isso pré-baixamos o arquivo no primeiro clique e armazenamos
  // no cache. A partir daí, qualquer drag funciona instantâneo.
  card.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('.btn-apply, .btn-fav, .btn-preview')) return;

    var path = effectCache[effect.id];
    if (path && window.__adobe_cep__) {
      try {
        window.__adobe_cep__.dispatchEvent({
          type:   'com.adobe.cep.dragdrop',
          scope:  'GLOBAL',
          appId:  'PPRO',
        });
        window.__adobe_cep__.startDragToExternal(path, null, null, null);
      } catch (err) {
        console.error('[CinePRO] drag falhou:', err);
      }
    }
  });

  card.addEventListener('dragstart', function (e) {
    if (effectCache[effect.id]) {
      // Já tá em cache — deixa o drag nativo rolar
      return;
    }
    // Não tá em cache → previne drag fake e dispara download
    e.preventDefault();
    prepareForDrag(effect, card);
  });

  return card;
}

// ══ PREVIEW MODAL ══════════════════════════════════════════════

function openPreview(effect) {
  var modal = document.getElementById('preview-modal');
  var media = document.getElementById('preview-media');
  var name  = document.getElementById('preview-name');
  var meta  = document.getElementById('preview-meta');

  // Limpa qualquer player anterior
  media.innerHTML = '';

  // URL de stream direto do Drive (mesma usada pra download)
  var url = 'https://www.googleapis.com/drive/v3/files/' + effect.id
          + '?alt=media&key=' + CINEPRO_CONFIG.GOOGLE_DRIVE_API_KEY;

  if (effect.kind === 'audio') {
    media.innerHTML =
      '<div class="preview-audio-wrap">' +
        '<div class="preview-audio-icon">🎵</div>' +
        '<audio controls autoplay src="' + url + '"></audio>' +
      '</div>';
  } else if (effect.kind === 'video') {
    media.innerHTML =
      '<video controls autoplay loop playsinline src="' + url + '"></video>';
  } else if (effect.kind === 'image') {
    media.innerHTML =
      '<img src="' + url + '" alt="' + effect.name + '">';
  } else {
    media.innerHTML =
      '<div class="preview-placeholder">' + thumbForKind(effect.kind) +
      '<br>Preview indisponível</div>';
  }

  name.textContent = effect.name;
  meta.textContent = [
    effect.category,
    effect.subcategory,
    effect.ext.toUpperCase(),
    effect.size ? formatBytes(effect.size) : null,
  ].filter(Boolean).join(' • ');

  modal.classList.add('visible');
}

function closePreview() {
  var modal = document.getElementById('preview-modal');
  var media = document.getElementById('preview-media');
  // Pausa qualquer mídia em reprodução antes de esconder
  var v = media.querySelector('video, audio');
  if (v) { v.pause(); v.src = ''; }
  modal.classList.remove('visible');
  media.innerHTML = '';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
  return (bytes/1024/1024/1024).toFixed(2) + ' GB';
}

function bindPreviewModal() {
  document.getElementById('preview-close').addEventListener('click', closePreview);
  document.getElementById('preview-backdrop').addEventListener('click', closePreview);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePreview();
  });
}

function thumbForKind(kind) {
  switch (kind) {
    case 'audio':   return '🎵';
    case 'video':   return '🎬';
    case 'image':   return '🖼';
    case 'mogrt':   return '📝';
    case 'preset':  return '✨';
    case 'lut':     return '🎨';
    default:        return '🎞';
  }
}

// ══ APPLY / DRAG ══════════════════════════════════════════════

/**
 * Baixa o arquivo para temp e o insere na timeline via ExtendScript
 */
function applyEffect(effect, card) {
  if (card.classList.contains('downloading')) return;

  // Se já tá em cache, pula download
  var cachedPath = effectCache[effect.id];
  var downloadPromise = cachedPath
    ? Promise.resolve(cachedPath)
    : downloadEffectFile(effect).then(function (p) { effectCache[effect.id] = p; return p; });

  card.classList.add('downloading');
  setStatus('loading', cachedPath ? 'Inserindo...' : 'Baixando "' + effect.name + '"...');

  downloadPromise
    .then(function (localPath) {
      card.classList.remove('downloading');
      card.classList.add('cached');
      setStatus('loading', 'Inserindo na timeline...');

      cs.evalScript(
        'importFileAtPlayhead("' + escapePath(localPath) + '", "' + effect.ext + '")',
        function (result) {
          if (!result || result.startsWith('ERR:')) {
            var msg = result ? result.replace('ERR:', '') : 'Erro desconhecido';
            setStatus('error', 'Erro: ' + msg);
            showToast('Erro ao inserir: ' + humanizeError(msg), 'error');
          } else {
            setStatus('ok', '"' + effect.name + '" pronto!');
            showToast(successMessage(effect, result), 'success');
          }
        }
      );
    })
    .catch(function (err) {
      card.classList.remove('downloading');
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
  setStatus('loading', 'Preparando "' + effect.name + '"...');

  downloadEffectFile(effect)
    .then(function (localPath) {
      effectCache[effect.id] = localPath;
      card.classList.remove('downloading');
      card.classList.add('cached');
      card.querySelector('.drag-hint').textContent = '⇲ arrastar';
      setStatus('ok', '✓ Pronto');
      showToast('"' + effect.name + '" pronto — arraste agora pra timeline', 'success');
    })
    .catch(function (err) {
      card.classList.remove('downloading');
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
  return new Promise(function (resolve, reject) {
    // 1. Checa índice de cache
    var idx = getCacheIndex();
    var cachedPath = idx[effect.id];
    if (cachedPath && fileExistsLocal(cachedPath)) {
      return resolve(cachedPath);
    }

    // 2. Não tá no cache — busca pasta e baixa
    getCacheDir().then(function (cacheDir) {
      var safeName = effect.name.replace(/[^a-zA-Z0-9_\-\.]/g, '_') + '.' + effect.ext;
      var localPath = cacheDir + '/' + effect.id.slice(0, 8) + '_' + safeName;

      var downloadUrl = 'https://www.googleapis.com/drive/v3/files/' + effect.id
        + '?alt=media&key=' + CINEPRO_CONFIG.GOOGLE_DRIVE_API_KEY;

      // Usa XMLHttpRequest com arraybuffer (disponível no CEP/Chromium)
      var xhr = new XMLHttpRequest();
      xhr.open('GET', downloadUrl, true);
      xhr.responseType = 'arraybuffer';

      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            // Escreve o arquivo via Node.js (disponível no CEP com --enable-nodejs)
            var buffer = xhr.response;
            var nodeFs = window.require ? window.require('fs') : null;

            if (nodeFs) {
              var bytes = new Uint8Array(buffer);
              nodeFs.writeFileSync(localPath, Buffer.from(bytes));
              // Atualiza o índice de cache persistente
              var idx2 = getCacheIndex();
              idx2[effect.id] = localPath;
              saveCacheIndex(idx2);
              resolve(localPath);
            } else {
              reject(new Error('Node.js não disponível no CEP'));
            }
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error('HTTP ' + xhr.status + ' ao baixar arquivo'));
        }
      };

      xhr.onerror = function () {
        reject(new Error('Falha de rede ao baixar arquivo'));
      };

      xhr.send();
    });
  });
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
  if (err.includes('NO_SEQUENCE'))    return 'Abra uma sequência no Premiere primeiro.';
  if (err.includes('FILE_NOT_FOUND')) return 'Arquivo não encontrado.';
  if (err.includes('NO_VIDEO_TRACK')) return 'Crie uma trilha de vídeo na timeline.';
  if (err.includes('PRESET'))         return 'Falha ao importar o preset.';
  if (err.includes('LUT'))            return 'Falha ao instalar o LUT.';
  return err;
}

/** Mensagem amigável de sucesso por tipo */
function successMessage(effect, result) {
  if (result.includes('PRESET_IMPORTED'))
    return '"' + effect.name + '" adicionado em Efeitos → Predefinições';
  if (result.includes('LUT_INSTALLED'))
    return '"' + effect.name + '" instalado em Lumetri Color';
  return '"' + effect.name + '" adicionado à timeline ✓';
}
