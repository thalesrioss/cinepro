// BL-0051: painel estreito (≤ 480 px) com ☰ que abre a sidebar como gaveta.
// Abre o index.html no Chrome headless com Firebase e a ponte CEP simulados
// (rede real para o manifest) nas larguras 420, 470 e 520 e confere:
// ☰ só ≤ 480; a 470 o ☰ abre a gaveta, Favoritos e um Pack filtram e fecham,
// pasta só expande, Esc e clique fora fecham, foco volta ao ☰, alargar fecha.
// Uso: node tools/check-bl0051-harness.js <url-do-index.html> <rotulo> <pasta-saida>
// (playwright-core do clone do neweditor + Chrome do sistema; servidor
//  `python3 -m http.server` no mesmo exec)
const path = require('path');
const fs = require('fs');
const { chromium } = require('/Users/thalesrioss/.openclaw/newcontent/repos/neweditor/node_modules/playwright-core');

const [url, rotulo = 'branch', out = '/tmp/bl0051'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

const FAKE = `window.firebase={initializeApp(){},auth(){return{onAuthStateChanged(cb){setTimeout(()=>cb({email:'l@e.com',uid:'u1'}),50)},signOut(){return Promise.resolve()}}},firestore(){return{collection(){return{doc(){return{get(){return Promise.resolve({exists:true,data(){return{subscriptionActive:true}}})}}}}}}}};`;

function cep() {
  window.__adobe_cep__ = {
    getHostEnvironment: () => JSON.stringify({ appName: 'PPRO', appVersion: '26.5.2', appSkinInfo: { panelBackgroundColor: { color: { red: 35, green: 35, blue: 35 } } } }),
    getSystemPath: t => '/tmp/x/' + t,
    evalScript: (c, cb) => setTimeout(() => cb && cb(c.indexOf('getCacheDir') === 0 ? '/tmp/chc-w' : 'EvalScript error.'), 10),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, requestOpenExtension() {},
    getExtensions: () => '[]', closeExtension() {}, getNetworkPreferences: () => '{}', initResourceBundle: () => '{}',
    dumpInstallationInfo: () => '', getCurrentApiVersion: () => JSON.stringify({ major: 12, minor: 0, micro: 0 }),
    openURLInDefaultBrowser() {}, getCurrentImsUserId: () => '',
  };
  window.cep = { fs: { readFile: () => ({ err: 1 }), stat: () => ({ err: 1 }) }, util: { openURLInDefaultBrowser() {} } };
}

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FALHA ') + msg); if (!cond) fail++; };

async function open(browser, w) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 720 } });
  await ctx.route(/firebase-app-compat\.js/, x => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await ctx.route(/(auth|firestore)-compat\.js/, x => x.fulfill({ contentType: 'text/javascript', body: '' }));
  await ctx.addInitScript(cep);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(url);
  // Packs entram na árvore depois do manifest (conceitos + receitas)
  await p.waitForSelector('#sidebar-tree .sidebar-item[data-cat^="pack:"]', { state: 'attached', timeout: 20000 });
  await p.waitForTimeout(1500);
  // Mouse longe dos cards (prefetch por hover)
  await p.mouse.move(1, 1);
  return { ctx, p, errs };
}

