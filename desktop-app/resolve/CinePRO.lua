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

-- `tentativa` e interno: o painel chama sem, e a recuperacao de
-- formato antigo rechama com 2 pra nao poder ficar em loop.
local function carregarIndice(forcar, tentativa)
  if forcar or not existe(INDICE) then
    if not baixar(CDN_INDEX, INDICE) then return 0, "falha ao baixar o catálogo" end
  end
  local f = io.open(INDICE, "r")
  if not f then return 0, "não consegui abrir o catálogo" end

  EFEITOS, PORID, PORPREFIXO = {}, {}, {}
  local vistasCat, vistosPack = {}, {}
  CATEGORIAS, PACKS = {}, {}
  SUBS, CONTA_CAT = {}, {}
  local vistasSub = {}

  for linha in f:lines() do
    local id, nome, ext, dur, cat, sub, packs =
      linha:match("^([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)$")
    if id and id ~= "" then
      local e = {
        id = id, nome = nome, ext = ext, dur = tonumber(dur) or 0,
        cat = cat, sub = sub, packs = packs, busca = semAcento(nome),
      }
      EFEITOS[#EFEITOS + 1] = e
      PORID[id] = e
      -- O cache guarda so os 8 primeiros chars do id no nome do
      -- arquivo. E por este mapa que "Restaurar midias" descobre
      -- qual efeito era, olhando so o caminho que sobrou no projeto.
      PORPREFIXO[id:sub(1, 8)] = e
      if cat ~= "" then
        if not vistasCat[cat] then
          vistasCat[cat] = true
          CATEGORIAS[#CATEGORIAS + 1] = cat
          SUBS[cat] = {}
          vistasSub[cat] = {}
        end
        CONTA_CAT[cat] = (CONTA_CAT[cat] or 0) + 1
        if sub ~= "" then
          local vs = vistasSub[cat]
          if not vs[sub] then
            vs[sub] = { nome = sub, n = 0 }
            SUBS[cat][#SUBS[cat] + 1] = vs[sub]
          end
          vs[sub].n = vs[sub].n + 1
        end
      end
      for p in packs:gmatch("[^,]+") do
        if not vistosPack[p] then vistosPack[p] = true; PACKS[#PACKS + 1] = p end
      end
    end
  end
  f:close()

  -- Catalogo em cache do formato antigo (sem a coluna subcategoria)
  -- nao casa com o match e devolveria ZERO efeitos — painel vazio,
  -- sem erro, sem pista. Quem ja usou o painel antes tem esse
  -- arquivo em disco, entao a recuperacao precisa ser automatica.
  if #EFEITOS == 0 and not forcar and (tentativa or 1) < 2 then
    return carregarIndice(true, 2)
  end
  if #EFEITOS == 0 then
    return 0, "catálogo ilegível — clique em Atualizar catálogo"
  end

  table.sort(CATEGORIAS)
  table.sort(PACKS)
  for _, lista in pairs(SUBS) do
    table.sort(lista, function(a, b) return a.nome < b.nome end)
  end
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

  local clipes = {}
  todosOsClipes(raiz, clipes)

  local sumidos, refeitos, semPista = {}, 0, 0
  for i = 1, #clipes do
    local c = clipes[i]
    local ok, p = pcall(function() return c:GetClipProperty("File Path") end)
    if ok and type(p) == "string" and p ~= "" and p:sub(1, #CACHE) == CACHE then
      if not existe(p) then sumidos[#sumidos + 1] = { item = c, caminho = p } end
    end
  end

  if #sumidos == 0 then return "Nenhuma mídia do CinePRO offline — está tudo no lugar." end
  if aviso then aviso("Restaurando " .. #sumidos .. " mídia(s)…") end

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

  local msg = refeitos .. " de " .. #sumidos .. " mídia(s) restaurada(s)."
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

local function diagnosticar(aviso)
  local pm = resolve:GetProjectManager()
  local proj = pm and pm:GetCurrentProject() or nil
  if not proj then return "Abra um projeto primeiro." end
  local tl = proj:GetCurrentTimeline()
  if not tl then return "Abra uma timeline primeiro." end

  if aviso then aviso("Lendo a montagem…") end
  local montagem, fps = lerMontagem(proj, tl)
  if #montagem.cortes == 0 and montagem.dur <= 0 then
    return "Timeline vazia — coloque seus takes primeiro."
  end

  local r = analisarRitmo(montagem)
  limparMarcadores(tl)

  if #r.achados == 0 then
    return string.format("Ritmo ok: %d corte(s) em %gs, nada acima de %gs (%s).",
      #montagem.cortes, r.dur, r.limite, r.formato)
  end

  local escritos, recusados = 0, 0
  for i = 1, #r.achados do
    local a = r.achados[i]
    local frame = math.max(0, math.floor(a.at * fps + 0.5))
    local durFrames = math.max(1, math.floor(math.min(a.dur, 5) * fps + 0.5))
    local ok, feito = pcall(function()
      return tl:AddMarker(frame, SEV_COR[a.grav] or "Blue",
        "CinePRO · " .. a.titulo, a.nota, durFrames, "cinepro:" .. a.tipo)
    end)
    -- O Resolve recusa marcador em frame que ja tem um. Nao e erro
    -- nosso: e marcador do editor, e ele fica onde esta.
    if ok and feito then escritos = escritos + 1 else recusados = recusados + 1 end
  end

  local msg = string.format("%d ponto(s) de atenção marcado(s) — %d grave(s). Pior: %gs. Formato %s (limite %gs).",
    escritos, r.altos, r.pior, r.formato, r.limite)
  if recusados > 0 then
    msg = msg .. " " .. recusados .. " frame(s) já tinham marcador seu."
  end
  if r.truncado then msg = msg .. " Lista limitada aos mais graves." end
  return msg
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
local chaveDaLinha, LINHAS = {}, {}

local function status(t) itm.Status.Text = t end

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
  chaveDaLinha, LINHAS = {}, {}

  local function add(rotulo, chave, contagem)
    local it = itm.Lateral:NewItem()
    it.Text[0] = contagem and (rotulo .. "   " .. contagem) or rotulo
    itm.Lateral:AddTopLevelItem(it)
    -- `false` (e nao nil) nos separadores: com nil a lista fica
    -- esparsa e o indice deixa de bater com a linha clicada.
    LINHAS[#LINHAS + 1] = chave or false
    -- Mapa por rotulo e so o plano B (ver o clique da lateral). O
    -- primeiro vence porque rotulo repetido nao distingue mesmo.
    if chave and not chaveDaLinha[it.Text[0]] then chaveDaLinha[it.Text[0]] = chave end
  end

  local function separador(texto) add("── " .. texto .. " ──", nil) end

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
  add(ICONE.restaurar .. "  Restaurar mídias", "acao:restaurar")
  add(ICONE.diagnostico .. "  Diagnóstico", "acao:diagnostico")

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
              "sub:" .. c .. "\1" .. subs[j].nome, subs[j].n)
        end
      end
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
    status("Procurando mídias offline…")
    status(restaurarMidias(status))
    return
  end
  if chave == "acao:diagnostico" then
    status("Analisando a montagem…")
    status(diagnosticar(status))
    return
  end

  -- Categoria com subcategoria abre/fecha, igual ao Premiere — e ja
  -- mostra os efeitos dela, sem exigir um segundo clique.
  local cat = chave:match("^cat:(.+)$")
  if cat and SUBS[cat] and #SUBS[cat] > 0 then
    expandido[cat] = not expandido[cat]
    ativa = chave
    montarLateral()
    atualizarLista()
    return
  end

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
