// =============================================================
//  CinePRO — Guia de instalação animado (7 passos)
//
//  Porte em JS puro do componente feito no Claude Design. O
//  original era um artifact React (.dc.html) que carregava
//  React + ReactDOM do unpkg e Babel pra transpilar JSX no
//  navegador. Numa página de vendas isso é ~1 MB de terceiros no
//  caminho crítico e um ponto de falha que não controlamos.
//
//  A razão da peça existir: TODO cliente novo vê um aviso de
//  segurança do sistema na primeira execução — o CinePRO ainda não
//  tem certificado Apple nem reputação no SmartScreen. O objetivo
//  é a pessoa RECONHECER a tela antes de encontrá-la, pra ler como
//  "é aquilo do tutorial" e não como "baixei um vírus". Por isso o
//  passo 3 é o mais trabalhado, e não uma nota de rodapé.
// =============================================================

(function () {
  'use strict';

  var raiz = document.getElementById('install-guide');
  if (!raiz) return;

  var CMD = 'xattr -dr com.apple.quarantine ~/Downloads/CinePRO.pkg';

  var PASSOS = [
    { rotulo: 'Conta',           titulo: 'Criar conta antes de baixar' },
    { rotulo: 'Download',        titulo: 'Baixar o instalador' },
    { rotulo: 'Aviso do sistema', titulo: 'O aviso de segurança do sistema' },
    { rotulo: 'Instalar',        titulo: 'Instalar e abrir o CinePRO' },
    { rotulo: 'Trial',           titulo: 'Iniciar a avaliação de 3 dias' },
    { rotulo: 'Premiere',        titulo: 'Instalar o plugin do Premiere' },
    { rotulo: 'Resolve',         titulo: 'DaVinci Resolve, se for o caso' }
  ];

  // Beat final de cada passo — é o estado que quem pediu
  // prefers-reduced-motion recebe direto, sem animação nenhuma.
  var BEAT_FINAL = [2, 2, 3, 3, 3, 4, 3];

  var est = {
    os: 'macos', passo: 0, beat: 0, digitado: '', copiado: false,
    progresso: 0, fase: 'idle', abaResolve: 'drag'
  };

  var timers = [];
  var intProgresso = null;
  var intDigita = null;
  var menosMovimento = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ─── util ──────────────────────────────────────────────────
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function em(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function pararTudo() {
    timers.forEach(clearTimeout);
    timers = [];
    if (intProgresso) { clearInterval(intProgresso); intProgresso = null; }
    if (intDigita) { clearInterval(intDigita); intDigita = null; }
  }

  function detectarOs() {
    var s = ((navigator.userAgentData && navigator.userAgentData.platform) ||
             navigator.platform || navigator.userAgent || '').toLowerCase();
    if (s.indexOf('win') === 0 || s.indexOf('windows') > -1) return 'windows';
    return 'macos';
  }

  var ICONE_APPLE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.8c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.1 1.2 9.5.8 1.1 1.7 2.4 3 2.4 1.2 0 1.6-.8 3.1-.8 1.4 0 1.8.8 3.1.7 1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.5-1-2.5-3.8zM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.9-1.4z"/></svg>';
  var ICONE_WIN = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.5l7.5-1v7H3v-6zm0 13l7.5 1v-6.9H3v5.9zm8.5 1.1L21 21V12.6h-9.5v7zM11.5 3v7.5H21V3l-9.5 1.3z"/></svg>';
  var ICONE_CURSOR = '<svg viewBox="0 0 24 24" fill="#fff" stroke="#000" stroke-width="1.2" aria-hidden="true"><path d="M5 3l14 8.5-6.2 1.3 3.2 6.4-2.6 1.3-3.2-6.4L5 19V3z"/></svg>';

  // ─── casca ─────────────────────────────────────────────────
  var caixaTrail = raiz.querySelector('[data-ig="trail"]');
  var caixaTexto = raiz.querySelector('[data-ig="texto"]');
  var caixaRepro = raiz.querySelector('[data-ig="repro"]');
  var caixaBeat  = raiz.querySelector('[data-ig="beat"]');
  var caixaAviso = raiz.querySelector('[data-ig="anuncio"]');
  var btnPrev    = raiz.querySelector('[data-ig="prev"]');
  var btnProx    = raiz.querySelector('[data-ig="prox"]');
  var elContador = raiz.querySelector('[data-ig="contador"]');
  var btnReplay  = raiz.querySelector('[data-ig="replay"]');
  var btnsOs     = raiz.querySelectorAll('[data-ig-os]');

  // ─── render ────────────────────────────────────────────────
  function pintarOs() {
    for (var i = 0; i < btnsOs.length; i++) {
      var b = btnsOs[i];
      var meu = b.getAttribute('data-ig-os');
      b.setAttribute('aria-pressed', meu === est.os ? 'true' : 'false');
    }
  }

  function pintarTrail() {
    limpar(caixaTrail);
    PASSOS.forEach(function (p, i) {
      var b = el('button');
      b.type = 'button';
      if (i < est.passo) b.className = 'is-done';
      if (i === est.passo) b.setAttribute('aria-current', 'step');
      var n = el('span', 'ig-num', i < est.passo ? '✓' : String(i + 1));
      b.appendChild(n);
      b.appendChild(el('span', null, p.rotulo));
      b.addEventListener('click', function () { irPara(i); });
      caixaTrail.appendChild(b);
    });
  }

  function pintarNav() {
    btnPrev.disabled = est.passo === 0;
    btnProx.disabled = est.passo === PASSOS.length - 1;
    elContador.textContent = 'Passo ' + (est.passo + 1) + ' de ' + PASSOS.length;
    caixaAviso.textContent = 'Passo ' + (est.passo + 1) + ' de ' + PASSOS.length +
      ': ' + PASSOS[est.passo].titulo;
  }

  // Blocos de texto reutilizados
  function bloco(pai, cls, titulo, texto) {
    var d = el('div', cls);
    d.appendChild(el('div', cls + '-t', titulo));
    var p = el('p');
    p.innerHTML = texto;
    d.appendChild(p);
    pai.appendChild(d);
    return d;
  }
  function paragrafo(pai, html) {
    var p = el('p', 'ig-p');
    p.innerHTML = html;
    pai.appendChild(p);
    return p;
  }
  function lista(pai, itens) {
    var ol = el('ol', 'ig-steps');
    itens.forEach(function (txt, i) {
      var li = el('li');
      li.appendChild(el('span', 'ig-n', String(i + 1)));
      var caixa = el('div');
      var p = el('p');
      p.innerHTML = txt;
      caixa.appendChild(p);
      li.appendChild(caixa);
      ol.appendChild(li);
      li._caixa = caixa;
    });
    pai.appendChild(ol);
    return ol;
  }
  function tela(rotulo) {
    limpar(caixaRepro);
    var barra = el('div', 'ig-repro-bar');
    barra.appendChild(el('span', null, rotulo));
    caixaBeat = el('span', 'ig-repro-beat');
    barra.appendChild(caixaBeat);
    caixaRepro.appendChild(barra);
    var t = el('div', 'ig-screen');
    caixaRepro.appendChild(t);
    return t;
  }
  function chrome(pai, titulo) {
    var c = el('div', 'ig-chrome');
    for (var i = 0; i < 3; i++) c.appendChild(el('span', 'ig-dot'));
    c.appendChild(el('span', 'ig-chrome-title', titulo));
    pai.appendChild(c);
    var corpo = el('div', 'ig-body');
    pai.appendChild(corpo);
    return corpo;
  }

  // Cada passo devolve um objeto com `beat(n)` — chamado a cada
  // batida da animação pra atualizar só o que mudou.
  var atual = null;

  function montarPasso() {
    limpar(caixaTexto);
    var kicker = 'Passo ' + (est.passo + 1) + ' de 7';
    if (est.passo === 2) kicker += est.os === 'macos' ? ' · macOS' : ' · Windows';
    caixaTexto.appendChild(el('div', 'ig-kicker', kicker));

    var fn = [passo1, passo2, passo3, passo4, passo5, passo6, passo7][est.passo];
    atual = fn() || {};
  }

  // ─── 1. Conta ──────────────────────────────────────────────
  function passo1() {
    caixaTexto.appendChild(el('h3', 'ig-h', 'Criar conta antes de baixar'));
    paragrafo(caixaTexto, 'O botão de download fica bloqueado com um cadeado até você criar conta. É de graça: e-mail e uma senha de <strong>no mínimo 6 caracteres</strong>.');
    paragrafo(caixaTexto, 'Não é cadastro de newsletter. É a mesma conta que você vai usar pra logar dentro do app depois de instalar — a senha volta no passo 4.');
    bloco(caixaTexto, 'ig-warn', 'Onde as pessoas travam', 'Quem não entende esse passo fica clicando no botão bloqueado e conclui que o download está quebrado.');

    var lnk = el('a', 'ig-cta', 'Ir para o cadastro ↑');
    lnk.href = '#signup';
    caixaTexto.appendChild(lnk);

    var t = tela('Reprodução — cadastro');
    var corpo = chrome(t, 'CinePRO · criar conta');

    var f1 = el('div', 'ig-field');
    f1.appendChild(el('div', 'ig-label', 'E-mail'));
    var inEmail = el('div', 'ig-input');
    f1.appendChild(inEmail); corpo.appendChild(f1);

    var f2 = el('div', 'ig-field');
    f2.appendChild(el('div', 'ig-label', 'Senha (mínimo 6 caracteres)'));
    var inSenha = el('div', 'ig-input');
    f2.appendChild(inSenha); corpo.appendChild(f2);

    var btn = el('div', 'ig-btn', 'Baixar — crie sua conta');
    corpo.appendChild(btn);
    var st = el('div', 'ig-status', 'Download bloqueado até a conta existir.');
    corpo.appendChild(st);

    return {
      beat: function (b) {
        inEmail.textContent = b >= 1 ? 'editor@estudio.com.br' : '';
        inSenha.textContent = b >= 1 ? '••••••••' : '';
        inEmail.className = 'ig-input' + (b >= 1 ? ' is-filled' : '');
        inSenha.className = 'ig-input' + (b >= 1 ? ' is-filled' : '');
        btn.textContent = b >= 2 ? 'Baixar o CinePRO' : 'Baixar — crie sua conta';
        btn.className = 'ig-btn' + (b >= 2 ? ' is-on' : '');
        st.textContent = b >= 2
          ? 'Conta criada. Guarde esse e-mail e essa senha — o app pede os dois no passo 4.'
          : 'Download bloqueado até a conta existir.';
        st.className = 'ig-status' + (b >= 2 ? ' is-ok' : '');
      }
    };
  }

  // ─── 2. Download ───────────────────────────────────────────
  function passo2() {
    var mac = est.os === 'macos';
    caixaTexto.appendChild(el('h3', 'ig-h', 'Baixar o instalador'));
    paragrafo(caixaTexto, mac
      ? 'A página detecta o sistema e entrega o arquivo <strong>.pkg</strong>, para macOS 10.14 ou superior. São <strong>~540 MB</strong>.'
      : 'A página detecta o sistema e entrega o arquivo <strong>.exe</strong>, para Windows 10 ou superior. São <strong>~540 MB</strong>.');
    paragrafo(caixaTexto, 'O tamanho é assim porque os 500 efeitos já vêm dentro do instalador. Você baixa uma vez e nunca mais espera download no meio da edição.');
    bloco(caixaTexto, 'ig-warn', 'Em link lento', 'A barra pode ficar parada por vários minutos em alguns trechos. Não é travamento — não cancele e não recarregue a página.');

    var t = tela('Reprodução — download');
    var corpo = chrome(t, mac ? 'macOS · .pkg · 10.14+' : 'Windows · .exe · 10+');

    var linha = el('div', 'ig-file');
    linha.appendChild(el('span', 'ig-file-n', mac ? 'CinePRO.pkg' : 'CinePRO-Setup.exe'));
    linha.appendChild(el('span', 'ig-file-s', '540 MB'));
    corpo.appendChild(linha);

    var barra = el('div', 'ig-bar');
    var fill = el('span');
    barra.appendChild(fill); corpo.appendChild(barra);

    var rodape = el('div', 'ig-file');
    rodape.style.marginTop = '9px';
    var st = el('span', 'ig-status', 'Aguardando início do download');
    st.style.marginTop = '0';
    var pct = el('span', 'ig-file-s', '0%');
    rodape.appendChild(st); rodape.appendChild(pct);
    corpo.appendChild(rodape);

    var stats = el('div', 'ig-stat-row');
    [['500', 'efeitos embutidos no instalador'], ['0', 'downloads durante a edição']]
      .forEach(function (par) {
        var d = el('div', 'ig-stat');
        d.appendChild(el('b', null, par[0]));
        d.appendChild(el('span', null, par[1]));
        stats.appendChild(d);
      });
    corpo.appendChild(stats);

    function pintar() {
      fill.style.width = est.progresso + '%';
      fill.className = est.fase === 'done' ? 'is-done' : '';
      pct.textContent = Math.round(est.progresso) + '%';
      st.textContent = est.fase === 'done' ? 'Concluído · pronto pra abrir'
        : est.fase === 'stall' ? 'A barra parou aqui. Isso é normal — não cancele.'
        : est.fase === 'run' ? 'Baixando…' : 'Aguardando início do download';
      st.className = 'ig-status' + (est.fase === 'stall' ? ' is-warn' : est.fase === 'done' ? ' is-ok' : '');
      st.style.marginTop = '0';
    }
    pintar();
    return { pintar: pintar, beat: function () { pintar(); } };
  }

  // ─── 3. O aviso do sistema ─────────────────────────────────
  function passo3() {
    return est.os === 'macos' ? passo3Mac() : passo3Win();
  }

  function passo3Mac() {
    caixaTexto.appendChild(el('h3', 'ig-h', 'O aviso do macOS — e a saída'));
    paragrafo(caixaTexto, 'Na primeira vez que você abrir o .pkg, o macOS bloqueia e mostra a tela ao lado. <strong>Ela vem para todo mundo</strong> que baixa o CinePRO hoje.');
    paragrafo(caixaTexto, 'A causa: o CinePRO ainda não tem certificado Apple Developer. São US$ 99 por ano e o processo está em andamento. Até sair, todo instalador nosso chega com esse aviso.');

    var ol = lista(caixaTexto, [
      'Abra o Terminal: <strong>Cmd + Espaço</strong>, digite <code>Terminal</code>, Enter.',
      'Cole exatamente este comando e dê Enter:',
      'Volte na pasta Downloads e dê duplo-clique no <code>CinePRO.pkg</code>. Agora abre normal.'
    ]);

    // O comando entra dentro do item 2 — copiável, nunca digitado à mão.
    var cmdBox = el('div', 'ig-cmd');
    var row = el('div', 'ig-cmd-row');
    var code = el('code', null, CMD);
    var btnCopiar = el('button', null, 'Copiar');
    btnCopiar.type = 'button';
    btnCopiar.addEventListener('click', function () { copiar(btnCopiar); });
    row.appendChild(code); row.appendChild(btnCopiar);
    cmdBox.appendChild(row);
    ol.children[1]._caixa.appendChild(cmdBox);
    var nota = el('p');
    nota.style.cssText = 'margin:7px 0 0;font-size:12px;color:var(--text-faint);line-height:1.5';
    nota.textContent = 'Ele remove a marca de "baixado da internet" do arquivo. Não altera o instalador.';
    ol.children[1]._caixa.appendChild(nota);

    bloco(caixaTexto, 'ig-info', 'Se quiser conferir antes', 'Suba o .pkg no VirusTotal e rode o scan antes de instalar. Leva alguns minutos e responde a pergunta que o aviso levanta.');

    var t = tela('Tela do macOS — reprodução');

    var dlg = el('div', 'ig-mac-dlg');
    var ico = el('div', 'ig-mac-icon', '⚠️');
    dlg.appendChild(ico);
    var p1 = el('p', null, '"CinePRO.pkg" não pode ser aberto porque a Apple não pôde verificar se este arquivo contém malware.');
    dlg.appendChild(p1);
    dlg.appendChild(el('p', 'ig-mac-sub', 'Este software precisa ser atualizado. Contate o desenvolvedor para obter mais informações.'));
    var btns = el('div', 'ig-mac-btns');
    btns.appendChild(el('b', null, 'Mover para o Lixo'));
    btns.appendChild(el('b', null, 'Cancelar'));
    dlg.appendChild(btns);
    t.appendChild(dlg);

    var term = el('div', 'ig-term');
    var top = el('div', 'ig-term-top');
    for (var i = 0; i < 3; i++) top.appendChild(el('span', 'ig-dot'));
    top.appendChild(el('span', null, 'Terminal — zsh — 80×24'));
    term.appendChild(top);
    var tbody = el('div', 'ig-term-body');
    var prompt = el('span', 'ig-prompt', 'editor@mac ~ % ');
    var digitado = el('span');
    var caret = el('span', 'ig-caret');
    tbody.appendChild(prompt); tbody.appendChild(digitado); tbody.appendChild(caret);
    var okLine = el('div', 'ig-term-ok', 'quarantine removido · nenhuma saída significa sucesso');
    okLine.style.opacity = '0';
    tbody.appendChild(okLine);
    term.appendChild(tbody);
    t.appendChild(term);

    var inst = el('div', 'ig-inst');
    inst.appendChild(el('h5', null, 'Instalar CinePRO'));
    inst.appendChild(el('p', null, 'Bem-vindo ao instalador do CinePRO.'));
    var btnCont = el('div', 'ig-btn is-on', 'Continuar');
    inst.appendChild(btnCont);
    t.appendChild(inst);

    return {
      copiarBtn: btnCopiar,
      digitado: digitado,
      beat: function (b) {
        caixaBeat.textContent = b >= 3 ? 'Instalador abre normal'
          : b >= 2 ? 'Terminal: comando' : b >= 1 ? 'Aviso do Gatekeeper' : '';
        dlg.style.opacity = b < 1 ? '0' : b >= 2 ? '0.3' : '1';
        dlg.style.transform = b >= 2 ? 'scale(.96)' : 'scale(1)';
        term.style.opacity = b >= 2 ? '1' : '0';
        term.style.transform = b >= 2 ? 'translateY(0)' : 'translateY(18px)';
        okLine.style.opacity = b >= 3 ? '1' : '0';
        caret.style.display = b >= 3 ? 'none' : 'inline-block';
        inst.style.opacity = b >= 3 ? '1' : '0';
        inst.style.transform = b >= 3 ? 'translateY(-50%)' : 'translateY(calc(-50% + 12px))';
        digitado.textContent = est.digitado;
      }
    };
  }

  function passo3Win() {
    caixaTexto.appendChild(el('h3', 'ig-h', 'O aviso do Windows — e o botão escondido'));
    paragrafo(caixaTexto, 'Na primeira execução do .exe, o Windows bloqueia com a tela azul ao lado. <strong>Ela vem para todo mundo</strong> que baixa o CinePRO hoje.');
    paragrafo(caixaTexto, 'O botão que você precisa <strong>não está visível</strong>. A tela só mostra "Não executar" — e parece um beco sem saída. É aqui que as pessoas desistem.');

    lista(caixaTexto, [
      'Clique em <strong>Mais informações</strong>, o link pequeno abaixo do texto.',
      'A tela cresce e aparece o botão <strong>Executar mesmo assim</strong>.',
      'Clique nele. O instalador abre normal a partir daí.'
    ]);

    bloco(caixaTexto, 'ig-warn', 'A causa', 'Instalador novo, sem reputação acumulada no SmartScreen. O aviso é sobre quantas pessoas já rodaram o arquivo, não sobre o que tem dentro dele.');
    bloco(caixaTexto, 'ig-info', 'Se quiser conferir antes', 'Suba o .exe no VirusTotal e rode o scan antes de instalar.');

    var t = tela('Tela do Windows — reprodução');

    var win = el('div', 'ig-win');
    win.appendChild(el('h4', null, 'O Windows protegeu seu PC'));
    win.appendChild(el('p', null, 'O Microsoft Defender SmartScreen impediu a inicialização de um aplicativo não reconhecido. A execução desse aplicativo pode colocar seu PC em risco.'));
    var more = el('span', 'ig-win-more', 'Mais informações');
    win.appendChild(more);
    var info = el('div', 'ig-win-info');
    info.innerHTML = 'Aplicativo: CinePRO.exe<br>Editor: Editor desconhecido';
    win.appendChild(info);
    var wbtns = el('div', 'ig-win-btns');
    var bRun = el('b', null, 'Executar mesmo assim');
    var bNo = el('b', null, 'Não executar');
    wbtns.appendChild(bRun); wbtns.appendChild(bNo);
    win.appendChild(wbtns);
    t.appendChild(win);

    var cursor = el('div', 'ig-cursor');
    cursor.innerHTML = ICONE_CURSOR;
    t.appendChild(cursor);

    var inst = el('div', 'ig-inst');
    inst.appendChild(el('h5', null, 'Instalação do CinePRO'));
    inst.appendChild(el('p', null, 'O assistente vai instalar o CinePRO neste computador.'));
    inst.appendChild(el('div', 'ig-btn is-on', 'Avançar'));
    t.appendChild(inst);

    // O cursor persegue o alvo real medido no DOM — se o layout
    // mudar (mobile, fonte maior), ele continua acertando o botão.
    function mirar(b) {
      var alvo = b >= 4 ? bRun : b >= 2 ? more : null;
      if (!alvo) {
        cursor.style.left = (t.clientWidth - 78) + 'px';
        cursor.style.top = (t.clientHeight - 54) + 'px';
        return;
      }
      var r = alvo.getBoundingClientRect(), sr = t.getBoundingClientRect();
      cursor.style.left = (r.left - sr.left + Math.min(30, r.width * 0.34)) + 'px';
      cursor.style.top = (r.top - sr.top + r.height * 0.62) + 'px';
    }

    return {
      mirar: mirar,
      pulso: function () {
        var rip = el('div', 'ig-ripple');
        cursor.appendChild(rip);
        setTimeout(function () { if (rip.parentNode) rip.parentNode.removeChild(rip); }, 640);
      },
      beat: function (b) {
        caixaBeat.textContent = b >= 5 ? 'Instalador abre normal'
          : b >= 3 ? 'Botão revelado' : b >= 2 ? 'Clique em Mais informações'
          : b >= 1 ? 'SmartScreen bloqueou' : '';
        win.style.opacity = b >= 5 ? '0.25' : b >= 1 ? '1' : '0';
        more.className = 'ig-win-more' + (b >= 2 && b < 3 ? ' is-hot' : '');
        info.style.opacity = b >= 3 ? '1' : '0';
        info.style.transform = b >= 3 ? 'translateY(0)' : 'translateY(8px)';
        wbtns.style.opacity = b >= 3 ? '1' : '0';
        wbtns.style.transform = b >= 3 ? 'translateY(0)' : 'translateY(8px)';
        bRun.className = b >= 5 ? 'is-hot' : '';
        cursor.style.opacity = b >= 1 && b < 5 ? '1' : '0';
        inst.style.opacity = b >= 5 ? '1' : '0';
        inst.style.transform = b >= 5 ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(.94)';
        requestAnimationFrame(function () { mirar(b); });
      }
    };
  }

  // ─── 4. Instalar e abrir ───────────────────────────────────
  function passo4() {
    caixaTexto.appendChild(el('h3', 'ig-h', 'Instalar e abrir o CinePRO'));
    paragrafo(caixaTexto, 'Rode o instalador até o fim e abra o app. Na tela de login, use <strong>as mesmas credenciais do passo 1</strong>: o mesmo e-mail e a mesma senha que você criou no site.');
    paragrafo(caixaTexto, 'Não existe segundo cadastro dentro do app. Se o login falhar, é senha errada — use "esqueci minha senha" no site, não crie outra conta.');
    bloco(caixaTexto, 'ig-warn', 'Confusão comum', 'Muita gente tenta se cadastrar de novo aqui e acaba com duas contas — a que pagou e a que está logada.');

    var t = tela('Reprodução — instalação e login');

    var inst = el('div', 'ig-inst');
    inst.style.top = '38%';
    inst.appendChild(el('h5', null, 'Instalar CinePRO'));
    inst.appendChild(el('p', null, 'Instalando os 500 efeitos…'));
    var barra = el('div', 'ig-bar');
    var fill = el('span');
    fill.style.width = '10%';
    barra.appendChild(fill); inst.appendChild(barra);
    t.appendChild(inst);

    var app = el('div', 'ig-inst');
    app.style.top = '52%';
    app.appendChild(el('h5', null, 'Entrar no CinePRO'));
    var inEmail = el('div', 'ig-input');
    inEmail.textContent = 'editor@estudio.com.br';
    inEmail.style.marginBottom = '8px';
    var inSenha = el('div', 'ig-input');
    inSenha.textContent = '••••••••';
    inSenha.style.marginBottom = '12px';
    app.appendChild(inEmail); app.appendChild(inSenha);
    app.appendChild(el('div', 'ig-btn is-on', 'Entrar'));
    var dica = el('div', 'ig-status', 'As mesmas credenciais do passo 1');
    app.appendChild(dica);
    t.appendChild(app);

    return {
      beat: function (b) {
        caixaBeat.textContent = b >= 3 ? 'Mesmas credenciais' : b >= 2 ? 'Login do app' : b >= 1 ? 'Instalando' : '';
        inst.style.opacity = b >= 1 ? (b >= 2 ? '0.32' : '1') : '0';
        inst.style.transform = b >= 2 ? 'translateY(-50%) scale(.97)' : 'translateY(-50%)';
        fill.style.width = (b >= 1 ? 100 : 10) + '%';
        fill.className = b >= 1 ? 'is-done' : '';
        app.style.opacity = b >= 2 ? '1' : '0';
        app.style.transform = b >= 2 ? 'translateY(-50%)' : 'translateY(calc(-50% + 16px))';
        inEmail.className = 'ig-input' + (b >= 3 ? ' is-filled' : '');
        inSenha.className = 'ig-input' + (b >= 3 ? ' is-filled' : '');
        dica.className = 'ig-status' + (b >= 3 ? ' is-ok' : '');
      }
    };
  }

  // ─── 5. Trial ──────────────────────────────────────────────
  function passo5() {
    caixaTexto.appendChild(el('h3', 'ig-h', 'Iniciar a avaliação de 3 dias'));
    paragrafo(caixaTexto, 'Dentro do app, clique em <strong>Começar trial</strong>. Você cadastra um cartão nesse momento.');
    paragrafo(caixaTexto, 'Você <strong>não paga nada nos 3 dias</strong>. Cancelou antes do fim do terceiro dia, cobrança zero. A primeira cobrança só acontece se o trial chegar ao fim sem cancelamento.');
    bloco(caixaTexto, 'ig-info', 'Por que pedimos cartão', 'Pra o trial virar assinatura sozinho se você continuar. É o mesmo cartão da assinatura, cadastrado antes — não é cobrança antecipada.');

    var t = tela('Reprodução — trial');
    var corpo = chrome(t, 'CinePRO · assinatura');

    corpo.appendChild(el('div', 'ig-file-n', 'Avaliação de 3 dias'));
    var sub = el('div', 'ig-file-s', 'Acesso completo aos 500 efeitos');
    sub.style.marginBottom = '14px';
    corpo.appendChild(sub);

    var btn = el('div', 'ig-btn is-on', 'Começar trial');
    corpo.appendChild(btn);

    var track = el('div', 'ig-trial-track');
    var fill = el('span');
    track.appendChild(fill);
    corpo.appendChild(track);

    var marcas = el('div', 'ig-trial-marks');
    var dados = [['Hoje', 'Cartão cadastrado · R$ 0'], ['Dias 1 e 2', 'Acesso completo · R$ 0'], ['Fim do dia 3', 'Primeira cobrança']];
    var dots = [];
    dados.forEach(function (par) {
      var d = el('div');
      var dot = el('div', 'ig-trial-dot');
      dots.push(dot);
      d.appendChild(dot);
      d.appendChild(el('b', null, par[0]));
      d.appendChild(el('span', null, par[1]));
      marcas.appendChild(d);
    });
    corpo.appendChild(marcas);

    var cancel = el('div', 'ig-status is-ok', 'Cancelou antes do fim do dia 3: R$ 0');
    cancel.style.textAlign = 'center';
    corpo.appendChild(cancel);

    return {
      beat: function (b) {
        caixaBeat.textContent = b >= 3 ? 'Cancelar custa R$ 0' : b >= 1 ? 'Trial ativo' : '';
        btn.textContent = b >= 1 ? 'Trial ativo' : 'Começar trial';
        btn.className = 'ig-btn ' + (b >= 1 ? 'is-ok' : 'is-on');
        fill.style.width = (b >= 2 ? (b >= 3 ? 66.66 : 100) : 0) + '%';
        dots[1].style.background = b >= 3 ? 'var(--success)' : 'rgba(255,255,255,.18)';
        dots[2].style.background = (b >= 2 && b < 3) ? 'var(--warning)' : 'rgba(255,255,255,.18)';
        cancel.style.opacity = b >= 3 ? '1' : '0';
      }
    };
  }

  // ─── 6. Plugin do Premiere ─────────────────────────────────
  function passo6() {
    caixaTexto.appendChild(el('h3', 'ig-h', 'Instalar o plugin do Premiere'));
    paragrafo(caixaTexto, 'No CinePRO, clique em <strong>Instalar plugin</strong>. A instalação leva segundos.');
    paragrafo(caixaTexto, 'Depois é preciso <strong>reiniciar o Premiere</strong>: feche por completo e abra de novo. Com ele aberto, o painel fica em <strong>Janela → Extensões → CinePRO</strong>.');
    bloco(caixaTexto, 'ig-warn', 'Não achou o painel?', 'Quase sempre é o Premiere que não foi reiniciado. Sem reabrir, o menu Extensões continua sem a entrada — e parece que a instalação falhou.');

    var t = tela('Reprodução — instalação do plugin');
    var corpo = chrome(t, 'CinePRO · plugin');

    corpo.appendChild(el('div', 'ig-file-n', 'Plugin do Premiere Pro'));
    var estado = el('div', 'ig-file-s', 'Não instalado');
    estado.style.marginBottom = '12px';
    corpo.appendChild(estado);
    var btn = el('div', 'ig-btn is-on', 'Instalar plugin');
    corpo.appendChild(btn);
    var restart = el('div', 'ig-status is-warn', 'Feche e reabra o Premiere antes de procurar o painel');
    corpo.appendChild(restart);

    var pr = el('div', 'ig-pr');
    pr.style.marginTop = '14px';
    var bar = el('div', 'ig-pr-bar');
    var itensBar = ['Arquivo', 'Editar', 'Clipe', 'Sequência', 'Janela', 'Ajuda'];
    var spanJanela = null;
    itensBar.forEach(function (n) {
      var s = el('span', null, n);
      if (n === 'Janela') spanJanela = s;
      bar.appendChild(s);
    });
    pr.appendChild(bar);

    var menus = el('div', 'ig-pr-menus');
    var drop = el('div', 'ig-pr-drop');
    var itExt = null;
    ['Espaços de trabalho', 'Barras de ferramentas', 'Extensões', 'Efeitos', 'Linha do tempo'].forEach(function (n) {
      var i = el('i');
      i.appendChild(el('span', null, n));
      if (n === 'Extensões') { i.appendChild(el('span', null, '▸')); itExt = i; }
      drop.appendChild(i);
    });
    menus.appendChild(drop);

    var sub = el('div', 'ig-pr-sub');
    var itCine = el('i');
    itCine.appendChild(el('span', null, 'CinePRO'));
    sub.appendChild(itCine);
    menus.appendChild(sub);
    pr.appendChild(menus);
    pr.appendChild(el('div', 'ig-pr-cap', 'Adobe Premiere Pro · reprodução do caminho de menu'));
    corpo.appendChild(pr);

    return {
      beat: function (b) {
        caixaBeat.textContent = b >= 4 ? 'Janela → Extensões → CinePRO'
          : b >= 3 ? 'Menu Janela' : b >= 2 ? 'Reiniciar o Premiere'
          : b >= 1 ? 'Plugin instalado' : '';
        btn.textContent = b >= 1 ? 'Plugin instalado' : 'Instalar plugin';
        btn.className = 'ig-btn ' + (b >= 1 ? 'is-ok' : 'is-on');
        estado.textContent = b >= 1 ? 'Instalado — falta reiniciar o Premiere' : 'Não instalado';
        estado.style.color = b >= 1 ? 'var(--warning)' : 'var(--text-faint)';
        restart.style.opacity = b >= 2 ? '1' : '0';
        spanJanela.className = b >= 3 ? 'is-hot' : '';
        drop.style.opacity = b >= 3 ? '1' : '0';
        drop.style.transform = b >= 3 ? 'translateY(0)' : 'translateY(-8px)';
        itExt.className = b >= 3 ? 'is-hot' : '';
        sub.style.opacity = b >= 4 ? '1' : '0';
        sub.style.transform = b >= 4 ? 'translateX(0)' : 'translateX(-10px)';
        itCine.className = b >= 4 ? 'is-hot' : '';
      }
    };
  }

  // ─── 7. Resolve ────────────────────────────────────────────
  function passo7() {
    caixaTexto.appendChild(el('h3', 'ig-h', 'DaVinci Resolve, se for o caso'));
    paragrafo(caixaTexto, 'São dois caminhos. O primeiro <strong>não exige instalar nada</strong>: busque o efeito no app, clique pra baixar e arraste a linha direto pra timeline do Resolve.');
    paragrafo(caixaTexto, 'Pra mandar vários de uma vez: marque os efeitos com <strong>→ Resolve</strong>, posicione o playhead e rode <strong>Workspace → Scripts → CinePRO Import</strong>. Eles entram no playhead, na primeira trilha de áudio livre.');
    bloco(caixaTexto, 'ig-warn', 'É preciso reiniciar o Resolve', 'O script é instalado pelo próprio app, mas só aparece no menu Scripts depois que o Resolve reabre.');
    bloco(caixaTexto, 'ig-info', 'Versão', 'Funciona no Resolve gratuito. Não precisa do Studio.');

    var t = tela('Reprodução — Resolve');
    var corpo = chrome(t, 'CinePRO · busca');

    var abas = el('div', 'ig-tabs');
    var bDrag = el('button', null, 'Arrastar um efeito');
    var bLote = el('button', null, 'Em lote, pelo script');
    bDrag.type = 'button'; bLote.type = 'button';
    bDrag.setAttribute('role', 'tab'); bLote.setAttribute('role', 'tab');
    abas.appendChild(bDrag); abas.appendChild(bLote);
    corpo.appendChild(abas);

    bDrag.addEventListener('click', function () {
      if (est.abaResolve === 'drag') return;
      est.abaResolve = 'drag'; montarPasso(); iniciar();
    });
    bLote.addEventListener('click', function () {
      if (est.abaResolve === 'batch') return;
      est.abaResolve = 'batch'; montarPasso(); iniciar();
    });

    var r1 = el('div', 'ig-row');
    r1.appendChild(el('span', null, 'Whoosh Impact 04 · 00:02'));
    var c1 = el('span', 'ig-chip', '');
    r1.appendChild(c1); corpo.appendChild(r1);

    var r2 = el('div', 'ig-row');
    r2.appendChild(el('span', null, 'Riser Tension 11 · 00:04'));
    var c2 = el('span', 'ig-chip', '');
    r2.appendChild(c2); corpo.appendChild(r2);

    var tl = el('div', 'ig-tl');
    var cab = el('div', 'ig-file');
    cab.appendChild(el('span', 'ig-file-s', 'Timeline do Resolve'));
    var acao = el('span', 'ig-chip', '');
    cab.appendChild(acao);
    tl.appendChild(cab);

    var trilhas = [];
    ['V1', 'A1', 'A2'].forEach(function (n) {
      var tr = el('div', 'ig-tl-track');
      tr.appendChild(el('b', null, n));
      tl.appendChild(tr);
      trilhas.push(tr);
    });
    var clip = el('div', 'ig-clip');
    clip.style.opacity = '0';
    trilhas[2].appendChild(clip);
    var clip2 = el('div', 'ig-clip');
    clip2.style.opacity = '0';
    trilhas[2].appendChild(clip2);
    var ph = el('div', 'ig-playhead');
    ph.style.opacity = '0';
    trilhas[0].appendChild(ph);
    corpo.appendChild(tl);

    return {
      beat: function (b) {
        var drag = est.abaResolve === 'drag';
        bDrag.setAttribute('aria-selected', drag ? 'true' : 'false');
        bLote.setAttribute('aria-selected', drag ? 'false' : 'true');
        caixaBeat.textContent = drag ? (b >= 3 ? 'Na timeline' : b >= 1 ? 'Baixado' : '')
                                     : (b >= 3 ? 'Importados no playhead' : b >= 1 ? 'Marcados' : '');
        r1.className = 'ig-row' + (b >= 1 ? ' is-hot' : '');
        r2.className = 'ig-row' + (!drag && b >= 1 ? ' is-hot' : '');
        c1.textContent = drag ? (b >= 2 ? 'arrastando' : b >= 1 ? 'baixado' : 'baixar')
                              : (b >= 1 ? '→ Resolve' : 'enviar');
        c1.className = 'ig-chip' + (b >= 1 ? ' is-hot' : '');
        c2.textContent = drag ? 'baixar' : (b >= 1 ? '→ Resolve' : 'enviar');
        c2.className = 'ig-chip' + (!drag && b >= 1 ? ' is-hot' : '');
        acao.textContent = drag ? (b >= 3 ? 'linha na timeline' : 'arraste pra trilha A2')
                                : (b >= 2 ? 'Workspace → Scripts → CinePRO Import' : 'playhead posicionado');
        acao.className = 'ig-chip' + (b >= 2 ? ' is-hot' : '');
        ph.style.left = drag ? '18%' : '42%';
        ph.style.opacity = b >= 1 ? '1' : '0';
        clip.style.left = (drag ? (b >= 3 ? 18 : 60) : 42) + '%';
        clip.style.width = (drag ? 22 : 18) + '%';
        clip.style.opacity = b >= 3 ? '1' : '0';
        clip2.style.left = '62%';
        clip2.style.width = '18%';
        clip2.style.opacity = (!drag && b >= 3) ? '1' : '0';
      }
    };
  }

  // ─── Animação ──────────────────────────────────────────────
  function aplicarBeat(b) {
    est.beat = b;
    if (atual && atual.beat) atual.beat(b);
  }

  function iniciar() {
    pararTudo();
    est.beat = 0; est.digitado = ''; est.progresso = 0; est.fase = 'idle';

    // Sem animação pra quem pediu menos movimento: entrega o estado
    // final direto. O conteúdo é suporte — não pode depender do movimento.
    if (menosMovimento) {
      est.digitado = CMD;
      est.progresso = 100; est.fase = 'done';
      aplicarBeat(est.passo === 2 && est.os === 'windows' ? 5 : BEAT_FINAL[est.passo]);
      return;
    }

    aplicarBeat(0);
    var p = est.passo;

    if (p === 0) { em(420, function () { aplicarBeat(1); }); em(1700, function () { aplicarBeat(2); }); }
    else if (p === 1) { em(400, function () { est.fase = 'run'; rodarProgresso(); }); }
    else if (p === 2 && est.os === 'macos') {
      em(300, function () { aplicarBeat(1); });
      em(2700, function () { aplicarBeat(2); });
      em(3300, digitarCmd);
    }
    else if (p === 2) {
      em(260, function () { aplicarBeat(1); });
      em(1500, function () { aplicarBeat(2); });
      em(2500, function () { aplicarBeat(3); if (atual.pulso) atual.pulso(); });
      em(3700, function () { aplicarBeat(4); });
      em(4700, function () { aplicarBeat(5); if (atual.pulso) atual.pulso(); });
    }
    else if (p === 3) { em(300, f(1)); em(1900, f(2)); em(3100, f(3)); }
    else if (p === 4) { em(320, f(1)); em(1300, f(2)); em(2600, f(3)); }
    else if (p === 5) { em(300, f(1)); em(1400, f(2)); em(2500, f(3)); em(3400, f(4)); }
    else if (p === 6) { em(320, f(1)); em(1500, f(2)); em(2700, f(3)); }

    function f(n) { return function () { aplicarBeat(n); }; }
  }

  // O download trava de propósito em ~61%: é o momento em que a
  // pessoa acha que quebrou e cancela. Mostrar isso acontecendo,
  // com o rótulo dizendo que é normal, é metade do valor do passo 2.
  function rodarProgresso() {
    var travou = false;
    intProgresso = setInterval(function () {
      if (!travou && est.progresso >= 61) {
        travou = true;
        clearInterval(intProgresso); intProgresso = null;
        est.fase = 'stall';
        if (atual.pintar) atual.pintar();
        em(1600, function () {
          est.fase = 'run';
          intProgresso = setInterval(tick, 45);
        });
        return;
      }
      tick();
    }, 45);

    function tick() {
      est.progresso = Math.min(100, est.progresso + 1.7);
      if (est.progresso >= 100) {
        clearInterval(intProgresso); intProgresso = null;
        est.fase = 'done';
        est.progresso = 100;
      }
      if (atual.pintar) atual.pintar();
    }
  }

  function digitarCmd() {
    var i = 0;
    intDigita = setInterval(function () {
      i += 1;
      est.digitado = CMD.slice(0, i);
      if (atual.digitado) atual.digitado.textContent = est.digitado;
      if (i >= CMD.length) {
        clearInterval(intDigita); intDigita = null;
        em(1000, function () { aplicarBeat(3); });
      }
    }, 24);
  }

  function copiar(btn) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = CMD;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(CMD)['catch'](fallback);
    } else fallback();
    btn.textContent = 'Copiado';
    btn.className = 'is-copied';
    setTimeout(function () {
      btn.textContent = 'Copiar';
      btn.className = '';
    }, 1800);
  }

  // ─── Navegação ─────────────────────────────────────────────
  function irPara(i) {
    var n = Math.max(0, Math.min(PASSOS.length - 1, i));
    if (n === est.passo) return;
    est.passo = n;
    pintarTrail(); pintarNav(); montarPasso(); iniciar();
  }

  function trocarOs(os) {
    if (os === est.os) return;
    est.os = os;
    pintarOs(); montarPasso(); iniciar();
  }

  for (var i = 0; i < btnsOs.length; i++) {
    (function (b) {
      b.addEventListener('click', function () { trocarOs(b.getAttribute('data-ig-os')); });
    })(btnsOs[i]);
  }
  btnPrev.addEventListener('click', function () { irPara(est.passo - 1); });
  btnProx.addEventListener('click', function () { irPara(est.passo + 1); });
  btnReplay.addEventListener('click', function () { iniciar(); });

  // Setas do teclado só quando o guia está na tela — senão a página
  // inteira sequestra a navegação de quem só está rolando.
  document.addEventListener('keydown', function (e) {
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var r = raiz.getBoundingClientRect();
    if (r.bottom < 0 || r.top > (window.innerHeight || 0)) return;
    e.preventDefault();
    irPara(est.passo + (e.key === 'ArrowRight' ? 1 : -1));
  });

  window.addEventListener('resize', function () {
    if (atual && atual.mirar) atual.mirar(est.beat);
  });

  // ─── Arranque ──────────────────────────────────────────────
  est.os = detectarOs();
  pintarOs(); pintarTrail(); pintarNav(); montarPasso();

  // Só anima quando o guia entra na tela: animação que já rodou
  // antes de a pessoa chegar nela não ensina nada.
  var jaRodou = false;
  if (window.IntersectionObserver) {
    var obs = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (en.isIntersecting && !jaRodou) { jaRodou = true; iniciar(); }
      });
    }, { threshold: 0.25 });
    obs.observe(raiz);
  } else {
    iniciar();
  }
})();
