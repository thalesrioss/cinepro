#!/usr/bin/env node
// =============================================================
//  firebase/functions/index.js — tictoWebhook — asserções (BL-0074)
//
//  O risco aqui é a URL pública aceitar pedido sem o token da Ticto
//  e ativar ou cancelar assinatura de qualquer e-mail (ADR-0008).
//  firebase-functions, firebase-admin, googleapis e fetch são falsos,
//  em memória; nada sai da máquina.
//
//  Uso:  node tools/test-ticto-webhook.js
//        TICTO_INDEX=/outro/index.js node tools/test-ticto-webhook.js
// =============================================================

'use strict';

const path = require('path');
const Module = require('module');
const INDEX = process.env.TICTO_INDEX
  || path.join(__dirname, '..', 'firebase', 'functions', 'index.js');

const SECRET = 'tok-certo-0123456789';

// ─── módulos falsos ──────────────────────────────────────────
const env = { TICTO_TOKEN: SECRET, GOOGLE_SHEET_ID: '', RESEND_API_KEY: '' };
const calls = { auth: [], db: [], fetch: [], sheets: [] };
const users = { 'pagante@exemplo.com': 'uid-pagante' };

const fakeAdmin = {
  initializeApp() {},
  auth() {
    return {
      async getUserByEmail(email) {
        calls.auth.push(['getUserByEmail', email]);
        if (users[email]) return { uid: users[email], email };
        throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      },
      async createUser(u) {
        calls.auth.push(['createUser', u.email]);
        users[u.email] = 'uid-' + u.email;
        return { uid: users[u.email], email: u.email };
      },
      async generatePasswordResetLink(email) { calls.auth.push(['resetLink', email]); return 'https://x'; },
    };
  },
  firestore: Object.assign(function () {
    return { collection(c) { return { doc(id) { return {
      async set(data, opt) { calls.db.push([c + '/' + id, data, opt]); },
      async get() { return { exists: false }; },
    }; } }; } };
  }, { FieldValue: { serverTimestamp: () => 'TS' } }),
};
const fakes = {
  'firebase-functions/v2/https': { onRequest: (opts, fn) => (typeof opts === 'function' ? opts : fn) },
  'firebase-functions/params': { defineSecret: (name) => ({ value: () => env[name] }) },
  'firebase-functions/v2': { setGlobalOptions() {} },
  'firebase-admin': fakeAdmin,
  'googleapis': { google: {
    auth: { GoogleAuth: function () {} },
    sheets: () => ({ spreadsheets: { values: { async append(a) { calls.sheets.push(a); } } } }),
  } },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(fakes, request)) return fakes[request];
  return origLoad.call(this, request, parent, isMain);
};
global.fetch = async (url) => {
  calls.fetch.push(url);
  return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
};

// Captura todo console.* para conferir que o token não vaza em log.
const logs = [];
for (const k of ['log', 'warn', 'error', 'info']) {
  console[k] = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
}
const out = (s) => process.stdout.write(s + '\n');

const F = require(INDEX);

// ─── helpers ─────────────────────────────────────────────────
function tictoV2(email, status) {
  return {
    version: '2.0', commission_type: 'producer', status: status || 'authorized',
    status_date: '2026-10-19 10:00:00', payment_method: 'pix',
    customer: { email: email || 'pagante@exemplo.com', name: 'Fulano' },
    order: { id: 'ord-1', hash: 'h1', paid_amount: 4990 },
  };
}
async function call({ body, headers, query, method }) {
  const req = { method: method || 'POST', body: body || {}, headers: headers || {}, query: query || {} };
  const res = {
    code: 200, payload: undefined,
    status(c) { this.code = c; return this; },
    json(p) { this.payload = p; return this; },
    send(p) { this.payload = p; return this; },
  };
  await F.tictoWebhook(req, res);
  return res;
}
function reset() { calls.auth = []; calls.db = []; calls.fetch = []; calls.sheets = []; }
function untouched() { return calls.auth.length === 0 && calls.db.length === 0 && calls.fetch.length === 0; }
function effect(r) {
  const d = calls.db.find((c) => c[0] === 'users/uid-pagante');
  return r.code === 200 && r.payload && r.payload.active === true && d && d[1].subscriptionActive === true
    && d[1].lastStatus === 'authorized';
}

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
function group(s) { queue.push([null, s]); }

