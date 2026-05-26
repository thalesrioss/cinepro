# CinePRO — Guia de Configuração

## O que você precisa configurar

O plugin usa **3 serviços externos**. Siga na ordem abaixo.

---

## 1. Google Drive API Key

1. Acesse: https://console.cloud.google.com
2. Crie um projeto (ex: "CinePRO")
3. Habilite a API: **Google Drive API**
4. Vá em **Credenciais → Criar credencial → Chave de API**
5. (Opcional) Restrinja a chave ao "Referenciador HTTP" para segurança
6. Cole a chave em `js/config.js`:
   ```js
   GOOGLE_DRIVE_API_KEY: 'SUA_CHAVE_AQUI'
   ```

> O `GOOGLE_DRIVE_FOLDER_ID` já está preenchido com a sua pasta.

---

## 2. Firebase (Auth + Banco de dados)

### 2.1 Criar projeto
1. Acesse: https://console.firebase.google.com
2. Clique em **Adicionar projeto**
3. Nome: "CinePRO"

### 2.2 Habilitar Authentication
1. No menu lateral: **Authentication → Método de login**
2. Habilite **E-mail/senha**

### 2.3 Criar Firestore
1. No menu lateral: **Firestore Database → Criar banco**
2. Escolha o modo **Produção**
3. Região: `southamerica-east1` (São Paulo)

### 2.4 Regras do Firestore
Cole estas regras em **Firestore → Regras**:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false; // só o backend grava
    }
  }
}
```

### 2.5 Pegar as credenciais
1. Vá em **Configurações do projeto → Seus apps → Web**
2. Clique em **Adicionar app** e siga o fluxo
3. Copie as credenciais e cole em `js/config.js`:
   ```js
   FIREBASE: {
     apiKey: '...',
     authDomain: 'PROJETO.firebaseapp.com',
     projectId: 'PROJETO_ID',
     // ...
   }
   ```

---

## 3. Integração com a Ticto (Webhook)

### Como funciona
Quando alguém **compra ou cancela** sua assinatura na Ticto, ela manda um webhook para
uma URL que você cria (Cloud Function do Firebase).

### 3.1 Deploy da Cloud Function

Instale o Firebase CLI:
```bash
npm install -g firebase-tools
firebase login
firebase init functions
```

Crie a função `functions/index.js`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Webhook recebido da Ticto
exports.tictoWebhook = functions.https.onRequest(async (req, res) => {
  const data = req.body;

  // Ticto envia: event, customer.email, status
  const email  = data?.customer?.email;
  const event  = data?.event;         // 'purchase.approved', 'subscription.canceled', etc.
  const active = event === 'purchase.approved' || event === 'subscription.renewed';

  if (!email) {
    return res.status(400).send('missing email');
  }

  try {
    // Busca ou cria o usuário no Firebase Auth
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch {
      // Cria o usuário se não existir (senha temporária — usuário reseta depois)
      userRecord = await admin.auth().createUser({
        email:    email,
        password: Math.random().toString(36).slice(2) + 'Aa1!',
        emailVerified: false,
      });
    }

    // Atualiza o status no Firestore
    await admin.firestore().collection('users').doc(userRecord.uid).set({
      email,
      subscriptionActive: active,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.status(200).send('ok');
  } catch (err) {
    console.error(err);
    return res.status(500).send('error');
  }
});
```

Deploy:
```bash
firebase deploy --only functions
```

### 3.2 Configurar na Ticto
1. Painel Ticto → **Configurações → Webhooks**
2. URL: `https://us-central1-SEU_PROJETO.cloudfunctions.net/tictoWebhook`
3. Eventos: marque todos os de compra/assinatura

### 3.3 Senha do usuário
O webhook cria o usuário com uma senha aleatória. Você precisa criar um fluxo de
**"Definir senha"** ou usar o Firebase Password Reset:

```
firebase.auth().sendPasswordResetEmail(email)
```

Sugestão: após a compra na Ticto, redirecione para uma página simples onde o usuário define a senha via link de reset do Firebase.

---

## 4. Instalar o plugin no Premiere

### Mac
```bash
cp -r /caminho/para/CinePRO \
  "/Library/Application Support/Adobe/CEP/extensions/CinePRO"
```

### Windows
```
C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\CinePRO
```

### Modo desenvolvedor (para testes)
No Terminal (Mac):
```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

No PowerShell (Windows):
```powershell
Set-ItemProperty -Path "HKCU:\SOFTWARE\Adobe\CSXS.11" -Name "PlayerDebugMode" -Value "1"
```

Reinicie o Premiere → Menu **Window → Extensions → CinePRO**

---

## Estrutura de pastas no Google Drive

Organize os efeitos assim para que apareçam como categorias no plugin:
```
📁 CinePRO Effects (pasta raiz = GOOGLE_DRIVE_FOLDER_ID)
├── 📁 Transições
│   ├── efeito1.mogrt
│   └── efeito2.mp4
├── 📁 Títulos
│   └── titulo1.mogrt
├── 📁 Overlays
│   └── overlay1.mov
└── efeito_avulso.mp4   ← aparece em "Geral"
```

Cada subpasta → uma aba de categoria no painel.
