# syntax=docker/dockerfile:1.7
# Serviço interno de WhatsApp (Baileys / QR Code). Multiarch (linux/amd64 e linux/arm64).
# O estágio de build roda no processador do próprio runner (rápido) e só o runtime é por arquitetura:
# sem isso o arm64 seria compilado por emulação (QEMU), 10x mais lento.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /repo
ENV NODE_EXTRA_CA_CERTS=/run/secrets/ca
# git: o Baileys depende do libsignal publicado no GitHub.
RUN apk add --no-cache git
RUN --mount=type=secret,id=ca,required=false corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/whatsapp-gateway/package.json apps/whatsapp-gateway/
# Módulos nativos opcionais (ex.: sharp) vêm para as duas arquiteturas, já que o build roda em amd64.
RUN printf '\nsupportedArchitectures:\n  os: [linux]\n  cpu: [x64, arm64]\n  libc: [musl]\n' >> pnpm-workspace.yaml
RUN --mount=type=secret,id=ca,required=false pnpm install --frozen-lockfile --filter @comandou/whatsapp-gateway...
COPY apps/whatsapp-gateway apps/whatsapp-gateway
RUN pnpm --filter @comandou/whatsapp-gateway build \
 && pnpm --filter @comandou/whatsapp-gateway deploy --legacy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production DATA_DIR=/data PORT=3100
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
