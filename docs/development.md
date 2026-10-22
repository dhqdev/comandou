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

Abra `http://demo.pedemais.localhost:8080` (navegadores resolvem `*.localhost` para 127.0.0.1).

> `migrate` usa a conexão do papel dono; por isso o provisionamento roda nele. A API nunca recebe essa conexão.

## Opção B — processos locais (recarga rápida)

```bash
pnpm install
# Postgres local: crie os papéis como em infrastructure/docker/postgres-init/01-roles.sh
pnpm --filter @pedemais/shared build
export DATABASE_OWNER_URL=postgres://pedemais_owner:SENHA@localhost:5432/pedemais
pnpm --filter @pedemais/api db:migrate:dev
PROVISION_ADMIN_PASSWORD='uma-senha-forte' pnpm --filter @pedemais/api tenant:provision:dev demo "Restaurante Demo" dono@demo.local "Dono Demo"
DATABASE_URL=postgres://pedemais_app:SENHA@localhost:5432/pedemais pnpm dev:api
pnpm dev:web   # http://demo.pedemais.localhost:5173 (proxy /api → :3000 preservando o Host)
```

OpenAPI (somente fora de produção): `http://demo.pedemais.localhost:5173/api/docs`.

## Testes

```bash
pnpm --filter @pedemais/shared test
pnpm --filter @pedemais/web test
# API: usa um banco *_test (é recriado a cada execução; o setup recusa outro nome)
TEST_DATABASE_OWNER_URL=postgres://pedemais_owner:SENHA@localhost:5432/pedemais_test \
TEST_DATABASE_URL=postgres://pedemais_app:SENHA@localhost:5432/pedemais_test \
pnpm --filter @pedemais/api test
# E2E (com a stack rodando e um tenant provisionado)
E2E_BASE_URL=http://demo.pedemais.localhost:5173 E2E_EMAIL=dono@demo.local E2E_PASSWORD=... pnpm --filter @pedemais/web e2e
```

Ver [testing.md](testing.md) para o que cada suíte prova.

## Nova migração

1. Crie `apps/api/db/migrations/NNNN_descricao.sql` (próximo número). **Nunca edite** uma migração já aplicada: o migrador recusa checksum diferente.
2. Toda tabela com dados de restaurante: `tenant_id NOT NULL`, `UNIQUE (tenant_id, id)`, FKs compostas, `ENABLE ROW LEVEL SECURITY`, política `tenant_isolation`, `GRANT` mínimo para `pedemais_app`.
3. Espelhe a tabela em `apps/api/src/database/schema.ts`.
4. Adicione testes de isolamento (o teste "todas as tabelas com tenant_id têm RLS" já falha se esquecer o `ENABLE`).
