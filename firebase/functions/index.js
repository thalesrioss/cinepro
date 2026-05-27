// =============================================================
//  CinePRO — Cloud Functions
//  • tictoWebhook  — recebe Ticto v2 e atualiza Firestore + Sheets
//  • leadCapture   — LP chama após signup, registra no Sheets "Leads"
//  • checkStatus   — debug HTTP de status de assinatura por email
//
//  ⚙ Deploy automático via GitHub Actions ao push em main.
// =============================================================

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { google } = require('googleapis');

admin.initializeApp();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

// Secrets ─────────────────────────────────────────────────────
const TICTO_TOKEN    = defineSecret('TICTO_TOKEN');
const SHEET_ID       = defineSecret('GOOGLE_SHEET_ID');     // ID da planilha (opcional)
const RESEND_KEY     = defineSecret('RESEND_API_KEY');      // Resend.com pra emails (opcional)
const ALL_SECRETS    = [TICTO_TOKEN, SHEET_ID, RESEND_KEY];

// ─── Eventos Ticto v2 ─────────────────────────────────────────
const ACTIVATE_STATUS = [
  'authorized', 'all_charges_paid', 'trial_started', 'uncanceled', 'extended',
];
const DEACTIVATE_STATUS = [
  'refunded', 'chargeback', 'subscription_canceled', 'trial_ended',
  'refused', 'claimed', 'close',
];

// ═════════════════════════════════════════════════════════════
//   GOOGLE SHEETS HELPER
// ═════════════════════════════════════════════════════════════

