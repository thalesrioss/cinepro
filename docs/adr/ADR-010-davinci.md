# ADR-010: Evolução da integração com DaVinci Resolve

**Status:** Proposed
**Date:** 2026-07-28
**Deciders:** Thales (produto), Fable (implementação)

---

## Context

Hoje o Resolve é cidadão de segunda classe no CinePRO, e a diferença é grande:

| | Premiere | Resolve (hoje) |
|---|---|---|
| Onde o usuário está | painel **dentro** do editor | app separado |
| Aplicar um SFX | 1 clique, no playhead | fila → trocar de app → `Workspace > Scripts` → roda |
| Onde o som cai | playhead ou corte exato | **no fim da timeline** |
| Pack automático (ADR-008) | sim | **não existe** |
| Legendas | sim | **não existe** |
| Restaurar mídias | sim | parcial (registro é compartilhado) |

O `CinePRO Import.py` (99 linhas) faz o mínimo: lê a fila, importa pro bin
"CinePRO", dá `AppendToTimeline` e limpa a fila. Ele **não sabe onde** colocar
— joga tudo no fim. Para um editor que quer um whoosh no corte, isso é
praticamente inútil.

### O que o ambiente permite (verificado nesta máquina)

- **Resolve 21.0.3** instalado — API moderna
- `DaVinciResolveScript.py` **existe** em
  `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/`
  e o módulo **importa sem erro**
- A conexão externa devolveu `None`, mas o Resolve estava **fechado** — então
  isso **não** prova nem desprova que scripting externo funcione
- Nenhum Workflow Integration Plugin instalado

### A observação que muda o desenho

O motor do ADR-008 já separa **decidir** de **aplicar**: `buildPlan()` devolve
uma lista de passos (`{role, effect, at}`) e quem executa é outra camada. Essa
separação foi feita para dar preview no Premiere, mas resolve o Resolve de
graça:

> **A inteligência não precisa ser portada.** O plano é calculado em JS (onde
> já está testado, 20/20) e serializado como JSON. O Python vira um executor
> burro que lê tempos e coloca clipes.

Sem isso, manter dois motores de seleção em linguagens diferentes seria a
garantia de que um dos dois ficaria para trás.

---

## Decision

Adotar **plano-como-dado**: o app calcula o plano em JS e grava um
`plan.json` na fila; o `CinePRO Import.py` passa a executar esse plano,
colocando cada arquivo no **frame exato** via `AppendToTimeline` com
`recordFrame`.

Isso traz para o Resolve, **sem exigir Studio**, tudo que hoje só o Premiere
tem: colocação no playhead, SFX nos cortes, pack automático e legendas.

Fica um único ponto de atrito: o usuário ainda precisa rodar
`Workspace > Scripts > CinePRO Import` uma vez por lote. Removê-lo depende de
scripting externo, cuja disponibilidade na versão free é o **item a testar**
antes de investir.

---

## Options Considered

### Option A: Manter como está

| Dimensão | Avaliação |
|---|---|
| Complexidade | Nenhuma |
| Custo | 0 |
| Paridade com Premiere | **Muito baixa** |

**Pros:** funciona no free; nada a manter.
**Cons:** não coloca onde o editor quer; sem pack, sem legendas. O Resolve
continua sendo item de marketing, não recurso usável — e vender "funciona no
DaVinci" com isto é prometer mais do que entrega.

### Option B: Plano-como-dado + executor Python (recomendada)

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | ~2–3 dias |
| Licença | **Funciona no Resolve FREE** |
| Reuso | Total — zero motor duplicado |

Como funciona:

1. O app lê a timeline? Não precisa: o **próprio script** enumera os cortes
   (`timeline.GetItemListInTrack('video', 1)` → `GetStart()` de cada item) e
   grava `timeline.json` na fila.
2. O app calcula o plano com o mesmo `buildPlan()` do Premiere e grava
   `plan.json` + baixa os arquivos.
3. O script lê o plano, converte segundos → frames pelo frame rate do projeto
   e chama `AppendToTimeline` com `recordFrame` e `trackIndex` por passo.

Cobre também:
- **Legendas** — `ImportMedia` do `.srt` limpo e `AppendToTimeline` na trilha
  de legenda; o Resolve lê SRT nativo (mesmo arquivo que o Premiere usa).
- **Restaurar mídias** — o registro `in-use.json` já é compartilhado entre
  app e plugin; falta o script conferir mídia offline e reconectar.

**Pros:** um motor só; funciona no free; o script fica burro e estável.
**Cons:** exige duas passadas (uma pra ler a timeline, outra pra aplicar) ou
que o usuário rode o script duas vezes; ainda tem o clique manual.

