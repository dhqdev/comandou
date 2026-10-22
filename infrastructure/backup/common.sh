#!/usr/bin/env bash
# Funções comuns do serviço de backup. Nunca imprime segredos.
set -euo pipefail

# Docker secrets: VAR_FILE=/run/secrets/x vira VAR=<conteúdo>, só para as variáveis abaixo.
for v in DATABASE_OWNER_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  f="${v}_FILE"
  if [[ -n "${!f:-}" && -z "${!v:-}" ]]; then
    export "$v"="$(tr -d '\r\n' < "${!f}")"
  fi
done
[[ -n "${PG_BIN:-}" ]] && export PATH="$PG_BIN:$PATH"

: "${DATABASE_OWNER_URL:?defina DATABASE_OWNER_URL ou DATABASE_OWNER_URL_FILE}"
: "${AGE_IDENTITY_FILE:?defina AGE_IDENTITY_FILE (chave privada do age)}"
BACKUP_TARGET="${BACKUP_TARGET:-s3}"   # s3 (B2, S3, MinIO) ou file (testes locais)
S3_PREFIX="${S3_PREFIX:-comandou}"
WORK_DIR="${WORK_DIR:-/tmp}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [$1] ${*:2}"; }

sql() { psql "$DATABASE_OWNER_URL" -X -v ON_ERROR_STOP=1 -At "$@"; }

# Registro em backup_runs (visível no painel Super Admin).
run_start() { sql -c "INSERT INTO backup_runs (kind, status) VALUES ('$1', 'running') RETURNING id" | head -1; }
run_finish() {
  # $1 id, $2 ok|failed, $3 json de detalhes, $4 erro, $5 chave, $6 tamanho, $7 sha256
  sql -v id="$1" -v st="$2" -v det="$3" -v err="${4:-}" -v key="${5:-}" -v size="${6:-}" -v sha="${7:-}" <<'SQL' >/dev/null
UPDATE backup_runs SET status = :'st', finished_at = now(), details = :'det'::jsonb,
  error = nullif(:'err', ''), object_key = coalesce(nullif(:'key', ''), object_key),
  size_bytes = coalesce(nullif(:'size', '')::bigint, size_bytes),
  sha256 = coalesce(nullif(:'sha', ''), sha256)
WHERE id = :'id'::bigint;
SQL
}

s3() {
  : "${S3_BUCKET:?defina S3_BUCKET}"
  local args=()
  [[ -n "${S3_ENDPOINT:-}" ]] && args+=(--endpoint-url "$S3_ENDPOINT")
  [[ -n "${S3_REGION:-}" ]] && args+=(--region "$S3_REGION")
  aws "${args[@]}" "$@"
}

# Contagens que o teste de restauração confere (pedidos e restaurantes crescem; migrações não).
db_stats() {
  sql -c "SELECT json_build_object(
    'tenants', (SELECT count(*) FROM tenants),
    'orders', (SELECT count(*) FROM orders),
    'payments', (SELECT count(*) FROM payments),
    'migrations', (SELECT count(*) FROM schema_migrations),
    'lastMigration', (SELECT max(version) FROM schema_migrations))"
}
