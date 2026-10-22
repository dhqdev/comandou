# Arquitetura

## Visão geral

**Monólito modular** (sem microserviços prematuros), multi-tenant em **PostgreSQL compartilhado** com `tenant_id` + **Row-Level Security** + autorização no backend.

```
<slug>.comandou.com ──► Traefik ──┬─ PathPrefix(/api) ─► NestJS (apps/api) ─► PostgreSQL (rede interna)
                                  └─ demais caminhos ─► Nginx (SPA React, apps/web)
```

- API servida **no mesmo domínio** do restaurante sob `/api` → sem CORS, cookie de sessão host-only.
- Nginx serve apenas arquivos estáticos. Nada de dados de restaurante passa por ele ou é cacheado.
- PostgreSQL (e futuramente Redis) somente em rede interna (`internal: true`).

## Monorepo

| Pacote | Responsabilidade |
| --- | --- |
| `apps/api` | NestJS 11 (Express), Drizzle ORM, migrações SQL, provisionamento |
| `apps/web` | React 19 + Vite 7, Design System, PWA |
| `packages/shared` | Regras puras compartilhadas: dinheiro, slug, papéis/permissões |
| `apps/worker`, `apps/whatsapp-service`, `packages/ui`, `packages/contracts` | **Ainda não criados.** Entram quando houver código real (filas na Etapa 3+, WhatsApp na Etapa 5) |

## Módulos do backend (estado atual)

| Módulo | Estado | Notas |
| --- | --- | --- |
| `config` | ✅ | validação de ambiente com zod; segredos via `*_FILE` |
| `database` | ✅ | pool `pedemais_app`, `withTenant()`, migrador SQL |
| `tenancy` | ✅ | classificação do Host, resolução via função `SECURITY DEFINER` |
| `auth` | ✅ | login, sessão opaca, logout/revogação, rate limit |
| `roles/permissions` | ✅ (padrão) | permissões por papel em `packages/shared`; configuração por tenant na Etapa 6 |
| `audit` | ✅ | gravação na mesma transação; app só faz INSERT/SELECT |
| `catalog` | ✅ | categorias, produtos, adicionais/variações, cardápio consolidado (`GET /menu`) |
| `orders` | ✅ | pedidos, estados, histórico, descontos/acréscimos, transferência entre comandas |
| `tables` (salão) | ✅ | comandas, transferência de mesa, pagamento dividido, fechamento de conta |
| `kitchen` | ✅ | fila por setor, avanço por item/pedido, reabertura auditada |
| `cash` + pagamentos | ✅ | sessões por terminal, livro-razão imutável, estornos, fechamento conferido |
| `reports` | ✅ (vendas) | faturamento × recebimentos, por canal, mais vendidos |
| `realtime` | ✅ | Socket.IO em `/api/ws`, sala por tenant, adapter Redis opcional (`REDIS_URL`) |
| `setup` | ✅ | setores de produção, mesas, terminais de caixa |
| `provisioning` | ✅ | idempotente e retomável; CLI e painel Super Admin, com plano |
| `platform` | ✅ | painel Super Admin em `admin.<base>`, papel `pedemais_platform`, senha + TOTP, auditoria própria |
| `plans` | ✅ | planos, assinaturas, limites e recursos por plano |
| `domains` | ✅ | domínio próprio com verificação TXT; provider HTTP do Traefik |
| `health` | ✅ | `live`, `ready` (banco, Redis, WhatsApp) e métricas Prometheus (inclui idade do último backup) |
| `maintenance` | ✅ | limpeza periódica de dados vencidos pela função `app_purge_expired()` |
| demais | ⏳ | ver [roadmap](roadmap.md) |

Ordem dos guards globais: **Throttler → CSRF → Tenant → Sessão → Permissão**.

## Estratégia multi-tenant

Decisão: [ADR 0003](decisions/0003-multi-tenant-rls.md).

