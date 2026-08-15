# Prompt — animação de download do CinePRO

Cole o bloco abaixo no Claude. Ele foi montado com o fluxo real da
landing page (`landing-page/index.html`) e os tokens de `css/tokens.css`.

> **Quando isso vencer:** o painel nativo do Resolve (Lua) ainda não vai no
> instalador — hoje o app instala `CinePRO Import.py`. Quando o painel entrar
> no build, o passo 7 deste prompt e a seção DaVinci da LP mudam juntos.

---

## PROMPT

Você vai construir um explicador animado e interativo de instalação do
CinePRO, pra embutir na landing page e numa página de ajuda.

### O problema que ele resolve

O CinePRO ainda não tem certificado Apple Developer nem reputação no
SmartScreen. Então **todo cliente novo, sem exceção, vê um aviso de
segurança do sistema operacional na primeira execução do instalador.** Hoje
esse aviso chega de surpresa, no momento em que a pessoa acabou de pagar, e
o que ela lê é "não foi possível verificar se contém malware".

O objetivo desta peça não é mostrar o caminho feliz. É **fazer o usuário
reconhecer o aviso antes de encontrá-lo** — pra que, quando aparecer, ele
leia como "é aquilo que o tutorial falou" e não como "baixei um vírus".

Isso inverte a hierarquia de um tutorial de instalação normal: o momento
assustador é o conteúdo principal, não uma nota de rodapé. Trate os passos
tranquilos como respiro e gaste o design no atrito.

### O que construir

Um componente HTML autocontido (HTML + CSS + JS inline, sem nenhuma
dependência externa, sem CDN, sem fontes remotas) com uma sequência de
passos animada que o usuário navega no próprio ritmo.

**Interação obrigatória:** um seletor **macOS / Windows** no topo. O
usuário vê só o caminho do sistema dele — nunca os dois lados ao mesmo
tempo. Detecte o sistema por `navigator.platform` e pré-selecione, mas
deixe trocar manualmente (tem gente que baixa no Mac pra instalar no PC).

Navegação: botões voltar/avançar **e** uma trilha de passos clicável no
topo, mostrando onde a pessoa está. Nada de autoplay que corre sozinho —
quem está travado precisa parar e ler. Permita navegar por teclado
(setas ←/→) e respeite `prefers-reduced-motion` cortando as transições.

### Identidade visual (obrigatório)

Fundo escuro, acento ciano. Use exatamente estes valores:

```
--brand:          #00B8FF   /* acento, foco, progresso */
--brand-bright:   #4DD2FF
--surface-0:      #07090F   /* fundo */
--surface-1:      #0E1218   /* card */
--surface-2:      #161B23   /* chip, header */
--surface-3:      #11161D   /* input */
--text-strong:    #FFFFFF
--text:           #E5E9F0
--text-muted:     #8A95A8
--border-default: rgba(255,255,255,0.10)
--border-brand:   rgba(0,184,255,0.35)
--success:        #22C55E
--warning:        #FFC74D
--danger:         #EF4444
```

Cantos de 8–12px, espaçamento em múltiplos de 4px, tipografia system-ui.
Sóbrio e técnico — é ferramenta de editor profissional, não app de consumo.
Zero emoji na interface final.

Uma exceção deliberada de cor: **as reproduções das telas do sistema
operacional não usam a paleta do CinePRO.** Elas imitam o Gatekeeper do
macOS (cinza claro, cantos arredondados, botão azul do sistema) e o
SmartScreen do Windows (fundo azul-marinho, texto branco). Se elas
parecerem "do CinePRO", o usuário não vai reconhecê-las quando aparecerem
de verdade — e reconhecer é a função inteira da peça.

### Conteúdo exato — os passos

Não invente, não reordene, não simplifique os textos abaixo. São os
rótulos reais que o usuário vai encontrar.

**1. Criar conta (antes de baixar)**
O download fica bloqueado com um cadeado até criar conta. É de graça:
e-mail e senha de no mínimo 6 caracteres. Diga *por que* — é a mesma conta
que vai logar no app depois. Gente que não entende esse passo abandona aqui.

**2. Baixar o instalador**
A página detecta o sistema. macOS: `.pkg`, macOS 10.14+. Windows: `.exe`,
Windows 10+. Os dois com **~540 MB**.
Explique o tamanho na hora: são 500 efeitos já embutidos, pra não esperar
download no meio da edição. Sem essa frase, 540 MB parece bloatware.
Avise que num link lento demora e que a barra parada não é travamento.

**3. O aviso de segurança — o coração da peça**

