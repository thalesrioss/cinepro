#!/usr/bin/env node
// =============================================================
//  Estado do catálogo (BL-0010) — asserções
//
//  O risco: assinante sem rede lê "chave de API" ou vê ponto verde
//  com meia biblioteca. Testa o módulo puro (js/catalog-status.js) e
//  o loadEffects real do js/main.js, extraído e rodado num vm com
//  DOM mínimo e rede simulada (manifest abortado, Drive abortado).
//
//  Uso:  node tools/test-catalog-status.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const CS = require(path.join(ROOT, 'js', 'catalog-status.js'));

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
function group(s) { queue.push([null, s]); }

// ── módulo puro ─────────────────────────────────────────────
group('MODO DO CATÁLOGO');
const ok = (m) => () => Promise.resolve(m);
const no = () => Promise.reject(new Error('net::ERR_ABORTED'));
const M = { files: [1, 2, 3], builtAt: '2026-10-19T08:00:00Z' };

t('manifest carregou → full com contagem', async () => {
  const r = await CS.load({ manifest: ok(M), applyManifest: () => 3, drive: no });
  return (r.mode === 'full' && r.count === 3) || JSON.stringify(r);
});
t('manifest null + Drive ok → reduced', async () => {
  const r = await CS.load({ manifest: ok(null), applyManifest: () => 0, drive: ok() });
  return r.mode === 'reduced' || r.mode;
});
t('manifest rejeita + Drive ok → reduced', async () => {
  const r = await CS.load({ manifest: no, applyManifest: () => 0, drive: ok() });
  return r.mode === 'reduced' || r.mode;
});
t('applyManifest lança → cai pro Drive', async () => {
  const r = await CS.load({ manifest: ok(M), applyManifest: () => { throw new Error('x'); }, drive: ok() });
  return r.mode === 'reduced' || r.mode;
});
t('nada responde → offline, sem rejeitar', async () => {
  const r = await CS.load({ manifest: no, applyManifest: () => 0, drive: no });
  return r.mode === 'offline' || r.mode;
});

group('TEXTO E PONTO');
t('full: verde, sem retry', () => {
  const v = CS.describe({ mode: 'full', count: 11636, builtAt: M.builtAt }, Date.parse('2026-10-19T10:00:00Z'));
  return (v.dot === 'ok' && !v.retry && v.text === '11636 efeitos prontos (manifest 2h atrás)') || JSON.stringify(v);
});
t('full sem builtAt não mostra "NaNh"', () => {
  const v = CS.describe({ mode: 'full', count: 5, builtAt: null });
  return v.text === '5 efeitos prontos' || v.text;
});
t('reduced: amarelo, texto do critério, retry', () => {
  const v = CS.describe({ mode: 'reduced' });
  return (v.dot === 'warn' && v.retry &&
    v.text === 'Biblioteca em modo reduzido (sem conexão com o acervo completo)' &&
    !/categorias prontas/.test(v.text)) || JSON.stringify(v);
});
t('offline: vermelho, "Sem conexão com a biblioteca.", retry', () => {
  const v = CS.describe({ mode: 'offline' });
  return (v.dot === 'error' && v.retry && v.text === 'Sem conexão com a biblioteca.' &&
    /Sem conexão com a biblioteca\./.test(v.empty)) || JSON.stringify(v);
});
t('nenhum texto do módulo fala em API/chave', () => {
  const all = JSON.stringify(CS.TEXT) + JSON.stringify(CS.describe({ mode: 'offline' }));
  return !/chave|API/i.test(all) || all;
});

