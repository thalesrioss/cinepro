# ADR-009: Atualização OTA do plugin (sem reinstalar o app)

**Status:** Proposed
**Date:** 2026-07-25
**Deciders:** Thales (produto), Fable (implementação)

---

## Context

Hoje qualquer correção no plugin CEP exige que o usuário baixe e rode o
instalador inteiro. Isso trava o ritmo: cada ajuste de 3 linhas em `js/main.js`
custa um release, um download de 92MB e um passo manual do cliente. Na prática
significa que a maioria dos usuários fica em versão velha.

O objetivo é o modelo que o produto pede: **melhorias contínuas do plugin chegam
sozinhas; o instalador só é necessário em mudança grande.**

Três fatos do ambiente atual determinam a viabilidade:

1. **`PlayerDebugMode = 1`** — o `postinstall` já habilita para CEP 9–13. O
   Premiere **não valida assinatura** da extensão. Trocar arquivos no disco não
   invalida nada. *Este é o habilitador.*
2. **`--enable-nodejs`** no manifest — o painel tem `require('fs')` e já escreve
   no disco (o registro `in-use.json` da v1.0.4 usa isso).
3. **O plugin está em `/Library/Application Support/Adobe/CEP/extensions/CinePRO`**
   — local do sistema, escrita só com root. O painel roda como usuário comum,
   então **não pode se sobrescrever ali**. Este é o único obstáculo real.
4. O `index.html` do plugin **não tem CSP**, e painéis CEP são origem `file://` —
   carregar script por caminho absoluto local funciona.

---

## Decision

Separar o plugin em **casca fina (instalada)** e **payload atualizável (OTA)**:

- **Casca** — `CSXS/manifest.xml` + um `index.html` mínimo de bootstrap. Muda
  raramente, só via instalador.
- **Payload** — `js/`, `css/`, `jsx/`. Vive em diretório do usuário:
  `~/Library/Application Support/CinePRO/plugin/<versão>/`, escrevível **sem
  elevação**.

O bootstrap, ao abrir o painel:

1. Escolhe o payload válido mais novo no diretório do usuário; se não houver,
   usa a **cópia embarcada dentro da extensão** (primeira execução e modo offline).
2. Injeta os `<script>`/`<link>` a partir desse caminho. O caminho contém a
   versão, então **cache-busting é automático** — não depende mais do `?v=`.
3. Em background, consulta o GitHub por payload mais novo, baixa, **verifica
   SHA-256 de cada arquivo**, grava numa pasta nova e só então marca como
   ativa (troca atômica).
4. A versão nova entra no próximo `location.reload()` do painel; a anterior fica
   guardada para rollback.

Para o ExtendScript: em vez de depender do `<ScriptPath>` do manifest (avaliado
uma vez, na carga da extensão), o bootstrap chama
`$.evalFile("<payload>/jsx/hostscript.jsx")`. Assim o host script também é
atualizável OTA.

---

## Options Considered

### Option A: Continuar só com instalador (hoje)

| Dimensão | Avaliação |
|---|---|
| Complexidade | Nenhuma |
| Custo | 0 |
| Velocidade de iteração | **Ruim** — 1 release por correção |
| Risco | Nenhum |

**Pros:** nada a construir; um único caminho de distribuição.
**Cons:** o problema que motivou este ADR. Base de usuários fragmentada em
versões diferentes, o que também dificulta suporte.

### Option B: Tornar a pasta da extensão escrevível pelo usuário

`chown` da pasta em `/Library` para o usuário no `postinstall`; o painel se
sobrescreve no lugar.

| Dimensão | Avaliação |
|---|---|
| Complexidade | **Baixa** — pouquíssimo código |
| Custo | ~0,5 dia |
| Risco de segurança | **Alto** |

**Pros:** implementação mínima; nada muda na forma de carregar os scripts.
**Cons:** cria pasta escrevível pelo usuário dentro de `/Library` — qualquer
processo rodando como o usuário passa a poder injetar código que o Premiere
executa. É escalada de privilégio local e uma marca vermelha em qualquer
auditoria futura. Também não dá staging atômico nem rollback.

### Option C: Casca fina + payload OTA no diretório do usuário (recomendada)

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | ~2–3 dias |
| Risco de segurança | Médio (mitigável — ver abaixo) |
| Rollback | **Sim**, nativo |

