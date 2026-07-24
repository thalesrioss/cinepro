// =============================================================
//  CinePRO — Update Checker
//  Verifica GitHub Releases 1× a cada 24h. Notifica via pill no
//  header + modal com release notes. Usado pelo plugin E pelo app.
// =============================================================

(function (global) {
  'use strict';

  var REPO       = 'thalesrioss/cinepro';
  var API_URL    = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  var RELEASE_PG = 'https://github.com/' + REPO + '/releases/latest';
  var STORAGE_KEY = 'cinepro_update_check_v1';
  var CHECK_TTL_MS = 24 * 60 * 60 * 1000;   // 1× por dia
  var DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 dias

  // ── State helpers ───────────────────────────────────────────
  function getState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function setState(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
    catch (e) {/* quota — ignora */}
  }

  // ── Semver compare (minimal, robusto pra a.b.c[-pre]) ───────
  function parseVersion(v) {
    var clean = String(v || '').replace(/^v/i, '').trim();
    var parts = clean.split('-');
    var nums = parts[0].split('.').map(function (n) { return parseInt(n, 10) || 0; });
    return { major: nums[0]||0, minor: nums[1]||0, patch: nums[2]||0, pre: parts[1] || null, raw: clean };
  }
  function isNewer(latestStr, currentStr) {
    var a = parseVersion(latestStr);
    var b = parseVersion(currentStr);
    if (a.major !== b.major) return a.major > b.major;
    if (a.minor !== b.minor) return a.minor > b.minor;
    if (a.patch !== b.patch) return a.patch > b.patch;
    // mesmo major.minor.patch: pre-release perde pra release final
    if (a.pre && !b.pre) return false;
    if (!a.pre && b.pre) return true;
    return false;
  }

  // ── Dismiss state ───────────────────────────────────────────
  function isDismissed(version) {
    var s = getState();
    return s.dismissedVersion === version && s.dismissedUntil && s.dismissedUntil > Date.now();
  }
  function dismissVersion(version) {
    var s = getState();
    s.dismissedVersion = version;
    s.dismissedUntil   = Date.now() + DISMISS_TTL_MS;
    setState(s);
  }

  // ── Detect platform pra preselect download ──────────────────
  function detectPlatform() {
    var ua = navigator.userAgent || '';
    var p  = navigator.platform || '';
    if (/Mac|iPhone|iPad/i.test(p) || /Mac OS X/i.test(ua)) return 'mac';
    if (/Win/i.test(p) || /Windows/i.test(ua)) return 'win';
    return 'unknown';
  }

  // ── Pick download assets do release ─────────────────────────
  function pickAssets(release) {
    var assets = release.assets || [];
    var mac = null, win = null;
    assets.forEach(function (a) {
      var name = (a.name || '').toLowerCase();
      if (name.endsWith('.pkg') || name.endsWith('.dmg')) mac = mac || a;
      if (name.endsWith('.exe')) win = win || a;
    });
    return {
      mac:  mac ? mac.browser_download_url : null,
      win:  win ? win.browser_download_url : null,
      page: release.html_url || RELEASE_PG,
    };
  }

  // ── Fetch do GitHub Releases ────────────────────────────────
  function fetchLatestRelease() {
    return fetch(API_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('GitHub API ' + r.status);
        return r.json();
      })
      .then(function (rel) {
        if (!rel || !rel.tag_name) throw new Error('release inválido');
        return {
          tag:     rel.tag_name,
          name:    rel.name || rel.tag_name,
          body:    rel.body || '',
          url:     rel.html_url,
          assets:  pickAssets(rel),
          published: rel.published_at,
        };
      });
  }

  /**
   * Chama callback com info do update se houver. Respeita TTL de 24h
   * (cache local) e dismiss de 7d. Falha silenciosa se sem rede.
   *
   * @param {string} currentVersion  ex: '1.0.12'
   * @param {function(info|null)} cb
   */
  function checkForUpdate(currentVersion, cb, force) {
    var s = getState();
    var now = Date.now();

    // Cache hit? Reusa última checagem se <24h (force ignora — o app checa
    // a cada abertura pra nunca deixar uma versao antiga passar batido)
    if (!force && s.lastCheck && s.lastRelease && (now - s.lastCheck) < CHECK_TTL_MS) {
      var release = s.lastRelease;
      if (isNewer(release.tag, currentVersion) && !isDismissed(release.tag)) {
        cb(release);
      } else {
        cb(null);
      }
      return;
    }

    fetchLatestRelease().then(function (release) {
      var st = getState();
      st.lastCheck = now;
      st.lastRelease = release;
      setState(st);
      if (isNewer(release.tag, currentVersion) && !isDismissed(release.tag)) {
        cb(release);
      } else {
        cb(null);
      }
    }).catch(function (e) {
      console.warn('[CinePRO] update check falhou:', e && e.message);
      cb(null);
    });
  }

  // ── Render: pill + modal ────────────────────────────────────
  function renderUpdateUI(release, opts) {
    opts = opts || {};
    var pillHost  = opts.pillHost  || document.body;
    var modalHost = opts.modalHost || document.body;

    // ─ Pill ─
    var pill = document.createElement('button');
    pill.className = 'update-pill';
    pill.type = 'button';
    pill.setAttribute('aria-label', 'Nova versão disponível: ' + release.tag);
    pill.innerHTML =
      '<span class="update-pill-icon" aria-hidden="true">↻</span>' +
      '<span class="update-pill-label">' + escapeHtml(release.tag) + ' disponível</span>';
    pillHost.appendChild(pill);

    // ─ Modal (lazy) ─
    var modal = null;
    function openModal() {
      if (modal) { modal.classList.add('is-open'); return; }
      modal = document.createElement('div');
      modal.className = 'update-modal is-open';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'update-modal-title');

      var plat = detectPlatform();
      var macBtn = release.assets.mac
        ? '<a class="btn btn--primary-gradient btn--lg btn--block update-dl' + (plat === 'mac' ? ' is-recommended' : '') + '" href="' + escapeAttr(release.assets.mac) + '" target="_blank" rel="noopener">' +
            '<span>Baixar pra macOS</span><small>.pkg</small></a>'
        : '';
      var winBtn = release.assets.win
        ? '<a class="btn btn--primary-gradient btn--lg btn--block update-dl' + (plat === 'win' ? ' is-recommended' : '') + '" href="' + escapeAttr(release.assets.win) + '" target="_blank" rel="noopener">' +
            '<span>Baixar pra Windows</span><small>.exe</small></a>'
        : '';
      var fallback = (!release.assets.mac && !release.assets.win)
        ? '<a class="btn btn--soft btn--lg btn--block" href="' + escapeAttr(release.assets.page) + '" target="_blank" rel="noopener">Abrir página do release</a>'
        : '';

      modal.innerHTML =
        '<div class="update-modal-backdrop" data-close="1"></div>' +
        '<div class="update-modal-box">' +
          '<button class="update-modal-x" type="button" aria-label="Fechar" data-close="1">✕</button>' +
          '<div class="update-modal-eyebrow">Nova versão disponível</div>' +
          '<h2 class="update-modal-title" id="update-modal-title">CinePRO ' + escapeHtml(release.tag) + '</h2>' +
          (release.published ? '<div class="update-modal-meta">Publicado em ' + formatDate(release.published) + '</div>' : '') +
          '<div class="update-modal-body">' + renderBody(release.body) + '</div>' +
          '<div class="update-modal-actions">' + (plat === 'win' ? winBtn + macBtn : macBtn + winBtn) + fallback + '</div>' +
          '<button class="update-modal-dismiss" type="button" data-dismiss="1">Lembrar daqui 7 dias</button>' +
        '</div>';

      modalHost.appendChild(modal);

      // ── Dentro do app: baixa e abre o instalador AQUI ─────────
      // No navegador o <a download> resolve. Dentro do Electron, abrir o
      // link jogaria o usuário pro site — exatamente o que queremos evitar.
      // Aqui o app baixa (com progresso) e abre o instalador sozinho.
      if (global.cinepro && global.cinepro.updateDownload) {
        var progressTarget = null;
        if (global.cinepro.onUpdateProgress) {
          global.cinepro.onUpdateProgress(function (pct) {
            if (progressTarget) progressTarget.textContent = 'Baixando… ' + pct + '%';
          });
        }
        var actionsEl = modal.querySelector('.update-modal-actions');
        if (actionsEl) actionsEl.addEventListener('click', function (e) {
          var a = e.target.closest && e.target.closest('a[href]');
          if (!a) return;
          var url = a.getAttribute('href') || '';
          if (!/\.(pkg|dmg|exe)$/i.test(url)) return;   // link "página do release" segue normal
          e.preventDefault();
          if (a.getAttribute('data-busy')) return;
          a.setAttribute('data-busy', '1');

          var label = a.querySelector('span') || a;
          var orig  = label.textContent;
          progressTarget = label;
          label.textContent = 'Baixando… 0%';

          global.cinepro.updateDownload({ url: url, filename: url.split('/').pop() })
            .then(function (r) {
              if (!r || !r.ok) throw new Error((r && r.error) || 'falha no download');
              progressTarget = null;
              label.textContent = 'Abrindo instalador…';
              return global.cinepro.updateInstall(r.path);
            })
            .then(function (r) {
              if (!r || !r.ok) throw new Error((r && r.error) || 'não consegui abrir o instalador');
              label.textContent = '✓ Instalador aberto — siga os passos';
            })
            .catch(function (err) {
              progressTarget = null;
              a.removeAttribute('data-busy');
              label.textContent = orig;
              // Falhou o caminho automático → não deixa o usuário na mão
              if (global.cinepro.openExternal) global.cinepro.openExternal(url);
            });
        });
      }

      modal.addEventListener('click', function (e) {
        if (e.target.dataset.close) {
          modal.classList.remove('is-open');
        } else if (e.target.dataset.dismiss) {
          dismissVersion(release.tag);
          modal.classList.remove('is-open');
          pill.remove();
        }
      });
      document.addEventListener('keydown', function escListener(e) {
        if (e.key === 'Escape' && modal.classList.contains('is-open')) {
          modal.classList.remove('is-open');
        }
      });
    }

    pill.addEventListener('click', openModal);
    // No app, abre sozinho: o usuario nao precisa reparar na pill pra saber
    // que existe versao nova (o pedido era "bater nas versoes antigas").
    if (opts.autoOpen) openModal();
  }

  // ── Render body: markdown light (titles, bullets, code) ─────
  function renderBody(md) {
    if (!md) return '<p class="update-empty">Sem notas detalhadas para esta versão.</p>';
    var safe = escapeHtml(md);
    // Headings
    safe = safe.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    safe = safe.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    safe = safe.replace(/^# (.+)$/gm, '<h3>$1</h3>');
    // Inline code
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Lists
    safe = safe.replace(/^[\s]*[-*] (.+)$/gm, '<li>$1</li>');
    safe = safe.replace(/(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/gs, '<ul>$1</ul>');
    // Links [text](url) — restrito a https://
    safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Paragraphs (linhas não-tag)
    safe = safe.split(/\n\n+/).map(function (block) {
      if (/^\s*<(h\d|ul|li|p|pre|code)/.test(block)) return block;
      return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
    return safe;
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) { return iso; }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  // ── API pública ─────────────────────────────────────────────
  global.CinePROUpdateChecker = {
    check: checkForUpdate,
    render: renderUpdateUI,
    dismiss: dismissVersion,
    isNewer: isNewer,
  };
})(this);
