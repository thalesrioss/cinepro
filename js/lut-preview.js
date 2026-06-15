/* =============================================================
 *  CinePRO — LUT Antes/Depois (v1.5.1)
 *
 *  Baixa o .cube, parseia, e aplica numa imagem de referência
 *  sintética (gradiente de cor + rampa de luz) via canvas 2D —
 *  trilinear em JS, sem WebGL (mais robusto no CEP). Mostra um
 *  slider arrastável: esquerda = original, direita = com o LUT.
 *
 *  Totalmente isolado: se qualquer passo falhar, mostra aviso e
 *  não afeta o resto do plugin. Exposto como window.openLutPreview.
 * ============================================================= */
(function () {
  'use strict';

  var REF_W = 320, REF_H = 180;

  // ── Parse .cube (3D LUT). Retorna {size, data:[r,g,b,...]} ou null ──
  function parseCube(text) {
    var size = 0, data = [];
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln || ln.charAt(0) === '#') continue;
      if (/^TITLE/i.test(ln) || /^DOMAIN_/i.test(ln)) continue;
      if (/^LUT_1D_SIZE/i.test(ln)) return null; // 1D não suportado
      var m = ln.match(/^LUT_3D_SIZE\s+(\d+)/i);
      if (m) { size = parseInt(m[1], 10); continue; }
      var p = ln.split(/\s+/);
      if (p.length === 3) {
        var r = parseFloat(p[0]), g = parseFloat(p[1]), b = parseFloat(p[2]);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) data.push(r, g, b);
      }
    }
    if (!size || data.length !== size * size * size * 3) return null;
    return { size: size, data: data };
  }

  // Trilinear sample no LUT. r,g,b in 0..1 → [r,g,b] 0..1.
  // Ordem .cube: R varia mais rápido → idx = (r + g*N + b*N*N)*3
  function sampleLUT(lut, r, g, b) {
    var N = lut.size, d = lut.data, mx = N - 1;
    function cl(c) { return c < 0 ? 0 : (c > mx ? mx : c); }
    var rf = cl(r * mx), gf = cl(g * mx), bf = cl(b * mx);
    var r0 = Math.floor(rf), g0 = Math.floor(gf), b0 = Math.floor(bf);
    var r1 = Math.min(mx, r0 + 1), g1 = Math.min(mx, g0 + 1), b1 = Math.min(mx, b0 + 1);
    var dr = rf - r0, dg = gf - g0, db = bf - b0;
    function idx(ri, gi, bi) { return (ri + gi * N + bi * N * N) * 3; }
    function L(a, b, t) { return a + (b - a) * t; }
    var out = [0, 0, 0];
    for (var c = 0; c < 3; c++) {
      var c000 = d[idx(r0,g0,b0)+c], c100 = d[idx(r1,g0,b0)+c];
      var c010 = d[idx(r0,g1,b0)+c], c110 = d[idx(r1,g1,b0)+c];
      var c001 = d[idx(r0,g0,b1)+c], c101 = d[idx(r1,g0,b1)+c];
      var c011 = d[idx(r0,g1,b1)+c], c111 = d[idx(r1,g1,b1)+c];
      var x00 = L(c000,c100,dr), x10 = L(c010,c110,dr), x01 = L(c001,c101,dr), x11 = L(c011,c111,dr);
      out[c] = L(L(x00,x10,dg), L(x01,x11,dg), db);
    }
    return out;
  }

  // Imagem de referência sintética: faixa de matiz (cor) sobre rampa de
  // luz vertical, + barra de tons de pele e rampa cinza embaixo. Mostra
  // bem o caráter do LUT (shift de cor + contraste).
  function drawReference(ctx) {
    for (var y = 0; y < REF_H; y++) {
      for (var x = 0; x < REF_W; x++) {
        var hue = x / REF_W;             // 0..1 matiz
        var val = 1 - (y / REF_H) * 0.85; // topo claro → base escura
        var rgb;
        if (y > REF_H * 0.78) {
          var t = x / REF_W;             // rampa cinza embaixo
          rgb = [t, t, t];
        } else if (y > REF_H * 0.62) {
          // tons de pele
          var s = x / REF_W;
          rgb = [0.85 - s * 0.2, 0.62 - s * 0.18, 0.5 - s * 0.16];
        } else {
          rgb = hsvToRgb(hue, 0.75, val);
        }
        var o = (y * REF_W + x) * 4;
        ref.data[o] = rgb[0] * 255; ref.data[o+1] = rgb[1] * 255; ref.data[o+2] = rgb[2] * 255; ref.data[o+3] = 255;
      }
    }
    ctx.putImageData(ref, 0, 0);
  }
  var ref = null;
  function hsvToRgb(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t];
      case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q];
    }
  }

  function applyLUTToImageData(src, lut) {
    var out = new ImageData(src.width, src.height);
    var s = src.data, o = out.data;
    for (var i = 0; i < s.length; i += 4) {
      var g = sampleLUT(lut, s[i]/255, s[i+1]/255, s[i+2]/255);
      o[i] = g[0]*255; o[i+1] = g[1]*255; o[i+2] = g[2]*255; o[i+3] = 255;
    }
    return out;
  }

  function ensureModal() {
    var m = document.getElementById('lut-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'lut-modal';
    m.className = 'lut-modal hidden';
    m.innerHTML =
      '<div class="lut-modal-box">' +
        '<div class="lut-modal-head"><span id="lut-modal-title">LUT</span>' +
          '<button class="lut-modal-close" id="lut-modal-close" aria-label="Fechar">✕</button></div>' +
        '<div class="lut-stage" id="lut-stage">' +
          '<canvas class="lut-canvas lut-before" width="' + REF_W + '" height="' + REF_H + '"></canvas>' +
          '<div class="lut-after-wrap" id="lut-after-wrap">' +
            '<canvas class="lut-canvas lut-after" width="' + REF_W + '" height="' + REF_H + '"></canvas>' +
          '</div>' +
          '<div class="lut-divider" id="lut-divider"><span class="lut-handle">⟺</span></div>' +
          '<span class="lut-tag lut-tag-before">ANTES</span>' +
          '<span class="lut-tag lut-tag-after">DEPOIS</span>' +
        '</div>' +
        '<div class="lut-modal-foot" id="lut-modal-foot">Arraste a linha pra comparar</div>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) hide(); });
    m.querySelector('#lut-modal-close').addEventListener('click', hide);
    bindSlider(m);
    return m;
  }

  function bindSlider(m) {
    var stage = m.querySelector('#lut-stage');
    var wrap = m.querySelector('#lut-after-wrap');
    var div = m.querySelector('#lut-divider');
    var dragging = false;
    function setPos(clientX) {
      var rect = stage.getBoundingClientRect();
      var p = (clientX - rect.left) / rect.width;
      p = Math.max(0, Math.min(1, p));
      wrap.style.width = (p * 100) + '%';
      div.style.left = (p * 100) + '%';
    }
    stage.addEventListener('mousedown', function (e) { dragging = true; setPos(e.clientX); e.preventDefault(); });
    window.addEventListener('mousemove', function (e) { if (dragging) setPos(e.clientX); });
    window.addEventListener('mouseup', function () { dragging = false; });
  }

  function hide() {
    var m = document.getElementById('lut-modal');
    if (m) m.classList.add('hidden');
  }

  function fail(msg) {
    var foot = document.getElementById('lut-modal-foot');
    if (foot) { foot.textContent = msg || 'Pré-visualização indisponível pra este LUT.'; foot.classList.add('lut-err'); }
  }

  // API pública — chamada pela delegação do grid.
  // urls: cadeia de download do .cube (assetUrlChain do main.js).
  window.openLutPreview = function (effect, urls) {
    try {
      var m = ensureModal();
      m.classList.remove('hidden');
      m.querySelector('#lut-modal-title').textContent = effect.name || 'LUT';
      var foot = document.getElementById('lut-modal-foot');
      foot.classList.remove('lut-err');
      foot.textContent = 'Carregando LUT…';

      var before = m.querySelector('.lut-before');
      var after = m.querySelector('.lut-after');
      var bctx = before.getContext('2d');
      var actx = after.getContext('2d');
      if (!ref) ref = bctx.createImageData(REF_W, REF_H);
      drawReference(bctx);
      // reset slider ao meio
      m.querySelector('#lut-after-wrap').style.width = '50%';
      m.querySelector('#lut-divider').style.left = '50%';

      fetchFirst(urls.slice(), function (text) {
        if (!text) return fail('Não consegui baixar o LUT. Tente de novo.');
        var lut = parseCube(text);
        if (!lut) return fail('Formato de LUT não suportado pra preview (só .cube 3D).');
        try {
          var srcData = bctx.getImageData(0, 0, REF_W, REF_H);
          var graded = applyLUTToImageData(srcData, lut);
          actx.putImageData(graded, 0, 0);
          foot.textContent = 'Arraste a linha pra comparar  ·  ' + lut.size + '³';
        } catch (e) { fail('Erro ao aplicar o LUT.'); }
      });
    } catch (e) {
      fail('Pré-visualização indisponível.');
    }
  };

  // Tenta cada URL da cadeia até uma responder com texto.
  function fetchFirst(urls, cb) {
    if (!urls.length) return cb(null);
    var url = urls.shift();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 20000;
    xhr.onload = function () {
      if (xhr.status === 200 && xhr.responseText && xhr.responseText.indexOf('<html') === -1) cb(xhr.responseText);
      else fetchFirst(urls, cb);
    };
    xhr.onerror = function () { fetchFirst(urls, cb); };
    xhr.ontimeout = function () { fetchFirst(urls, cb); };
    xhr.send();
  }
})();
