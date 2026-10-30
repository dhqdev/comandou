#!/usr/bin/env bash
# Instalação em um comando. Funciona com o repositório PRIVADO e sem token: tudo vem das imagens
# públicas do GHCR (ghcr.io/dhqdev/comandou-*), que trazem o instalador dentro.
#
#   No servidor (Ubuntu/Debian, AMD64 ou ARM64), por SSH:
#     curl -fsSL https://admin.comandou.com/instalar | sudo bash
#   Versão específica:
#     curl -fsSL https://admin.comandou.com/instalar | sudo COMANDOU_VERSION=v0.67.0 bash
#   Sem nenhum Comandou no ar ainda (precisa do Docker):
#     docker run --rm ghcr.io/dhqdev/comandou-web:latest cat /opt/comandou-instalador/scripts/get.sh | sudo bash
#
# Com GITHUB_TOKEN (leitura de contents) o código vem do GitHub em vez da imagem.
# Os arquivos vão para /opt/comandou (COMANDOU_DIR). Atualizar depois = rodar o mesmo comando.
set -euo pipefail
REPO="${COMANDOU_REPO:-dhqdev/comandou}"
IMAGES="${COMANDOU_IMAGES:-ghcr.io/${REPO%%/*}/comandou-}"
DIR="${COMANDOU_DIR:-/opt/comandou}"
ASSUME_YES=false; [[ "${1:-}" == "--yes" ]] && ASSUME_YES=true
die() { echo "ERRO: $*" >&2; exit 1; }
have_tty() { { : >/dev/tty; } 2>/dev/null; }
confirm() { $ASSUME_YES && return 0; have_tty || die "sem terminal para confirmar; use --yes (ou ssh -t)"; read -r -p "$1 [s/N] " a </dev/tty >/dev/tty; [[ "$a" =~ ^[sS]$ ]]; }
for bin in curl tar sed sort; do command -v "$bin" >/dev/null || die "comando ausente: $bin"; done
[[ "$(uname -s)" == "Linux" ]] || die "o servidor precisa ser Linux (Ubuntu ou Debian). No Windows ou Mac, entre no servidor por SSH e rode o comando lá."
SUDO=""; [[ "$(id -u)" -ne 0 ]] && SUDO="sudo"

# Tags vX.Y.Z de uma imagem pública do GHCR (sem login).
ghcr_tags() {
  local name="${IMAGES#ghcr.io/}$1" token
  token="$(curl -fsSL "https://ghcr.io/token?scope=repository:$name:pull" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  [[ -n "$token" ]] || return 1
  curl -fsSL -H "Authorization: Bearer $token" "https://ghcr.io/v2/$name/tags/list?n=10000" \
    | grep -oE '"v[0-9]+\.[0-9]+\.[0-9]+"' | tr -d '"' | sort -u
}

tag="${COMANDOU_VERSION:-}"
if [[ -z "$tag" ]]; then
  # Última versão publicada nas 4 imagens (mesma regra do botão "Atualizar sistema").
  common="$(ghcr_tags web || true)"
  for img in api backup whatsapp-gateway; do
    common="$(comm -12 <(printf '%s\n' "$common") <(ghcr_tags "$img" || true))"
  done
  tag="$(printf '%s\n' "$common" | grep -v '^$' | sort -V | tail -1 || true)"
fi
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "não achei a versão nas imagens do GHCR (use COMANDOU_VERSION=vX.Y.Z)"
echo "Comandou $tag → $DIR"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
$SUDO mkdir -p "$DIR"
if [[ -n "${GITHUB_TOKEN:-}" ]] \
  && curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/$REPO/tarball/$tag" -o "$tmp/src.tar.gz"; then
  $SUDO tar -xzf "$tmp/src.tar.gz" -C "$DIR" --strip-components=1
else
  [[ -n "${GITHUB_TOKEN:-}" ]] && echo "AVISO: o GitHub recusou o GITHUB_TOKEN; usando o instalador da imagem"
  # O instalador vem dentro da imagem pública do web: precisa do Docker para tirá-lo de lá.
  if ! command -v docker >/dev/null; then
    confirm "Docker não encontrado. Instalar agora (script oficial get.docker.com)?" || die "Docker é obrigatório"
    curl -fsSL https://get.docker.com | $SUDO sh
  fi
  D=(docker); if ! docker info >/dev/null 2>&1 && [[ -n "$SUDO" ]]; then D=(sudo docker); fi
  "${D[@]}" pull -q "${IMAGES}web:$tag" >/dev/null || die "não consegui baixar ${IMAGES}web:$tag"
  cid="$("${D[@]}" create "${IMAGES}web:$tag")"
  if ! "${D[@]}" cp "$cid:/opt/comandou-instalador/." "$tmp/src" 2>/dev/null; then
    "${D[@]}" rm "$cid" >/dev/null
    die "a versão $tag não traz o instalador na imagem (só a partir da v0.66.1). Use uma versão mais nova ou GITHUB_TOKEN."
  fi
  "${D[@]}" rm "$cid" >/dev/null
  # Substitui só os arquivos do instalador; configuração fica em /etc/comandou.
  $SUDO cp -R "$tmp/src/." "$DIR/"
fi
printf '%s' "$tag" | $SUDO tee "$DIR/.comandou-version" >/dev/null
$SUDO chmod +x "$DIR"/scripts/*.sh

export COMANDOU_VERSION="$tag"
# O instalador pergunta pelo terminal (/dev/tty), então funciona mesmo com "curl | bash".
if [[ -n "$SUDO" ]]; then exec sudo -E "$DIR/scripts/install.sh" "$@"; fi
exec "$DIR/scripts/install.sh" "$@"
