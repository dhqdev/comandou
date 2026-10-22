# ADR 0010 — Produção: limites, bloqueio por conta, limpeza de dados e verificação

- Status: aceita (Etapa 7)
- Data: 2026-10-22

## Contexto

A Etapa 7 prepara o primeiro deploy. Uma revisão de segurança, um teste de carga com 1 milhão
de pedidos e um ensaio de restauração mostraram pontos a fechar antes de receber clientes
([segurança](../security.md), [carga](../load-testing.md), [backups](../backups.md#ensaios)).

## Decisão

1. **Limite de requisições no Redis.** Com `REDIS_URL`, o contador do `@nestjs/throttler` fica no
   Redis (janela fixa, script atômico), valendo para todas as réplicas juntas. Se o Redis cair, cada
   réplica volta ao contador em memória em vez de travar ou liberar tudo. O limite geral por IP
   e rota passa a ser configurável (`RATE_LIMIT_PER_MINUTE`, padrão 300).
2. **Bloqueio temporário por conta.** Antes de conferir a senha, a API conta as falhas de login
   daquele e-mail no restaurante (auditoria já existente) nos últimos 15 minutos; com 10 ou mais,
   responde 429. O mesmo vale para o painel da plataforma. Conta inexistente também bloqueia, para
   não revelar quais existem. Não há desbloqueio manual: a janela passa sozinha.
3. **Limpeza de dados vencidos por função do banco.** A API continua sem DELETE. A função
   `app_purge_expired()` (SECURITY DEFINER, dona `comandou_owner`) apaga sessões encerradas há mais
   de 90 dias e chaves de idempotência com mais de 30, e zera a posição do entregador 30 dias após
   a entrega. Roda a cada 6 h em cada réplica (idempotente). Nada financeiro, fiscal ou de auditoria.
4. **Índices pelo teste de carga, não por palpite.** `orders (tenant_id, created_at DESC)` e
   `cash_movements (tenant_id, created_at)`. Em banco grande já em produção, criar antes com
   `CREATE INDEX CONCURRENTLY` (a migração usa `IF NOT EXISTS`).
5. **Verificar antes e depois do deploy.** `scripts/preflight.sh` só lê: servidor, segredos, DNS,
   Traefik, certificados, saúde, bucket, idade dos backups e saída para as integrações.
6. **Alertas versionados e testados.** `infrastructure/monitoring/alerts.yml` com testes do
   `promtool` no CI; a idade do último backup vira métrica via `app_backup_status()`.

## Consequências

- Bloqueio por conta pode ser usado para incomodar um usuário por 15 minutos (risco aceito).
- Três migrações novas (0008–0010), todas aditivas.
- O teste de carga cria dados de verdade: só em ambiente de teste.
