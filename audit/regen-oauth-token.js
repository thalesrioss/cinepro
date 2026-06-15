#!/usr/bin/env node
/**
 * CinePRO — Regenera o refresh token OAuth do Google Drive
 *
 * Sobe um servidor local, imprime a URL de consentimento, captura o
 * code no redirect automaticamente, troca por tokens e grava em
 * audit/.oauth-token.json. Depois disso, atualize o secret
 * CINEPRO_OAUTH_TOKEN no GitHub com o conteúdo do arquivo.
 *
 * IMPORTANTE: se o app OAuth estiver em modo "Testing" no console
 * Google, o refresh token EXPIRA EM 7 DIAS. Publique o app em
 * produção (OAuth consent screen → Publish) antes de gerar.
 *
 * Uso: node regen-oauth-token.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');

const CLIENT_FILE = path.join(__dirname, 'oauth-client.json');
const TOKEN_FILE  = path.join(__dirname, '.oauth-token.json');
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const PORT = 53682;

(async function main() {
  if (!fs.existsSync(CLIENT_FILE)) {
    console.error('oauth-client.json não encontrado em audit/.');
    process.exit(1);
  }
  const client = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
  const cfg = client.installed || client.web;
  const redirect = 'http://localhost:' + PORT;
  const oAuth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, redirect);

  const authUrl = oAuth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',          // força refresh_token novo
  });

  console.log('\n=== ABRA ESTA URL NO BROWSER ===\n');
  console.log(authUrl);
  console.log('\nAguardando autorização (timeout 20 min)...');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, redirect);
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (c) {
        res.end('<h2>✓ CinePRO autorizado. Pode fechar esta aba.</h2>');
        server.close();
        resolve(c);
      } else {
        res.end('<h2>Erro: ' + (err || 'sem code') + '</h2>');
        if (err) { server.close(); reject(new Error(err)); }
      }
    });
    server.listen(PORT);
    setTimeout(() => { server.close(); reject(new Error('timeout')); }, 1200000);
  });

  const { tokens } = await oAuth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error('\n⚠️  Google não devolveu refresh_token (já havia consentimento ativo?).');
    console.error('Revogue o acesso em https://myaccount.google.com/permissions e rode de novo.');
    process.exit(1);
  }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log('\n✓ Token novo gravado em', TOKEN_FILE);
  console.log('  refresh_token: presente');
  console.log('\nPróximo passo: atualizar o secret CINEPRO_OAUTH_TOKEN no GitHub com este JSON.');
})().catch(e => { console.error('\n[FATAL]', e.message || e); process.exit(1); });
