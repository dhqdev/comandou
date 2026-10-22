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

## Etapa 3 — Primeiros fluxos comerciais · ✅ entregue nesta PR

Entregue em um PR único (a pedido), com os seis itens planejados.

| Critério de aceitação | Evidência |
| --- | --- |
| Adicionais e variações (grupos min/max, preço adicional) validados no servidor | `catalog/options.controller.ts`; testes "valida mínimo/máximo…" |
| Preço sempre vem do banco; valor enviado pelo cliente é ignorado | teste "preço vem do banco…" |
| Pedido idempotente (`Idempotency-Key`), numeração por tenant, máquina de estados, histórico | `orders/orders.service.ts`; testes de idempotência e de transição |
| Status operacional separado do financeiro (`payment_status`) | teste "pagamento parcial…" |
| Tempo real por restaurante (`/api/ws`), publicado só após o COMMIT, reconciliação ao reconectar | `realtime/*`; testes "Tempo real (WebSocket)" |
| Cozinha por setor, aviso/atraso, avanço automático, reabertura com permissão e motivo | `kitchen/*`; testes "Cozinha (KDS)" |
| Salão: mesas, comandas, transferência de mesa e de pedido, divisão de conta, fechamento | `tables/*`; testes "Salão…" |
| Caixa: sessão por terminal, abertura, suprimento, sangria, pagamentos, estornos, fechamento conferido | `cash/*`; testes "Caixa…" e "Fechamento de caixa" |
| Registros financeiros imutáveis (estorno em vez de apagar) | teste "aplicação não altera nem apaga registros financeiros" |
| Concorrência: dois pagamentos do mesmo saldo → um vence; mesma chave em paralelo → um registro | testes de concorrência |
| Isolamento de cada nova tabela (RLS + FKs compostas) | `rls.int.test.ts` (varre todas as tabelas) + testes de B contra A |
| E2E pedido → cozinha → pagamento → mesa → fechamento de caixa | `apps/web/e2e/operations.spec.ts` (desktop e celular) |
| Relatório de vendas separando faturamento de recebimentos | `reports/reports.controller.ts` |

Fora do escopo desta etapa (próximas): impressão de comanda/cupom, entregas e entregadores, cardápio digital do cliente, permissões configuráveis por restaurante, divisão de um item entre pessoas (hoje divide por valor ou por pedido).

## Etapa 4 — Operações complementares · ✅ entregue nesta PR

Entregue em um PR único, versão **0.3.0** (ver tela Novidades no sistema).

| Critério de aceitação | Evidência |
| --- | --- |
| Equipe: adicionar pessoa, trocar papel, desativar (encerra sessões), troca da própria senha | `users/users.controller.ts`; testes "Equipe" |
| Nunca fica sem administrador, mesmo com alterações simultâneas | teste "dois administradores rebaixando um ao outro" |
| Estoque por insumo, entrada com custo médio, perda/contagem com motivo, livro-razão só de inserção | `stock/*`; testes "Estoque e ficha técnica" |
| Ficha técnica de produto e de adicional; venda baixa, cancelamento devolve (estorno) | testes "ficha técnica…baixa o estoque" |
| Sem negativo involuntário, inclusive com vendas simultâneas | teste "vendas simultâneas não deixam o estoque negativo" |
| Entregas com entregador, link de rastreio público com hash e expiração, entregador só vê/mexe nas próprias | `delivery/*`; testes "Entregas e rastreio" |
| Rastreio não expõe endereço/telefone e não funciona em outro restaurante | mesmos testes |
| Fila de impressão com chave única, reserva com `SKIP LOCKED`, prazo e limite de tentativas, heartbeat | `printing/*`; testes "Impressão" |
| Agente local sem dependências (ESC/POS, CP860, TCP 9100/arquivo) | `tools/print-agent` + `node --test` |
| Financeiro: contas a pagar/receber, baixa idempotente, pago não cancela, fluxo de caixa, conciliação imutável | `finance/finance.controller.ts`; testes "Financeiro" |
| Isolamento das 10 tabelas novas (RLS + FKs compostas) | `rls.int.test.ts` + testes de B contra A |
| Telas no navegador (desktop e celular) | `apps/web/e2e/backoffice.spec.ts` |

Fora do escopo desta etapa: permissões configuráveis por restaurante, compras/fornecedores como cadastro, transferência entre estoques, mapa ao vivo do entregador (hoje é a última posição enviada), redefinição de senha por e-mail, nota fiscal (Etapa 5).

## Etapa 5 — Integrações

Focus NFe (homologação primeiro), WhatsApp (serviço isolado com Baileys, sessões por tenant; avaliar API oficial), notificações. Redis + BullMQ para filas, com `tenant_id` obrigatório no payload e revalidação no worker.

## Etapa 6 — SaaS

Painel Super Admin (caminho privilegiado separado e auditado), planos, assinaturas, limites, domínios personalizados (verificação DNS TXT), monitoramento, backups para B2/S3 com teste de restauração, deploy controlado com aprovação manual.

## Etapa 7 — Produção

Revisão de segurança, testes de carga, testes de restauração, validação das integrações, documentação de operação.