*macOS:* reproduza o diálogo do Gatekeeper com o texto que a pessoa vai ler
de verdade: **"Apple não pôde verificar se este arquivo contém malware"**.
Deixe-o na tela tempo suficiente pra ser memorizado.
Depois mostre a saída, em três tempos:
  1. Abrir o Terminal (Cmd+Espaço, digitar "Terminal")
  2. Colar exatamente: `xattr -dr com.apple.quarantine ~/Downloads/CinePRO.pkg`
     — em bloco de código, com botão de copiar
  3. Duplo-clique normal no `.pkg`
Explique a causa em uma frase, sem defensiva: o app não tem certificado
Apple Developer ainda ($99/ano, em processo). Ofereça a saída de quem
desconfia: dá pra escanear o `.pkg` no VirusTotal antes.

*Windows:* reproduza a tela azul do SmartScreen com **"O Windows protegeu
seu PC"**. O ponto crítico é que **o botão "Executar mesmo assim" está
escondido** — só aparece depois de clicar em **"Mais informações"**. Anime
exatamente isso: clique em "Mais informações" → o botão surge → clique nele.
É onde as pessoas desistem, porque a tela parece um beco sem saída.
Causa, em uma frase: instalador novo sem reputação acumulada.

**4. Instalar e abrir o CinePRO**
Rodar o instalador, abrir o app, logar com **as mesmas credenciais** do
passo 1. Reforce o "mesmas" — é confusão comum.

**5. Iniciar a avaliação de 3 dias**
Dentro do app, botão "Começar trial". Cadastra cartão, **não paga nada nos
3 dias**, cancelou antes = zero cobrança. Diga isso com todas as letras: o
cartão sem explicação trava a conversão.

**6. Instalar o plugin do Premiere**
Botão "Instalar plugin" no app. **É preciso reiniciar o Premiere.** Depois:
**Janela → Extensões → CinePRO**. Mostre esse caminho de menu na tela —
quem não acha o painel acha que a instalação falhou.

**7. DaVinci Resolve (se for o caso)**
Dois caminhos, e o primeiro não exige instalar nada: buscar no app, clicar
pra baixar e **arrastar a linha direto pra timeline** do Resolve.
Em lote: mandar vários com "→ Resolve", posicionar o playhead e rodar
**Workspace → Scripts → CinePRO Import**. Entram no playhead, em trilha de
áudio livre. O script é instalado pelo app; **precisa reiniciar o Resolve**
pra aparecer no menu. Funciona no Resolve gratuito, não precisa do Studio.

### Movimento

A animação serve pra dirigir o olho, não pra impressionar. Transições de
200–300ms, easing suave. Em cada passo, anime **uma** coisa: o cursor indo
até o botão certo, o diálogo do sistema entrando, o botão escondido
aparecendo. Nada de partícula, parallax ou confete.

Onde há comando de terminal, anime a digitação — mas deixe o texto
selecionável e com botão de copiar. Ninguém vai digitar `xattr -dr
com.apple.quarantine` na mão sem errar.

Marque visualmente os dois passos de reinício (Premiere, Resolve) — são
os dois pontos onde a pessoa acha que quebrou quando na verdade só falta
reabrir.

### Tom

Português do Brasil, direto, de igual pra igual com um editor profissional.
Sem "simplesmente", sem "é só", sem "rapidinho" — quem está travado no
SmartScreen não acha que é só. Sem tom de desculpas pelo certificado: é uma
etapa da empresa, dita de frente e seguida da solução.

### Restrições técnicas

- Um arquivo, autocontido. Sem `fetch`, sem script externo, sem fonte remota.
- Responsivo: precisa funcionar em 375px de largura. As reproduções de tela
  do SO devem rolar dentro de um container próprio (`overflow-x: auto`) —
  a página nunca rola na horizontal.
- Acessível: navegação por teclado, foco visível, contraste AA, os passos
  como lista semântica. Nenhuma informação transmitida só por cor.
- Respeite `prefers-reduced-motion`.

### O que não fazer

- Não mostre os dois sistemas ao mesmo tempo — dobra o ruído pra cada usuário.
- Não esconda o aviso de segurança atrás de um "saiba mais". Ele é o conteúdo.
- Não suavize o texto do erro. Reproduza a frase que a Apple e a Microsoft
  realmente mostram, senão o reconhecimento não acontece.
- Não prometa que o aviso vai sumir numa data. Diga que o certificado está
  em processo.
- Não invente passo que não existe (chave de licença, ativação por e-mail,
  reiniciar o computador).
