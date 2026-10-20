# Webhook da Ticto

O único handler que vale é `tictoWebhook` em `firebase/functions/index.js`
(Firebase Functions v2, região `southamerica-east1`, secret `TICTO_TOKEN`).
Passo a passo de deploy em `INICIO_RAPIDO.md` (Passo 3).

## Autenticação (ADR-0008, BL-0074)

Só passa pedido com o token da Ticto igual ao secret `TICTO_TOKEN`,
comparado em tempo constante. Não existe mais o "fallback" que aceitava
pedido sem token quando o corpo parecia Ticto v2: os campos são públicos e
qualquer um ativava ou cancelava assinatura de qualquer e-mail.

- Sem token, token errado ou `TICTO_TOKEN` vazio no ambiente → `401`, nada é
  escrito no Auth, no Firestore nem no Sheets, e nenhum e-mail sai.
- Onde o token é procurado (o primeiro não vazio vale): campo `token` do
  corpo, headers `x-ticto-token`, `x-token`, `x-postback-token`,
  `x-postback-secret`, `Authorization: Bearer <token>`, e `?token=` na URL.
- A função não loga mais headers, query nem o token. A rejeição loga só
  "token ausente" ou "token invalido".

Teste: `node tools/test-ticto-webhook.js` (entra no `tools/run-all-tests.sh`).

## Antes do deploy (chefe)

Se a Ticto hoje chega sem token, compra legítima passa a dar `401` depois do
deploy. Conferir primeiro:

1. Google Cloud Console → Logging → Logs Explorer, projeto do CinePRO,
   últimos 30 dias, consulta (a busca pelo texto basta; o nome do serviço
   da função v2 no Cloud Run é `tictowebhook`, se quiser filtrar):
   ```
   textPayload:"FALLBACK ATIVADO"
   ```
2. **Apareceu compra real** → no painel da Ticto, trocar a URL do webhook
   para `https://<url-da-funcao>?token=<TICTO_TOKEN>` (ou configurar o token
   no campo próprio do painel), mandar um evento de teste e conferir que ele
   **não** gera mais "FALLBACK ATIVADO" no log atual. Só então fazer o deploy.
3. **Não apareceu nada** → a Ticto já manda o token; pode fazer o deploy.
4. Depois do deploy: evento de teste do painel da Ticto deve dar `200`.
   Se der `401`, o plano de volta é redeployar o commit anterior da função
   (`git checkout <commit-anterior> -- firebase/functions/index.js` e deploy),
   enquanto corrige o token no painel.

## Endpoint de status removido e link de senha fora do log (BL-0075)

- `checkStatus` saiu de `firebase/functions/index.js`. Era público e, com o
  repositório aberto, qualquer um consultava por `?email=` se a pessoa era
  cliente, o nome e se pediu reembolso ou chargeback. Nada no app, no painel
  nem na LP chamava. Consulta de cliente agora é pelo console do Firebase
  (Authentication + Firestore `users/<uid>`).
- No fallback do e-mail de boas-vindas (quando o envio do Firebase falha), o
  log era `[fallback] <e-mail> - link manual: <link>`: quem lia o Cloud
  Logging entrava na conta do cliente novo antes dele. Agora o log é só
  `fallback Resend para pa***@exemplo.com`.
- **Atenção:** os dois só saem do ar com o deploy das functions. Até lá a URL
  de `checkStatus` em produção continua respondendo.
- O deploy é automático: push em `main` que mexe em `firebase/**` dispara
  `.github/workflows/deploy-functions.yml` (`firebase deploy --only functions
  --force`, que apaga sem perguntar as funções que saíram do código). Ou seja,
  o push do merge já é o deploy, e leva junto o BL-0074: fazer a conferência
  do Cloud Logging da seção "Antes do deploy" **antes** do push.
- Depois do deploy, conferir que `checkstatus` sumiu da lista de funções do
  Firebase (ou do Cloud Run) e que `GET <url-antiga>/checkStatus?email=x`
  não responde mais com dados.

Teste: `node tools/test-ticto-webhook.js` (grupo "VAZAMENTO").

## Rascunho removido (BL-0011)

Existia `webhook/ticto-webhook-handler.js`, um router Express que nunca foi
deployado. Foi removido porque:

- tinha segredo padrão no código (`TICTO_WEBHOOK_SECRET` caía num literal de exemplo quando a variável faltava);
- a checagem HMAC só rodava quando o header de assinatura vinha: sem header, o
  pedido passava;
- usava nomes de evento que não são os da Ticto v2 (`checkout.completed`,
  `subscription.created`...); a v2 manda `status` (`authorized`,
  `subscription_canceled`, `refunded`...), que é o que o handler real lê;
- quando o e-mail não existia no Auth, gravava `users/<email>` (id do documento
  = e-mail), formato que o painel e o app não leem;
- expunha `POST /ticto/test`, que ativava qualquer e-mail sem autenticação.

O que tinha de aproveitável, para quando o handler real for mexido:

- verificar a assinatura com `crypto.createHmac('sha256', segredo)` sobre o
  corpo **bruto** (não `JSON.stringify(req.body)`), comparar com
  `crypto.timingSafeEqual` e rejeitar quando o header falta;
- gravar no `users/{uid}` com `{ merge: true }` para não apagar campos que o
  admin mudou à mão (o handler real já faz isso).
