# ADR-009 — Anexo de Segurança e Integridade

**Status:** Proposed — leitura obrigatória antes de aprovar o ADR-009
**Date:** 2026-07-25

---

## 0. A descoberta que muda a recomendação

Investigando pra escrever este anexo, encontrei duas coisas que reordenam o plano:

**(a) Já existe um canal de atualização remota em produção.** O plugin busca
`manifest.json` do jsDelivr a cada abertura (`MANIFEST_URLS` em `js/main.js`).
Ou seja: **mudanças de dados já chegam sem release** — foi assim que o
rebranding de nomes valeu no mesmo dia, sem instalador.

**(b) As URLs de download são construídas a partir do config, não lidas do
manifest** (`assetUrlChain`: `CDN_BASE + id + ext`). Isso é uma propriedade de
segurança boa e não planejada: um manifest adulterado **não** consegue apontar
download pra host arbitrário. O raio de dano dele é pequeno.

A consequência prática: **a maior parte do que o ADR-008 precisa ajustar são
dados, não código** — pesos de receita, janelas de duração, definição de papéis,
dicionário de conceitos. Isso cabe no canal que já existe, **sem criar nenhum
caminho de execução remota de código**.

Por isso este anexo divide o ADR-009 em duas fases com perfis de risco
radicalmente diferentes, e recomenda aprovar **só a Fase 0 agora**.

---

## 1. Fase 0 — OTA de DADOS (risco baixo, recomendada agora)

Estender o canal existente para carregar como **dados versionados** tudo o que
hoje é código só por conveniência:

| Hoje (código) | Vira (dados) |
|---|---|
| `js/recipes.js` — pesos dos 8 packs | `recipes.json` |
| janelas de duração por papel (ADR-008) | `roles.json` |
| dicionário de conceitos | já está no manifest |
| presets de estilo de legenda | `subtitle-presets.json` |

**Por que o risco é baixo:** JSON passa por `JSON.parse` e validação de schema —
não executa. Não há `eval`, não há `<script>`, não há acesso a `fs`. O pior caso
de um arquivo malicioso é *configuração ruim* (pack escolhe som errado), não
código rodando na máquina.

**Proteções obrigatórias mesmo na Fase 0** — o canal atual não tem nenhuma:

1. **Validação de schema estrita** antes de usar. Campo desconhecido → ignora;
   campo obrigatório ausente ou tipo errado → rejeita o arquivo inteiro.
2. **Limites numéricos** (clamp). Peso fora de `0..10`, duração fora de
   `0,05..120s`, contagem fora de `1..200` → rejeita. Isso impede que dado ruim
   vire comportamento destrutivo (ex.: "aplique 100.000 SFX").
3. **Piso embarcado.** Se o remoto falhar validação, usa a cópia local. Nunca
   degrada pra "sem receitas".
4. **Teto de tamanho** (ex. 2MB) pra não travar o painel com resposta gigante.
5. **Sem execução, nunca.** Proibido `eval`, `new Function`, `<script>` gerado a
   partir de conteúdo remoto. Isso precisa ser regra escrita, não disciplina.

**Custo:** ~1 dia. **Cobre:** praticamente todo o ajuste fino do ADR-008.

---

## 2. Fase 1 — OTA de CÓDIGO (risco alto, aprovar depois)

Só necessária quando a *lógica* mudar (função nova, correção de bug de fluxo).

### 2.1 O que está realmente em jogo

O manifest do plugin tem `--enable-nodejs`, e o painel já usa
`window.require('fs')` em 6 pontos. Portanto **um payload malicioso herda poder
de usuário completo**: ler/escrever qualquer arquivo do usuário, rede via Node,
executar processos. Não é "um bug no plugin" — é controle da conta.

**Consequência honesta: CSP não contém isso.** `connect-src` restringe `fetch`,
mas o módulo `http` do Node passa por fora. CSP vale como defesa em profundidade
contra injeção acidental; **não** vale como contenção de payload malicioso.

**Portanto existe UMA fronteira de segurança de verdade: a verificação de
assinatura.** Todo o resto é mitigação secundária. Prefiro dizer isso claramente
do que empilhar controles que dão falsa sensação de segurança.

### 2.2 Onde o verificador precisa morar (decisão crítica)

