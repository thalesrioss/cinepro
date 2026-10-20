// BL-0038: um número só para o tamanho do acervo no app desktop.
// Abre desktop-app/renderer/index.html no Chrome headless com Firebase e a
// ponte do Electron (window.cinepro) simulados e confere:
// - não assinante (sem manifest): preview diz "11.000+" no texto e na contagem;
// - assinante: o manifest (servido do repositório com counts.total trocado
//   para 12.345) muda placeholder da busca e texto do preview para "12.000+".
// Uso: node tools/check-bl0038-harness.js [caminho-do-index.html]
// (playwright-core do clone do neweditor + Chrome do sistema; não roda em CI)
const path = require('path');
const fs = require('fs');
const { chromium } = require('/Users/thalesrioss/.openclaw/newcontent/repos/neweditor/node_modules/playwright-core');

const html = process.argv[2] || path.join(__dirname, '..', 'desktop-app', 'renderer', 'index.html');
const manifestPath = path.join(__dirname, '..', 'manifest', 'dist', 'manifest.json');

const fake = active => `window.firebase={initializeApp(){},auth(){return{onAuthStateChanged(cb){setTimeout(()=>cb({email:'l@e.com',uid:'u1'}),50)},signOut(){return Promise.resolve()}}},firestore(){return{collection(){return{doc(){return{get(){return Promise.resolve({exists:true,data(){return{subscriptionActive:${active},lastStatus:'${active ? 'authorized' : 'trial_ended'}'}}})}}}}}}}};`;

function bridge() {
  const call = v => () => Promise.resolve(v);
  window.cinepro = {
    openExternal: call(true), openPremiere: call(true),
    cache: { size: call({ bytes: 0, count: 0 }), clear: call({ removed: 0, kept: 0 }) },
    isPluginInstalled: call(true), appVersion: call('1.0.16'),
    installAsset: call({ ok: true }), libraryDownload: call({ ok: true, path: '/tmp/x.mp3' }),
    resolveSend: call({ ok: true, queued: 1, scriptOk: true }),
    resolveStatus: call({ installed: true, scriptInstalled: true, queued: 0 }),
    resolveOpenQueue: call({ ok: true }), resolveClearQueue: call({ ok: true, removed: 0 }), resolveReinstall: call({ ok: true }),
    startDrag() {}, updateDownload: call({ ok: true }), updateInstall: call({ ok: true }), onUpdateProgress() {},
    platform: 'darwin',
  };
}

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FALHA ') + msg); if (!cond) fail++; };

async function open(browser, active) {
  const ctx = await browser.newContext({ viewport: { width: 920, height: 700 } });
  await ctx.route(/firebase-app-compat\.js/, x => x.fulfill({ contentType: 'text/javascript', body: fake(active) }));
  await ctx.route(/(auth|firestore)-compat\.js/, x => x.fulfill({ contentType: 'text/javascript', body: '' }));
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  m.counts.total = 12345;
  await ctx.route(/manifest\/dist\/manifest\.json/, x => x.fulfill({ contentType: 'application/json', body: JSON.stringify(m) }));
  await ctx.addInitScript(bridge);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(html));
  return { ctx, p, errs };
}

const read = p => p.evaluate(() => ({
  desc: document.querySelector('.library-preview-desc').textContent,
  ph: document.getElementById('lib-search').getAttribute('placeholder'),
  count: (document.getElementById('library-preview-count') || {}).textContent || '',
}));

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  });

  // Não assinante: sem manifest, fica no fallback (= manifest do repositório).
  let { ctx, p, errs } = await open(browser, false);
  await p.waitForTimeout(1500);
  await p.evaluate(() => renderLibrarySamples([]));
  let s = await read(p);
  ok(s.desc.includes('Acesso completo a 11.000+ efeitos'), 'não assinante, texto do preview: ' + s.desc);
  ok(s.count === 'Amostra · 11.000+ efeitos no total', 'não assinante, contagem: ' + s.count);
  ok(!/12\.000/.test(s.desc + s.count + s.ph), 'nenhum "12.000" na tela do não assinante');
  ok(errs.length === 0, 'sem pageerror ' + JSON.stringify(errs));
  await ctx.close();

  // Assinante: manifest com counts.total = 12.345 vira "12.000+".
  ({ ctx, p, errs } = await open(browser, true));
  await p.waitForFunction(() => window.INST_MANIFEST, null, { timeout: 20000 });
  await p.evaluate(() => renderLibrarySamples([]));
  s = await read(p);
  ok(s.ph === 'Buscar em 12.000+ efeitos… (ex: chuva, whoosh, épico)', 'assinante, placeholder lê counts.total: ' + s.ph);
  ok(s.desc.includes('Acesso completo a 12.000+ efeitos'), 'assinante, texto do preview lê counts.total: ' + s.desc);
  ok(s.count === 'Amostra · 12.000+ efeitos no total', 'assinante, contagem lê counts.total: ' + s.count);
  ok(errs.length === 0, 'sem pageerror ' + JSON.stringify(errs));
  await ctx.close();

  await browser.close();
  console.log(fail ? `${fail} falha(s)` : 'tudo ok');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(2); });
