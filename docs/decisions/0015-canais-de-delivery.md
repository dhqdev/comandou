# ADR 0015 — Aplicativos de delivery: camada comum de canais

- Status: **Aceita (Fase 0 revista em 2026-11-18)**. Cada fase do plano
  ([pesquisa](../delivery-apps-pesquisa.md)) implementa uma parte e atualiza este registro; a
  seção "Andamento" no fim diz o que já está no código.
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

O Open Delivery tem duas versões vivas: a V1 (Keeta, sobre a 1.5.0) e a V2, que exige o Discovery
(`/.well-known/opendelivery`) e escopos no token. O adaptador `opendelivery` fala as duas: na V2 lê
o Discovery do aplicativo ao ligar (e de tempos em tempos) e só chama o que o aplicativo declara; na
V1 usa a configuração do canal. A diferença entre as versões fica num tradutor só.

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

### 2a. Webhooks recebidos

Polling é o caminho principal (iFood, Open Delivery V1/V2 e Keeta oferecem). Quando um canal só
oferece webhook (Rappi) ou o número de lojas pedir, a rota fica em `channels/webhooks`, `@Public()` +
`@SkipCsrf()`, com limite por minuto, na lista revisada do `security-sweep.e2e.test.ts`, e:

| Canal | Cabeçalho | Como confere |
| --- | --- | --- |
| iFood (só app centralizado) | `X-IFood-Signature` | HMAC-SHA256 do corpo cru (bytes) |
| Open Delivery V1 | `X-App-Signature` | HMAC-SHA256 do corpo cru, hexadecimal minúsculo, chave = client secret |
| Keeta | `X-App-Signature` (+ `X-App-Id`, `X-App-MerchantId`) | HMAC-SHA256 em Base64 sobre URL + parâmetros + corpo canonizado (RFC 8785). **Exceção:** o corpo é lido como JSON (com limite) só para canonizar; nada é gravado antes de conferir |
| Rappi | `Rappi-Signature: t=…,sign=…` | HMAC-SHA256 de `t.corpo cru`; `t` velho (mais de 5 min) é recusado |

Sempre em tempo constante (`timingSafeEqual`), antes de gravar qualquer coisa; assinatura errada
ou ausente → 401 sem detalhe; evento repetido cai na chave única da caixa de entrada; resposta
rápida (grava e responde, processa depois).

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
aplicativo, de 2 a 60 caracteres), campos da NT 2020.006 que a Focus já aceita. NFC-e só aceita
`presenca_comprador` 1 ou 4 (rejeição 717): entrega = 4, retirada e no local = 1, os dois com o
intermediador (regras 434/435/438 da NT 2020.006 v1.31). Venda própria passa a mandar
`indicador_intermediario = 0` explícito. Toda NFC-e de entrega leva o endereço (Ajuste SINIEF
9/2026, efeitos desde 03/08/2026). Forma de pagamento
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

