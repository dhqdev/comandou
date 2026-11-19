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
| Responder avaliação pelo Comandou | Sim, sempre escrita por uma pessoa (Fase 8). Chat sem API; promoções ficam no portal. |

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
- **Fase 4** (loja aberta, fechada ou pausada, 0.180.0): migração 0090 e
  `channel-store-state.service.ts`.
  - **Contrato**: `ChannelAdapter.storeStatus`, `pauseStore`, `resumeStore`, `openingHours` e
    `maxPauseMinutes` (opcionais). iFood: `GET /merchants/{id}/status` (a operação DELIVERY manda;
    OK/WARNING/CLOSED/ERROR) + `GET /interruptions` (pausa valendo agora), `POST /interruptions`
    `{id, description, start, end}` e `DELETE /interruptions/{id}` (404 = já não existe), horários em
    `GET /opening-hours`. Tradução pura em `ifood-merchant.ts`.
  - **Com calma** (o iFood mede a taxa de erro do status): a tela lê de novo só o que passou de 1
    minuto (no máximo 3 s de espera), a varredura a cada 5 minutos por loja, horários a cada 6
    horas; falha não repete, só guarda `state_error`.
  - **Pausa**: "Pausar no iFood" (15 min a "até eu reabrir" = 7 dias, o máximo do iFood) com motivo,
    só no aplicativo. "Loja fechada" no PDV pausa as lojas com `follow_store_open` (padrão ligado) e
    "Loja aberta" tira só a pausa que o Comandou fez (`pause_by_store`); pausa feita no portal
    aparece, mas não é mexida. O gancho é `StoreService.onOpenChanged` e roda depois de gravar,
    sem segurar a resposta.
  - **Telas**: em Aplicativos de delivery, a situação de cada loja (bolinha, frase do iFood, pausa e
    horários), Pausar/Reabrir e "Fechar junto com a loja do Comandou"; no PDV, uma pílula por loja ao
    lado do "Loja aberta" (`GET /channels/stores/state`).
  - **Testes**: 5 novos em `test/ifood-orders.e2e.test.ts`, 3 em `ifood-merchant.test.ts`.
  - Fica para depois: mandar os horários do Comandou para o iFood (padrão do ADR: só mostrar) e
    conferir no sandbox o formato de data aceito no `start`/`end` da interrupção (mandamos ISO em
    UTC).
- **Fase 5** (entrega, 0.184.0): migração 0092 e `channel-drivers.service.ts`.
  - **Entregador do aplicativo**: eventos de entrega (`delivery.update`; iFood ADR, GTO, AAO, CLT,
    AAD, RDS, RDF) viram `channel_orders.driver_status` pela caixa de entrada, só para a frente
    (`driverMovesForward`); evento atrasado não volta a situação, mas o nome e o veículo dele
    valem. Guardamos só o primeiro nome e o veículo (nada de telefone, foto ou documento) e
    `app_purge_expired` apaga os dois 30 dias depois (`channelDrivers`). Entregador de pedido que
    não está aqui: ack e ignorado. Não mexe em `channel_status` do pedido.
  - **Rastreio**: `GET /channels/orders/:id/driver` (`orders:write`) lê `GET /orders/{id}/tracking`
    do iFood no máximo a cada 30 s por pedido (`tracking_at`; falha também conta) e guarda só as
    previsões (chegada na loja e no cliente), nunca a posição. Tradução pura em
    `ifood-delivery.ts`.
  - **Entrega da loja**: "Saiu para entrega" e "Entregue" do fluxo de Entregas já avisam o canal
    (`actionForTransition` com `delivered_by = 'merchant'`). Pedido que o entregador do aplicativo
    leva (ou com entregador do aplicativo chamado) não sai com o motoboy da loja: `dispatch` responde
    409 e ele não aparece em "Disponíveis" do app do entregador.
  - **Chamar entregador do aplicativo** (iFood Sob Demanda, `orders:manage`): `POST .../driver/quote`
    (`GET /shipping/v1.0/orders/{id}/deliveryAvailabilities`) guarda a cotação no servidor;
    `POST .../driver {quoteId}` só aceita a cotação guardada e ainda válida e chama `requestDriver`
    (a taxa gravada é a da cotação, nunca a da tela); `POST .../driver/cancel` manda
    `cancelRequestDriver` com o motivo (lista em `.../driver/cancel-reasons`). Uma chamada por
    clique (nada se repete sozinho); 403 vira "o Sob Demanda não está liberado para esta loja".
  - **Telas**: na gaveta do pedido de aplicativo com entrega, o cartão do entregador (situação,
    nome e veículo, previsão, código de coleta em destaque, taxa) com "Chamar entregador do iFood"
    (mostra o valor e o tempo antes de confirmar) e "Cancelar entregador". No PDV, a bolinha com a
    situação do entregador e sem o atalho de despachar; em Entregas, "Quem leva é o entregador do
    iFood" no lugar da escolha do motoboy (`appDriverStatus` no pedido).
  - **Testes**: 3 novos em `test/ifood-orders.e2e.test.ts` e 3 em `ifood-delivery.test.ts`.
  - Fica para depois: conferir no sandbox os caminhos e corpos do Sob Demanda (`shipping/v1.0`), as
    unidades do rastreio e o nome dos campos do entregador no ADR (`workerName`,
    `workerVehicleType`); mapa com a posição do entregador do aplicativo (hoje só a previsão).
