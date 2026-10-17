// =============================================================
//  CinePRO — Decisão de acesso pela leitura da assinatura (BL-0043)
//
//  Antes: qualquer erro ao ler users/<uid> no Firestore (offline,
//  timeout, permissão) caía na tela "Assinatura inativa" e mandava
//  assinante pagante ao checkout.
//
//  Agora o erro de leitura é estado próprio. Se a última conferência
//  ATIVA do mesmo uid tem até 3 dias, o painel abre mesmo sem rede.
//  Só a leitura que chegou e disse "não ativo" (ou doc inexistente)
//  vira "inativo".
//
//  Sem dependência de DOM/CEP: roda no plugin e em teste.
// =============================================================

(function (global) {
  'use strict';

  var DIA_MS = 24 * 60 * 60 * 1000;
  var TOLERANCIA_MS = 3 * DIA_MS;
  var STORAGE_KEY = 'cinepro_ultima_assinatura_ativa';

  /**
   * @param leitura     { uid, erro } quando o get() falhou, ou
   *                    { uid, ativo: boolean } quando a leitura chegou
   * @param ultimaAtiva { uid, em: ms } da última conferência ativa, ou null
   * @param agora       ms
   * @returns { estado: 'ativo'|'offline-liberado'|'offline-bloqueado'|'inativo',
   *            ate?: ms }  — `ate` só em offline-liberado (fim da tolerância)
   */
  function resultadoAssinatura(leitura, ultimaAtiva, agora) {
    leitura = leitura || {};
    if (!leitura.erro) return { estado: leitura.ativo === true ? 'ativo' : 'inativo' };

    var u = ultimaAtiva;
    if (u && u.uid && u.uid === leitura.uid && typeof u.em === 'number') {
      var idade = agora - u.em;
      // idade < 0: data no futuro (relógio mexido ou registro forjado) não vale
      if (idade >= 0 && idade <= TOLERANCIA_MS) {
        return { estado: 'offline-liberado', ate: u.em + TOLERANCIA_MS };
      }
    }
    return { estado: 'offline-bloqueado' };
  }

  /** Lê o registro salvo; qualquer lixo vira null. */
  function lerUltimaAtiva(storage) {
    try {
      var v = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      return v && typeof v === 'object' ? v : null;
    } catch (e) { return null; }
  }

  function salvarUltimaAtiva(storage, uid, agora) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ uid: uid, em: agora })); } catch (e) {}
  }

  function apagarUltimaAtiva(storage) {
    try { storage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  var api = {
    TOLERANCIA_MS: TOLERANCIA_MS,
    STORAGE_KEY: STORAGE_KEY,
    resultadoAssinatura: resultadoAssinatura,
    lerUltimaAtiva: lerUltimaAtiva,
    salvarUltimaAtiva: salvarUltimaAtiva,
    apagarUltimaAtiva: apagarUltimaAtiva,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.CinePROSubscription = api;

})(typeof window !== 'undefined' ? window : globalThis);
