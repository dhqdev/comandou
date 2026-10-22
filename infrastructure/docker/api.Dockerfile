# syntax=docker/dockerfile:1.7
# Imagem da API (NestJS). Base node:22-alpine é multiarch (linux/amd64 e linux/arm64).
# Sem dependências nativas: senhas usam scrypt do próprio Node.
FROM node:22-alpine AS build
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

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live >/dev/null || exit 1
# Sinais (SIGTERM) e processos zumbis: rode com `init: true` (Compose/Swarm) — ver docs/docker.md.
CMD ["node", "dist/main.js"]
