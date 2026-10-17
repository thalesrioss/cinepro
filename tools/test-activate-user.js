#!/usr/bin/env node
// =============================================================
//  scripts/activate-user.js — asserções
//
//  O risco aqui é ativar no lugar errado: gravar um documento que
//  o app nunca lê (users/<email>) e o assinante seguir bloqueado.
//  Auth e Firestore são falsos, em memória; nada sai da máquina.
//
//  Uso:  node tools/test-activate-user.js
// =============================================================

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'activate-user.js');
const A = require(SCRIPT);

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
function group(s) { queue.push([null, s]); }

function fakeAuth(existing) {
  const users = Object.assign({}, existing);
  const created = [];
  return {
    created,
    async getUserByEmail(email) {
      if (users[email]) return { uid: users[email], email };
      const e = new Error('not found'); e.code = 'auth/user-not-found'; throw e;
    },
    async createUser(u) {
      const uid = 'uid-new-' + (created.length + 1);
      users[u.email] = uid; created.push(u);
      return { uid, email: u.email };
    },
  };
}
function fakeDb(initial) {
  const docs = Object.assign({}, initial);
  return {
    docs,
    collection(c) {
      return { doc(id) { return { async set(data, opt) {
        const key = c + '/' + id;
        docs[key] = opt && opt.merge ? Object.assign({}, docs[key], data) : data;
      } }; } };
    },
  };
}
function run(args, env) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT].concat(args), {
      env: Object.assign({}, process.env, { FIREBASE_PROJECT_ID: '' }, env), stdio: 'pipe',
    });
    return { code: 0, out: out.toString() };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) + String(e.stderr) };
  }
}

group('LINHA DE COMANDO');
t('sem argumento sai ≠0 com uso', () => {
  const r = run([]);
  return (r.code !== 0 && r.out.includes(A.USAGE)) || JSON.stringify(r);
});
t('e-mail inválido sai ≠0 com uso', () => {
  const r = run(['nao-e-email']);
  return (r.code !== 0 && r.out.includes(A.USAGE)) || JSON.stringify(r);
});
t('e-mail válido sem FIREBASE_PROJECT_ID sai ≠0 antes de tocar no Firebase', () => {
  const r = run(['a@b.com']);
  return (r.code !== 0 && r.out.includes('FIREBASE_PROJECT_ID')) || JSON.stringify(r);
});
t('nenhum e-mail de cliente no código de scripts/', () => {
  const src = require('fs').readFileSync(SCRIPT, 'utf8');
  return !/@(gmail|hotmail|outlook)/.test(src) || 'achou e-mail';
});

group('NORMALIZAÇÃO');
t('minúsculas e sem espaço', () => A.normalizeEmail('  Fulano@Exemplo.COM ') === 'fulano@exemplo.com' || 'errou');
t('vazio é inválido', () => A.normalizeEmail('') === null || 'errou');
t('sem domínio é inválido', () => A.normalizeEmail('fulano@') === null || 'errou');

group('ATIVAÇÃO');
t('usuário existente: grava users/<uid>, não cria', async () => {
  const auth = fakeAuth({ 'a@b.com': 'uid-a' }), db = fakeDb();
  const r = await A.activateUser({ auth, db, email: 'A@b.com' });
  const d = db.docs['users/uid-a'];
  return (r.uid === 'uid-a' && !r.created && auth.created.length === 0 && d && d.subscriptionActive === true
    && Object.keys(db.docs).length === 1) || JSON.stringify(db.docs);
});
t('usuário inexistente: cria no Auth e grava users/<uid novo>', async () => {
  const auth = fakeAuth({}), db = fakeDb();
  const r = await A.activateUser({ auth, db, email: 'novo@exemplo.com' });
  return (r.created && r.uid === 'uid-new-1' && auth.created[0].email === 'novo@exemplo.com'
    && auth.created[0].emailVerified === false && db.docs['users/uid-new-1'].subscriptionActive === true
    && !db.docs['users/novo@exemplo.com']) || JSON.stringify({ r, docs: db.docs });
});
t('senha gerada é forte e diferente a cada criação', async () => {
  const auth = fakeAuth({});
  await A.activateUser({ auth, db: fakeDb(), email: 'x@y.com' });
  await A.activateUser({ auth, db: fakeDb(), email: 'z@y.com' });
  const [p1, p2] = auth.created.map((u) => u.password);
  return (p1.length >= 24 && p1 !== p2) || 'senha fraca ou repetida';
});
t('não rebaixa admin nem apaga campos do webhook (merge)', async () => {
  const db = fakeDb({ 'users/uid-a': { admin: true, name: 'Fulano', subscriptionActive: false } });
  await A.activateUser({ auth: fakeAuth({ 'a@b.com': 'uid-a' }), db, email: 'a@b.com' });
  const d = db.docs['users/uid-a'];
  return (d.admin === true && d.name === 'Fulano' && d.subscriptionActive === true) || JSON.stringify(d);
});
t('erro do Auth que não é user-not-found propaga e não grava', async () => {
  const auth = { async getUserByEmail() { const e = new Error('quota'); e.code = 'auth/internal-error'; throw e; } };
  const db = fakeDb();
  try { await A.activateUser({ auth, db, email: 'a@b.com' }); return 'não lançou'; }
  catch (e) { return (e.message === 'quota' && Object.keys(db.docs).length === 0) || e.message; }
});
t('e-mail inválido lança sem chamar o Auth', async () => {
  const auth = { async getUserByEmail() { throw new Error('chamou'); } };
  try { await A.activateUser({ auth, db: fakeDb(), email: 'x' }); return 'não lançou'; }
  catch (e) { return e.message.startsWith('E-mail inválido') || e.message; }
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
  console.log(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
})();
