#!/usr/bin/env node
// =============================================================
//  Scripts do instalador do Mac (installer/mac/scripts) — asserções
//
//  Roda só as funções de cinepro-lib.sh, com pgrep/osascript/
//  launchctl falsos e um HOME temporário. Nunca roda o preinstall
//  nem o postinstall de verdade (eles apagam /Applications/CinePRO.app).
//
//  Uso:  node tools/test-mac-installer-scripts.js
// =============================================================

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'installer', 'mac', 'scripts');
const LIB = path.join(SCRIPTS, 'cinepro-lib.sh');

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '  → ' + r); }
  } catch (e) { fail++; console.log('  ✗ ' + name + '  EXCEÇÃO: ' + e.message); }
}
function group(s) { console.log('\n══ ' + s + ' ══'); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cinepro-inst-test-'));
function script(name, body) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
  return p;
}

// pgrep falso: "aberto" nas primeiras N chamadas, depois "fechado".
const PGREP = script('pgrep', `
n=$(cat "$FAKE_DIR/pgrep.n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$FAKE_DIR/pgrep.n"
[ "$n" -le "$FAKE_ABERTO" ] && exit 0 || exit 1`);
// osascript falso: responde pela lista FAKE_BOTOES (um por chamada).
// "Cancelar" imita o erro -128 do osascript; "FALHA" imita sem sessão gráfica.
const OSA = script('osascript', `
n=$(cat "$FAKE_DIR/osa.n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$FAKE_DIR/osa.n"
echo "$@" >> "$FAKE_DIR/osa.args"
b=$(echo "$FAKE_BOTOES" | cut -d, -f$n)
case "$b" in
  Cancelar) echo "execution error: User canceled. (-128)" >&2; exit 1 ;;
  FALHA) exit 1 ;;
  *) echo "button returned:$b" ;;
esac`);
// launchctl falso: anota "asuser <uid> sudo -u <usuário>" e roda só o resto
// (sudo de verdade pediria senha).
const LAUNCHCTL = script('launchctl', `
echo "$1 $2 $3 $4 $5" >> "$FAKE_DIR/launchctl.args"
shift 5; "$@"`);

function run(fnCall, env) {
  const dir = fs.mkdtempSync(path.join(TMP, 'run-'));
  const r = spawnSync('/bin/bash', ['-c', `set -e; . "${LIB}"; ${fnCall}`], {
    env: Object.assign({
      PATH: process.env.PATH,
      FAKE_DIR: dir, CINEPRO_PGREP: PGREP, CINEPRO_OSASCRIPT: OSA,
      CINEPRO_LAUNCHCTL: LAUNCHCTL, CINEPRO_ESPERA: '0',
    }, env),
    encoding: 'utf8',
  });
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return ''; } };
  return {
    code: r.status, out: r.stdout, err: r.stderr,
    alertas: Number(read('osa.n') || 0), osaArgs: read('osa.args'), launchctl: read('launchctl.args'),
  };
}

const ESPERAR = 'cinepro_esperar_premiere_fechar; echo "saiu=$?"';