let sheetsClient = null;
async function getSheets() {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

async function appendRow(tabName, row) {
  const sheetId = (SHEET_ID.value() || '').trim();  // blinda contra \n no secret
  if (!sheetId) {
    console.log('GOOGLE_SHEET_ID nao configurado - skip Sheets append');
    return;
  }
  try {
    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tabName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
    console.log('Sheets OK (' + tabName + '): ' + row.slice(0, 2).join(' | '));
  } catch (err) {
    console.error('Sheets append falhou (' + tabName + '):', err.message);
  }
}

function isoNow() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ═════════════════════════════════════════════════════════════
//   1. LEAD CAPTURE (HTTP POST — chamado pela LP após signup)
// ═════════════════════════════════════════════════════════════

exports.leadCapture = onRequest(
  { secrets: ALL_SECRETS, cors: true },
  async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST')    return res.status(405).send('method not allowed');

    const data  = req.body || {};
    const email = (data.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'missing email' });

    const lead = {
      email,
      os:           data.os           || '',
      ua:           data.ua           || '',
      referrer:     data.referrer     || '',
      utm_source:   data.utm_source   || '',
      utm_medium:   data.utm_medium   || '',
      utm_campaign: data.utm_campaign || '',
      utm_term:     data.utm_term     || '',
      utm_content:  data.utm_content  || '',
      country:      req.headers['x-appengine-country']
                 || req.headers['cf-ipcountry']
                 || '',
      ip:           (req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
    };

    try {
      // 1. Firestore — coleção leads/{email}
      await admin.firestore().collection('leads').doc(email).set({
        ...lead,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // 2. Sheets — aba "Leads"
      await appendRow('Leads', [
        isoNow(),
        email,
        lead.os,
        lead.country,
        lead.utm_source,
        lead.utm_medium,
        lead.utm_campaign,
        lead.referrer,
        lead.ua,
      ]);

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('leadCapture erro:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ═════════════════════════════════════════════════════════════
//   2. TICTO WEBHOOK
// ═════════════════════════════════════════════════════════════

exports.tictoWebhook = onRequest(
  { secrets: ALL_SECRETS, invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('method not allowed');

    const data = req.body || {};

    // 1. Validacao em camadas. A Ticto pode mandar token em varios lugares OU nao mandar.
    // Log temporario pra debug
    console.log('TICTO REQ headers:', JSON.stringify(req.headers));
    console.log('TICTO REQ query:',   JSON.stringify(req.query));
    console.log('TICTO REQ body keys:', Object.keys(data));

    const expectedToken = (TICTO_TOKEN.value() || '').trim();
    const receivedToken = (
      data.token
      || req.headers['x-ticto-token']
      || req.headers['x-token']
      || req.headers['x-postback-token']
      || req.headers['x-postback-secret']
      || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
      || req.query.token
      || ''
    ).trim();

    const tokenValid = receivedToken && receivedToken === expectedToken;

    // Fallback: se nao tem token, valida pela "forma" do payload (Ticto v2)
    // Real Ticto v2 webhook tem: version="2.0", commission_type, customer.email, order
    const looksLikeTictoV2 =
      data.version === '2.0' &&
      typeof data.commission_type === 'string' &&
      typeof data.status === 'string' &&
      data.customer && typeof data.customer.email === 'string' &&
      data.order && (data.order.id || data.order.hash);

    if (!tokenValid && !looksLikeTictoV2) {
      console.warn('Webhook rejeitado: token invalido E payload nao parece Ticto v2');
      return res.status(401).json({ error: 'invalid token' });
    }

    if (!tokenValid && looksLikeTictoV2) {
      console.warn('FALLBACK ATIVADO: token ausente mas payload Ticto v2 valido. Email=' + (data.customer.email || ''));
    }

    // 2. Campos
    const status = (data.status || '').toLowerCase().trim();
    const email  = (data.customer?.email || '').toLowerCase().trim();
    const name   = data.customer?.name || '';
    const amount = data.order?.paid_amount || 0;
    const orderId = data.order?.id || data.order?.hash || '';

    if (!email) {
      console.warn('Webhook sem email');
      return res.status(400).json({ error: 'missing email' });
    }

    // 3. Mapeia ativação
    let active = null;
    if (ACTIVATE_STATUS.includes(status))   active = true;
    if (DEACTIVATE_STATUS.includes(status)) active = false;

    // Sempre escreve no Sheets (mesmo se status é "ignorado")
    await appendRow('Events', [
      isoNow(),
      email,
      name,
      status,
      active === null ? 'ignored' : (active ? 'ACTIVATE' : 'DEACTIVATE'),
      orderId,
      amount,
      data.payment_method || '',
      data.status_date || '',
    ]);

    if (active === null) {
      return res.status(200).json({ ignored: status });
    }

    try {
      // 4. Cria/encontra Firebase Auth user
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

      // 5. Firestore users/{uid}
      await admin.firestore().collection('users').doc(user.uid).set({
        email,
        name,
        subscriptionActive: active,
        lastStatus:  status,
        lastEventAt: data.status_date || null,
        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      if (isNewUser && active) {
        const link = await admin.auth().generatePasswordResetLink(email);
        console.log(`[NOVO USUARIO] ${email} - link senha: ${link}`);
        // Manda email de boas-vindas com o link de senha (best-effort)
        await sendWelcomeEmail(email, name, link).catch(function (e) {
          console.error('Falha ao enviar welcome email:', e.message);
        });
      }

      console.log(`${email}: ${status} -> active=${active}`);
      return res.status(200).json({ ok: true, email, active, status });

    } catch (err) {
      console.error('tictoWebhook erro:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ═════════════════════════════════════════════════════════════
//   3. CHECK STATUS (debug)
// ═════════════════════════════════════════════════════════════

exports.checkStatus = onRequest({ invoker: 'public' }, async (req, res) => {
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

// ═════════════════════════════════════════════════════════════
//   WELCOME EMAIL (Resend)
// ═════════════════════════════════════════════════════════════

async function sendWelcomeEmail(email, name, passwordResetLink) {
  const key = (RESEND_KEY.value() || '').trim();
  if (!key) {
    console.log('RESEND_API_KEY nao configurado - skip welcome email');
    return;
  }

  const firstName = (name || email.split('@')[0]).split(' ')[0];
  const html = welcomeEmailHTML({
    firstName: firstName,
    email: email,
    resetLink: passwordResetLink,
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'CinePRO <onboarding@resend.dev>',
      to: [email],
      subject: 'Bem-vindo ao CinePRO — defina sua senha',
      html: html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('Resend HTTP ' + res.status + ': ' + text);
  }
  const data = await res.json();
  console.log('Welcome email enviado:', email, 'id=' + (data.id || '?'));
}

function welcomeEmailHTML(opts) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#07090F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#E5E9F0;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07090F;padding:40px 20px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#0E1218;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;">

      <tr><td style="padding:32px 32px 0;">
        <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#FFFFFF;">
          Cine<span style="color:#00B8FF;">PRO</span>
        </div>
      </td></tr>

      <tr><td style="padding:24px 32px 8px;">
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;letter-spacing:-0.5px;color:#FFFFFF;line-height:1.2;">
          Bem-vindo, ${opts.firstName}!
        </h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#8A95A8;">
          Sua assinatura do CinePRO foi ativada. Pra acessar o aplicativo e o plugin no Premiere,
          defina sua senha clicando no botão abaixo.
        </p>
      </td></tr>

      <tr><td style="padding:8px 32px 24px;" align="center">
        <a href="${opts.resetLink}"
           style="display:inline-block;background:linear-gradient(135deg,#00B8FF 0%,#0066CC 100%);color:#000000;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;letter-spacing:0.3px;">
          Definir minha senha
        </a>
      </td></tr>

      <tr><td style="padding:0 32px 24px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#4A5566;">
          O link expira em 1 hora. Se precisar, você pode pedir um novo no app
          em "Esqueci minha senha".
        </p>
      </td></tr>

      <tr><td style="padding:0 32px 24px;border-top:1px solid rgba(255,255,255,0.06);">
        <h3 style="margin:24px 0 12px;font-size:14px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:1px;">
          Próximos passos
        </h3>
        <ol style="margin:0;padding-left:18px;font-size:14px;line-height:1.8;color:#8A95A8;">
          <li>Defina sua senha pelo link acima</li>
          <li>Abra o app <strong style="color:#FFFFFF;">CinePRO</strong> no seu computador</li>
          <li>Faça login com <strong style="color:#FFFFFF;">${opts.email}</strong></li>
          <li>Abra o Premiere → Janela → Extensões → CinePRO</li>
        </ol>
      </td></tr>

      <tr><td style="padding:24px 32px;background:#161B23;border-top:1px solid rgba(255,255,255,0.06);">
        <p style="margin:0;font-size:12px;color:#4A5566;">
          Não consegue clicar no botão? Copie e cole o link no navegador:<br>
          <a href="${opts.resetLink}" style="color:#00B8FF;word-break:break-all;font-size:11px;">${opts.resetLink}</a>
        </p>
      </td></tr>

    </table>

    <p style="margin:24px 0 0;font-size:11px;color:#4A5566;">
      CinePRO · <a href="mailto:suporte@cinepro.com" style="color:#8A95A8;">suporte@cinepro.com</a>
    </p>

  </td></tr>
</table>
</body></html>`;
}
