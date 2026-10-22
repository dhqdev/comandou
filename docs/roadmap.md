# Roadmap

Cada etapa só é considerada concluída quando **todos** os critérios de aceitação forem verificados com evidência (teste automatizado, log ou captura).

## Etapa 1 — Investigação e planejamento · ✅ concluída

- [x] Repositório analisado (vazio; estrutura criada do zero)
- [ ] Infraestrutura existente (Oracle/Swarm/Portainer/Traefik): **pendente de acesso** para inspeção
- [x] Arquitetura, modelo de dados inicial, riscos e ADRs

## Etapa 2 — Fundação técnica · ✅ entregue (PR #1)

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
| Stack Swarm/Portainer usando `network_public` | `infrastructure/swarm/comandou-stack.yml` (**não implantada**) |
| CI no GitHub Actions | `.github/workflows/ci.yml` |

## Etapa 3 — Primeiros fluxos comerciais · ✅ entregue (PR #2)

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

## Etapa 4 — Operações complementares · ✅ entregue (PR #3)

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

## Etapa 5 — Integrações · ✅ entregue (PR #4)

Entregue em um PR único, versão **0.4.0** (ver tela Novidades no sistema). Decisões no [ADR 0008](decisions/0008-integracoes-filas-nfce-whatsapp.md).

| Critério de aceitação | Evidência |
| --- | --- |
| Redis + BullMQ, `tenantId` obrigatório no trabalho e revalidação no consumidor | `queue/queue.service.ts`; testes da nota e do WhatsApp rodam com e sem Redis (CI com Redis) |
| NFC-e pela Focus NFe em homologação: emissão, consulta, cancelamento | `fiscal/*`; `test/fiscal.e2e.test.ts` com uma Focus falsa |
| Nunca duas notas para o mesmo envio (referência fixa, reconciliação, falha temporária) | testes "falha temporária…", "referência já usada…", "Focus fora do ar…" |
| Só pedido pago; NCM obrigatório; desconto/acréscimo rateados sem perder centavo | testes "não emite pedido sem pagamento…", "NCM ausente…", "autoriza pela fila…" |
| Pedido com nota viva não é cancelado nem estornado | teste "pedido com nota viva…" |
| Produção só pelo dono e com confirmação | teste "produção exige o dono…" |
| Tokens cifrados, nunca devolvidos nem auditados | testes de configuração (fiscal e WhatsApp) |
| WhatsApp por QR Code (Baileys) em serviço separado, sessão cifrada por restaurante | `apps/whatsapp-gateway`; `src/gateway.test.ts` (sessão cifrada, token interno, QR → conectado → envio, logout) |
| Avisos: pronto e saiu para entrega, uma vez por pedido, texto do restaurante, reenvio de falha | `messaging/*`; `test/messaging.e2e.test.ts` com gateway e Graph API falsos |
| API oficial da Meta como alternativa | mesmos testes, suíte "API oficial da Meta" |
| Isolamento das 4 tabelas novas | `rls.int.test.ts` + testes de B contra A |
| Telas: Nota fiscal, WhatsApp, NFC-e no pedido, dados fiscais no cardápio | `apps/web/e2e/integrations.spec.ts` |

Pendências que dependem de contas reais (não simuladas aqui): validar em homologação na Focus NFe com o CNPJ e o certificado do restaurante (campo de outras despesas, exigências de cartão da SEFAZ do estado) e ler o primeiro QR Code com um número de teste (o CI não alcança os servidores do WhatsApp).

## Etapa 6 — SaaS · ✅ entregue (PR #5)

Entregue em um PR único, versão **0.5.0** (ver tela Novidades no sistema). Decisões no [ADR 0009](decisions/0009-saas-plataforma-planos-backups.md).

