// =============================================================
//  CinePRO — Cloud Functions
//  Recebe webhook da Ticto v2 e atualiza assinatura no Firestore
// =============================================================

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

// Token único do seu produto na Ticto — pegue no painel: Webhooks → seu webhook
// Defina via: firebase functions:secrets:set TICTO_TOKEN
const TICTO_TOKEN = defineSecret('TICTO_TOKEN');

// ─── Eventos da Ticto v2 ───────────────────────────────────────
// Quando um destes chega, o usuário GANHA acesso
const ACTIVATE_STATUS = [
  'authorized',         // compra aprovada (cartão/pix/boleto)
  'all_charges_paid',   // todas as cobranças da assinatura pagas
  'trial_started',      // trial iniciado
  'uncanceled',         // assinatura reativada
  'extended',           // assinatura estendida
];

// Quando um destes chega, o usuário PERDE acesso
const DEACTIVATE_STATUS = [
  'refunded',              // reembolso
  'chargeback',            // chargeback
  'subscription_canceled', // cancelamento
  'trial_ended',           // trial expirou (sem conversão)
  'refused',               // pagamento recusado
  'claimed',               // disputa
  'close',                 // encerramento
];

exports.tictoWebhook = onRequest(
  { secrets: [TICTO_TOKEN] },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('method not allowed');

    const data = req.body || {};

    // 1. Valida o token único do produto
    if (data.token !== TICTO_TOKEN.value()) {
      console.warn('Token inválido:', data.token);
      return res.status(401).json({ error: 'invalid token' });
    }

    // 2. Lê os campos essenciais
    const status = (data.status || '').toLowerCase().trim();
    const email  = (data.customer?.email || '').toLowerCase().trim();
    const name   = data.customer?.name || '';

    if (!email) {
      console.warn('Webhook sem email:', JSON.stringify(data));
      return res.status(400).json({ error: 'missing email' });
    }

    // 3. Decide se ativa ou desativa
    let active = null;
    if (ACTIVATE_STATUS.includes(status))   active = true;
    if (DEACTIVATE_STATUS.includes(status)) active = false;

    if (active === null) {
      console.log('Status ignorado:', status, 'email:', email);
      return res.status(200).json({ ignored: status });
    }

    try {
      // 4. Busca ou cria usuário no Firebase Auth
      let user;
      let isNewUser = false;
      try {
        user = await admin.auth().getUserByEmail(email);
      } catch {
        user = await admin.auth().createUser({
          email,
          displayName: name,
          password: Math.random().toString(36).slice(2) + 'Aa1!',
          emailVerified: false,
        });
        isNewUser = true;
      }

      // 5. Atualiza Firestore
      await admin.firestore().collection('users').doc(user.uid).set({
        email,
        name,
        subscriptionActive: active,
        lastStatus: status,
        lastEventAt: data.status_date || null,
        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // 6. Se é usuário novo E ativou → envia link pra criar senha
      if (isNewUser && active) {
        const link = await admin.auth().generatePasswordResetLink(email);
        // TODO: integrar com SendGrid/Mailgun pra enviar este email
        // Por enquanto, vai pro log do Functions
        console.log(`[NOVO USUÁRIO] ${email} — definir senha em: ${link}`);
      }

      console.log(`${email}: ${status} → active=${active}`);
      return res.status(200).json({ ok: true, email, active, status });

    } catch (err) {
      console.error('Erro processando webhook:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ── Função auxiliar pra debug: verificar status de um email ──
exports.checkStatus = onRequest(async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).send('missing email');

  try {
    const user = await admin.auth().getUserByEmail(email);
    const doc  = await admin.firestore().collection('users').doc(user.uid).get();
    return res.json({
      uid: user.uid,
      email,
      data: doc.exists ? doc.data() : null,
    });
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});
