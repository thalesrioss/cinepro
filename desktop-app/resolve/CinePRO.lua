-- =============================================================
--  CinePRO — painel para DaVinci Resolve
--
--  Busca nos 10.000+ efeitos, baixa e coloca NO PLAYHEAD, tudo
--  de dentro do Resolve. Sem fila, sem trocar de app.
--
--  POR QUE LUA: o Resolve so enumera scripts .py se achar um
--  Python.framework instalado. Sem ele, ignora em silencio — nem
--  erro aparece. Lua e nativo do Fusion: zero pre-requisito.
--
--  POR QUE TSV E NAO JSON: o Lua do Resolve nao tem biblioteca
--  JSON (testado nesta maquina). O indice vem em linhas com TAB.
--
--  Rede: io.popen + curl (confirmado funcionando).
--  Cache: MESMA pasta do app e do plugin do Premiere, entao
--  efeito ja usado num editor nao baixa de novo no outro.
-- =============================================================

local CDN_INDEX = "https://cdn.jsdelivr.net/gh/thalesrioss/cinepro@main/data/lua-index.tsv"
local CDN_FILES = "https://pub-6ace91bcabf540f0a54bb6850d188ef4.r2.dev/"
local MAX_RESULTADOS = 150   -- alem disso a arvore fica lenta e ninguem le

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
local INDICE_LOCAL = BASE .. "/lua-index.tsv"

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
  os.execute('mkdir -p "' .. destino:match("^(.*)/[^/]*$") .. '"')
  shell('curl -sL --max-time 120 -o "' .. destino .. '" "' .. url .. '"')
  return existe(destino)
end

-- Mesmo nome de arquivo que o app usa, senao o cache nao e compartilhado.
-- App: <8 primeiros do id> _ <nome sanitizado> . <ext>
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

-- ── Indice ──────────────────────────────────────────────────
local EFEITOS = {}

local function carregarIndice(forcar)
  -- Usa a copia local se existir; so baixa quando falta ou o
  -- usuario pede. Abrir o painel nao deve custar 300KB toda vez.
  if forcar or not existe(INDICE_LOCAL) then
    if not baixar(CDN_INDEX, INDICE_LOCAL) then return 0, "falha ao baixar o indice" end
  end

  local f = io.open(INDICE_LOCAL, "r")
  if not f then return 0, "nao consegui abrir o indice" end

  EFEITOS = {}
  for linha in f:lines() do
    local id, nome, ext, dur = linha:match("^([^\t]+)\t([^\t]+)\t([^\t]+)\t([^\t]+)$")
    if id then
      EFEITOS[#EFEITOS + 1] = {
        id = id, nome = nome, ext = ext,
        dur = tonumber(dur) or 0,
        busca = semAcento(nome),
      }
    end
  end
  f:close()
  return #EFEITOS, nil
end

