#!/usr/bin/env bash
# Agenda simples (sem cron, roda como usuário sem privilégios): backup diário e teste de
# restauração semanal, nos horários em UTC. Uma execução por dia/semana, mesmo reiniciando.
set -euo pipefail
DIR="$(dirname "$0")"
BACKUP_AT="${BACKUP_AT:-03:00}"                 # HH:MM UTC
RESTORE_TEST_AT="${RESTORE_TEST_AT:-05:00}"     # HH:MM UTC
RESTORE_TEST_WEEKDAY="${RESTORE_TEST_WEEKDAY:-7}" # 1=segunda ... 7=domingo
STATE="${STATE_DIR:-/tmp}"
echo "agenda: backup diário às $BACKUP_AT UTC; teste de restauração no dia $RESTORE_TEST_WEEKDAY às $RESTORE_TEST_AT UTC"
while true; do
  now="$(date -u +%H:%M)"; today="$(date -u +%F)"; wd="$(date -u +%u)"
  if [[ "$now" == "$BACKUP_AT" && "$(cat "$STATE/last-backup" 2>/dev/null)" != "$today" ]]; then
    echo "$today" > "$STATE/last-backup"
    "$DIR/backup.sh" || echo "backup falhou (registrado em backup_runs)"
  fi
  if [[ "$wd" == "$RESTORE_TEST_WEEKDAY" && "$now" == "$RESTORE_TEST_AT" && "$(cat "$STATE/last-restore" 2>/dev/null)" != "$today" ]]; then
    echo "$today" > "$STATE/last-restore"
    "$DIR/restore-test.sh" || echo "teste de restauração falhou (registrado em backup_runs)"
  fi
  sleep 20
done