O plugin fica em `/Library/Application Support/Adobe/CEP/extensions/CinePRO`,
que é **propriedade do root**. Isso é uma vantagem de segurança:

> Malware rodando como o usuário **não pode** substituir a casca — logo não pode
> arrancar a verificação de assinatura nem trocar a chave pública.

Isso tem duas implicações que precisam ser respeitadas:

1. **Verificador + chave pública ficam na casca instalada (root), nunca no
   payload.** Se o verificador viesse no payload, ele se auto-aprovaria.
2. **A Option D do ADR-009 (instalar na pasta CEP por usuário) destruiria este
   modelo** — a casca ficaria escrevível pelo usuário e a assinatura perderia
   sentido. Retiro a recomendação de considerá-la enquanto houver OTA de código.
   Pelo mesmo motivo, a Option B (dar `chown` na pasta em `/Library`) está
   descartada, não só desaconselhada.

### 2.3 Modelo de ameaças e mitigações

| # | Ameaça | Mitigação | Fase |
|---|---|---|---|
| 1 | **Repo ou token de release comprometido** publica payload malicioso | Assinatura Ed25519 com chave privada **fora do repo e fora do CI** | 1 — bloqueante |
| 2 | **CI comprometido** (action de terceiro, workflow malicioso) | Assinatura feita **localmente**, nunca em GitHub Actions. Se a chave estiver em Secrets, comprometer o CI = comprometer a assinatura, e o controle vira teatro | 1 — bloqueante |
| 3 | **MITM de rede / DNS** | HTTPS + assinatura torna irrelevante | 1 |
| 4 | **CDN comprometida** (jsDelivr, R2) | idem — assinatura cobre | 1 |
| 5 | **Malware local escreve no diretório de payload** (é escrevível pelo usuário!) | **Verificar assinatura + hash de TODOS os arquivos a cada carga**, não só no download. SHA-256 de 300KB ≈ milissegundos | 1 — bloqueante |
| 6 | **Downgrade** — serve payload antigo, assinado, com falha conhecida | Contador de versão monotônico persistido; nunca aceitar versão menor que a marca d'água | 1 |
| 7 | **Freeze** — CDN/atacante te prende numa versão velha pra sempre | `notAfter` dentro do manifest assinado; manifest vencido gera aviso e força recheck | 1 |
| 8 | **Path traversal** no manifest de payload (`../../hostscript.jsx`) | Rejeitar `..`, caminho absoluto, barra invertida, byte nulo e symlink | 1 — bloqueante |
| 9 | **Módulo nativo** (`.node`, `.dylib`) = execução de código nativo | Allowlist estrita de extensão: `.js .css .jsx .json .svg .png`. Negar explicitamente `.node .dylib .so .dll .sh .command .zxp` | 1 — bloqueante |
| 10 | **Chave privada vazada** | Chave gerada e guardada por você, com passphrase, fora do repo; casca confia num **conjunto** de chaves pra permitir rotação sem quebrar a base | 1 |
| 11 | **Payload assinado mas ruim** (erro nosso, não ataque) | Canário (você + Felipe antes da base) + rollback automático | 1 |
| 12 | **Roubo de credencial** (token Firebase no localStorage) | Coberto por 1–5. CSP ajuda pouco (Node passa por fora) — não contar com ela | 1 |

### 2.4 Escolha de criptografia (restrição real do ambiente)

Suportamos CSXS 11+ (Premiere 2021+). A versão do Node embutida **varia por
versão do CEP**, e `crypto.verify` com Ed25519 exige Node 12+. Depender disso é
frágil entre CEP 11/12/13.

**Decisão:** verificador **Ed25519 em JS puro** (~8KB) embarcado na casca. Zero
dependência da versão do Node do CEP. Para SHA-256, `require('crypto')` já
funciona em todas as versões alvo.

**Sobre a chave privada:** você gera e guarda. Eu escrevo a ferramenta de
assinatura (`npm run sign-payload`), mas **não vou gerar, pedir, manusear nem
armazenar a chave** — ela não deve passar por chat, repo ou CI. Guarde com
passphrase (Keychain do macOS ou arquivo cifrado). Se ela vazar, todo o modelo
cai.

---

## 3. "Sem que nada se quebre" — modos de falha e proteção

