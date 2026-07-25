# ADR-008: Motor de aplicação automática de SFX

**Status:** Proposed
**Date:** 2026-07-25
**Deciders:** Thales (produto), Fable (implementação)

---

## Context

O botão "⚡ Aplicar pack na timeline" já foi corrigido duas vezes (v1.0.3 faixas
livres, v1.0.6 `ensureFreeAudioTracks` + erro real no toast) e **continua
entregando resultado ruim**. As duas correções anteriores foram feitas às cegas,
sobre suspeitas de falha na *colocação* (ExtendScript). Este ADR parte de
medição, não de suspeita.

A camada de **seleção** é JS puro e roda offline contra o manifest real. Repliquei
o pipeline exato (`getPackIds` → `pickPackRole`) sobre os 11.236 itens.
O que ela devolve hoje:

| Pack | cutSfx escolhido | duração real |
|---|---|---|
| Trailer | `WhooshMedium_Riser` | **6,00s** |
| Vlog | `Transition_Riser_Whoosh` | **4,14s** |
| Reels | `Transition_Riser_Whoosh` | **4,14s** |
| Tutorial | `Transition_Riser_Whoosh` | **4,14s** |
| Corporativo | `Transition_Riser_Whoosh` | **4,14s** |
| Terror | ✗ nenhum | — |
| Gaming | ✗ nenhum | — |
| Documentário | ✗ nenhum | — |

Durações confirmadas lendo o header WAV real no R2 (96kHz/24bit — o proxy por
bytes errava por 4×).

### Os cinco defeitos medidos

**1. A pontuação premia nome verboso, não adequação.**
O score é `Σ (peso_do_conceito × ocorrências)`. A mediana é **1 conceito por
arquivo**; `Transition_Riser_Whoosh` casa **3** (transition + riser + whoosh).
Logo ele vence a soma em *qualquer* receita que tenha um desses conceitos — e por
isso aparece como cutSfx em **5 dos 8 packs**. Um whoosh perfeito de 0,4s que
casa 1 conceito nunca ganha dele.

**2. A ordem da busca está invertida → inanição de papel.**
`getPackIds` faz um ranking **global por gênero** e corta no top-40; só então
`pickPackRole` procura o papel *dentro desses 40*. Resultado: o top-40 de Terror
tem **0 whooshes**, embora a biblioteca tenha **26** áudios com whoosh + horror/tense
(`Whoosh_Terror_short`, `Tension Movie Style Swoosh`…). O papel é escolhido de um
conjunto que já foi filtrado por outro critério.

**3. Colapso de diversidade.**
Os 8 packs juntos usam **229 itens distintos de 10.037 áudios — 2,28% da
biblioteca**. Além disso, **2.289 arquivos (23%) têm embed vazio** e são
invisíveis pro motor. O cliente paga por 10 mil SFX e a mágica enxerga 2%.

**4. Não existe nenhum filtro de duração.** O manifest **não tem campo de
duração**. Nada distingue um riser de 6s de um click de 0,3s. Aplicar um riser de
4,14s em 25 cortes de uma edição de Reels (cortes a cada ~1,5s) empilha áudio
sobrepondo: cada peça precisa de uma trilha nova, o `placeItemSmart` vai criando
trilha atrás de trilha via QE e, quando acaba, retorna `NO_FREE_TRACK`. **É este
o mecanismo do "ficou ruim".**

**5. A implementação contradiz o próprio conhecimento.**
`knowledge/som-e-mente.md` princípio 3 diz que *riser é antecipação e precisa
resolver num impacto*; o código usa riser como SFX de passagem, sem resolução. O
princípio 4 (habituação ~10s) pede contraste; o código repete **o mesmo arquivo
em todos os cortes**. O estudo está correto — o código não o executa.

---

## Decision

Reescrever a seleção como **retrieval por papel sobre a biblioteca inteira, com
porta de adequação (duração/função), variação obrigatória e revisão antes de
aplicar**. Deixa de ser um botão-caixa-preta e passa a ser um plano visível que o
editor aprova.

Pré-requisito de dados: **extrair `dur` (duração) para os 10.037 áudios** e
gravar no manifest. Sem isso nenhuma regra de adequação é possível. 88% é WAV,
onde a duração sai de uma leitura de 4KB do header — barato.

---

## Options Considered

### Option A: Continuar corrigindo a heurística atual

| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa |
| Custo | ~1 dia |
| Escalabilidade | Ruim — o defeito é da ordem da busca, não dos pesos |
| Familiaridade | Alta |

**Pros:** rápido; nenhuma mudança de dados.
**Cons:** já falhou duas vezes; não resolve inanição nem diversidade; mantém a
caixa-preta sem preview. Mexer nos pesos vira jogo de gato e rato (foi o caso do
`light` → "lighter").

### Option B: Retrieval por papel + porta de adequação + preview (recomendada)

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | ~3–4 dias (+1 job de backfill de duração) |
| Escalabilidade | Boa — melhora junto com a biblioteca |
| Familiaridade | Alta (JS puro, testável offline) |

Arquitetura:

1. **Backfill de duração** — job único em CI lê header (WAV: range de 4KB;
   MP3: parse de frames) e grava `dur` no manifest. Passa a rodar no
   `build-manifest` pra arquivos novos.
