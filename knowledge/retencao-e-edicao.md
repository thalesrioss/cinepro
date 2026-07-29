# Retenção, Copy e Edição — o norte do CinePRO

> **Origem:** sintetizado do second brain do Thales, não de fonte externa.
> Segue a lei fundadora do vault: *"IA boa não inventa. Ela segue o que já
> deu certo pra mim."* Cada princípio abaixo veio de uma nota validada, e
> está anotado com a origem.
>
> **Para que serve:** dar ao produto (e ao agente) critério para decidir
> **onde cortar, o que manter e o que pontuar**. É o par do
> [[som-e-mente]] — aquele trata do som, este trata do tempo e do sentido.

---

## 1. Os números que governam tudo

De [[Ciência por trás da edição de vídeo]]:

| Contexto | Comprar atenção a cada |
|---|---|
| Ciclo de atenção humano | **8s** |
| YouTube (horizontal) | **5s** |
| Reels / Shorts / TikTok | **2s** |

> *"Interesse não é conquistado, mas mantido."*

Esta é a métrica mais acionável do vault inteiro, porque é **mensurável na
timeline**. Um trecho sem nenhuma quebra de padrão por mais de 5s (ou 2s no
vertical) é dívida de retenção — e o software consegue apontar o timecode.

**A cadeia:** `Curiosidade → Interesse → Retenção`. Perde a primeira, perde
as três.

### O que conta como quebra de padrão
Corte, transição, lettering, mudança de câmera, animação, SFX, fala direta
com a audiência, CTA.

**Duas regras que limitam o uso:**
1. **Não repetir a mesma quebra** — repetir o mesmo recurso derruba a
   atenção em vez de segurar (mesma lógica da habituação em [[som-e-mente]]).
2. **B-roll não serve como quebra de 3s** — o raciocínio da audiência
   precisa de fluxo contínuo; B-roll picado corta a formação da ideia.

---

## 2. Os três eixos da retenção

De [[Ciência por trás da edição de vídeo]]:

| Eixo | Definição |
|---|---|
| **Interesse** | Singularidade — resolve um problema específico dela |
| **Satisfação** | A experiência precisa entregar de verdade |
| **Engajamento** | Pluralidade — recomprar a atenção a cada ciclo |

> *"Se nosso conteúdo não aumenta de alcance ou visualização, estamos
> pecando na experiência."*

**Alinhamento de expectativa é lei:** se o vídeo promete X, não entregue Y.
*"Não traga over delivery daquilo pelo qual a pessoa não veio receber."*
Isso vale para conteúdo de topo — em mentoria a regra muda.

**Estrutura da entrega:** *"A entrega precisa gerar um conflito, para então
uma mega entrega."* Conflito interno antes da resolução — é o mesmo formato
de antecipação → resolução do riser em [[som-e-mente]] (princípio 3).

**Formato:** hoje o público prefere o **hack principal** a listas. Um item
bem explorado bate dez citados.

---

## 3. Estrutura 7E — copy com duração

De [[Formato 7E - Template de Copy Viral]] (framework validado). O que torna
este framework útil pro software: **cada bloco tem duração alvo**, então dá
pra comparar com a timeline real.

| Bloco | Função | Alvo |
|---|---|---|
| **E1** Antagonismo | contraste entre 2 mundos | 3–5s |
| **E2** Comparação polarizada | "existem 2 tipos de…" | 5–8s |
| **E3** Especificidade | nome + data + credencial | 8–15s |
| **Break** | quebra visual + 2ª promessa | 3–5s |
| **E4** Urgência cultural | hoje vs amanhã | 8–12s |
| **E5** Frase temática + bordão | manifesto | 5–8s |
| **E7** CTA quente | ação com palavra-código | 3–5s |

**Total: 40–60s** (Reel/Short ideal)

> *"Se não cabe nesse molde, algum elemento está faltando."*

---

## 4. Sentido vem da justaposição

De [[Edição estratégica]]:

- **Efeito Kuleshov** — o significado nasce de colocar duas imagens juntas,
  não de cada uma. *"Qual significado eu posso trazer com o que mostrei?"*
- **A pergunta que guia todo corte:** *"Qual o propósito que eu quero que o
  próximo corte tenha?"*
- *"Edição de vídeo é uma conversa de pergunta e resposta."*
- **Pope in the pool** — entregar informação necessária mas chata enquanto
  algo mais interessante ocupa a atenção.