Segurança é metade; a outra é o plugin nunca ficar inutilizável.

| # | Falha | Proteção |
|---|---|---|
| 1 | Download corrompido / incompleto | Hash não casa → descarta, mantém versão atual |
| 2 | Payload válido mas com erro de JS → painel branco | **Farol de saúde**: grava `pending: V` antes de carregar; app saudável grava `healthy: V`. 2 tentativas sem sucesso → reverte e fixa a anterior |
| 3 | `hostscript.jsx` novo com erro de sintaxe | Após `$.evalFile`, chamar `pingHost()` esperando token conhecido. Falhou → payload marcado insalubre |
| 4 | Payload exige API que a casca não tem | `minShell`/`maxShell` no manifest assinado; incompatível é recusado |
| 5 | JS e JSX fora de sincronia | Payload é **atômico**: todos os arquivos ou nenhum, versionados juntos |
| 6 | Sem internet | Mantém payload atual; piso é a cópia embarcada |
| 7 | Disco cheio | Nunca apagar a versão atual antes de verificar **e** ativar a nova |
| 8 | Crash no meio da gravação | Staging em diretório temporário + troca de um ponteiro pequeno (`active.json`); validar na carga |
| 9 | Premiere e After Effects abertos juntos → corrida | Lockfile com PID e expiração; nunca alterar o diretório ativo, sempre criar novo |
| 10 | Relógio do usuário errado quebra o `notAfter` | Tolerância generosa; só avisa, não bloqueia, a menos que muito vencido |
| 11 | Duas versões ruins seguidas | Cai pro embarcado e **desliga OTA** até reset manual |
| 12 | Cache do CEP servindo casca antiga | Caminho do payload contém a versão (cache-busting automático); manter `?v=` só na casca |

**Regra de ouro:** a cópia embarcada na extensão precisa **sempre** abrir e
logar. Ela é o piso. Se todo OTA falhar, o cliente volta pra ela — nunca pra tela
branca.

---

## 4. Riscos residuais (não elimináveis)

Prefiro deixar explícito o que **não** fica resolvido:

1. **Se sua chave de assinatura vazar**, o atacante publica código pra toda a
   base. Mitigação é operacional (chave offline, passphrase, rotação), não técnica.
2. **Você assinar um build ruim** — a assinatura garante origem, não qualidade.
   Só canário e teste cobrem.
3. **Malware já na máquina do usuário** pode atacar o app Electron ou os projetos
   direto, sem passar pelo plugin. O OTA não melhora nem piora isso.
4. **Mudança de comportamento do CEP pela Adobe** pode quebrar `$.evalFile` ou o
   carregamento por caminho absoluto. Precisa de teste real em cada versão de
   Premiere suportada — **não consigo validar isso sem o Premiere aberto**.
5. **Revogação é só pra frente.** `minVersion` impede aceitar versões antigas
   daqui em diante, mas quem já está com payload ruim precisa abrir o painel pra
   receber a correção.

---

## 5. Recomendação

**Aprove a Fase 0 agora. Não aprove a Fase 1 ainda.**

Motivo: a Fase 0 entrega quase toda a velocidade de iteração que você quer (o
ajuste fino do ADR-008 é dado, não código), reaproveita um canal que **já está em
produção e testado**, e **não cria nenhum caminho de execução remota de código**.
Melhora até a segurança atual, porque adiciona validação de schema num canal que
hoje confia cegamente no que vem da rede.

A Fase 1 vale a pena, mas o preço de fazer certo é: assinatura Ed25519 com chave
fora do CI, verificação a cada carga, allowlist de caminho e extensão, farol de
saúde e rollback. São ~3 dias e uma responsabilidade operacional permanente
(guardar chave, assinar release, rodar canário). Faz sentido assumir isso quando
a base justificar — não antes.

### Ordem sugerida

1. [ ] **Fase 0** — mover receitas/papéis pra JSON com schema, limites e piso
       embarcado (~1 dia) → destrava o ADR-008
2. [ ] Implementar o ADR-008 sobre esse canal, iterando sem release
3. [ ] Medir: quantas vezes precisei mexer em *código* do plugin, não em dados?
4. [ ] Se a resposta justificar, aprovar a **Fase 1** com os itens bloqueantes
       da §2.3 como pré-requisito de merge, não de "depois"
