#!/usr/bin/env bash
# Teste de restauração: baixa o último backup bom, confere o sha256, decifra e restaura num
# Postgres TEMPORÁRIO criado dentro do próprio contêiner (nunca toca o banco de produção).
# Confere migrações e contagens contra as anotadas no momento do backup e apaga tudo no fim.
set -euo pipefail
. "$(dirname "$0")/common.sh"

RUN_ID="$(run_start restore_test)"
TMP="$(mktemp -d "$WORK_DIR/cm-restore.XXXXXX")"
PGDATA_T="$TMP/pg"
PORT="${RESTORE_PORT:-55432}"
cleanup() {
  pg_ctl -D "$PGDATA_T" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
fail() { log restore "ERRO: $1"; run_finish "$RUN_ID" failed '{}' "$1" "${KEY:-}" || true; exit 1; }
START=$(date +%s)

ROW="$(sql -F '|' -v key="${RESTORE_KEY:-}" <<'SQL'
SELECT object_key, sha256, details FROM backup_runs
 WHERE kind = 'backup' AND status = 'ok' AND (:'key' = '' OR object_key = :'key')
 ORDER BY finished_at DESC LIMIT 1
SQL
)" || fail "banco indisponível"
[[ -n "$ROW" ]] || fail "nenhum backup bem-sucedido registrado"
IFS='|' read -r KEY SHA DETAILS <<<"$ROW"
log restore "testando $KEY"

case "$BACKUP_TARGET" in
  s3) s3 s3 cp --only-show-errors "s3://$S3_BUCKET/$KEY" "$TMP/db.dump.age" || fail "download falhou" ;;
  file) cp "$BACKUP_DIR/$KEY" "$TMP/db.dump.age" || fail "arquivo não encontrado" ;;
  *) fail "BACKUP_TARGET inválido: $BACKUP_TARGET" ;;
esac
[[ "$(sha256sum "$TMP/db.dump.age" | cut -d' ' -f1)" == "$SHA" ]] || fail "sha256 não confere"
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$TMP/db.dump" "$TMP/db.dump.age" \
  || fail "falha ao decifrar (chave errada?)"
rm -f "$TMP/db.dump.age"

initdb -D "$PGDATA_T" -U postgres --auth=trust -E UTF8 --no-instructions >/dev/null || fail "initdb falhou"
pg_ctl -D "$PGDATA_T" -o "-p $PORT -k $TMP -c listen_addresses=''" -w -l "$TMP/pg.log" start >/dev/null \
  || fail "Postgres temporário não subiu"
T=(psql -X -v ON_ERROR_STOP=1 -At -h "$TMP" -p "$PORT" -U postgres)
"${T[@]}" -d postgres -c "CREATE ROLE comandou_owner NOLOGIN" -c "CREATE ROLE comandou_app NOLOGIN" \
  -c "CREATE ROLE comandou_platform NOLOGIN" -c "CREATE DATABASE restore_test" >/dev/null
pg_restore --exit-on-error --no-owner --no-privileges -h "$TMP" -p "$PORT" -U postgres \
  -d restore_test "$TMP/db.dump" || fail "pg_restore falhou"

GOT="$("${T[@]}" -d restore_test -c "SELECT json_build_object(
  'tenants', (SELECT count(*) FROM tenants), 'orders', (SELECT count(*) FROM orders),
  'payments', (SELECT count(*) FROM payments), 'migrations', (SELECT count(*) FROM schema_migrations),
  'lastMigration', (SELECT max(version) FROM schema_migrations),
  'policies', (SELECT count(*) FROM pg_policies))")" || fail "consulta no banco restaurado falhou"

# Restaurado precisa estar entre as contagens de antes e depois do dump.
CHECK="$(sql -v det="$DETAILS" -v got="$GOT" <<'SQL'
SELECT coalesce(string_agg(k, ','), '')
  FROM unnest(ARRAY['tenants','orders','payments','migrations']) k
 WHERE NOT (((:'got')::jsonb->>k)::bigint
            BETWEEN ((:'det')::jsonb->'before'->>k)::bigint AND ((:'det')::jsonb->'after'->>k)::bigint)
SQL
)"
[[ -z "$CHECK" ]] || fail "contagens fora do esperado: $CHECK (restaurado: $GOT)"
[[ "$(jq -r .policies <<<"$GOT")" -gt 0 ]] || fail "nenhuma política de RLS restaurada"

DUR=$(( $(date +%s) - START ))
run_finish "$RUN_ID" ok "{\"restored\": $GOT, \"seconds\": $DUR}" "" "$KEY"
log restore "ok em ${DUR}s: $GOT"
