#!/usr/bin/env bash
# Instalador do PedeMais em um nó manager do Docker Swarm (Ubuntu, AMD64 ou ARM64).
# NÃO remove serviços, volumes ou redes. Pede confirmação antes de qualquer alteração.
# Uso: PEDEMAIS_VERSION=v0.1.0 scripts/install.sh [--yes]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${PEDEMAIS_INSTALL_LOG:-$ROOT/install-$(date +%Y%m%d-%H%M%S).log}"
STACK="${PEDEMAIS_STACK:-pedemais}"
ASSUME_YES=false; [[ "${1:-}" == "--yes" ]] && ASSUME_YES=true
exec > >(tee -a "$LOG") 2>&1

step() { echo; echo "==> $*"; }
die() { echo "ERRO: $*" >&2; echo "Log completo: $LOG" >&2; echo "Recuperação: docs/deploy.md#rollback" >&2; exit 1; }
confirm() { $ASSUME_YES && return 0; read -r -p "$1 [s/N] " a; [[ "$a" =~ ^[sS]$ ]]; }

step "1. Sistema operacional e requisitos"
[[ "$(uname -s)" == "Linux" ]] || die "requer Linux"
. /etc/os-release 2>/dev/null && echo "SO: ${PRETTY_NAME:-desconhecido} | arquitetura: $(uname -m)"
for bin in docker curl; do command -v "$bin" >/dev/null || die "comando ausente: $bin"; done

step "2. Docker e Swarm"
docker info >/dev/null 2>&1 || die "Docker não está acessível para este usuário"
[[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" == "active" ]] || die "este nó não faz parte de um Swarm"
[[ "$(docker info --format '{{.Swarm.ControlAvailable}}')" == "true" ]] || die "execute em um nó manager"

step "3. Variáveis obrigatórias"
# Valores não secretos do servidor (bucket, endpoint, URL de saúde...). Ver docs/deploy.md.
DEPLOY_ENV="${PEDEMAIS_DEPLOY_ENV:-/etc/pedemais/deploy.env}"
if [[ -f "$DEPLOY_ENV" ]]; then
  echo "lendo $DEPLOY_ENV"
  set -a
  # shellcheck source=/dev/null
  . "$DEPLOY_ENV"
  set +a
fi
: "${PEDEMAIS_VERSION:?defina PEDEMAIS_VERSION (tag imutável, ex.: v0.1.0)}"
export PEDEMAIS_BASE_DOMAIN="${PEDEMAIS_BASE_DOMAIN:-pedemais.com}"
: "${BACKUP_S3_BUCKET:?defina BACKUP_S3_BUCKET (bucket do B2/S3 para os backups)}"
: "${BACKUP_S3_ENDPOINT:?defina BACKUP_S3_ENDPOINT (ex.: https://s3.us-west-004.backblazeb2.com)}"
export BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT
echo "versão=$PEDEMAIS_VERSION domínio=$PEDEMAIS_BASE_DOMAIN stack=$STACK bucket=$BACKUP_S3_BUCKET"

step "4. Rede pública e secrets"
docker network inspect network_public >/dev/null 2>&1 || die "rede network_public não existe (o Traefik precisa estar instalado)"
missing=()
while read -r s; do
  [[ -z "$s" || "$s" == \#* ]] && continue
  docker secret inspect "$s" >/dev/null 2>&1 || missing+=("$s")
done < "$ROOT/scripts/required-secrets.txt"
((${#missing[@]} == 0)) || die "secrets ausentes: ${missing[*]} (veja docs/deploy.md#secrets; os valores nunca são impressos)"

step "5. Backup antes de atualizar"
# Só existe a partir da 0.5.0. Na primeira instalação não há o que salvar.
BACKUP_CTR="$(docker ps -q --filter "label=com.docker.swarm.service.name=${STACK}_backup" | head -1)"
if [[ -n "$BACKUP_CTR" ]]; then
  if [[ "${PEDEMAIS_SKIP_BACKUP:-}" == "1" ]]; then
    echo "AVISO: backup antes da atualização pulado (PEDEMAIS_SKIP_BACKUP=1)"
  else
    docker exec "$BACKUP_CTR" /opt/pedemais-backup/backup.sh || die "backup falhou: a atualização foi cancelada"
  fi
else
  echo "serviço ${STACK}_backup ainda não está rodando neste nó: sem backup prévio"
fi

step "6. Implantação da stack"
echo "Serviços afetados: ${STACK}_postgres, ${STACK}_redis, ${STACK}_whatsapp-gateway, ${STACK}_backup, ${STACK}_migrate, ${STACK}_api, ${STACK}_web"
confirm "Aplicar a stack '$STACK' na versão $PEDEMAIS_VERSION?" || die "cancelado pelo operador"
docker stack deploy --with-registry-auth -c "$ROOT/infrastructure/swarm/pedemais-stack.yml" "$STACK"

step "7. Migrações"
echo "Aguardando o serviço ${STACK}_migrate concluir..."
for _ in $(seq 1 60); do
  state="$(docker service ps "${STACK}_migrate" --format '{{.CurrentState}}' | head -1)"
  [[ "$state" == Complete* ]] && { echo "migrações concluídas"; break; }
  [[ "$state" == Failed* || "$state" == Rejected* ]] && die "migração falhou: docker service logs ${STACK}_migrate"
  sleep 5
done

step "8. Saúde dos componentes"
docker service ls --filter "label=com.docker.stack.namespace=$STACK"
if [[ -n "${PEDEMAIS_HEALTH_URL:-}" ]]; then
  "$ROOT/scripts/healthcheck.sh" "$PEDEMAIS_HEALTH_URL" || die "health check falhou"
else
  echo "Defina PEDEMAIS_HEALTH_URL=https://<slug>.$PEDEMAIS_BASE_DOMAIN para verificar pelo endereço público."
fi
echo; echo "Instalação concluída. Log: $LOG"
