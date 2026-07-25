// =============================================================
//  CinePRO — Config remota (Fase 0 do ADR-009)
//
//  Carrega DADOS (receitas de pack, papéis do motor de SFX) do mesmo
//  canal que já serve o manifest. Permite ajustar o comportamento sem
//  release — sem nunca executar código vindo da rede.
//
//  REGRA INVIOLÁVEL: nada aqui usa eval, new Function ou injeta
//  <script>. O conteúdo remoto é SEMPRE dado, passa por JSON.parse,
//  valida contra schema e sofre clamp numérico. Se qualquer etapa
//  falhar, usamos a cópia embarcada — nunca degradamos pra "sem
//  configuração".
//
//  Ameaças tratadas aqui (ver docs/adr/ADR-009-anexo-seguranca.md):
//   - dado malformado ou truncado          → schema rejeita o arquivo
//   - valor absurdo ("aplique 100k SFX")   → clamp de limites
//   - resposta gigante travando o painel   → teto de bytes
//   - poluição de protótipo via __proto__   → chaves perigosas filtradas
//   - conceito inexistente no dicionário    → descartado com aviso
// =============================================================

(function (global) {
  'use strict';

  var REPO_CDN = 'https://cdn.jsdelivr.net/gh/thalesrioss/cinepro@main/data/';
  var MAX_BYTES = 2 * 1024 * 1024;      // teto por arquivo
  var TIMEOUT_MS = 8000;

  var SOURCES = {
    recipes: [REPO_CDN + 'recipes.json', './data/recipes.json'],
    roles:   [REPO_CDN + 'roles.json',   './data/roles.json'],
  };

  // Chaves que nunca podem ser copiadas de um objeto vindo da rede:
  // atribuir `obj['__proto__'] = v` altera o protótipo e contamina todo
  // objeto do painel. JSON.parse não polui sozinho, a CÓPIA polui.
  //
  // Função explícita em vez de objeto-mapa de propósito: num literal,
  // `{__proto__: 1}` DEFINE o protótipo em vez de criar a chave, e a
  // consulta cairia no Object.prototype — fazendo `toString` e outras
  // herdadas parecerem proibidas por acidente.
  function isForbiddenKey(k) {
    return k === '__proto__' || k === 'constructor' || k === 'prototype';
  }

  // ── Padrões embarcados (piso — nunca ficamos sem isto) ──────
  var DEFAULT_ROLES = {
    roles: {
      cut:    { label: 'Passagem no corte', concepts: ['whoosh', 'transition'], minDur: 0.15, maxDur: 1.2, poolSize: 5 },
      impact: { label: 'Impacto',           concepts: ['impact', 'drop'],       minDur: 0.3,  maxDur: 2.5, poolSize: 4 },
      riser:  { label: 'Riser',             concepts: ['riser'],                minDur: 1.0,  maxDur: 4.0, poolSize: 3, requiresResolution: true },
      bed:    { label: 'Cama sonora',       concepts: ['drone', 'deep'],        minDur: 20,   maxDur: 600, poolSize: 3 },
    },
    limits: { maxPlacements: 60, maxTracksToCreate: 8, minGapSameFile: 10 },
  };

  // ── Primitivas de validação ─────────────────────────────────
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  function num(v, lo, hi, dflt) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return dflt;
    return clamp(n, lo, hi);
  }

  function str(v, maxLen) {
    if (typeof v !== 'string') return null;
    var s = v.trim();
    if (!s || s.length > maxLen) return null;
    return s;
  }

  // Lista de identificadores (nome de conceito): filtra formato e limita
  // quantidade. Não confia no comprimento vindo da rede.
  function idList(v, maxItems, maxLen) {
    if (!Array.isArray(v)) return null;
    var out = [];
    for (var i = 0; i < v.length && out.length < maxItems; i++) {
      var s = str(v[i], maxLen);
      if (s && /^[a-z0-9][a-z0-9_-]*$/i.test(s)) out.push(s.toLowerCase());
    }
    return out.length ? out : null;
  }

  // ── Validação: recipes.json ─────────────────────────────────
  function validateRecipes(raw) {
    var errors = [];
    if (!isObj(raw)) return { ok: false, errors: ['raiz não é objeto'] };
    if (raw.schemaVersion !== 1) return { ok: false, errors: ['schemaVersion desconhecida: ' + raw.schemaVersion] };
    if (!Array.isArray(raw.recipes)) return { ok: false, errors: ['recipes não é array'] };
    if (raw.recipes.length < 1 || raw.recipes.length > 50) {
      return { ok: false, errors: ['recipes com tamanho fora de 1..50: ' + raw.recipes.length] };
    }

    var out = [], seen = {};
    for (var i = 0; i < raw.recipes.length; i++) {
      var r = raw.recipes[i];
      if (!isObj(r)) { errors.push('receita ' + i + ' não é objeto'); continue; }

      var id = str(r.id, 32);
      if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) { errors.push('receita ' + i + ': id inválido'); continue; }
      if (seen[id]) { errors.push('id duplicado: ' + id); continue; }

      var label = str(r.label, 64);
      if (!label) { errors.push(id + ': label ausente'); continue; }

      if (!isObj(r.weights)) { errors.push(id + ': weights ausente'); continue; }
      var w = {}, nw = 0;
      for (var k in r.weights) {
        if (!Object.prototype.hasOwnProperty.call(r.weights, k)) continue;
        if (isForbiddenKey(k)) { errors.push(id + ': chave proibida ignorada (' + k + ')'); continue; }
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(k) || k.length > 32) continue;
        if (nw >= 30) break;                       // teto de conceitos por receita
        var val = num(r.weights[k], 0, 10, null);  // clamp 0..10
        if (val === null || val === 0) continue;
        w[k.toLowerCase()] = val;
        nw++;
      }
      if (!nw) { errors.push(id + ': nenhum peso válido'); continue; }

      seen[id] = 1;
      out.push({
        id: id,
        label: label,
        icon: str(r.icon, 8) || '🎵',
        desc: str(r.desc, 200) || '',
        weights: w,
      });
    }

    if (!out.length) return { ok: false, errors: errors.concat(['nenhuma receita válida']) };
    return { ok: true, value: out, errors: errors };
  }

  // ── Validação: roles.json ───────────────────────────────────
  function validateRoles(raw) {
    var errors = [];
    if (!isObj(raw)) return { ok: false, errors: ['raiz não é objeto'] };
    if (raw.schemaVersion !== 1) return { ok: false, errors: ['schemaVersion desconhecida: ' + raw.schemaVersion] };
    if (!isObj(raw.roles)) return { ok: false, errors: ['roles não é objeto'] };

    var roles = {}, n = 0;
    for (var key in raw.roles) {
      if (!Object.prototype.hasOwnProperty.call(raw.roles, key)) continue;
      if (isForbiddenKey(key)) { errors.push('chave proibida ignorada: ' + key); continue; }
      if (!/^[a-z][a-z0-9-]{1,31}$/i.test(key)) { errors.push('nome de papel inválido: ' + key); continue; }
      if (n >= 20) break;

      var r = raw.roles[key];
      if (!isObj(r)) { errors.push(key + ': não é objeto'); continue; }

      var concepts = idList(r.concepts, 10, 32);
      if (!concepts) { errors.push(key + ': concepts inválido'); continue; }

      // Janela de duração: valores absurdos viram clamp, e uma janela
      // invertida (min >= max) invalida o papel — é o defeito que
      // colocaria um riser de 6s em corte de 1s (ADR-008).
      var minDur = num(r.minDur, 0.02, 600, null);
      var maxDur = num(r.maxDur, 0.02, 600, null);
      if (minDur === null || maxDur === null) { errors.push(key + ': duração ausente'); continue; }
      if (minDur >= maxDur) { errors.push(key + ': janela invertida (' + minDur + '..' + maxDur + ')'); continue; }

      roles[key.toLowerCase()] = {
        label: str(r.label, 48) || key,
        concepts: concepts,
        minDur: minDur,
        maxDur: maxDur,
        poolSize: num(r.poolSize, 1, 20, 3),
        requiresResolution: r.requiresResolution === true,
      };
      n++;
    }

    if (!n) return { ok: false, errors: errors.concat(['nenhum papel válido']) };

    // Limites globais — a barreira contra dado que vira ação destrutiva
    var L = isObj(raw.limits) ? raw.limits : {};
    var limits = {
      maxPlacements:      num(L.maxPlacements, 1, 200, 60),
      maxTracksToCreate:  num(L.maxTracksToCreate, 1, 16, 8),
      minGapSameFile:     num(L.minGapSameFile, 0, 120, 10),
    };

    return { ok: true, value: { roles: roles, limits: limits }, errors: errors };
  }

  // Descarta conceitos que não existem no dicionário do manifest — um
  // nome errado faria o papel nunca casar, falhando em silêncio.
  function pruneUnknownConcepts(roles, dict) {
    if (!dict || !dict.length) return [];
    var known = {}, warn = [];
    for (var i = 0; i < dict.length; i++) known[String(dict[i].name).toLowerCase()] = 1;
    for (var key in roles) {
      if (!Object.prototype.hasOwnProperty.call(roles, key)) continue;
      var kept = roles[key].concepts.filter(function (c) { return known[c]; });
      var lost = roles[key].concepts.filter(function (c) { return !known[c]; });
      if (!kept.length) {
        // Todos desconhecidos: o papel nunca casaria nada. Mantemos a
        // lista (o motor espera o papel existir) mas avisamos que está
        // inerte — falha silenciosa aqui é pior que ruído no log.
        warn.push(key + ': INERTE — nenhum conceito existe no dicionário (' + lost.join(', ') + ')');
      } else if (lost.length) {
        warn.push(key + ': conceito inexistente descartado (' + lost.join(', ') + ')');
        roles[key].concepts = kept;
      }
    }
    return warn;
  }

  // ── Rede ────────────────────────────────────────────────────
  function fetchJson(urls, cb) {
    var i = 0;
    function next(lastErr) {
      if (i >= urls.length) return cb(lastErr || new Error('sem rotas'), null, null);
      var url = urls[i++];
      var xhr = new XMLHttpRequest();
      var done = false;
      xhr.open('GET', url, true);
      xhr.timeout = TIMEOUT_MS;
      xhr.onload = function () {
        if (done) return; done = true;
        if (xhr.status !== 200 && xhr.status !== 0) return next(new Error('HTTP ' + xhr.status));
        var text = xhr.responseText || '';
        if (text.length > MAX_BYTES) return next(new Error('resposta acima do teto'));
        // Um proxy/captive portal devolvendo HTML não é o nosso JSON
        if (/^\s*</.test(text)) return next(new Error('resposta não é JSON'));
        var parsed;
        try { parsed = JSON.parse(text); } catch (e) { return next(new Error('JSON inválido')); }
        cb(null, parsed, url);
      };
      xhr.onerror = xhr.ontimeout = function () {
        if (done) return; done = true;
        next(new Error('rede'));
      };
      try { xhr.send(); } catch (e) { next(e); }
    }
    next(null);
  }

  function loadOne(name, validate, embedded, cb) {
    fetchJson(SOURCES[name], function (err, raw, url) {
      if (err || !raw) return cb({ value: embedded, source: 'embedded', errors: [String(err && err.message || 'sem resposta')] });
      var v = validate(raw);
      if (!v.ok) {
        // Rejeitado por schema → piso embarcado, e o motivo fica visível
        return cb({ value: embedded, source: 'embedded', errors: v.errors });
      }
      var isLocal = String(url).indexOf('./') === 0;
      cb({ value: v.value, source: isLocal ? 'bundled' : 'remote', errors: v.errors });
    });
  }

  /**
   * Carrega receitas + papéis. Chama cb com:
   *   { recipes, roles, limits, source: {recipes, roles}, warnings: [] }
   * Nunca falha: na pior hipótese devolve os padrões embarcados.
   */
  function load(conceptsDict, cb) {
    var embeddedRecipes = global.CINEPRO_RECIPES || [];
    var result = { warnings: [], source: {} };
    var pending = 2;

    function finish() {
      if (--pending > 0) return;
      var warn = pruneUnknownConcepts(result.roles, conceptsDict);
      result.warnings = result.warnings.concat(warn);
      cb(result);
    }

    loadOne('recipes', validateRecipes, embeddedRecipes, function (r) {
      result.recipes = r.value;
      result.source.recipes = r.source;
      r.errors.forEach(function (e) { result.warnings.push('recipes: ' + e); });
      finish();
    });

    loadOne('roles', validateRoles, DEFAULT_ROLES, function (r) {
      result.roles  = r.value.roles;
      result.limits = r.value.limits;
      result.source.roles = r.source;
      r.errors.forEach(function (e) { result.warnings.push('roles: ' + e); });
      finish();
    });
  }

  var API = {
    load: load,
    validateRecipes: validateRecipes,
    validateRoles: validateRoles,
    pruneUnknownConcepts: pruneUnknownConcepts,
    DEFAULT_ROLES: DEFAULT_ROLES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.CinePRORemoteConfig = API;

})(typeof window !== 'undefined' ? window : globalThis);