**Pros:** sem elevação e sem mexer em permissão de pasta do sistema; troca
atômica com versão anterior preservada; fallback offline pra cópia embarcada;
cache-busting sai de graça; funciona igual se um dia o plugin migrar para a pasta
por usuário.
**Cons:** o bootstrap é uma camada nova (e um ponto de falha novo); exige
disciplina de manter a cópia embarcada como piso funcional.

### Option D: Instalar na pasta CEP por usuário

Mover a instalação para `~/Library/Application Support/Adobe/CEP/extensions/`,
que já é escrevível.

| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa-média |
| Custo | ~1 dia |
| Risco de segurança | Baixo |

**Pros:** resolve a escrita sem casca nova; é o local recomendado pela Adobe pra
extensão por usuário.
**Cons:** instalação deixa de ser para todas as contas da máquina; ainda não dá
staging atômico nem rollback por si só. **Combina bem com a C** — vale como
mudança independente.

---

## Trade-off Analysis

O ponto central: **isto é, por construção, um caminho de execução remota de
código.** Estamos baixando JS da rede e entregando ao Premiere pra executar. A
comparação entre B e C não é sobre esforço, é sobre o raio de dano quando algo
der errado.

A Option B parece barata justamente porque ignora isso — e paga com uma pasta
escrevível dentro de `/Library`, sem staging e sem volta. A Option C custa uns
dois dias a mais e entrega troca atômica, rollback e fallback offline, que são
exatamente as propriedades que fazem o OTA ser seguro de operar.

Mitigações obrigatórias, independentes da opção escolhida:

1. **Integridade** — manifest de payload com SHA-256 por arquivo; nenhum arquivo
   é ativado se o hash não casar. Origem restrita a `github.com` /
   `*.githubusercontent.com` (mesma política já usada no `update:download` do app).
2. **Assinatura (fase 2)** — assinar o manifest de payload com chave Ed25519 cuja
   pública fica embutida na casca e a privada **fora do repositório**. Sem isso,
   quem comprometer o repo ou um token com escopo de release empurra código pra
   toda a base. O hash sozinho é TOFU: protege contra corrupção em trânsito, não
   contra origem maliciosa.
3. **Piso funcional** — a cópia embarcada na extensão precisa sempre abrir e
   logar. Se todo payload OTA falhar, o plugin volta pra ela em vez de morrer.
4. **Compatibilidade** — o payload declara a faixa de casca que suporta; casca
   antiga não aceita payload que exige API nova.

O que **nunca** será OTA (continua exigindo instalador): `CSXS/manifest.xml`
(identidade, versões de host, flags do CEF), `PlayerDebugMode`, assets nativos
embarcados no pkg e o app Electron — este último já tem o próprio auto-update
desde a v1.0.6.

---

## Consequences

**Fica mais fácil**
- Corrigir bug de plugin no mesmo dia, sem release
- Manter a base convergida numa versão só (melhor suporte)
- Testar canário: liberar payload pra um subconjunto antes de todos

**Fica mais difícil**
- Passa a existir código em dois lugares (embarcado e OTA) — divergência é um
  novo modo de falha
- Debug remoto: saber qual payload o cliente tem exige reportar isso na UI
- Exige rigor de release no payload; não há mais "o instalador conserta"

**Precisará ser revisitado**
- Assinatura Ed25519 antes de escalar a base (é o item que eu trataria como
  bloqueante de lançamento amplo, não como melhoria)
- Migração para a pasta CEP por usuário (Option D) como simplificação futura
- Estratégia de canário/rollout gradual quando houver volume

---

## Action Items

1. [ ] Bootstrap `index.html`: resolver payload ativo (usuário → embarcado) e
       injetar scripts por caminho absoluto
2. [ ] Trocar `<ScriptPath>` por `$.evalFile()` do hostscript do payload ativo
3. [ ] Gerar `payload-manifest.json` no CI (versão + SHA-256 por arquivo +
       faixa de casca suportada), publicado no release
4. [ ] Cliente OTA: baixar → verificar hash → staging → ativação atômica →
       manter N-1 pra rollback
5. [ ] Indicador de versão do payload na UI do plugin (suporte)
6. [ ] Rollback automático: se o painel falhar ao carregar 2× no payload novo,
       voltar pro anterior
7. [ ] **Assinatura Ed25519 do manifest de payload** (bloqueante antes de
       lançamento amplo)
8. [ ] Avaliar Option D (pasta por usuário) como simplificação independente
