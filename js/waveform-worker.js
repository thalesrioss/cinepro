// =============================================================
//  CinePRO — Waveform Worker
//  Decodifica áudio fora do main thread. UI nunca trava.
//  Receives: { id, url } → posts: { id, amps: Float32Array, width }
// =============================================================

'use strict';

var WIDTH = 320;  // resolução final em barras

self.addEventListener('message', function (e) {
  var msg = e.data || {};
  var id = msg.id;
  var url = msg.url;
  if (!id || !url) return;

  fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    })
    .then(function (buf) {
      // OfflineAudioContext disponível em Workers desde Chrome 87 (CEP é Chromium recente)
      var Ctx = self.OfflineAudioContext || self.webkitOfflineAudioContext;
      var hasDecode = false;
      var ctx = null;
      if (Ctx) {
        try {
          ctx = new Ctx(1, 44100, 44100);
          hasDecode = !!ctx.decodeAudioData;
        } catch (err) { ctx = null; }
      }
      if (ctx && hasDecode) {
        return ctx.decodeAudioData(buf).then(function (audioBuffer) {
          return extractAmps(audioBuffer);
        });
      }
      // Fallback: sem decode no worker → manda raw buffer pro main thread
      throw new Error('OfflineAudioContext indisponível no worker — fallback main');
    })
    .then(function (amps) {
      self.postMessage({ id: id, amps: amps, width: WIDTH }, [amps.buffer]);
    })
    .catch(function (err) {
      self.postMessage({ id: id, error: String(err && err.message || err) });
    });
});

function extractAmps(audioBuffer) {
  var data = audioBuffer.getChannelData(0);
  var step = Math.floor(data.length / WIDTH);
  if (step < 1) step = 1;
  var amps = new Float32Array(WIDTH);
  for (var i = 0; i < WIDTH; i++) {
    var sum = 0;
    var base = i * step;
    for (var j = 0; j < step; j++) {
      sum += Math.abs(data[base + j] || 0);
    }
    amps[i] = sum / step;
  }
  var max = 0;
  for (var k = 0; k < WIDTH; k++) if (amps[k] > max) max = amps[k];
  if (max > 0) for (var n = 0; n < WIDTH; n++) amps[n] /= max;
  return amps;
}
