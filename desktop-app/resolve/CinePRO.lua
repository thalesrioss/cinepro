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
--  Cache: MESMA pasta do app e do plugin, entao efeito ja baixado
--  num editor nao baixa de novo no outro.
-- =============================================================

local CDN_INDEX = "https://cdn.jsdelivr.net/gh/thalesrioss/cinepro@main/data/lua-index.tsv"
local CDN_FILES = "https://pub-6ace91bcabf540f0a54bb6850d188ef4.r2.dev/"
-- Lote: o Qt fica lento se despejarmos 10 mil linhas de uma vez, e
-- ninguem rola isso. O Premiere carrega em lotes pelo mesmo motivo.
local LOTE = 300
local MAX_RECENTES = 30

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
local FAVS   = BASE .. "/favoritos.txt"
local RECS   = BASE .. "/recentes.txt"

-- ── Paleta (brandbook do CinePRO) ───────────────────────────
-- Os mesmos tokens de css/tokens.css. Se o Qt do Fusion nao
-- aceitar stylesheet, o painel continua funcionando com a
-- aparencia padrao — por isso tudo entra via pcall.
local COR = {
  brand   = "#00B8FF",
  bright  = "#4DD2FF",
  s0      = "#07090F",
  s1      = "#0E1218",
  s2      = "#161B23",
  s3      = "#11161D",
  texto   = "#E5E9F0",
  fraco   = "#8A95A8",
  borda   = "rgba(255,255,255,0.10)",
}

