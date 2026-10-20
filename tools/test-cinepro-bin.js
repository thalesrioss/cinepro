#!/usr/bin/env node
// =============================================================
//  Bin "CinePRO" — asserções (BL-0061)
//
//  Tudo que o plugin aplica vai para a bin "CinePRO" na raiz e o
//  mesmo arquivo é reaproveitado (busca por getMediaPath), em vez de
//  encher a raiz do projeto com uma cópia por aplicação.
//  As funções vivem no .jsx (ExtendScript); o teste extrai o código
//  delas e roda no Node contra um app.project falso.
//
//  Uso:  node tools/test-cinepro-bin.js
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'jsx/hostscript.jsx'), 'utf8');

function source(name) {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(name + ' não encontrada no hostscript.jsx');
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) break;
  }
  return SRC.slice(at, i + 1);
}

// Compila as funções com `app` e `File` injetados (globais no ExtendScript).
function load(app, File) {
  const names = ['cineproBin', 'sameMediaPath', 'findChildByPath', 'importIntoCineproBin',
                 'applyAtTime', 'walkProjectItems', 'findOfflineMedia'];
  const body = names.map(source).join('\n') +
    '\nvar AUDIO_EXTS = { wav: 1, mp3: 1 };' +
    '\nfunction placeItemSmart(seq, isAudio, item, sec) { seq.placed.push({ item: item, sec: sec }); return "OK:PLACED_TRACK_1"; }' +
    '\nreturn {' + names.map((n) => n + ':' + n).join(',') + '};';
  return new Function('app', 'File', body)(app, File);
}

// ── Premiere falso ───────────────────────────────────────────
function children(list) {
  const c = { get numItems() { return list.length; } };
  return new Proxy(c, { get: (t, k) => (k in t ? t[k] : list[k]) });
}
function makeBin(name, type) {
  const list = [];
  const bin = {
    name, type, list, children: children(list),
    createBin(n) { const b = makeBin(n, 2); list.push(b); return b; },
    getMediaPath() { return ''; },
  };
  return bin;
}
function makeClip(p, offline) {
  return {
    name: p.split(/[\\/]/).pop(), type: 1, offline: !!offline, relinked: 0,
    getMediaPath() { return p; },
    isOffline() { return this.offline; },
    changeMediaPath() { this.relinked++; this.offline = false; },
  };
}
function makeApp(opts) {
  opts = opts || {};
  const root = makeBin('Root', 3);
  const seq = { placed: [] };
  const app = {
    imports: [],
    project: {
      rootItem: root,
      activeSequence: seq,
      importFiles(files, suppress, bin) {
        app.imports.push({ files, bin });
        files.forEach((f) => {
          const it = makeClip(f);
          // MOGRT: Premiere pode não devolver o caminho do arquivo
          if (opts.noMediaPath) { it.getMediaPath = () => ''; it.name = it.name.replace(/\.[^.]+$/, ''); }
          bin.list.push(it);
        });
        return true;
      },
    },
  };
  return { app, root, seq };
}
function FakeFile(p) { this.path = p; this.exists = !/sumiu/.test(p); }

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  → ' + e.message); }
}
const binsNamed = (root, n) => root.list.filter((x) => x.name === n && x.type === 2);

console.log('\nBin "CinePRO" (BL-0061)\n');

t('1ª inserção cria a bin "CinePRO" e importa nela', () => {
  const { app, root } = makeApp();
  const h = load(app, FakeFile);
  const it = h.importIntoCineproBin('/cache/sfx/whoosh.wav');
  const bins = binsNamed(root, 'CinePRO');
  if (bins.length !== 1) return 'bins CinePRO: ' + bins.length;
  if (app.imports.length !== 1 || app.imports[0].bin !== bins[0]) return 'importou fora da bin';
  if (!it || it.getMediaPath() !== '/cache/sfx/whoosh.wav') return 'item errado';
  return root.list.length === 1 || 'raiz tem ' + root.list.length + ' itens';
});

t('2ª inserção do mesmo arquivo não chama importFiles e devolve o mesmo item', () => {
  const { app } = makeApp();
  const h = load(app, FakeFile);
  const a = h.importIntoCineproBin('/cache/sfx/whoosh.wav');
  const b = h.importIntoCineproBin('/cache/sfx/whoosh.wav');
  if (app.imports.length !== 1) return 'importFiles chamado ' + app.imports.length + 'x';
  return a === b || 'itens diferentes';
});

t('mesmo nome em outra pasta importa à parte', () => {
  const { app, root } = makeApp();
  const h = load(app, FakeFile);
  const a = h.importIntoCineproBin('/cache/packA/whoosh.wav');
  const b = h.importIntoCineproBin('/cache/packB/whoosh.wav');
  if (app.imports.length !== 2) return 'importFiles chamado ' + app.imports.length + 'x';
  if (a === b) return 'reaproveitou o arquivo errado';
  return binsNamed(root, 'CinePRO')[0].list.length === 2 || 'bin sem os 2 itens';
});

