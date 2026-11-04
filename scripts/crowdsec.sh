#!/usr/bin/env bash
# Liga o CrowdSec no servidor do Comandou (docs/crowdsec.md). Rode no servidor, na pasta do
# Comandou, depois que o sistema já está instalado:
#
#   sudo scripts/crowdsec.sh            instala ou atualiza (pode rodar de novo quando quiser)
#   sudo scripts/crowdsec.sh --status   mostra o que o CrowdSec está vendo e quem está bloqueado
#   sudo scripts/crowdsec.sh --off      desliga o bloqueio (os sites continuam no ar)
#
# Ordem: (1) o Traefik ganha o plugin do CrowdSec, (2) o CrowdSec sobe e registra a chave do
# Traefik, (3) só então a API passa a pôr o bloqueio nas rotas. Cada passo é conferido antes do
# próximo. (Se o Traefik perder o plugin depois, a API tem roteadores de reserva: os sites seguem
# no ar, só sem bloqueio.)
# Pede confirmação antes de cada mudança. Nada é apagado: volumes e secrets existentes ficam.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="${COMANDOU_STACK:-comandou}"
DEPLOY_ENV="${COMANDOU_DEPLOY_ENV:-/etc/comandou/deploy.env}"
PLUGIN_MODULE="github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin"
PLUGIN_VERSION="v1.8.1"
PLUGIN_NAME="crowdsec" # o mesmo de CROWDSEC_PLUGIN_NAME na API
KEY_SECRET="comandou_crowdsec_bouncer_key"
ASSUME_YES=false
MODE=install
for a in "$@"; do
  case "$a" in
    --yes) ASSUME_YES=true ;;
    --status) MODE=status ;;
    --off) MODE=off ;;
    *) echo "uso: $0 [--yes] [--status|--off]" >&2; exit 2 ;;
  esac
done

step() { echo; echo "==> $*"; }
die() { echo "ERRO: $*" >&2; echo "Ajuda: docs/crowdsec.md" >&2; exit 1; }
have_tty() { { : >/dev/tty; } 2>/dev/null; }
confirm() { $ASSUME_YES && return 0; have_tty || die "sem terminal para confirmar; use --yes"; read -r -p "$1 [s/N] " a </dev/tty >/dev/tty; [[ "$a" =~ ^[sS]$ ]]; }
cs_ctr() { docker ps -q --filter "label=com.docker.swarm.service.name=crowdsec_crowdsec" | head -1; }
cscli() { local c; c="$(cs_ctr)"; [[ -n "$c" ]] || die "o CrowdSec não está rodando neste servidor"; docker exec "$c" cscli "$@"; }

# shellcheck source=/dev/null
[[ -f "$DEPLOY_ENV" ]] && { set -a; . "$DEPLOY_ENV"; set +a; }
docker info >/dev/null 2>&1 || die "Docker não está acessível (use sudo)"
[[ "$(docker info --format '{{.Swarm.ControlAvailable}}')" == "true" ]] || die "execute no nó manager do Swarm"

# Liga ou desliga o bloqueio na API (serviço já rodando; sem derrubar: start-first, uma réplica por vez).
api_bouncer() {
  local svc="${STACK}_api"
  docker service inspect "$svc" >/dev/null 2>&1 || die "serviço $svc não encontrado (o Comandou está instalado?)"
  if [[ "$1" == on ]]; then
    local args=(--env-add CROWDSEC_BOUNCER=true --env-add "CROWDSEC_BOUNCER_KEY_FILE=/run/secrets/$KEY_SECRET")
    [[ -n "${CROWDSEC_TRUSTED_IPS:-}" ]] && args+=(--env-add "CROWDSEC_TRUSTED_IPS=$CROWDSEC_TRUSTED_IPS")
    docker service inspect "$svc" --format '{{range .Spec.TaskTemplate.ContainerSpec.Secrets}}{{.SecretName}} {{end}}' \
      | grep -qw "$KEY_SECRET" || args+=(--secret-add "source=$KEY_SECRET,target=$KEY_SECRET")
    docker service update --quiet "${args[@]}" "$svc" >/dev/null
    # Certificado coringa: os roteadores dos restaurantes vêm dos labels (wildcard-crowdsec.yml).
    if [[ "${COMANDOU_WILDCARD_TLS:-}" == "1" ]]; then
      docker service update --quiet --label-add traefik.http.routers.comandou-api.middlewares=comandou-crowdsec@http "$svc" >/dev/null
      docker service update --quiet --label-add traefik.http.routers.comandou-web.middlewares=comandou-crowdsec@http "${STACK}_web" >/dev/null
    fi
  else
    # Primeiro os labels (apontam para o middleware), depois o middleware.
    if [[ "${COMANDOU_WILDCARD_TLS:-}" == "1" ]]; then
      docker service update --quiet --label-rm traefik.http.routers.comandou-api.middlewares "$svc" >/dev/null || true
      docker service update --quiet --label-rm traefik.http.routers.comandou-web.middlewares "${STACK}_web" >/dev/null || true
    fi
    docker service update --quiet --env-add CROWDSEC_BOUNCER=false "$svc" >/dev/null
  fi
}