group('Premiere aberto/fechado: laço do alerta');
t('Premiere fechado: segue sem alerta', () => {
  const r = run(ESPERAR, { FAKE_ABERTO: '0', CINEPRO_EUID: '501' });
  return (r.code === 0 && r.alertas === 0) || JSON.stringify(r);
});
t('aberto, "Tentar de novo" e fecha: 1 alerta, segue (0)', () => {
  const r = run(ESPERAR, { FAKE_ABERTO: '1', FAKE_BOTOES: 'Tentar de novo', CINEPRO_EUID: '501' });
  return (r.code === 0 && r.alertas === 1) || JSON.stringify(r);
});
t('aberto por 3 tentativas: pergunta 3 vezes até fechar', () => {
  const r = run(ESPERAR, { FAKE_ABERTO: '3', FAKE_BOTOES: 'Tentar de novo,Tentar de novo,Tentar de novo', CINEPRO_EUID: '501' });
  return (r.code === 0 && r.alertas === 3) || JSON.stringify(r);
});
t('"Cancelar" na 2ª: cancela (≠0)', () => {
  const r = run('cinepro_esperar_premiere_fechar', { FAKE_ABERTO: '9', FAKE_BOTOES: 'Tentar de novo,Cancelar', CINEPRO_EUID: '501' });
  return (r.code === 1 && r.alertas === 2) || JSON.stringify(r);
});
t('alerta impossível de mostrar: cancela, sem laço infinito', () => {
  const r = run('cinepro_esperar_premiere_fechar', { FAKE_ABERTO: '9', FAKE_BOTOES: 'FALHA', CINEPRO_EUID: '501' });
  return (r.code === 1 && r.alertas === 1) || JSON.stringify(r);
});
t('alerta tem os botões Cancelar e Tentar de novo', () => {
  const r = run(ESPERAR, { FAKE_ABERTO: '1', FAKE_BOTOES: 'Tentar de novo', CINEPRO_EUID: '501' });
  return (/buttons \{"Cancelar", "Tentar de novo"\}/.test(r.osaArgs) && /cancel button "Cancelar"/.test(r.osaArgs)) || r.osaArgs;
});

group('Como root: alerta na sessão do usuário da tela');
const consoleUser = spawnSync('stat', ['-f%Su', '/dev/console'], { encoding: 'utf8' }).stdout.trim();
if (process.platform === 'darwin' && consoleUser && consoleUser !== 'root') {
  const uid = spawnSync('id', ['-u', consoleUser], { encoding: 'utf8' }).stdout.trim();
  t('root usa launchctl asuser <uid> sudo -u <usuário>', () => {
    const r = run(ESPERAR, { FAKE_ABERTO: '1', FAKE_BOTOES: 'Tentar de novo', CINEPRO_EUID: '0' });
    return (r.code === 0 && r.launchctl.trim() === `asuser ${uid} sudo -u ${consoleUser}` && r.alertas === 1) || JSON.stringify(r);
  });
  t('não-root não passa pelo launchctl', () => {
    const r = run(ESPERAR, { FAKE_ABERTO: '1', FAKE_BOTOES: 'Tentar de novo', CINEPRO_EUID: '501' });
    return r.launchctl === '' || r.launchctl;
  });
} else {
  console.log('  - pulado: sem usuário na tela (' + process.platform + ')');
}

group('pgrep de verdade acha o processo do Premiere');
// Binário de verdade numa .app com o mesmo caminho do Premiere 2026 (o nome
// do processo passa de 16 bytes; o pgrep -i ainda casa).
const cc = spawnSync('/bin/bash', ['-c', 'command -v cc'], { encoding: 'utf8' }).stdout.trim();
if (process.platform === 'darwin' && fs.existsSync('/usr/bin/pgrep') && cc) {
  const realmenteAberto = spawnSync('/bin/bash', ['-c', `. "${LIB}"; cinepro_premiere_aberto`]).status === 0;
  if (realmenteAberto) {
    console.log('  - pulado: o Premiere de verdade está aberto nesta máquina');
  } else {
    const macos = path.join(TMP, 'Adobe Premiere Pro 2099', 'Adobe Premiere Pro 2099.app', 'Contents', 'MacOS');
    const frameworks = path.join(macos, '..', 'Frameworks', 'CEPHtmlEngine.app', 'Contents', 'MacOS');
    fs.mkdirSync(macos, { recursive: true });
    fs.mkdirSync(frameworks, { recursive: true });
    const src = path.join(TMP, 'dorme.c');
    fs.writeFileSync(src, '#include <unistd.h>\nint main(){sleep(30);return 0;}\n');
    const bin = path.join(macos, 'Adobe Premiere Pro 2099');
    const cep = path.join(frameworks, 'CEPHtmlEngine');
    spawnSync(cc, ['-o', bin, src]);
    fs.copyFileSync(bin, cep); fs.chmodSync(cep, 0o755);
    const aberto = () => spawnSync('/bin/bash', ['-c', `. "${LIB}"; cinepro_premiere_aberto`]).status;
    const esperar = () => spawnSync('/bin/sleep', ['0.3']);
    t('sem Premiere: fechado', () => aberto() === 1 || 'deu aberto');
    const helper = spawn(cep, [], { stdio: 'ignore' }); esperar();
    t('só o CEPHtmlEngine de dentro do Premiere: fechado', () => aberto() === 1 || 'deu aberto');
    helper.kill();
    const child = spawn(bin, [], { stdio: 'ignore' }); esperar();
    t('Premiere rodando: aberto', () => aberto() === 0 || 'deu fechado');
    child.kill(); esperar();
    t('depois de fechar: fechado de novo', () => aberto() === 1 || 'deu aberto');
  }
} else {
  console.log('  - pulado: não é macOS ou sem cc');
}

