// CinePRO — ExtendScript (Premiere Pro)
// Funções chamadas pelo painel CEP via CSInterface.evalScript()

/**
 * Retorna o nome do app host (PPRO, AEFT, etc.)
 */
function getAppName() {
  return app.name;
}

/**
 * Retorna o caminho da pasta temp do sistema
 */
function getTempDir() {
  var tmp = Folder.temp.fsName;
  return tmp;
}

/**
 * Retorna a pasta de cache permanente do CinePRO.
 * macOS:   ~/Library/Application Support/CinePRO/cache
 * Windows: %APPDATA%/CinePRO/cache
 * Cria a pasta se não existir.
 */
function getCacheDir() {
  try {
    var base;
    if ($.os.indexOf('Windows') !== -1) {
      base = Folder(Folder.appData.fsName + '/CinePRO/cache');
    } else {
      base = Folder('~/Library/Application Support/CinePRO/cache');
    }
    if (!base.exists) {
      var parent = base.parent;
      if (!parent.exists) parent.create();
      base.create();
    }
    return base.fsName;
  } catch (e) {
    return Folder.temp.fsName;  // fallback
  }
}

/**
 * Verifica se um arquivo existe (usado pra checar cache antes de baixar)
 */
function fileExists(path) {
  try {
    return (new File(path)).exists ? 'true' : 'false';
  } catch (e) { return 'false'; }
}

/**
 * Retorna tamanho total da pasta de cache em bytes (pra exibir no settings)
 */
function getCacheSize() {
  try {
    var dir = Folder(getCacheDir());
    if (!dir.exists) return '0';
    var total = 0;
    var files = dir.getFiles();
    for (var i = 0; i < files.length; i++) {
      if (files[i] instanceof File) {
        total += files[i].length;
      }
    }
    return String(total);
  } catch (e) { return '0'; }
}

/**
 * Limpa toda a pasta de cache
 */
function clearCache() {
  try {
    var dir = Folder(getCacheDir());
    if (!dir.exists) return 'OK:0';
    var files = dir.getFiles();
    var removed = 0;
    for (var i = 0; i < files.length; i++) {
      if (files[i] instanceof File) {
        if (files[i].remove()) removed++;
      }
    }
    return 'OK:' + removed;
  } catch (e) {
    return 'ERR:' + e.toString();
  }
}

/**
 * Retorna o tempo atual do CTI (playhead) em segundos
 */
function getPlayheadTime() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return '0';
    return String(seq.getPlayerPosition().seconds);
  } catch (e) {
    return '0';
  }
}

/**
 * Importa um arquivo na posição do playhead da sequência ativa.
 * Suporta: .mogrt, .mp4, .mov, .prproj (como bin), etc.
 *
 * @param {string} filePath  Caminho absoluto do arquivo local
 * @param {string} fileType  Extensão sem ponto: "mogrt", "mp4", etc.
 */
function importFileAtPlayhead(filePath, fileType) {
  try {
    var file = new File(filePath);
    if (!file.exists) return 'ERR:FILE_NOT_FOUND:' + filePath;

    // Presets (.prfpset) — importa pra janela de Efeitos, não pra timeline
    if (fileType === 'prfpset') {
      return importPreset(filePath);
    }

    // LUTs (.cube/.3dl) — copia pra pasta de LUTs do Premiere
    if (fileType === 'cube' || fileType === '3dl') {
      return installLUT(filePath);
    }

    var seq = app.project.activeSequence;
    if (!seq) return 'ERR:NO_SEQUENCE';

    // MOGRT — Motion Graphics Template
    if (fileType === 'mogrt') {
      return importMogrtAtPlayhead(filePath, seq);
    }

    // Mídia comum (mp4, mov, mp3, wav, png, gif...)
    return importClipAtPlayhead(filePath, seq);

  } catch (e) {
    return 'ERR:' + e.toString();
  }
}

/**
 * Importa um Effect Preset (.prfpset) na lista de presets do projeto
 */
