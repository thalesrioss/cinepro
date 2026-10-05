/**
 * CinePRO — Ticto Webhook Handler
 * 
 * Processa eventos de pagamento/assinatura da Ticto e sincroniza com Firestore.
 * 
 * Eventos esperados:
 * - checkout.completed (pagamento confirmado)
 * - subscription.created (assinatura ativa)
 * - subscription.renewed (renovação de assinatura)
 * - subscription.canceled (cancelamento)
 * 
 * Deploy: Firebase Functions, Vercel, ou seu servidor Node.js
 * Endpoint: https://seu-domain.com/api/webhooks/ticto
 */

const admin = require('firebase-admin');
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// ─── Inicializar Firebase (se não estiver já inicializado) ───
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ─── Config ───
const TICTO_WEBHOOK_SECRET = process.env.TICTO_WEBHOOK_SECRET || 'seu-secret-key-aqui';
const ALLOWED_PRODUCT_IDS = process.env.ALLOWED_PRODUCT_IDS?.split(',') || [];

/**
 * Valida a assinatura HMAC do webhook (segurança)
 * A Ticto envia um header com a assinatura para confirmar autenticidade
 */
function verifyTictoSignature(body, signature) {
  const computed = crypto
    .createHmac('sha256', TICTO_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  return computed === signature;
}

/**
 * Extrai email e informações de identidade do usuário
 * 
 * Estrutura típica de payload da Ticto:
 * {
 *   event: "checkout.completed" | "subscription.created" | etc.
 *   data: {
 *     customer: { email, name, cpf/cnpj },
 *     subscription/order: { id, status, product_id, ... }
 *   }
 * }
 */
function extractUserInfo(payload) {
  const { event, data } = payload;
  
  if (!data) {
    console.warn('[Ticto] Payload sem data:', payload);
    return null;
  }

  // Email pode vir em customer ou diretamente
  let email = (data.customer?.email || data.email || '').toLowerCase().trim();
  
  if (!email) {
    console.warn('[Ticto] Email não encontrado no payload:', data);
    return null;
  }

  return {
    email,
    name: data.customer?.name || data.name || '',
    customerId: data.customer?.id || data.customer_id || '',
    orderId: data.order_id || data.id || '',
    productId: data.product_id || '',
    subscriptionId: data.subscription_id || data.id || '',
    status: data.status || '',
    paidAt: data.paid_at || data.created_at || new Date().toISOString(),
  };
}

/**
 * Determina se o evento representa uma assinatura ATIVA
 */
function isActiveSubscription(event, status) {
  const activeStatuses = ['active', 'paid', 'completed', 'confirmed'];
  const activeEvents = ['checkout.completed', 'subscription.created', 'subscription.renewed'];
  
  return activeEvents.includes(event) && activeStatuses.includes(status);
}

/**
 * Sincroniza usuário no Firestore
 * Cria ou atualiza o documento em users/{uid} com a informação de assinatura
 */
async function syncUserToFirestore(userInfo, isActive) {
  try {
    // 1. Procura o usuário no Firebase Auth pelo email
    let uid;
    try {
      const userRecord = await admin.auth().getUserByEmail(userInfo.email);
      uid = userRecord.uid;
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.warn(`[Ticto] Usuário ${userInfo.email} não encontrado no Firebase Auth.`);
        console.warn('[Ticto] Sugestão: Usuário ainda não fez login. Será criado ao primeiro acesso.');
        // Criar documento mesmo assim, pré-preenchendo para quando ele fizer login
        uid = userInfo.email; // usar email como fallback de ID
      } else {
        throw err;
      }
    }

    // 2. Prepara dados a serem gravados
    const userData = {
      email: userInfo.email,
      name: userInfo.name || '',
      subscriptionActive: isActive,
      admin: false,
      lastEventAt: new Date().toISOString(),
      lastEventType: isActive ? 'subscription_activated' : 'subscription_deactivated',
      purchasedAt: isActive ? userInfo.paidAt : null,
      customerId: userInfo.customerId || '',
      subscriptionId: userInfo.subscriptionId || '',
      orderId: userInfo.orderId || '',
      // Não sobrescreve campos que o admin possa ter alterado manualmente
      // (usa merge: true)
    };

    // 3. Grava no Firestore (merge = não deleta campos existentes)
    await db.collection('users').doc(uid).set(userData, { merge: true });

    console.log(`[Ticto] ✓ Usuário sincronizado: ${userInfo.email} (subscriptionActive: ${isActive})`);
    return { success: true, uid };
  } catch (err) {
    console.error('[Ticto] Erro ao sincronizar usuário:', err);
    throw err;
  }
}

/**
 * Handler principal do webhook
 * 
 * Chamado pela Ticto quando evento ocorre
 */
router.post('/ticto', async (req, res) => {
  try {
    console.log('[Ticto] Webhook recebido:', req.body.event);

    // ─── 1. Validar assinatura (segurança) ───
    const signature = req.headers['x-ticto-signature'] || req.headers['x-signature'];
    const rawBody = JSON.stringify(req.body);
    
    if (TICTO_WEBHOOK_SECRET && signature && !verifyTictoSignature(rawBody, signature)) {
      console.warn('[Ticto] Assinatura inválida! Possível intrusão.');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // ─── 2. Extrair dados do evento ───
    const payload = req.body;
    const userInfo = extractUserInfo(payload);
    
    if (!userInfo) {
      console.warn('[Ticto] Não consegui extrair email do payload');
      return res.status(400).json({ error: 'Missing email in payload' });
    }

    // ─── 3. Determinar se a assinatura está ativa ───
    const isActive = isActiveSubscription(payload.event, userInfo.status);

    // ─── 4. Sincronizar com Firestore ───
    const syncResult = await syncUserToFirestore(userInfo, isActive);

    // ─── 5. Responder sucesso ───
    res.json({
      success: true,
      message: `Usuário ${userInfo.email} sincronizado com sucesso`,
      subscriptionActive: isActive,
      uid: syncResult.uid,
    });

  } catch (err) {
    console.error('[Ticto] Erro no webhook:', err);
    res.status(500).json({
      error: err.message || 'Internal server error',
      event: req.body?.event || 'unknown',
    });
  }
});

/**
 * Endpoint de teste/diagnóstico (POST manualmente para testar)
 */
router.post('/ticto/test', async (req, res) => {
  try {
    const { email, status = 'active' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const testPayload = {
      event: 'checkout.completed',
      data: {
        customer: { email },
        status,
        created_at: new Date().toISOString(),
      },
    };

    // Simula o webhook
    const userInfo = extractUserInfo(testPayload);
    const isActive = isActiveSubscription(testPayload.event, status);
    const syncResult = await syncUserToFirestore(userInfo, isActive);

    res.json({
      success: true,
      message: `Usuário de teste ${email} sincronizado`,
      subscriptionActive: isActive,
      uid: syncResult.uid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint de status (GET para verificar se o webhook está ativo)
 */
router.get('/ticto/status', (req, res) => {
  res.json({
    status: 'active',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

module.exports = router;
