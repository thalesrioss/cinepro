#!/bin/bash
# =============================================================
#  CinePRO — funções comuns do preinstall/postinstall (macOS)
#  O pkgbuild copia a pasta scripts/ inteira, então este arquivo
#  vai junto e os scripts carregam com `. "$(dirname "$0")/cinepro-lib.sh"`.
#  Testado por tools/test-mac-installer-scripts.js (com fakes; não
#  roda nada de instalação).
# =============================================================

# Comandos trocáveis só para o teste.
CINEPRO_PGREP="${CINEPRO_PGREP:-/usr/bin/pgrep}"
CINEPRO_OSASCRIPT="${CINEPRO_OSASCRIPT:-/usr/bin/osascript}"
CINEPRO_LAUNCHCTL="${CINEPRO_LAUNCHCTL:-/bin/launchctl}"
CINEPRO_EUID="${CINEPRO_EUID:-$(id -u)}"

CINEPRO_BUNDLE_ID="com.thales.cinepro"

# Usuário logado na tela (o Installer roda os scripts como root).
cinepro_console_user() {
  stat -f%Su /dev/console 2>/dev/null
}

cinepro_premiere_aberto() {
  "$CINEPRO_PGREP" -i "Adobe Premiere Pro" > /dev/null 2>&1
}

# Mostra o alerta e imprime o botão escolhido ("button returned:...").
# Como root não há sessão gráfica: roda o osascript na sessão do usuário
# da tela com launchctl asuser. Sai ≠0 se não conseguir mostrar.
cinepro_alerta_premiere() {
  local script='display alert "Feche o Premiere Pro" message "O CinePRO atualiza o painel do Premiere. Feche o Adobe Premiere Pro (salve o projeto antes) e clique em Tentar de novo." as critical buttons {"Cancelar", "Tentar de novo"} default button "Tentar de novo" cancel button "Cancelar"'
  if [ "$CINEPRO_EUID" = "0" ]; then
    local user uid
    user="$(cinepro_console_user)"
    if [ -z "$user" ] || [ "$user" = "root" ] || [ "$user" = "loginwindow" ]; then
      return 1
    fi
    uid="$(id -u "$user" 2>/dev/null)" || return 1
    "$CINEPRO_LAUNCHCTL" asuser "$uid" sudo -u "$user" "$CINEPRO_OSASCRIPT" -e "$script" 2>/dev/null
  else
    "$CINEPRO_OSASCRIPT" -e "$script" 2>/dev/null
  fi
}

# Laço: enquanto o Premiere estiver aberto, pergunta de novo.
# 0 = Premiere fechado; 1 = Cancelar (ou alerta impossível de mostrar).
cinepro_esperar_premiere_fechar() {
  local resposta
  while cinepro_premiere_aberto; do
    # Cancelar faz o osascript sair com erro -128.
    resposta="$(cinepro_alerta_premiere)" || return 1
    case "$resposta" in
      *"Tentar de novo"*) sleep "${CINEPRO_ESPERA:-1}" ;;
      *) return 1 ;;
    esac
  done
  return 0
}

# Apaga só o cache do Chromium do CEP do painel CinePRO (todas as
# versões de app/host), nunca o de outras extensões.
cinepro_limpar_cache() {
  local home="$1"
  [ -n "$home" ] || return 0
  rm -rf "$home/Library/Caches/CSXS/cep_cache/"*"$CINEPRO_BUNDLE_ID"* 2>/dev/null || true
}
