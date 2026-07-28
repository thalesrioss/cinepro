// =============================================================
//  CinePRO — Extrai a DURAÇÃO de cada áudio pro manifest
//
//  Pré-requisito do ADR-008: sem duração nada distingue um riser de
//  6s de um click de 0,3s, e o motor acaba colocando riser em todo
//  corte. Só o header importa — baixamos os primeiros KB, não o
//  arquivo inteiro.
//
//  NÃO estime por bytes: a biblioteca tem 96kHz/24bit misturado com
//  44,1kHz/16bit, e o palpite errava por 4x (medido em 2026-07).
//
//  Uso:  node manifest/extract-durations.js [--limit N] [--force]
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const MANIFEST = path.join(__dirname, 'dist', 'manifest.json');
const CDN = 'https://pub-6ace91bcabf540f0a54bb6850d188ef4.r2.dev/';
const HEAD_BYTES = 32 * 1024;   // cobre header + chunks LIST/bext grandes
// r2.dev tem rate-limit (429). Com 40 em paralelo, 8.105 de 10.037 caíram
// em 429 na primeira execução. Concorrência baixa + backoff resolve; um
// domínio próprio (cdn.cinepro.app) removeria o teto de vez.
const CONCURRENCY = 8;
const MAX_RETRY = 5;

const argv = process.argv.slice(2);
const LIMIT = (() => { const i = argv.indexOf('--limit'); return i >= 0 ? parseInt(argv[i + 1], 10) : 0; })();
const FORCE = argv.includes('--force');

// ── Parsers de header ────────────────────────────────────────

function wavDuration(buf, totalSize) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12, sr = 0, ch = 0, bits = 0, dataSize = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 24 <= buf.length) {
      ch   = buf.readUInt16LE(off + 10);
      sr   = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    } else if (id === 'data') {
      dataSize = sz;
      break;
    }
    if (sz <= 0 || sz > 0x7fffffff) break;
    off += 8 + sz + (sz & 1);
  }
  if (!sr || !ch || !bits) return null;
  const byteRate = sr * ch * (bits / 8);
  if (!byteRate) return null;
  // data pode declarar tamanho maior que o arquivo (gravação truncada)
  const bytes = (dataSize && dataSize <= totalSize) ? dataSize : Math.max(0, totalSize - 44);
  return bytes / byteRate;
}

const MP3_RATES_V1L3 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
const MP3_RATES_V2L3 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
const MP3_SR = { 3: [44100,48000,32000], 2: [22050,24000,16000], 0: [11025,12000,8000] };

function mp3Duration(buf, totalSize) {
  // pula ID3v2 se houver
  let start = 0;
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'ID3') {
    const sz = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    start = 10 + sz;
  }
  // acha o primeiro frame sync
  for (let i = start; i < Math.min(buf.length - 4, start + 8192); i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (buf[i + 1] >> 3) & 0x03;      // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layer   = (buf[i + 1] >> 1) & 0x03;      // 1 = Layer III
    if (layer !== 1 || verBits === 1) continue;
    const brIdx = (buf[i + 2] >> 4) & 0x0f;
    const srIdx = (buf[i + 2] >> 2) & 0x03;
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const rates = verBits === 3 ? MP3_RATES_V1L3 : MP3_RATES_V2L3;
    const kbps = rates[brIdx];
    const sr = (MP3_SR[verBits] || MP3_SR[3])[srIdx];
    if (!kbps || !sr) continue;

    // Xing/Info (VBR): usa a contagem de frames, muito mais exata que CBR
    const xingOff = i + (verBits === 3 ? 36 : 21);
    if (xingOff + 12 < buf.length) {
      const tag = buf.toString('ascii', xingOff, xingOff + 4);
      if (tag === 'Xing' || tag === 'Info') {
        const flags = buf.readUInt32BE(xingOff + 4);
        if (flags & 1) {
          const frames = buf.readUInt32BE(xingOff + 8);
          const spf = verBits === 3 ? 1152 : 576;
          if (frames > 0) return (frames * spf) / sr;
        }
      }
    }
    return ((totalSize - start) * 8) / (kbps * 1000);   // CBR
  }
  return null;
}

function durationOf(ext, buf, size) {
  ext = String(ext).toLowerCase();
  if (ext === 'wav') return wavDuration(buf, size);
  if (ext === 'mp3') return mp3Duration(buf, size);
  return null;                       // m4a/aac: só 16 arquivos, não vale o parser
}

// ── Rede ─────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHeadRetry(url, bytes) {
  let wait = 500;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchHead(url, bytes);
    } catch (e) {
      const retryable = /HTTP 429|HTTP 5\d\d|timeout|ECONN|socket/i.test(e.message);
      if (!retryable || attempt >= MAX_RETRY) throw e;
      // jitter evita que os 8 workers voltem juntos e disparem 429 de novo
      await sleep(wait + Math.random() * wait);
      wait = Math.min(wait * 2, 8000);
    }
  }
}

function fetchHead(url, bytes) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Range: 'bytes=0-' + (bytes - 1), 'User-Agent': 'CinePRO-durations/1.0' },
      timeout: 25000,
    }, (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume(); return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Main ─────────────────────────────────────────────────────
(async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let targets = manifest.files.filter((f) => f.kind === 'audio' && (FORCE || f.dur === undefined));
  if (LIMIT) targets = targets.slice(0, LIMIT);

  const total = manifest.files.filter((f) => f.kind === 'audio').length;
  console.log(`áudios: ${total} | faltando duração: ${targets.length}` + (LIMIT ? ` | limite: ${LIMIT}` : ''));
  if (!targets.length) { console.log('nada a fazer.'); return; }

  let done = 0, ok = 0, failed = 0;
  const failures = {};
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const f = targets[cursor++];
      try {
        const buf = await fetchHeadRetry(CDN + f.id + '.' + f.ext, HEAD_BYTES);
        const d = durationOf(f.ext, buf, f.size);
        if (d && isFinite(d) && d > 0 && d < 7200) {
          f.dur = Math.round(d * 100) / 100;
          ok++;
        } else {
          failed++; failures[f.ext] = (failures[f.ext] || 0) + 1;
        }
      } catch (e) {
        failed++; failures[e.message.slice(0, 20)] = (failures[e.message.slice(0, 20)] || 0) + 1;
      }
      if (++done % 250 === 0) process.stdout.write(`\r  ${done}/${targets.length}  ok=${ok} falha=${failed}`);
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\r  ${done}/${targets.length}  ok=${ok} falha=${failed}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  if (Object.keys(failures).length) console.log('  motivos:', JSON.stringify(failures));

  const json = JSON.stringify(manifest);
  fs.writeFileSync(MANIFEST, json);
  fs.writeFileSync(MANIFEST + '.gz', zlib.gzipSync(json, { level: 9 }));

  const withDur = manifest.files.filter((f) => f.kind === 'audio' && f.dur !== undefined);
  const ds = withDur.map((f) => f.dur).sort((a, b) => a - b);
  console.log(`\n✓ ${withDur.length}/${total} áudios com duração`);
  if (ds.length) {
    const q = (p) => ds[Math.floor(ds.length * p)];
    console.log(`  p10=${q(0.1)}s  mediana=${q(0.5)}s  p90=${q(0.9)}s  max=${ds[ds.length - 1]}s`);
    console.log(`  curtos (<1,2s, servem de corte): ${ds.filter((d) => d <= 1.2).length}`);
    console.log(`  longos (>=20s, servem de cama):  ${ds.filter((d) => d >= 20).length}`);
  }
})();
