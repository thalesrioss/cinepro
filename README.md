# CinePRO

Plugin de efeitos profissionais para Adobe Premiere Pro, com app desktop gerenciador.

## Estrutura

```
CinePRO/
├── index.html, css/, js/, jsx/   ← Plugin CEP (roda dentro do Premiere)
├── icons/                         ← Logo, banner, ícones nativos (.icns, .ico)
├── desktop-app/                   ← App Electron (gerenciador de assinatura)
├── installer/                     ← Scripts pra gerar .pkg (Mac) e .exe (Win)
├── firebase/                      ← Cloud Functions (webhook Ticto)
├── landing-page/                  ← Site público pra distribuir o plugin
└── .github/workflows/             ← CI/CD: builda installers automaticamente
```

## Setup local

```bash
# Plugin CEP roda direto no Premiere após instalar via .pkg
# Pra desenvolver, copie a pasta pra:
~/Library/Application Support/Adobe/CEP/extensions/CinePRO

# Desktop app
cd desktop-app
npm install
npm start

# Cloud Functions (Firebase)
cd firebase/functions
npm install
firebase deploy --only functions
```

## Build dos installers

```bash
# Gera ícones nativos a partir de icons/logo.jpg
./installer/build-icons.sh

# macOS .pkg (plugin + desktop app)
./installer/mac/build.sh 1.0.0

# Windows .exe (precisa rodar no Windows com Inno Setup)
# Veja installer/windows/README.md
```

## Distribuição via GitHub Releases

```bash
# Cria tag e dispara o workflow do GitHub Actions
git tag v1.0.0
git push origin v1.0.0
# Workflow gera .pkg + .exe e cria um Release público
```

## Stack

- **Plugin CEP**: HTML/CSS/JS + ExtendScript (`.jsx`)
- **Desktop App**: Electron 31
- **Backend**: Firebase Auth + Firestore + Cloud Functions (Node 22)
- **Pagamento**: Ticto (webhook v2)
- **Storage de efeitos**: Google Drive (lazy load via Drive API v3)

## Licença

Proprietário © CinePRO.
