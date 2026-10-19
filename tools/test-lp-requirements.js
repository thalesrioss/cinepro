#!/usr/bin/env node
// BL-0008: os requisitos que a LP promete batem com o que o produto cumpre.
// Premiere mínimo vem do CSXS/manifest.xml (Host PPRO); macOS mínimo vem da
// versão do Electron do desktop-app. Rodar: node tools/test-lp-requirements.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Premiere 15.x = 2021, 16.x = 2022 ... 25.x = 2025 (versão + 2006).
function premiereYear(major) { return major + 2006; }

// macOS mínimo por versão do Electron (Chromium larga versões do macOS).
// 23-32: 10.15; 33+: 11. Fonte: notas de release do Electron.
function macosMinForElectron(major) {
  if (major >= 33) return '11';
  if (major >= 23) return '10.15';
  return '10.13';
}

let ok = 0, fail = 0;
function check(name, fn) {
  try { fn(); ok++; console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FALHA ' + name + ': ' + e.message); }
}

check('premiereYear/macosMinForElectron', () => {
  assert.strictEqual(premiereYear(15), 2021);
  assert.strictEqual(premiereYear(13), 2019);
  assert.strictEqual(macosMinForElectron(31), '10.15');
  assert.strictEqual(macosMinForElectron(33), '11');
});

const manifest = read('CSXS/manifest.xml');
const hostMatch = manifest.match(/<Host\s+Name="PPRO"\s+Version="\[(\d+)\./);
const pkg = JSON.parse(read('desktop-app/package.json'));
const electronSpec = (pkg.devDependencies && pkg.devDependencies.electron) ||
  (pkg.dependencies && pkg.dependencies.electron) || '';
const electronMajor = parseInt(electronSpec.replace(/^[^\d]*/, ''), 10);

const lpFiles = ['landing-page/index.html', 'landing-page/js/install-guide.js'];
const lp = lpFiles.map(read).join('\n');
const html = read('landing-page/index.html');

check('manifest declara Host PPRO e package.json declara electron', () => {
  assert.ok(hostMatch, 'Host PPRO não achado em CSXS/manifest.xml');
  assert.ok(electronMajor > 0, 'electron não achado em desktop-app/package.json');
});

const year = hostMatch && premiereYear(parseInt(hostMatch[1], 10));
const macos = macosMinForElectron(electronMajor);

check('hero promete o Premiere mínimo do manifest', () => {
  assert.ok(html.includes('Premiere Pro ' + year + '+'), 'falta "Premiere Pro ' + year + '+"');
});

check('nenhum Premiere mais antigo que o manifest aceita', () => {
  const anos = [...lp.matchAll(/Premiere(?: Pro)? (20\d\d)/g)].map((m) => +m[1]);
  const velhos = anos.filter((a) => a < year);
  assert.deepStrictEqual(velhos, [], 'anos abaixo de ' + year + ': ' + velhos.join(', '));
});

check('macOS prometido é o mínimo do Electron ' + electronMajor + ' (' + macos + ')', () => {
  const versoes = [...lp.matchAll(/macOS (\d+(?:\.\d+)?)(?:\+| ou superior)/g)].map((m) => m[1]);
  assert.ok(versoes.length > 0, 'nenhuma versão do macOS na LP');
  const erradas = versoes.filter((v) => v !== macos);
  assert.deepStrictEqual(erradas, [], 'versões diferentes de ' + macos + ': ' + erradas.join(', '));
  const curtas = [...lp.matchAll(/macOS · \.pkg · (\d+(?:\.\d+)?)\+/g)].map((m) => m[1]);
  assert.ok(curtas.every((v) => v === macos), 'install-guide: ' + curtas.join(', '));
});

check('critério do BL-0008: nada de "2019+" nem "10.14"', () => {
  assert.ok(!/2019\+|10\.14/.test(lp));
});

// Enquanto o app do Mac não for universal (BL-0002 sem merge), cada card do
// Mac avisa que é só Apple Silicon. Quando o BL-0002 entrar, tirar a nota da
// LP e esta checagem juntas.
check('cards do Mac avisam Apple Silicon (até BL-0002 entrar)', () => {
  const cards = (html.match(/macOS \d+(?:\.\d+)?\+ · inclui/g) || []).length;
  const notas = (html.match(/Mac com Apple Silicon \(M1 ou mais novo\)/g) || []).length;
  assert.ok(cards >= 2, 'esperava 2 cards do Mac, achei ' + cards);
  assert.ok(notas >= cards + 1, 'notas ' + notas + ' para ' + cards + ' cards + FAQ');
});

console.log('\n' + ok + ' ok, ' + fail + ' falhas');
process.exit(fail ? 1 : 0);