2. **Retrieval por papel** — para cada papel, filtra a biblioteca **toda** pelo
   conceito do papel *e* pela janela de duração, e só então ordena por
   adequação ao gênero:
   | Papel | conceito | duração |
   |---|---|---|
   | `cut` | whoosh, transition | 0,15–1,2s |
   | `impact` | impact, drop | 0,3–2,5s |
   | `riser` | riser | 1–4s, **exige** impacto resolvendo no fim |
   | `bed` | drone, atmosfera | ≥ 20s |
3. **Normalização do score** — dividir pelo nº de conceitos casados, pra matar o
   prêmio ao nome verboso.
4. **Pool de variação** — 3 a 5 candidatos por papel, alternando entre cortes
   (executa o princípio 4 do MD).
5. **Consciência de ritmo** — a duração do SFX não pode passar do intervalo até o
   próximo corte; se passar, cai pro candidato mais curto do pool.
6. **Preview + aplicar** — o painel mostra o plano ("18 cortes · whoosh A/B/C ·
   impacto no 1º · cama 0–42s"), com prévia de áudio e opção de trocar por papel.
   Aplicação em um único `undo` group.

### Option C: Extrair features reais de áudio (transiente, LUFS, centroide)

| Dimensão | Avaliação |
|---|---|
| Complexidade | Alta |
| Custo | ~2 semanas + pipeline de análise |
| Escalabilidade | Excelente |
| Familiaridade | Baixa |

**Pros:** adequação verdadeira (ataque, brilho, loudness) em vez de palpite por
nome; habilita normalização de volume e detecção de riser-que-resolve.
**Cons:** precisa decodificar 10 mil áudios em CI; muito investimento antes de
qualquer ganho visível. **A duração é o subconjunto de 5% do valor por 1% do
custo — por isso ela entra na Option B.**

### Option D: Delegar a escolha a um LLM (Claude API) por corte

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | ~2 dias + custo por chamada |
| Escalabilidade | Boa, mas com custo recorrente |
| Familiaridade | Média |

**Pros:** entende nuance de gênero e contexto muito melhor que pesos fixos.
**Cons:** latência de segundos num botão que precisa ser instantâneo; custo por
uso num produto de assinatura; **não resolve nada disto** — o LLM continuaria
escolhendo de um catálogo sem duração e sem candidatos adequados. É um multiplicador
*depois* da Option B, não substituto.

---

## Trade-off Analysis

O defeito central não é de afinação, é de **ordem de operações**: filtrar por
gênero antes de filtrar por papel destrói o conjunto de candidatos. Nenhum ajuste
de pesos (Option A) conserta isso — foi por isso que duas correções anteriores
falharam.

A Option C é a arquitetura correta no limite, mas o gargalo hoje é a ausência do
dado mais simples (duração), não a falta de sofisticação. A Option B pega esse
dado e reordena a busca: **é onde está quase todo o ganho**.

A Option D é tentadora porque a escolha é subjetiva, mas ela herdaria exatamente
os mesmos candidatos ruins. Vale reconsiderar depois que B estiver de pé.

A decisão mais importante da B não é técnica e sim de produto: **trocar
caixa-preta por plano revisável**. Um erro de escolha automática é irritante
quando é surpresa e aceitável quando é sugestão editável — e é o que torna o
sistema depurável na mão do cliente, em vez de "não funciona".

---

## Consequences

**Fica mais fácil**
- Diagnosticar: a seleção vira testável offline com asserções por papel
- Diversidade cresce sozinha conforme a biblioteca cresce
- Reverter: um `undo` group em vez de 25 colocações soltas
- Reaproveitar: os mesmos papéis servem o DaVinci sem reescrever a lógica

**Fica mais difícil**
- O manifest ganha um passo de extração (duração) e cresce um pouco
- O botão deixa de ser 1 clique e passa a ser 2 (plano → aplicar)
- 2.289 arquivos com embed vazio continuam invisíveis até o dicionário melhorar

**Precisará ser revisitado**
- Dicionário de conceitos: mediana de 1 conceito/arquivo é baixa demais
- Normalização de volume (sem LUFS, SFX entra em nível inconsistente) → Option C
- Riser que "resolve" só é verificável de verdade com análise de envelope

---

## Action Items

1. [ ] Backfill de `dur` no manifest (WAV via header 4KB; MP3 via frames) + passar
       a extrair no `build-manifest` para arquivos novos
2. [ ] Reescrever a seleção: retrieval por papel sobre a biblioteca toda, com
       janela de duração e score normalizado pelo nº de conceitos casados
3. [ ] Suíte de asserção offline por pack: papel preenchido, duração na janela,
       ≥3 candidatos distintos, nenhum arquivo repetido entre packs
4. [ ] Pool de variação (3–5 por papel) alternando entre cortes
5. [ ] Consciência de ritmo: SFX nunca maior que o intervalo até o próximo corte
6. [ ] UI de plano: prévia por papel, troca manual, aplicar em um `undo` group
7. [ ] Aumentar densidade do dicionário de conceitos (meta: mediana ≥ 3; zerar os
       2.289 sem embed)
8. [ ] Reavaliar Option C (features de áudio) depois de medir o resultado da B
