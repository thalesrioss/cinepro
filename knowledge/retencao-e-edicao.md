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
