// BL-0035: ouvir antes de baixar na biblioteca do app desktop.
// Abre desktop-app/renderer/index.html no Chrome headless com Firebase e a
// ponte do Electron (window.cinepro) simulados, assinante ativo, rede real
// para o manifest (jsDelivr) e para o áudio (CDN R2), e confere:
// só linha de áudio tem ▶; ▶ na 1ª toca a URL da CDN; ▶ na 2ª para a 1ª
// (um só <audio>, um só tocando); ▶ de novo na mesma para; digitar na busca
// para; nenhuma violação de CSP.
// Uso: node tools/check-bl0035-harness.js [caminho-do-index.html] [pasta-saida]
// (playwright-core do clone do neweditor + Chrome do sistema; não roda em CI)
const path = require('path');
const fs = require('fs');
const { chromium } = require('/Users/thalesrioss/.openclaw/newcontent/repos/neweditor/node_modules/playwright-core');

const html = process.argv[2] || path.join(__dirname, '..', 'desktop-app', 'renderer', 'index.html');
const out = process.argv[3] || '/tmp/bl0035';
fs.mkdirSync(out, { recursive: true });

const FAKE = `window.firebase={initializeApp(){},auth(){return{onAuthStateChanged(cb){setTimeout(()=>cb({email:'l@e.com',uid:'u1'}),50)},signOut(){return Promise.resolve()}}},firestore(){return{collection(){return{doc(){return{get(){return Promise.resolve({exists:true,data(){return{subscriptionActive:true,lastStatus:'authorized'}}})}}}}}}}};`;

function bridge() {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
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

// Estado de todos os <audio> da página + qual ▶ está marcado.
const state = p => p.evaluate(() => ({
  audios: [...document.querySelectorAll('audio')].map(a => ({ src: a.getAttribute('src') || '', paused: a.paused, t: a.currentTime, err: a.error && a.error.code })),
  playing: [...document.querySelectorAll('#lib-grid .lib-play')].map((b, i) => b.classList.contains('is-playing') ? i : -1).filter(i => i >= 0),
}));

// Espera o <audio> avançar de verdade (prova que a CDN entregou e a CSP deixou).
async function waitPlaying(p) {
  for (let i = 0; i < 40; i++) {
    const s = await state(p);
    if (s.audios.length === 1 && !s.audios[0].paused && s.audios[0].t > 0) return s;
    if (s.audios.some(a => a.err)) return s;
    await p.waitForTimeout(150);
  }
  return state(p);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--autoplay-policy=user-gesture-required', '--mute-audio'],
  });
  const ctx = await browser.newContext({ viewport: { width: 920, height: 700 } });
  await ctx.route(/firebase-app-compat\.js/, x => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await ctx.route(/(auth|firestore)-compat\.js/, x => x.fulfill({ contentType: 'text/javascript', body: '' }));
  await ctx.addInitScript(bridge);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(html));
  await p.waitForFunction(() => window.INST_MANIFEST && document.querySelector('#library-section:not(.hidden)'), null, { timeout: 20000 });
  await p.keyboard.press('Escape');

  const CDN = await p.evaluate(() => CINEPRO_CONFIG.CDN_BASE.replace(/\/+$/, ''));

  // 1) "glitch" mistura vídeo e áudio: ▶ só nas linhas de áudio.
  await p.fill('#lib-search', 'glitch'); await p.waitForTimeout(500);
  const mix = await p.evaluate(() => {
    const kindOf = {}; INST_MANIFEST.files.forEach(f => { kindOf[f.name] = f.kind; });
    return [...document.querySelectorAll('#lib-grid .lib-row')].map(r => ({
      kind: kindOf[r.querySelector('.inst-card-name').textContent], play: !!r.querySelector('.lib-play'),
    }));
  });
  ok(mix.some(r => r.kind === 'audio') && mix.some(r => r.kind === 'video'), `"glitch" traz áudio e vídeo (${mix.length} linhas)`);
  ok(mix.every(r => r.play === (r.kind === 'audio')), '▶ só nas linhas de áudio (vídeo/imagem sem ▶)');

  // 2) "whoosh": ▶ na 1ª linha toca a URL da CDN.
  await p.fill('#lib-search', 'whoosh'); await p.waitForTimeout(500);
  const urls = await p.evaluate(() => {
    const byName = {}; INST_MANIFEST.files.forEach(f => { if (f.kind === 'audio') byName[f.name] = f; });
    return [...document.querySelectorAll('#lib-grid .lib-row')].slice(0, 2).map(r => {
      const f = byName[r.querySelector('.inst-card-name').textContent]; return instAssetUrls(f)[0];
    });
  });
  const plays = await p.$$('#lib-grid .lib-play');
  ok(plays.length >= 2, `"whoosh" tem ▶ em ${plays.length} linhas`);
  await plays[0].click();
  let s = await waitPlaying(p);
  ok(s.audios.length === 1 && !s.audios[0].paused && s.audios[0].t > 0, `▶ na 1ª: tocando (t=${s.audios[0] && s.audios[0].t.toFixed(2)}s, erro=${s.audios[0] && s.audios[0].err})`);
  ok(s.audios[0].src === urls[0] && urls[0].startsWith(CDN + '/'), 'src = URL da CDN da 1ª linha: ' + s.audios[0].src);
  ok(JSON.stringify(s.playing) === '[0]', '1ª linha marcada como tocando: ' + JSON.stringify(s.playing));
  await p.screenshot({ path: path.join(out, '01-tocando-1a.png') });

  // 3) ▶ na 2ª: para a 1ª, um só <audio>, só ele tocando.
  await plays[1].click();
  s = await waitPlaying(p);
  ok(s.audios.length === 1, `um só <audio> na página (${s.audios.length})`);
  ok(!s.audios[0].paused && s.audios[0].src === urls[1], 'tocando a 2ª: ' + s.audios[0].src);
  ok(JSON.stringify(s.playing) === '[1]', 'só a 2ª marcada (1ª voltou a ▶): ' + JSON.stringify(s.playing));
  ok(await plays[0].textContent() === '▶' && await plays[1].textContent() === '■', 'botões: 1ª ▶, 2ª ■');
  await p.screenshot({ path: path.join(out, '02-tocando-2a.png') });

  // 4) Clicar de novo na 2ª para.
  await plays[1].click(); await p.waitForTimeout(200);
  s = await state(p);
  ok(s.audios[0].paused && s.audios[0].src === '' && s.playing.length === 0, 'clicar de novo para (pausado, sem src, nenhum marcado)');

  // 5) Digitar na busca para o som.
  await plays[0].click(); s = await waitPlaying(p);
  ok(!s.audios[0].paused, 'toca de novo a 1ª');
  await p.fill('#lib-search', 'whoosh l'); await p.waitForTimeout(500);
  s = await state(p);
  ok(s.audios[0].paused && s.audios[0].src === '', 'digitar na busca para o som');

  // A fonte Inter (@import do Google Fonts em css/app.css) já viola a CSP em
  // main: é o BL-0039, fora deste item. Qualquer outra violação falha.
  const csp = (await p.evaluate(() => window.__csp)).filter(v => !v.includes('fonts.googleapis.com'));
  ok(csp.length === 0, 'nenhuma violação de CSP além da fonte Inter (BL-0039) ' + JSON.stringify(csp));
  ok(errs.length === 0, 'sem pageerror ' + JSON.stringify(errs));

  await browser.close();
  console.log(fail ? `${fail} falha(s)` : 'tudo ok');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(2); });