function importPreset(filePath) {
  try {
    var ok = app.project.importFiles(
      [filePath],
      true,
      app.project.rootItem,
      false
    );
    if (ok) return 'OK:PRESET_IMPORTED';
    return 'WARN:PRESET_IMPORT_FAILED';
  } catch (e) {
    return 'ERR:PRESET:' + e.toString();
  }
}

/**
 * Copia um arquivo de LUT pra pasta de LUTs do usuário no Premiere
 */
function installLUT(filePath) {
  try {
    var src = new File(filePath);
    var fileName = src.name;

    // Pasta padrão de LUTs do Premiere
    var lutDir;
    if ($.os.indexOf('Windows') !== -1) {
      lutDir = new Folder(Folder.appData.fsName + '/Adobe/Common/LUTs');
    } else {
      lutDir = new Folder('~/Library/Application Support/Adobe/Common/LUTs');
    }

    if (!lutDir.exists) lutDir.create();
    var dest = new File(lutDir.fsName + '/' + fileName);

    src.copy(dest.fsName);
    return 'OK:LUT_INSTALLED';
  } catch (e) {
    return 'ERR:LUT:' + e.toString();
  }
}

/**
 * Importa um MOGRT na Essential Graphics e insere na timeline
 */
function importMogrtAtPlayhead(filePath, seq) {
  try {
    var bin = app.project.rootItem;

    // Importa o arquivo MOGRT no projeto
    app.project.importFiles(
      [filePath],
      true,   // suppressUI
      bin,
      false   // importAsNumberedStills
    );

    // Localiza o item recém-importado
    var importedItem = null;
    for (var i = 0; i < bin.children.numItems; i++) {
      var item = bin.children[i];
      if (item.name && filePath.indexOf(item.name.replace('.mogrt', '')) !== -1) {
        importedItem = item;
        break;
      }
    }

    // Se achou, insere na primeira track de vídeo disponível
    if (importedItem) {
      var cti = seq.getPlayerPosition();
      var videoTrack = seq.videoTracks[0];
      if (!videoTrack) return 'ERR:NO_VIDEO_TRACK';
      videoTrack.insertClip(importedItem, cti.seconds);
      return 'OK:MOGRT_INSERTED';
    }

    return 'WARN:IMPORTED_BUT_NOT_PLACED';

  } catch (e) {
    return 'ERR:MOGRT:' + e.toString();
  }
}

/**
 * Importa um clip de mídia (vídeo/áudio/imagem) e insere na timeline
 */
function importClipAtPlayhead(filePath, seq) {
  try {
    var bin = app.project.rootItem;
    var importResult = app.project.importFiles(
      [filePath],
      true,
      bin,
      false
    );

    // Busca o item no bin
    var importedItem = null;
    var fileName = filePath.split('/').pop().split('\\').pop();
    for (var i = 0; i < bin.children.numItems; i++) {
      if (bin.children[i].name === fileName) {
        importedItem = bin.children[i];
        break;
      }
    }

    if (!importedItem) return 'WARN:IMPORTED_BUT_NOT_FOUND';

    var cti = seq.getPlayerPosition();
    var videoTrack = seq.videoTracks[0];
    if (!videoTrack) return 'ERR:NO_VIDEO_TRACK';

    videoTrack.insertClip(importedItem, cti.seconds);
    return 'OK:CLIP_INSERTED';

  } catch (e) {
    return 'ERR:CLIP:' + e.toString();
  }
}

/**
 * Retorna informações sobre a sequência ativa
 */
function getSequenceInfo() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ error: 'NO_SEQUENCE' });
    return JSON.stringify({
      name: seq.name,
      duration: seq.end.seconds,
      playhead: seq.getPlayerPosition().seconds,
      videoTracks: seq.videoTracks.numTracks,
      audioTracks: seq.audioTracks.numTracks,
    });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

/**
 * Verifica se há uma sequência aberta
 */
function hasActiveSequence() {
  try {
    return app.project.activeSequence ? 'true' : 'false';
  } catch (e) {
    return 'false';
  }
}