# Guarda COMANDOU_CROWDSEC no deploy.env: o instalador passa a incluir infrastructure/swarm/crowdsec.yml.
save_flag() {
  local v="$1"
  mkdir -p "$(dirname "$DEPLOY_ENV")"
  touch "$DEPLOY_ENV"
  sed -i '/^COMANDOU_CROWDSEC=/d; /^CROWDSEC_TRUSTED_IPS=/d' "$DEPLOY_ENV"
  echo "COMANDOU_CROWDSEC=$v" >>"$DEPLOY_ENV"
  [[ "$v" == 1 && -n "${CROWDSEC_TRUSTED_IPS:-}" ]] && echo "CROWDSEC_TRUSTED_IPS=$CROWDSEC_TRUSTED_IPS" >>"$DEPLOY_ENV"
  chmod 600 "$DEPLOY_ENV"
}

if [[ "$MODE" == status ]]; then
  step "CrowdSec"
  docker service ls --filter name=crowdsec_crowdsec
  step "Leitura dos logs (linhas lidas e reconhecidas)"
  cscli metrics show acquisition parsers 2>/dev/null || cscli metrics
  step "Bouncers (o Traefik precisa aparecer como 'traefik', com Last API pull recente)"
  cscli bouncers list
  step "Alertas recentes"
  cscli alerts list --limit 15
  step "IPs bloqueados agora (fora a lista da comunidade)"
  cscli decisions list
  echo; echo "Desbloquear um IP:  docker exec \$(docker ps -q -f name=crowdsec_crowdsec) cscli decisions delete --ip <IP>"
  exit 0
fi

if [[ "$MODE" == off ]]; then
  confirm "Desligar o bloqueio do CrowdSec nos sites? (o CrowdSec continua rodando, só não bloqueia)" || exit 1
  api_bouncer off
  save_flag 0
  echo "Bloqueio desligado. Em até 30 s o Traefik tira o middleware das rotas."
  echo "Para tirar o CrowdSec de vez: docker stack rm crowdsec"
  exit 0
fi

step "1. Traefik: plugin do CrowdSec e log de acesso"
docker network inspect network_public >/dev/null 2>&1 || die "rede network_public não existe (instale o Comandou antes)"
SVC="$(docker service ls --format '{{.Name}} {{.Image}}' | awk '$2 ~ /traefik/ {print $1; exit}')"
[[ -n "$SVC" ]] || die "nenhum serviço do Traefik no Swarm"
[[ "$SVC" =~ ^(.+_)?traefik$ ]] || echo "AVISO: o serviço se chama $SVC; ajuste infrastructure/crowdsec/acquis-traefik.yaml para o CrowdSec ler o log dele."
echo "Traefik: $SVC"

mapfile -t ARGS < <(docker service inspect "$SVC" --format '{{range .Spec.TaskTemplate.ContainerSpec.Args}}{{println .}}{{end}}' | sed '/^$/d')
CONF_FILE=""
for a in "${ARGS[@]}"; do
  case "$a" in --configFile=*|--configfile=*) CONF_FILE="${a#*=}" ;; esac
