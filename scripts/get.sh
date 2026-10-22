#!/usr/bin/env bash
# Instalação em um comando: baixa o PedeMais do GitHub (a última Release, ou a versão pedida) e
# roda o instalador. Não precisa de git.
#
#   curl -fsSL https://raw.githubusercontent.com/dhqdev/pedemais/main/scripts/get.sh | sudo bash
#   curl -fsSL https://raw.githubusercontent.com/dhqdev/pedemais/main/scripts/get.sh | sudo PEDEMAIS_VERSION=v0.7.0 bash
#
# Repositório privado: exporte GITHUB_TOKEN (permissões: contents e packages, leitura) antes.
# Os arquivos vão para /opt/pedemais (PEDEMAIS_DIR). Atualizar depois = rodar este comando de novo.
set -euo pipefail
REPO="${PEDEMAIS_REPO:-dhqdev/pedemais}"
DIR="${PEDEMAIS_DIR:-/opt/pedemais}"
AUTH=(); [[ -n "${GITHUB_TOKEN:-}" ]] && AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")
for bin in curl tar; do command -v "$bin" >/dev/null || { echo "ERRO: comando ausente: $bin" >&2; exit 1; }; done

tag="${PEDEMAIS_VERSION:-}"
if [[ -z "$tag" ]]; then
  tag="$(curl -fsSL "${AUTH[@]}" "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
fi
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERRO: não achei a versão (use PEDEMAIS_VERSION=vX.Y.Z)" >&2; exit 1; }
echo "PedeMais $tag → $DIR"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL "${AUTH[@]}" "https://api.github.com/repos/$REPO/tarball/$tag" -o "$tmp/src.tar.gz" \
  || { echo "ERRO: não consegui baixar a versão $tag" >&2; exit 1; }
mkdir -p "$DIR"
# Substitui só os arquivos do código; configuração e logs ficam fora de $DIR/ (deploy.env em /etc/pedemais).
tar -xzf "$tmp/src.tar.gz" -C "$DIR" --strip-components=1
printf '%s' "$tag" > "$DIR/.pedemais-version"

export PEDEMAIS_VERSION="$tag"
# O instalador pergunta pelo terminal (/dev/tty), então funciona mesmo com "curl | bash".
exec "$DIR/scripts/install.sh" "$@"