group('SEM TOKEN VÁLIDO → 401, NADA ESCRITO');
t('sem token + payload Ticto v2 completo → 401 e 0 chamadas ao Auth/Firestore', async () => {
  const r = await call({ body: tictoV2() });
  return (r.code === 401 && untouched()) || JSON.stringify({ code: r.code, calls });
});
t('cancelamento sem token não cancela pagante', async () => {
  const r = await call({ body: tictoV2('pagante@exemplo.com', 'subscription_canceled') });
  return (r.code === 401 && untouched()) || JSON.stringify({ code: r.code, calls });
});
t('token errado no corpo → 401', async () => {
  const r = await call({ body: Object.assign(tictoV2(), { token: 'errado' }) });
  return (r.code === 401 && untouched()) || r.code;
});
t('token errado no header → 401', async () => {
  const r = await call({ body: tictoV2(), headers: { 'x-ticto-token': SECRET + 'x' } });
  return (r.code === 401 && untouched()) || r.code;
});
t('prefixo do token (tamanho diferente) → 401', async () => {
  const r = await call({ body: tictoV2(), query: { token: SECRET.slice(0, 5) } });
  return (r.code === 401 && untouched()) || r.code;
});
t('token que não é string (array/objeto) → 401', async () => {
  const r1 = await call({ body: Object.assign(tictoV2(), { token: [SECRET] }) });
  const r2 = await call({ body: tictoV2(), query: { token: { a: SECRET } } });
  return (r1.code === 401 && r2.code === 401 && untouched()) || [r1.code, r2.code].join(',');
});
t('segredo vazio no ambiente + token vazio → 401', async () => {
  const keep = env.TICTO_TOKEN; env.TICTO_TOKEN = '';
  try {
    const r1 = await call({ body: Object.assign(tictoV2(), { token: '' }) });
    const r2 = await call({ body: tictoV2(), headers: { authorization: 'Bearer ' } });
    return (r1.code === 401 && r2.code === 401 && untouched()) || [r1.code, r2.code].join(',');
  } finally { env.TICTO_TOKEN = keep; }
});
t('segredo só com espaços/quebra de linha não aceita token vazio', async () => {
  const keep = env.TICTO_TOKEN; env.TICTO_TOKEN = ' \n';
  try {
    const r = await call({ body: Object.assign(tictoV2(), { token: ' ' }) });
    return (r.code === 401 && untouched()) || r.code;
  } finally { env.TICTO_TOKEN = keep; }
});

group('TOKEN CERTO → MESMO EFEITO DE HOJE');
t('token certo no corpo → 200 e ativa users/<uid>', async () => {
  const r = await call({ body: Object.assign(tictoV2(), { token: SECRET }) });
  return effect(r) || JSON.stringify({ code: r.code, p: r.payload, db: calls.db });
});
for (const h of ['x-ticto-token', 'x-token', 'x-postback-token', 'x-postback-secret']) {
  t('token certo no header ' + h + ' → 200', async () => {
    const r = await call({ body: tictoV2(), headers: { [h]: SECRET } });
    return effect(r) || r.code;
  });
}
t('token certo em Authorization: Bearer → 200', async () => {
  const r = await call({ body: tictoV2(), headers: { authorization: 'Bearer ' + SECRET } });
  return effect(r) || r.code;
});
t('token certo em ?token= → 200', async () => {
  const r = await call({ body: tictoV2(), query: { token: SECRET } });
  return effect(r) || r.code;
});
t('segredo com \\n no fim (secret colado) ainda aceita o token certo', async () => {
  const keep = env.TICTO_TOKEN; env.TICTO_TOKEN = SECRET + '\n';
  try { return effect(await call({ body: tictoV2(), query: { token: SECRET } })) || 'recusou'; }
  finally { env.TICTO_TOKEN = keep; }
});
t('cancelamento com token certo desativa', async () => {
  const r = await call({ body: Object.assign(tictoV2('pagante@exemplo.com', 'subscription_canceled'), { token: SECRET }) });
  const d = calls.db.find((c) => c[0] === 'users/uid-pagante');
  return (r.code === 200 && d && d[1].subscriptionActive === false) || r.code;
});
t('compra nova com token certo cria usuário e dispara e-mail de senha', async () => {
  const r = await call({ body: tictoV2('novo@exemplo.com'), query: { token: SECRET } });
  return (r.code === 200 && calls.auth.some((c) => c[0] === 'createUser') && calls.fetch.length === 1)
    || JSON.stringify({ code: r.code, calls });
});
t('status desconhecido com token certo → 200 ignored, sem escrever no Auth', async () => {
  const r = await call({ body: tictoV2('pagante@exemplo.com', 'waiting_payment'), query: { token: SECRET } });
  return (r.code === 200 && r.payload.ignored === 'waiting_payment' && untouched()) || JSON.stringify(r.payload);
});
t('GET continua 405', async () => (await call({ method: 'GET' })).code === 405 || 'não 405');

group('LOGS');
t('nenhum log com o token', () => {
  const leak = logs.filter((l) => l.includes(SECRET) || l.includes(SECRET.slice(0, 5)));
  return leak.length === 0 || leak[0].slice(0, 200);
});
t('rejeição não loga e-mail nem headers', () => {
  const rej = logs.filter((l) => /rejeitado/i.test(l));
  return (rej.length > 0 && rej.every((l) => !l.includes('@') && !/x-ticto|authorization/i.test(l)))
    || JSON.stringify(rej.slice(0, 3));
});
t('nenhum "FALLBACK ATIVADO" no código', () => {
  const src = require('fs').readFileSync(INDEX, 'utf8');
  return (!/FALLBACK ATIVADO|looksLikeTictoV2/.test(src) && src.includes('timingSafeEqual')) || 'achou fallback';
});

(async () => {
  for (const [name, fn] of queue) {
    if (name === null) { out('\n══ ' + fn + ' ══'); continue; }
    reset();
    try {
      const r = await fn();
      if (r === true) { pass++; out('  ✓ ' + name); }
      else { fail++; out('  ✗ ' + name + '  → ' + r); }
    } catch (e) { fail++; out('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
  }
  out(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
})();
