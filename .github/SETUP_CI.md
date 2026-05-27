# 🚀 CI/CD Setup — Cloud Functions automáticas

Este projeto deploya as Cloud Functions automaticamente via GitHub Actions
sempre que houver push em `main` afetando `firebase/`.

## Setup inicial (uma única vez)

### 1) Criar service account no Google Cloud

1. Abra → https://console.cloud.google.com/iam-admin/serviceaccounts?project=cinepro-42971
2. Clique **"+ CRIAR CONTA DE SERVIÇO"**
3. Nome: `github-actions-deployer`
4. ID: deixa o sugerido (`github-actions-deployer@cinepro-42971...`)
5. Clica **"CRIAR E CONTINUAR"**

### 2) Atribuir permissões

Adiciona estes 5 papéis:

- `Cloud Functions Admin`
- `Cloud Run Admin`
- `Service Account User`
- `Cloud Build Editor`
- `Secret Manager Secret Accessor`

Clica **"CONCLUÍDO"**.

### 3) Gerar a chave JSON

1. Na lista de service accounts, clica em `github-actions-deployer@...`
2. Aba **"CHAVES"** → **"ADICIONAR CHAVE"** → **"Criar nova chave"** → **JSON**
3. O navegador baixa um arquivo `.json` — **NÃO COMITA ele, NÃO COMPARTILHA**

### 4) Adicionar como GitHub secret

1. Abre o arquivo JSON num editor de texto
2. Copia TODO o conteúdo (do `{` até o `}` final)
3. Vai em → https://github.com/thalesrioss/cinepro/settings/secrets/actions
4. Clica **"New repository secret"**
5. Nome: `FIREBASE_SERVICE_ACCOUNT`
6. Valor: cola o JSON completo
7. **"Add secret"**

### 5) Deleta o JSON local

Depois de adicionar no GitHub, **deleta o arquivo JSON da sua máquina** — ele dá acesso administrativo ao seu Firebase, não pode vazar.

## Como funciona

A partir desse momento, **qualquer commit no `main` que altere `firebase/`** dispara o deploy automático.

### Exemplo de fluxo

```bash
# Você edita firebase/functions/index.js
git add firebase/
git commit -m "feat: adiciona novo evento"
git push origin main
```

→ GitHub Actions detecta a mudança → roda deploy → em ~2 min as funções
estão atualizadas em produção.

Acompanha em: https://github.com/thalesrioss/cinepro/actions

### Forçar deploy manual

Se quiser disparar sem alterar código:

1. Vai em https://github.com/thalesrioss/cinepro/actions/workflows/deploy-functions.yml
2. Clica **"Run workflow"** → branch `main` → **"Run workflow"**

## Troubleshooting

| Erro | Causa | Fix |
|---|---|---|
| `Could not refresh access token` | Service account sem permissão | Verifica os 5 papéis no passo 2 |
| `Failed to fetch CF Gen 2 Cloud Run service` | Falta Cloud Run Admin | Adiciona o papel |
| `Permission denied on secret` | Falta Secret Accessor | Adiciona o papel |
| `package.json indicates outdated` | Warning, ignora | — |

## Segurança

- O JSON é **somente** no GitHub Secrets (encriptado)
- Logs do workflow não expõem o conteúdo do secret
- Pra revogar acesso: deleta a service account no GCP console
