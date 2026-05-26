# CinePRO Landing Page

LP estática com detecção automática de SO (Mac/Win) e CTAs de download.

## Deploy

### Opção A — Vercel (recomendado)

1. `npm i -g vercel` (uma vez)
2. `cd landing-page && vercel`
3. Vai te dar uma URL tipo `cinepro.vercel.app`
4. Pra domínio próprio (ex: `cinepro.com`): Vercel dashboard → Settings → Domains

### Opção B — GitHub Pages

1. Subir o projeto pro GitHub
2. Settings → Pages → Source: deploy from branch `main` / pasta `/landing-page`
3. URL fica `seu-usuario.github.io/cinepro/`

### Opção C — Netlify

Mesma coisa do Vercel: `npm i -g netlify-cli && cd landing-page && netlify deploy --prod`

## Antes de publicar

Edite `js/lp.js` e troque os links de download por URLs reais:

```js
var DOWNLOADS = {
  mac:     'https://github.com/SEU_USUARIO/cinepro/releases/latest/download/CinePRO.pkg',
  windows: 'https://github.com/SEU_USUARIO/cinepro/releases/latest/download/CinePRO-Setup.exe',
};
```

Se for usar links do Google Drive ou outro lugar, ponha aqui.
