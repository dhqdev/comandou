#!/usr/bin/env bash
# Instalação em um comando: baixa o Comandou do GitHub (a última Release, ou a versão pedida) e
# roda o instalador. Não precisa de git.
#
#   curl -fsSL https://raw.githubusercontent.com/dhqdev/comandou/main/scripts/get.sh | sudo bash
#   curl -fsSL https://raw.githubusercontent.com/dhqdev/comandou/main/scripts/get.sh | sudo COMANDOU_VERSION=v0.7.0 bash
#
# Repositório privado: exporte GITHUB_TOKEN (permissões: contents e packages, leitura) antes.
# Os arquivos vão para /opt/comandou (COMANDOU_DIR). Atualizar depois = rodar este comando de novo.
set -euo pipefail
REPO="${COMANDOU_REPO:-dhqdev/comandou}"
DIR="${COMANDOU_DIR:-/opt/comandou}"
AUTH=(); [[ -n "${GITHUB_TOKEN:-}" ]] && AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")
for bin in curl tar; do command -v "$bin" >/dev/null || { echo "ERRO: comando ausente: $bin" >&2; exit 1; }; done

tag="${COMANDOU_VERSION:-}"
if [[ -z "$tag" ]]; then
  tag="$(curl -fsSL "${AUTH[@]}" "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
fi
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERRO: não achei a versão (use COMANDOU_VERSION=vX.Y.Z)" >&2; exit 1; }
echo "Comandou $tag → $DIR"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL "${AUTH[@]}" "https://api.github.com/repos/$REPO/tarball/$tag" -o "$tmp/src.tar.gz" \
  || { echo "ERRO: não consegui baixar a versão $tag" >&2; exit 1; }
mkdir -p "$DIR"
# Substitui só os arquivos do código; configuração e logs ficam fora de $DIR/ (deploy.env em /etc/comandou).
tar -xzf "$tmp/src.tar.gz" -C "$DIR" --strip-components=1
printf '%s' "$tag" > "$DIR/.comandou-version"

export COMANDOU_VERSION="$tag"
# O instalador pergunta pelo terminal (/dev/tty), então funciona mesmo com "curl | bash".
exec "$DIR/scripts/install.sh" "$@"
