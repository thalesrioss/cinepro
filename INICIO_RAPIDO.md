# 🚀 CinePRO — Início Rápido

## ✅ O que JÁ está feito

- [x] Plugin instalado em `~/Library/Application Support/Adobe/CEP/extensions/CinePRO`
- [x] PlayerDebugMode habilitado (CEP 9–13) — plugin roda sem assinatura Adobe
- [x] Estrutura do Firebase Functions pronta em `firebase/`
- [x] Webhook Ticto codificado (`firebase/functions/index.js`)
- [x] Regras do Firestore prontas (`firebase/firestore.rules`)

## 🛠️ O que VOCÊ precisa fazer

São 3 passos. Reserve uns **30 minutos**.

---

### Passo 1: Google Drive API Key (5 min)

1. Acesse → https://console.cloud.google.com
2. **Selecionar projeto → Novo projeto** → nome "CinePRO"
3. Menu lateral → **APIs e Serviços → Biblioteca** → busque **"Google Drive API"** → clique em **Ativar**
4. **APIs e Serviços → Credenciais → Criar credencial → Chave de API**
5. Copie a chave gerada
6. Abra `/Users/thalesrioss/Documents/Claude/CinePRO/js/config.js` e cole:
   ```js
   GOOGLE_DRIVE_API_KEY: 'AIzaSy...sua_chave_aqui'
   ```

> ⚠️ Sua pasta do Drive `16nWLu5vz2AB9LjuvwNp3vJP57UHBWfEz` precisa estar **"Qualquer pessoa com o link"** (pública).

---

### Passo 2: Firebase (10 min)

1. Acesse → https://console.firebase.google.com
2. **Adicionar projeto** → use o MESMO projeto criado no passo 1 (ou crie outro)
3. **Authentication → Método de login → E-mail/senha** → Ativar
4. **Firestore Database → Criar banco** → região `southamerica-east1` → modo **Produção**
5. **Configurações do projeto** (engrenagem) → **Seus apps** → ícone `</>` (Web)
   - Apelido: "CinePRO Plugin" → registrar
   - Copie o objeto `firebaseConfig` mostrado
6. Cole em `/Users/thalesrioss/Documents/Claude/CinePRO/js/config.js`:
   ```js
   FIREBASE: {
     apiKey: '...',
     authDomain: '...',
     projectId: '...',
     storageBucket: '...',
     messagingSenderId: '...',
     appId: '...',
   }
   ```

---

### Passo 3: Deploy do Webhook Ticto (15 min)

#### 3a. Instalar Node.js e Firebase CLI
```bash
# Instalar Node.js (se não tiver)
brew install node

# Instalar Firebase CLI
npm install -g firebase-tools

# Login
firebase login
```

#### 3b. Configurar e deploy
```bash
cd /Users/thalesrioss/Documents/Claude/CinePRO/firebase

# Edite .firebaserc e troque "SEU_PROJECT_ID_AQUI" pelo ID do seu projeto Firebase
# (você vê o ID no console do Firebase → Configurações do projeto)

# Instalar dependências
cd functions && npm install && cd ..

# Definir o token único do webhook da Ticto (você pega no passo 3c abaixo)
firebase functions:secrets:set TICTO_TOKEN
# Cole o token quando pedir

# Deploy
firebase deploy --only functions,firestore:rules
```

Ao final, o terminal vai mostrar uma URL tipo:
```
https://southamerica-east1-SEU_PROJETO.cloudfunctions.net/tictoWebhook
```

**Copie essa URL.**

#### 3c. Configurar webhook na Ticto
1. Acesse seu painel Ticto → **Webhooks** (ou Integrações)
2. **Adicionar webhook**:
   - URL: a que você copiou acima
   - Versão: **2.0**
   - Eventos: marque todos (compra, assinatura, exceções)
3. **COPIE O TOKEN** que a Ticto gera pra esse webhook
4. Use esse token no comando `firebase functions:secrets:set TICTO_TOKEN` do passo 3b
5. Salve o webhook na Ticto

> ⚠️ O token é a chave de segurança — sem ele, qualquer um poderia mandar webhook falso pro seu Firebase. O código já valida automaticamente.

### Eventos da Ticto v2 que ativam/desativam acesso

| Evento | Acesso |
|---|---|
| `authorized`, `all_charges_paid`, `trial_started`, `uncanceled`, `extended` | ✅ Ativa |
| `refunded`, `chargeback`, `subscription_canceled`, `trial_ended`, `refused`, `claimed`, `close` | ❌ Desativa |

---

### Passo 4: Sua URL de checkout Ticto

Em `/Users/thalesrioss/Documents/Claude/CinePRO/js/config.js`, cole o link do seu produto:
```js
TICTO_CHECKOUT_URL: 'https://pay.ticto.app/SEU_CHECKOUT'
```

---

## 🎬 Testar no Premiere

1. **Feche o Premiere completamente** (Cmd+Q)
2. Reabra
3. Menu **Janela → Extensões → CinePRO**

O painel deve abrir com a tela de login.

### Para criar um usuário de teste
Como você ainda não tem ninguém comprado pela Ticto, crie manualmente:

1. Firebase Console → **Authentication → Usuários → Adicionar usuário**
2. Crie um email + senha
3. Firebase Console → **Firestore → Iniciar coleção** `users` → ID do documento = UID do usuário criado
4. Adicione campo: `subscriptionActive` (boolean) = `true`
5. Use esse email/senha no plugin pra testar

---

## 📁 Estrutura completa do projeto

```
CinePRO/
├── INICIO_RAPIDO.md          ← você está aqui
├── SETUP.md                  ← documentação detalhada
├── index.html                ← UI do plugin
├── CSXS/manifest.xml         ← config CEP
├── css/style.css             ← tema cinema dark
├── js/
│   ├── config.js             ← 🔑 EDITAR: suas chaves
│   ├── CSInterface.js        ← bridge CEP
│   └── main.js               ← lógica completa
├── jsx/hostscript.jsx        ← ExtendScript (timeline)
├── icons/icon.png            ← ícone do painel
└── firebase/
    ├── firebase.json
    ├── .firebaserc           ← 🔑 EDITAR: project_id
    ├── firestore.rules
    └── functions/
        ├── package.json
        └── index.js          ← webhook Ticto
```

---

## ⚠️ Onde editar (resumo)

| Arquivo | O que editar |
|---|---|
| `js/config.js` | `GOOGLE_DRIVE_API_KEY`, `FIREBASE.*`, `TICTO_CHECKOUT_URL` |
| `firebase/.firebaserc` | `SEU_PROJECT_ID_AQUI` |

**Importante:** depois de editar `js/config.js`, copie a nova versão para a pasta de instalação:
```bash
cp /Users/thalesrioss/Documents/Claude/CinePRO/js/config.js \
   "/Users/thalesrioss/Library/Application Support/Adobe/CEP/extensions/CinePRO/js/config.js"
```

Ou rode esse comando único pra resincronizar **tudo**:
```bash
rsync -av --delete \
  /Users/thalesrioss/Documents/Claude/CinePRO/ \
  "/Users/thalesrioss/Library/Application Support/Adobe/CEP/extensions/CinePRO/"
```
