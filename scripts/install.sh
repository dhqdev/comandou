#!/usr/bin/env bash
# Instalador do Comandou (Ubuntu/Debian, AMD64 ou ARM64). Instala e atualiza.
#
#   Primeira vez (um comando, baixa tudo do GitHub):
#     curl -fsSL https://raw.githubusercontent.com/dhqdev/comandou/main/scripts/get.sh | sudo bash
#   Ou, com o repositório já baixado:   scripts/install.sh [--yes]
#
# O que faz, pedindo confirmação antes de cada alteração no servidor:
#   - instala o Docker, se faltar, e liga o modo Swarm de um nó só, se ainda não estiver ligado;
#   - cria a rede network_public e instala um Traefik (HTTPS automático) se não houver um;
#   - pergunta domínio, e-mail e senha do Super Admin e o bucket de backup; gera os demais
#     segredos sozinho como Docker secrets (nunca grava senha em arquivo nem no log);
#   - sobe a stack, espera as migrações e confere a saúde.
# NÃO remove serviços, volumes, redes nem secrets existentes: o que já existe é reaproveitado.
#
# Sem perguntas (automação): defina as variáveis listadas em docs/install.md e use --yes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${COMANDOU_INSTALL_LOG:-$ROOT/install-$(date +%Y%m%d-%H%M%S).log}"
STACK="${COMANDOU_STACK:-comandou}"
REPO="${COMANDOU_REPO:-dhqdev/comandou}"
IMAGES="ghcr.io/${REPO%%/*}"
ASSUME_YES=false; [[ "${1:-}" == "--yes" ]] && ASSUME_YES=true
# Tudo que sai aqui vai para o log. Segredos NUNCA passam por stdout: só por /dev/tty.
exec > >(tee -a "$LOG") 2>&1

step() { echo; echo "==> $*"; }
die() { echo "ERRO: $*" >&2; echo "Log completo: $LOG" >&2; echo "Recuperação: docs/deploy.md#rollback" >&2; exit 1; }
have_tty() { { : >/dev/tty; } 2>/dev/null; }
confirm() { $ASSUME_YES && return 0; have_tty || die "sem terminal para confirmar; use --yes"; read -r -p "$1 [s/N] " a </dev/tty >/dev/tty; [[ "$a" =~ ^[sS]$ ]]; }
# ask VAR "pergunta" [padrão]: usa a variável do ambiente se já veio definida.
ask() {
  local var="$1" q="$2" def="${3:-}" v
  [[ -n "${!var:-}" ]] && return 0
  if $ASSUME_YES || ! have_tty; then
    [[ -n "$def" ]] && { printf -v "$var" '%s' "$def"; return 0; }
    die "defina $var (modo sem perguntas)"
  fi
  read -r -p "$q${def:+ [$def]}: " v </dev/tty >/dev/tty
  printf -v "$var" '%s' "${v:-$def}"
  [[ -n "${!var}" ]] || die "$var não pode ficar vazio"
}
# ask_secret VAR "pergunta": lê sem eco, duas vezes; ou de COMANDOU_..._FILE.
ask_secret() {
  local var="$1" q="$2" a b
  [[ -n "${!var:-}" ]] && return 0
  $ASSUME_YES || ! have_tty && die "defina $var (modo sem perguntas)"
  while :; do
    read -r -s -p "$q: " a </dev/tty >/dev/tty; echo >/dev/tty
    read -r -s -p "Repita: " b </dev/tty >/dev/tty; echo >/dev/tty
    [[ "$a" == "$b" ]] && break
    echo "As senhas não conferem." >/dev/tty
  done
  printf -v "$var" '%s' "$a"
}
valid_email() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; }
secret_exists() { docker secret inspect "$1" >/dev/null 2>&1; }
# mk_secret NOME: lê o valor do stdin, sem alterar; não sobrescreve um secret que já existe.
mk_secret() {
  secret_exists "$1" && { echo "secret $1 já existe: mantido"; return 0; }
  docker secret create "$1" - >/dev/null
  echo "secret $1 criado"
}
SUDO=""; [[ "$(id -u)" -ne 0 ]] && SUDO="sudo"

