#!/bin/sh
# Executado UMA vez pelo contêiner oficial do Postgres ao criar o volume.
# Cria o papel dono (migrações/provisionamento), o papel da aplicação (sujeito a RLS) e o papel
# do painel Super Admin (pedemais_platform, também sem BYPASSRLS, com políticas próprias).
set -eu
# Suporte a Docker secrets (*_FILE).
[ -n "${PEDEMAIS_OWNER_PASSWORD_FILE:-}" ] && PEDEMAIS_OWNER_PASSWORD="$(cat "$PEDEMAIS_OWNER_PASSWORD_FILE")"
[ -n "${PEDEMAIS_APP_PASSWORD_FILE:-}" ] && PEDEMAIS_APP_PASSWORD="$(cat "$PEDEMAIS_APP_PASSWORD_FILE")"
[ -n "${PEDEMAIS_PLATFORM_PASSWORD_FILE:-}" ] && PEDEMAIS_PLATFORM_PASSWORD="$(cat "$PEDEMAIS_PLATFORM_PASSWORD_FILE")"
: "${PEDEMAIS_OWNER_PASSWORD:?defina PEDEMAIS_OWNER_PASSWORD}"
: "${PEDEMAIS_APP_PASSWORD:?defina PEDEMAIS_APP_PASSWORD}"
: "${PEDEMAIS_PLATFORM_PASSWORD:?defina PEDEMAIS_PLATFORM_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$PEDEMAIS_OWNER_PASSWORD" -v app_pw="$PEDEMAIS_APP_PASSWORD" \
  -v platform_pw="$PEDEMAIS_PLATFORM_PASSWORD" <<'SQL'
CREATE ROLE pedemais_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE pedemais_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE pedemais_platform LOGIN PASSWORD :'platform_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 10;
CREATE DATABASE pedemais OWNER pedemais_owner;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname pedemais <<'SQL'
REVOKE ALL ON DATABASE pedemais FROM PUBLIC;
GRANT CONNECT ON DATABASE pedemais TO pedemais_app;
GRANT CONNECT ON DATABASE pedemais TO pedemais_platform;
SQL
