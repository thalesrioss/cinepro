# Receitas por Gênero — conhecimento editorial → pesos de conceito

> Cada receita traduz os princípios de `../som-e-mente.md` em PESOS sobre os
> conceitos do manifest (`manifest/concepts.js`). O motor de packs do plugin
> (`js/recipes.js`) é GERADO a partir desta tabela — se mudar aqui, mude lá.
> Peso 3 = espinha dorsal do gênero · 2 = presença forte · 1 = tempero.

## Trailer Cinematográfico
Antecipação-resolução no máximo. Sub-grave pra escala, silêncio antes dos hits.
`impact:3 · riser:3 · deep:2 · epic:2 · whoosh:2 · tense:1 · drone:1`
**Regra de uso:** riser 2-3s antes de cada card de texto; impacto NO frame do
card; 0,5s de respiro antes do hit final.

## Terror / Suspense
O medo mora na cama sonora + silêncio. Jump scare = silêncio → impacto agudo.
`horror:3 · tense:3 · drone:2 · dark(=horror keys):2 · impact:1 · glass:1`
**Regra:** drone constante por baixo; cortar o drone 1s antes do susto.

## Vlog Dinâmico
Leveza + ritmo. Whoosh marca transição de assunto; UI pontua texto na tela.
`whoosh:3 · happy:2 · transition:2 · ui:1 · fast:1`
**Regra:** 1 whoosh por mudança de cenário/assunto, não por corte (satura).

## Reels / TikTok (retenção agressiva)
Sonic hook no segundo 0. Densidade alta, glitch como reset de atenção.
`impact:2 · whoosh:2 · glitch:2 · riser:2 · ui:1 · fast:1`
**Regra:** hook sonoro em 0s; um "reset" (glitch/whoosh) a cada 3-5s;
resolução no CTA final.

## Gaming / Stream Highlights
Energia + humor. Impactos exagerados, risers de clutch, UI de score.
`impact:3 · glitch:2 · riser:2 · ui:2 · fast:1 · sci-fi:1`

## Tutorial / Educacional
O som serve a voz (princípio 5: não competir com 1-4kHz). Pontuação discreta.
`ui:3 · whoosh:2 · transition:1 · gentle:1 · minimal:1`
**Regra:** SFX -12dB abaixo da narração; nunca SFX durante fala importante.

## Corporativo / Institucional
Autoridade sem drama. Graves limpos, transições suaves, zero glitch.
`gentle:2 · modern:2 · whoosh:2 · transition:1 · minimal:1`
(`light` removido: colidia com "lighter"/fogo — falso positivo validado em 2026-07)

## Documentário / Emocional
Camas longas + textura. A emoção vem do espaço, não do hit.
`drone:3 · sad:2 · gentle:2 · nature:1 · deep:1 · epic:1`

---

## Como um agente de IA usa isto
1. Identificar o gênero do projeto (pergunta ou inferência do contexto).
2. Carregar a receita → pesos por conceito.
3. Rankear a biblioteca: score(arquivo) = Σ peso[conceito] × embed[conceito].
4. Diversificar: máx. 2-3 arquivos do mesmo conceito dominante no top-15.
5. Aplicar as "Regras de uso" na hora de posicionar na timeline
   (ver `../som-e-mente.md` §1, §3, §4 pra timing).
