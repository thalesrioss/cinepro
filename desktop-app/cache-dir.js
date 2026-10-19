// =============================================================
//  Pasta de cache do CinePRO — a MESMA que o plugin usa
//  (jsx/hostscript.jsx, getCacheDir):
//    macOS:   ~/Library/Application Support/CinePRO/cache
//    Windows: %APPDATA%\CinePRO\cache
//  Se divergir, o app baixa num lugar e o plugin procura em outro:
//  arquivo baixado duas vezes e in-use.json (proteção da limpeza)
//  sem efeito entre os dois.
// =============================================================

'use strict';

const path = require('path');
const os   = require('os');

// Pasta-mãe (CinePRO/): guarda cache/ e in-use.json.
function cineproBase(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    const appData = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
    return path.win32.join(appData, 'CinePRO');
  }
  return path.posix.join(home, 'Library', 'Application Support', 'CinePRO');
}

function cacheDir(platform = process.platform, env = process.env, home = os.homedir()) {
  const base = cineproBase(platform, env, home);
  return (platform === 'win32' ? path.win32 : path.posix).join(base, 'cache');
}

module.exports = { cineproBase, cacheDir };
