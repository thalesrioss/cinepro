-- =============================================================
--  CinePRO — painel para DaVinci Resolve
--
--  Mesmo fluxo do plugin do Premiere: barra lateral (Todos,
--  Favoritos, Recentes, Packs, Categorias), busca no topo, lista
--  de resultados e barra de status embaixo.
--
--  POR QUE LUA: o Resolve so enumera scripts .py se achar um
--  Python.framework instalado. Sem ele, IGNORA EM SILENCIO — nem
--  erro aparece. Lua e nativo do Fusion: zero pre-requisito.
--
--  POR QUE TSV E NAO JSON: o Lua do Resolve nao tem biblioteca
--  JSON (testado). O indice vem em linhas com TAB, e os packs sao
--  pre-calculados pelo MESMO motor do Premiere (js/sfx-engine.js)
--  — assim nao existem duas implementacoes da regra pra divergir.
--
--  A UNICA regra reimplementada aqui e a do diagnostico, porque
--  ela precisa rodar com a timeline aberta e nao da pra chamar JS
--  de dentro do Resolve. Pra ela nao divergir do motor do Premiere,
--  autoTesteDiag() roda em toda abertura contra valores gerados
--  pelo proprio js/diagnostics.js — se divergir, grita no Console.
--
--  Cache: MESMA pasta do app e do plugin, entao efeito ja baixado
--  num editor nao baixa de novo no outro.
-- =============================================================

local CDN_INDEX  = "https://cdn.jsdelivr.net/gh/thalesrioss/cinepro@main/data/lua-index.tsv"
local CDN_CONFIG = "https://cdn.jsdelivr.net/gh/thalesrioss/cinepro@main/data/lua-config.tsv"
local CDN_FILES = "https://pub-6ace91bcabf540f0a54bb6850d188ef4.r2.dev/"
-- Lote: o Qt fica lento se despejarmos 10 mil linhas de uma vez, e
-- ninguem rola isso. O Premiere carrega em lotes pelo mesmo motivo.
local LOTE = 300
local MAX_RECENTES = 30
local MAX_USADOS = 30   -- mesmo teto do getMostUsedIds(30) do Premiere

-- ── Ambiente ────────────────────────────────────────────────
local resolve = bmd.scriptapp("Resolve")
if not resolve then
  print("[CinePRO] Rode dentro do Resolve (Workspace > Scripts).")
  return
end

local fu = nil
pcall(function() fu = resolve:Fusion() end)
if not fu then pcall(function() fu = bmd.scriptapp("Fusion") end) end
if not fu then print("[CinePRO] Fusion indisponivel.") return end

local ui = fu.UIManager
local disp = bmd.UIDispatcher(ui)
if not ui or not disp then print("[CinePRO] UIManager indisponivel.") return end

local HOME = os.getenv("HOME") or ""
local BASE = HOME .. "/Library/Application Support/CinePRO"
local CACHE = BASE .. "/cache"
local INDICE = BASE .. "/lua-index.tsv"
local CONFIG = BASE .. "/lua-config.tsv"
local FAVS   = BASE .. "/favoritos.txt"
local RECS   = BASE .. "/recentes.txt"
local USOS   = BASE .. "/usos.txt"       -- id<TAB>contagem, alimenta "Mais usados"
local EMUSO  = BASE .. "/in-use.json"    -- registro compartilhado com app e plugin

-- ── Paleta (brandbook do CinePRO) ───────────────────────────
-- Os mesmos tokens de css/tokens.css, completos: as semanticas
-- (success/warning/danger) e as glows sao o que faz um estado
-- ser legivel sem ler o texto. Se o Qt do Fusion nao aceitar
-- stylesheet, o painel segue com a aparencia padrao — por isso
-- tudo entra via pcall.
local COR = {
  brand    = "#00B8FF",
  brandDeep= "#0066CC",
  bright   = "#4DD2FF",
  glow1    = "rgba(0,184,255,0.08)",
  glow2    = "rgba(0,184,255,0.18)",
  glow3    = "rgba(0,184,255,0.35)",
  s0       = "#07090F",
  s1       = "#0E1218",
  s2       = "#161B23",
  s3       = "#11161D",
  forte    = "#FFFFFF",
  texto    = "#E5E9F0",
  fraco    = "#8A95A8",
  apagado  = "#4A5566",
  bordaSutil = "rgba(255,255,255,0.06)",
  borda    = "rgba(255,255,255,0.10)",
  bordaBrand = "rgba(0,184,255,0.35)",
  ok       = "#22C55E",
  okGlow   = "rgba(34,197,94,0.18)",
  erro     = "#EF4444",
  erroGlow = "rgba(239,68,68,0.18)",
  aviso    = "#FFC74D",
  avisoGlow= "rgba(255,199,77,0.18)",
}

-- TextColor/BackgroundColor por celula recebem {R,G,B,A} em 0..1,
-- nao string CSS. Mesmos tokens, outra forma.
local function rgb(hex, a)
  local r, g, b = hex:match("#(%x%x)(%x%x)(%x%x)")
  return { R = tonumber(r, 16) / 255, G = tonumber(g, 16) / 255,
           B = tonumber(b, 16) / 255, A = a or 1 }
end
local RGB = {
  brand = rgb(COR.brand), bright = rgb(COR.bright),
  forte = rgb(COR.forte), texto = rgb(COR.texto),
  fraco = rgb(COR.fraco), apagado = rgb(COR.apagado),
  ok = rgb(COR.ok), erro = rgb(COR.erro), aviso = rgb(COR.aviso),
  brandGlow = rgb(COR.brand, 0.12), okGlow = rgb(COR.ok, 0.14),
  erroGlow = rgb(COR.erro, 0.14), avisoGlow = rgb(COR.aviso, 0.14),
  s2 = rgb(COR.s2),
}

local ESTILO = [[
  QWidget { background-color: ]] .. COR.s0 .. [[; color: ]] .. COR.texto .. [[; font-size: 12px; }

  /* Cabecalho */
  QLabel#Marca  { color: ]] .. COR.forte .. [[; font-size: 15px; font-weight: 700; }
  QLabel#Contagem { color: ]] .. COR.apagado .. [[; font-size: 11px; }

  /* Busca */
  QLineEdit { background-color: ]] .. COR.s3 .. [[; border: 1px solid ]] .. COR.borda .. [[;
              border-radius: 8px; padding: 8px 12px; color: ]] .. COR.texto .. [[;
              selection-background-color: ]] .. COR.brand .. [[; }
  QLineEdit:hover { border: 1px solid ]] .. COR.bordaBrand .. [[; }
  QLineEdit:focus { border: 1px solid ]] .. COR.brand .. [[; background-color: ]] .. COR.s1 .. [[; }

  /* Abas */
  QTabBar { background: transparent; }
  QTabBar::tab { background: transparent; color: ]] .. COR.fraco .. [[; padding: 8px 14px;
                 border: 0px; border-bottom: 2px solid transparent; font-weight: 600; }
  QTabBar::tab:hover { color: ]] .. COR.texto .. [[; }
  QTabBar::tab:selected { color: ]] .. COR.brand .. [[; border-bottom: 2px solid ]] .. COR.brand .. [[; }

  /* Listas */
  QTreeWidget { background-color: ]] .. COR.s1 .. [[; border: 1px solid ]] .. COR.borda .. [[;
                border-radius: 10px; outline: 0; padding: 4px; }
  QTreeWidget::item { padding: 4px 6px; border-radius: 6px; }
  QTreeWidget::item:hover { background-color: ]] .. COR.glow1 .. [[; }
  QTreeWidget::item:selected { background-color: ]] .. COR.glow2 .. [[; color: ]] .. COR.forte .. [[; }
  QTreeWidget::item:selected:hover { background-color: ]] .. COR.glow3 .. [[; }
  QTreeWidget::branch { background: transparent; }
  QHeaderView::section { background-color: transparent; color: ]] .. COR.apagado .. [[;
                         border: 0px; padding: 4px 6px; font-size: 10px; font-weight: 600; }

  /* Rolagem */
  QScrollBar:vertical { background: transparent; width: 8px; margin: 2px; }
  QScrollBar::handle:vertical { background: ]] .. COR.borda .. [[; border-radius: 4px; min-height: 24px; }
  QScrollBar::handle:vertical:hover { background: ]] .. COR.bordaBrand .. [[; }
  QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0px; }

  /* Botoes: secundario e o padrao; primario e ghost por ID */
  QPushButton { background-color: ]] .. COR.s2 .. [[; color: ]] .. COR.texto .. [[;
                border: 1px solid ]] .. COR.borda .. [[; border-radius: 8px;
                padding: 8px 14px; font-weight: 600; }
  QPushButton:hover { border: 1px solid ]] .. COR.bordaBrand .. [[; background-color: ]] .. COR.s3 .. [[; }
  QPushButton:pressed { background-color: ]] .. COR.glow2 .. [[; }
  QPushButton:disabled { color: ]] .. COR.apagado .. [[; border-color: ]] .. COR.bordaSutil .. [[; }
  QPushButton#Colocar { background-color: ]] .. COR.brand .. [[; color: #04121A; border: 0px; }
  QPushButton#Colocar:hover { background-color: ]] .. COR.bright .. [[; }
  QPushButton#Colocar:disabled { background-color: ]] .. COR.s2 .. [[; color: ]] .. COR.apagado .. [[; }
  QPushButton#Ouvir:checked { background-color: ]] .. COR.glow2 .. [[; color: ]] .. COR.brand .. [[;
                              border: 1px solid ]] .. COR.brand .. [[; }
  QPushButton#Favorito:checked { color: ]] .. COR.aviso .. [[; border: 1px solid ]] .. COR.aviso .. [[;
                                 background-color: ]] .. COR.avisoGlow .. [[; }
  QPushButton#Mais, QPushButton#Atualizar, QPushButton#Repetir {
                background: transparent; border: 1px solid transparent; color: ]] .. COR.fraco .. [[; }
  QPushButton#Mais:hover, QPushButton#Atualizar:hover, QPushButton#Repetir:hover {
                color: ]] .. COR.brand .. [[; border: 1px solid ]] .. COR.bordaSutil .. [[; }

  /* Barra de status: a cor vem do estado, via propriedade dinamica */
  QLabel { color: ]] .. COR.fraco .. [[; }
  QLabel#Status { font-size: 11px; padding: 6px 10px; border-radius: 6px;
                  background-color: ]] .. COR.s1 .. [[; }
  QLabel#Dica   { color: ]] .. COR.apagado .. [[; font-size: 10px; }
  QLabel#Vazio  { color: ]] .. COR.fraco .. [[; font-size: 13px; padding: 24px; }

  QToolTip { background-color: ]] .. COR.s2 .. [[; color: ]] .. COR.texto .. [[;
             border: 1px solid ]] .. COR.borda .. [[; padding: 6px 8px; border-radius: 6px; }
]]

