# CDN própria (Cloudflare R2) — Setup

Por que: o Google Drive **não é CDN**. Ele tem lock de download por arquivo
(24h, sem override), quota na API key (que é extraível do plugin) e drift de
permissão. O R2 mata os três: egress **grátis**, sem lock, sem key exposta.
Custo: ~US$ 0,015/GB/mês de storage (≈ US$ 1–3/mês pra biblioteca inteira).

A arquitetura já está pronta no código:

- Plugin tenta **CDN → Drive API → Drive usercontent** em cadeia
  (`assetUrlChain` em `js/main.js`). Com `CDN_BASE` vazio, comporta-se
  como hoje. Preenchido, a CDN vira a rota primária.
- `manifest/mirror-to-r2.js` espelha Drive → R2 (idempotente).
- `.github/workflows/mirror-assets.yml` roda o espelho semanal + manual.

## Passo a passo (≈ 10 min, uma vez só)

### 1. Conta + bucket

1. Crie conta em https://dash.cloudflare.com (grátis).
2. Menu **R2 Object Storage** → *Create bucket* → nome: **`cinepro-assets`**
   (location: automatic). R2 pede um cartão pra ativar, mas o free tier
   cobre 10 GB; acima disso é ~US$ 0,015/GB/mês.

### 2. Acesso público de leitura

No bucket → **Settings** → *Public access*:

- **Opção A (rápida):** habilite o **r2.dev subdomain**. Você ganha uma URL
  tipo `https://pub-xxxxxxxx.r2.dev`. Funciona já, mas o r2.dev tem
  rate-limit — ok pra beta, não pro launch.
- **Opção B (definitiva):** *Custom domain* → `cdn.cinepro.app` (precisa do
  domínio no Cloudflare). Sem rate-limit, com cache CDN completo na frente.

Anote a URL — ela vira o `CDN_BASE`.

### 3. API token (pro CI subir arquivos)

R2 → **Manage R2 API Tokens** → *Create API token*:
- Permissões: **Object Read & Write**
- Escopo: *Apply to specific buckets* → `cinepro-assets`

Anote: **Access Key ID**, **Secret Access Key** e o **Account ID**
(aparece na sidebar do dash / na URL).

### 4. Secrets no GitHub

Repo → Settings → Secrets and variables → Actions → *New repository secret*:

| Secret | Valor |
|---|---|
| `R2_ACCOUNT_ID` | Account ID do Cloudflare |
| `R2_ACCESS_KEY_ID` | Access Key ID do token |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key do token |

(`CINEPRO_OAUTH_CLIENT/TOKEN` já existem.)

### 5. Primeira carga

GitHub → Actions → **Mirror Assets to R2** → *Run workflow*:

1. Primeiro um smoke test: `limit = 20`. Confere no dash do R2 que os 20
   objetos apareceram e que `https://<CDN_BASE>/<id>.<ext>` baixa no browser.
2. Depois roda sem limit (carga completa, ~15–20 GB; o job é idempotente —
   se estourar tempo, re-rodar continua de onde parou).

### 6. Ligar a CDN no plugin

Em `js/config.js` e `desktop-app/renderer/js/config.js`:

```js
CDN_BASE: 'https://cdn.cinepro.app',   // ou a URL pub-xxxx.r2.dev
```

Bump de versão + build. Pronto: downloads passam a vir da CDN, com o Drive
como fallback automático se algo faltar no espelho.

## Operação contínua

- O espelho roda **todo sábado 05:00 UTC** (2h depois do rebuild do
  manifest), subindo só os arquivos novos.
- Arquivo removido do Drive continua no R2 (inofensivo — não está mais no
  manifest). Limpeza de órfãos pode ser adicionada depois se o storage
  incomodar.
- Se a CDN cair inteira (improvável), o plugin cai pro Drive sozinho —
  ninguém percebe.