step "1. Sistema, arquitetura e Docker"
[[ "$(uname -s)" == "Linux" ]] || die "requer Linux"
# shellcheck source=/dev/null
. /etc/os-release 2>/dev/null && echo "SO: ${PRETTY_NAME:-desconhecido}"
ARCH="$(uname -m)"; echo "arquitetura: $ARCH"
case "$ARCH" in x86_64|aarch64|arm64) ;; *) die "arquitetura $ARCH sem imagens (só amd64 e arm64)";; esac
command -v curl >/dev/null || die "comando ausente: curl"
command -v openssl >/dev/null || die "comando ausente: openssl"
if ! command -v docker >/dev/null; then
  confirm "Docker não encontrado. Instalar agora (script oficial get.docker.com)?" || die "Docker é obrigatório"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
docker info >/dev/null 2>&1 || die "Docker não está acessível para este usuário (use sudo ou entre no grupo docker)"

step "2. Swarm"
SWARM="$(docker info --format '{{.Swarm.LocalNodeState}}')"
if [[ "$SWARM" != "active" ]]; then
  echo "O Comandou roda como stack do Docker Swarm. Um servidor só funciona (Swarm de um nó)."
  confirm "Ligar o modo Swarm neste servidor (docker swarm init)?" || die "Swarm é obrigatório"
  docker swarm init ${COMANDOU_ADVERTISE_ADDR:+--advertise-addr "$COMANDOU_ADVERTISE_ADDR"} >/dev/null \
    || die "swarm init falhou; se o servidor tem mais de um IP, defina COMANDOU_ADVERTISE_ADDR=<ip>"
fi
[[ "$(docker info --format '{{.Swarm.ControlAvailable}}')" == "true" ]] || die "execute em um nó manager"

step "3. Configuração"
# Valores não secretos do servidor. Ver docs/install.md.
DEPLOY_ENV="${COMANDOU_DEPLOY_ENV:-/etc/comandou/deploy.env}"
if [[ -f "$DEPLOY_ENV" ]]; then
  echo "lendo $DEPLOY_ENV"
  set -a
  # shellcheck source=/dev/null
  . "$DEPLOY_ENV"
  set +a
fi
if [[ -z "${COMANDOU_VERSION:-}" ]]; then
  # Sem versão: usa a última Release do GitHub (a que a Release automática publicou).
  if [[ -f "$ROOT/.comandou-version" ]]; then COMANDOU_VERSION="$(cat "$ROOT/.comandou-version")"
  else
    COMANDOU_VERSION="$(curl -fsSL ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
      "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  fi
  [[ -n "$COMANDOU_VERSION" ]] || die "não achei a versão: defina COMANDOU_VERSION=vX.Y.Z"