-- ── Utilidades ──────────────────────────────────────────────
local function shell(cmd)
  local p = io.popen(cmd)
  if not p then return nil end
  local out = p:read("*a")
  p:close()
  return out
end

local function existe(caminho)
  local f = io.open(caminho, "r")
  if f then f:close() return true end
  return false
end

local function baixar(url, destino)
  local pasta = destino:match("^(.*)/[^/]*$")
  if pasta then os.execute('mkdir -p "' .. pasta .. '"') end
  shell('curl -sL --max-time 120 -o "' .. destino .. '" "' .. url .. '"')
  return existe(destino)
end

-- Mesmo nome do app, senao o cache nao e compartilhado entre editores.
local function nomeCache(id, nome, ext)
  local seguro = nome:gsub("[^%w%s%-%._]", "_")
  return CACHE .. "/" .. id:sub(1, 8) .. "_" .. seguro .. "." .. ext
end

local function semAcento(s)
  s = s:lower()
  local de = { ["á"]="a",["à"]="a",["ã"]="a",["â"]="a",["é"]="e",["ê"]="e",
               ["í"]="i",["ó"]="o",["ô"]="o",["õ"]="o",["ú"]="u",["ç"]="c" }
  for k, v in pairs(de) do s = s:gsub(k, v) end
  return s
end