done
traefik_ctr() { docker ps -q --filter "label=com.docker.swarm.service.name=$SVC" | head -1; }

if [[ -z "$CONF_FILE" ]] && printf '%s\n' "${ARGS[@]}" | grep -q '^--'; then
  # Configuração por argumentos (ex.: SetupOrion/Portainer).
  if printf '%s\n' "${ARGS[@]}" | grep -qi "^--experimental.plugins.$PLUGIN_NAME.modulename="; then
    echo "plugin já configurado nos argumentos do Traefik"
  else
    NEW=("${ARGS[@]}"
      "--experimental.plugins.$PLUGIN_NAME.modulename=$PLUGIN_MODULE"
      "--experimental.plugins.$PLUGIN_NAME.version=$PLUGIN_VERSION")
    printf '%s\n' "${ARGS[@]}" | grep -qi '^--accesslog' \
      || NEW+=("--accesslog=true" "--accesslog.filters.statuscodes=400-599")
    echo "Vou acrescentar estes argumentos ao Traefik:"
    printf '  %s\n' "${NEW[@]:${#ARGS[@]}}"
    echo "IMPORTANTE: se o Traefik é uma stack do Portainer, acrescente as mesmas linhas no 'command' dela,"
    echo "senão a próxima atualização pelo Portainer tira o plugin (ver docs/crowdsec.md)."
    confirm "Atualizar o Traefik agora? (ele reinicia; os sites ficam alguns segundos fora)" || die "cancelado"
    docker service update --quiet --args "$(printf '%q ' "${NEW[@]}")" "$SVC" >/dev/null
  fi
else
  # Configuração por arquivo (o Traefik instalado pelo Comandou usa um secret).
  CONF_FILE="${CONF_FILE:-/etc/traefik/traefik.yml}"
  CTR="$(traefik_ctr)"; [[ -n "$CTR" ]] || die "o Traefik não está rodando neste nó"
  CURRENT="$(docker exec "$CTR" cat "$CONF_FILE" 2>/dev/null)" || die "não consegui ler $CONF_FILE dentro do Traefik"
  [[ "$CONF_FILE" == *.toml ]] && die "configuração em TOML: acrescente o plugin à mão (docs/crowdsec.md) e rode de novo"
  if grep -q "$PLUGIN_MODULE" <<<"$CURRENT"; then
    echo "plugin já configurado em $CONF_FILE"
  else
    grep -q '^experimental:' <<<"$CURRENT" \
      && die "$CONF_FILE já tem uma seção experimental: acrescente o plugin à mão (docs/crowdsec.md)"
    PATCHED="$CURRENT
# CrowdSec (scripts/crowdsec.sh): plugin que bloqueia os IPs que o CrowdSec decidir.
experimental:
  plugins:
    $PLUGIN_NAME:
      moduleName: $PLUGIN_MODULE
      version: $PLUGIN_VERSION"
    grep -qi '^accessLog:' <<<"$CURRENT" || PATCHED="$PATCHED
accessLog:
  filters: { statusCodes: ['400-599'] }"
    # De onde vem o arquivo: secret, config ou pasta do servidor.
    SRC="$(docker service inspect "$SVC" --format '{{range .Spec.TaskTemplate.ContainerSpec.Secrets}}{{if eq .File.Name "'"$CONF_FILE"'"}}secret {{.SecretName}}{{end}}{{end}}{{range .Spec.TaskTemplate.ContainerSpec.Configs}}{{if .File}}{{if eq .File.Name "'"$CONF_FILE"'"}}config {{.ConfigName}}{{end}}{{end}}{{end}}{{range .Spec.TaskTemplate.ContainerSpec.Mounts}}{{if eq .Target "'"$CONF_FILE"'"}}bind {{.Source}}{{end}}{{end}}')"
    KIND="${SRC%% *}"; NAME="${SRC#* }"
    echo "Vou acrescentar o plugin do CrowdSec ($PLUGIN_VERSION) em $CONF_FILE ($SRC)."
    confirm "Atualizar o Traefik agora? (ele reinicia; os sites ficam alguns segundos fora)" || die "cancelado"
    case "$KIND" in
      secret|config)
        NEWNAME="${NAME%_crowdsec*}_crowdsec_$(date +%Y%m%d%H%M%S)"
        printf '%s\n' "$PATCHED" | docker "$KIND" create "$NEWNAME" - >/dev/null
        docker service update --quiet --"$KIND"-rm "$NAME" \
          --"$KIND"-add "source=$NEWNAME,target=$CONF_FILE" "$SVC" >/dev/null
        echo "$KIND $NEWNAME criado (o antigo, $NAME, ficou guardado)"
        ;;
      bind)
        cp -a "$NAME" "$NAME.antes-crowdsec.$(date +%Y%m%d%H%M%S)"
        printf '%s\n' "$PATCHED" >"$NAME"
        docker service update --quiet --force "$SVC" >/dev/null
        echo "$NAME atualizado (cópia de segurança ao lado)"
        ;;
      *) die "não descobri de onde vem $CONF_FILE: acrescente o plugin à mão (docs/crowdsec.md)" ;;
    esac
  fi
