#!/bin/bash
# =============================================================
#  CinePRO — roda todas as suítes de teste de uma vez.
#
#  Pega toda `tools/test-*.js` por glob (suíte nova entra sozinha)
#  e mais `tools/check-lua.js`. Roda todas mesmo se uma falhar,
#  para o relatório mostrar tudo que quebrou de uma vez.
#
#  Sai 0 só se todas passarem; 1 se alguma falhar.
#  Usado pelo build-installers.yml antes do build (BL-0003).
#
#  Uso:  ./tools/run-all-tests.sh
# =============================================================

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

shopt -s nullglob
SUITES=(tools/test-*.js tools/check-lua.js)

if [ ${#SUITES[@]} -le 1 ]; then
  echo "Nenhuma suíte tools/test-*.js encontrada" >&2
  exit 1
fi

FAILED=()
for suite in "${SUITES[@]}"; do
  echo "──── $suite"
  if node "$suite"; then
    echo "ok   $suite"
  else
    echo "FALHOU $suite (saída $?)"
    FAILED+=("$suite")
  fi
done

echo
echo "${#SUITES[@]} suítes, $(( ${#SUITES[@]} - ${#FAILED[@]} )) ok, ${#FAILED[@]} falharam"
if [ ${#FAILED[@]} -gt 0 ]; then
  printf '  falhou: %s\n' "${FAILED[@]}"
  exit 1
fi
