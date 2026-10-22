#!/usr/bin/env bash
# Esqueci a senha do Super Admin: define senha nova e um novo código do autenticador para um
# administrador existente e encerra as sessões dele. Roda no manager do Swarm. Não apaga nada.
#
#   scripts/admin-reset.sh <e-mail do administrador>
#
# Cria um serviço de uma execução na rede interna da stack, com a conexão do dono do banco e a
# chave de integrações (Docker secrets), e remove serviço e secrets temporários no fim. A senha e
# a chave do autenticador só passam por Docker secrets e pelo terminal, nunca pelo log.
set -euo pipefail
STACK="${COMANDOU_STACK:-comandou}"
EMAIL="${1:-}"
[[ "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "uso: scripts/admin-reset.sh <e-mail>" >&2; exit 2; }
{ : >/dev/tty; } 2>/dev/null || { echo "ERRO: precisa de um terminal para a senha" >&2; exit 1; }
docker info --format '{{.Swarm.ControlAvailable}}' 2>/dev/null | grep -q true || { echo "ERRO: execute em um nó manager do Swarm" >&2; exit 1; }
VERSION="$(docker service inspect "${STACK}_api" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | sed 's/@.*//')"
[[ -n "$VERSION" ]] || { echo "ERRO: serviço ${STACK}_api não encontrado" >&2; exit 1; }

read -r -s -p "Nova senha (12 caracteres ou mais): " PASS </dev/tty >/dev/tty; echo >/dev/tty
read -r -s -p "Repita: " PASS2 </dev/tty >/dev/tty; echo >/dev/tty
[[ "$PASS" == "$PASS2" ]] || { echo "ERRO: as senhas não conferem" >&2; exit 1; }
((${#PASS} >= 12)) || { echo "ERRO: a senha precisa de 12 caracteres ou mais" >&2; exit 1; }
TOTP="$(head -c 20 /dev/urandom | base32 | tr -d '=\n')"
SUFFIX="$(date +%s)"
S_PASS="comandou_reset_pw_$SUFFIX"; S_TOTP="comandou_reset_totp_$SUFFIX"; SVC="${STACK}_admin_reset"
cleanup() { docker service rm "$SVC" >/dev/null 2>&1 || true; docker secret rm "$S_PASS" "$S_TOTP" >/dev/null 2>&1 || true; }
trap cleanup EXIT

printf '%s' "$PASS" | docker secret create "$S_PASS" - >/dev/null
printf '%s' "$TOTP" | docker secret create "$S_TOTP" - >/dev/null
unset PASS PASS2
docker service create --name "$SVC" --restart-condition none --detach \
  --network "${STACK}_comandou_internal" \
  --secret source=comandou_db_owner_url,target=owner_url \
  --secret source=comandou_integrations_key,target=integrations_key \
  --secret source="$S_PASS",target=admin_pw --secret source="$S_TOTP",target=admin_totp \
  -e DATABASE_OWNER_URL_FILE=/run/secrets/owner_url -e INTEGRATIONS_KEY_FILE=/run/secrets/integrations_key \
  -e PLATFORM_ADMIN_PASSWORD_FILE=/run/secrets/admin_pw -e PLATFORM_ADMIN_TOTP_SECRET_FILE=/run/secrets/admin_totp \
  "$VERSION" node dist/platform/platform-admin-cli.js --reset "$EMAIL" >/dev/null

for _ in $(seq 1 30); do
  state="$(docker service ps "$SVC" --format '{{.CurrentState}}' | head -1)"
  [[ "$state" == Complete* ]] && break
  if [[ "$state" == Failed* || "$state" == Rejected* ]]; then
    docker service logs "$SVC" 2>&1 | grep -v otpauth | tail -5 >&2
    echo "ERRO: a redefinição falhou (e-mail existe?)" >&2; exit 1
  fi
  sleep 2
done
[[ "${state:-}" == Complete* ]] || { echo "ERRO: tempo esgotado" >&2; exit 1; }
{
  echo
  echo "Acesso redefinido para $EMAIL. Cadastre no aplicativo autenticador (não será mostrado de novo):"
  echo "Chave:   $TOTP"
  echo "Endereço: otpauth://totp/Comandou:${EMAIL}?secret=${TOTP}&issuer=Comandou"
  command -v qrencode >/dev/null && qrencode -t ANSIUTF8 "otpauth://totp/Comandou:${EMAIL}?secret=${TOTP}&issuer=Comandou"
} >/dev/tty
