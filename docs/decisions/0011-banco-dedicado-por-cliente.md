# ADR 0011 — Banco dedicado por cliente (plano Enterprise)

- Status: **Proposta** (não implementada; decidir quando surgir o primeiro cliente que exija)
- Contexto: o modelo atual é um banco compartilhado com `tenant_id` + RLS ([ADR 0003](0003-multi-tenant-rls.md)).

## Contexto

Quase todos os restaurantes seguem bem no banco compartilhado: criar cliente é instantâneo, há um
backup só e o custo não cresce por restaurante. Clientes grandes ou com exigência contratual
(volume, isolamento de dados, restauração independente) podem pedir um banco só deles.

## Decisão proposta

Manter o banco compartilhado como padrão e permitir, **por restaurante**, um banco dedicado. A
aplicação é a mesma; só muda para onde a API conecta.

Níveis de isolamento:

1. **Banco separado no mesmo servidor Postgres.** Dados e backup separados; divide CPU e memória.
2. **Servidor Postgres próprio** (outro contêiner ou VM). Nenhum recurso dividido.
3. **Stack inteira própria.** Só se o contrato exigir.

Recomendação: oferecer 1 e 2 no plano Enterprise.

## Como funcionaria

- **Plano de controle (banco central):** continua com `tenants`, domínios, planos, Super Admins e
  auditoria da plataforma. Nova tabela `tenant_databases` (restaurante → conexão, cifrada com
  `INTEGRATIONS_KEY`; só o dono do banco central a lê).
- **Requisição:** o host resolve o restaurante no banco central; a API obtém um pool de conexões
  daquele restaurante (cache com limite e expiração por inatividade). O RLS continua ativo dentro
  de cada banco (defesa em profundidade). O `tenant_id` segue vindo do host, nunca do frontend.
- **Dados do restaurante** (pedidos, produtos, caixa, estoque...) ficam no banco dedicado; o banco
  dedicado mantém a linha mínima de `tenants` para as chaves estrangeiras.
- **Migrações:** o `comandou-migrate` percorre o banco central e todos os dedicados; uma falha em um
  não pode deixar outro pela metade (registro de versão por banco, execução idempotente).
- **Provisionamento:** o painel cria o banco (papéis `owner`/`app`/`platform` como no
  `01-roles.sh`), aplica as migrações e registra a conexão. Ação auditada.
- **Migração de um cliente existente:** exportar as linhas do `tenant_id`, importar no banco novo,
  conferir contagens e trocar o apontamento, com janela curta de manutenção e plano de volta
  (o dado original só é apagado depois, com autorização explícita).
- **Backup e restauração:** um backup cifrado por banco dedicado e teste de restauração por
  cliente, sem afetar os demais.

## Consequências e riscos

- Relatórios do painel que somam todos os clientes passam a consultar banco a banco.
- Conexões totais crescem com o número de bancos: limite de pool por cliente e PgBouncer.
- Migrações em N bancos exigem ordem, idempotência e relatório de falhas.
- Teste de isolamento obrigatório: um cliente nunca lê o banco de outro, nem por erro de cache de pool.
- Não exige mudar quem permanece no banco compartilhado.

## Já preparado (0.9.0)

Sem mudar o comportamento de hoje (todo restaurante segue no banco compartilhado):

- **Ponto único de roteamento:** `TenantDatabaseRouter` (`apps/api/src/database/tenant-database.ts`).
  Toda transação de negócio pede o pool por ele; a implementação atual devolve sempre o
  compartilhado. Ligar bancos dedicados é trocar essa implementação.
- **Migrações em lista:** `TENANT_DATABASE_OWNER_URLS` no `comandou-migrate` (central primeiro,
  relatório por banco).
- **PgBouncer:** overlay `infrastructure/swarm/pgbouncer.yml`, testado com a suíte da API.
- **Métricas por restaurante:** `METRICS_PER_TENANT=true`.

## Quando implementar

Somente com um cliente que peça (contrato, volume ou regra de dados). Antes disso, priorizar
organizações/redes de lojas e PgBouncer + métricas por restaurante.

## Etapa de implementação (estimativa)

Uma etapa própria: registro de conexões, pool por restaurante, migração em todos os bancos,
provisionamento no painel, migração de cliente existente, backups por banco e testes de isolamento.