| Critério de aceitação | Evidência |
| --- | --- |
| Super Admin em caminho separado: só em `admin.<base>`, 404 em qualquer outro host | `platform/*`; testes "rotas do painel não existem fora de admin.<base>", "admin.<base> não resolve restaurante nenhum" |
| Papel próprio no banco, sem BYPASSRLS, sem ler senhas nem pedidos, sem DELETE | migração `0007_saas.sql`; teste "papéis do banco…" |
| Login com senha + código do autenticador; código não reutilizável; cookie restrito ao painel | `platform/totp.test.ts` (vetores da RFC 6238); testes de login e logout |
| Toda ação auditada, inclusive login recusado; suspender/reativar com motivo | testes "senha certa com código errado…", "suspende… e reativa…" |
| Planos, assinaturas e limites (equipe, produtos, pedidos/mês) sem apagar dados | `plans/*`; testes "cria planos…", "aplica limites…", "cancelar a assinatura tira os limites" |
| Restaurante novo pelo painel com plano | teste "cria restaurante pelo painel…"; `provisioning.int.test.ts` |
| Domínio próprio verificado por DNS TXT, só verificado resolve e vai para o Traefik | `domains/*`; testes de domínio e "Traefik recebe só domínios verificados, com token" |
| Monitoramento: métricas Prometheus com token, saúde do banco/Redis/WhatsApp | `health/*`; testes de métricas e readiness |
| Backup cifrado para B2/S3 e teste de restauração | `infrastructure/backup/*`; passo do CI (destino em arquivo) faz backup e restauração; ver [backups](backups.md) |
| Deploy controlado com aprovação manual | `.github/workflows/ci.yml` (inclui a release) e `deploy.yml`; `scripts/install.sh` com backup antes |
| Telas: painel Super Admin e "Plano e domínio" | `apps/web/e2e/platform.spec.ts` (desktop e celular) |

Pendências que dependem de contas e servidores reais (não simulados aqui): bucket real do B2,
DNS real de um cliente, provider HTTP no Traefik existente, as imagens Docker e os dois workflows
rodando no GitHub. Cobrança automática da assinatura fica para depois da escolha do meio de
pagamento; hoje a situação da assinatura é ajustada no painel.

## Etapa 7 — Produção · ✅ entregue nesta PR

Entregue em um PR único, versão **0.6.0** (ver tela Novidades no sistema). Decisões no [ADR 0010](decisions/0010-producao-endurecimento.md).

| Critério de aceitação | Evidência |
| --- | --- |
| Revisão de segurança com achados corrigidos | [segurança](security.md) (S1–S7); `test/security.e2e.test.ts`, `log-redact.test.ts`, teste de bloqueio no painel |
| Dependências sem vulnerabilidade alta/crítica | `pnpm audit --prod` no CI; nenhuma conhecida em 2026-10-22 |
| Testes de carga com números medidos | [carga](load-testing.md): 0 erros em 30.815 requisições, 100 disputas de pagamento sem duplicação, isolamento conferido |
| Gargalo achado e corrigido | lista de pedidos 1,7 s → 9 ms com 1 milhão de pedidos (migração 0009) |
| Testes de restauração | [ensaios](backups.md#ensaios): backup 17 s, restauração 14–41 s com 1 milhão de pedidos; API funcionando no banco restaurado |
| Validação das integrações e do servidor | `scripts/preflight.sh` (antes e `--deployed` depois); exercitado com um Docker simulado |
| Monitoramento com alertas | `infrastructure/monitoring/alerts.yml` + testes do `promtool` no CI |
| Documentação de operação | [operação](operations.md): rotina, incidentes, rotação de segredos, retenção LGPD |

**Para ir ao ar falta o que depende do servidor e das contas reais**, nesta ordem: acesso ao
servidor (Portainer/Traefik), `scripts/preflight.sh`, secrets e `deploy.env`, primeiro deploy pelo
workflow com aprovação, `scripts/preflight.sh --deployed`, bucket B2 real com um backup e um teste
de restauração, NFC-e em homologação com o certificado do primeiro restaurante e o primeiro QR
Code do WhatsApp com um número de teste.
