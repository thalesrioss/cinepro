# ADR-011: De ferramenta de assets a plataforma de análise

**Status:** Proposed
**Date:** 2026-07-28
**Deciders:** Thales (assumiu a responsabilidade do escopo), Fable

---

## Context

O produto acumulou peças que foram construídas isoladamente, mas que juntas
valem mais do que a soma. Este ADR não propõe uma feature — propõe **parar de
pensar em features** e enxergar o que já existe como **primitivas
componíveis**.

### O que existe hoje

| Primitiva | O que faz | Estado |
|---|---|---|
| **P1 · Modelo de timeline** | cortes, duração, fps, trilhas | ✅ Premiere · ⚠️ Resolve parcial |
| **P2 · Transcrição** | texto alinhado no tempo | ✅ Resolve nativo · ❌ Premiere |
| **P3 · Plano** | passos `{tempo, ação, arquivo}` | ✅ `sfx-engine` + `autoedit` |
| **P4 · Executor** | aplica o plano no editor | ✅ Premiere · 🔨 Resolve |
| **P5 · Anotador** | escreve marcadores na timeline | ❌ **não existe** |

### As três descobertas que forçam o reenquadramento

**1. Marcadores existem nos dois editores por API.** Resolve tem
`AddMarker(frameId, color, name, note, duration, customData)`; Premiere tem
`sequence.markers`. Isso cria um **canal de entrega não-destrutivo** que nunca
usamos — dá pra escrever conclusões na timeline sem alterar um frame da
montagem.

**2. O vault do Thales tem números, não só conselhos.** De
`knowledge/retencao-e-edicao.md`: recomprar atenção a cada **5s** no YouTube e
**2s** em Reels; estrutura 7E com **duração alvo por bloco**. Isso é
verificável contra uma timeline por software.

**3. O peso computacional não cabe no plugin.** Transcrição no Premiere,
detecção de BPM e análise de áudio não rodam no CEP nem no Python do Resolve.
Sobra um único lugar: o **app Electron** — que deixa de ser "instalador +
biblioteca" e vira a **camada de computação** do produto.

---

## Decision

Tratar o CinePRO como **plataforma de análise de timeline**, não como
biblioteca de efeitos com extras. Concretamente:

1. Construir **P5 (anotador)** como primitiva de primeira classe.
2. **Entregar diagnóstico antes de automação.** O que é analisado e escrito em
   marcador é reversível; o que é cortado, não.
3. Assumir o app Electron como **camada de computação** (transcrição, áudio),
   com plugin e script sendo clientes finos.

---

## O brainstorm: o que nasce das combinações

Cada linha é uma feature que **não precisa de primitiva nova** além do que
está listado.

| Feature | Primitivas | Custo | Destrutivo? |
|---|---|---|---|
| Auto-SFX por papel | P1+P3+P4 | ✅ feito | sim |
| Legendas SRT limpas | P2+P4 | ✅ feito | não |
| **AutoEdit** (remove silêncio) | P2+P3+P4 | 🔨 núcleo pronto | **sim** |
| **Diagnóstico de retenção** | P1+P2+**P5** | baixo | **não** |
| **Busca por palavra na timeline** | P2+P5 | **muito baixo** | não |
| **Verificação 7E** | P2+P5 | baixo | não |
| **Caça-gancho** | P2+vault+P5 | médio | não |
| **Densidade de corte por gênero** | P1+P5 | **muito baixo** | não |
| **Relatório exportável** | P1+P2 | baixo | não |
| Corte na batida | novo (áudio)+P3 | alto | sim |
| Marcar onde falta B-roll | P2+LLM+P5 | médio | não |

### As quatro que eu destacaria

**🎯 Diagnóstico de retenção** — varre a timeline e escreve marcadores nos
trechos sem quebra de padrão além do limite do formato:

> `0:34 · 13s sem quebra de padrão (limite vertical: 2s)`

Usa exclusivamente conhecimento que o Thales já validou. Nenhum concorrente
tem, porque nenhum tem o vault. E é **consultoria automatizada**, não efeito
bonito — ataca o eixo que o cliente sente no bolso: alcance.

**🔎 Busca por palavra na timeline** — a mais barata de todas e provavelmente
a de uso diário mais alto. *"Onde eu falo 'garantia'?"* → marcador no ponto.
Sai quase de graça depois que P2 existe.

**📐 Verificação 7E** — o único framework de copy que vi com **duração por
bloco**. Compara o começo do vídeo com o alvo:

> `E1 Antagonismo: 9s (alvo 3-5s) — está lento pra prender`