### Option C: Scripting externo (o app dirige o Resolve)

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | ~2 dias **sobre a B** |
| Licença | **INCERTO** — historicamente Studio-only |
| Paridade | Alta (sem clique manual) |

O app importa `DaVinciResolveScript` e fala com o Resolve aberto: lê a
timeline e aplica direto, sem fila e sem menu.

**Pros:** elimina o único atrito que sobra na B; permite ler a timeline e
mostrar o plano no app antes de aplicar, como no Premiere.
**Cons:** **a Blackmagic historicamente restringe a API externa ao Studio** —
o free só permite scripts rodando de dentro. Não consegui confirmar aqui
porque o Resolve estava fechado. Se for Studio-only, isto exclui a maior
parte da sua base, já que o apelo do Resolve é justamente ser gratuito.

**Esta opção não deve ser construída antes do teste da §Action Items.**

### Option D: Workflow Integration Plugin (painel HTML dentro do Resolve)

| Dimensão | Avaliação |
|---|---|
| Complexidade | **Alta** |
| Custo | ~1–2 semanas |
| Licença | Studio-only |
| Paridade | Total — é o equivalente ao CEP |

**Pros:** é a experiência real: painel dentro do Resolve, igual ao Premiere.
**Cons:** Studio-only; build separado; a Blackmagic muda a interface entre
versões maiores. Investimento grande para atingir só assinantes de Studio.

---

## Trade-off Analysis

A decisão real é **onde mora a inteligência**, não qual API usar. Se o motor
de seleção for reescrito em Python, passam a existir duas implementações do
ADR-008 que precisam concordar — e, na prática, a do Resolve ia ficar para
trás a cada ajuste. Com plano-como-dado, o Python nunca decide nada; ele
posiciona. Isso vale para as três opções B, C e D, e por isso é a decisão
central deste ADR, não um detalhe da B.

A escolha entre B e C é sobre **licença, não engenharia**: a C é
estritamente melhor em experiência e mais barata do que parece — mas se
exigir Studio, ela atende a minoria dos seus usuários. Construir a B primeiro
garante que **todo mundo** tenha o recurso; a C vira melhoria opcional, e
com a B pronta o custo dela cai (o plano já existe; só muda o transporte).

A D é a única que chega à paridade completa, e é justamente a que menos gente
alcança. Não faz sentido antes de haver assinantes de Studio pedindo.

Um ponto honesto sobre expectativa: o Resolve **nunca** vai ter a mesma
fluidez do Premiere enquanto o CinePRO for um app externo. A B fecha a maior
parte da distância funcional — mas o clique no menu continua lá, e isso
precisa estar claro na LP em vez de "funciona no DaVinci" sem asterisco.

---

## Consequences

**Fica mais fácil**
- Um motor só: ajustes no ADR-008 chegam nos dois editores juntos
- O script Python fica pequeno e testável (lê JSON, coloca clipe)
- Legendas e restaurar mídias entram quase de graça, reaproveitando o que existe

**Fica mais difícil**
- Contrato novo entre app e script (`plan.json`) que precisa versionar — script
  velho com plano novo tem que degradar, não quebrar
- Conversão segundos → frames depende do frame rate do projeto; erro de
  arredondamento desalinha o som do corte
- Testar exige Resolve aberto com projeto: **não consigo validar sozinho**

**Precisará ser revisitado**
- Se o teste mostrar que scripting externo funciona no free, a C passa na
  frente e o atrito acaba
- Workflow Integration (D) quando houver demanda de Studio
- A Blackmagic muda a API entre versões maiores; o script precisa tolerar

---

## Action Items

1. [ ] **Teste decisivo** (5 min, você): abrir o Resolve com um projeto e rodar
       o probe de scripting externo. O resultado decide se a Option C entra
       agora ou é descartada.
2. [ ] Contrato `plan.json` versionado (`schemaVersion`, passos com `at` em
       segundos, papel e id do arquivo)
3. [ ] `CinePRO Import.py`: ler o plano, converter para frames pelo frame rate
       do projeto e usar `AppendToTimeline` com `recordFrame`
4. [ ] Script grava `timeline.json` (cortes, duração, frame rate) para o app
       calcular o plano
5. [ ] Legendas no Resolve: importar o `.srt` limpo na trilha de legenda
6. [ ] Restaurar mídias no Resolve: reconectar offline usando o `in-use.json`
       que já é compartilhado
7. [ ] Degradação: script antigo com plano novo avisa e cai no comportamento
       atual em vez de quebrar
8. [ ] Corrigir a comunicação na LP — dizer o que o Resolve faz e o que exige
       um passo manual