// ── main.js real, extraído ──────────────────────────────────
const MAIN = fs.readFileSync(path.join(ROOT, 'js', 'main.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('não achei ' + name + ' em main.js');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('função ' + name + ' sem fim');
}

function harness(net) {
  const el = (id) => ({ id, className: '', textContent: '', innerHTML: '', hidden: id === 'status-retry' });
  const nodes = { 'status-dot': el('status-dot'), 'status-text': el('status-text'),
    'status-retry': el('status-retry'), 'effects-grid': el('effects-grid'),
    'sidebar-skeleton': el('sidebar-skeleton') };
  nodes['sidebar-skeleton'].textContent = 'Carregando categorias...';
  const calls = { tabs: 0, index: 0 };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Promise, Date,
    document: { getElementById: (id) => nodes[id] || null,
      querySelector: (sel) => sel === '#sidebar-tree .sidebar-skeleton' ? nodes['sidebar-skeleton'] : null },
    MANIFEST_URLS: ['cdn', './manifest.json'],
    CINEPRO_CONFIG: { GOOGLE_DRIVE_FOLDER_ID: 'root' },
    allEffects: [], driveCategories: [], driveLoadedCats: {}, catalogLoad: null,
    tryManifest: () => Promise.resolve(net.manifest ? { files: new Array(net.manifest).fill(0), builtAt: '2026-10-19T08:00:00Z' } : null),
    applyManifest(m) { ctx.allEffects = m.files.map((_, i) => ({ id: i })); calls.tabs++; calls.index++; },
    listDriveFolderAll: () => net.drive ? Promise.resolve([{ name: 'SFX', folder: true }, { name: 'a.wav' }]) : Promise.reject(new Error('Drive 403')),
    isFolder: (f) => !!f.folder, notFolder: (f) => !f.folder,
    shouldSkipFolder: () => false, shouldSkipFile: () => false,
    brandCategoryName: (n) => n, driveFileToEffect: (f, c) => ({ name: f.name, category: c }),
    buildSearchIndex() { calls.index++; }, buildCategoryTabs() { calls.tabs++; },
    renderEffects() {},
    renderEmpty(msg) { nodes['effects-grid'].innerHTML = msg; },
    showToast() {},
  };
  ctx.window = ctx;
  ctx.CinePROCatalogStatus = CS;
  vm.createContext(ctx);
  const code = ['setStatus', 'loadEffects', 'showCatalogRetry', 'renderCatalogOffline', 'loadEffectsFromDriveLive']
    .map((n) => extractFn(MAIN, n)).join('\n');
  vm.runInContext(code, ctx);
  return { ctx, nodes, calls };
}

group('loadEffects DO main.js (rede simulada)');
t('manifest ok → ponto verde e contagem, sem retry', async () => {
  const h = harness({ manifest: 11636, drive: true });
  await h.ctx.loadEffects();
  const n = h.nodes;
  return (n['status-dot'].className === 'status-dot ok' && /^11636 efeitos prontos/.test(n['status-text'].textContent) &&
    n['status-retry'].hidden) || [n['status-dot'].className, n['status-text'].textContent, n['status-retry'].hidden].join(' | ');
});
t('manifest abortado + Drive ok → amarelo "modo reduzido" + Tentar de novo', async () => {
  const h = harness({ manifest: 0, drive: true });
  await h.ctx.loadEffects();
  const n = h.nodes;
  return (n['status-dot'].className === 'status-dot warn' &&
    n['status-text'].textContent === 'Biblioteca em modo reduzido (sem conexão com o acervo completo)' &&
    n['status-retry'].hidden === false) || [n['status-dot'].className, n['status-text'].textContent, n['status-retry'].hidden].join(' | ');
});
t('tudo abortado → vermelho, grade com mensagem e botão, sem "chave de API"', async () => {
  const h = harness({ manifest: 0, drive: false });
  await h.ctx.loadEffects();
  const n = h.nodes, grid = n['effects-grid'].innerHTML;
  return (n['status-dot'].className === 'status-dot error' &&
    n['status-text'].textContent === 'Sem conexão com a biblioteca.' &&
    /class="[^"]*catalog-retry[^"]*"[^>]*>Tentar de novo</.test(grid) &&
    !/chave de API/i.test(grid) && n['status-retry'].hidden === false) || [n['status-dot'].className, n['status-text'].textContent, grid].join(' | ');
});
t('tudo abortado → sidebar não fica em "Carregando categorias..."', async () => {
  const h = harness({ manifest: 0, drive: false });
  await h.ctx.loadEffects();
  const txt = h.nodes['sidebar-skeleton'].textContent;
  return txt === CS.TEXT.sidebarOffline || txt;
});
t('"Tentar de novo" com a rede de volta → acervo completo, verde, retry some', async () => {
  const net = { manifest: 0, drive: true };
  const h = harness(net);
  await h.ctx.loadEffects();
  net.manifest = 11636;            // rede voltou
  await h.ctx.loadEffects();       // o que o clique no botão chama
  const n = h.nodes;
  return (n['status-dot'].className === 'status-dot ok' && /^11636 efeitos prontos/.test(n['status-text'].textContent) &&
    n['status-retry'].hidden && h.ctx.allEffects.length === 11636) ||
    [n['status-dot'].className, n['status-text'].textContent, h.ctx.allEffects.length].join(' | ');
});
t('modo reduzido não duplica itens a cada retry', async () => {
  const h = harness({ manifest: 0, drive: true });
  await h.ctx.loadEffects(); await h.ctx.loadEffects();
  // 1 arquivo solto (categoria "Geral") + 1 pasta ("SFX") = 2 categorias
  return (h.ctx.allEffects.length === 1 && h.ctx.driveCategories.length === 2) ||
    h.ctx.allEffects.length + ' efeitos, ' + h.ctx.driveCategories.length + ' categorias';
});

