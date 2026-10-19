# Webhook da Ticto

O único handler que vale é `tictoWebhook` em `firebase/functions/index.js`
(Firebase Functions v2, região `southamerica-east1`, secret `TICTO_TOKEN`).
Passo a passo de deploy em `INICIO_RAPIDO.md` (Passo 3).

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
