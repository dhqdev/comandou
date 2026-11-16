#!/usr/bin/env bash
# Ajudante da VM: o que o painel Super Admin › Infraestrutura › VM pode pedir ao servidor.
#
# Roda no PRÓPRIO servidor (fora do Docker), como root, pelo systemd:
#   comandou-vm-info.timer  a cada 30 min (e 1 min depois de ligar) coleta SO, versões,
#                           atualizações e tamanhos de cache em $VM_DIR/info.json;
#   comandou-vm.path        quando o agente do servidor deixa um pedido em $VM_DIR/pedidos/,
#                           roda `vm.sh run`, que executa SÓ as ações da lista abaixo.
#
# O agente (contêiner) só enxerga $VM_DIR. Ele não manda comandos: manda o NOME de uma ação.
# Qualquer outra coisa no arquivo é ignorada. Ações:
#   check                     procura atualizações agora (apt-get update) e coleta de novo
#   upgrade                   instala todas as atualizações do sistema (apt, sem remover nada)
#   upgrade-security          instala só as atualizações de segurança
#   clean apt journal logs ram  limpa cache de pacotes, diário do systemd, logs antigos, RAM
#   restart-docker            reinicia o Docker (todos os serviços voltam em ~1 min)
#   reboot                    reinicia a VM
#
# Instalar/atualizar (o instalador faz isso):   sudo scripts/vm.sh install
# Tirar:                                         sudo scripts/vm.sh uninstall
# Ver o que o painel vê:                         sudo scripts/vm.sh collect && cat /var/lib/comandou/vm/info.json
set -euo pipefail
HELPER_VERSION=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VM_DIR="${COMANDOU_VM_DIR:-/var/lib/comandou/vm}"
ETC_DIR="${COMANDOU_ETC_DIR:-/etc/comandou}"
UNIT_DIR="${COMANDOU_UNIT_DIR:-/etc/systemd/system}"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 LC_ALL=C
APT_OPTS=(-y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# Texto → string JSON (aspas, barras, quebras de linha; caracteres de controle somem).
j() {
  local s
  s="$(printf '%s' "${1-}" | tr -d '\000-\010\013\014\016-\037')"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\t'/ }"; s="${s//$'\r'/}"
  printf '"%s"' "$s"
}
num() { [[ "${1-}" =~ ^[0-9]+$ ]] && printf '%s' "$1" || printf 'null'; }
bool() { "$@" >/dev/null 2>&1 && printf 'true' || printf 'false'; }
size_of() { du -sb "$@" 2>/dev/null | awk '{s+=$1} END {print s+0}'; }
pkg_version() { dpkg-query -W -f='${Version}' "$1" 2>/dev/null || true; }
write_atomic() { local f="$1" tmp; tmp="$(mktemp "$f.XXXXXX")"; cat >"$tmp"; chmod 644 "$tmp"; mv -f "$tmp" "$f"; }

# Lista de pacotes antigos de log rotacionado (gz, .1, .old) em /var/log, fora do diário.
old_logs() { find /var/log -xdev -type f \( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \) -not -path '/var/log/journal/*' -print0 2>/dev/null; }

apt_lists_age() {
  local f=/var/lib/apt/periodic/update-success-stamp
  [[ -f $f ]] || f=/var/cache/apt/pkgcache.bin
  [[ -f $f ]] || { echo 999999; return; }
  echo $(( $(date +%s) - $(stat -c %Y "$f") ))
}
apt_last_update() {
  local f=/var/lib/apt/periodic/update-success-stamp
  [[ -f $f ]] || f=/var/cache/apt/pkgcache.bin
  [[ -f $f ]] && date -u -d "@$(stat -c %Y "$f")" +%Y-%m-%dT%H:%M:%SZ || true
}

# "nome<TAB>suites<TAB>nova<TAB>atual" de cada pacote com atualização.
upgradable() {
  command -v apt >/dev/null || return 0
  apt list --upgradable 2>/dev/null | awk '
    /\[upgradable from:/ {
      split($1, a, "/"); old = $0; sub(/.*upgradable from: /, "", old); sub(/\].*/, "", old)
      printf "%s\t%s\t%s\t%s\n", a[1], a[2], $2, old
    }'
}

collect() {
  mkdir -p "$VM_DIR"
  # Atualiza a lista do apt se tiver mais de 6 horas (para "tem atualização?" não ficar velho).
  if command -v apt-get >/dev/null && (( $(apt_lists_age) > 21600 )); then
    timeout 300 apt-get update -qq >/dev/null 2>&1 || true
  fi
  local os_name="" os_id="" os_version="" os_codename=""
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    os_name="$(. /etc/os-release; echo "${PRETTY_NAME:-}")"; os_id="$(. /etc/os-release; echo "${ID:-}")"
    os_version="$(. /etc/os-release; echo "${VERSION_ID:-}")"; os_codename="$(. /etc/os-release; echo "${VERSION_CODENAME:-}")"
  fi
  local tz ntp
  tz="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo '')"
  ntp="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo '')"
  local reboot=false reboot_pkgs=""
  [[ -f /var/run/reboot-required ]] && reboot=true
  [[ -f /var/run/reboot-required.pkgs ]] && reboot_pkgs="$(sort -u /var/run/reboot-required.pkgs | head -50)"

  local ups total=0 security=0 docker_in=false first=true items=""
  ups="$(upgradable || true)"
  while IFS=$'\t' read -r name suites new old; do
    [[ -n "$name" ]] || continue
    total=$((total + 1))
    local sec=false
    [[ "$suites" == *-security* ]] && { sec=true; security=$((security + 1)); }
    [[ "$name" =~ ^(docker-ce|docker-ce-cli|containerd\.io|containerd|docker\.io)$ ]] && docker_in=true
    if ((total <= 400)); then
      $first || items+=","
      first=false
      items+="{\"name\":$(j "$name"),\"from\":$(j "$old"),\"to\":$(j "$new"),\"security\":$sec}"
    fi
  done <<<"$ups"

  local autoremove=0
  command -v apt-get >/dev/null && autoremove="$(apt-get -s autoremove 2>/dev/null | grep -c '^Remv' || true)"

  local pk_first=true pkgs=""
  for p in docker-ce docker-ce-cli containerd.io docker.io docker-compose-plugin docker-buildx-plugin \
           openssh-server openssl systemd curl ca-certificates ufw unattended-upgrades; do
    local v; v="$(pkg_version "$p")"
    [[ -n "$v" ]] || continue
    $pk_first || pkgs+=","
    pk_first=false
    pkgs+="{\"name\":$(j "$p"),\"version\":$(j "$v")}"
  done

  local ufw=""
  command -v ufw >/dev/null && ufw="$(ufw status 2>/dev/null | head -1 | awk '{print $2}')"
  local unattended=false
  [[ -f /etc/apt/apt.conf.d/20auto-upgrades ]] && grep -q 'Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades && unattended=true

  local logs_size
  logs_size="$(old_logs | du -cb --files0-from=- 2>/dev/null | tail -1 | awk '{print $1+0}' || echo 0)"
  local cached
  cached="$(awk '/^(Buffers|Cached|SReclaimable):/ {s+=$2} END {print s*1024}' /proc/meminfo)"

  local ver=""
  [[ -f "$ROOT/.comandou-version" ]] && ver="$(head -c 40 "$ROOT/.comandou-version")"

  write_atomic "$VM_DIR/info.json" <<JSON
{
  "helperVersion": $HELPER_VERSION,
  "collectedAt": "$(now)",
  "os": {"name": $(j "$os_name"), "id": $(j "$os_id"), "version": $(j "$os_version"), "codename": $(j "$os_codename"),
         "kernel": $(j "$(uname -r)"), "arch": $(j "$(uname -m)"), "timezone": $(j "$tz"), "ntpSynced": $(j "$ntp"),
         "bootedAt": $(j "$(date -u -d "$(uptime -s 2>/dev/null || date)" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)")},
  "reboot": {"required": $reboot, "packages": $(j "$reboot_pkgs")},
  "updates": {"lastCheck": $(j "$(apt_last_update)"), "total": $total, "security": $security, "docker": $docker_in,
              "autoremove": $(num "$autoremove"), "list": [${items}]},
  "packages": [${pkgs}],
  "security": {"firewall": $(j "$ufw"), "autoUpdates": $unattended},
  "cache": {"apt": $(num "$(size_of /var/cache/apt/archives)"), "journal": $(num "$(size_of /var/log/journal)"),
            "logs": $(num "$logs_size"), "ram": $(num "$cached")},
  "install": {"dir": $(j "$ROOT"), "version": $(j "$ver"), "config": $(j "$ETC_DIR/deploy.env"),
              "configExists": $(bool test -f "$ETC_DIR/deploy.env"), "standard": $(bool test "$ROOT" = /opt/comandou),
              "logs": $(j "/var/log/comandou"), "data": $(j "/var/lib/docker/volumes")}
}
JSON
}

job_write() { # id action status started [message] [code]
  local f="$VM_DIR/jobs/$1.json"
  write_atomic "$f" <<JSON
{"id": $(j "$1"), "action": $(j "$2"), "status": $(j "$3"), "startedAt": $(j "$4"),
 "finishedAt": $( [[ "$3" == running ]] && echo null || j "$(now)"), "message": $(j "${5-}"), "exitCode": $(num "${6-}")}
JSON
}

do_clean() { # alvos...
  local t
  for t in "$@"; do
    case "$t" in
      apt) echo "== cache de pacotes"; apt-get clean; apt-get "${APT_OPTS[@]}" autoremove --purge ;;
      journal) echo "== diário do systemd (fica o das 2 últimas semanas, até 200 MB)"; journalctl --vacuum-time=14d --vacuum-size=200M ;;
      logs) echo "== logs antigos já rotacionados"; old_logs | xargs -0 -r rm -f -- ;;
      ram) echo "== cache de memória (page cache)"; sync; echo 3 >/proc/sys/vm/drop_caches ;;
      *) echo "alvo ignorado: $t" ;;
    esac
  done
}