t('dois cliques rápidos em "Tentar de novo" → uma carga só, sem categorias duplicadas', async () => {
  const h = harness({ manifest: 0, drive: true });
  await h.ctx.loadEffects();
  let walks = 0; const list = h.ctx.listDriveFolderAll;
  h.ctx.listDriveFolderAll = (id) => { walks++; return list(id); };
  const a = h.ctx.loadEffects(), b = h.ctx.loadEffects();   // clique duplo
  await Promise.all([a, b]);
  return (a === b && walks === 1 && h.ctx.driveCategories.length === 2 && h.ctx.catalogLoad === null) ||
    'mesma promise=' + (a === b) + ', walks=' + walks + ', categorias=' + h.ctx.driveCategories.length;
});
t('depois que a carga termina, novo clique carrega de novo', async () => {
  const h = harness({ manifest: 0, drive: true });
  await h.ctx.loadEffects();
  const p1 = h.ctx.loadEffects(); await p1;
  const p2 = h.ctx.loadEffects(); await p2;
  return p1 !== p2 || 'reaproveitou carga já terminada';
});

group('CRITÉRIO DO BL-0010 (estático)');
t('js/main.js sem "chave de API"', () => !/chave de API/.test(MAIN) || 'ainda tem');
t('index.html carrega catalog-status.js antes de main.js e tem #status-retry', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf('js/catalog-status.js'), b = html.indexOf('js/main.js');
  return (a > 0 && a < b && /id="status-retry"[^>]*hidden/.test(html)) || 'ordem ou botão errados';
});
t('index.html não põe "Limpar busca" na grade do catálogo fora do ar', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return /querySelector\('\.catalog-retry'\)\) return;/.test(html) || 'observer sem a exceção';
});
t('CSS tem ponto amarelo (.status-dot.warn)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
  return /\.status-dot\.warn\s*\{[^}]*--warning/.test(css) || 'faltou';
});

(async () => {
  for (const [name, fn] of queue) {
    if (name === null) { console.log('\n══ ' + fn + ' ══'); continue; }
    try {
      const r = await fn();
      if (r === true) { pass++; console.log('  ✓ ' + name); }
      else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
    } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
  }
  console.log('\n' + pass + ' ok, ' + fail + ' falhas');
  process.exit(fail ? 1 : 0);
})();
