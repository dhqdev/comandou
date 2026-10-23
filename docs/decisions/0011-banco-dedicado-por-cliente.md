# ADR 0011 — Banco dedicado por cliente

- Status: **Aceita e implementada (0.19.0)**, para **todos** os restaurantes novos (não só
  Enterprise), nível 1 (banco separado no mesmo servidor Postgres). Ver "Implementação" no fim.
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

## Implementação (0.19.0)

Decisão do dono do produto: cada restaurante novo ganha o próprio banco, organizado e separado.

- **Nome:** `comandou_<endereço>` (hífens viram `_`), no mesmo servidor e com os mesmos papéis
  (`comandou_owner` dono; `comandou_app` e `comandou_platform` com CONNECT). Mesmas migrações e o
  mesmo RLS. Sem segredo novo: a conexão é a do banco central trocando o nome do banco.
- **Banco central (`comandou`):** `tenants`, domínios, planos, assinaturas, Super Admins,
  auditoria da plataforma, backups e o registro `tenant_databases` (restaurante → banco e
  situação: `creating`, `ready`, `failed`, `moving`, `deleting`). Sem linha no registro = o
  restaurante está no banco central (restaurantes antigos, até serem movidos).
- **Banco do restaurante:** todos os dados de negócio, mais equipe (`users`, `memberships`),
  sessões e auditoria do restaurante, e uma cópia da linha de `tenants` (nome e situação ficam
  em sincronia pelo painel). Planos e assinatura são lidos sempre do central.
- **Roteamento:** `RegistryDatabaseRouter` consulta o registro (cache de 10 s; o painel não usa
  cache) e abre um pool pequeno por banco (3 conexões, fecha parado em 15 s). Banco que não está
  `ready` responde 503 "em manutenção": nada é gravado no meio de uma mudança.
- **Trabalhos de banco** (`tenant_db_jobs`): criar, mover e excluir são pedidos pelo painel e
  executados pelo serviço de backup (`LISTEN comandou_db_jobs` + conferência a cada 5 s). Mover e
  excluir usam a mesma trava do backup. Etapas retomáveis; serviço reiniciado devolve à fila.
  - **Criar:** `CREATE DATABASE`, migrações, cópia da linha do restaurante, administrador e
    auditoria; só então `ready` e o restaurante fica ativo.
  - **Mover** (restaurante antigo): bloqueia, copia tudo numa fotografia consistente, confere a
    contagem de cada tabela, troca o apontamento e só então apaga as linhas do central. Falhou:
    apaga o banco novo e o restaurante continua no central como estava.
  - **Excluir:** só suspenso (ou com criação falha), digitando o endereço e o motivo. Faz o
    backup final em `restaurantes/<endereço>/final/` (nunca apagado pela retenção), apaga o
    banco, o cadastro e a assinatura. A auditoria da plataforma fica, sem a ligação.
- **Permissão:** o dono precisa de `CREATEDB` e `pg_signal_backend`. Servidores novos já nascem
  assim (`01-roles.sh`); nos existentes o serviço de backup concede ao iniciar com a senha do
  `postgres` (secret `comandou_pg_password`) e o painel mostra o comando se não conseguir.
- **Migrações:** `migrate-cli` roda o central e depois cada banco registrado.
- **Backups:** um arquivo por banco: `<pasta>/plataforma/AAAA/MM/` e
  `<pasta>/restaurantes/<endereço>/AAAA/MM/`; retenção por pasta; o teste de restauração confere o
  central e o último de cada restaurante.
- **Desenvolvimento** (`docker-compose.yml`, sem serviço de backup): `TENANT_DATABASE_MODE=shared`
  mantém o comportamento antigo.