local ESTILO = [[
  QWidget      { background-color: ]] .. COR.s0 .. [[; color: ]] .. COR.texto .. [[;
                 font-size: 12px; }
  QLineEdit    { background-color: ]] .. COR.s3 .. [[; border: 1px solid ]] .. COR.borda .. [[;
                 border-radius: 8px; padding: 7px 10px; color: ]] .. COR.texto .. [[; }
  QLineEdit:focus { border: 1px solid ]] .. COR.brand .. [[; }
  QTreeWidget  { background-color: ]] .. COR.s1 .. [[; border: 1px solid ]] .. COR.borda .. [[;
                 border-radius: 8px; }
  QTreeWidget::item { padding: 5px 4px; }
  QTreeWidget::item:selected { background-color: ]] .. COR.brand .. [[; color: #000; }
  QHeaderView::section { background-color: ]] .. COR.s2 .. [[; color: ]] .. COR.fraco .. [[;
                 border: 0px; padding: 5px; font-size: 10px; }
  QPushButton  { background-color: ]] .. COR.s2 .. [[; color: ]] .. COR.texto .. [[;
                 border: 1px solid ]] .. COR.borda .. [[; border-radius: 8px;
                 padding: 7px 14px; font-weight: 600; }
  QPushButton:hover  { border: 1px solid ]] .. COR.brand .. [[; }
  QPushButton:default, QPushButton#Colocar {
                 background-color: ]] .. COR.brand .. [[; color: #000; border: 0px; }
  QLabel       { color: ]] .. COR.fraco .. [[; }
  QLabel#Status { color: ]] .. COR.fraco .. [[; font-size: 11px; }
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
local CATEGORIAS, PACKS = {}, {}
local favoritos, recentes = {}, {}
local ehFav = {}

local NOME_PACK = {
  trailer = "Trailer Cinematográfico", terror = "Terror / Suspense",
  vlog = "Vlog Dinâmico", reels = "Reels / TikTok",
  gaming = "Gaming / Highlights", tutorial = "Tutorial / Educacional",
  corporativo = "Corporativo", documentario = "Documentário / Emocional",
}

local function carregarIndice(forcar)
  if forcar or not existe(INDICE) then
    if not baixar(CDN_INDEX, INDICE) then return 0, "falha ao baixar o catálogo" end
  end
  local f = io.open(INDICE, "r")
  if not f then return 0, "não consegui abrir o catálogo" end

  EFEITOS, PORID = {}, {}
  local vistasCat, vistosPack = {}, {}
  CATEGORIAS, PACKS = {}, {}

  for linha in f:lines() do
    local id, nome, ext, dur, cat, packs =
      linha:match("^([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)$")
    if id and id ~= "" then
      local e = {
        id = id, nome = nome, ext = ext, dur = tonumber(dur) or 0,
        cat = cat, packs = packs, busca = semAcento(nome),
      }
      EFEITOS[#EFEITOS + 1] = e
      PORID[id] = e
      if cat ~= "" and not vistasCat[cat] then
        vistasCat[cat] = true
        CATEGORIAS[#CATEGORIAS + 1] = cat
      end
      for p in packs:gmatch("[^,]+") do
        if not vistosPack[p] then vistosPack[p] = true; PACKS[#PACKS + 1] = p end
      end
    end
  end
  f:close()
  table.sort(CATEGORIAS)
  table.sort(PACKS)
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

local function registrarUso(id)
  for i = #recentes, 1, -1 do
    if recentes[i] == id then table.remove(recentes, i) end
  end
  table.insert(recentes, 1, id)
  while #recentes > MAX_RECENTES do table.remove(recentes) end
  gravarLinhas(RECS, recentes)
end

-- ── Filtro ──────────────────────────────────────────────────
-- categoria: "todos" | "favoritos" | "recentes" | "pack:<id>" | "cat:<nome>"
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
  if categoria == "recentes" then
    for i = 1, #recentes do
      local e = PORID[recentes[i]]
      if e and cabe(e) then achados[#achados + 1] = e end
    end
    return achados
  end

  local pack = categoria:match("^pack:(.+)$")
  local cat  = categoria:match("^cat:(.+)$")

  for i = 1, #EFEITOS do
    local e = EFEITOS[i]
    local ok = true
    if pack then
      ok = false
      for p in e.packs:gmatch("[^,]+") do if p == pack then ok = true; break end end
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

-- ── Interface ───────────────────────────────────────────────
local win = disp:AddWindow({
  ID = "CineProPainel",
  WindowTitle = "CinePRO",
  Geometry = { 150, 120, 780, 600 },
}, ui:VGroup{
  Spacing = 8,
  Margin = 10,

  ui:HGroup{
    Weight = 0,
    ui:LineEdit{ ID = "Busca", PlaceholderText = "Buscar em 10.000+ efeitos…" },
  },

  ui:HGroup{
    Weight = 1,
    Spacing = 8,
    ui:Tree{ ID = "Lateral", Weight = 0.32 },
    ui:Tree{ ID = "Lista",   Weight = 0.68 },
  },

  ui:HGroup{
    Weight = 0,
    Spacing = 6,
    ui:Button{ ID = "Colocar",  Text = "Colocar no playhead" },
    ui:Button{ ID = "Favorito", Text = "Favoritar" },
    ui:Button{ ID = "Mais",      Text = "Carregar mais" },
    ui:Button{ ID = "Atualizar", Text = "Atualizar catálogo" },
  },

  ui:Label{ ID = "Status", Text = "Carregando…", Weight = 0 },
})

local itm = win:GetItems()

-- Estilo: se o Qt do Fusion nao aceitar, o painel segue funcional
pcall(function() win:SetStyleSheet(ESTILO) end)
pcall(function() itm.CineProPainel.StyleSheet = ESTILO end)

pcall(function()
  itm.Lateral.ColumnCount = 1
  itm.Lateral:SetHeaderLabels({ "Biblioteca" })
  itm.Lista.ColumnCount = 2
  itm.Lista:SetHeaderLabels({ "Efeito", "Duração" })
end)

local visiveis, ativa = {}, "todos"
local chaveDaLinha = {}

local function status(t) itm.Status.Text = t end

local function montarLateral()
  pcall(function() itm.Lateral:Clear() end)
  chaveDaLinha = {}

  local function add(rotulo, chave, contagem)
    local it = itm.Lateral:NewItem()
    it.Text[0] = contagem and (rotulo .. "   " .. contagem) or rotulo
    itm.Lateral:AddTopLevelItem(it)
    chaveDaLinha[it.Text[0]] = chave
  end

  add("Todos", "todos", #EFEITOS)
  add("Favoritos", "favoritos", #favoritos)
  add("Recentes", "recentes", #recentes)

  if #PACKS > 0 then
    add("— PACKS PRONTOS —", nil)
    for i = 1, #PACKS do
      add(NOME_PACK[PACKS[i]] or PACKS[i], "pack:" .. PACKS[i])
    end
  end
  if #CATEGORIAS > 0 then
    add("— CATEGORIAS —", nil)
    for i = 1, #CATEGORIAS do
      add(CATEGORIAS[i], "cat:" .. CATEGORIAS[i])
    end
  end
end

-- Desenha ATE `quantos` efeitos, agrupados por categoria — mesma
-- leitura do Premiere, onde cada grupo tem cabecalho com contagem.
-- Agrupa so quando faz sentido: buscando ou dentro de uma categoria,
-- cabecalho unico so atrapalha.
local function mostrar(achados, quantos)
  pcall(function() itm.Lista:Clear() end)
  visiveis = {}

  local limite = math.min(quantos or LOTE, #achados)
  local agrupar = (ativa == "todos") and (itm.Busca.Text == "")

  local function novoFilho(pai, e)
    local it = itm.Lista:NewItem()
    it.Text[0] = (ehFav[e.id] and "★ " or "") .. e.nome
    it.Text[1] = string.format("%.2fs", e.dur)
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
      pai.Text[0] = c
      pai.Text[1] = tostring(totalPorCat[c])
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
    status("Nenhum efeito encontrado.")
  elseif mostrados < #conjunto then
    status(mostrados .. " de " .. #conjunto .. " efeitos — clique em Carregar mais.")
  else
    status(#conjunto .. " efeito(s).")
  end
  pcall(function() itm.Mais.Enabled = (mostrados < #conjunto) end)
end

local function atualizarLista()
  conjunto = filtrar(ativa, itm.Busca.Text)
  mostrados = mostrar(conjunto, LOTE)
  atualizarStatus()
end

local function carregarMais()
  mostrados = mostrar(conjunto, mostrados + LOTE)
  atualizarStatus()
end

local function selecionado()
  local sel = itm.Lista:SelectedItems()
  if not sel then return nil end
  local n = 0
  pcall(function() n = #sel end)
  if n == 0 then return nil end
  local alvo = sel[1]
  if not alvo or type(alvo) == "number" then return nil end
  -- Cabecalho de grupo tem a contagem na 2a coluna, nao duracao —
  -- clicar nele nao pode virar "colocar categoria no playhead".
  local nome = tostring(alvo.Text[0]):gsub("^★ ", "")
  local col2 = tostring(alvo.Text[1] or "")
  if not col2:find("s$") then return nil end
  for i = 1, #visiveis do
    if visiveis[i].nome == nome then return visiveis[i] end
  end
  return nil
end

-- ── Carga inicial ───────────────────────────────────────────
status("Carregando catálogo…")
carregarPrefs()
local total, erro = carregarIndice(false)
if erro then
  status("Erro: " .. erro)
else
  montarLateral()
  -- Mostra o acervo de cara: painel vazio parece quebrado.
  atualizarLista()
end

-- ── Eventos ─────────────────────────────────────────────────
win.On.Busca.TextChanged = function(ev) atualizarLista() end

win.On.Lateral.ItemClicked = function(ev)
  local sel = itm.Lateral:SelectedItems()
  local n = 0
  if sel then pcall(function() n = #sel end) end
  if n == 0 then return end
  local alvo = sel[1]
  if not alvo or type(alvo) == "number" then return end
  local chave = chaveDaLinha[tostring(alvo.Text[0])]
  if not chave then return end   -- separador
  ativa = chave
  atualizarLista()
end

win.On.Colocar.Clicked = function(ev)
  local e = selecionado()
  if not e then status("Selecione um efeito na lista.") return end
  status('Colocando "' .. e.nome .. '"…')
  local ok, msg = colocar(e)
  status(msg)
  if ok then montarLateral() end
end

win.On.Lista.ItemDoubleClicked = function(ev) win.On.Colocar.Clicked(ev) end

win.On.Favorito.Clicked = function(ev)
  local e = selecionado()
  if not e then status("Selecione um efeito pra favoritar.") return end
  alternarFavorito(e.id)
  montarLateral()
  atualizarLista()
  status(ehFav[e.id] and ('"' .. e.nome .. '" nos favoritos.')
                     or  ('"' .. e.nome .. '" saiu dos favoritos.'))
end

win.On.Mais.Clicked = function(ev) carregarMais() end

win.On.Atualizar.Clicked = function(ev)
  status("Baixando catálogo…")
  local n, err = carregarIndice(true)
  if err then status("Erro: " .. err) else montarLateral(); atualizarLista() end
end

win.On.CineProPainel.Close = function(ev) disp:ExitLoop() end

win:Show()
disp:RunLoop()
win:Hide()