security_upgrade() {
  apt-get update -q
  local pkgs
  pkgs="$(upgradable | awk -F'\t' '$2 ~ /-security/ {print $1}' | tr '\n' ' ')"
  if [[ -z "${pkgs// /}" ]]; then echo "nenhuma atualização de segurança"; return 0; fi
  echo "pacotes: $pkgs"
  # shellcheck disable=SC2086
  apt-get "${APT_OPTS[@]}" install --only-upgrade $pkgs
}

run_one() { # arquivo do pedido
  local f="$1" id action rest started log code=0
  id="$(basename "$f" .req)"
  read -r action rest < <(head -c 200 "$f"; echo) || true
  rm -f "$f"
  [[ "$id" =~ ^[a-z0-9-]{8,40}$ ]] || return 0
  [[ -e "$VM_DIR/jobs/$id.json" ]] && return 0
  started="$(now)"; log="$VM_DIR/jobs/$id.log"
  : >"$log"; chmod 644 "$log"
  local targets=()
  case "$action" in
    check|upgrade|upgrade-security|restart-docker|reboot) ;;
    clean)
      for t in $rest; do [[ "$t" =~ ^(apt|journal|logs|ram)$ ]] && targets+=("$t"); done
      ((${#targets[@]})) || { job_write "$id" "$action" failed "$started" "escolha o que limpar" 2; return 0; } ;;
    *) job_write "$id" "${action:-?}" failed "$started" "ação desconhecida" 2; return 0 ;;
  esac
  job_write "$id" "$action" running "$started"
  case "$action" in
    check) { apt-get update -q; } >>"$log" 2>&1 || code=$? ;;
    upgrade) { apt-get update -q && apt-get "${APT_OPTS[@]}" --with-new-pkgs upgrade; } >>"$log" 2>&1 || code=$? ;;
    upgrade-security) security_upgrade >>"$log" 2>&1 || code=$? ;;
    clean) do_clean "${targets[@]}" >>"$log" 2>&1 || code=$? ;;
    restart-docker) { echo "reiniciando o Docker"; systemctl restart docker; } >>"$log" 2>&1 || code=$? ;;
    reboot)
      echo "reiniciando a VM em 5 segundos" >>"$log"
      job_write "$id" "$action" "done" "$started" "a VM está reiniciando" 0
      collect >/dev/null 2>&1 || true
      sync; sleep 5; systemctl --no-block reboot
      return 0 ;;
  esac
  collect >>"$log" 2>&1 || true
  if ((code == 0)); then job_write "$id" "$action" "done" "$started" "" 0
  else job_write "$id" "$action" failed "$started" "terminou com erro (código $code): veja o registro" "$code"; fi
  # Registro grande demais: fica o final.
  if (( $(stat -c %s "$log") > 1048576 )); then tail -c 524288 "$log" >"$log.t" && mv -f "$log.t" "$log"; fi
}

