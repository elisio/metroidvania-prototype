#!/usr/bin/env bash
# Roda `node --check` em todo .js de src/ e assets/game/.
# Uso: tools/ci/check_syntax.sh   (a partir de qualquer pasta)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: node não encontrado no PATH" >&2
  exit 1
fi

files=()
if [ -d src ]; then
  while IFS= read -r -d '' f; do files+=("$f"); done < <(find src -type f -name '*.js' -print0 | sort -z)
fi
for f in assets/game/*.js; do
  [ -f "$f" ] && files+=("$f")
done

if [ "${#files[@]}" -eq 0 ]; then
  echo "check_syntax: nenhum arquivo .js encontrado"
  exit 0
fi

fail=0
for f in "${files[@]}"; do
  if ! out="$(node --check "$f" 2>&1)"; then
    echo "FALHOU: $f"
    echo "$out" | sed 's/^/    /'
    fail=$((fail + 1))
  fi
done

if [ "$fail" -gt 0 ]; then
  echo "check_syntax: $fail de ${#files[@]} arquivo(s) com erro de sintaxe" >&2
  exit 1
fi
echo "check_syntax: OK — ${#files[@]} arquivo(s) verificados"
