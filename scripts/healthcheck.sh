#!/usr/bin/env bash
# Verifica a saúde de um ambiente Comandou pelo endereço público.
# Uso: scripts/healthcheck.sh https://demo.comandou.com
set -euo pipefail
BASE="${1:?uso: $0 <url-de-um-restaurante>}"
fail=0
check() {
  local name="$1" url="$2" expect="$3"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)"
  if [[ "$code" == "$expect" ]]; then echo "OK    $name ($code)"; else echo "FALHA $name (esperado $expect, recebido $code)"; fail=1; fi
}
check "api liveness"       "$BASE/api/v1/health/live"  200
check "api readiness (db)" "$BASE/api/v1/health/ready" 200
check "tenant resolvido"   "$BASE/api/v1/tenant"       200
check "frontend"           "$BASE/"                    200
check "rota SPA"           "$BASE/cardapio"            200
check "sessão exigida"     "$BASE/api/v1/auth/me"      401
exit $fail