**📄 Relatório exportável** — o editor manda pro cliente dele. Isso é o
princípio **Público** do Berger (que está no vault): torna visível um trabalho
que era invisível. Vira marketing feito pelo próprio usuário.

---

## Options Considered

### Option A: Terminar AutoEdit e lançar

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo | ~2–3 semanas |
| Risco | **Alto** — corte errado destrói trabalho |
| Diferenciação | Alta, mas há concorrente (Recut, Timebolt) |

**Pros:** é o que foi decidido; feature de manchete.
**Cons:** a mais destrutiva do produto estreia sem nenhum usuário ter testado
nada antes. Se cortar errado na primeira semana, queima confiança justamente
no lançamento.

### Option B: P5 + diagnóstico primeiro, AutoEdit em seguida (recomendada)

| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa (P5 é pequeno) |
| Custo | ~4–5 dias pra P5 + diagnóstico + busca |
| Risco | **Muito baixo** — não altera nada |
| Diferenciação | **Máxima** — usa conhecimento exclusivo |

**Pros:** entrega três features com uma primitiva pequena; **zero risco de
destruir projeto**; ensina o que o editor confia antes de deixá-lo cortar; e o
AutoEdit herda P2 e P5 prontos, ficando mais barato depois.
**Cons:** adia a manchete; diagnóstico não é tão "mágico" quanto corte
automático.

### Option C: Tudo em paralelo

| Dimensão | Avaliação |
|---|---|
| Complexidade | Alta |
| Custo | indefinido |
| Risco | Alto |

**Pros:** nenhum real.
**Cons:** com uma pessoa executando, paralelismo é troca de contexto. É como
os bloqueadores de lançamento ficaram parados enquanto o código andava.

---

## Trade-off Analysis

A questão não é qual feature vale mais — é **em que ordem o risco é menor**.

AutoEdit e diagnóstico partilham a mesma primitiva cara (**P2, transcrição**).
A diferença é o que cada um faz com ela: um **corta**, o outro **anota**. O
segundo é reversível, testável na frente do cliente sem medo, e revela se as
regras do vault se traduzem bem em software — **antes** de deixar essas mesmas
regras cortarem o vídeo de alguém.

Existe um argumento comercial junto: diagnóstico é o que o editor **mostra pro
cliente dele**. Autoedit ele usa escondido — ninguém anuncia que a IA cortou.
Isso muda quem faz o marketing do produto.

O contra-argumento honesto: corte automático é mais fácil de vender numa
demonstração de 15 segundos. Diagnóstico exige explicar. Se o lançamento
depende de um vídeo de demonstração impactante, AutoEdit ganha.

**Por isso a recomendação é ordem, não exclusão:** P5 primeiro porque é
pequeno e barato, AutoEdit em seguida com P2 e P5 já pagos.

---

## Consequences

**Fica mais fácil**
- Toda análise futura tem canal de entrega pronto (marcador) sem UI nova
- AutoEdit fica mais barato: chega depois de P2 e P5 prontos
- Diagnóstico dá o que mostrar ao cliente sem tocar na montagem dele

**Fica mais difícil**
- O app Electron vira dependência de computação — instalador cresce se
  embarcar transcrição, ou cria custo se for nuvem (ADR próprio)
- Paridade Premiere/Resolve piora antes de melhorar: P2 é nativo no Resolve e
  não existe no Premiere
- Marcador demais polui a timeline; precisa de cor e limite

**Precisará ser revisitado**
- **Transcrição no Premiere**: embarcar Whisper (instalador +centenas de MB)
  ou nuvem (custo por uso). Decisão de peso, merece ADR próprio
- Detecção de BPM: só faz sentido depois que a camada de áudio existir
- Se o diagnóstico não engajar, a hipótese de "consultoria automatizada" cai e
  o foco volta pra automação

---

## Action Items

1. [ ] **P5 · Anotador** — `addMarkers(plan)` nos dois executores, com cor por
       severidade e teto de marcadores
2. [ ] **Diagnóstico de retenção** — motor em JS, testável offline como os
       outros, com os limites (2s/5s) vindo de `data/` pelo canal remoto
3. [ ] **Busca por palavra** — barata, alto uso diário
4. [ ] **P4 Resolve** — executor do plano (`CreateTimelineFromClips`), que
       serve AutoEdit e diagnóstico
5. [ ] **P2 Premiere** — ADR próprio: Whisper embarcado vs nuvem
6. [ ] **AutoEdit ponta a ponta** no Resolve, herdando P2/P4/P5
7. [ ] Verificação 7E e caça-gancho usando as fórmulas do vault
8. [ ] Relatório exportável (o vetor de marketing feito pelo usuário)