| Comandou | iFood (evento) | Open Delivery V1 / Keeta | Open Delivery V2 | Rappi |
| --- | --- | --- | --- | --- |
| `awaiting` (em análise) | `PLACED` (PLC) | `CREATED` | `CREATED` | `CREATED`, `READY`, `SENT` (6 min para aceitar) |
| `new` (aceito) | `CONFIRMED` (CFM), depois do `POST /confirm` | `CONFIRMED`, depois do `POST /orders/{id}/confirm` | `CONFIRMED` (`POST /confirm`, 202) | `TAKEN` (`take` com tempo de preparo) |
| `in_production` | `startPreparation` (o iFood trata como opcional) | `PREPARING` (`POST /preparing`); Keeta: `RECOMMENDED_PREPARATION_START` é só aviso | `PREPARATION_REQUESTED` (aviso), `PREPARING` | (sem estado próprio) |
| `ready` | `READY_TO_PICKUP` (RTP) | `READY_FOR_PICKUP` | `READY_FOR_PICKUP` (`POST /ready-for-pickup`) | `READY_FOR_PICKUP` (automático por padrão) |
| `dispatched` | `DISPATCHED` (DSP), só entrega própria | `DISPATCHED`, `PICKED_UP`, Keeta `ORDER_COLLECTED` | `DISPATCHED`, `ORDER_COLLECTED` (sem `PICKED_UP`) | (entrega pelo Rappi) |
| `completed` | `CONCLUDED` (CON), gerado pelo iFood até 2 h depois da entrega | `DELIVERED`, `CONCLUDED` | `DELIVERED`, `CONCLUDED` | (sem evento próprio) |
| `cancel_requested` | `CANCELLATION_REQUESTED` (CAR) depois do `requestCancellation` (202) | `CANCELLATION_REQUESTED` | `CANCELLATION_REQUESTED` | — |
| volta ao anterior | `CANCELLATION_REQUEST_FAILED` (CARF) | `CANCELLATION_REQUEST_DENIED` | `CANCELLATION_REQUEST_DENIED` | — |
| `cancelled` | `CANCELLED` (CAN) | `CANCELLED` | `CANCELLATION_REQUEST_ACCEPTED`, `CANCELLED` | `REJECTED`, `TIMEOUT`, `ORDER_EVENT_CANCEL` |
| item cancelado (Fase 3) | — | — | `ITEM_CANCELLED` | — |
| negociação aberta (Fase 3) | `CONSUMER_CANCELLATION_REQUESTED` (CCR), `HANDSHAKE_DISPUTE` (HSD) | Keeta: `USER_REFUND_REQUEST` | — | — |
| negociação resolvida | `HANDSHAKE_SETTLEMENT` | `REFUNDED`, `REFUND_FAILED` | — | — |
| entregador do canal (Fase 5) | grupo DELIVERY (`ASSIGN_DRIVER`, `GOING_TO_ORIGIN`…) | `PICKUP_ONGOING`, `RIDER_ARRIVED_AT_STORE` | `PICKUP_ONGOING`, `RIDER_ARRIVED_AT_STORE`, `DELIVERY_ONGOING`, `ARRIVED_AT_CUSTOMER` | — |

O iFood manda `code` (`PLC`) e `fullCode` (`PLACED`) em cada evento: o adaptador aceita os dois.
Evento que nenhuma linha acima cobre é gravado e marcado `ignored` (ack normal).

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

## Decisões de produto (padrões adotados)

O dono pediu para seguir sem esperar OK entre as fases. Onde a pesquisa deixou uma pergunta de
produto, vale o padrão abaixo, que o restaurante muda na tela quando fizer sentido:

| Pergunta | Padrão |
| --- | --- |
| Aceite automático | Desligado. Pedido novo toca até alguém atender e mostra quanto falta para o prazo do canal. Ligado por loja, ele confirma sozinho dentro do prazo. |
| NFC-e viva quando o canal cancela | Cancela a nota sozinho com a justificativa do canal, dentro do prazo da SEFAZ; fora do prazo, avisa na tela. |
| NFC-e de pedido pago no app | Configurável; padrão: emitir ao concluir. Pago na entrega segue a regra de hoje. |
| Horários da loja no canal | Só mostra (Fase 4); sincronizar fica como opção desligada. |
| Responder avaliação pelo Comandou | Fase 8, com proposta antes. |

## Andamento

- **Fase 0** (pesquisa e desenho): feita e revista em 2026-11-18 (Open Delivery V2, assinatura da
  Keeta e da Rappi, regras da NFC-e).