t('caminho com barra invertida (Windows) casa com o mesmo arquivo', () => {
  const { app } = makeApp();
  const h = load(app, FakeFile);
  h.importIntoCineproBin('C:\\Users\\x\\CinePRO\\cache\\hit.wav');
  h.importIntoCineproBin('C:/Users/x/CinePRO/cache/hit.wav');
  return app.imports.length === 1 || 'importou ' + app.imports.length + 'x';
});

t('bin "CinePRO" já existente é reaproveitada (não cria outra)', () => {
  const { app, root } = makeApp();
  root.createBin('CinePRO');
  const h = load(app, FakeFile);
  h.importIntoCineproBin('/cache/a.wav');
  return binsNamed(root, 'CinePRO').length === 1 || 'criou bin duplicada';
});

t('bin renomeada pelo editor: cria outra "CinePRO"', () => {
  const { app, root } = makeApp();
  const h = load(app, FakeFile);
  h.importIntoCineproBin('/cache/a.wav');
  binsNamed(root, 'CinePRO')[0].name = 'Meus SFX';
  h.importIntoCineproBin('/cache/a.wav');
  if (binsNamed(root, 'CinePRO').length !== 1) return 'não recriou a bin';
  return app.imports.length === 2 || 'importFiles ' + app.imports.length + 'x';
});

t('bin movida para dentro de outra pasta: procura só na raiz e cria de novo', () => {
  const { app, root } = makeApp();
  const h = load(app, FakeFile);
  h.importIntoCineproBin('/cache/a.wav');
  const pasta = root.createBin('Edição');
  pasta.list.push(root.list.shift()); // editor arrastou a bin "CinePRO" para "Edição"
  h.importIntoCineproBin('/cache/a.wav');
  return binsNamed(root, 'CinePRO').length === 1 || 'não recriou na raiz';
});

t('um item que não é bin chamado "CinePRO" não é usado como bin', () => {
  const { app, root } = makeApp();
  root.list.push(makeClip('/x/CinePRO'));
  const h = load(app, FakeFile);
  h.importIntoCineproBin('/cache/a.wav');
  return binsNamed(root, 'CinePRO').length === 1 || 'usou o clipe como bin';
});

t('createBin falhando: importa na raiz como antes', () => {
  const { app, root } = makeApp();
  root.createBin = () => { throw new Error('read-only'); };
  const h = load(app, FakeFile);
  const it = h.importIntoCineproBin('/cache/a.wav');
  return (it && app.imports[0].bin === root) || 'não caiu na raiz';
});

t('MOGRT sem getMediaPath: acha o recém-importado pelo nome sem extensão', () => {
  const { app } = makeApp({ noMediaPath: true });
  const h = load(app, FakeFile);
  const it = h.importIntoCineproBin('/cache/titulo.mogrt');
  return (it && it.name === 'titulo') || 'não achou o item';
});

t('item reaproveitado que estava offline é religado', () => {
  const { app, root } = makeApp();
  const h = load(app, FakeFile);
  const it = h.importIntoCineproBin('/cache/a.wav');
  it.offline = true;
  const again = h.importIntoCineproBin('/cache/a.wav');
  return (again === it && it.relinked === 1 && app.imports.length === 1) || 'relinked=' + it.relinked;
});

t('applyAtTime 3x com o mesmo SFX → 1 item na bin, 0 na raiz, 3 colocações', () => {
  const { app, root, seq } = makeApp();
  const h = load(app, FakeFile);
  for (let i = 0; i < 3; i++) {
    const r = h.applyAtTime('/cache/sfx/boom.wav', 'wav', i * 2);
    if (r.indexOf('OK:') !== 0) return 'retorno ' + r;
  }
  const bin = binsNamed(root, 'CinePRO')[0];
  if (root.list.length !== 1) return 'raiz com ' + root.list.length + ' itens';
  if (bin.list.length !== 1) return 'bin com ' + bin.list.length + ' itens';
  return (seq.placed.length === 3 && seq.placed.every((p) => p.item === bin.list[0])) || 'colocações erradas';
});

t('mídia offline continua achada dentro da bin (findOfflineMedia percorre bins)', () => {
  const { app } = makeApp();
  const h = load(app, FakeFile);
  h.importIntoCineproBin('/Lib/CinePRO/cache/sumiu.wav');
  h.importIntoCineproBin('/Lib/CinePRO/cache/ok.wav');
  const r = JSON.parse(h.findOfflineMedia());
  return (r.total === 2 && r.missing === 1) || JSON.stringify(r);
});

t('nenhuma inserção do hostscript importa direto na raiz (só preset)', () => {
  const direct = (SRC.match(/importFiles\(/g) || []).length;
  // 1 em importIntoCineproBin + 1 em importPreset (preset vai para o painel Efeitos, não para a timeline)
  return direct === 2 || 'importFiles aparece ' + direct + 'x';
});

console.log('\n' + pass + ' ok, ' + fail + ' falha(s)\n');
process.exit(fail ? 1 : 0);
