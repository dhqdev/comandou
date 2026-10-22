# Desenvolvimento local

## Requisitos

Node.js 22+, pnpm 10 (`corepack enable`), PostgreSQL 16 **ou** Docker.

## Opção A — tudo em Docker (mais próximo de produção)

```bash
cp .env.example .env            # troque as senhas
docker compose up -d --build    # postgres + migrate + api + web + traefik
docker compose run --rm -e PROVISION_ADMIN_PASSWORD='uma-senha-forte' migrate \
  node dist/provisioning/provision-cli.js demo "Restaurante Demo" dono@demo.local "Dono Demo"
```

Abra `http://demo.comandou.localhost:8080` (navegadores resolvem `*.localhost` para 127.0.0.1).

> `migrate` usa a conexão do papel dono; por isso o provisionamento roda nele. A API nunca recebe essa conexão.

## Opção B — processos locais (recarga rápida)

```bash
pnpm install
# Postgres local: crie os papéis como em infrastructure/docker/postgres-init/01-roles.sh
pnpm --filter @comandou/shared build
export DATABASE_OWNER_URL=postgres://comandou_owner:SENHA@localhost:5432/comandou
pnpm --filter @comandou/api db:migrate:dev
PROVISION_ADMIN_PASSWORD='uma-senha-forte' pnpm --filter @comandou/api tenant:provision:dev demo "Restaurante Demo" dono@demo.local "Dono Demo"
DATABASE_URL=postgres://comandou_app:SENHA@localhost:5432/comandou pnpm dev:api
pnpm dev:web   # http://demo.comandou.localhost:5173 (proxy /api → :3000 preservando o Host)
```

OpenAPI (somente fora de produção): `http://demo.comandou.localhost:5173/api/docs`.

## Testes

```bash
pnpm --filter @comandou/shared test
pnpm --filter @comandou/web test
# API: usa um banco *_test (é recriado a cada execução; o setup recusa outro nome)
TEST_DATABASE_OWNER_URL=postgres://comandou_owner:SENHA@localhost:5432/comandou_test \
TEST_DATABASE_URL=postgres://comandou_app:SENHA@localhost:5432/comandou_test \
TEST_DATABASE_DEDICATED_OWNER_URL=postgres://comandou_owner:SENHA@localhost:5432/comandou_dedicado_test \
pnpm --filter @comandou/api test
# (o banco comandou_dedicado_test, do mesmo dono, simula um banco dedicado nas migrações em lista)
# E2E (com a stack rodando e um tenant provisionado)
E2E_BASE_URL=http://demo.comandou.localhost:5173 E2E_EMAIL=dono@demo.local E2E_PASSWORD=... pnpm --filter @comandou/web e2e
```

Ver [testing.md](testing.md) para o que cada suíte prova.

## Nova migração

1. Crie `apps/api/db/migrations/NNNN_descricao.sql` (próximo número). **Nunca edite** uma migração já aplicada: o migrador recusa checksum diferente.
2. Toda tabela com dados de restaurante: `tenant_id NOT NULL`, `UNIQUE (tenant_id, id)`, FKs compostas, `ENABLE ROW LEVEL SECURITY`, política `tenant_isolation`, `GRANT` mínimo para `comandou_app`.
3. Espelhe a tabela em `apps/api/src/database/schema.ts`.
4. Adicione testes de isolamento (o teste "todas as tabelas com tenant_id têm RLS" já falha se esquecer o `ENABLE`).
