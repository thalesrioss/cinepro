// BL-0078: na visão lista, o botão "Aplicar" cabe inteiro em toda largura de painel.
// Abre o index.html no Chrome headless com Firebase e a ponte CEP simulados
// (rede real para o manifest), liga a visão lista e mede a primeira linha a
// 460, 480 (gaveta ☰ fechada e aberta), 520, 560, 600 e 700 px:
// `.btn-apply` dentro do card e linha sem rolagem horizontal. Também grava a
// geometria da visão grade a 520 px para comparar antes/depois.
// Uso: node tools/check-bl0078-harness.js <url-do-index.html> <rotulo> <pasta-saida>
// (playwright-core do clone do neweditor + Chrome do sistema; servidor
//  `python3 -m http.server` no mesmo exec)
const path = require('path');
const fs = require('fs');
const { chromium } = require('/Users/thalesrioss/.openclaw/newcontent/repos/neweditor/node_modules/playwright-core');

const [url, rotulo = 'branch', out = '/tmp/bl0078'] = process.argv.slice(2);
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
  await p.waitForSelector('#effects-grid [data-id]', { state: 'attached', timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.mouse.move(1, 1);
  return { ctx, p, errs };
}

const medeLinha = p => p.evaluate(() => {
  const row = document.querySelector('#effects-grid.view-list .effect-row');
  if (!row) return null;
  const r = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; };
  const btn = row.querySelector('.btn-apply');
  const wave = row.querySelector('.row-wave');
  return {
    card: r(row), apply: r(btn), applyTexto: btn.textContent.trim(),
    applyCorta: btn.scrollWidth > btn.clientWidth,
    applyLabel: btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent.trim(),
    scroll: row.scrollWidth + '/' + row.clientWidth,
    nome: r(row.querySelector('.row-info')),
    onda: wave.offsetParent ? r(wave) : 'oculta',
  };
});

const medeGrade = p => p.evaluate(() => [...document.querySelectorAll('#effects-grid [data-id]')].slice(0, 4).map(c => {
  const b = c.getBoundingClientRect();
  return [c.className, Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(':');
}).join(' | '));

const lista = async p => { await p.click('#view-list-btn'); await p.waitForTimeout(800); await p.mouse.move(1, 1); };

const confere = (m, tag) => {
  console.log(`[${rotulo}] ${tag}`, JSON.stringify(m));
  if (!m) { ok(false, `${tag}: sem linha na visão lista`); return; }
  ok(m.apply[1] <= m.card[1] && !m.applyCorta && m.applyTexto === 'Aplicar', `${tag}: "Aplicar" inteiro dentro do card (${m.apply} em ${m.card})`);
  const [sw, cw] = m.scroll.split('/').map(Number);
  ok(sw === cw, `${tag}: linha sem rolagem horizontal (${m.scroll})`);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

  // visão grade intocada: geometria a 520 px (comparar main × branch)
  {
    const { ctx, p } = await open(browser, 520);
    await p.click('#view-grid-btn'); await p.waitForTimeout(800); await p.mouse.move(1, 1);
    const g = await medeGrade(p);
    console.log(`[${rotulo}] grade-520 ${g}`);
    fs.writeFileSync(path.join(out, `${rotulo}-grade-520.txt`), g + '\n');
    await p.screenshot({ path: path.join(out, `${rotulo}-grade-520.png`) });
    await ctx.close();
  }

  for (const w of [460, 480, 520, 560, 600, 700]) {
    const { ctx, p, errs } = await open(browser, w);
    await lista(p);
    confere(await medeLinha(p), `${w}px`);
    await p.screenshot({ path: path.join(out, `${rotulo}-lista-${w}.png`) });
    if (w === 480 && await p.isVisible('#btn-sidebar-toggle')) {
      await p.click('#btn-sidebar-toggle'); await p.waitForTimeout(300);
      confere(await medeLinha(p), '480px gaveta aberta');
      await p.screenshot({ path: path.join(out, `${rotulo}-lista-480-gaveta.png`) });
    }
    ok(errs.length === 0, `${w}px: sem pageerror (${errs.join(' | ')})`);
    await ctx.close();
  }

  await browser.close();
  console.log(fail ? `${fail} falha(s)` : 'tudo ok');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