const state = p => p.evaluate(() => ({
  toggle: !!document.getElementById('btn-sidebar-toggle') && document.getElementById('btn-sidebar-toggle').offsetParent !== null,
  sidebar: document.getElementById('sidebar').offsetParent !== null,
  expanded: document.getElementById('btn-sidebar-toggle') && document.getElementById('btn-sidebar-toggle').getAttribute('aria-expanded'),
  focoNoToggle: document.activeElement && document.activeElement.id === 'btn-sidebar-toggle',
  ativo: (document.querySelector('#sidebar-tree .sidebar-item.is-active') || {}).dataset ? document.querySelector('#sidebar-tree .sidebar-item.is-active').dataset.cat : null,
  status: (document.getElementById('status-text') || {}).textContent,
}));

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

  for (const w of [420, 520]) {
    const { ctx, p, errs } = await open(browser, w);
    const s = await state(p);
    console.log(`[${rotulo}] ${w}px`, JSON.stringify(s));
    await p.screenshot({ path: path.join(out, `${rotulo}-${w}.png`) });
    if (rotulo !== 'main') {
      if (w <= 480) ok(s.toggle && !s.sidebar, `${w}px: ☰ visível, sidebar fora da grade`);
      else ok(!s.toggle && s.sidebar, `${w}px: sem ☰, sidebar na grade como antes`);
      ok(errs.length === 0, `${w}px: sem pageerror (${errs.join(' | ')})`);
    }
    await ctx.close();
  }

  if (rotulo !== 'main') {
    const { ctx, p, errs } = await open(browser, 470);
    let s = await state(p);
    ok(s.toggle && !s.sidebar, '470px: ☰ visível, sidebar fechada');
    await p.screenshot({ path: path.join(out, `${rotulo}-470.png`) });

    await p.click('#btn-sidebar-toggle', { timeout: 3000 });
    s = await state(p);
    ok(s.sidebar && s.expanded === 'true', '470px: ☰ abre a gaveta');
    await p.screenshot({ path: path.join(out, `${rotulo}-470-aberta.png`) });

    await p.click('#sidebar-tree .sidebar-item[data-cat="favorites"]', { timeout: 3000 });
    await p.waitForTimeout(300);
    s = await state(p);
    ok(!s.sidebar && s.ativo === 'favorites' && s.focoNoToggle, `470px: Favoritos filtra, fecha e devolve foco (${JSON.stringify(s)})`);
    await p.screenshot({ path: path.join(out, `${rotulo}-470-favoritos.png`) });

    await p.click('#btn-sidebar-toggle');
    s = await state(p);
    ok(s.sidebar && s.expanded === 'true', `470px: ☰ reabre a gaveta (${JSON.stringify(s)})`);
    const pack = await p.$('#sidebar-tree .sidebar-item[data-cat^="pack:"]');
    ok(!!pack, '470px: gaveta tem Packs prontos');
    if (pack) {
      const packCat = await pack.getAttribute('data-cat');
      await pack.click({ timeout: 3000 });
      await p.waitForTimeout(300);
      s = await state(p);
      ok(!s.sidebar && s.ativo === packCat, `470px: Pack ${packCat} filtra e fecha (${s.status})`);
      await p.screenshot({ path: path.join(out, `${rotulo}-470-pack.png`) });
    }

    await p.click('#btn-sidebar-toggle');
    const temRestaurar = await p.isVisible('#sidebar-tree .sidebar-item[data-cat="restore-media"]');
    const temDiag = await p.isVisible('#sidebar-tree .sidebar-item[data-cat="diagnostics"]');
    ok(temRestaurar && temDiag, '470px: Restaurar mídias e Diagnóstico visíveis na gaveta');
    const pasta = await p.$('#sidebar-tree .sidebar-item.is-folder');
    if (pasta) {
      await pasta.click();
      await p.waitForTimeout(1500);
      s = await state(p);
      ok(s.sidebar, '470px: clicar numa pasta expande e mantém a gaveta aberta');
    }

    await p.keyboard.press('Escape');
    s = await state(p);
    ok(!s.sidebar && s.focoNoToggle, '470px: Esc fecha e foco volta ao ☰');

    await p.click('#btn-sidebar-toggle');
    const evalAntes = await p.evaluate(() => document.querySelectorAll('.effect-card.is-selected, .effect-card.selected').length);
    await p.mouse.click(440, 400);
    await p.waitForTimeout(200);
    s = await state(p);
    const evalDepois = await p.evaluate(() => document.querySelectorAll('.effect-card.is-selected, .effect-card.selected').length);
    ok(!s.sidebar && s.focoNoToggle && evalAntes === evalDepois, '470px: clique fora fecha sem selecionar o card de baixo');

    await p.click('#btn-sidebar-toggle');
    await p.setViewportSize({ width: 520, height: 720 });
    await p.waitForTimeout(200);
    s = await state(p);
    ok(s.sidebar && !s.toggle && s.expanded === 'false', '470→520px com gaveta aberta: volta à grade normal');

    ok(errs.length === 0, `470px: sem pageerror (${errs.join(' | ')})`);
    await ctx.close();
  }

  await browser.close();
  console.log(fail ? `${fail} falha(s)` : 'tudo ok');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
