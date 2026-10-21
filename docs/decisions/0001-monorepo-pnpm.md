# 0001 — Monorepo com pnpm workspaces

**Contexto.** API, Web e regras compartilhadas (dinheiro, slug, permissões) evoluem juntas e precisam das mesmas regras.

**Alternativas.** Repositórios separados; Nx/Turborepo; npm/yarn workspaces.

**Decisão.** pnpm workspaces (`apps/*`, `packages/*`), sem orquestrador extra por enquanto. `packages/shared` compila para ESM (Web) e CommonJS (API).

**Consequências.** Um PR muda contrato e consumidores juntos. Lockfile único. Se o build ficar lento, adicionar Turborepo depois sem mudar a estrutura.
