#!/usr/bin/env bash
# Checagem pré-produção do PedeMais. Roda no manager do Swarm e SÓ LÊ: não cria, não altera e
# não apaga nada, e nunca imprime o valor de um segredo.
#
# Uso: scripts/preflight.sh              (antes do primeiro deploy: servidor, DNS, segredos)
#      scripts/preflight.sh --deployed   (depois: também certificados, saúde, backups, integrações)
#
# Lê /etc/pedemais/deploy.env (ou PEDEMAIS_DEPLOY_ENV). Saída: OK / AVISO / FALHA por item;
# termina com código 1 se houver alguma FALHA.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="${PEDEMAIS_STACK:-pedemais}"
DEPLOYED=false; [[ "${1:-}" == "--deployed" ]] && DEPLOYED=true
fails=0; warns=0
ok()   { echo "OK     $*"; }
warn() { echo "AVISO  $*"; warns=$((warns + 1)); }
fail() { echo "FALHA  $*"; fails=$((fails + 1)); }
section() { echo; echo "== $*"; }

DEPLOY_ENV="${PEDEMAIS_DEPLOY_ENV:-/etc/pedemais/deploy.env}"
if [[ -r "$DEPLOY_ENV" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$DEPLOY_ENV"
  set +a
fi
BASE="${PEDEMAIS_BASE_DOMAIN:-comandou.com}"

section "Servidor"
[[ "$(uname -s)" == "Linux" ]] && ok "Linux $(uname -m)" || fail "requer Linux"
for bin in docker curl openssl getent; do
  command -v "$bin" >/dev/null && ok "comando $bin" || fail "comando ausente: $bin"
done
if ! docker info >/dev/null 2>&1; then
  fail "Docker não está acessível para este usuário"
  echo; echo "Resultado: $fails falha(s), $warns aviso(s)"; exit 1
fi
[[ "$(docker info --format '{{.Swarm.ControlAvailable}}')" == "true" ]] && ok "nó manager do Swarm" \
  || fail "execute em um nó manager do Swarm"
avail_gb="$(df -Pk /var/lib/docker 2>/dev/null | awk 'NR==2 {print int($4/1024/1024)}')"
if [[ -n "$avail_gb" ]]; then
  ((avail_gb >= 10)) && ok "disco livre em /var/lib/docker: ${avail_gb} GB" \
    || warn "pouco disco livre em /var/lib/docker: ${avail_gb} GB (recomendado 10 GB ou mais)"
fi
mem_gb="$(awk '/MemTotal/ {print int($2/1024/1024)}' /proc/meminfo)"
((mem_gb >= 4)) && ok "memória: ${mem_gb} GB" || warn "memória: ${mem_gb} GB (recomendado 4 GB ou mais)"

section "Configuração (deploy.env)"
[[ -r "$DEPLOY_ENV" ]] && ok "$DEPLOY_ENV" || fail "$DEPLOY_ENV não encontrado (docs/deploy.md)"
if [[ -r "$DEPLOY_ENV" ]]; then
  perm="$(stat -c %a "$DEPLOY_ENV")"
  [[ "$perm" =~ ^[0-7]00$ ]] && ok "permissão de $DEPLOY_ENV: $perm" \
    || warn "permissão de $DEPLOY_ENV é $perm (use 600)"
fi
for v in PEDEMAIS_BASE_DOMAIN BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT TRAEFIK_ENTRYPOINT TRAEFIK_CERT_RESOLVER; do
  [[ -n "${!v:-}" ]] && ok "$v=${!v}" || fail "$v não definido"
done

section "Rede e segredos"
docker network inspect network_public >/dev/null 2>&1 && ok "rede network_public" \
  || fail "rede network_public não existe (o Traefik precisa estar instalado)"
while read -r s; do
  [[ -z "$s" || "$s" == \#* ]] && continue
  docker secret inspect "$s" >/dev/null 2>&1 && ok "secret $s" || fail "secret ausente: $s"
done < "$ROOT/scripts/required-secrets.txt"

section "Traefik"
traefik_svc="$(docker service ls --format '{{.Name}} {{.Image}}' | awk '$2 ~ /traefik/ {print $1; exit}')"
if [[ -z "$traefik_svc" ]]; then
  warn "serviço do Traefik não encontrado no Swarm (confira se roda fora dele)"
else
  ok "Traefik: $traefik_svc"
  tcfg="$(docker service inspect "$traefik_svc" --format '{{json .Spec.TaskTemplate.ContainerSpec.Args}} {{json .Spec.TaskTemplate.ContainerSpec.Env}}')"
  grep -q 'providers.http' <<<"$tcfg" && ok "provider HTTP configurado (domínios próprios)" \
    || warn "provider HTTP não aparece nos argumentos do Traefik: domínios próprios não vão funcionar (docs/deploy.md)"
  grep -q "${TRAEFIK_CERT_RESOLVER:-letsencryptresolver}" <<<"$tcfg" \
    && ok "certresolver ${TRAEFIK_CERT_RESOLVER:-letsencryptresolver}" \
    || warn "certresolver ${TRAEFIK_CERT_RESOLVER:-letsencryptresolver} não aparece nos argumentos (pode estar em arquivo)"
fi

section "DNS"
probe="pm-check-$RANDOM"
for host in "$BASE" "admin.$BASE" "$probe.$BASE"; do
  ip="$(getent ahostsv4 "$host" | awk 'NR==1 {print $1}')"
  if [[ -n "$ip" ]]; then ok "$host → $ip"; else fail "$host não resolve"; fi
done

if $DEPLOYED; then
  section "Serviços"
  for svc in postgres redis migrate api web whatsapp-gateway backup; do
    rep="$(docker service ls --filter "name=${STACK}_${svc}" --format '{{.Replicas}}' | head -1)"
    if [[ -z "$rep" ]]; then fail "serviço ${STACK}_${svc} não existe"
    elif [[ "$svc" == "migrate" ]]; then ok "${STACK}_${svc}: $rep (tarefa única)"
    elif [[ "${rep%%/*}" == "${rep##*/}" ]]; then ok "${STACK}_${svc}: $rep"
    else fail "${STACK}_${svc}: $rep réplicas prontas"; fi
  done

  section "Endereços públicos e certificados"
  url="${PEDEMAIS_HEALTH_URL:-}"
  [[ -n "$url" ]] || warn "PEDEMAIS_HEALTH_URL não definido (https://<restaurante>.$BASE)"
  for host in "admin.$BASE" ${url:+"${url#https://}"}; do
    end="$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
    if [[ -z "$end" ]]; then fail "$host: sem certificado TLS válido"; continue; fi
    days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
    ((days >= 14)) && ok "$host: certificado válido por $days dias" || warn "$host: certificado vence em $days dias"
    hsts="$(curl -sI --max-time 10 "https://$host/" | grep -ci '^strict-transport-security')"
    ((hsts > 0)) && ok "$host: HSTS" || warn "$host: sem cabeçalho HSTS"
  done
  if [[ -n "$url" ]]; then
    ready="$(curl -s --max-time 10 "$url/api/v1/health/ready")"
    grep -q '"status":"ok"' <<<"$ready" && ok "saúde: $ready" || fail "saúde: ${ready:-sem resposta}"
    grep -q '"whatsappGateway":"error"' <<<"$ready" && warn "serviço de WhatsApp com falha"
    "$ROOT/scripts/healthcheck.sh" "$url" >/dev/null && ok "healthcheck.sh $url" || fail "healthcheck.sh $url"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url/api/v1/metrics")"
    [[ "$code" == "404" ]] && ok "métricas fechadas sem token (404)" || fail "métricas respondem $code sem token"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url/api/docs")"
    [[ "$code" == "404" ]] && ok "documentação da API desligada em produção" || warn "/api/docs responde $code"
  fi

  section "Backups"
  bctr="$(docker ps -q --filter "label=com.docker.swarm.service.name=${STACK}_backup" | head -1)"
  if [[ -z "$bctr" ]]; then
    warn "contêiner de backup não está neste nó"
  else
    # common.sh carrega os segredos *_FILE do contêiner e define s3() e sql(); nada é impresso.
    docker exec "$bctr" bash -c '. /opt/pedemais-backup/common.sh && s3 s3api head-bucket --bucket "$S3_BUCKET"' \
      >/dev/null 2>&1 && ok "bucket acessível" || fail "bucket de backup inacessível (chave, endpoint ou nome)"
    last="$(docker exec "$bctr" bash -c '. /opt/pedemais-backup/common.sh >/dev/null 2>&1; sql -F "|" -c "
      SELECT kind, extract(epoch FROM now() - max(finished_at))::int
        FROM backup_runs WHERE status = '"'ok'"' GROUP BY kind"' 2>/dev/null)"
    b_age="$(awk -F'|' '$1 == "backup" {print $2}' <<<"$last")"
    r_age="$(awk -F'|' '$1 == "restore_test" {print $2}' <<<"$last")"
    if [[ -z "$b_age" ]]; then fail "nenhum backup bem-sucedido registrado"
    elif ((b_age > 26 * 3600)); then fail "último backup bom há $((b_age / 3600)) h"
    else ok "último backup bom há $((b_age / 3600)) h"; fi
    if [[ -z "$r_age" ]]; then warn "nenhum teste de restauração bem-sucedido ainda (rode restore-test.sh)"
    elif ((r_age > 8 * 86400)); then fail "último teste de restauração há $((r_age / 86400)) dias"
    else ok "último teste de restauração há $((r_age / 86400)) dias"; fi
  fi

  section "Integrações (saída para a internet)"
  actr="$(docker ps -q --filter "label=com.docker.swarm.service.name=${STACK}_api" | head -1)"
  if [[ -n "$actr" ]]; then
    for u in https://homologacao.focusnfe.com.br https://api.focusnfe.com.br https://graph.facebook.com; do
      docker exec "$actr" node -e "fetch('$u',{method:'HEAD'}).then(()=>process.exit(0),()=>process.exit(1))" \
        && ok "API alcança $u" || warn "API não alcança $u"
    done
  fi
  wctr="$(docker ps -q --filter "label=com.docker.swarm.service.name=${STACK}_whatsapp-gateway" | head -1)"
  if [[ -n "$wctr" ]]; then
    docker exec "$wctr" node -e "fetch('https://web.whatsapp.com',{method:'HEAD'}).then(()=>process.exit(0),()=>process.exit(1))" \
      && ok "gateway alcança web.whatsapp.com" || warn "gateway não alcança web.whatsapp.com"
  fi
fi

echo
echo "Resultado: $fails falha(s), $warns aviso(s)"
((fails == 0))
