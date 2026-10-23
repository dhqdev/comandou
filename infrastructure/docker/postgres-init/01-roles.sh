#!/bin/sh
# Executado UMA vez pelo contêiner oficial do Postgres ao criar o volume.
# Cria o papel dono (migrações/provisionamento), o papel da aplicação (sujeito a RLS) e o papel
# do painel Super Admin (comandou_platform, também sem BYPASSRLS, com políticas próprias).
# O dono pode criar bancos (um por restaurante) e encerrar conexões ao excluir um deles.
set -eu
# Suporte a Docker secrets (*_FILE).
[ -n "${COMANDOU_OWNER_PASSWORD_FILE:-}" ] && COMANDOU_OWNER_PASSWORD="$(cat "$COMANDOU_OWNER_PASSWORD_FILE")"
[ -n "${COMANDOU_APP_PASSWORD_FILE:-}" ] && COMANDOU_APP_PASSWORD="$(cat "$COMANDOU_APP_PASSWORD_FILE")"
[ -n "${COMANDOU_PLATFORM_PASSWORD_FILE:-}" ] && COMANDOU_PLATFORM_PASSWORD="$(cat "$COMANDOU_PLATFORM_PASSWORD_FILE")"
: "${COMANDOU_OWNER_PASSWORD:?defina COMANDOU_OWNER_PASSWORD}"
: "${COMANDOU_APP_PASSWORD:?defina COMANDOU_APP_PASSWORD}"
: "${COMANDOU_PLATFORM_PASSWORD:?defina COMANDOU_PLATFORM_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$COMANDOU_OWNER_PASSWORD" -v app_pw="$COMANDOU_APP_PASSWORD" \
  -v platform_pw="$COMANDOU_PLATFORM_PASSWORD" <<'SQL'
CREATE ROLE comandou_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER CREATEDB NOCREATEROLE;
GRANT pg_signal_backend TO comandou_owner;
CREATE ROLE comandou_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE comandou_platform LOGIN PASSWORD :'platform_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 10;
CREATE DATABASE comandou OWNER comandou_owner;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname comandou <<'SQL'
REVOKE ALL ON DATABASE comandou FROM PUBLIC;
GRANT CONNECT ON DATABASE comandou TO comandou_app;
GRANT CONNECT ON DATABASE comandou TO comandou_platform;
SQL