- **Fase 1** (base comum, 0.174.0): migração 0086 e `apps/api/src/integrations/channels/`.
  - **Adaptador** (`channel-adapter.ts`): `poll`, `ack`, `fetchOrder`, `send`; registro em
    `ChannelRegistry`. Chamadas só pela `ChannelHttp` (base fixa do canal, tempo limite, repete só
    rede/429/5xx com espera crescente e o Retry-After, janela de 80% do limite por endpoint).
  - **Pedido normalizado**: `ExternalOrder` em `packages/shared/src/channels.ts`, conferido por Zod
    (`external-order.schema.ts`) antes de entrar.
  - **Entrada única**: `ExternalOrdersService.ingest`/`ingestInTx`, idempotente em (restaurante,
    canal, id externo) com trava por pedido (`pg_advisory_xact_lock`). Cria o pedido por
    `OrdersService.createExternalInTx` (`orders.source = 'app'`, `app_channel`, `external_code`):
    número, histórico, baixa de estoque, cozinha e auditoria iguais aos outros pedidos. Preço do
    aplicativo; desconto pago pelo aplicativo fica em `channel_orders.channel_discount` e não
    reduz o pedido. Item sem vínculo entra no produto técnico "Item de aplicativo (sem vínculo)"
    (`products.system_kind`, inativo e escondido do cardápio) e aparece na tela para ligar
    (`channel_item_links`, vale para os próximos pedidos). Vínculo automático pelo código do
    produto e pelo `CMD-<12 hex>` que o Comandou manda no cardápio.
  - **Caixa de entrada** (`channel_inbox`): grava antes do ack, único por (canal, id do evento);
    trata em ordem por pedido; reserva de 2 min ao pegar (queda no meio volta sozinha); evento de
    pedido desconhecido busca o pedido (no máximo 10 consultas por pedido,
    `channel_order_lookups`); "cancelado/concluído" de pedido que nunca chegou é ignorado; estado só
    para a frente pelos passos da máquina (`channelPath`).
  - **Caixa de saída** (`integration_outbox`): gravada na transação da mudança pelo gancho
    `OrdersService.onTransitionInTx` (só quando a mudança NÃO veio do canal); `SKIP LOCKED`, uma por
    vez por pedido, 4xx não repete, 403 marca a loja como sem autorização, 8 tentativas e "falhou";
    vira "confirmado" quando o evento correspondente chega. Pedido de aplicativo aceito não se
    cancela direto: pede ao aplicativo (`cancel_requested`).
  - **Polling** (`channel-poller.service.ts`): lojas de `channel_store_claims` (banco central, uma
    loja num restaurante só) pela função `app_channel_poll_targets()`; trava por credencial
    (`app_channel_lease`) com intervalo mínimo de 30 s entre réplicas; lotes de 100 lojas; ack só do
    que foi gravado (banco do restaurante em manutenção: sem ack). Varredura a cada 20 s
    (`app_channel_tenants()`).
  - **Credenciais**: Super Admin › Credenciais, `platform_credentials` `channel_<id>` (iFood com o
    .env de reserva; `IfoodService` passou a ler daí).
  - **Métricas e alertas**: `comandou_channel_*` (`channel-metrics.ts`) e o grupo `comandou-canais`
    em `infrastructure/monitoring/alerts.yml` (polling parado é crítico).
  - **Tela**: Sistema › Aplicativos de delivery (`/integracoes`) e o selo do aplicativo
    (`ChannelBadge`) em Pedidos, detalhe, PDV, cozinha e entregas.
  - **Testes**: `test/channels.e2e.test.ts` com o aplicativo falso genérico (`test/fake-channel.ts`).
  - Ficou para a Fase 2: o adaptador do iFood (pedidos), pagamento do aplicativo fora do caixa,
    prazo de aceite na tela e o som do pedido de aplicativo.