- **Fase 6** (cardápio, 0.185.0): migração 0093 e `ifood/ifood-catalog.service.ts`.
  - **Disponibilidade pelo estoque**: o envio ao iFood usa a mesma regra do PDV (esgotado à mão OU
    sem estoque pela ficha técnica, `PRODUCT_STOCK_OUT`). A cada `stock.changed` (juntando 3 s por
    restaurante) o Comandou confere no banco se algum item do cardápio do iFood ativo ficou com a
    disponibilidade diferente da que foi mandada e, só então, agenda o envio (`stockChanged`).
  - **Conferência com o portal**: lê o cardápio do iFood (`GET /catalogs`, `GET
    /catalogs/{id}/categories` e `GET /categories/{id}/items`, formato normalizado) e compara com o
    `ifood_sync_map`: preço pela mesma impressão do envio (`offerHashOf`), disponibilidade,
    nome e item apagado lá. O resultado fica em `menus.ifood_drift` (e `ifood_drift_at`,
    `ifood_drift_error`); a varredura dos canais (`ChannelPoller.onSweep`) confere cada cardápio
    ativo a cada 30 minutos, a tela lê de novo se passou de 10 e "Conferir agora" no máximo uma
    vez por minuto. Durante o envio não confere. Tradução pura em `ifood-catalog-read.ts`.
  - **Quem vence** (§9): o Comandou. "Mandar o do Comandou" (`POST /ifood/menus/:id/drift/resend`)
    limpa as impressões dos itens mudados (vão inteiros no próximo envio) e apaga o vínculo do
    item apagado lá (é criado de novo); nada do portal muda o Comandou sem uma pessoa pedir.
  - **Trazer do iFood** (`POST /ifood/menus/:id/import`, `catalog:write`): só itens da última
    conferência (lida pelo servidor, nunca da tela). Categoria pelo nome (ou nova), produto com o
    preço e a descrição do iFood, complementos como grupos e opções (pausados no iFood entram
    inativos), entra nos cardápios Principal/Delivery e neste do iFood, respeita o limite do plano.
    O vínculo (`ifood_sync_map` com os ids do iFood e as impressões do que está lá) faz o próximo
    envio não criar outro igual; `channel_item_links` faz o pedido já chegar ligado.
  - **Telas**: em Cardápio › Cardápios › iFood, o cartão "Conferência com o portal do iFood" com o
    que mudou, "Mandar o do Comandou", os itens que só existem lá e "Trazer para o Comandou".
  - **Testes**: 3 novos em `test/ifood.e2e.test.ts` (o iFood falso agora guarda o que recebeu) e 2
    em `ifood-catalog-read.test.ts`.
  - Fica para depois: conferir no sandbox o formato de `GET /categories/{id}/items`; trazer a foto
    do item do iFood (hoje vem sem foto, e o próximo envio de um item trazido que for editado vai
    sem `imagePath`); preço diferente por cardápio na importação (entra o do iFood como preço base).
