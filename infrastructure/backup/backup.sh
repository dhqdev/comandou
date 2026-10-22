#!/usr/bin/env bash
# Backup lógico do Postgres: pg_dump (formato custom) → cifrado com age → B2/S3.
# O arquivo em claro só existe no diretório temporário do contêiner e é apagado logo após cifrar.
# Não apaga backups antigos: a retenção é regra de ciclo de vida do bucket (docs/backups.md).
set -euo pipefail
. "$(dirname "$0")/common.sh"

RUN_ID="$(run_start backup)"
TMP="$(mktemp -d "$WORK_DIR/cm-backup.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
fail() { log backup "ERRO: $1"; run_finish "$RUN_ID" failed '{}' "$1" || true; exit 1; }

TS="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="$S3_PREFIX/$(date -u +%Y/%m)/comandou-$TS.dump.age"
RECIPIENT="$(age-keygen -y "$AGE_IDENTITY_FILE")" || fail "chave age inválida"

log backup "início (registro $RUN_ID)"
BEFORE="$(db_stats)" || fail "banco indisponível"
pg_dump --format=custom --compress=6 --no-comments --file="$TMP/db.dump" "$DATABASE_OWNER_URL" \
  || fail "pg_dump falhou"
AFTER="$(db_stats)" || fail "banco indisponível após o dump"
pg_restore --list "$TMP/db.dump" >/dev/null || fail "arquivo do dump ilegível"
age --encrypt --recipient "$RECIPIENT" --output "$TMP/db.dump.age" "$TMP/db.dump" || fail "falha ao cifrar"
rm -f "$TMP/db.dump"
SIZE="$(stat -c %s "$TMP/db.dump.age")"
SHA="$(sha256sum "$TMP/db.dump.age" | cut -d' ' -f1)"

case "$BACKUP_TARGET" in
  s3)
    s3 s3 cp --only-show-errors --metadata "sha256=$SHA" "$TMP/db.dump.age" "s3://$S3_BUCKET/$KEY" \
      || fail "envio para o bucket falhou"
    REMOTE_SIZE="$(s3 s3api head-object --bucket "$S3_BUCKET" --key "$KEY" --query ContentLength --output text)" \
      || fail "não foi possível conferir o arquivo no bucket"
    [[ "$REMOTE_SIZE" == "$SIZE" ]] || fail "tamanho no bucket ($REMOTE_SIZE) difere do local ($SIZE)"
    ;;
  file)
    : "${BACKUP_DIR:?defina BACKUP_DIR}"
    mkdir -p "$BACKUP_DIR/$(dirname "$KEY")"
    cp "$TMP/db.dump.age" "$BACKUP_DIR/$KEY"
    ;;
  *) fail "BACKUP_TARGET inválido: $BACKUP_TARGET" ;;
esac

run_finish "$RUN_ID" ok "{\"before\": $BEFORE, \"after\": $AFTER}" "" "$KEY" "$SIZE" "$SHA"
log backup "ok: $KEY ($SIZE bytes, sha256 $SHA)"