fi

echo "Conferindo se o Traefik carregou o plugin..."
# Só o log do contêiner que está rodando agora (o de antes da mudança pode ter erros antigos).
OK=false
for _ in $(seq 1 24); do
  sleep 5
  CTR="$(traefik_ctr)"; [[ -n "$CTR" ]] || continue
  LOGS="$(docker logs "$CTR" 2>&1 || true)"
  grep -qi "plugins are disabled" <<<"$LOGS" \
    && die "o Traefik não carregou o plugin (sem internet para baixar de plugins.traefik.io?). Veja: docker logs $CTR. O bloqueio NÃO foi ligado; os sites seguem normais."
  grep -qi "plugins loaded" <<<"$LOGS" && { OK=true; break; }
done
$OK || die "não vi o Traefik carregar o plugin em 2 minutos: docker logs \$(docker ps -q -f name=$SVC). O bloqueio NÃO foi ligado."
echo "Traefik ok"

step "2. CrowdSec"
if ! docker secret inspect "$KEY_SECRET" >/dev/null 2>&1; then
  openssl rand -hex 32 | tr -d '\n' | docker secret create "$KEY_SECRET" - >/dev/null
  echo "secret $KEY_SECRET criado"
fi
# Configs do Docker não mudam depois de criadas: o nome leva um resumo do conteúdo.
CROWDSEC_CONF_VERSION="$(cat "$ROOT"/infrastructure/crowdsec/*.yaml | sha256sum | cut -c1-10)"
export CROWDSEC_CONF_VERSION CROWDSEC_ENROLL_KEY="${CROWDSEC_ENROLL_KEY:-}"
confirm "Subir a stack 'crowdsec' (CrowdSec $(grep -o 'crowdsec:v[0-9.]*' "$ROOT/infrastructure/crowdsec/crowdsec-stack.yml"))?" || die "cancelado"
docker stack deploy -c "$ROOT/infrastructure/crowdsec/crowdsec-stack.yml" crowdsec
echo "Aguardando o CrowdSec ficar pronto (na primeira vez ele baixa as regras, ~1 min)..."
READY=false
for _ in $(seq 1 60); do
  sleep 5
  c="$(cs_ctr)"; [[ -n "$c" ]] || continue
  docker exec "$c" cscli lapi status >/dev/null 2>&1 || continue
  docker exec "$c" cscli bouncers list -o raw 2>/dev/null | grep -q '^traefik,' && { READY=true; break; }
done
$READY || die "o CrowdSec não ficou pronto em 5 minutos: docker service logs crowdsec_crowdsec. O bloqueio NÃO foi ligado."
echo "CrowdSec pronto, bouncer do Traefik registrado"

step "3. Bloqueio nas rotas do Comandou"
echo "Webhook do Asaas, teste de status do Super Admin, health checks e métricas ficam sempre livres."
confirm "Ligar o bloqueio agora?" || die "cancelado (o CrowdSec fica rodando, só sem bloquear)"
api_bouncer on
save_flag 1
echo "Pronto. Em até 1 minuto o Traefik passa a consultar o CrowdSec."
echo "Ver o que está acontecendo: sudo scripts/crowdsec.sh --status"
