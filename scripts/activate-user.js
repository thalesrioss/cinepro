#!/usr/bin/env node
// =============================================================
//  Ativação manual de assinante
//
//  Uso:  node scripts/activate-user.js <email>
//  Env:  FIREBASE_PROJECT_ID (obrigatório), FIREBASE_SERVICE_ACCOUNT (JSON, opcional)
//
//  O app e o plugin leem users/{uid}. Se o e-mail ainda não existe
//  no Firebase Auth, o usuário é criado como o tictoWebhook faz
//  (firebase/functions/index.js) e a pessoa define a senha pelo
//  "esqueci a senha" do app. Assim o documento é sempre users/{uid}.
//  O campo admin não é tocado (ativar um admin não o rebaixa).
// =============================================================

'use strict';

const crypto = require('crypto');

const USAGE = 'Uso: node scripts/activate-user.js <email>';

function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

async function findOrCreateUser(auth, email) {
  try {
    const user = await auth.getUserByEmail(email);
    return { user, created: false };
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  const user = await auth.createUser({
    email,
    password: crypto.randomBytes(18).toString('base64') + 'Aa1!',
    emailVerified: false,
  });
  return { user, created: true };
}

async function activateUser({ auth, db, email, now = new Date() }) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error(`E-mail inválido: "${email}"`);

  const { user, created } = await findOrCreateUser(auth, normalized);
  const iso = now.toISOString();

  await db.collection('users').doc(user.uid).set({
    email: normalized,
    subscriptionActive: true,
    lastStatus: 'manual_activation',
    lastEventAt: iso,
    updatedAt: iso,
    source: 'manual_activation',
  }, { merge: true });

  return { uid: user.uid, email: normalized, created };
}

async function main(argv) {
  const email = normalizeEmail(argv[0]);
  if (!email) {
    console.error(argv[0] ? `E-mail inválido: "${argv[0]}"` : 'Falta o e-mail.');
    console.error(USAGE);
    return 2;
  }
  if (!process.env.FIREBASE_PROJECT_ID) {
    console.error('FIREBASE_PROJECT_ID não definido.');
    console.error('Exemplo: export FIREBASE_PROJECT_ID=seu-projeto');
    return 1;
  }

  const admin = require('firebase-admin');
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
    credential: process.env.FIREBASE_SERVICE_ACCOUNT
      ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : undefined,
  });

  const r = await activateUser({ auth: admin.auth(), db: admin.firestore(), email });
  if (r.created) {
    console.log(`Usuário criado no Firebase Auth: ${r.uid}`);
    console.log('A pessoa define a senha pelo "esqueci a senha" do app.');
  } else {
    console.log(`Usuário encontrado no Firebase Auth: ${r.uid}`);
  }
  console.log(`✅ Assinatura ativa: ${r.email}`);
  console.log(`Firestore doc: users/${r.uid}`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error('Erro ao ativar usuário:', error.message || error);
      process.exit(1);
    }
  );
}

module.exports = { normalizeEmail, activateUser, main, USAGE };
