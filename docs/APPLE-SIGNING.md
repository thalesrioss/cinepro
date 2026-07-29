# Assinatura Apple — acabar com o aviso de segurança

Guia para tirar o "susto" que o usuário leva ao instalar o CinePRO no macOS.

Hoje o app é assinado **ad-hoc** (`codesign --sign -`), que é uma assinatura
sem identidade. O macOS aceita, mas mostra aviso. Com Developer ID +
notarização, o instalador **abre direto**, sem alerta nenhum.

> **Contexto:** foi uma assinatura ad-hoc CORROMPIDA que gerou o "Malware
> Bloqueado" da v1.0.1. Isso já está corrigido desde a v1.0.2 — o que este
> guia resolve é diferente: o aviso de "desenvolvedor não identificado" que
> aparece mesmo com tudo funcionando.

---

## O que muda para o usuário

| | Hoje (ad-hoc) | Com Developer ID + notarização |
|---|---|---|
| Duplo clique no `.pkg` | aviso; precisa botão direito → Abrir | **abre direto** |
| Texto do alerta | "não foi possível verificar o desenvolvedor" | nenhum |
| Confiança percebida | baixa | de software pago |

---

## Parte 1 — Conta (só você pode fazer)

### 1.1 Escolher o tipo de conta

| | Individual | Organização |
|---|---|---|
| Custo | US$ 99/ano | US$ 99/ano |
| Exige | Apple ID + documento | **D-U-N-S** + CNPJ |
| Prazo | ~24–48h | dias a semanas (D-U-N-S demora) |
| Nome exibido | **Thales Rios** | CinePRO (nome da empresa) |

**Recomendação: Individual.** O D-U-N-S atrasa o lançamento e o ganho é
cosmético — o usuário vê seu nome no lugar do nome da marca, o que é comum
e não gera desconfiança. Dá pra migrar pra Organização depois.

### 1.2 Inscrição

1. https://developer.apple.com/programs/enroll
2. Entre com o Apple ID que você quer usar **permanentemente** (trocar depois
   dá trabalho — os certificados ficam atrelados a ele)
3. Ative a verificação em duas etapas se ainda não tiver
4. Pague os US$ 99 e aguarde a aprovação por e-mail

### 1.3 Anotar o Team ID

Depois de aprovado: https://developer.apple.com/account → **Membership**.
Anote o **Team ID** (10 caracteres, algo como `A1B2C3D4E5`).

---

## Parte 2 — Certificados (só você pode fazer)

São **dois** certificados, e os dois são necessários. Não confunda com os de
App Store — nós distribuímos fora dela.

| Certificado | Assina |
|---|---|
| **Developer ID Application** | o `CinePRO.app` |
| **Developer ID Installer** | o `CinePRO.pkg` |

### Caminho mais fácil (Xcode)

1. Instale o Xcode (App Store, gratuito)
2. Xcode → Settings → **Accounts** → adicione seu Apple ID
3. Selecione o time → **Manage Certificates…**
4. Botão **+** → crie **Developer ID Application**
5. Botão **+** de novo → crie **Developer ID Installer**

### Conferir se entraram

```bash
security find-identity -v -p codesigning
```

Deve listar as duas linhas com `Developer ID Application: ...` e
`Developer ID Installer: ...`.

---

## Parte 3 — Senha para notarização (só você pode fazer)

A notarização é o passo em que a Apple analisa o binário e emite um
"visto". Precisa de uma senha específica de app — **nunca** a senha da sua
conta Apple.

1. https://appleid.apple.com → **Sign-In and Security**
2. **App-Specific Passwords** → gerar uma nova
3. Nomeie algo como `CinePRO CI`
4. Guarde a senha gerada (formato `abcd-efgh-ijkl-mnop`)

---

## Parte 4 — Levar para o CI (você exporta, eu ligo)

O build roda em `macos-latest` no GitHub Actions, então os certificados
precisam chegar lá.

### 4.1 Exportar os certificados

No **Acesso às Chaves** (Keychain Access):

1. Categoria **Meus certificados**
2. Selecione os **dois** certificados Developer ID (Cmd+clique)
3. Botão direito → **Exportar 2 itens…** → formato `.p12`
4. Defina uma senha forte para o arquivo (você vai precisar dela)

### 4.2 Converter para base64

```bash
base64 -i certificados.p12 | pbcopy
```

Isso copia o conteúdo para a área de transferência.

### 4.3 Criar os secrets no GitHub

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Conteúdo |
|---|---|
| `MACOS_CERT_P12` | o base64 que você copiou |
| `MACOS_CERT_PASSWORD` | a senha do `.p12` |
| `APPLE_TEAM_ID` | o Team ID de 10 caracteres |
| `APPLE_ID` | o e-mail do seu Apple ID |
| `APPLE_APP_PASSWORD` | a senha específica de app (Parte 3) |

> **Importante:** cole esses valores **direto na interface do GitHub**. Não
> mande por chat, não coloque em arquivo do repositório e não me passe —
> quem tem o `.p12` e a senha consegue assinar software no seu nome.

### 4.4 Me avisar

Quando os cinco secrets existirem, eu ajusto o `build.sh` e o workflow para:

- assinar o `.app` com **Developer ID Application** + hardened runtime +
  timestamp
- assinar o `.pkg` com **Developer ID Installer** (`productsign`)
- enviar para notarização (`xcrun notarytool submit --wait`)
- grampear o visto no instalador (`xcrun stapler staple`)

Também preciso habilitar `hardenedRuntime` no electron-builder e adicionar
os entitlements que o Electron exige (JIT e memória executável sem
assinatura) — sem eles o app assinado **não abre**.

---

## Parte 5 — Verificar que funcionou

Depois do primeiro build assinado:

```bash
spctl -a -vvv -t install CinePRO.pkg
```

Resultado esperado: `accepted` e `source=Notarized Developer ID`.

O teste que vale mesmo: baixar o `.pkg` **pelo navegador** (não copiar por
rede local — o alerta só dispara em arquivo com a marca de quarentena) numa
máquina que nunca teve o CinePRO, e dar duplo clique. Tem que abrir sem
aviso.

---

## E o Windows?

É problema separado e **não** resolvido pela conta Apple. O Windows mostra o
alerta do **SmartScreen**, que exige certificado de assinatura de código:

| Tipo | Custo/ano | Efeito |
|---|---|---|
| OV (Organization Validation) | ~US$ 200–300 | reputação é construída com o tempo — o alerta some depois de N downloads |
| EV (Extended Validation) | ~US$ 300–450 | reputação **imediata**, sem alerta desde o primeiro download; exige token físico ou HSM |

Vendedores: Sectigo, DigiCert, SSL.com. Exige CNPJ para validação.

**Sugestão:** resolva o macOS primeiro. Windows tem tolerância maior a
instalador não assinado, e o EV é caro. Vale quando a base justificar.

---

## Custo e prazo, resumidos

| Item | Custo | Prazo |
|---|---|---|
| Apple Developer (Individual) | US$ 99/ano | 24–48h |
| Certificados | grátis (inclusos) | minutos |
| Senha de app | grátis | minutos |
| Ligar no CI (eu) | — | ~2h |
| Notarização por build | grátis | +3 a 10 min no build |

**Total: US$ 99/ano e cerca de dois dias**, quase todo de espera pela Apple.