fi
[[ "$COMANDOU_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "COMANDOU_VERSION inválida: $COMANDOU_VERSION (use vX.Y.Z)"
export COMANDOU_VERSION
ask COMANDOU_BASE_DOMAIN "Domínio do sistema (os restaurantes ficam em <nome>.<domínio>)" "comandou.com"
export COMANDOU_BASE_DOMAIN
echo "Antes de seguir, no DNS: registros A de @ e * (e admin) apontando para o IP deste servidor."
if ! secret_exists comandou_platform_admin_password; then
  ask PLATFORM_ADMIN_EMAIL "E-mail do Super Admin (será o seu login em admin.$COMANDOU_BASE_DOMAIN)"
  valid_email "$PLATFORM_ADMIN_EMAIL" || die "e-mail do Super Admin inválido"
  ask PLATFORM_ADMIN_NAME "Nome do Super Admin" "Administrador"
  if [[ -z "${COMANDOU_ADMIN_PASSWORD:-}" && -n "${COMANDOU_ADMIN_PASSWORD_FILE:-}" ]]; then
    COMANDOU_ADMIN_PASSWORD="$(tr -d '\n' < "$COMANDOU_ADMIN_PASSWORD_FILE")"
  fi
  ask_secret COMANDOU_ADMIN_PASSWORD "Senha do Super Admin (12 caracteres ou mais)"
  ((${#COMANDOU_ADMIN_PASSWORD} >= 12)) || die "a senha do Super Admin precisa de 12 caracteres ou mais"
fi
export PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-}" PLATFORM_ADMIN_NAME="${PLATFORM_ADMIN_NAME:-Administrador}"
if [[ "${COMANDOU_BACKUP:-on}" == "off" ]]; then
  echo "AVISO: backups desligados (COMANDOU_BACKUP=off). Não recomendado em produção."
  BACKUP_S3_BUCKET=desligado; BACKUP_S3_ENDPOINT=https://desligado.invalid
else
  ask BACKUP_S3_ENDPOINT "Endereço S3 do backup (ex.: https://s3.us-west-004.backblazeb2.com)"
  ask BACKUP_S3_BUCKET "Nome do bucket de backup"
fi
export BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT
export TRAEFIK_ENTRYPOINT="${TRAEFIK_ENTRYPOINT:-websecure}" TRAEFIK_CERT_RESOLVER="${TRAEFIK_CERT_RESOLVER:-letsencryptresolver}"
echo "versão=$COMANDOU_VERSION domínio=$COMANDOU_BASE_DOMAIN stack=$STACK bucket=$BACKUP_S3_BUCKET"

step "4. Imagens ($ARCH)"
# Baixar antes falha cedo e claro (login do GHCR, versão que não existe, arquitetura sem imagem).
if ! docker pull -q "$IMAGES/comandou-api:$COMANDOU_VERSION" >/dev/null 2>&1; then
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    echo "$GITHUB_TOKEN" | docker login ghcr.io -u "${GITHUB_USER:-${REPO%%/*}}" --password-stdin >/dev/null \
      || die "login no GHCR falhou"
    docker pull -q "$IMAGES/comandou-api:$COMANDOU_VERSION" >/dev/null || die "imagem $IMAGES/comandou-api:$COMANDOU_VERSION não encontrada"
  else
    die "não consegui baixar $IMAGES/comandou-api:$COMANDOU_VERSION. Se o pacote é privado: GITHUB_TOKEN=<token com read:packages>. Se a versão é nova, espere a Release terminar no GitHub."
  fi
fi
echo "imagem da API ok"

step "5. Rede pública e Traefik"
if ! docker network inspect network_public >/dev/null 2>&1; then
  confirm "Criar a rede network_public (overlay)?" || die "a rede network_public é obrigatória"
  docker network create --driver overlay --attachable network_public >/dev/null
fi
TRAEFIK_SVC="$(docker service ls --format '{{.Name}} {{.Image}}' | awk '$2 ~ /traefik/ {print $1; exit}')"
if [[ -n "$TRAEFIK_SVC" ]]; then
  echo "Traefik existente: $TRAEFIK_SVC (mantido). Confira o provider HTTP e os resolvers em docs/deploy.md."
else
  echo "Nenhum Traefik no Swarm."
  confirm "Instalar um Traefik com HTTPS automático (Let's Encrypt) nas portas 80 e 443?" || die "o Traefik é necessário para o HTTPS"
  ask COMANDOU_ACME_EMAIL "E-mail para o Let's Encrypt (avisos de certificado)"
  valid_email "$COMANDOU_ACME_EMAIL" || die "e-mail do Let's Encrypt inválido"
  INSTALL_TRAEFIK=1
fi

step "6. Secrets"
rand_hex() { openssl rand -hex "$1"; }
if ! secret_exists comandou_pg_password; then
  PG="$(rand_hex 24)"; OWN="$(rand_hex 24)"; APP="$(rand_hex 24)"; PLAT="$(rand_hex 24)"
  printf '%s' "$PG"   | mk_secret comandou_pg_password
  printf '%s' "$OWN"  | mk_secret comandou_owner_password
  printf '%s' "$APP"  | mk_secret comandou_app_password
  printf '%s' "$PLAT" | mk_secret comandou_platform_password
  printf 'postgres://comandou_app:%s@postgres:5432/comandou' "$APP"           | mk_secret comandou_db_app_url
  printf 'postgres://comandou_owner:%s@postgres:5432/comandou' "$OWN"         | mk_secret comandou_db_owner_url
  printf 'postgres://comandou_platform:%s@postgres:5432/comandou' "$PLAT"     | mk_secret comandou_db_platform_url
  unset PG OWN APP PLAT
else
  echo "secrets do banco já existem: mantidos"
fi
openssl rand -base64 32 | tr -d '\n' | mk_secret comandou_integrations_key
rand_hex 32 | tr -d '\n' | mk_secret comandou_wa_gateway_token
openssl rand -base64 32 | tr -d '\n' | mk_secret comandou_wa_session_key
rand_hex 32 | tr -d '\n' | mk_secret comandou_metrics_token
if ! secret_exists comandou_traefik_provider_token; then
  PROVIDER_TOKEN="$(rand_hex 32)"
  printf '%s' "$PROVIDER_TOKEN" | mk_secret comandou_traefik_provider_token
fi

if ! secret_exists comandou_platform_admin_password; then
  # Segredo do autenticador: 20 bytes em base32. Só aparece no terminal, nunca no log.
  TOTP="${COMANDOU_ADMIN_TOTP_SECRET:-}"
  if [[ -z "$TOTP" ]]; then
    have_tty || die "sem terminal para mostrar a chave do autenticador: defina COMANDOU_ADMIN_TOTP_SECRET (base32, 16+ caracteres)"
    TOTP="$(head -c 20 /dev/urandom | base32 | tr -d '=\n')"
  fi
  [[ "$TOTP" =~ ^[A-Z2-7]{16,}$ ]] || die "COMANDOU_ADMIN_TOTP_SECRET precisa ser base32 (A-Z e 2-7), 16+ caracteres"
  printf '%s' "$TOTP" | mk_secret comandou_platform_admin_totp
  printf '%s' "$COMANDOU_ADMIN_PASSWORD" | mk_secret comandou_platform_admin_password
  if have_tty; then
    {
      echo
      echo "=== Super Admin: cadastre no aplicativo autenticador AGORA (não será mostrado de novo) ==="
      echo "Chave:   $TOTP"
      echo "Endereço: otpauth://totp/Comandou:${PLATFORM_ADMIN_EMAIL}?secret=${TOTP}&issuer=Comandou"
      command -v qrencode >/dev/null && qrencode -t ANSIUTF8 "otpauth://totp/Comandou:${PLATFORM_ADMIN_EMAIL}?secret=${TOTP}&issuer=Comandou"
      echo "Depois entre em https://admin.$COMANDOU_BASE_DOMAIN com o e-mail, a senha que você digitou e o código do aplicativo."
      echo
    } >/dev/tty
    $ASSUME_YES || { read -r -p "Cadastrou no aplicativo? Enter para continuar " _ </dev/tty >/dev/tty; }
  else
    echo "Super Admin: usando o segredo do autenticador informado em COMANDOU_ADMIN_TOTP_SECRET."
  fi
  unset TOTP COMANDOU_ADMIN_PASSWORD COMANDOU_ADMIN_TOTP_SECRET
else
  echo "Super Admin: secrets já existem, nada a perguntar"
fi

if [[ "${COMANDOU_BACKUP:-on}" == "off" ]]; then
  for s in comandou_backup_s3_key_id comandou_backup_s3_secret comandou_backup_age_identity; do
    printf 'desligado' | mk_secret "$s"
  done
else
  if ! secret_exists comandou_backup_s3_key_id; then
    ask COMANDOU_BACKUP_KEY_ID "keyID do bucket (Backblaze B2 ou S3)"
    ask_secret COMANDOU_BACKUP_APP_KEY "applicationKey do bucket"
    printf '%s' "$COMANDOU_BACKUP_KEY_ID" | mk_secret comandou_backup_s3_key_id
    printf '%s' "$COMANDOU_BACKUP_APP_KEY" | mk_secret comandou_backup_s3_secret
    unset COMANDOU_BACKUP_APP_KEY
  fi
  if ! secret_exists comandou_backup_age_identity; then
    docker pull -q "$IMAGES/comandou-backup:$COMANDOU_VERSION" >/dev/null || die "imagem de backup não encontrada"
    AGE="$(docker run --rm --entrypoint age-keygen "$IMAGES/comandou-backup:$COMANDOU_VERSION" 2>/dev/null)" \
      || die "não consegui gerar a chave de backup (age-keygen)"
    printf '%s' "$AGE" | mk_secret comandou_backup_age_identity
    if have_tty; then
      { echo; echo "=== Chave dos backups (GUARDE FORA DO SERVIDOR: sem ela o backup não abre) ==="; echo "$AGE"; echo; } >/dev/tty
      $ASSUME_YES || { read -r -p "Guardou? Enter para continuar " _ </dev/tty >/dev/tty; }
    fi
    unset AGE
  fi
fi

if [[ -n "${INSTALL_TRAEFIK:-}" ]] && ! secret_exists comandou_traefik_static; then
  # A configuração estática do Traefik leva o token do provider; ela vira um secret, não um arquivo.
  [[ -n "${PROVIDER_TOKEN:-}" ]] || die "o secret comandou_traefik_provider_token já existe e não dá para relê-lo: remova-o (docker secret rm) e rode de novo"
  sed "s|@ACME_EMAIL@|$COMANDOU_ACME_EMAIL|g; s|@PROVIDER_TOKEN@|$PROVIDER_TOKEN|" \
    "$ROOT/infrastructure/traefik/traefik.yml.tpl" | mk_secret comandou_traefik_static
fi
unset PROVIDER_TOKEN

step "7. Backup antes de atualizar"
# Só existe a partir da 0.5.0. Na primeira instalação não há o que salvar.
BACKUP_CTR="$(docker ps -q --filter "label=com.docker.swarm.service.name=${STACK}_backup" | head -1)"
if [[ -n "$BACKUP_CTR" ]]; then
  if [[ "${COMANDOU_SKIP_BACKUP:-}" == "1" ]]; then
    echo "AVISO: backup antes da atualização pulado (COMANDOU_SKIP_BACKUP=1)"
  else
    docker exec "$BACKUP_CTR" /opt/comandou-backup/backup.sh || die "backup falhou: a atualização foi cancelada"
  fi
else
  echo "serviço ${STACK}_backup ainda não está rodando neste nó: sem backup prévio"
fi

step "8. Traefik"
if [[ -n "${INSTALL_TRAEFIK:-}" ]]; then
  confirm "Aplicar a stack do Traefik (portas 80 e 443)?" || die "cancelado pelo operador"
  docker stack deploy -c "$ROOT/infrastructure/traefik/traefik-stack.yml" traefik
else
  echo "Traefik não instalado por este script."
fi

step "9. Implantação da stack"
echo "Serviços afetados: ${STACK}_postgres, ${STACK}_redis, ${STACK}_whatsapp-gateway, ${STACK}_backup, ${STACK}_migrate, ${STACK}_api, ${STACK}_web"
FILES=(-c "$ROOT/infrastructure/swarm/comandou-stack.yml")
[[ "${COMANDOU_WILDCARD_TLS:-}" == "1" ]] && FILES+=(-c "$ROOT/infrastructure/swarm/wildcard.yml")
[[ "${COMANDOU_BACKUP:-on}" == "off" ]] && FILES+=(-c "$ROOT/infrastructure/swarm/no-backup.yml")
confirm "Aplicar a stack '$STACK' na versão $COMANDOU_VERSION?" || die "cancelado pelo operador"
docker stack deploy --with-registry-auth "${FILES[@]}" "$STACK"

# Guarda só o que NÃO é segredo, para atualizar depois com `scripts/install.sh`.
if $SUDO mkdir -p "$(dirname "$DEPLOY_ENV")" 2>/dev/null; then
  $SUDO tee "$DEPLOY_ENV" >/dev/null <<ENVFILE
COMANDOU_BASE_DOMAIN=$COMANDOU_BASE_DOMAIN
PLATFORM_ADMIN_EMAIL=$PLATFORM_ADMIN_EMAIL
PLATFORM_ADMIN_NAME=$PLATFORM_ADMIN_NAME
BACKUP_S3_BUCKET=$BACKUP_S3_BUCKET
BACKUP_S3_ENDPOINT=$BACKUP_S3_ENDPOINT
TRAEFIK_ENTRYPOINT=$TRAEFIK_ENTRYPOINT
TRAEFIK_CERT_RESOLVER=$TRAEFIK_CERT_RESOLVER
${COMANDOU_BACKUP:+COMANDOU_BACKUP=$COMANDOU_BACKUP}
${COMANDOU_WILDCARD_TLS:+COMANDOU_WILDCARD_TLS=$COMANDOU_WILDCARD_TLS}
ENVFILE
  $SUDO chmod 600 "$DEPLOY_ENV"
  echo "configuração (sem segredos) salva em $DEPLOY_ENV"
fi

step "10. Migrações e Super Admin"
echo "Aguardando o serviço ${STACK}_migrate concluir..."
for _ in $(seq 1 60); do
  state="$(docker service ps "${STACK}_migrate" --format '{{.CurrentState}}' | head -1)"
  [[ "$state" == Complete* ]] && { echo "migrações concluídas"; break; }
  [[ "$state" == Failed* || "$state" == Rejected* ]] && die "migração falhou: docker service logs ${STACK}_migrate"
  sleep 5
done
docker service logs "${STACK}_migrate" 2>&1 | grep -E "Super Admin" | tail -2 || true

step "11. Saúde dos componentes"
docker service ls --filter "label=com.docker.stack.namespace=$STACK"
if [[ -n "${COMANDOU_HEALTH_URL:-}" ]]; then
  "$ROOT/scripts/healthcheck.sh" "$COMANDOU_HEALTH_URL" || die "health check falhou"
else
  echo "Defina COMANDOU_HEALTH_URL=https://<restaurante>.$COMANDOU_BASE_DOMAIN para verificar pelo endereço público."
fi
echo; echo "Instalação concluída. Super Admin: https://admin.$COMANDOU_BASE_DOMAIN  Log: $LOG"