1. **Identificação**: `Host` → `<slug>.<base>` ou domínio personalizado **verificado**. Host malformado → 400; desconhecido → 404; tenant não `provisioned` → 403. `X-Forwarded-Host` só é aceito com `TRUST_PROXY=true` (atrás do Traefik).
2. **Autorização**: a sessão é buscada **com RLS do tenant resolvido**. Um cookie emitido para A não existe quando a requisição chega pelo host de B. O cookie não tem `Domain`, então o navegador nem o envia para outros subdomínios.
3. **Banco**: todas as tabelas de negócio têm `tenant_id` e política `tenant_id = app_current_tenant()`. O contexto é definido por `set_config('app.tenant_id', $1, true)` **dentro da transação**; ao fim (COMMIT/ROLLBACK) o valor some, então conexões reutilizadas no pool não herdam contexto. Sem contexto, nenhuma linha é visível.
4. **Papéis**:
   - `pedemais_owner`: dono das tabelas. Usado **só** por migrações e provisionamento.
   - `pedemais_app`: usado pela API. Não é dono, não é superusuário, **NOBYPASSRLS**, sem `DELETE` em lugar nenhum, sem `UPDATE` em auditoria.
   - Não usamos `FORCE ROW LEVEL SECURITY` porque o dono precisa enxergar tudo nas operações globais e nas duas funções `SECURITY DEFINER` (resolução de host e busca de login), que são estreitas e retornam só o necessário.
5. **Integridade**: chaves únicas `(tenant_id, id)` e FKs compostas. Um item de pedido de A não referencia produto de B **nem que a aplicação falhe** (testado inclusive com o dono, que ignora RLS).
6. **Nunca** se aceita `tenant_id` do cliente: os DTOs não têm o campo e o valor vem do contexto.

### Limites e migração futura para banco dedicado

- Custo inicial baixo, um só backup e uma só migração. Risco: "vizinho barulhento" e raio de impacto compartilhado.
- Critérios para migrar um tenant para banco dedicado: volume > ~5% da carga total, exigência contratual/regulatória de isolamento físico, ou necessidade de janela de manutenção própria.
- Como o código só acessa dados via `withTenant()` e o tenant é resolvido por uma função, um futuro roteamento "tenant → string de conexão" fica concentrado em `DatabaseService`. **Não implementado** (não há necessidade hoje).

## Modelo de dados (implementado)

| Entidade | Escopo | RLS | Observação |
| --- | --- | --- | --- |
| `tenants` | global | sim (vê só o próprio) | status: requested, provisioning, provisioned, failed, recovering, suspended |
| `tenant_domains` | tenant | sim | domínio personalizado só vale com `verified_at` |
| `tenant_provisioning_steps` | tenant | sim (app só lê) | etapas, tentativas, último erro |
| `users` | global | sim (só membros do tenant atual) | e-mail único (citext); hash scrypt |
| `memberships` | tenant | sim | usuário × tenant × papel |
| `sessions` | tenant | sim | só o SHA-256 do token; expiração e revogação |
| `audit_log` | tenant | sim | somente inserção para a app |
| `categories`, `products` | tenant | sim | preço `NUMERIC(14,2)` |
| `orders`, `order_items`, `order_item_options` | tenant | sim | preço e nome congelados no item; `total = subtotal − desconto + acréscimo + entrega` (CHECK) |
| `order_status_history` | tenant | sim (só INSERT) | quem mudou, de/para, motivo |
| `option_groups`, `options`, `product_option_groups` | tenant | sim | variação = grupo com mín = máx = 1 |
| `production_sectors` | tenant | sim | canais atendidos, minutos de aviso/atraso |
| `dining_tables`, `tabs` | tenant | sim | no máximo uma comanda aberta por mesa (índice único parcial) |
| `cash_registers`, `cash_sessions` | tenant | sim | no máximo uma sessão aberta por terminal |
| `payments`, `payment_refunds`, `cash_movements` | tenant | sim (sem UPDATE/DELETE; só `refunded_amount` é atualizável) | livro-razão com sinal; estorno nunca apaga |
| `idempotency_keys` | tenant | sim | chave + hash do corpo + resposta |
| `tenant_counters` | tenant | sim | numeração de pedidos, comandas e sessões |
| `schema_migrations` | global | n/a | controle do migrador (só dono) |

