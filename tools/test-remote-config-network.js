#!/usr/bin/env node
// =============================================================
//  Config remota — caminhos de FALHA de rede (Fase 0 do ADR-009)
//
//  Garante a promessa do "nada se quebre": qualquer falha do canal
//  remoto (CDN fora, HTML de captive portal, JSON truncado, resposta
//  gigante) tem que cair na cópia embarcada, nunca deixar o plugin sem
//  receitas. Usa XHR falso — não toca a rede.
//
//  Uso:  node tools/test-remote-config-network.js
// =============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
// XHR falso controlável
function mockXHR(responder){
  global.XMLHttpRequest = function(){
    this.open=(m,u)=>{this._u=u;};
    this.send=()=>{ const r=responder(this._u);
      setTimeout(()=>{ if(r==='ERR'){this.onerror&&this.onerror();}
        else {this.status=r.status||200; this.responseText=r.body; this.onload&&this.onload();} },0); };
  };
}
function run(name, responder, expect){
  return new Promise(res=>{
    delete require.cache[require.resolve(path.join(ROOT,'js/remote-config.js'))];
    delete require.cache[require.resolve(path.join(ROOT,'js/recipes.js'))];
    global.window=global; mockXHR(responder);
    require(path.join(ROOT,'js/recipes.js'));
    const RC=require(path.join(ROOT,'js/remote-config.js'));
    RC.load([{name:'whoosh'},{name:'transition'},{name:'impact'},{name:'drop'},{name:'riser'},{name:'drone'},{name:'deep'}],cfg=>{
      const got=cfg.source.recipes+'/'+cfg.source.roles;
      const ok=got===expect && cfg.recipes.length>0 && Object.keys(cfg.roles).length>0;
      console.log((ok?'  ✓ ':'  ✗ ')+name+'  → source='+got+'  receitas='+cfg.recipes.length+'  papéis='+Object.keys(cfg.roles).length
        +(cfg.warnings.length?'  avisos='+cfg.warnings.length:''));
      if(!ok) console.log('       esperava '+expect+(cfg.warnings.length?'  ['+cfg.warnings[0]+']':''));
      res(ok);
    });
  });
}
const GOOD_R=fs.readFileSync(ROOT+'/data/recipes.json','utf8');
const GOOD_O=fs.readFileSync(ROOT+'/data/roles.json','utf8');
const pick=(u,r,o)=>/recipes/.test(u)?r:o;

(async()=>{
  console.log('══ CAMINHOS DE FALHA (garantia: sempre utilizável) ══');
  const rs=[];
  rs.push(await run('CDN ok → usa remoto',            u=>({body:pick(u,GOOD_R,GOOD_O)}), 'remote/remote'));
  rs.push(await run('CDN 500 → cai no embarcado',      u=>({status:500,body:''}),          'embedded/embedded'));
  rs.push(await run('CDN offline → embarcado',         u=>'ERR',                           'embedded/embedded'));
  rs.push(await run('CDN devolve HTML (captive)',      u=>({body:'<html>login</html>'}),   'embedded/embedded'));
  rs.push(await run('JSON corrompido → embarcado',     u=>({body:'{"schemaVer'}),          'embedded/embedded'));
  rs.push(await run('schema inválido → embarcado',     u=>({body:'{"schemaVersion":99}'}), 'embedded/embedded'));
  rs.push(await run('resposta 5MB → embarcado',        u=>({body:'{"a":"'+'x'.repeat(5*1024*1024)+'"}'}), 'embedded/embedded'));
  rs.push(await run('só recipes falha → misto',        u=>/recipes/.test(u)?({status:500,body:''}):({body:GOOD_O}), 'embedded/remote'));
  console.log('\n'+(rs.every(Boolean)?'✓ TODOS os caminhos de falha permanecem utilizáveis':'✗ ALGUM caminho quebrou'));
  process.exit(rs.every(Boolean)?0:1);
})();
