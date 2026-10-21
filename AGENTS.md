# CinePRO · instruções para agentes

Leia isto antes de mexer no código. É o atalho para não redescobrir, a cada sessão, como rodar e testar este repositório. Estrutura no `README.md`; setup do Firebase no `INICIO_RAPIDO.md`; webhook e segurança em `docs/WEBHOOK-TICTO.md`.

## Produto e partes

- Plugin de efeitos para Adobe Premiere Pro (extensão CEP) com app desktop gerenciador (Electron).
- Plugin CEP: `index.html`, `css/`, `js/`, `jsx/` (ExtendScript), `CSXS/manifest.xml`. Só roda dentro do Premiere.
- App desktop: `desktop-app/` (Electron, versão em `desktop-app/package.json`).
- Backend: `firebase/functions/` (Firebase Functions v2, projeto `cinepro-42971`, região `southamerica-east1`).
- Landing page: `landing-page/` (estática; produção em https://cinepro-rho.vercel.app).
- Instaladores: `installer/` (Mac `.pkg`, Windows). Catálogo: `manifest/` e workflows de assets.

## Comandos canônicos

| Para | Comando |
| --- | --- |
| Todos os testes | `bash tools/run-all-tests.sh` (roda `tools/test-*.js` + `tools/check-lua.js`; sai 0 só com tudo verde) |
| Um teste | `node tools/test-<nome>.js` |
| Sintaxe de um arquivo | `node --check <arquivo>.js` |
| App desktop | `cd desktop-app && npm install && npm start` (abre janela: não use na máquina do chefe) |
| Copiar a busca para o app | `cd desktop-app && npm run sync-shared` (`js/search-core.js` é a fonte) |
| Build do app | `cd desktop-app && npm run build:mac` / `build:win` (Mac universal, ver `installer/mac/build.sh`) |
| Servir o painel para teste | `python3 -m http.server <porta>` na raiz e abrir `index.html` headless |

Antes de dizer que terminou: `bash tools/run-all-tests.sh` verde e, para mudança de interface do painel, um harness headless (`tools/check-bl00xx-harness.js` é o padrão).

## Testar sem o Premiere

- O painel aberto fora do Premiere não tem a ponte do Adobe (`evalScript` indefinido) nem `js/host/` (não versionado, BL-0012): esses erros no console são esperados e não são regressão. Compare sempre com `main`.
- Harnesses headless: Playwright (o `playwright-core` do clone do NewEditor.AI serve) com `executablePath` do Google Chrome; o headless_shell do cache é de outra versão. Firebase, CEP e rede são simulados nos harnesses do tester (`~/.openclaw/workspace-tester/tools/`).
- jsDelivr às vezes dá `ERR_NETWORK_CHANGED` no headless: repita antes de concluir que falhou.
- Nunca rode `installer/mac/scripts/preinstall` ou `postinstall` de verdade: apagam o app e a extensão instalados.
- `firebase-admin` não está na raiz: rode scripts com `NODE_PATH=firebase/functions/node_modules`.
- `/bin/bash` do macOS é 3.2: com `set -u`, expandir array vazio quebra. O macOS não tem `timeout`.

## Produção: cuidado

- **Push em `main` que mexe em `firebase/**` é deploy de produção.** `.github/workflows/deploy-functions.yml` roda `firebase deploy --only functions --force` (apaga functions que saíram do código). Item que toca `firebase/` precisa da conferência descrita em `docs/WEBHOOK-TICTO.md` antes do merge.
- Webhook da Ticto: só aceita o token (`TICTO_TOKEN`), lido primeiro do campo `token` do corpo. Nunca logue headers, query, token ou e-mail completo de cliente.
- Não crie contas reais no Firebase de produção nem use dados de clientes em testes.
- O repositório é público: nada de segredo, e-mail de cliente ou chave no código (`tools/test-no-default-secrets.js` vigia).

## Regras do escritório NewContent (agentes do OpenClaw)

- Trabalhe no clone `~/.openclaw/newcontent/repos/cinepro`, em branch `office/<id-do-item>` a partir de `main` atualizada. Commits pequenos, em português, com o id do item. Commite cedo e anote no item onde parou.
- Nunca mexa na pasta local do chefe (`~/Documents/Claude/CinePRO`).
- Nenhum agente faz push, merge, release ou deploy: isso é do chefe.
- Ciclo, backlog, passagem de tarefa e registro de melhorias: `~/.openclaw/newcontent/CICLO.md`.
