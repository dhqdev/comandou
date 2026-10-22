# syntax=docker/dockerfile:1.7
# Build do SPA com Node; runtime Nginx sem privilégios (multiarch amd64/arm64).
FROM node:22-alpine AS build
WORKDIR /repo
# CA extra opcional (redes corporativas com proxy TLS): docker build --secret id=ca,src=ca.crt
ENV NODE_EXTRA_CA_CERTS=/run/secrets/ca
RUN --mount=type=secret,id=ca,required=false corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN --mount=type=secret,id=ca,required=false pnpm install --frozen-lockfile --filter @pedemais/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @pedemais/shared build && pnpm --filter @pedemais/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY infrastructure/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
