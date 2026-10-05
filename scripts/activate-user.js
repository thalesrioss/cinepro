const admin = require('firebase-admin');

const EMAIL_TO_ACTIVATE = 'jotta.vps@gmail.com';

if (!process.env.FIREBASE_PROJECT_ID) {
  console.error('FIREBASE_PROJECT_ID não definido.');
  console.error('Exemplo: export FIREBASE_PROJECT_ID=seu-projeto');
  process.exit(1);
}

admin.initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID,
  credential: process.env.FIREBASE_SERVICE_ACCOUNT
    ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    : undefined,
});

const db = admin.firestore();

async function ensureUserActivation(email) {
  const normalized = String(email || '').trim().toLowerCase();

  if (!normalized) {
    throw new Error('Email vazio');
  }

  let uid = null;
  try {
    const user = await admin.auth().getUserByEmail(normalized);
    uid = user.uid;
    console.log(`Usuário encontrado no Firebase Auth: ${uid}`);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      throw error;
    }
    console.log(`Usuário ${normalized} não existe no Firebase Auth ainda. Mesmo assim, vamos criar o documento no Firestore.`);
  }

  const docId = uid || normalized;
  const payload = {
    email: normalized,
    subscriptionActive: true,
    admin: false,
    lastEventAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'manual_activation',
  };

  await db.collection('users').doc(docId).set(payload, { merge: true });

  console.log(`✅ Usuário ativo registrado: ${normalized}`);
  console.log(`Firestore doc: users/${docId}`);
}

(async () => {
  try {
    await ensureUserActivation(EMAIL_TO_ACTIVATE);
    process.exit(0);
  } catch (error) {
    console.error('Erro ao ativar usuário:', error);
    process.exit(1);
  }
})();
