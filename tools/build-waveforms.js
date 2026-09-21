#!/usr/bin/env node
// =============================================================
//  Gera PNGs de waveform pros efeitos — o mesmo desenho do
//  plugin do Premiere (js/main.js, drawWaveformFromAmps), só que
//  como arquivo, pra um ambiente que não desenha: o Lua do Resolve.
//
//  POR QUE EXISTE: no Premiere a waveform é gerada no cliente
//  (Web Worker decodifica o áudio, canvas desenha). O Lua do
//  Resolve não decodifica áudio nem desenha PNG — mas mostra PNG
//  por linha via Icon[col], que está provado. Então a waveform vira
//  um asset: gerado uma vez, servido como imagem.
//
//  Fidelidade ao Premiere, número a número:
//    320 amostras = média de |sample| por balde, normalizada pelo máximo
//    canvas 320x64, gradiente vertical #4DD2FF → #0088CC
//    barras de 2px com 1px de vão (106 barras), altura max(2, amp*H*0.9),
//    centradas verticalmente, fundo transparente
//
//  Decodificação:
//    WAV  → parser próprio (PCM 8/16/24/32 int, 32/64 float)
//    MP3  → afconvert (macOS) ou ffmpeg (Linux/CI) pra WAV temporário
//
//  Uso:
//    node tools/build-waveforms.js --cache
//        Gera pros efeitos que já estão no cache local do app
//        (~/Library/Application Support/CinePRO/cache) → wave/<id>.png
//        ao lado. É o modo de prova: o painel do Resolve mostra na hora.
//
//    node tools/build-waveforms.js --ids <id,id,...> [--out DIR]
//        Baixa do CDN e gera. Base do pipeline pro acervo inteiro.
//
//    node tools/build-waveforms.js --file caminho.wav --id <id> [--out DIR]
// =============================================================

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CDN_FILES = 'https://pub-6ace91bcabf540f0a54bb6850d188ef4.r2.dev/';
const BASE = path.join(os.homedir(), 'Library', 'Application Support', 'CinePRO');

// ── Parâmetros do desenho (iguais ao Premiere) ──────────────
const AMPS = 320;
const W = 320, H = 64;
const BAR_W = 2, GAP = 1;
const COR_TOPO = [0x4D, 0xD2, 0xFF];
const COR_BASE = [0x00, 0x88, 0xCC];

// ── WAV → Float32 mono ──────────────────────────────────────
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('não é WAV');
  }
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        rate: buf.readUInt32LE(start + 4),
        bits: buf.readUInt16LE(start + 14),
      };
      // WAVE_FORMAT_EXTENSIBLE guarda o formato real no sub-format
      if (fmt.format === 0xFFFE && size >= 26) fmt.format = buf.readUInt16LE(start + 24);
    } else if (id === 'data') {
      data = buf.subarray(start, Math.min(start + size, buf.length));
    }
    pos = start + size + (size & 1);
    if (fmt && data) break;
  }
  if (!fmt || !data) throw new Error('WAV sem fmt/data');

  const ch = fmt.channels || 1;
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * ch));
  const out = new Float32Array(frames);
  const isFloat = fmt.format === 3;

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < ch; c++) {
      const off = (i * ch + c) * bytes;
      let v;
      if (isFloat) {
        v = bytes === 4 ? data.readFloatLE(off) : data.readDoubleLE(off);
      } else if (bytes === 1) {
        v = (data[off] - 128) / 128;
      } else if (bytes === 2) {
        v = data.readInt16LE(off) / 32768;
      } else if (bytes === 3) {
        v = ((data[off] | (data[off + 1] << 8) | (data[off + 2] << 16)) << 8 >> 8) / 8388608;
      } else {
        v = data.readInt32LE(off) / 2147483648;
      }
      sum += v;
    }
    out[i] = sum / ch;
  }
  return out;
}

// MP3 (e qualquer outro) → WAV temporário via ferramenta nativa
function decodeViaFerramenta(caminho) {
  const tmp = path.join(os.tmpdir(), 'cinepro-wave-' + process.pid + '-' + Date.now() + '.wav');
  try {
    if (process.platform === 'darwin') {
      execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', caminho, tmp], { stdio: 'ignore' });
    } else {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', caminho, '-ac', '1', '-ar', '22050', '-f', 'wav', tmp], { stdio: 'ignore' });
    }
    return decodeWav(fs.readFileSync(tmp));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* já não existe */ }
  }
}

function decodificar(caminho) {
  const buf = fs.readFileSync(caminho);
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF') return decodeWav(buf);
  return decodeViaFerramenta(caminho);
}

// ── amps: idêntico ao drawWaveformFromBuffer do Premiere ────
function extrairAmps(samples) {
  let step = Math.floor(samples.length / AMPS);
  if (step < 1) step = 1;
  const amps = new Float32Array(AMPS);
  for (let i = 0; i < AMPS; i++) {
    let sum = 0;
    const base = i * step;
    for (let j = 0; j < step; j++) sum += Math.abs(samples[base + j] || 0);
    amps[i] = sum / step;
  }
  let max = 0;
  for (let k = 0; k < AMPS; k++) if (amps[k] > max) max = amps[k];
  if (max > 0) for (let n = 0; n < AMPS; n++) amps[n] /= max;
  return amps;
}