- **B-rolls indiretos** — imagem menos óbvia que complementa, em vez de
  ilustrar literalmente.

**Consequência direta pro produto:** SFX e corte precisam ter **papel**, não
ser aleatórios. É exatamente por isso que o motor de auto-SFX trabalha com
papéis (`cut`, `impact`, `riser`, `bed`) em vez de sortear arquivo.

---

## 5. Ritmo e música

De [[Arquitetura de Emoções]]:

- **Cortar fora da batida gera desconforto** na audiência
- Trilha com **mínimo 120 BPM** para conteúdo de energia
- **Trilha qualifica a audiência** — gênero musical é semiótica; violino
  atrai público diferente de trap
- Escolher o **mood do vídeo primeiro**, a música depois

---

## 6. O que faz compartilhar

De [[Contágio - Padrões de Viralização]] (Berger) — os seis:

**Moeda Social** · **Gatilhos** · **Emoção** · **Público** · **Valor
Prático** · **Histórias**

Aplicado ao CinePRO: o editor compartilha o resultado quando o vídeo dele
fica visivelmente melhor (**moeda social**) e quando o ganho é contável —
"cortei 31% do tempo morto" (**valor prático**).

---

## 7. Detalhes de imagem

De [[Edição estratégica]]:

- **Linha dos olhos** alinhada na superior, regra dos terços. Desnivelamento
  ocular gera desconforto
- **Contraste alto**, principalmente em lettering
- Mirar o **Sistema 1** (rápido, intuitivo — Kahneman), não o Sistema 2
- **Piscar** ([[Ciência por trás da edição de vídeo]]): frequência alta
  transmite insegurança. Na hora da oferta, olhos abertos = autoridade

---

## 8. Como isto vira produto

Mapeamento direto — cada princípio acima já é, ou pode virar, uma função:

| Princípio | No CinePRO | Estado |
|---|---|---|
| SFX com papel (Kuleshov) | motor de auto-SFX com `cut`/`impact`/`riser`/`bed` | ✅ feito (ADR-008) |
| Não repetir a mesma quebra | pool de variação + `minGapSameFile` | ✅ feito |
| Riser resolve no impacto | papel `riser` termina onde o impacto começa | ✅ feito |
| Densidade por gênero | `cutEvery` — Tutorial pontua a cada 3 cortes | ✅ feito |
| Tempo morto derruba retenção | **AutoEdit** — remove silêncio | 🔨 em construção |
| **Ciclo de 2s/5s** | **Diagnóstico de retenção**: apontar trechos sem quebra de padrão | 💡 proposto |
| **Estrutura 7E** | marcar blocos na timeline e avisar quando fogem do alvo | 💡 proposto |
| **Cortar na batida** | detectar BPM e alinhar cortes/SFX à grade | 💡 proposto |
| Hooks validados | reconhecer frase de destaque usando as fórmulas do vault | 💡 proposto |

### A feature que este documento revela

**Diagnóstico de retenção** é o insight mais forte daqui, e ninguém no
mercado brasileiro faz: o software varre a timeline e devolve

> *"0:34 → 0:47 sem quebra de padrão (13s). No vertical o limite é 2s."*

É mensurável, objetivo, e ataca o eixo que o cliente mais sente: alcance.
Diferente de "colocar efeito bonito", é **consultoria automatizada** — e usa
exatamente o conhecimento que o Thales já validou, que nenhum concorrente
tem.

---

## Fontes no vault

`02_Areas/Vídeo & Produção/` → [[Ciência por trás da edição de vídeo]] ·
[[Edição estratégica]] · [[Arquitetura de Emoções]] · [[Storietelling]]

`02_Areas/Marketing & Vendas/` → [[Formato 7E - Template de Copy Viral]] ·
[[Hook e Ganchos - 2025]] · [[Contágio - Padrões de Viralização]]

`04_Archives/` → [[Vídeo Virais de Elias Maman]] (12 vídeos, +300k views cada)

---

# Parte II — Base científica

> **Como ler esta parte:** o vault manda *"não inventar, seguir o que já deu
> certo"* — e também diz que, faltando algo, é pra **complementar, não
> substituir**. É o que esta seção faz. Nada aqui substitui os frameworks
> validados da Parte I; o que ela traz é o **mecanismo** por trás deles, o
> que permite decidir em situações que a prática ainda não cobriu.
>
> Todas as fontes foram verificadas. Onde a evidência é fraca, está dito.