local function lerLinhas(caminho)
  local out = {}
  local f = io.open(caminho, "r")
  if not f then return out end
  for l in f:lines() do if l ~= "" then out[#out + 1] = l end end
  f:close()
  return out
end

local function gravarLinhas(caminho, lista)
  os.execute('mkdir -p "' .. BASE .. '"')
  local f = io.open(caminho, "w")
  if not f then return end
  for i = 1, #lista do f:write(lista[i], "\n") end
  f:close()
end

-- ── Estado ──────────────────────────────────────────────────
local EFEITOS, PORID = {}, {}
local PORPREFIXO = {}          -- 8 primeiros chars do id → efeito
local CATEGORIAS, PACKS = {}, {}
local SUBS, CONTA_CAT = {}, {} -- categoria → subcategorias / contagem
local expandido = {}           -- categoria → aberta na lateral
local favoritos, recentes = {}, {}
local ehFav, usos = {}, {}

-- Limites do diagnostico. Valores aqui sao so o PISO — os de verdade
-- vem de data/lua-config.tsv, exportado do mesmo diagnostics.json que
-- o plugin usa, pra nao existirem dois conjuntos de numeros.
local CFG = { limitVertical = 2, limitHorizontal = 5, hardLimit = 8,
              hookWindow = 5, maxFindings = 40 }

local NOME_PACK = {}

local function carregarConfig()
  if not existe(CONFIG) then baixar(CDN_CONFIG, CONFIG) end
  local f = io.open(CONFIG, "r")
  if not f then return end
  for l in f:lines() do
    local k, v = l:match("^([^\t]+)\t(.+)$")
    if k then
      local pack = k:match("^pack%.(.+)$")
      if pack then NOME_PACK[pack] = v
      elseif tonumber(v) then CFG[k] = tonumber(v) end
    end
  end
  f:close()
end

local function trocarArquivo(de, para)
  local ok = pcall(function() return os.rename(de, para) end)
  if not ok or existe(de) then
    os.execute('mv -f "' .. de .. '" "' .. para .. '"')
  end
end

-- `tentativa` e interno: o painel chama sem, e a recuperacao de
-- formato antigo rechama com 2 pra nao poder ficar em loop.
--
-- NADA e publicado nos globais antes do arquivo ler inteiro. Um
-- download truncado (ja aconteceu, o r2.dev devolveu 429 em 8 mil
-- pedidos) ou um catalogo de formato antigo nao pode derrubar o
-- catalogo que ja estava funcionando na tela.
local function carregarIndice(forcar, tentativa)
  local origem, temp = INDICE, nil
  if forcar or not existe(INDICE) then
    temp = INDICE .. ".novo"
    if baixar(CDN_INDEX, temp) then
      origem = temp
    else
      os.remove(temp)
      temp = nil
      if not existe(INDICE) then return 0, "falha ao baixar o catálogo" end
    end
  end

  local f = io.open(origem, "r")
  if not f then return 0, "não consegui abrir o catálogo" end

  local efeitos, porId, porPrefixo = {}, {}, {}
  local categorias, packs_ = {}, {}
  local subs, contaCat = {}, {}
  local vistasCat, vistosPack = {}, {}
  local vistasSub = {}

  for linha in f:lines() do
    local id, nome, ext, dur, cat, sub, packs =
      linha:match("^([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)$")
    if id and id ~= "" then
      local e = {
        id = id, nome = nome, ext = ext, dur = tonumber(dur) or 0,
        cat = cat, sub = sub, packs = packs, busca = semAcento(nome),
      }
      efeitos[#efeitos + 1] = e
      porId[id] = e
      -- O cache guarda so os 8 primeiros chars do id no nome do
      -- arquivo. E por este mapa que "Restaurar midias" descobre
      -- qual efeito era, olhando so o caminho que sobrou no projeto.
      porPrefixo[id:sub(1, 8)] = e
      if cat ~= "" then
        if not vistasCat[cat] then
          vistasCat[cat] = true
          categorias[#categorias + 1] = cat
          subs[cat] = {}
          vistasSub[cat] = {}
        end
        contaCat[cat] = (contaCat[cat] or 0) + 1
        if sub ~= "" then
          local vs = vistasSub[cat]
          if not vs[sub] then
            vs[sub] = { nome = sub, n = 0 }
            subs[cat][#subs[cat] + 1] = vs[sub]
          end
          vs[sub].n = vs[sub].n + 1
        end
      end
      for p in packs:gmatch("[^,]+") do
        if not vistosPack[p] then vistosPack[p] = true; packs_[#packs_ + 1] = p end
      end
    end
  end
  f:close()

  -- Zero efeitos = arquivo ilegivel (formato antigo em cache, ou
  -- download truncado). Painel vazio SEM erro nao seria diagnostico
  -- nenhum — o usuario acharia que a biblioteca sumiu.
  if #efeitos == 0 then
    if temp then os.remove(temp) end
    if not forcar and (tentativa or 1) < 2 then return carregarIndice(true, 2) end
    if #EFEITOS > 0 then
      -- Ja tinha catalogo bom carregado: mantem o que funciona.
      return #EFEITOS, "catálogo novo veio ilegível — mantive o anterior"
    end
    return 0, "catálogo ilegível — tente Atualizar catálogo"
  end

  -- Leu inteiro: agora sim o arquivo novo vira o oficial.
  if temp then trocarArquivo(temp, INDICE) end

  table.sort(categorias)
  table.sort(packs_)
  for _, lista in pairs(subs) do
    table.sort(lista, function(a, b) return a.nome < b.nome end)
  end

  EFEITOS, PORID, PORPREFIXO = efeitos, porId, porPrefixo
  CATEGORIAS, PACKS = categorias, packs_
  SUBS, CONTA_CAT = subs, contaCat
  return #EFEITOS, nil
end

local function carregarPrefs()
  favoritos = lerLinhas(FAVS)
  recentes  = lerLinhas(RECS)
  ehFav = {}
  for i = 1, #favoritos do ehFav[favoritos[i]] = true end
end

local function alternarFavorito(id)
  if ehFav[id] then
    ehFav[id] = nil
    for i = #favoritos, 1, -1 do
      if favoritos[i] == id then table.remove(favoritos, i) end
    end
  else
    ehFav[id] = true
    favoritos[#favoritos + 1] = id
  end
  gravarLinhas(FAVS, favoritos)
end

local function carregarUsos()
  usos = {}
  local f = io.open(USOS, "r")
  if not f then return end
  for l in f:lines() do
    local id, n = l:match("^([^\t]+)\t(%d+)$")
    if id then usos[id] = tonumber(n) end
  end
  f:close()
end

local function gravarUsos()
  os.execute('mkdir -p "' .. BASE .. '"')
  local f = io.open(USOS, "w")
  if not f then return end
  for id, n in pairs(usos) do f:write(id, "\t", n, "\n") end
  f:close()
end

-- Registro compartilhado com o app e o plugin do Premiere. E o que
-- permite "Restaurar midias" saber o que o projeto usou, e o que
-- protege o arquivo da limpeza de cache.
local function registrarEmUso(caminho, e)
  local f = io.open(EMUSO, "r")
  local txt = f and f:read("*a") or "{}"
  if f then f:close() end
  -- Sem parser JSON: insere a entrada antes da ultima chave. Formato
  -- simples o bastante pra isso ser seguro, e o app/plugin so leem.
  local entrada = string.format('%q:{"id":%q,"ext":%q,"name":%q,"at":%d}',
    caminho, e.id, e.ext, e.nome, os.time() * 1000)
  local novo
  if txt:match("^%s*{%s*}%s*$") then
    novo = "{" .. entrada .. "}"
  elseif txt:find(caminho, 1, true) then
    novo = txt   -- ja registrado
  else
    novo = txt:gsub("}%s*$", "," .. entrada .. "}")
  end
  local w = io.open(EMUSO, "w")
  if w then w:write(novo) w:close() end
end

local function registrarUso(id)
  usos[id] = (usos[id] or 0) + 1
  gravarUsos()
  for i = #recentes, 1, -1 do
    if recentes[i] == id then table.remove(recentes, i) end
  end
  table.insert(recentes, 1, id)
  while #recentes > MAX_RECENTES do table.remove(recentes) end
  gravarLinhas(RECS, recentes)
end

-- ── Filtro ──────────────────────────────────────────────────
-- categoria: "todos" | "favoritos" | "recentes" | "mais-usados"
--          | "pack:<id>" | "cat:<nome>" | "sub:<cat>\1<sub>"
local function filtrar(categoria, termo)
  local achados = {}
  local t = (termo and termo ~= "") and semAcento(termo) or nil

  local function cabe(e)
    if t and not e.busca:find(t, 1, true) then return false end
    return true
  end

  if categoria == "favoritos" then
    for i = 1, #favoritos do
      local e = PORID[favoritos[i]]
      if e and cabe(e) then achados[#achados + 1] = e end
    end
    return achados
  end
  if categoria == "mais-usados" then
    -- Corta os 30 mais usados ANTES de aplicar a busca, igual ao
    -- Premiere: "Mais usados" e uma lista curta, e buscar dentro
    -- dela filtra a lista — nao vira busca no acervo inteiro.
    local ordenado = {}
    for id, n in pairs(usos) do
      local e = PORID[id]
      if e then ordenado[#ordenado + 1] = { e = e, n = n, id = id } end
    end
    -- Desempate pelo id: pairs() nao garante ordem, e sem isso a
    -- lista se remontaria diferente a cada abertura do painel.
    table.sort(ordenado, function(a, b)
      if a.n ~= b.n then return a.n > b.n end
      return a.id < b.id
    end)
    for i = 1, math.min(#ordenado, MAX_USADOS) do
      if cabe(ordenado[i].e) then achados[#achados + 1] = ordenado[i].e end
    end
    return achados
  end
  if categoria == "recentes" then
    for i = 1, #recentes do
      local e = PORID[recentes[i]]
      if e and cabe(e) then achados[#achados + 1] = e end
    end
    return achados
  end

  local pack = categoria:match("^pack:(.+)$")
  local cat  = categoria:match("^cat:(.+)$")
  -- Chave de subcategoria carrega a categoria junto (separadas por
  -- byte 1): "Whoosh" existe em mais de uma categoria, e clicar numa
  -- nao pode trazer os efeitos da outra.
  local subCat, subNome
  local sub = categoria:match("^sub:(.+)$")
  if sub then subCat, subNome = sub:match("^([^\1]*)\1(.+)$") end

  for i = 1, #EFEITOS do
    local e = EFEITOS[i]
    local ok = true
    if pack then
      ok = false
      for p in e.packs:gmatch("[^,]+") do if p == pack then ok = true; break end end
    elseif subNome then
      ok = (e.cat == subCat and e.sub == subNome)
    elseif cat then
      ok = (e.cat == cat)
    end   -- "Todos" sem filtro mostra tudo; o lote limita o que entra na arvore
    if ok and cabe(e) then achados[#achados + 1] = e end
  end
  return achados
end

-- ── Timeline ────────────────────────────────────────────────
local function tcParaFrames(tc, fps)
  local h, m, s, f = tostring(tc):gsub(";", ":"):match("(%d+):(%d+):(%d+):(%d+)")
  if not h then return nil end
  return math.floor(((tonumber(h) * 3600 + tonumber(m) * 60 + tonumber(s)) * fps) + tonumber(f) + 0.5)
end

-- Primeira trilha de audio livre. Sem isto o Resolve usa a trilha
-- corrente e pode cobrir a voz do editor.
local function trilhaLivre(tl, inicio, dur)
  local total = tl:GetTrackCount("audio")
  local fim = inicio + math.max(1, dur)
  for idx = 1, total do
    local itens = tl:GetItemListInTrack("audio", idx)
    local ocupada = false
    if itens then
      local n = 0
      pcall(function() n = #itens end)
      for i = 1, n do
        local it = itens[i]
        -- pairs() nesta lista devolve NUMERO, nao o objeto — por isso
        -- indice numerico e checagem de tipo antes de chamar metodo.
        if it and type(it) ~= "number" then
          local ok1, ini = pcall(function() return it:GetStart() end)
          local ok2, f2  = pcall(function() return it:GetEnd() end)
          if ok1 and ok2 and ini < fim and f2 > inicio then ocupada = true; break end
        end
      end
    end
    if not ocupada then return idx end
  end
  return nil
end

local function colocar(efeito)
  local pm = resolve:GetProjectManager()
  local proj = pm and pm:GetCurrentProject() or nil
  if not proj then return false, "Abra um projeto primeiro." end
  local tl = proj:GetCurrentTimeline()
  if not tl then return false, "Abra uma timeline primeiro." end

  local caminho = nomeCache(efeito.id, efeito.nome, efeito.ext)
  if not existe(caminho) then
    if not baixar(CDN_FILES .. efeito.id .. "." .. efeito.ext, caminho) then
      return false, "Falha ao baixar o efeito."
    end
  end

  local mp = proj:GetMediaPool()
  local raiz = mp:GetRootFolder()
  local destino = nil
  local subs = raiz:GetSubFolderList()
  if subs then
    local n = 0
    pcall(function() n = #subs end)
    for i = 1, n do
      local sf = subs[i]
      if sf and type(sf) ~= "number" and sf:GetName() == "CinePRO" then destino = sf; break end
    end
  end
  if not destino then destino = mp:AddSubFolder(raiz, "CinePRO") end
  if destino then mp:SetCurrentFolder(destino) end

  local itens = mp:ImportMedia({ caminho })
  local n = 0
  if itens then pcall(function() n = #itens end) end
  if n == 0 then return false, "O Resolve recusou o arquivo." end

  local fps = tonumber(proj:GetSetting("timelineFrameRate")) or 24
  local playhead = tcParaFrames(tl:GetCurrentTimecode(), fps)
  if not playhead then return false, "Não consegui ler o playhead." end

  local durFrames = math.max(1, math.floor(efeito.dur * fps + 0.5))
  local trilha = trilhaLivre(tl, playhead, durFrames)
  if not trilha then
    pcall(function() tl:AddTrack("audio") end)
    trilha = tl:GetTrackCount("audio")
  end

  local ok, r = pcall(function()
    return mp:AppendToTimeline({{
      mediaPoolItem = itens[1],
      startFrame = 0, endFrame = durFrames - 1,
      recordFrame = playhead, mediaType = 2, trackIndex = trilha,
    }})
  end)
  if ok and r then
    registrarUso(efeito.id)
    return true, string.format('"%s" na A%d, no playhead.', efeito.nome, trilha)
  end
  return false, "Importado no bin CinePRO, mas não entrou na timeline."
end

-- ── Restaurar mídias ────────────────────────────────────────
-- Mesmo problema do Premiere: o editor abre o projeto noutra maquina
-- (ou limpou o cache) e os SFX do CinePRO ficam offline. Aqui o
-- caminho quebrado e a PISTA — o nome do arquivo comeca com os 8
-- primeiros chars do id, entao da pra descobrir o que baixar de novo.
--
-- DIFERENCA HONESTA pro Premiere: o Resolve nao expoe a selecao da
-- timeline pro script, entao aqui e sempre o projeto inteiro. Nao ha
-- perda — so nao da pra restaurar "so estes tres".

local function todosOsClipes(pasta, saida)
  local clipes = pasta:GetClipList()
  if clipes then
    local n = 0
    pcall(function() n = #clipes end)
    for i = 1, n do
      local c = clipes[i]
      if c and type(c) ~= "number" then saida[#saida + 1] = c end
    end
  end
  local subs = pasta:GetSubFolderList()
  if subs then
    local n = 0
    pcall(function() n = #subs end)
    for i = 1, n do
      local s = subs[i]
      if s and type(s) ~= "number" then todosOsClipes(s, saida) end
    end
  end
end

local function restaurarMidias(aviso)
  local pm = resolve:GetProjectManager()
  local proj = pm and pm:GetCurrentProject() or nil
  if not proj then return "Abra um projeto primeiro." end
  local mp = proj:GetMediaPool()
  local raiz = mp and mp:GetRootFolder() or nil
  if not raiz then return "Não consegui ler a mídia do projeto." end

  -- Mesma regra do Premiere: clipes selecionados na timeline?
  -- Restaura so eles. Nada selecionado? Projeto inteiro. A API
  -- Timeline:GetSelectedClips() chegou no Resolve 21.0.4 — antes
  -- disso o painel so sabia fazer o projeto todo.
  local clipes, escopo = {}, "projeto"
  local tl = proj:GetCurrentTimeline()
  if tl then
    local okSel, sel = pcall(function() return tl:GetSelectedClips() end)
    if okSel and type(sel) == "table" then
      local n = 0
      pcall(function() n = #sel end)
      for i = 1, n do
        local ti = sel[i]
        if ti and type(ti) ~= "number" then
          local okMp, mpi = pcall(function() return ti:GetMediaPoolItem() end)
          if okMp and mpi then clipes[#clipes + 1] = mpi end
        end
      end
      if #clipes > 0 then escopo = "seleção" end
    end
  end
  if #clipes == 0 then todosOsClipes(raiz, clipes) end

  local sumidos, refeitos, semPista = {}, 0, 0
  for i = 1, #clipes do
    local c = clipes[i]
    local ok, p = pcall(function() return c:GetClipProperty("File Path") end)
    if ok and type(p) == "string" and p ~= "" and p:sub(1, #CACHE) == CACHE then
      if not existe(p) then sumidos[#sumidos + 1] = { item = c, caminho = p } end
    end
  end

  if #sumidos == 0 then
    if escopo == "seleção" then return "A seleção já está no lugar — nada offline." end
    return "Nenhuma mídia do CinePRO offline — está tudo no lugar."
  end
  if aviso then aviso("Restaurando " .. #sumidos .. " mídia(s) da " .. escopo .. "…") end

  for i = 1, #sumidos do
    local alvo = sumidos[i]
    local arquivo = alvo.caminho:match("([^/]+)$") or ""
    -- Corte por posicao, nao por padrao: id do Drive tem "-" e "_"
    -- no meio (e o proprio nome tambem), entao "8 primeiros chars
    -- seguidos de _" e a unica leitura que nao erra.
    local prefixo = nil
    if #arquivo > 9 and arquivo:sub(9, 9) == "_" then prefixo = arquivo:sub(1, 8) end
    local e = prefixo and PORPREFIXO[prefixo] or nil
    if e then
      if baixar(CDN_FILES .. e.id .. "." .. e.ext, alvo.caminho) then
        refeitos = refeitos + 1
        registrarEmUso(alvo.caminho, e)
      end
    else
      semPista = semPista + 1
    end
  end

  -- Baixar de volta no mesmo caminho nao tira o clipe de offline
  -- sozinho: o Resolve so re-verifica quando mandamos religar.
  if refeitos > 0 then
    local itens = {}
    for i = 1, #sumidos do itens[#itens + 1] = sumidos[i].item end
    pcall(function() mp:RelinkClips(itens, CACHE) end)
  end

  local msg = refeitos .. " de " .. #sumidos .. " mídia(s) restaurada(s)"
    .. (escopo == "seleção" and " (só a seleção)." or ".")
  if semPista > 0 then
    msg = msg .. " " .. semPista .. " não estão no catálogo atual — clique em Atualizar catálogo."
  end
  return msg
end

-- ── Diagnóstico de retenção (ADR-011) ───────────────────────
-- Porte direto de js/diagnostics.js. Nao altera um frame: escreve
-- MARCADOR, e o editor apaga quando quiser.
--
-- Os limites NAO estao escritos aqui — vem de lua-config.tsv, que
-- sai do mesmo data/diagnostics.json que alimenta o Premiere.

local SEV_COR = { high = "Red", medium = "Yellow", low = "Cyan" }

local function arred(n) return math.floor(n * 100 + 0.5) / 100 end

-- O Lua 5.1 do Fusion imprime 14; o 5.3 imprime 14.0. Este texto vira
-- o NOME do marcador que o editor le na timeline — "14s" nas duas.
local function num(n)
  if n == math.floor(n) then return string.format("%d", n) end
  return (string.format("%.2f", n):gsub("0+$", ""):gsub("%.$", ""))
end

-- Cortes proximos demais sao o mesmo instante em trilhas diferentes:
-- 0,04s e um frame a 24fps, mesma tolerancia do motor do Premiere.
local function batidas(cortes)
  local b = {}
  for i = 1, #cortes do b[i] = cortes[i] end
  table.sort(b)
  local out = {}
  for i = 1, #b do
    if #out == 0 or math.abs(b[i] - out[#out]) >= 0.04 then out[#out + 1] = b[i] end
  end
  return out
end

-- tl = { cortes = {seg…}, dur = seg, w = px, h = px }
-- lim: so o auto-teste passa isto, pra conferir a REGRA com numeros
-- fixos. Se usasse CFG, mexer em diagnostics.json faria o teste
-- acusar divergencia que nao existe.
local function analisarRitmo(tl, lim)
  lim = lim or CFG
  -- Mesma leitura do motor JS: sem largura valida, trata como
  -- horizontal. Chutar vertical apertaria o limite pra 2s e encheria
  -- a timeline de marcador que nao procede.
  local vert = (tl.w or 0) > 0 and (tl.h or 0) > tl.w
  local limite = vert and lim.limitVertical or lim.limitHorizontal
  local b = batidas(tl.cortes or {})
  local achados = {}

  -- Gancho: o comeco decide se a pessoa fica.
  local primeiro = (#b > 0) and b[1] or (tl.dur or 0)
  if primeiro > lim.hookWindow then
    achados[#achados + 1] = {
      tipo = "slow-hook", at = 0, dur = arred(primeiro),
      grav = (primeiro >= lim.hookWindow * 2) and "high" or "medium",
      titulo = "Gancho lento: " .. num(arred(primeiro)) .. "s até o 1º corte",
      nota = "O bloco de abertura (E1 do 7E) mira 3-5s. Corte antes ou " ..
             "comece o vídeo mais perto do conflito.",
    }
  end

  -- Vaos sem quebra de padrao. Inicio e fim da timeline entram como
  -- fronteiras: o trecho final sem corte tambem derruba retencao.
  local pts = { 0 }
  for i = 1, #b do pts[#pts + 1] = b[i] end
  if (tl.dur or 0) > 0 then pts[#pts + 1] = tl.dur end
  for i = 1, #pts - 1 do
    local a, z = pts[i], pts[i + 1]
    local vao = z - a
    if vao > limite then
      local g = "low"
      if vao >= lim.hardLimit then g = "high"
      elseif vao >= limite * 2 then g = "medium" end
      achados[#achados + 1] = {
        tipo = "retention-gap", at = arred(a), dur = arred(vao), grav = g,
        titulo = num(arred(vao)) .. "s sem quebra de padrão",
        nota = "Limite para " .. (vert and "vertical" or "horizontal") .. ": " ..
               num(limite) .. "s. Considere corte, lettering, B-roll ou SFX aqui.",
      }
    end
  end

  -- Pior primeiro: com teto de marcadores, o que sobra tem que ser o
  -- que mais dói. Ordenar por tempo esconderia o problema grave do fim.
  -- table.sort NAO e estavel — sem desempate pela ordem de entrada,
  -- dois achados iguais trocariam de lugar entre execucoes.
  local rank = { high = 0, medium = 1, low = 2 }
  for i = 1, #achados do achados[i].ordem = i end
  table.sort(achados, function(x, y)
    if rank[x.grav] ~= rank[y.grav] then return rank[x.grav] < rank[y.grav] end
    if x.dur ~= y.dur then return x.dur > y.dur end
    return x.ordem < y.ordem
  end)

  local truncado = #achados > lim.maxFindings
  while #achados > lim.maxFindings do table.remove(achados) end

  local altos = 0
  for i = 1, #achados do if achados[i].grav == "high" then altos = altos + 1 end end

  return {
    achados = achados,
    formato = vert and "vertical" or "horizontal",
    limite = limite,
    dur = arred(tl.dur or 0),
    total = #achados,
    altos = altos,
    truncado = truncado,
    pior = (#achados > 0) and achados[1].dur or 0,
  }
end

-- Conferencia contra o motor do Premiere. Os numeros esperados foram
-- gerados por js/diagnostics.js (node), nao calculados a mao — e a
-- unica forma de saber que as duas implementacoes ainda concordam.
local function autoTesteDiag()
  -- Os mesmos DEFAULTS de js/diagnostics.js — e com eles que os
  -- valores esperados abaixo foram gerados.
  local LIM = { limitVertical = 2, limitHorizontal = 5, hardLimit = 8,
                hookWindow = 5, maxFindings = 40 }
  local casos = {
    { tl = { cortes = {3, 6, 20, 22}, dur = 30, w = 1920, h = 1080 },
      formato = "horizontal", total = 2, altos = 2, pior = 14,
      esp = { {"high", 6, 14}, {"high", 22, 8} } },
    { tl = { cortes = {7, 8, 9}, dur = 12, w = 1080, h = 1920 },
      formato = "vertical", total = 3, altos = 0, pior = 7,
      esp = { {"medium", 0, 7}, {"medium", 0, 7}, {"low", 9, 3} } },
    { tl = { cortes = {2, 4, 6, 8, 10}, dur = 11, w = 1920, h = 1080 },
      formato = "horizontal", total = 0, altos = 0, pior = 0, esp = {} },
  }
  local falhas = {}
  for i = 1, #casos do
    local c = casos[i]
    local r = analisarRitmo(c.tl, LIM)
    if r.formato ~= c.formato then falhas[#falhas + 1] = i .. ": formato " .. r.formato end
    if r.total ~= c.total then falhas[#falhas + 1] = i .. ": total " .. r.total .. " (esperava " .. c.total .. ")" end
    if r.altos ~= c.altos then falhas[#falhas + 1] = i .. ": graves " .. r.altos end
    if r.pior ~= c.pior then falhas[#falhas + 1] = i .. ": pior " .. r.pior end
    for j = 1, #c.esp do
      local a, e = r.achados[j], c.esp[j]
      if not a then
        falhas[#falhas + 1] = i .. "." .. j .. ": achado faltando"
      elseif a.grav ~= e[1] or a.at ~= e[2] or a.dur ~= e[3] then
        falhas[#falhas + 1] = string.format("%d.%d: %s %g %gs (esperava %s %g %gs)",
          i, j, a.grav, a.at, a.dur, e[1], e[2], e[3])
      end
    end
  end
  return falhas
end

-- Le a montagem. Corte = inicio de clipe de video; o inicio da
-- timeline nao conta como corte (mesma regra do collectCutPoints).
local function lerMontagem(proj, tl)
  local fps = tonumber(proj:GetSetting("timelineFrameRate")) or 24
  if fps <= 0 then fps = 24 end
  -- Timeline do Resolve costuma comecar em 01:00:00:00. Sem
  -- descontar isso, TODO corte viraria "3600s" e o diagnostico
  -- devolveria besteira com cara de analise.
  local frame0 = 0
  local ok0 = pcall(function() frame0 = tl:GetStartFrame() or 0 end)
  if not ok0 or type(frame0) ~= "number" then
    frame0 = 0
    pcall(function() frame0 = tcParaFrames(tl:GetStartTimecode(), fps) or 0 end)
  end

  local cortes, ultimo = {}, 0
  local nTrilhas = tl:GetTrackCount("video") or 0
  for t = 1, nTrilhas do
    local itens = tl:GetItemListInTrack("video", t)
    if itens then
      local n = 0
      pcall(function() n = #itens end)
      for i = 1, n do
        local it = itens[i]
        if it and type(it) ~= "number" then
          local ok1, ini = pcall(function() return it:GetStart() end)
          local ok2, fim = pcall(function() return it:GetEnd() end)
          if ok1 and type(ini) == "number" then
            local seg = (ini - frame0) / fps
            if seg > 0.05 then cortes[#cortes + 1] = seg end
          end
          if ok2 and type(fim) == "number" then
            ultimo = math.max(ultimo, (fim - frame0) / fps)
          end
        end
      end
    end
  end

  -- Teto de 300 cortes, igual ao Premiere: acima disso e ruido e o
  -- painel trava montando marcador que ninguem le.
  cortes = batidas(cortes)
  while #cortes > 300 do table.remove(cortes) end

  local fimTl = 0
  pcall(function() fimTl = ((tl:GetEndFrame() or 0) - frame0) / fps end)

  return {
    cortes = cortes,
    dur = math.max(ultimo, fimTl),
    w = tonumber(proj:GetSetting("timelineResolutionWidth")) or 0,
    h = tonumber(proj:GetSetting("timelineResolutionHeight")) or 0,
  }, fps
end

-- Apaga SO os nossos marcadores: rodar de novo nao pode empilhar, e
-- encostar nos marcadores de trabalho do editor seria imperdoavel.
local function limparMarcadores(tl)
  local n = 0
  for _, tipo in ipairs({ "cinepro:slow-hook", "cinepro:retention-gap" }) do
    for _ = 1, 400 do
      local ok, r = pcall(function() return tl:DeleteMarkerByCustomData(tipo) end)
      if not (ok and r) then break end
      n = n + 1
    end
  end
  return n
end

-- Devolve (mensagem, resultado). O resultado alimenta a aba
-- Diagnostico: lista de achados com gravidade, e o clique leva o
-- playhead ate o trecho. Antes so existia a frase na barra de
-- status — o editor tinha que cacar os marcadores na timeline.
local function diagnosticar(aviso)
  local pm = resolve:GetProjectManager()
  local proj = pm and pm:GetCurrentProject() or nil
  if not proj then return "Abra um projeto primeiro.", nil end
  local tl = proj:GetCurrentTimeline()
  if not tl then return "Abra uma timeline primeiro.", nil end

  if aviso then aviso("Lendo a montagem…") end
  local montagem, fps = lerMontagem(proj, tl)
  if #montagem.cortes == 0 and montagem.dur <= 0 then
    return "Timeline vazia — coloque seus takes primeiro.", nil
  end

  local r = analisarRitmo(montagem)
  r.fps = fps
  r.cortes = #montagem.cortes
  r.timeline = tl
  limparMarcadores(tl)

  if #r.achados == 0 then
    r.resumo = string.format("Ritmo ok: %d corte(s) em %gs, nada acima de %gs (%s).",
      #montagem.cortes, r.dur, r.limite, r.formato)
    return r.resumo, r
  end

  local escritos, recusados = 0, 0
  for i = 1, #r.achados do
    local a = r.achados[i]
    local frame = math.max(0, math.floor(a.at * fps + 0.5))
    a.frame = frame
    local durFrames = math.max(1, math.floor(math.min(a.dur, 5) * fps + 0.5))
    local ok, feito = pcall(function()
      return tl:AddMarker(frame, SEV_COR[a.grav] or "Blue",
        "CinePRO · " .. a.titulo, a.nota, durFrames, "cinepro:" .. a.tipo)
    end)
    -- O Resolve recusa marcador em frame que ja tem um. Nao e erro
    -- nosso: e marcador do editor, e ele fica onde esta.
    if ok and feito then escritos = escritos + 1 else recusados = recusados + 1 end
  end

  local msg = string.format("%d ponto(s) de atenção — %d grave(s). Pior: %gs. Formato %s (limite %gs).",
    escritos, r.altos, r.pior, r.formato, r.limite)
  if recusados > 0 then
    msg = msg .. " " .. recusados .. " frame(s) já tinham marcador seu."
  end
  if r.truncado then msg = msg .. " Lista limitada aos mais graves." end
  r.resumo = msg
  return msg, r
end

-- Leva o playhead ate um achado. E o que transforma a lista em
-- ferramenta: ver o problema e ja estar em cima dele.
local function irParaAchado(r, a)
  if not (r and r.timeline and a and a.frame) then return false end
  local fps = r.fps or 24
  local frame0 = 0
  pcall(function() frame0 = r.timeline:GetStartFrame() or 0 end)
  local abs = frame0 + a.frame
  local h = math.floor(abs / (fps * 3600)); abs = abs - h * fps * 3600
  local m = math.floor(abs / (fps * 60));   abs = abs - m * fps * 60
  local s = math.floor(abs / fps);          local f = math.floor(abs - s * fps + 0.5)
  local tc = string.format("%02d:%02d:%02d:%02d", h, m, s, f)
  local ok = pcall(function() r.timeline:SetCurrentTimecode(tc) end)
  return ok, tc
end

-- ── Interface ───────────────────────────────────────────────
-- Estrutura: cabecalho (marca + contagem), busca, e embaixo a
-- lateral ao lado de duas abas — Efeitos e Diagnostico. A barra de
-- status fecha o painel e muda de cor conforme o estado.

local ehMac = (package.config:sub(1, 1) == "/")

local win = disp:AddWindow({
  ID = "CineProPainel",
  WindowTitle = "CinePRO",
  Geometry = { 150, 120, 860, 640 },
}, ui:VGroup{
  Spacing = 8,
  Margin = 12,

  -- Cabecalho
  ui:HGroup{
    Weight = 0,
    ui:Label{ ID = "Marca", Text = "CinePRO", Weight = 0 },
    ui:Label{ ID = "Contagem", Text = "", Alignment = { AlignRight = true, AlignVCenter = true } },
  },

  ui:LineEdit{ ID = "Busca", Weight = 0, PlaceholderText = "Buscar em 10.000+ efeitos…" },

  ui:HGroup{
    Weight = 1,
    Spacing = 10,
    ui:Tree{ ID = "Lateral", Weight = 0.30 },

    ui:VGroup{
      Weight = 0.70,
      Spacing = 6,
      ui:TabBar{ ID = "Abas", Weight = 0 },
      -- Nao e ui:Stack de proposito: o CurrentIndex dele devolve lixo
      -- (-1/-2) e nao da pra confiar que trocou. Hidden nas paginas
      -- le de volta o que foi escrito — testado no 21.1.
      ui:VGroup{
        ID = "Paginas",
        Weight = 1,
        Spacing = 0,

        -- Pagina 0: efeitos
        ui:VGroup{
          ID = "PagEfeitos",
          Spacing = 6,
          ui:Tree{ ID = "Lista", Weight = 1 },
          ui:HGroup{
            Weight = 0,
            Spacing = 6,
            ui:Button{ ID = "Ouvir",    Text = "▶  Ouvir", Checkable = true, Weight = 0 },
            ui:Button{ ID = "Favorito", Text = "★", Checkable = true, Weight = 0 },
            ui:Button{ ID = "Colocar",  Text = "Colocar no playhead", Weight = 1 },
            ui:Button{ ID = "Mais",     Text = "Carregar mais", Weight = 0 },
            ui:Button{ ID = "Atualizar", Text = "↻", Weight = 0 },
          },
          ui:Label{ ID = "Dica", Weight = 0,
                    Text = "Duplo-clique coloca no playhead  ·  ▶ ouve antes de colocar  ·  ★ favorita" },
        },

        -- Pagina 1: diagnostico
        ui:VGroup{
          ID = "PagDiag",
          Spacing = 6,
          ui:Label{ ID = "DiagResumo", Weight = 0, WordWrap = true,
                    Text = "Analisa o ritmo da montagem e marca onde a retenção cai. Não altera nada — só escreve marcadores." },
          ui:Tree{ ID = "DiagLista", Weight = 1 },
          ui:HGroup{
            Weight = 0,
            Spacing = 6,
            ui:Button{ ID = "Analisar", Text = "Analisar a timeline", Weight = 1 },
            ui:Button{ ID = "Repetir",  Text = "Limpar marcadores", Weight = 0 },
          },
          ui:Label{ ID = "DicaDiag", Weight = 0,
                    Text = "Clique num achado pra levar o playhead até ele." },
        },
      },
    },
  },

  ui:Label{ ID = "Status", Text = "Carregando…", Weight = 0 },
})

local itm = win:GetItems()

-- Estilo: se o Qt do Fusion nao aceitar, o painel segue funcional
pcall(function() win:SetStyleSheet(ESTILO) end)
pcall(function() itm.CineProPainel.StyleSheet = ESTILO end)

-- Fontes reutilizadas. Criadas uma vez: ui:Font e um objeto Qt.
local FONTE_NEGRITO, FONTE_MINI, FONTE_TITULO = nil, nil, nil
pcall(function()
  FONTE_NEGRITO = ui:Font{ Bold = true, PixelSize = 12 }
  FONTE_MINI    = ui:Font{ Bold = true, PixelSize = 10 }
  FONTE_TITULO  = ui:Font{ Bold = true, PixelSize = 15 }
  itm.Marca.Font = FONTE_TITULO
end)

local function mostrarPagina(i)
  pcall(function()
    itm.PagEfeitos.Hidden = (i ~= 0)
    itm.PagDiag.Hidden    = (i ~= 1)
    if itm.Abas.CurrentIndex ~= i then itm.Abas.CurrentIndex = i end
  end)
end

pcall(function()
  itm.Abas:AddTab("Efeitos")
  itm.Abas:AddTab("Diagnóstico")
end)
mostrarPagina(0)

-- Lateral: sem cabecalho, sem linhas de arvore, contagem numa
-- coluna propria alinhada a direita (igual ao Premiere).
pcall(function()
  itm.Lateral.ColumnCount = 2
  itm.Lateral.HeaderHidden = true
  itm.Lateral.RootIsDecorated = false
  itm.Lateral.Indentation = 0
  itm.Lateral.UniformRowHeights = true
  itm.Lateral.ColumnWidth[1] = 44
end)

-- Lista: estado · nome · subcategoria · duracao
pcall(function()
  itm.Lista.ColumnCount = 4
  itm.Lista:SetHeaderLabels({ "", "Efeito", "Subcategoria", "Duração" })
  itm.Lista.RootIsDecorated = false
  itm.Lista.Indentation = 12
  itm.Lista.UniformRowHeights = true
  itm.Lista.ColumnWidth[0] = 24
  itm.Lista.ColumnWidth[2] = 130
  itm.Lista.ColumnWidth[3] = 64
end)

-- Diagnostico: gravidade · tempo · o que · duracao
pcall(function()
  itm.DiagLista.ColumnCount = 4
  itm.DiagLista:SetHeaderLabels({ "", "Tempo", "Achado", "Duração" })
  itm.DiagLista.RootIsDecorated = false
  itm.DiagLista.Indentation = 0
  itm.DiagLista.ColumnWidth[0] = 24
  itm.DiagLista.ColumnWidth[1] = 56
  itm.DiagLista.ColumnWidth[3] = 64
end)

pcall(function()
  itm.Ouvir.ToolTip     = "Toca o efeito antes de colocar. Clique de novo pra parar."
  itm.Favorito.ToolTip  = "Guarda nos favoritos (aparece na lateral)."
  itm.Colocar.ToolTip   = "Coloca no playhead, na primeira trilha de áudio livre. Duplo-clique faz o mesmo."
  itm.Mais.ToolTip      = "Mostra mais " .. LOTE .. " efeitos desta lista."
  itm.Atualizar.ToolTip = "Baixa o catálogo mais recente."
  itm.Analisar.ToolTip  = "Lê os cortes da timeline e marca onde a atenção cai."
  itm.Repetir.ToolTip   = "Apaga só os marcadores do CinePRO. Os seus ficam."
  itm.Busca.ToolTip     = "Busca por nome, sem acento. Filtra dentro da categoria escolhida."
end)

local visiveis, ativa = {}, "todos"
local chaveDaLinha, LINHAS, ITENS_LAT = {}, {}, {}
local ultimoDiag = nil

-- ── Status semantico ────────────────────────────────────────
-- A cor diz o estado antes do texto: verde deu certo, ciano esta
-- trabalhando, vermelho falhou, ambar precisa de atencao.
local GLIFO_STATUS = { ok = "●", carregando = "◌", erro = "●", aviso = "▲" }
local COR_STATUS   = { ok = RGB.ok, carregando = RGB.brand, erro = RGB.erro, aviso = RGB.aviso }

local function status(t, tipo)
  local g = tipo and GLIFO_STATUS[tipo] or "·"
  itm.Status.Text = " " .. g .. "  " .. tostring(t)
  pcall(function()
    itm.Status:SetPaletteColor("Active", "WindowText", COR_STATUS[tipo] or RGB.fraco)
    itm.Status:SetPaletteColor("Inactive", "WindowText", COR_STATUS[tipo] or RGB.fraco)
  end)
end

local function formatarMilhar(n)
  local s = tostring(n)
  local out = s:reverse():gsub("(%d%d%d)", "%1."):reverse()
  return (out:gsub("^%.", ""))
end

-- ── Preview de audio ────────────────────────────────────────
-- afplay e nativo do macOS: zero dependencia. Roda em background
-- ("&") pra nao travar o painel; parar e matar o processo. Sem
-- callback de "acabou": um Timer com a duracao do efeito devolve o
-- botao ao estado normal.
local tocando = nil          -- efeito tocando agora
local itemTocando = nil      -- linha da lista que esta tocando
local timerFim = nil

local function pararAudio()
  if ehMac then os.execute("pkill -x afplay >/dev/null 2>&1") end
  if itemTocando then
    pcall(function()
      itemTocando.Text[0] = (tocando and ehFav[tocando.id]) and "★" or (tocando and existe(nomeCache(tocando.id, tocando.nome, tocando.ext)) and "●" or "○")
      itemTocando.TextColor[0] = (tocando and ehFav[tocando.id]) and RGB.aviso or (tocando and existe(nomeCache(tocando.id, tocando.nome, tocando.ext)) and RGB.ok or RGB.apagado)
    end)
  end
  tocando, itemTocando = nil, nil
  pcall(function() itm.Ouvir.Checked = false end)
  pcall(function() itm.Ouvir.Text = "▶  Ouvir" end)
  if timerFim then pcall(function() timerFim:Stop() end) end
end

local function ouvir(e, item)
  pararAudio()
  if not ehMac then
    status("Preview de áudio só no macOS por enquanto.", "aviso")
    return
  end
  local caminho = nomeCache(e.id, e.nome, e.ext)
  if not existe(caminho) then
    status('Baixando "' .. e.nome .. '" pra ouvir…', "carregando")
    if not baixar(CDN_FILES .. e.id .. "." .. e.ext, caminho) then
      status("Falha ao baixar o efeito.", "erro")
      return
    end
  end
  os.execute('afplay "' .. caminho .. '" >/dev/null 2>&1 &')
  tocando, itemTocando = e, item
  pcall(function()
    itm.Ouvir.Checked = true
    itm.Ouvir.Text = "■  Parar"
    if item then item.Text[0] = "▶"; item.TextColor[0] = RGB.brand end
  end)
  status(string.format('Tocando "%s" (%.1fs)', e.nome, e.dur), "carregando")
  -- Devolve o botao quando o efeito acaba. Se o Timeout nao
  -- disparar nesta versao do Fusion, o proximo clique reseta.
  pcall(function()
    if not timerFim then timerFim = ui:Timer{ ID = "FimAudio", SingleShot = true } end
    timerFim.Interval = math.max(300, math.floor(e.dur * 1000) + 150)
    timerFim:Start()
  end)
end

-- ── Lateral ─────────────────────────────────────────────────
-- Mesmos icones do Premiere (js/main.js, buildSidebarTree). Sao
-- geometricos de proposito: emoji renderiza diferente em cada
-- sistema e ja quebrou o alinhamento do painel uma vez.
local ICONE = {
  todos = "▦", favoritos = "★", recentes = "◷", usados = "▲",
  restaurar = "⟲", diagnostico = "◎", pack = "◆", sub = "·",
}

-- Ordem identica a do Premiere: Todos, Favoritos, Recentes, Mais
-- usados, Restaurar midias, Diagnostico, packs, categorias. Quem
-- troca de editor no meio do trabalho nao pode ter que reaprender.
local function montarLateral()
  pcall(function() itm.Lateral:Clear() end)
  chaveDaLinha, LINHAS, ITENS_LAT = {}, {}, {}

  local function add(rotulo, chave, contagem, estilo)
    local it = itm.Lateral:NewItem()
    it.Text[0] = rotulo
    it.Text[1] = contagem and formatarMilhar(contagem) or ""
    pcall(function()
      it.TextAlignment[1] = 130    -- direita + centro vertical
      it.TextColor[1] = RGB.apagado
      it.SizeHint[0] = { 0, 26 }
      if estilo == "acao" then
        it.TextColor[0] = RGB.brand
      elseif estilo == "separador" then
        it.TextColor[0] = RGB.apagado
        if FONTE_MINI then it.Font[0] = FONTE_MINI end
        it.SizeHint[0] = { 0, 30 }
        it.Flags = { Selectable = false, Enabled = true }
      elseif estilo == "sub" then
        it.TextColor[0] = RGB.fraco
      end
    end)
    itm.Lateral:AddTopLevelItem(it)
    -- `false` (e nao nil) nos separadores: com nil a lista fica
    -- esparsa e o indice deixa de bater com a linha clicada.
    LINHAS[#LINHAS + 1] = chave or false
    ITENS_LAT[#ITENS_LAT + 1] = it
    -- Mapa por rotulo e so o plano B (ver o clique da lateral). O
    -- primeiro vence porque rotulo repetido nao distingue mesmo.
    if chave and not chaveDaLinha[it.Text[0]] then chaveDaLinha[it.Text[0]] = chave end
    if chave and chave == ativa then pcall(function() it.Selected = true end) end
  end

  local function separador(texto) add(texto:upper(), nil, nil, "separador") end

  add(ICONE.todos .. "  Todos", "todos", #EFEITOS)
  add(ICONE.favoritos .. "  Favoritos", "favoritos", #favoritos)
  if #recentes > 0 then
    add(ICONE.recentes .. "  Recentes", "recentes", #recentes)
  end
  local nUsados = 0
  for _ in pairs(usos) do nUsados = nUsados + 1 end
  if nUsados > 0 then
    add(ICONE.usados .. "  Mais usados", "mais-usados", math.min(nUsados, MAX_USADOS))
  end
  add(ICONE.restaurar .. "  Restaurar mídias", "acao:restaurar", nil, "acao")
  add(ICONE.diagnostico .. "  Diagnóstico", "acao:diagnostico", nil, "acao")

  if #PACKS > 0 then
    separador("Packs prontos")
    for i = 1, #PACKS do
      add(ICONE.pack .. "  " .. (NOME_PACK[PACKS[i]] or PACKS[i]), "pack:" .. PACKS[i])
    end
  end

  if #CATEGORIAS > 0 then
    separador("Categorias")
    for i = 1, #CATEGORIAS do
      local c = CATEGORIAS[i]
      local subs = SUBS[c] or {}
      -- Um glifo de largura, com ou sem seta: sem isso as categorias
      -- sem subcategoria ficariam desalinhadas das outras.
      local seta = " "
      if #subs > 0 then seta = expandido[c] and "▾" or "▸" end
      add(seta .. " " .. c, "cat:" .. c, CONTA_CAT[c])
      if expandido[c] then
        for j = 1, #subs do
          add("     " .. ICONE.sub .. " " .. subs[j].nome,
              "sub:" .. c .. "\1" .. subs[j].nome, subs[j].n, "sub")
        end
      end
    end
  end
end

-- ── Lista de efeitos ────────────────────────────────────────
local MENSAGEM_VAZIA = {
  favoritos    = "Nenhum favorito ainda. Selecione um efeito e clique ★.",
  recentes     = "Nada recente. O que você colocar na timeline aparece aqui.",
  ["mais-usados"] = "Ainda sem histórico. Os efeitos que você mais coloca ficam aqui.",
}

local function linhaVazia(texto)
  local it = itm.Lista:NewItem()
  it.Text[1] = texto
  pcall(function()
    it.TextColor[1] = RGB.fraco
    it.SizeHint[0] = { 0, 48 }
    it.Flags = { Selectable = false, Enabled = true }
  end)
  itm.Lista:AddTopLevelItem(it)
end

-- Desenha ATE `quantos` efeitos, agrupados por categoria — mesma
-- leitura do Premiere, onde cada grupo tem cabecalho com contagem.
-- Agrupa so quando faz sentido: buscando ou dentro de uma categoria,
-- cabecalho unico so atrapalha.
local function mostrar(achados, quantos)
  pcall(function() itm.Lista:Clear() end)
  visiveis = {}

  if #achados == 0 then
    local termo = itm.Busca.Text or ""
    if termo ~= "" then
      linhaVazia('Nada com "' .. termo .. '". Tente uma palavra só, sem acento.')
    else
      linhaVazia(MENSAGEM_VAZIA[ativa] or "Nenhum efeito aqui.")
    end
    return 0
  end

  local limite = math.min(quantos or LOTE, #achados)
  local agrupar = (ativa == "todos") and (itm.Busca.Text == "")

  -- O indice vem ordenado por NOME, entao categorias se alternam a
  -- cada linha e o agrupamento viraria dezenas de cabecalhos num
  -- lote de 300. Agrupar exige ordenar por categoria primeiro.
  if agrupar and not achados.__porCategoria then
    table.sort(achados, function(a, b)
      if a.cat ~= b.cat then return a.cat < b.cat end
      return a.nome < b.nome
    end)
    achados.__porCategoria = true
  end

  local function novoFilho(pai, e)
    local it = itm.Lista:NewItem()
    local fav = ehFav[e.id]
    local emCache = existe(nomeCache(e.id, e.nome, e.ext))
    -- Uma coluna de estado, um glifo: favorito ganha do cache. A
    -- dica diz o resto.
    it.Text[0] = fav and "★" or (emCache and "●" or "○")
    it.Text[1] = e.nome
    it.Text[2] = e.sub or ""
    it.Text[3] = string.format("%.2fs", e.dur)
    pcall(function()
      it.TextColor[0] = fav and RGB.aviso or (emCache and RGB.ok or RGB.apagado)
      it.TextColor[1] = RGB.texto
      it.TextColor[2] = RGB.fraco
      it.TextColor[3] = RGB.fraco
      it.TextAlignment[0] = 132   -- centro
      it.TextAlignment[3] = 130   -- direita
      it.SizeHint[0] = { 0, 28 }
      it.ToolTip[0] = fav and "Favorito" .. (emCache and " · em cache" or " · ainda não baixado")
                          or (emCache and "Em cache — coloca na hora" or "Ainda não baixado — baixa ao ouvir ou colocar")
      it.ToolTip[1] = e.nome .. (e.cat ~= "" and ("\n" .. e.cat .. (e.sub ~= "" and (" › " .. e.sub) or "")) or "")
    end)
    if pai then pai:AddChild(it) else itm.Lista:AddTopLevelItem(it) end
    visiveis[#visiveis + 1] = e
  end

  if not agrupar then
    for i = 1, limite do novoFilho(nil, achados[i]) end
    return limite
  end

  -- Agrupado: conta o total de cada categoria antes de cortar,
  -- pra o cabecalho mostrar o numero real e nao o do lote.
  local totalPorCat = {}
  for i = 1, #achados do
    local c = achados[i].cat ~= "" and achados[i].cat or "Sem categoria"
    totalPorCat[c] = (totalPorCat[c] or 0) + 1
  end

  local catAtual, pai = nil, nil
  for i = 1, limite do
    local e = achados[i]
    local c = e.cat ~= "" and e.cat or "Sem categoria"
    if c ~= catAtual then
      catAtual = c
      pai = itm.Lista:NewItem()
      pai.Text[1] = c
      pai.Text[2] = formatarMilhar(totalPorCat[c]) .. " efeitos"
      pai.Text[3] = ""
      pcall(function()
        pai.TextColor[1] = RGB.brand
        pai.TextColor[2] = RGB.apagado
        if FONTE_NEGRITO then pai.Font[1] = FONTE_NEGRITO end
        pai.SizeHint[0] = { 0, 30 }
      end)
      itm.Lista:AddTopLevelItem(pai)
      pcall(function() pai.Expanded = true end)
    end
    novoFilho(pai, e)
  end
  return limite
end

local conjunto, mostrados = {}, 0

local function atualizarStatus()
  if #conjunto == 0 then
    status("Nenhum efeito encontrado.", "aviso")
  elseif mostrados < #conjunto then
    status(formatarMilhar(mostrados) .. " de " .. formatarMilhar(#conjunto) .. " efeitos — Carregar mais traz os próximos " .. LOTE .. ".")
  else
    status(formatarMilhar(#conjunto) .. " efeito(s).")
  end
  pcall(function() itm.Mais.Enabled = (mostrados < #conjunto) end)
end

local function atualizarLista()
  pararAudio()
  conjunto = filtrar(ativa, itm.Busca.Text)
  mostrados = mostrar(conjunto, LOTE)
  atualizarStatus()
end

local function carregarMais()
  mostrados = mostrar(conjunto, mostrados + LOTE)
  atualizarStatus()
end

-- Devolve (efeito, item da lista). Cabecalho de grupo nao tem
-- duracao na 4a coluna — clicar nele nao pode virar "colocar
-- categoria no playhead".
local function selecionado()
  local sel = itm.Lista:SelectedItems()
  if not sel then return nil end
  local n = 0
  pcall(function() n = #sel end)
  if n == 0 then return nil end
  local alvo = sel[1]
  if not alvo or type(alvo) == "number" then return nil end
  local nome = tostring(alvo.Text[1] or "")
  local dur  = tostring(alvo.Text[3] or "")
  if dur == "" then return nil end
  -- Nome E duracao: dois efeitos com o mesmo nome e duracao igual
  -- ate o centesimo nao acontece na pratica.
  for i = 1, #visiveis do
    local e = visiveis[i]
    if e.nome == nome and string.format("%.2fs", e.dur) == dur then return e, alvo end
  end
  return nil
end

-- Sincroniza os botoes com a linha selecionada: a estrela acende se
-- for favorito, o Ouvir some se nada esta selecionado.
local function sincronizarBotoes()
  local e = selecionado()
  pcall(function()
    itm.Favorito.Checked = (e ~= nil and ehFav[e.id] == true)
    itm.Favorito.Enabled = (e ~= nil)
    itm.Ouvir.Enabled = (e ~= nil)
    itm.Colocar.Enabled = (e ~= nil)
  end)
end

-- ── Aba Diagnostico ─────────────────────────────────────────
local GLIFO_GRAV = { high = "●", medium = "●", low = "●" }
local COR_GRAV   = { high = RGB.erro, medium = RGB.aviso, low = RGB.brand }
local NOME_GRAV  = { high = "grave", medium = "média", low = "leve" }

local function fmtTempo(seg)
  seg = math.max(0, seg or 0)
  local m = math.floor(seg / 60)
  local s = math.floor(seg % 60)
  return string.format("%d:%02d", m, s)
end

local function mostrarDiagnostico(r)
  pcall(function() itm.DiagLista:Clear() end)
  ultimoDiag = r
  if not r then return end

  pcall(function()
    itm.DiagResumo.Text = r.resumo or ""
    itm.DiagResumo:SetPaletteColor("Active", "WindowText", (r.altos or 0) > 0 and RGB.aviso or RGB.ok)
  end)

  if #r.achados == 0 then
    local it = itm.DiagLista:NewItem()
    it.Text[2] = "Nenhum trecho acima do limite. O ritmo está segurando a atenção."
    pcall(function() it.TextColor[2] = RGB.ok; it.SizeHint[0] = { 0, 44 } end)
    itm.DiagLista:AddTopLevelItem(it)
    return
  end

  for i = 1, #r.achados do
    local a = r.achados[i]
    local it = itm.DiagLista:NewItem()
    it.Text[0] = GLIFO_GRAV[a.grav] or "●"
    it.Text[1] = fmtTempo(a.at)
    it.Text[2] = a.titulo
    it.Text[3] = num(a.dur) .. "s"
    pcall(function()
      it.TextColor[0] = COR_GRAV[a.grav] or RGB.fraco
      it.TextColor[1] = RGB.fraco
      it.TextColor[2] = RGB.texto
      it.TextColor[3] = RGB.fraco
      it.TextAlignment[0] = 132
      it.TextAlignment[3] = 130
      it.SizeHint[0] = { 0, 30 }
      it.ToolTip[2] = a.nota .. "\n\nGravidade " .. (NOME_GRAV[a.grav] or a.grav) .. ". Clique pra ir até lá."
    end)
    itm.DiagLista:AddTopLevelItem(it)
  end
end

local function rodarDiagnostico()
  mostrarPagina(1)
  status("Analisando a montagem…", "carregando")
  local msg, r = diagnosticar(function(t) status(t, "carregando") end)
  mostrarDiagnostico(r)
  if r then
    status(msg, (r.altos or 0) > 0 and "aviso" or "ok")
  else
    status(msg, "erro")
  end
end

-- ── Carga inicial ───────────────────────────────────────────
status("Carregando catálogo…", "carregando")
carregarConfig()
carregarPrefs()
carregarUsos()

-- Confere o diagnostico contra o motor do Premiere antes de abrir.
-- Silencioso quando bate; se divergir, o Console mostra ONDE.
local falhasDiag = autoTesteDiag()
if #falhasDiag > 0 then
  print("[CinePRO] ATENCAO: o diagnostico divergiu do motor do Premiere:")
  for i = 1, #falhasDiag do print("  - " .. falhasDiag[i]) end
else
  print("[CinePRO] diagnostico confere com o motor do Premiere.")
end

local total, erro = carregarIndice(false)
if total > 0 then
  pcall(function() itm.Contagem.Text = formatarMilhar(#EFEITOS) .. " efeitos" end)
  montarLateral()
  -- Mostra o acervo de cara: painel vazio parece quebrado.
  atualizarLista()
  sincronizarBotoes()
  if erro then status(erro, "aviso") end
else
  status("Erro: " .. (erro or "catálogo vazio"), "erro")
end

-- ── Eventos ─────────────────────────────────────────────────
-- Busca com debounce: refiltrar 10 mil itens a cada tecla trava a
-- digitacao. O Timer espera a pessoa parar de digitar. Se o Timeout
-- nao disparar nesta versao do Fusion, cai no filtro imediato —
-- a busca nunca pode ficar muda.
local timerBusca, timerOk = nil, false
pcall(function() timerBusca = ui:Timer{ ID = "Debounce", Interval = 180, SingleShot = true } end)
local timerSonda = nil
pcall(function() timerSonda = ui:Timer{ ID = "SondaTimer", Interval = 50, SingleShot = true }; timerSonda:Start() end)

win.On.SondaTimer.Timeout = function(ev) timerOk = true end
win.On.Debounce.Timeout   = function(ev) atualizarLista(); sincronizarBotoes() end
win.On.FimAudio.Timeout   = function(ev) pararAudio() end

win.On.Busca.TextChanged = function(ev)
  if timerOk and timerBusca then
    pcall(function() timerBusca:Stop(); timerBusca:Start() end)
  else
    atualizarLista(); sincronizarBotoes()
  end
end

win.On.Abas.CurrentChanged = function(ev)
  local i = (ev and ev.Index) or itm.Abas.CurrentIndex or 0
  mostrarPagina(i)
end

win.On.Lateral.ItemClicked = function(ev)
  local alvo = ev and ev.item
  if not alvo or type(alvo) == "number" then
    local sel = itm.Lateral:SelectedItems()
    local n = 0
    if sel then pcall(function() n = #sel end) end
    if n == 0 then return end
    alvo = sel[1]
  end
  if not alvo or type(alvo) == "number" then return end

  -- Chave pelo INDICE da linha, nao pelo rotulo: a mesma
  -- subcategoria aparece em mais de uma categoria, e pelo texto as
  -- duas cairiam no mesmo filtro.
  local chave = nil
  local ok, idx = pcall(function() return itm.Lateral:IndexOfTopLevelItem(alvo) end)
  if ok and type(idx) == "number" and idx >= 0 and LINHAS[idx + 1] ~= nil then
    chave = LINHAS[idx + 1]
  else
    chave = chaveDaLinha[tostring(alvo.Text[0])]
  end
  if not chave then return end   -- separador (false) ou linha desconhecida

  if chave == "acao:restaurar" then
    status("Procurando mídias offline…", "carregando")
    local msg = restaurarMidias(function(t) status(t, "carregando") end)
    status(msg, msg:find("^%d+ de") and "ok" or (msg:find("offline") and "ok" or "aviso"))
    montarLateral()
    return
  end
  if chave == "acao:diagnostico" then
    rodarDiagnostico()
    montarLateral()
    return
  end

  mostrarPagina(0)

  -- Categoria com subcategoria abre/fecha, igual ao Premiere — e ja
  -- mostra os efeitos dela, sem exigir um segundo clique.
  local cat = chave:match("^cat:(.+)$")
  if cat and SUBS[cat] and #SUBS[cat] > 0 then
    expandido[cat] = not expandido[cat]
    ativa = chave
    montarLateral()
    atualizarLista()
    sincronizarBotoes()
    return
  end

  ativa = chave
  montarLateral()
  atualizarLista()
  sincronizarBotoes()
end

win.On.Lista.ItemClicked = function(ev) sincronizarBotoes() end

win.On.Colocar.Clicked = function(ev)
  local e = selecionado()
  if not e then status("Selecione um efeito na lista.", "aviso") return end
  pararAudio()
  status('Colocando "' .. e.nome .. '"…', "carregando")
  local ok, msg = colocar(e)
  status(msg, ok and "ok" or "erro")
  if ok then montarLateral(); atualizarLista(); sincronizarBotoes() end
end

win.On.Lista.ItemDoubleClicked = function(ev) win.On.Colocar.Clicked(ev) end
win.On.Lista.ItemActivated     = function(ev) win.On.Colocar.Clicked(ev) end

win.On.Ouvir.Clicked = function(ev)
  if tocando then pararAudio(); status("Parado.") return end
  local e, item = selecionado()
  if not e then
    pcall(function() itm.Ouvir.Checked = false end)
    status("Selecione um efeito pra ouvir.", "aviso")
    return
  end
  ouvir(e, item)
end

win.On.Favorito.Clicked = function(ev)
  local e = selecionado()
  if not e then
    pcall(function() itm.Favorito.Checked = false end)
    status("Selecione um efeito pra favoritar.", "aviso")
    return
  end
  alternarFavorito(e.id)
  montarLateral()
  atualizarLista()
  sincronizarBotoes()
  status(ehFav[e.id] and ('"' .. e.nome .. '" nos favoritos.')
                     or  ('"' .. e.nome .. '" saiu dos favoritos.'), "ok")
end

win.On.Mais.Clicked = function(ev) carregarMais() end

win.On.Atualizar.Clicked = function(ev)
  status("Baixando catálogo…", "carregando")
  local n, err = carregarIndice(true)
  if n > 0 then
    pcall(function() itm.Contagem.Text = formatarMilhar(#EFEITOS) .. " efeitos" end)
    montarLateral()
    atualizarLista()
    sincronizarBotoes()
    if err then status(err, "aviso") else status("Catálogo atualizado: " .. formatarMilhar(n) .. " efeitos.", "ok") end
  else
    status("Erro: " .. (err or "catálogo vazio"), "erro")
  end
end

win.On.Analisar.Clicked = function(ev) rodarDiagnostico() end

win.On.Repetir.Clicked = function(ev)
  local pm = resolve:GetProjectManager()
  local proj = pm and pm:GetCurrentProject() or nil
  local tl = proj and proj:GetCurrentTimeline() or nil
  if not tl then status("Abra uma timeline primeiro.", "aviso") return end
  local n = limparMarcadores(tl)
  mostrarDiagnostico(nil)
  pcall(function() itm.DiagResumo.Text = "Marcadores do CinePRO apagados. Os seus ficaram." end)
  status(n .. " marcador(es) do CinePRO apagado(s).", "ok")
end

win.On.DiagLista.ItemClicked = function(ev)
  if not ultimoDiag then return end
  local alvo = ev and ev.item
  if not alvo or type(alvo) == "number" then
    local sel = itm.DiagLista:SelectedItems()
    local n = 0
    if sel then pcall(function() n = #sel end) end
    if n == 0 then return end
    alvo = sel[1]
  end
  if not alvo or type(alvo) == "number" then return end
  local ok, idx = pcall(function() return itm.DiagLista:IndexOfTopLevelItem(alvo) end)
  local a = (ok and type(idx) == "number") and ultimoDiag.achados[idx + 1] or nil
  if not a then return end
  local foi, tc = irParaAchado(ultimoDiag, a)
  if foi then
    status("Playhead em " .. tostring(tc) .. " — " .. a.titulo, "ok")
  else
    status("Não consegui mover o playhead.", "erro")
  end
end

win.On.CineProPainel.Close = function(ev)
  pararAudio()
  disp:ExitLoop()
end

win:Show()
disp:RunLoop()
pararAudio()
win:Hide()