local function buscar(termo)
  local achados = {}
  if not termo or termo == "" then return achados end
  local t = semAcento(termo)
  for i = 1, #EFEITOS do
    local e = EFEITOS[i]
    if e.busca:find(t, 1, true) then
      achados[#achados + 1] = e
      if #achados >= MAX_RESULTADOS then break end
    end
  end
  return achados
end

-- ── Timeline ────────────────────────────────────────────────
local function projetoAtual()
  local pm = resolve:GetProjectManager()
  return pm and pm:GetCurrentProject() or nil
end

local function tcParaFrames(tc, fps)
  local h, m, s, f = tostring(tc):gsub(";", ":"):match("(%d+):(%d+):(%d+):(%d+)")
  if not h then return nil end
  return math.floor(((tonumber(h) * 3600 + tonumber(m) * 60 + tonumber(s)) * fps) + tonumber(f) + 0.5)
end

-- Primeira trilha de audio livre na janela desejada. Sem isto o
-- Resolve usa a trilha corrente e pode cobrir a voz do editor.
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
        if it and type(it) ~= "number" then
          local ok, ini = pcall(function() return it:GetStart() end)
          local ok2, f2 = pcall(function() return it:GetEnd() end)
          if ok and ok2 and ini < fim and f2 > inicio then ocupada = true; break end
        end
      end
    end
    if not ocupada then return idx end
  end
  return nil
end

-- Coloca o efeito no playhead. Devolve (sucesso, mensagem).
local function colocar(efeito)
  local proj = projetoAtual()
  if not proj then return false, "Abra um projeto primeiro." end
  local tl = proj:GetCurrentTimeline()
  if not tl then return false, "Abra uma timeline primeiro." end

  local caminho = nomeCache(efeito.id, efeito.nome, efeito.ext)
  if not existe(caminho) then
    local url = CDN_FILES .. efeito.id .. "." .. efeito.ext
    if not baixar(url, caminho) then return false, "Falha ao baixar o efeito." end
  end

  local mp = proj:GetMediaPool()
  local raiz = mp:GetRootFolder()

  -- Bin "CinePRO" — mantem o projeto do editor organizado
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
  if not itens then return false, "O Resolve recusou o arquivo." end
  local n = 0
  pcall(function() n = #itens end)
  if n == 0 then return false, "O Resolve recusou o arquivo." end
  local item = itens[1]

  local fps = tonumber(proj:GetSetting("timelineFrameRate")) or 24
  local playhead = tcParaFrames(tl:GetCurrentTimecode(), fps)
  if not playhead then return false, "Nao consegui ler o playhead." end

  local durFrames = math.max(1, math.floor(efeito.dur * fps + 0.5))
  local trilha = trilhaLivre(tl, playhead, durFrames)
  if not trilha then
    pcall(function() tl:AddTrack("audio") end)
    trilha = tl:GetTrackCount("audio")
  end

  local info = {
    mediaPoolItem = item,
    startFrame = 0,
    endFrame = durFrames - 1,
    recordFrame = playhead,
    mediaType = 2,           -- so audio
    trackIndex = trilha,
  }
  local ok, r = pcall(function() return mp:AppendToTimeline({ info }) end)
  if ok and r then
    return true, string.format('"%s" na A%d, no playhead.', efeito.nome, trilha)
  end
  return false, "Importado no bin CinePRO, mas nao entrou na timeline."
end

-- ── Interface ───────────────────────────────────────────────
local win = disp:AddWindow({
  ID = "CineProPainel",
  WindowTitle = "CinePRO",
  Geometry = { 200, 150, 520, 560 },
}, ui:VGroup{
  Spacing = 6,
  ui:HGroup{
    Weight = 0,
    ui:LineEdit{ ID = "Busca", PlaceholderText = "Buscar efeito (ex: whoosh, impacto, chuva)" },
  },
  ui:Tree{ ID = "Lista", Weight = 1 },
  ui:HGroup{
    Weight = 0,
    ui:Button{ ID = "Colocar", Text = "Colocar no playhead" },
    ui:Button{ ID = "Atualizar", Text = "Atualizar catálogo" },
  },
  ui:Label{ ID = "Status", Text = "", Weight = 0 },
})

local itm = win:GetItems()
local lista = itm.Lista
pcall(function()
  lista.ColumnCount = 2
  lista:SetHeaderLabels({ "Efeito", "Duração" })
end)

local visiveis = {}

local function status(t) itm.Status.Text = t end

local function mostrar(achados)
  pcall(function() lista:Clear() end)
  visiveis = achados
  for i = 1, #achados do
    local e = achados[i]
    local linha = lista:NewItem()
    linha.Text[0] = e.nome
    linha.Text[1] = string.format("%.2fs", e.dur)
    lista:AddTopLevelItem(linha)
  end
end

local function selecionado()
  local sel = lista:SelectedItems()
  if not sel then return nil end
  local n = 0
  pcall(function() n = #sel end)
  if n == 0 then return nil end
  local alvo = sel[1]
  if not alvo or type(alvo) == "number" then return nil end
  local nome = alvo.Text[0]
  for i = 1, #visiveis do
    if visiveis[i].nome == nome then return visiveis[i] end
  end
  return nil
end

-- Carga inicial
status("Carregando catálogo…")
local total, erro = carregarIndice(false)
if erro then
  status("Erro: " .. erro)
else
  status(total .. " efeitos prontos. Digite pra buscar.")
end

win.On.Busca.TextChanged = function(ev)
  local termo = itm.Busca.Text
  if termo == "" then
    mostrar({})
    status(#EFEITOS .. " efeitos prontos. Digite pra buscar.")
    return
  end
  local achados = buscar(termo)
  mostrar(achados)
  if #achados >= MAX_RESULTADOS then
    status(MAX_RESULTADOS .. "+ resultados — refine a busca.")
  else
    status(#achados .. " resultado(s).")
  end
end

win.On.Colocar.Clicked = function(ev)
  local e = selecionado()
  if not e then status("Selecione um efeito na lista.") return end
  status("Colocando “" .. e.nome .. "”…")
  local ok, msg = colocar(e)
  status(msg)
end

win.On.Lista.ItemDoubleClicked = function(ev)
  win.On.Colocar.Clicked(ev)
end

win.On.Atualizar.Clicked = function(ev)
  status("Baixando catálogo…")
  local n, err = carregarIndice(true)
  status(err and ("Erro: " .. err) or (n .. " efeitos atualizados."))
end

win.On.CineProPainel.Close = function(ev) disp:ExitLoop() end

win:Show()
disp:RunLoop()
win:Hide()
