# ADR 0015 — Aplicativos de delivery: camada comum de canais

- Status: **Proposta (Fase 0, 2026-11-18)**. Nada disto está no código ainda; cada fase do plano
  ([pesquisa](../delivery-apps-pesquisa.md)) implementa uma parte e atualiza este registro.
- Contexto anterior: o iFood hoje só recebe o cardápio (`apps/api/src/integrations/ifood/`,
  migração 0049). Nenhum pedido de aplicativo entra no Comandou.

## Contexto

Os restaurantes querem que os pedidos do iFood, da 99Food, da Keeta, da Rappi e de outros
aplicativos cheguem sozinhos e sigam o ciclo inteiro dentro do Comandou (PDV, cozinha, impressão,
entrega, caixa, estoque, nota, cancelamento, negociação, loja, cardápio e repasses), sem abrir o
gestor de cada aplicativo. Cada aplicativo tem um jeito de entregar eventos (polling, webhook ou os
dois), prazos próprios para aceitar e regras de bloqueio (o iFood bloqueia o aplicativo inteiro, e
não só a loja, por uso indevido). A documentação de cada canal, com links, está em
[`docs/delivery-apps-pesquisa.md`](../delivery-apps-pesquisa.md).

## Decisão

### 1. Uma camada comum, um adaptador por canal

`apps/api/src/integrations/channels/` concentra tudo o que não é específico de um aplicativo:
caixa de entrada, caixa de saída, polling com trava, ingestão, métricas e telas. Cada aplicativo é
um adaptador (`channels/adapters/ifood`, `opendelivery`, `keeta`, `rappi`…) que implementa só o
que o canal tem, pelo contrato abaixo. O que o canal não tem aparece na tela como "o <canal> não
oferece isso", nunca escondido.

```ts
interface ChannelAdapter {
  channel: ChannelId;                       // 'ifood' | 'keeta' | '99food' | 'rappi' | 'aiqfome' | `od:${string}`
  capabilities: Set<Capability>;            // o que existe neste canal (mostrado na tela)
  connect / disconnect;                     // ligar e desligar a loja
  poll?(batch): ExternalEvent[];            // polling (iFood, Open Delivery, Rappi)
  verifyWebhook?(rawBody, headers): boolean // webhook (assinatura em tempo constante, corpo cru)
  ack?(eventIds);                           // acknowledgment
  orderDetails(externalId): NormalizedOrder;
  confirm / reject(reason) / startPreparation / ready / dispatch / delivered;
  cancellationReasons? / requestCancellation?(reason);
  answerDispute?(id, 'accept' | 'reject' | { alternative });
  tracking?; storeStatus? / pause? / resume? / openingHours?;
  pushMenu? / setAvailability?; reviews?; settlements?;
}
```

### 2. Pedido normalizado (`packages/shared/src/channel-order.ts`)

Um tipo só para todos os canais, validado por Zod na entrada do adaptador:

- **Origem:** canal, id externo, código curto para falar com o cliente (`displayId` no iFood),
  loja (id externo + conexão).
- **Tipo e prazo:** `delivery | takeout | dine_in`; `immediate | scheduled` e para quando
  (início do preparo e horário de entrega/retirada).
- **Quem entrega:** `merchant | channel`.
- **Cliente:** nome, telefone (como vier: mascarado, localizador ou cifrado), documento para a nota.
- **Endereço:** texto, complemento, referência e coordenadas.
- **Itens:** id e código externos, nome, quantidade, unidade, preço unitário cobrado, complementos
  (também com preço), observação, e o vínculo com o cardápio do Comandou quando houver.
- **Valores (string decimal, nunca float):** subtotal, descontos separados por quem paga
  (`channel` ou `merchant`) e por alvo (itens ou entrega), taxa de entrega, taxas de serviço e total.
- **Pagamento:** pago no aplicativo × na entrega, forma (crédito, débito, pix, vale, dinheiro…),
  bandeira, troco para, CPF/CNPJ na nota.
- **Prazos do canal:** confirmar até, preparar a partir de, entregar até.
- **Bruto:** o JSON original fica só na caixa de entrada (ver 3), nunca no log.

### 3. Caixa de entrada (por restaurante): `channel_inbox`

- Cada evento é gravado cru com chave única `(tenant_id, channel, external_event_id)`: evento
  repetido é ignorado (`ON CONFLICT DO NOTHING`).
- **O acknowledgment só sai depois do COMMIT** no banco do restaurante. Banco do restaurante em
  manutenção (`tenant_databases` fora de `ready`) → aquele evento não recebe ack e volta no próximo
  polling.
- Processamento separado, por pedido e em ordem de `createdAt` do canal (o iFood avisa que pode
  entregar fora de ordem), com `pg_advisory_xact_lock` por `(canal, pedido externo)`. Evento de
  pedido que ainda não buscamos (ex.: `CANCELLED` antes do `PLACED` processado) fica guardado e é
  aplicado quando o pedido nascer.
- Evento com código desconhecido: ack e `ignored` (a documentação pede para não travar).
- Limpeza: o JSON bruto sai em 90 dias pela `app_purge_expired()` (a linha fica, sem o corpo).