Entidades planejadas por etapa (unidade, plano, assinatura, mesa, comanda, caixa, pagamento, estoque, entrega, fiscal, impressão, WhatsApp) estão no [roadmap](roadmap.md). Unidade (filial) entrará como `unit_id` + FK composta `(tenant_id, unit_id)` quando o primeiro cliente multiunidade exigir.

## Operação (Etapa 3)

Decisão: [ADR 0006](decisions/0006-operacao-pedidos-caixa.md).

- **Pedido**: preço e opções sempre do banco. Estados em `packages/shared/orders.ts` (`canTransition`). `payment_status` (a pagar/parcial/pago) é independente do status operacional.
- **Idempotência**: `POST /orders` aceita `Idempotency-Key`; pagamentos, estornos, sangria/suprimento e fechamento **exigem**. A chave é gravada na mesma transação da operação, com o hash do corpo: repetir devolve a mesma resposta; corpo diferente → 422; falha → nada fica gravado.
- **Travas** (sempre nesta ordem, para não haver deadlock): sessão de caixa (`FOR SHARE` em vendas/estornos, `FOR UPDATE` em sangria/suprimento/fechamento) → comanda → pedidos (por data, id) → pagamento.
- **Caixa**: cada venda, suprimento, sangria e estorno é um movimento com sinal. Esperado por forma de pagamento = soma dos movimentos. Fechamento grava esperado, contado e diferença; com diferença, observação é obrigatória.
- **Tempo real**: eventos são só avisos ("pedido X mudou") publicados depois do COMMIT; a tela busca o estado pela API e recarrega tudo ao reconectar. Evento recebido não prova persistência.

## Dinheiro

- Banco: `NUMERIC(14,2)`; API: string decimal (`"12.90"`); memória: centavos inteiros (`packages/shared/money.ts`). Nunca `float`.
- Moeda: `tenants.currency` (padrão BRL). Arredondamento half-even somente quando houver fração de centavo (ex.: quantidade × preço).

## Autenticação e sessão

Decisão: [ADR 0004](decisions/0004-sessoes-opacas-cookie.md). Token aleatório de 256 bits em cookie `HttpOnly; SameSite=Lax; Secure` (produção), sem `Domain`. Banco guarda apenas o hash. Logout revoga no servidor. Escritas exigem o cabeçalho `X-PedeMais-Request: 1` e, se houver `Origin`, ele deve ser o próprio host. Login: 5 tentativas/minuto por IP (configurável), auditoria de falhas e tempo constante para e-mails inexistentes.

## Frontend e PWA

- Design System próprio em `apps/web/src/design-system` (tokens CSS, tema claro/escuro, componentes acessíveis, alvo de toque de 44 px).
- PWA: manifest, ícones, service worker gerado (Workbox) com cache **somente** de assets estáticos; `/api` é `NetworkOnly`. Atualização por aviso ("Nova versão disponível"), sem recarregar no meio de uma venda.
- Offline: banner + bloqueio de operações críticas. Nada é exibido como confirmado antes da resposta do backend (ex.: "Esgotar" só muda após o PATCH retornar).

## Observabilidade

Logs JSON (pino) com `tenant` em cada requisição; `cookie`, `authorization` e `set-cookie` são removidos dos logs. Health: `/api/v1/health/live` e `/api/v1/health/ready`.

## Rede e implantação

Ver [deploy.md](deploy.md) e [development.md](development.md).