// ── PNG mínimo (RGBA 8-bit, deflate do zlib do Node) ────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                          // filtro None
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── desenho: idêntico ao drawWaveformFromAmps do Premiere ───
function desenhar(amps) {
  const rgba = Buffer.alloc(W * H * 4);       // transparente
  const count = Math.floor(W / (BAR_W + GAP));
  for (let b = 0; b < count; b++) {
    const idx = Math.floor((b / count) * W);
    const amp = amps[idx] || 0;
    const barH = Math.max(2, amp * H * 0.9);
    const x0 = b * (BAR_W + GAP);
    const y0 = (H - barH) / 2;
    const yi = Math.round(y0), yf = Math.round(y0 + barH);
    for (let y = yi; y < yf && y < H; y++) {
      // gradiente vertical: t=0 no topo do canvas, 1 embaixo
      const t = y / (H - 1);
      const r = Math.round(COR_TOPO[0] + (COR_BASE[0] - COR_TOPO[0]) * t);
      const g = Math.round(COR_TOPO[1] + (COR_BASE[1] - COR_TOPO[1]) * t);
      const bl = Math.round(COR_TOPO[2] + (COR_BASE[2] - COR_TOPO[2]) * t);
      for (let x = x0; x < x0 + BAR_W && x < W; x++) {
        const o = (y * W + x) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bl; rgba[o + 3] = 255;
      }
    }
  }
  return png(rgba, W, H);
}

function gerar(caminhoAudio, saidaPng) {
  const amps = extrairAmps(decodificar(caminhoAudio));
  fs.mkdirSync(path.dirname(saidaPng), { recursive: true });
  fs.writeFileSync(saidaPng, desenhar(amps));
}

// ── CLI ─────────────────────────────────────────────────────
function arg(nome) {
  const i = process.argv.indexOf(nome);
  return i > -1 ? process.argv[i + 1] : null;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--cache')) {
    // Resolve o id completo pelo prefixo de 8 chars no nome do cache,
    // usando o índice do painel (mesma regra do "Restaurar mídias").
    const indice = fs.readFileSync(path.join(ROOT, 'data', 'lua-index.tsv'), 'utf8').split('\n');
    const porPrefixo = new Map();
    for (const l of indice) {
      const id = l.split('\t')[0];
      if (id) porPrefixo.set(id.slice(0, 8), id);
    }
    const cache = path.join(BASE, 'cache');
    const out = arg('--out') || path.join(BASE, 'wave');
    const arquivos = fs.readdirSync(cache).filter((f) => /\.(wav|mp3)$/i.test(f));
    let ok = 0, pulados = 0, erros = 0;
    for (const f of arquivos) {
      const id = f.length > 9 && f[8] === '_' ? porPrefixo.get(f.slice(0, 8)) : null;
      if (!id) { pulados++; continue; }
      const destino = path.join(out, id + '.png');
      if (fs.existsSync(destino)) { ok++; continue; }
      try { gerar(path.join(cache, f), destino); ok++; }
      catch (e) { erros++; console.error('  ✗', f, '—', e.message); }
    }
    console.log(`✓ ${ok} waveform(s) em ${out}`);
    if (pulados) console.log(`  ${pulados} arquivo(s) do cache sem id no catálogo (pulados)`);
    if (erros) console.log(`  ${erros} erro(s)`);
    return;
  }

  if (arg('--file')) {
    const id = arg('--id') || path.basename(arg('--file')).replace(/\.[^.]+$/, '');
    const out = arg('--out') || path.join(BASE, 'wave');
    gerar(arg('--file'), path.join(out, id + '.png'));
    console.log('✓', path.join(out, id + '.png'));
    return;
  }

  if (arg('--ids')) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest', 'dist', 'manifest.json'), 'utf8'));
    const ext = new Map(manifest.files.map((f) => [f.id, f.ext]));
    const out = arg('--out') || path.join(BASE, 'wave');
    const ids = arg('--ids').split(',').map((s) => s.trim()).filter(Boolean);
    for (const id of ids) {
      const e = ext.get(id);
      if (!e) { console.error('  ✗ id fora do manifest:', id); continue; }
      const tmp = path.join(os.tmpdir(), 'cinepro-' + id + '.' + e);
      execFileSync('curl', ['-sfL', '--max-time', '120', '-o', tmp, CDN_FILES + id + '.' + e]);
      try { gerar(tmp, path.join(out, id + '.png')); console.log('✓', id); }
      finally { try { fs.unlinkSync(tmp); } catch (x) { /* ok */ } }
    }
    return;
  }

  console.log('Uso: node tools/build-waveforms.js --cache | --ids a,b,c | --file x.wav --id ID   [--out DIR]');
  process.exit(1);
}

if (require.main === module) main();
module.exports = { decodeWav, extrairAmps, desenhar, gerar };
