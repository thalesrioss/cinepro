# Como criar seus templates de legenda

Guia pra você autorar templates próprios que funcionam no motor de legendas
do CinePRO. Você **não precisa do After Effects** — dá pra fazer tudo dentro
do Premiere.

Antes de subir qualquer template, valide:

```bash
node tools/check-mogrt.js "caminho/do/Template.mogrt"
```

---

## A regra que faz tudo funcionar

O CinePRO acha o campo de texto **pelo nome**. Nomeie assim no Essential
Graphics e o template funciona sem nenhuma configuração:

| Linhas do template | Nomes dos campos |
|---|---|
| 1 linha  | `TEXTO 1` |
| 2 linhas | `TEXTO 1`, `TEXTO 2` |
| 3 linhas | `TEXTO 1`, `TEXTO 2`, `TEXTO 3` |

Regras:
- Numeração começa em **1** e não pula (`1, 2, 3` — nunca `1, 3`)
- Sufixo entre colchetes é permitido: `TEXTO 1 [Destaque]`
- O motor quebra o texto no número de linhas do template automaticamente

---

## Caminho A — só Premiere (mais fácil)

Não precisa de After Effects. A animação fica limitada a keyframes, mas pra
legenda (fade, escala, pop) é mais que suficiente.

1. **Nova sequência** no tamanho de entrega (1080×1920 vertical, 1920×1080
   horizontal). O template herda esse formato.
2. **Ferramenta Texto (T)** → clique no programa → digite um texto de exemplo
   (ex: "Linha de exemplo").
3. **Janela → Gráficos Essenciais** → aba **Editar**.
4. Na lista de camadas, selecione a camada de texto. Em **Ações de origem**,
   marque a caixa **"Texto de origem"** — isso publica o campo como editável.
5. **Renomeie o campo pra `TEXTO 1`** (duplo clique no nome). ← passo crítico
6. Estilize: fonte, corpo, cor, contorno (**Traço**), sombra, fundo.
7. Anime: com a camada selecionada, use os cronômetros de **Escala/Opacidade**
   pra criar o pop de entrada (~6 a 10 frames).
8. Para 2 linhas: repita com uma segunda camada de texto → `TEXTO 2`.
9. **Gráficos → Exportar modelo gráfico animado** → destino: uma pasta sua.

Pronto — saiu um `.mogrt`.

---

## Caminho B — After Effects (animação melhor)

Use quando quiser karaokê, distorção, animação por caractere.

1. Composição no tamanho de entrega.
2. Camada de texto com o texto de exemplo.
3. **Janela → Gráficos Essenciais** → defina a comp como **Comp principal**.
4. Arraste a propriedade **Texto de origem** da camada pro painel →
   **renomeie pra `TEXTO 1`**.
5. (Opcional) Arraste também **Cor de preenchimento**, **Tamanho** e
   **Posição** — viram controles ajustáveis pelo editor.
6. Anime com Animadores de Texto (Animar → Escala/Opacidade/Posição).
7. **Exportar modelo gráfico animado** no rodapé do painel.

---

## Armadilhas (as que quebram na mão do cliente)

**Fonte customizada.** Se o template usa uma fonte que o cliente não tem, o
Premiere substitui e o visual quebra. Duas saídas: usar fonte do Adobe Fonts
(sincroniza sozinho) ou converter o texto decorativo em forma. O validador
avisa quando detecta fonte customizada.

**Texto de exemplo longo demais.** Autore com um texto de tamanho realista
(~40 caracteres). Se você autorar com "Oi" e o cliente jogar uma frase longa,
estoura o quadro.

**Responsividade.** No Essential Graphics, use **Responsivo — Design** pra
fixar a caixa de fundo ao texto. Sem isso, o fundo não acompanha frases de
tamanhos diferentes.

**Formato fixo.** Um template feito em 1080×1920 fica errado numa sequência
16:9. Faça as duas versões dos estilos principais.

---

## Onde colocar depois de pronto

1. Suba o `.mogrt` pra pasta de templates no Drive
2. O pipeline diário indexa e espelha pro R2 automaticamente
3. Aparece no plugin sem precisar de release

Estrutura sugerida no Drive (a subpasta vira o agrupamento na interface):

```
Legendas/
  1 linha/
    Pop Amarelo.mogrt
  2 linhas/
    Destaque Branco.mogrt
```

---

## DaVinci Resolve

`.mogrt` **não funciona** no Resolve — não existe conversor. O equivalente é
um **título Fusion**:

1. Na timeline, adicione um **Text+**
2. Estilize (fonte, cor, contorno, sombra)
3. Entre no painel **Fusion**, selecione o nó → botão direito →
   **Macro → Create Macro** → salve
4. Salve em `Fusion/Templates/Edit/Titles/` no diretório de suporte do Resolve
5. Ele aparece na Biblioteca de Efeitos → Títulos

Cada estilo precisa ser autorado **duas vezes** (um `.mogrt` + um título
Fusion). Não tem como escapar disso — são motores de render diferentes.
A lógica de legenda (parsing, timing, quebra de linha) é compartilhada.