### 4. Caixa de saída (por restaurante): `integration_outbox`

Não existe outbox genérico hoje (só `message_outbox` do WhatsApp e `mail_outbox` do e-mail). Este
cria a base genérica, com `target` (o canal):

- Gravada **na mesma transação** da mudança no Comandou (confirmar, pronto, despachar, cancelar,
  responder negociação). Desfez a transação, a ação some junto.
- Consumidor com `FOR UPDATE SKIP LOCKED`, chave de idempotência única por ação e pedido, novas
  tentativas com espera crescente em 5xx, 429 e rede; **nunca repete em 4xx**; 401 renova o token
  uma vez e tenta de novo uma vez; 403 marca a loja como desligada e avisa.
- A tela mostra "enviando…", "enviado" (202) e "confirmado" (quando o evento do canal chega) ou
  "falhou: motivo".

### 5. Polling com trava

- **Uma réplica por credencial:** lease no banco central (`channel_poll_leases`, `UPDATE … WHERE
  lease_until < now() OR holder = $me`, renovado a cada ciclo, 90 s de validade). Outra réplica
  assume sozinha se a primeira cair.
- **Lojas:** saem de `channel_store_claims` (banco central; generaliza `ifood_merchant_claims`),
  só as com recebimento de pedidos ligado, em lotes de até 100 (`x-polling-merchants`), cada lote a
  cada 30 s, **nunca menos**. Modo distribuído do iFood: um token por loja, um polling por token.
- **Atenção à presença:** no iFood cada polling conta como "loja online" para as lojas do lote.
  Por isso só entram no polling as lojas que o restaurante deixou ligadas, e pausar no Comandou cria
  uma interrupção no iFood (Fase 4).
- Os dois modos do iFood (centralizado e distribuído) continuam valendo.

### 6. Ingestão única: `ExternalOrdersService.ingest`

- Único caminho que cria pedido de aplicativo; idempotente por `(tenant_id, channel, external_id)`.
- Usa o mesmo núcleo do `OrdersService` (número, cozinha, impressão automática, estoque, tempo
  real), com a **exceção documentada de preço**: no pedido de aplicativo vale o preço que o
  aplicativo cobrou. A diferença para o preço do cardápio é guardada (`channel_order_items.menu_price`).
- **Nunca recusa por item sem vínculo:** o item entra com nome e preço do aplicativo no produto
  técnico "Item do aplicativo" (um por restaurante, sem ficha técnica), marcado `unlinked`, e vai
  para a tela de vínculos. O vínculo (`channel_item_links`) vale para os próximos pedidos.
- Pedido de aplicativo não é editável no Comandou (itens e valores mandam no canal); observação
  interna pode.

### 7. Dinheiro

- **Pago no aplicativo não é dinheiro do caixa.** Vira um pagamento com forma nova `app` e
  `app_channel`, sem `cash_movements` (portanto fora do "esperado" da gaveta), ligado à sessão
  aberta só para aparecer no fechamento como "iFood (pago no app)". Sem caixa aberto, fica sem
  sessão (permitido só para `app`). O DRE continua lendo a receita pelos pagamentos, por canal.
- **Repasse** em tabela própria (`channel_receivables`, um por pedido pago no app): valor bruto,
  comissão e taxas (preenchidas pela API financeira na Fase 7), líquido e data prevista. Não entra
  em `finance_settlements` (que depende de sessão de caixa e da lista fixa de formas) nem vira conta
  a receber em `finance_entries` (o DRE já deixa repasse de vendas fora, para não contar duas vezes).
  A conciliação bancária ganha a origem `channel_receivables`.
- **Pago na entrega** (dinheiro com troco, maquininha do entregador ou do balcão): pagamento normal
  no caixa, como hoje.
- **Desconto:** o pago pelo aplicativo não reduz a receita do restaurante (vira parte do repasse);
  o pago pelo restaurante entra como desconto do pedido.

### 8. Nota fiscal

NFC-e de pedido de aplicativo leva `indicador_intermediario = 1`, `cnpj_intermediario` (CNPJ do
aplicativo, cadastrado por canal no Super Admin) e `id_intermediario` (identificação da loja no
aplicativo, até 60 caracteres), campos da NT 2020.006 que a Focus já aceita. Forma de pagamento
real (crédito, débito, pix, vale), nunca "99 outros". Uma nota viva por pedido, como hoje.
Quando emitir (pago no app × na entrega) é configuração do restaurante, com padrão ao concluir.

### 9. Quem vence quando os dois lados mudam

| Situação | Vence | Como |
| --- | --- | --- |
| Cancelamento vindo do canal (cliente, aplicativo ou prazo vencido) | Canal | Cancela no Comandou, devolve estoque, estorna o que precisar no caixa e, com NFC-e viva, abre o cancelamento da nota (ou avisa se passou do prazo da SEFAZ). |
| Itens, preços e valores | Canal | Pedido de aplicativo não é editado no Comandou. |
| Andamento (preparo, pronto, saiu, concluído) | Quem chegar primeiro, só para a frente | O estado nunca volta; evento do canal atrasado não desfaz o que o Comandou já fez, e ação do Comandou recusada pelo canal fica "falhou" na tela. |
| Ação do Comandou que o canal recusa (4xx) | Canal | O pedido fica como o canal diz; a tela mostra a divergência e o motivo. |
| Cardápio | Comandou | Edição no portal do aplicativo é detectada e avisada (Fase 6). |

