# syntax=docker/dockerfile:1.7
# Imagem da API (NestJS). Base node:22-alpine é multiarch (linux/amd64 e linux/arm64).
# Sem dependências nativas: senhas usam scrypt do próprio Node; fotos e o recorte do 3D, WebAssembly.
# O estágio de build roda no processador do próprio runner (rápido) e só o runtime é por arquitetura:
# sem isso o arm64 seria compilado por emulação (QEMU), 10x mais lento.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /repo
# CA extra opcional (redes corporativas com proxy TLS): docker build --secret id=ca,src=ca.crt
ENV NODE_EXTRA_CA_CERTS=/run/secrets/ca
RUN --mount=type=secret,id=ca,required=false corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=secret,id=ca,required=false pnpm install --frozen-lockfile --filter @comandou/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @comandou/shared build && pnpm --filter @comandou/api build \
 && pnpm --filter @comandou/api deploy --legacy --prod /out
# O recorte da foto do 3D (onnxruntime-web) só usa a versão para Node e o WebAssembly simples:
# o resto (WebGPU, WebGL, mapas) é ~120 MB que a imagem não precisa.
RUN find /out/node_modules -path '*/onnxruntime-web/dist/*' -type f \
      ! -name 'ort.node.min.js' ! -name 'ort-wasm-simd-threaded.wasm' ! -name 'ort-wasm-simd-threaded.mjs' -delete \
 && find /out/node_modules -path '*/onnxruntime-web/lib' -type d -prune -exec rm -rf {} + \
 && test -n "$(find /out/node_modules -path '*/onnxruntime-web/dist/ort.node.min.js')"

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Versão publicada pelo CI (tag, ex.: v0.110.2): a migração e o painel usam para separar os
# restaurantes que ficaram em outra versão (docs/versao-por-cliente.md).
ARG COMANDOU_VERSION=
ENV COMANDOU_VERSION=$COMANDOU_VERSION
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# O serviço migrate usa esta imagem sem servir HTTP: as CLIs de uma vez só criam
# /tmp/comandou-oneshot (src/config/one-shot.ts) e o contêiner conta como saudável até terminar.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live >/dev/null || [ -e /tmp/comandou-oneshot ] || exit 1
# Sinais (SIGTERM) e processos zumbis: rode com `init: true` (Compose/Swarm) — ver docs/docker.md.
CMD ["node", "dist/main.js"]