group('Cache do CEP: só o do CinePRO');
t('apaga cinepro de todas as versões, mantém as outras extensões', () => {
  const home = fs.mkdtempSync(path.join(TMP, 'home-'));
  const cache = path.join(home, 'Library', 'Caches', 'CSXS', 'cep_cache');
  const nomes = [
    'PPRO_26.0_com.thales.cinepro', 'PPRO_25.6_com.thales.cinepro',
    'AEFT_26.3_com.misterhorse.animationcomposer.browser', 'PPRO_26.0_com.adobe.frameio',
  ];
  nomes.forEach((n) => fs.mkdirSync(path.join(cache, n), { recursive: true }));
  fs.writeFileSync(path.join(home, 'Library', 'Caches', 'CSXS', 'outro.log'), 'x');
  const r = run(`cinepro_limpar_cache "${home}"`, {});
  const sobrou = fs.readdirSync(cache).sort();
  const esperado = ['AEFT_26.3_com.misterhorse.animationcomposer.browser', 'PPRO_26.0_com.adobe.frameio'];
  return (r.code === 0 && JSON.stringify(sobrou) === JSON.stringify(esperado)
    && fs.existsSync(path.join(home, 'Library', 'Caches', 'CSXS', 'outro.log'))) || JSON.stringify(sobrou);
});
t('sem pasta de cache: não falha', () => {
  const home = fs.mkdtempSync(path.join(TMP, 'home-'));
  return run(`cinepro_limpar_cache "${home}"`, {}).code === 0 || 'falhou';
});
t('HOME vazio: não apaga nada fora', () => run('cinepro_limpar_cache ""', {}).code === 0 || 'falhou');

group('Scripts');
['preinstall', 'postinstall', 'cinepro-lib.sh'].forEach((f) => {
  t('bash -n ' + f, () => {
    const r = spawnSync('/bin/bash', ['-n', path.join(SCRIPTS, f)], { encoding: 'utf8' });
    return r.status === 0 || r.stderr;
  });
});
const pre = fs.readFileSync(path.join(SCRIPTS, 'preinstall'), 'utf8');
const post = fs.readFileSync(path.join(SCRIPTS, 'postinstall'), 'utf8');
t('preinstall e postinstall carregam cinepro-lib.sh', () =>
  (/\. "\$\(dirname "\$0"\)\/cinepro-lib\.sh"/.test(pre) && /\. "\$\(dirname "\$0"\)\/cinepro-lib\.sh"/.test(post)) || 'falta o source');
t('preinstall usa o laço de espera', () => /cinepro_esperar_premiere_fechar/.test(pre) || 'não usa');
t('nenhum script apaga a pasta CSXS inteira', () => {
  const ruim = /Caches\/CSXS"|Caches\/CSXS$|CEP_CACHE/m;
  return (!ruim.test(pre) && !ruim.test(post)) || 'achou rm da pasta CSXS';
});
t('scripts executáveis', () =>
  ['preinstall', 'postinstall'].every((f) => (fs.statSync(path.join(SCRIPTS, f)).mode & 0o111) !== 0) || 'sem +x');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + '─'.repeat(52));
console.log((fail ? '✗ ' : '✓ ') + pass + ' passou, ' + fail + ' falhou');
process.exit(fail ? 1 : 0);
