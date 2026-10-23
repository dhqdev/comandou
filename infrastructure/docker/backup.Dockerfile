# syntax=docker/dockerfile:1.7
# Serviço de backup: pg_dump → cifra (AES-256-GCM, chave da INTEGRATIONS_KEY) → Backblaze B2 (API S3),
# e teste semanal de restauração num Postgres temporário dentro do contêiner. Configurado pelo
# painel Super Admin → Backups. Mesma versão principal do Postgres da stack (16).
# Multiarch (linux/amd64 e linux/arm64): o build roda no processador do runner; só o runtime é por arquitetura.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /repo
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

FROM node:22-alpine AS node

FROM postgres:16-alpine
# O Node (o mesmo da imagem da API) roda o serviço; pg_dump, initdb e pg_restore vêm da imagem do
# Postgres. As duas são Alpine e a do Postgres já tem libstdc++/libgcc; `node --version` confere.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN node --version && mkdir -p /work && chown postgres:postgres /work
COPY --from=build --chown=postgres:postgres /out /app
ENV NODE_ENV=production WORK_DIR=/work
# initdb (teste de restauração) não roda como root.
USER postgres
WORKDIR /app
ENTRYPOINT []
CMD ["node", "dist/backup/worker.js"]