### 10. Saúde

Métricas Prometheus por canal, sem restaurante nos rótulos: atraso do polling (último sucesso),
último evento, taxa de ack (acks ÷ pollings com evento), erros por endpoint, consultas por pedido e
ações presas no outbox. Alertas em `infrastructure/monitoring/alerts.yml` com teste do promtool;
o principal é **polling parado** (a loja some do iFood), depois taxa de erro perto de 1% e ack
abaixo de 98% (o limite do iFood é 95%).

## Tabela de estados

| Comandou | iFood (evento) | Open Delivery / Keeta | Rappi |
| --- | --- | --- | --- |
| `awaiting` (em análise) | `PLACED` (PLC) | `CREATED` | `CREATED`, `READY`, `SENT` (6 min para aceitar) |
| `new` (aceito) | `CONFIRMED` (CFM), depois do `POST /confirm` | `CONFIRMED`, depois do `POST /orders/{id}/confirm` | `TAKEN` (`take` com tempo de preparo) |
| `in_production` | `startPreparation` (o iFood trata como opcional) | `PREPARING` (`POST /preparing`) | (sem estado próprio) |
| `ready` | `READY_TO_PICKUP` (RTP) | `READY_FOR_PICKUP` | `READY_FOR_PICKUP` (automático por padrão) |
| `dispatched` | `DISPATCHED` (DSP), só entrega própria | `DISPATCHED`, `PICKED_UP` (entregador pegou) | (entrega pelo Rappi) |
| `completed` | `CONCLUDED` (CON), gerado pelo iFood até 2 h depois da entrega | `DELIVERED`, `CONCLUDED` | (sem evento próprio) |
| `cancel_requested` | `CANCELLATION_REQUESTED` (CAR) depois do `requestCancellation` (202) | `CANCELLATION_REQUESTED` | — |
| volta ao anterior | `CANCELLATION_REQUEST_FAILED` (CARF) | `CANCELLATION_REQUEST_DENIED` | — |
| `cancelled` | `CANCELLED` (CAN) | `CANCELLED` | `REJECTED`, `TIMEOUT`, `ORDER_EVENT_CANCEL` |
| negociação aberta (Fase 3) | `CONSUMER_CANCELLATION_REQUESTED` (CCR), `HANDSHAKE_DISPUTE` (HSD) | Keeta: `USER_REFUND_REQUEST` | — |
| negociação resolvida | `HANDSHAKE_SETTLEMENT` | `REFUNDED`, `REFUND_FAILED` | — |

## Modelo de dados (resumo; detalhe por fase no plano)

**Banco central:** `channel_store_claims` (canal + loja externa → restaurante; uma loja nunca fica
em dois restaurantes), `channel_poll_leases` (quem faz o polling de cada credencial),
`channel_api_stats` (requisições e erros por canal, endpoint e hora, para a tela de uso indevido) e
credenciais dos aplicativos em `platform_credentials` (cifradas; env como reserva).

**Banco do restaurante (todas com `tenant_id`, RLS e FKs compostas):** `channel_connections`
(generaliza `ifood_connections`, preservando os ids para o token cifrado continuar abrindo),
`channel_inbox`, `integration_outbox`, `channel_orders` (vínculo pedido ↔ canal: id externo,
código curto, situação no canal, quem entrega, agendamento, código de retirada, consultas feitas),
`channel_order_items` (preço do aplicativo × do cardápio, sem vínculo), `channel_item_links`,
`channel_disputes` (Fase 3) e `channel_receivables` (Fase 7). Em `orders`: `source` ganha `app`,
mais `app_channel`, `external_code`, `delivered_by` e `scheduled_for`, para listar, filtrar,
imprimir e mostrar o selo sem juntar tabelas. Em `payments`: forma `app`, `app_channel` e
`cash_session_id` opcional só para `app`.

## Consequências

- Um canal novo que fale Open Delivery vira configuração (endereço, credenciais e CNPJ), sem
  código novo.
- Mais tabelas por restaurante e um processo de polling que precisa estar sempre vivo: o alerta de
  polling parado passa a ser crítico.
- O iFood pode bloquear o aplicativo inteiro do Comandou: as travas (30 s, ≤ 10 consultas por
  pedido, ack depois de gravar, sem repetir 4xx) e as métricas são obrigatórias, não opcionais.
- `payments` e `orders` ganham colunas e uma forma nova; relatórios e fechamento de caixa precisam
  tratar `app` (fora do esperado da gaveta).
- `ifood_connections` e `ifood_merchant_claims` deixam de ser escritas depois da Fase 1 (dados
  copiados para as tabelas genéricas); a remoção fica para um ADR futuro.