- **Fase 7** (repasse, 0.186.0): migração 0094 e `channels/channel-finance.service.ts`.
  - **Leitura** pela API financeira do iFood (`/financial/v3.0`, tradução pura em
    `ifood/ifood-finance.ts`): vendas dos últimos 8 dias (limite do iFood por chamada, até 20
    páginas) e repasses com data de pagamento de 35 dias para trás a 35 para a frente. A varredura
    dos canais (`ChannelPoller.onSweep`) lê cada loja no máximo a cada 6 horas
    (`channel_stores.finance_at`; erro em `finance_error`, 403 marca a loja como revogada) e
    "Atualizar agora" no máximo a cada 5 minutos. Os dados da conta bancária (`accountDetails`)
    nunca são guardados.
  - **Por pedido** (`channel_orders.fin_*`): bruto (itens + entrega cobrada do cliente; a taxa de
    serviço é do iFood), o que fica com a loja (`saleBalance`, só depois que o iFood fecha a conta
    da venda: até lá fica vazio), o descontado (bruto − líquido) e os lançamentos (só tipo e valor).
    Vai na gaveta do pedido para quem tem `finance:read` (`GET /channels/orders/:id/finance`).
  - **Repasses** (`channel_payouts`, id estável = resumo do período, tipo e data original): cada
    repasse com valor vira uma conta a receber "Repasse de vendas" (fora do DRE, vencimento = dia
    em que cai; antecipado cai na data e no valor da antecipação). Valor e vencimento não se editam:
    se o iFood muda, a conta aberta é cancelada e outra é aberta; repasse que falhou cancela a
    aberta; conta paga ou cancelada por uma pessoa fica como está. Pago pelo iFood há 2 dias ou
    mais e ainda aberto: baixa sozinha na data do pagamento. A Conciliação bancária liga a linha do
    extrato pela regra de sempre (mesmo valor, data perto).
  - **DRE**: pago dentro do aplicativo (`payments.method = 'app'`, sem o estornado) entra como
    "Vendas · iFood (pago no aplicativo)" e o descontado pelo aplicativo como "Comissões e taxas
    dos aplicativos" (despesa variável). Antes a venda paga no app não aparecia no DRE.
  - **Caixa**: o resumo do caixa mostra "Pago no iFood ... fora da gaveta" do período em que o
    caixa ficou aberto; nunca entra no esperado.
  - **Telas**: Financeiro › Aplicativos (números do mês, repasses com a situação: a cair, pago pelo
    iFood, conferido no extrato, não foi feito; pedidos do mês por aplicativo; "Atualizar
    agora"), a nota "Repasse do iFood" na gaveta do pedido e a linha no resumo do caixa.
  - **Testes**: 3 novos em `test/ifood-orders.e2e.test.ts` (o iFood falso tem vendas e repasses),
    4 em `ifood-finance.test.ts` e 1 no DRE (`finance-plan.test.ts`).
  - Fica para depois: conferir no sandbox (homologação própria do financeiro, cabeçalho
    `x-request-homologation`) os nomes de `type` e `status` dos `closingItems` e dos
    `billingEntries`; ler eventos financeiros (`/financial/v3.0/.../events`) para ajustes depois do
    fechamento; repasse negativo (débito do iFood) só aparece na tela, sem conta a pagar.
- **Fase 8** (avaliações, 0.187.0): migração 0095 e `channels/channel-reviews.service.ts`.
  - **Proposta** (a pesquisa da Fase 0): avaliações têm API (ler e responder) e entram; chat com o
    cliente não tem API pública e fica fora; promoções ficam no portal do iFood (custo e regra
    comercial de cada loja). A escolha foi posta para o dono na conversa, com esta como a
    recomendada.
  - **Leitura** pela Review API v2 (`/review/v2.0/merchants/{id}/reviews`, até 50 por página e 10
    páginas, e `/summary`; 404 = loja sem avaliação), tradução pura em `ifood/ifood-review.ts`. A
    varredura lê cada loja no máximo a cada hora (`channel_stores.reviews_at`, erro em
    `reviews_error`), "Atualizar" no máximo a cada 5 minutos. A primeira leitura pega 30 dias; as
    seguintes, desde a última menos 2 dias (para ver respostas feitas no portal).
  - **Dados** (`channel_reviews`): nota, comentário, pedido (ligado ao pedido do Comandou pelo id
    do pedido no canal), situação no canal e a resposta. Do cliente, só o primeiro nome, que sai
    em 90 dias (`app_purge_expired`); a avaliação sai em 2 anos.
  - **Resposta** (`POST /channels/reviews/:id/reply`, `orders:manage`, 10 a 300 letras): sempre
    escrita por uma pessoa, uma por avaliação, só em `NOT_REPLIED`, sem repetir (409 do iFood marca
    como respondida); auditoria `channel.review_replied`. Leitura atrasada não apaga a resposta
    feita no Comandou.
  - **Telas**: cartão "Avaliações dos clientes" em Aplicativos de delivery (nota de cada loja, a
    média dos últimos 30 dias, "Sem resposta" e "Todas", responder com contador e o aviso de que
    é público) e a nota "Avaliação no iFood" na gaveta do pedido concluído.
  - **Testes**: 3 novos em `test/ifood-orders.e2e.test.ts` (o iFood falso tem avaliações) e 3 em
    `ifood-review.test.ts`.
  - Fica para depois: conferir no sandbox o nome dos campos (`customerName`, `replies[].from`,
    `order.shortId`); aviso no sino para nota baixa; respostas prontas (modelos) para a equipe.
- **Fase 9** (homologação do iFood, 0.188.0): migração 0096, `channels/channel-usage.service.ts`
  e Super Admin › Aplicativos de delivery (`/aplicativos`).
  - **Contagem de uso** (`channel_usage`, banco central): por canal e hora, as chamadas por
    endpoint e resultado (`2xx`, `401`, `403`, `429`, `4xx`, `5xx`, `network`), os pollings (vazio,
    com eventos, erro), se cada polling com eventos terminou com ack de tudo (`poll_acked`
    all/partial/none), os eventos e acks (ok, falhou, guardado para depois) e as consultas por
    pedido (rótulo = número da consulta; `blocked` quando bateu no limite). Só canal, hora e
    rótulos fixos: nada de loja, pedido ou cliente. `ChannelMetrics.record` soma em memória e a
    `ChannelUsageService` grava a cada minuto e ao desligar, pela função `app_channel_usage_add`
    (SECURITY DEFINER, lote de até 2.000, rótulo conferido pelo CHECK, apaga o que passou de 35
    dias); se o banco falhar, a contagem volta para a memória. A API não lê nem escreve a tabela
    direto; o painel (`comandou_platform`) só lê.
  - **Regras** (`packages/shared/src/channel-usage.ts`, `usageReport`): ack ≥ 95% (meta 99%), erro
    do polling e do status da loja ≤ 1%, até 10 consultas por pedido (6 ou mais é atenção), 4xx
    repetido é atenção (mais de 50 no período, vermelho). Endpoint sem regra publicada fica em
    atenção acima de 10% de erro.
  - **Roteiro** (`IFOOD_HOMOLOGATION_STEPS`): conta no Portal do Parceiro, chaves de teste, pedidos
    de teste (dinheiro com troco, cartão, cupom, retirada, agendado), cancelamento e cancelamento
    negado, negociação, loja/entrega/cardápio, 24 horas dentro das regras (conferido pelas
    métricas), app de produção e o assistente de homologação, módulos (Catálogo, Avaliações,
    Financeiro) e a primeira loja de verdade. A equipe marca cada passo com observação
    (`platform_channel_homologation`; auditoria `platform.channel_homologation`).
  - **Rotas**: `GET /platform/channels/usage?hours=1..720`, `GET /platform/channels/homologation`,
    `PUT /platform/channels/homologation/:canal/:passo` (sessão do painel e CSRF).
  - **Testes**: `test/channel-usage.e2e.test.ts` (7) e 1 em `test/ifood-orders.e2e.test.ts` (o fluxo
    real conta), 6 em `packages/shared/src/channel-usage.test.ts`.
  - Fica para depois: alerta no Prometheus a partir de `channel_usage` (o grupo `comandou-canais`
    já avisa polling parado); rodar o roteiro de verdade com a conta do Comandou no Portal.
- **Fase 10** (Keeta e Open Delivery, 0.189.0): `integrations/opendelivery/` com um adaptador só
  (`OpenDeliveryAdapter`) e dois dialetos, sem migração nova.
  - **Keeta** (Open Delivery 1.5 com ajustes, base `KEETA_API_URL`, padrão
    `https://open.mykeeta.com/api/open/opendelivery`): token `app_level_token` em JSON, guardado até
    5 minutos antes de vencer e renovado uma vez num 401; `X-App-Signature` em **toda** chamada
    (HMAC-SHA256 em Base64 com o Client Secret sobre URL sem query + `&chave=valor` em ordem +
    `&` + corpo); o corpo que sai é JSON canônico (chaves em ordem, `jcs`), que serve às duas
    leituras da regra. Ligar a loja chama `PUT /v1/merchantOnboarding?merchantId=<código>` (sem
    isso a Keeta não manda nada) e só depois grava em `channel_stores`; o id da loja no Comandou é
    o próprio código numérico da Keeta. Polling `GET /v1/events:polling` com
    `x-polling-merchants` **uma loja por chamada** (o evento não diz de qual loja é); ack em lote
    de até 500 (`POST /v1/events/acknowledgment`). Ações: `confirm` (com `orderExternalCode` = nº
    do pedido no Comandou), `readyForPickup`, `dispatch`, `delivered`, `requestCancellation`
    (`{reason, code, mode: MANUAL}`; 422 = já feito, ignorado), `acceptRefund`/`rejectRefund`.
    Pedido de reembolso do cliente (`USER_REFUND_REQUEST`) vira disputa `REFUND_REQUEST` que a
    pessoa aceita ou recusa na gaveta; `REFUNDED`/`REFUND_FAILED` encerram.
  - **Open Delivery genérico** (`opendelivery`): mesmo adaptador, token `client_credentials` em
    formulário, sem assinatura, com `preparing`, sem disputas; a base vem da credencial
    ("Endereço da API": só https, sem usuário, query, IP, localhost, `.local` ou `.internal`).
  - **Pedido** (`od-order.ts`, `odToExternal`): preços `{value, currency}`, taxa de entrega e
    demais taxas, desconto por quem paga (`MARKETPLACE` = aplicativo, `MERCHANT` = loja),
    pagamento `PREPAID` (no app, fora do caixa) ou `PENDING` (troco só no dinheiro). Nome cifrado
    vira "Cliente Keeta"; telefone só se for número. Eventos de entregador viram
    `delivery.update`.
  - **Credenciais**: cartões próprios `channel_keeta` e `channel_opendelivery` em Super Admin ›
    Credenciais (sem segredo de webhook). **Restaurante**: Aplicativos de delivery › "Ligar loja"
    (`ConnectStore.tsx`, `POST /channels/stores`, `settings:manage`), com o erro da Keeta em
    português (401 = chaves recusadas; 403/404 = a loja ainda não autorizou o Comandou).
  - **Testes**: `test/keeta.e2e.test.ts` (7, com a Keeta falsa `test/fake-keeta.ts` que confere a
    assinatura e o corpo canônico de toda chamada) e `od-order.test.ts` (5, com a assinatura
    conferida à parte).
  - Fica de fora: Open Delivery **V2** (o esquema do pedido não está publicado e não há app V2
    para testar); webhooks (só polling, que já cumpre o prazo); cardápio, status/pausa da loja e
    `GET /v1/merchant` da Keeta; `batchDecrypt` dos dados cifrados do cliente; mais de um app
    Open Delivery genérico ao mesmo tempo.
- **Fase 11** (99Food, 0.190.0): pela **camada Open Delivery** da Plataforma Aberta da 99Food, com
  o mesmo `OpenDeliveryAdapter` e o dialeto `FOOD99_DIALECT` (base `FOOD99_API_URL`, padrão
  `https://openapi.99food.com/v4/opendelivery`), sem migração nova.
  - **Por que o Open Delivery e não o protocolo próprio da 99Food**: o protocolo próprio (o que a
    99Food recomenda) só entrega pedido por **webhook** com assinatura MD5 do corpo + segredo, e o
    Comandou ainda não tem entrada de webhook (tudo é polling, que já cumpre os prazos). A camada
    Open Delivery tem polling e as ações do ciclo; ficam de fora status da loja, financeiro e
    vínculo por endpoint, que só o protocolo próprio tem.
  - **Token por loja**: `client_id` = `<App ID>_<app_shop_id>` (formulário `client_credentials`),
    um token por loja guardado até 5 minutos antes de vencer (12.600 s na doc). Ligar a loja pede
    o token dela: se a 99Food recusa, a loja ainda não foi vinculada ao app do Comandou.
    **Convenção**: ao vincular a loja em Application Management › Store Management, a equipe usa
    como `app_shop_id` o próprio número da loja na 99Food (`shop_id`); é ele que o restaurante
    cola em "Ligar uma loja" e que vira o id da loja no Comandou.
  - **Polling** com `eventType` (os 11 tipos; o que não for pedido a 99Food dá ack sozinha) e
    `fromTime` (24 horas para trás) na query, com o token da loja (sem `x-polling-merchants`); ack
    agrupado por loja.
  - **Ações**: `confirm`, `readyForPickup`, `dispatch` e `delivered` (entrega da loja), **`pickedUp`**
    (nova ação `picked_up` do Comandou: pedido concluído a partir de "pronto", sem sair para
    entrega, com entrega da loja; vai junto com a capacidade "avisar entregue" e só a 99Food usa)
    e `requestCancellation`. O **pedido de cancelamento do cliente** (`ORDER_CANCELLATION_REQUEST`)
    vira negociação `CANCELLATION` (`<pedido>:cancel`): aceitar manda `acceptCancellation`; recusar
    manda `denyCancellation` com `OUT_FOR_DELIVERY` se a frase fala em saída/entrega, senão
    `DISH_ALREADY_DONE`; `CANCELLED_DENIED` encerra.
  - **Pedido**: o mesmo `odToExternal`; o `extraInfo` da 99Food ("localizador: …; código de
    retirada: …; precisa de talheres: …") põe o localizador do telefone e o código de retirada nos
    campos deles e deixa o resto na observação.
  - **Artigos**: `withArticle` (shared) escreve "da Keeta", "na 99Food", "da Rappi", "do iFood" nas
    telas e avisos que citam o aplicativo.
  - **Testes**: `test/food99.e2e.test.ts` (8, com a 99Food falsa `test/fake-99food.ts`: token por
    loja, polling que exige os parâmetros) e 2 em `od-order.test.ts`.
  - Fica de fora: protocolo próprio da 99Food (webhook, status/pausa da loja, cardápio,
    financeiro, página de autorização da loja); conferir no sandbox o formato do token (formulário)
    e do `eventType` (repetido na query), que a doc não mostra em exemplo; entrega pelo entregador
    da 99Food (o rastreio dela é webhook).
