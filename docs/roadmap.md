# Roadmap

Cada etapa só é considerada concluída quando **todos** os critérios de aceitação forem verificados com evidência (teste automatizado, log ou captura).

## Etapa 1 — Investigação e planejamento · ✅ concluída (com pendências)

- [x] Repositório analisado ([análise inicial](initial-analysis.md))
- [x] Repositório `alextnetto/res` avaliado (skill MIT de engenharia reversa; útil como ferramenta)
- [~] Sistema de referência: só por capturas de tela. **Pendente**: acesso direto com credenciais
- [ ] Infraestrutura existente (Oracle/Swarm/Portainer/Traefik): **pendente de acesso** para inspeção
- [x] Arquitetura, modelo de dados inicial, riscos e ADRs

## Etapa 2 — Fundação técnica · ✅ entregue nesta PR

| Critério de aceitação | Evidência |
| --- | --- |
| API NestJS versionada (`/api/v1`) com validação, erros padronizados, OpenAPI em dev | `apps/api/src`, `/api/docs` |
| PostgreSQL com migrações versionadas, checksum e lock | `apps/api/db/migrations`, `migrator.ts` |
| RLS em todas as tabelas com `tenant_id`; papel da app sem bypass | `test/rls.int.test.ts` |
| Contexto de tenant não vaza entre conexões do pool | teste "conexão reutilizada…" |
| FKs compostas impedem referência entre tenants | testes "Integridade entre tenants" |
| Login, sessão, logout/revogação, permissões, CSRF, rate limit | `test/api.e2e.test.ts` |
| Trocar ID na URL não dá acesso; `tenant_id` do cliente é ignorado | `test/api.e2e.test.ts` |
| Provisionamento idempotente e retomável | `test/provisioning.int.test.ts` |
| Frontend React com Design System e PWA | `apps/web`, Playwright desktop + celular |
| Docker local com Nginx + Traefik | `docker-compose.yml` |
| Stack Swarm/Portainer usando `network_public` | `infrastructure/swarm/pedemais-stack.yml` (**não implantada**) |
| CI no GitHub Actions | `.github/workflows/ci.yml` |

## Etapa 3 — Primeiros fluxos comerciais

Ordem sugerida, um PR por item:

1. **Adicionais e variantes** no cardápio (grupos min/max, preço).
2. **Pedidos**: criação com idempotency key, numeração por tenant sem buracos críticos, máquina de estados, histórico de status, status operacional × financeiro.
3. **Tempo real**: WebSocket (Socket.IO ou ws) com salas por tenant autenticadas pela sessão; reconciliação via REST após reconexão. Redis adapter quando houver >1 réplica.
4. **KDS**: setores de produção, SLA de aviso/atraso, início/conclusão, reabertura auditada.
5. **Salão**: mesas, comandas, transferência, divisão de conta.
6. **Caixa/PDV**: sessão por terminal, movimentos imutáveis (abertura, venda, suprimento, sangria, estorno), fechamento esperado × informado, bloqueio `SELECT … FOR UPDATE`, idempotência.

Critérios: testes de concorrência (duas confirmações simultâneas → uma vence), testes de isolamento para cada nova tabela, E2E do fluxo pedido → cozinha → pagamento → fechamento.

## Etapa 4 — Operações complementares

Estoque (fichas técnicas, baixa definida por regra explícita, sem negativo involuntário), delivery e entregadores (rastreamento temporário com expiração), **agente local de impressão** (heartbeat, fila, chave única por trabalho), financeiro (contas a pagar/receber, fluxo de caixa, conciliação), administração de usuários.

## Etapa 5 — Integrações

Focus NFe (homologação primeiro), WhatsApp (serviço isolado com Baileys, sessões por tenant; avaliar API oficial), notificações. Redis + BullMQ para filas, com `tenant_id` obrigatório no payload e revalidação no worker.

## Etapa 6 — SaaS

Painel Super Admin (caminho privilegiado separado e auditado), planos, assinaturas, limites, domínios personalizados (verificação DNS TXT), monitoramento, backups para B2/S3 com teste de restauração, deploy controlado com aprovação manual.

## Etapa 7 — Produção

Revisão de segurança, testes de carga, testes de restauração, validação das integrações, documentação de operação.