run() {
  mkdir -p "$VM_DIR/pedidos" "$VM_DIR/jobs"
  exec 9>"$VM_DIR/.lock"; flock 9
  local f
  # Um de cada vez, na ordem em que chegaram.
  while :; do
    f="$(find "$VM_DIR/pedidos" -maxdepth 1 -name '*.req' -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | head -1 | cut -d' ' -f2-)"
    [[ -n "$f" ]] || break
    run_one "$f"
  done
  # Guarda só os 30 últimos trabalhos.
  find "$VM_DIR/jobs" -maxdepth 1 -name '*.json' -printf '%T@ %p\n' | sort -rn | tail -n +31 | cut -d' ' -f2- \
    | while read -r old; do rm -f "$old" "${old%.json}.log"; done
}

install_units() {
  [[ "$(id -u)" -eq 0 ]] || { echo "rode como root (sudo)"; exit 1; }
  command -v systemctl >/dev/null || { echo "systemd não encontrado: o ajudante da VM precisa dele"; exit 1; }
  mkdir -p "$VM_DIR/pedidos" "$VM_DIR/jobs" /var/log/comandou
  chmod 755 "$VM_DIR"; chmod 700 "$VM_DIR/pedidos"
  local me="$ROOT/scripts/vm.sh"
  chmod 755 "$me"
  cat >"$UNIT_DIR/comandou-vm.service" <<UNIT
[Unit]
Description=Comandou: executa pedidos do painel (atualizar, limpar, reiniciar)
After=network-online.target

[Service]
Type=oneshot
ExecStart=$me run
Nice=5
UNIT
  cat >"$UNIT_DIR/comandou-vm.path" <<UNIT
[Unit]
Description=Comandou: espera pedidos do painel Super Admin

[Path]
PathExistsGlob=$VM_DIR/pedidos/*.req
Unit=comandou-vm.service

[Install]
WantedBy=multi-user.target
UNIT
  cat >"$UNIT_DIR/comandou-vm-info.service" <<UNIT
[Unit]
Description=Comandou: coleta SO, versões e atualizações para o painel
After=network-online.target

[Service]
Type=oneshot
ExecStart=$me collect
Nice=10
UNIT
  cat >"$UNIT_DIR/comandou-vm-info.timer" <<UNIT
[Unit]
Description=Comandou: coleta da VM a cada 30 minutos

[Timer]
OnBootSec=1min
OnUnitActiveSec=30min

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now comandou-vm.path comandou-vm-info.timer >/dev/null
  collect
  echo "ajudante da VM instalado ($VM_DIR, versão $HELPER_VERSION)"
}

uninstall_units() {
  systemctl disable --now comandou-vm.path comandou-vm-info.timer 2>/dev/null || true
  rm -f "$UNIT_DIR"/comandou-vm.{service,path} "$UNIT_DIR"/comandou-vm-info.{service,timer}
  systemctl daemon-reload
  echo "ajudante da VM removido ($VM_DIR mantido)"
}

case "${1:-}" in
  collect) collect ;;
  run) run ;;
  install) install_units ;;
  uninstall) uninstall_units ;;
  *) echo "uso: $0 collect|run|install|uninstall"; exit 2 ;;
esac