- **Fase 2** (pedidos do iFood, 0.176.0): migração 0087 e `apps/api/src/integrations/ifood/`.
  - **Adaptador** `IfoodOrdersAdapter` (`ifood-orders.adapter.ts`): polling com
    `x-polling-merchants`, ack em lotes de até 2.000 ids, `GET /order/v1.0/orders/{id}` e as ações
    `confirm`, `startPreparation`, `readyToPickup`, `dispatch` e `requestCancellation` (com
    `reason` e `cancellationCode`, padrão 509 até a Fase 3 trazer a lista por pedido). "Entregue"
    não existe no iFood (ele conclui com CONCLUDED): a caixa de saída não grava ação que o canal
    não tem (`capabilities`). Token pela `IfoodService.bearer` (o mesmo do cardápio); 401 renova
    uma vez e repete. Caminhos e limites em `IFOOD_PATHS`/`IFOOD_LIMITS` (`ifood-order.ts`).
  - **Tradução** `ifoodToExternal` (pura, testada em `ifood-order.test.ts`): reais → centavos sem
    float; `benefits[].sponsorshipValues` MERCHANT/CHAIN = desconto da loja, o resto = do iFood;
    `payments.methods` → pago no app ou na entrega, com bandeira e troco; prazo de aceite = 8 min
    da criação (agendado: do `preparationStartDateTime`); retirada e no local são entregues pela
    loja.
  - **Lojas**: ligar a loja do iFood (cardápio) também a registra na camada de canais
    (`ChannelStoresService.connect`, credencial `ifood:central` ou `ifood:conn:<id>`); as ligadas
    antes entram ao abrir a tela (`ChannelStoresService.sync` → `IfoodService.ensureChannelStores`).
  - **Dinheiro** (§7): pagamento `payments.method = 'app'` sem sessão nem movimento de caixa
    (fora do esperado da gaveta), com `app_channel`, `app_method` (forma real, usada na NFC-e) e
    `app_brand`. Valor = total do Comandou − o que o cliente paga na entrega (pago online + cupom
    do aplicativo). Cancelamento (do canal ou recusa) zera esses pagamentos
    (`OrdersService.voidAppPaymentsInTx`, sem `payment_refunds`); estorno de `app` no caixa é
    recusado. Ainda sem sessão de caixa para o fechamento mostrar "pago no app" (Fase 7).
  - **Pedido de aplicativo travado**: desconto/acréscimo, troca e cancelamento de item, fiado e
    estorno de pagamento do app respondem 409.
  - **Telas**: prazo de aceite (`AcceptDeadline`) no PDV e no pedido; som `app_order` repetindo
    enquanto houver pedido de aplicativo em análise; "cancelamento solicitado" de pedido de
    aplicativo não toca o som de cancelamento (foi o restaurante que pediu); no pedido, forma e
    bandeira, troco a levar, cupom e quem paga, código de retirada e CPF/CNPJ.
  - **Testes**: `test/ifood-orders.e2e.test.ts` com o iFood falso (`test/fake-ifood.ts`).
  - Fica para depois: lista de motivos de cancelamento e negociação (Fase 3), situação e pausa da
    loja (Fase 4), rastreio do entregador (Fase 5), NFC-e com intermediador (próxima fase) e conferir os
    caminhos e o corpo de `requestCancellation` no sandbox do iFood (o portal está bloqueado na
    rede deste ambiente).
- **Fase 3** (cancelamento e negociação, 0.179.0): migração 0089 e `channel-disputes.service.ts`.
  - **Motivo do cancelamento**: `GET /channels/orders/:id/cancel-reasons` busca a lista do pedido no
    canal (`ChannelAdapter.cancellationReasons`; iFood `/cancellationReasons`, com a lista padrão
    501–513 se falhar). O código escolhido vai em `channelReason` no `POST /orders/:id/status` e
    chega ao canal como `cancellationCode` (só `[A-Za-z0-9_-]{1,40}`).
  - **Cancelamento negado** (`order.cancellation_denied`, iFood CARF): o pedido sai de
    "Cancelamento solicitado" e volta ao estado de antes (último `order_status_history` que entrou
    em `cancel_requested`), com a nota "cancelamento negado". Já cancelado aqui: só avisa.
  - **Negociação** (`order.dispute`, iFood HANDSHAKE_DISPUTE): o adaptador guarda só o necessário
    em `payload.dispute` (tipo, mensagem do cliente, prazo, o que acontece sem resposta,
    alternativas e motivos; nada de fotos) e a caixa de entrada grava em `channel_disputes`
    (repetida atualiza enquanto aberta). A resposta é SEMPRE de uma pessoa (o iFood recomenda não
    automatizar): `POST /channels/disputes/:id/decision` (`orders:manage`) confere prazo e o que o
    canal ofereceu (valor até o máximo, minutos e motivos da lista) e manda pela caixa de saída
    (`dispute_accept`, `dispute_reject`, `dispute_alternative`, uma por negociação).
    HANDSHAKE_SETTLEMENT fecha como "resolvido" e confirma a ação.
  - **Telas**: na gaveta do pedido, o cartão da negociação com o prazo e Aceitar, Recusar e as
    propostas; pedido de aplicativo cancela com "Pedir cancelamento" (lista de motivos do canal) e
    não tem "Aprovar cancelamento". No PDV, "Responda ao cliente em N min" e o som de cancelamento
    repetindo até alguém responder (`appDisputeUntil` no pedido).
  - **Testes**: 5 novos em `test/ifood-orders.e2e.test.ts` e 2 em `ifood-order.test.ts`.
  - Fica para depois: conferir no sandbox do iFood os nomes exatos dos campos da negociação
    (`ifoodDispute` tolera as variações conhecidas) e cancelar parte dos itens no Comandou quando o
    restaurante aceita um cancelamento parcial (hoje o iFood ajusta o repasse; o pedido aqui fica
    como estava).
