// BL-0068: "↻ Outra opção" por papel no preview do "⚡ Aplicar pack".
// Abre o index.html no Chrome headless com Firebase e a ponte CEP simulados
// (getCutPoints devolve uma timeline de 12 cortes; rede real para o manifest),
// abre o pack Trailer, monta o plano e clica ↻ no Impacto: só a linha do
// Impacto muda; o botão segue "✓ Confirmar e aplicar"; nenhuma chamada de
// aplicação vai para o ExtendScript.
// Uso: node tools/check-bl0068-harness.js <url-do-index.html> <pasta-saida>
// (playwright-core do clone do neweditor + Chrome do sistema; servidor
//  `python3 -m http.server` no mesmo exec)
const path = require('path');
const fs = require('fs');
const { chromium } = require('/Users/thalesrioss/.openclaw/newcontent/repos/neweditor/node_modules/playwright-core');

const [url, out = '/tmp/bl0068'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

const FAKE = `window.firebase={initializeApp(){},auth(){return{onAuthStateChanged(cb){setTimeout(()=>cb({email:'l@e.com',uid:'u1'}),50)},signOut(){return Promise.resolve()}}},firestore(){return{collection(){return{doc(){return{get(){return Promise.resolve({exists:true,data(){return{subscriptionActive:true}}})}}}}}}}};`;

function cep() {
  window.__evals = [];
  const cuts = []; for (let i = 0; i < 12; i++) cuts.push(6 + i * 1.5);
  const TL = JSON.stringify({ clips: 13, cuts, duration: 27, playhead: 0 });
  window.__adobe_cep__ = {
    getHostEnvironment: () => JSON.stringify({ appName: 'PPRO', appVersion: '26.5.2', appSkinInfo: { panelBackgroundColor: { color: { red: 35, green: 35, blue: 35 } } } }),
    getSystemPath: t => '/tmp/x/' + t,
    evalScript: (c, cb) => {
      window.__evals.push(c);
      setTimeout(() => cb && cb(c.indexOf('getCacheDir') === 0 ? '/tmp/chc-w'
        : c.indexOf('getCutPoints') === 0 ? TL : 'EvalScript error.'), 10);
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, requestOpenExtension() {},
    getExtensions: () => '[]', closeExtension() {}, getNetworkPreferences: () => '{}', initResourceBundle: () => '{}',
    dumpInstallationInfo: () => '', getCurrentApiVersion: () => JSON.stringify({ major: 12, minor: 0, micro: 0 }),
    openURLInDefaultBrowser() {}, getCurrentImsUserId: () => '',
  };
  window.cep = { fs: { readFile: () => ({ err: 1 }), stat: () => ({ err: 1 }) }, util: { openURLInDefaultBrowser() {} } };
}

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FALHA ') + msg); if (!cond) fail++; };

const rows = p => p.evaluate(() => {
  const o = {};
  document.querySelectorAll('.pack-plan-row').forEach(r => {
    const b = r.querySelector('.pack-plan-reroll');
    o[r.dataset.role] = { detail: r.querySelector('.pack-plan-detail').textContent, off: !!(b && b.disabled) };
  });
  return o;
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 720 } });
  await ctx.route(/firebase-app-compat\.js/, x => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await ctx.route(/(auth|firestore)-compat\.js/, x => x.fulfill({ contentType: 'text/javascript', body: '' }));
  await ctx.addInitScript(cep);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(url);
  await p.waitForSelector('#sidebar-tree .sidebar-item[data-cat="pack:trailer"]', { state: 'attached', timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.mouse.move(1, 1);

  await p.click('#sidebar-tree .sidebar-item[data-cat="pack:trailer"]');
  await p.waitForSelector('.pack-apply', { timeout: 5000 });
  await p.click('.pack-apply');
  await p.waitForSelector('.pack-plan-row', { timeout: 5000 });
  const antes = await rows(p);
  console.log('antes', JSON.stringify(antes));
  await p.screenshot({ path: path.join(out, 'plano-antes.png') });
  ok(Object.keys(antes).length >= 3 && Object.values(antes).every(r => !r.off), 'cada linha de papel tem ↻ ligado');

  await p.click('.pack-plan-reroll[data-role="impact"]');
  await p.waitForTimeout(200);
  const depois = await rows(p);
  console.log('depois', JSON.stringify(depois));
  await p.screenshot({ path: path.join(out, 'plano-depois-impacto.png') });
  ok(depois.impact && depois.impact.detail !== antes.impact.detail, 'Impacto trocou de som');
  ok(Object.keys(antes).filter(r => r !== 'impact').every(r => depois[r] && depois[r].detail === antes[r].detail),
     'outros papéis iguais');
  const btn = await p.textContent('.pack-apply');
  ok(/Confirmar e aplicar/.test(btn), 'botão continua "Confirmar e aplicar" (' + btn + ')');
  const aplicou = await p.evaluate(() => window.__evals.filter(c => /applyAtTime|ensureFreeAudioTracks/.test(c)).length);
  ok(aplicou === 0, 'o ↻ não chama o ExtendScript para aplicar');
  const foco = await p.evaluate(() => document.activeElement && document.activeElement.dataset.role);
  ok(foco === 'impact', 'foco fica no ↻ do Impacto (clique repetido no teclado)');

  ok(errs.length === 0, 'sem pageerror (' + errs.join(' | ') + ')');
  await browser.close();
  console.log(fail ? `${fail} falha(s)` : 'tudo ok');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