---

## 1. Por que o corte prende: Teoria da Segmentação de Eventos

O cérebro fatia experiência contínua em **eventos** automaticamente, e isso
não é escolha — é parte do processamento perceptual. A segmentação otimiza a
atenção e organiza a experiência na memória.

O mecanismo: o cérebro mantém um **modelo preditivo** do que vem a seguir.
Quando o modelo erra, o **erro de predição** dispara um deslocamento
transitório de atenção pra atualizar o modelo e codificar o novo evento.

> **Um corte é uma descontinuidade que força o cérebro a atualizar o modelo.**
> É literalmente isso que "comprar atenção" significa em termos neurais.

Estudos de fMRI mostram regiões corticais reagindo às descontinuidades
introduzidas por cortes de filme.

**O que isso muda na prática:** confirma a Parte I e adiciona uma condição
que a intuição não dizia — o corte precisa gerar **erro de predição**. Corte
previsível (sempre o mesmo tipo, no mesmo ritmo) para de disparar o mecanismo.
É a base neural da regra *"não repita a mesma quebra de padrão"*.

**Fontes:** [Magliano & Zacks, *Cognitive Science* (2011)](https://onlinelibrary.wiley.com/doi/10.1111/j.1551-6709.2011.01202.x) ·
[Individual differences in neural event segmentation, *Cerebral Cortex* (2023)](https://academic.oup.com/cercor/article/33/13/8164/7093068) ·
[Estudo EEG sobre edição e segmentação (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8586935/)

---

## 2. ⚠️ Correção: o "8 segundos" é estatística fabricada

A Parte I registra *"o ciclo de atenção humana está dentro de 8 segundos,
enquanto o de um peixinho dourado tem até 9 segundos"*. **Esse dado é falso.**

Origem: um relatório da **Microsoft Canadá (2015)** que reproduziu um número
da empresa **Statistic Brain** — que nunca apresentou fonte. A BBC investigou,
não obteve sustentação, e pesquisadores de atenção classificaram como
inverídico. A Microsoft tirou o relatório do ar. A parte do peixinho também é
falsa: há milhares de estudos mostrando que peixes retêm informação por
semanas e até anos.

**O que NÃO muda:** os números operacionais (recomprar a cada ~5s no
horizontal, ~2s no vertical) vieram da **sua prática**, não desse estudo. Como
heurística de ofício, seguem valendo — e o motor de diagnóstico usa eles.

**O que muda:** parar de vender isso como "ciência do cérebro". Se um cliente
ou concorrente checar, o argumento cai — e leva junto a credibilidade do
resto, que é sólido. O enquadramento correto é: *"na prática, vídeo vertical
exige quebra a cada ~2s"* — afirmação de ofício, verificável no gráfico de
retenção dele.

**Fontes:** [Northwell Health — o mito explicado](https://thewell.northwell.edu/brain-nerve-health/attention-span-goldfish-myth) ·
[Forbes — capacidade de atenção sustentada](https://www.forbes.com/sites/shanesnow/2023/01/16/science-shows-humans-have-massive-capacity-for-sustained-attention-and-storytelling-unlocks-it/)

---

## 3. Duração: o dado de maior amostra que existe

Guo, Kim & Rubin analisaram **6,9 milhões de sessões** de vídeo no edX.
Achado principal: **a duração foi o indicador mais forte de engajamento** —
mais que qualquer escolha de produção.

| Duração | Comportamento |
|---|---|
| **≤ 6 min** | assistem quase até o fim |
| **> 9 min** | raramente chegam ao fim |

Também acharam: vídeo de **talking head informal** engaja mais que produção
formal.

**O que isso muda:** dá um limite objetivo pra conteúdo educacional, e valida
o formato que o editor já usa. É o dado mais defensável pra usar em copy —
grande amostra, publicado em conferência (ACM L@S).

**Fonte:** [Guo, Kim & Rubin, *ACM Learning@Scale* (2014)](https://dl.acm.org/doi/10.1145/2556325.2566239) ·
[PDF](https://learningatscale.acm.org/las2014/talks/paper_philip_guo2.pdf)

---

## 4. Curiosidade é privação, não interesse

Loewenstein descreve a curiosidade como **lacuna de informação** — uma forma
de *privação cognitiva*: sabemos que existe algo que não sabemos, e queremos
saber.

Duas condições fazem a lacuna funcionar:

1. Precisa ser **específica e saliente** — vaga não gera privação
2. A resposta precisa parecer **alcançável** — a intensidade segue um **U
   invertido**: incerteza baixa demais não move, alta demais desiste

**O que isso muda:** dá o mecanismo por trás do *"Curiosidade > Interesse >
Retenção"* da Parte I, e explica por que gancho vago não funciona. Também
explica o U invertido na prática: *"o segredo que ninguém conta"* (vago
demais) rende menos que *"por que seu Reels morre aos 3 segundos"*
(específico, alcançável).

**Fonte:** [Loewenstein, *Psychological Bulletin* 116(1) (1994)](https://www.cmu.edu/dietrich/sds/docs/golman/Information-Gap%20Theory%202016.pdf)

---

## 5. Edição sincroniza cérebros — mas nem toda edição

Hasson mediu, por fMRI, a **correlação entre indivíduos** (ISC) assistindo ao
mesmo filme. Alguns filmes produzem controle considerável sobre a atividade
cerebral e o movimento ocular dos espectadores.

O achado que importa: **isso não vale pra todo material.** O grau de controle
varia conforme conteúdo, **edição** e direção.

**O que isso muda:** é a evidência mais direta de que *"edição conduz"* — a
Arquitetura de Emoções da Parte I — não é metáfora. E o corolário é
desconfortável: material mal editado **não** sincroniza, ou seja, o mesmo
conteúdo com edição pior produz espectadores dispersos.

**Fonte:** [Hasson et al., *Projections* 2(1) (2008) — PDF](https://www.motionpictures.org/wp-content/uploads/2013/01/Hasson-etal_NeuroCinematics2008.pdf)

---

## 6. O que fica na memória: pico e fim

Kahneman (sobre trabalho de Fredrickson) descreve a **regra do pico-fim**: a
avaliação retrospectiva de uma experiência é dominada pelo **momento de maior
intensidade** e pelo **final** — não pela média nem pela duração.

O fenômeno associado é a **negligência de duração**: o comprimento da
experiência quase não influencia a avaliação.

**O que isso muda — e é o achado mais acionável desta pesquisa:**

> O diagnóstico hoje trata todos os trechos igual. Mas um vão de retenção
> **no final** custa mais caro que no meio, e um vídeo **sem pico** é
> esquecido mesmo tendo ritmo bom.

Duas verificações novas que isso justifica:
1. **Peso maior pra problemas no terço final** — é o que fica na memória
2. **Detecção de pico** — vídeo com ritmo uniforme e nenhum momento de
   intensidade destacada não é lembrado

**Fontes:** [Nielsen Norman Group — Peak-End Rule](https://www.nngroup.com/articles/peak-end-rule/) ·
[The Decision Lab](https://thedecisionlab.com/biases/peak-end-rule)

---

## 7. Contrapeso: cortar mais nem sempre é melhor

Um estudo publicado em *Neuroscience* indica que audiovisual **caótico e
rápido aumenta o escopo atencional mas reduz o processamento consciente**.

⚠️ **Ressalva de honestidade:** avaliei este pelo título e resumo, não pelo
texto completo. Trate como direção de leitura, não como conclusão fechada.

**Por que registro assim mesmo:** é o único contrapeso que achei ao viés de
"cortar mais é sempre melhor", e ele coincide com uma decisão que já tomamos
por outro caminho — a densidade por gênero (`cutEvery`), onde Tutorial e
Documentário pontuam menos. Se o mecanismo se confirmar, ritmo alto demais
aumenta a atenção **superficial** e reduz a **compreensão** — exatamente o
oposto do que um tutorial precisa.

**Fonte:** [*Neuroscience* (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0306452218306882)

---

## Impacto no produto — resumo

| Achado | Consequência | Estado |
|---|---|---|
| Segmentação de eventos | corte precisa gerar erro de predição → não repetir a mesma quebra | ✅ já no motor |
| Mito dos 8s | mudar o discurso, manter o número operacional | 📝 comunicação |
| Teto de 6 min | flag de duração pra conteúdo educacional | 💡 proposto |
| Lacuna de informação | gancho precisa ser específico e alcançável | 💡 caça-gancho |
| ISC / neurocinema | edição ruim dispersa — argumento de venda defensável | 📝 copy |
| **Pico-fim** | **peso maior no terço final + detectar ausência de pico** | 💡 **próximo** |
| Ritmo alto reduz compreensão | densidade por gênero está certa | ✅ já no motor |
