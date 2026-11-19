# Aplicativos de delivery: pesquisa e desenho (Fase 0)

Levantamento feito em 18/11/2026 para trazer os pedidos do iFood, da 99Food, da Keeta, da Rappi e
de outros aplicativos para dentro do Comandou. A decisão de arquitetura está no
[ADR 0015](decisions/0015-canais-de-delivery.md). Tudo aqui foi conferido na documentação oficial
de cada canal (links em cada seção). Onde a documentação se contradiz ou não diz, está escrito
**"a confirmar"**, com o que fazer para confirmar. Nada de endpoint ou campo inventado.

> Como foi lido: o site do iFood (`developer.ifood.com.br`) recusa acesso automatizado (Akamai,
> HTTP 403), então as páginas foram lidas pelos trechos indexados de cada página oficial. Antes de
> codar cada fase, os caminhos são conferidos de novo contra o app de teste (sandbox) do iFood.

### Segunda leitura (18/11/2026, validação antes da Fase 1)

A primeira versão foi conferida de novo contra o código e contra as páginas oficiais que abrem
daqui (o portal do iFood continua fechado para leitura automática, inclusive pela rede deste
ambiente). O que mudou:

| Onde | Antes | Agora (com a fonte) |
| --- | --- | --- |
| Open Delivery | "versão atual 1.7.1" | Existe a **versão 2** do protocolo em [docs.opendelivery.com.br](https://docs.opendelivery.com.br/en/protocol/orders/): Discovery obrigatório (`/.well-known/opendelivery`), escopos `od.orders`/`od.menu`/…, credencial por aplicativo, `GET /merchants`, `ready-for-pickup`, sem `PICKED_UP` e sem `merchantUpdate`. A V1 continua ativa na transição. Ver seção 3. |
| Keeta | assinatura "SHA-256 do corpo em Base64" | **HMAC-SHA256 em Base64** sobre URL + parâmetros + corpo **canonizado pela RFC 8785** ([Cálculo de assinatura](https://api-docs.mykeeta.com/apis/opendelivery/signature-calculation.md)); webhook responde **204**; três modos de token (`app_level_token`, `shop_level_authorization_code`, `client_credentials` legado). Ver seção 4. |
| Rappi | assinatura "HMAC-SHA256 com timestamp" | Cabeçalho `Rappi-Signature: t=<ts>,sign=<hex>`, HMAC-SHA256 de `<ts>.<corpo cru>` com o segredo do webhook; eventos novos `PING` e `STORE_CONNECTIVITY` ([Webhooks](https://dev-portal.rappi.com/en/webhook-events/)). |
| 99Food | "portal público com YAML e sandbox" | O endereço [developer-food.99app.com](https://developer-food.99app.com/pt-BR/openapi) existe, mas só abre com JavaScript: **não deu para confirmar** o conteúdo. Integradores relatam que a 99Food **não manda dados do cliente** e que agendamento vem desligado ([manual Teknisa](https://universidade.teknisa.com/wp-content/uploads/2026/02/RETAIL_INTEGRACAO_99FOOD_TEKNISA_INT99TEKV02_3.pdf)); 99Food e Keeta concluíram a adesão ao Open Delivery em 11/2025 ([ABC da Comunicação](https://www.abcdacomunicacao.com.br/99food-e-keeta-concluem-integracao-ao-open-delivery/)). |
| iFood, eventos | — | O evento traz `code` (`PLC`) **e** `fullCode` (`PLACED`); integradores relatam comparar o campo errado e perder tudo em silêncio ([relato](https://dev.to/felipebufelli/integracao-com-o-ifood-o-bug-escondido-por-semanas-2ob7)). O adaptador aceita os dois. |
| iFood, fila | — | Relatos de integradores: quem faz o polling primeiro leva o evento (e o ack tira da fila). Por isso **uma réplica só** por credencial (trava no banco central), e o aviso na tela de ligar a loja: "não deixe outro sistema recebendo pedidos desta loja pelo mesmo aplicativo". |
| NFC-e | "intermediador 1 + CNPJ + id" | Correto, com dois detalhes: NFC-e só aceita `indPres` **1 ou 4** (rejeição 717); `indIntermed` é exigido com `indPres` 1, 2, 3, 4 ou 9 (rejeição 434, NT 2020.006 v1.31) e proibido fora disso (435). E o **Ajuste SINIEF 9/2026** (efeitos desde 03/08/2026) exige o endereço em toda NFC-e de operação não presencial. Ver seção 8. |
| Código do Comandou | — | Conferido: `payments.cash_session_id` é `NOT NULL` (0003), `orders.source` só `staff`/`online` (0014), `finance_settlements` com `UNIQUE (tenant_id, cash_session_id, method)` e lista fixa de formas (0077), `fiscal-compose.ts` manda `presenca_comprador` 4/1 sem intermediador, a trava da loja fica em `ifood_merchant_claims` no banco central (`withCentral`) e `TenantDatabaseUnavailable` é o erro de banco em manutenção (é ele que segura o ack). |

---

## 1. O que existe hoje no Comandou

| Peça | Onde | O que faz |
| --- | --- | --- |
| Cliente HTTP do iFood | `apps/api/src/integrations/ifood/ifood.client.ts` | token (`/authentication/v1.0/oauth/token`, renovado 5 min antes), merchants e catálogo v2; repete 5xx/429/rede, nunca 4xx; 401 renova uma vez |
| Lojas ligadas e cardápio | `ifood.service.ts`, `ifood-sync.ts`, `ifood.controller.ts` | modos centralizado (id da loja) e distribuído (código no Portal do Parceiro, refresh token cifrado com contexto `ifood:<restaurante>:<conexão>`); envio do cardápio com `externalCode` `CMD-…`, `CAT-…` |
| Tabelas | migração `0049_ifood_cardapio.sql` | `ifood_connections`, `ifood_pending_auth`, `ifood_sync_map`, `ifood_merchant_claims` (banco central: uma loja só num restaurante) |
| Telas | `apps/web/src/pages/menu/IfoodConnections.tsx`, `IfoodSyncCard.tsx` | ligar loja e mandar cardápio |
| Teste | `apps/api/test/ifood.e2e.test.ts` | iFood falso (HTTP local) |
| Credenciais | `IFOOD_CLIENT_ID/SECRET` no env; Super Admin › Credenciais tem só a entrada informativa `ifood` | ainda não cifradas no painel |
| Pedido | `packages/shared/src/orders.ts` | estados `awaiting → new → in_production → ready → dispatched → completed`, `cancel_requested`, `cancelled`; canais `counter`, `table`, `delivery`, `pickup`; formas `cash`, `credit`, `debit`, `pix`, `voucher`, `other` |
| Origem do pedido | `orders.source` (0014) | só `staff` e `online` |
| Pagamento | `payments` (0003) | `cash_session_id` obrigatório; tudo vira movimento de caixa |
| Repasse | `finance_settlements` (0077) | um por sessão de caixa × forma, lista fixa de formas |
| Pedido online e aceite | `store` (aceite manual ou automático), `online-pay` (lança o pago no caixa pela varredura) | modelo do "pago fora do caixa" que mais se parece com o do aplicativo |
| Filas e outbox | BullMQ (`queue`), `message_outbox`, `mail_outbox`, `print_jobs` (`dedupe_key`) | não há outbox genérico |
| Nota | `fiscal-compose.ts` | delivery vai com `presenca_comprador = 4`; **não preenche intermediador** |

**Em resumo: nenhum pedido de aplicativo entra hoje.** O que já serve: token, modos de
autorização, trava de loja por restaurante, envio de cardápio, servidor falso nos testes.

---

## 2. iFood

Portal: [developer.ifood.com.br](https://developer.ifood.com.br). Merchant API em
`https://merchant-api.ifood.com.br`.

### 2.1 Autenticação e tipo de aplicativo

- OAuth 2.0, `POST /authentication/v1.0/oauth/token` (form-urlencoded, `grantType`
  `client_credentials`, `authorization_code` ou `refresh_token`)
  ([Autenticação](https://developer.ifood.com.br/pt-BR/docs/guides/modules/authentication/intro/)).
  Token de até 8.000 caracteres ([Centralizado](https://developer.ifood.com.br/en-US/docs/guides/modules/authentication/centralized/)).
- Aplicativo de produção é **Centralizado (SaaS)** ou **Distribuído (instalado na loja)**
  ([Criar aplicativo](https://developer.ifood.com.br/en-US/docs/getting-started/first-steps/create-app/)).
  O Comandou é SaaS: **centralizado** é o caminho natural; o distribuído continua funcionando.
- Webhook do iFood só existe para aplicativo centralizado
  ([Webhook](https://developer.ifood.com.br/en-US/docs/guides/modules/events/webhook-overview)).

### 2.2 Eventos

- **Polling:** `GET https://merchant-api.ifood.com.br/events/v1.0/events:polling`; 200 com eventos,
  204 sem nada; a cada **30 s**; eventos podem vir **fora de ordem** (ordenar por `createdAt`)
  ([Polling](https://developer.ifood.com.br/pt-BR/docs/guides/modules/events/polling-overview/)).
- **Acknowledgment:** `POST https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment`,
  lista de ids (ou o payload inteiro; só o `id` conta), até **2.000 ids** por chamada, ack de
  **todos** os eventos, uma vez só (mesma página).
- **Filtros:** header `x-polling-merchants` com até **100 lojas** por header (obrigatório acima de
  500 lojas; recomendado já a partir de 100); query `types` (PLC, CFM, SPS, SPE, RTP, DSP, CON,
  CAN…), `groups` (ORDER_STATUS, DELIVERY, TAKEOUT…) e `categories` (FOOD, GROCERY,
  FOOD_SELF_SERVICE…); evento fora do filtro recebe ack automático (mesma página e
  [Boas práticas](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/best-practices/)).
- **Persistir antes do ack;** sem persistir, o evento volta no próximo polling; usar o id para não
  processar duas vezes; evento desconhecido: ack e descarta
  ([Boas práticas](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/best-practices/)).
- **Presença:** cada polling conta como "loja online" para as lojas do token ou do
  `x-polling-merchants` ([Presença](https://developer.ifood.com.br/pt-BR/docs/guides/order/events/presence/)).
  Integradora só de logística tem de mandar `excludeHeartbeat=true` (não é o nosso caso).
- **Webhook:** um evento por `POST`, header `X-IFood-Signature`, assinatura sobre o **byte array
  cru** do corpo ([Requisição](https://developer.ifood.com.br/pt-BR/docs/guides/order/events/delivery-methods/webhook/request/),
  [Assinatura](https://developer.ifood.com.br/pt-BR/docs/guides/order/events/delivery-methods/webhook/troubleshooting/));
  **o webhook não tem ack** e pode descartar eventos depois de várias falhas
  ([Webhook](https://developer.ifood.com.br/en-US/docs/guides/modules/events/webhook-overview)).
  Decisão: **polling** como caminho principal; webhook só quando o número de lojas pedir.
- **Grupos de eventos:** ORDER_STATUS, CANCELLATION_REQUEST, ORDER_TAKEOUT, DELIVERY,
  DELIVERY_ADDRESS, DELIVERY_GROUP, DELIVERY_ONDEMAND, DELIVERY_COMPLEMENT, ORDER_HANDSHAKE…
  ([Eventos](https://developer.ifood.com.br/pt-BR/docs/guides/order/events/)). Status: PLACED (PLC),
  CONFIRMED (CFM), SEPARATION_STARTED/ENDED (SPS/SPE, só mercado), READY_TO_PICKUP (RTP), DISPATCHED
  (DSP), CONCLUDED (CON, gerado pelo iFood até 2 h depois da entrega), CANCELLED (CAN). Cancelamento:
  CANCELLATION_REQUESTED (CAR), CANCELLATION_REQUEST_FAILED (CARF), CONSUMER_CANCELLATION_REQUESTED
  (CCR)… Cada evento traz `salesChannel` (IFOOD, DIGITAL_CATALOG, POS…).

**Duas URLs de polling (pergunta do plano).** As páginas do módulo **Events** usam
`/events/v1.0/events:polling` e `/events/v1.0/events/acknowledgment`; a página de **Order**
(endpoints e guia de implementação) ainda mostra `/order/v1.0/orders:polling` e
`/order/v1.0/orders:acknowledgment` com corpo `{"acknowledgedEventIds": [...]}`. Integradores em
2025 ainda usam `/order/v1.0/events:polling` e `/order/v1.0/events/acknowledgment`
([relato](https://dev.to/felipebufelli/integracao-com-o-ifood-o-bug-escondido-por-semanas-2ob7)), e
a API antiga era `pos-api.ifood.com.br/v3.0/events:polling` ([relato](https://guicommits.com/challenges-on-integrating-ifood/)).
**Vale o módulo Events** (é o que as páginas de Events, Logística, rate limit e uso indevido citam).
O caminho fica numa constante só do adaptador (`IFOOD_PATHS`) e é conferido no sandbox na Fase 2.

### 2.3 Pedido

- Detalhes: `GET /order/v1.0/orders/{id}`; tipos `DELIVERY`, `TAKEOUT`, `DINE_IN`; categorias
  FOOD, FOOD_SELF_SERVICE, ANOTAI…; `orderTiming` `IMMEDIATE` ou `SCHEDULED`
  ([Endpoints](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/endpoints),
  [Fundamentos](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/fundamentals)).
  **Consultar os detalhes antes de confirmar ou cancelar** é obrigatório (boas práticas).
- Ações (todas 202, resultado chega por evento): `POST /orders/{id}/confirm` (**até 8 minutos**;
  agendado: 8 min a partir de `preparationStartDateTime`; passou do prazo o iFood cancela;
  chamada repetida é ignorada), `startPreparation`, `readyToPickup` (obrigatório para TAKEOUT,
  DINE_IN e DELIVERY), `dispatch` (só entrega própria, `deliveredBy = MERCHANT`, depois do
  `readyToPickup`) ([Workflow](https://developer.ifood.com.br/en-US/docs/guides/modules/order/workflow/),
  [Changelog](https://developer.ifood.com.br/en-US/docs/changelog/)).
- **Método a confirmar:** a página de endpoints mostra `POST /readyToPickup` e `POST /dispatch`; a
  de homologação escreve `PUT`. Conferir no sandbox (Fase 2).
- Retirada: `takeout.mode` `DEFAULT` (balcão) ou `PICKUP_AREA`, `takeoutDateTime`; agendado tem
  `scheduled.preparationStartDateTime` ([Takeout](https://developer.ifood.com.br/pt-BR/docs/guides/modules/order/takeout/)).
  No local (`DINE_IN`/INDOOR): grupo `indoor` com `mode`, `table`, `deliveryDateTime`
  ([Indoor](https://developer.ifood.com.br/pt-BR/docs/guides/order/indoor/)).
- Rastrear entregador do iFood: só `deliveredBy = IFOOD`, no máximo uma chamada a cada 30 s, pode
  dar 404 antes de estar disponível; código de coleta comparado com `pickupCode`
  ([Endpoints pt-BR](https://developer.ifood.com.br/pt-BR/docs/guides/modules/order/endpoints)).
- Entrega parceira pode ter **várias entregas** (`deliveryId`, `deliveryType` MAIN/COMPLEMENT)
  ([Eventos](https://developer.ifood.com.br/pt-BR/docs/guides/order/events/)).
- **Cancelar:** `GET /orders/{id}/cancellationReasons` e `POST /orders/{id}/requestCancellation`
  com `{"reason": "<código>"}`; 202; só vale quando chega o `CANCELLED`. Códigos comuns: 501
  sistema, 502 duplicado, 503 indisponível, 504 sem entregador, 505 cardápio, 506 fora de área, 507
  fraude, 508 fora de horário, 509 erro interno, 511 risco, 512 abre depois
  ([Endpoints](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/endpoints)). A
  lista vale por pedido: sempre buscar antes de mostrar.
- **O que a homologação exige mostrar:** bandeira do cartão, troco calculado, valor do cupom e
  **quem paga** (iFood ou loja), observações, código de retirada e CPF/CNPJ da nota
  ([Homologação de pedidos](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/homologation)).
- Desconto por item: o preço do item vem cheio; subtrair o `sponsorships.amount.value` do benefício
  do `prices.grossValue.value` do item ligado pelo `uniqueId`
  ([Promoções › retorno no pedido](https://developer.ifood.com.br/en-US/docs/guides/promotion/)).
- **Campos de pagamento e totais a confirmar:** a estrutura completa (`payments`, `total`,
  `benefits`, `customer`, `delivery`) está na página "Order structure", que não foi possível ler
  inteira. Na Fase 2 o tipo é escrito a partir dessa página e de pedidos reais do sandbox
  (gerados com dinheiro, cartão na entrega, cartão online e o cupom `VOUCHER_ENTGRATIS`).

### 2.4 Negociação (Plataforma de Negociação / Handshake)

- Evento `HANDSHAKE_DISPUTE` (HSD) com `disputeId`, `action` (CANCELLATION, PARTIAL_CANCELLATION,
  PROPOSED_AMOUNT_REFUND, PROPOSED_ADDITIONAL_TIME, VOID), `expiresAt`, `timeoutAction`
  (ACCEPT_CANCELLATION / REJECT_CANCELLATION), `alternatives` (REFUND, BENEFIT, ADDITIONAL_TIME) e
  `metadata.acceptCancellationReasons`; valores em centavos sem casa decimal
  ([Plataforma de Negociação](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/handshake-platform)).
- Resposta obrigatória antes de `expiresAt`: `POST /order/v1.0/disputes/{id}/accept`,
  `/reject` ou `/alternatives/{alternativeId}`; resultado em `HANDSHAKE_SETTLEMENT`; uma resposta
  só; o iFood **recomenda não automatizar** aceite e recusa
  ([Negociação pt-BR](https://developer.ifood.com.br/en-US/docs/guides/order/handshake-platform/)).

### 2.5 Loja

`GET /merchants/{id}/status` (e por operação DELIVERY, TAKEOUT, INDOOR), `GET/POST
/merchants/{id}/interruptions`, `DELETE /interruptions/{id}`, `GET/PUT /merchants/{id}/opening-hours`
([Merchant](https://developer.ifood.com.br/pt-BR/docs/guides/modules/merchant/endpoints)).
Interrupção de até 7 dias, para pausa; horário fixo pelo `PUT` com **todos os dias** (o que não for
mandado fecha) ([Boas práticas Merchant](https://developer.ifood.com.br/en-US/docs/food/guides/modules/merchant/best-practices-troubleshooting)).

### 2.6 Entrega

- **Entrega pelo iFood:** rastreio e código de coleta (2.3).
- **Logística (integradora de entrega):** `assignDriver`, `goingToOrigin`, `arrivedAtOrigin`,
  `dispatch`, `arrivedAtDestination`, `verifyDeliveryCode` ([Logística](https://developer.ifood.com.br/en-US/docs/food/guides/modules/logistics/introduction)).
  Não é o papel do Comandou (é para empresas de entrega); só entra se o Comandou virar operador
  logístico.
- **Sob Demanda / Shipping:** chamar entregador do iFood, inclusive para pedido de fora do iFood
  (WhatsApp, telefone) com origem e destino completos; cotação (`deliveryAvailabilities`),
  `requestDriver`, `cancelRequestDriver`, eventos REQUEST_DRIVER_SUCCESS/FAILED
  ([Shipping](https://developer.ifood.com.br/en-US/docs/food/guides/modules/shipping/intro),
  [Pedidos do iFood](https://developer.ifood.com.br/en-US/docs/food/guides/modules/shipping/inside)).
  Erro `MerchantEasyDeliveryDisabled` = serviço não habilitado na loja.

### 2.7 Cardápio (catálogo v2)

Já usado hoje. Hierarquia catálogo › contexto (DEFAULT, WHITELABEL, INDOOR) › categoria › item ›
produtos e grupos de complementos (OFFER_UNIT, SPECIFICATION, INGREDIENTS, CUTLERY…); preço e status
por contexto com `contextModifiers`
([Catálogo](https://developer.ifood.com.br/en-US/docs/guides/modules/catalog/fundamentals)).

### 2.8 Financeiro

- Endpoints por loja: `sales`, `payments`, `paymentDetails`, `occurrences`, `maintenanceFees`,
  `incomeTaxes`, `periods`, `chargeCancellations`, `cancellations`, `receivableRecords`,
  `salesAdjustments`, `salesBenefits`, `adjustmentsBenefits`
  ([Rate limit › Financial](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/rate-limit/));
  conciliação em CSV `.gz` (`;`) por competência, com `impacto_no_repasse` e
  `data_repasse_esperada` ([Reconciliation](https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-reconciliation));
  Settlements (repasse, boleto, registro de recebíveis) e Anticipation
  ([Settlements](https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-settlement/),
  [Anticipation](https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-antecipation)).
- Conceitos (apuração semanal, repasse, subsídios, o que tem ou não impacto no repasse — dinheiro,
  vale e maquininha da loja não passam pelo iFood) em
  [Definições](https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/definitions).
- **Homologação própria**, por reunião e questionário, com o header `x-request-homologation: true`
  ([Homologação Financial](https://developer.ifood.com.br/en-US/docs/guides/modules/financial/homologation)).

### 2.9 Avaliações

`GET /merchants/{id}/reviews`, detalhe, `POST /reviews/{id}/answers`, `GET /summary`
([Review](https://developer.ifood.com.br/pt-BR/docs/guides/review/),
[Campos](https://developer.ifood.com.br/pt-BR/docs/guides/modules/review/details/)). Só responde
avaliação `NOT_REPLIED`, editável por 10 min, `pageSize` até 50
([Erros](https://developer.ifood.com.br/docs/guides/modules/review/errors)). Homologação por chamado.

### 2.10 Limites e uso indevido

| Endpoint | Limite (req/min) |
| --- | --- |
| `GET /events:polling`, `POST /events/acknowledgment` | 6.000 |
| `GET /orders/{id}`, `confirm`, `startPreparation`, `readyToPickup`, `dispatch` | 3.000 |
| `GET /orders/{id}/virtual-bag` | 1.000 |
| `POST /orders/{id}/requestCancellation` | 300 |
| `/orders/{id}/tracking` | 5.000 |
| `disputes/{id}/accept`, `reject`, `alternatives/{id}` | 1.000 |
| `GET /merchants/{id}/status` | 20.000 |
| interruptions e opening-hours | 100–200 |

Fonte: [Rate limit](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/rate-limit/).

**Bloqueio** ([Uso indevido](https://developer.ifood.com.br/en-US/docs/getting-started/documentation/improper-use/)):
não mandar ack, 400/401/403/404 repetidos, polling com menos de 30 s, mesmo pedido consultado mais
de 10 vezes, estourar limite. Taxa de erro nas últimas 24 h: polling ≤ 1%, `/merchants/{id}/status`
≤ 1%, `/merchants` e `/merchants/{id}` ≤ 2%; **ack ≥ 95%** (acks ÷ pollings). Nível III bloqueia
**o aplicativo inteiro** (todas as lojas de todos os restaurantes): 24 h e, sem plano de ação,
indefinidamente.

### 2.11 Homologação e loja de teste

- Conta profissional (CNPJ; CNAE de tecnologia); ao se cadastrar vem **loja e app de teste**
  ([Portal](https://developer.ifood.com.br/), [Criar conta](https://developer.ifood.com.br/en-US/docs/getting-started/first-steps/create-account/)).
- Pedido de teste: Portal › Testes › **Gerar pedido de teste** (automático) ou pelo app/site em modo
  de teste; dinheiro e cartão na entrega funcionam, cartão online com dados de teste, **PIX não**;
  cupom `VOUCHER_ENTGRATIS` (frete pago pelo iFood)
  ([Pedidos de teste](https://developer.ifood.com.br/en-US/docs/getting-started/first-steps/generate-test-order)).
- Homologação de Events + Order é **automática** (assistente no Portal › Homologação › Nova), só o
  dono do app inicia, uma por app a cada 4 h, app de produção da categoria **PDV**; Catálogo e
  Avaliações por chamado depois ([Homologação Events](https://developer.ifood.com.br/en-US/docs/food/guides/modules/events/homologation),
  [Homologação Order](https://developer.ifood.com.br/en-US/docs/food/guides/modules/order/homologation)).
  A página [Criar aplicativo](https://developer.ifood.com.br/en-US/docs/getting-started/first-steps/create-app/)
  diz para criar o app de produção só depois de homologar o de teste, enquanto o assistente pede o
  app de produção: seguir o assistente e confirmar no próprio Portal.

---

## 3. Open Delivery (Abrasel)

Há **duas versões vivas**. A **V1** (última 1.7.1, [documentação antiga](https://abrasel-nacional.github.io/opendelivery/))
é a que a Keeta usa (1.5.0 com ajustes). A **V2** está em [docs.opendelivery.com.br](https://docs.opendelivery.com.br/en/protocol/orders/)
e "a V1 continua ativa durante a transição" ([Migração V1→V2](https://docs.opendelivery.com.br/en/guide/migration-v1-v2/)).
Três papéis: **Ordering Application** (o aplicativo de pedidos), **Software Service** (o Comandou)
e **Logistics Service**.

**O que a V2 muda (e o adaptador precisa tratar):**

- **Discovery obrigatório:** cada participante publica `GET /.well-known/opendelivery` (público,
  HTTPS) com versões, modos de autenticação, capacidades, eventos e operações suportadas e se usa
  webhook e/ou polling ([Discovery](https://docs.opendelivery.com.br/en/protocol/discovery/)). O
  Comandou lê o do aplicativo ao ligar e de tempos em tempos, e **não chama o que não está lá** (a
  tela mostra "o canal não oferece isso").
- **Autenticação:** `POST /oauth/token` (form) com `client_credentials` e `scope` obrigatório
  (`od.orders`, `od.menu`, `od.logistics`, `od.crm`, `od.all`); credencial **por aplicativo**
  recomendada (por loja só na transição); lojas autorizadas em `GET /merchants`; authorization code
  opcional ([Autenticação](https://docs.opendelivery.com.br/en/protocol/authentication/)).
- **Pedido:** `GET /orders/{id}` é a fonte da verdade (evento é só aviso, pode vir repetido ou fora
  de ordem: deduplicar por `eventId`); ações `confirm`, `preparing`, `ready-for-pickup`,
  `dispatch`, `delivered`, `requestCancellation` e cancelamento de item
  (`POST /orders/{orderId}/items/{itemId}/cancel`) respondem **202** e repetir a mesma ação também
  dá 202. Eventos: `CREATED`, `CONFIRMED`, `PREPARATION_REQUESTED`, `PREPARING`,
  `READY_FOR_PICKUP`, `DELIVERED`, `CONCLUDED`, logística (`PICKUP_ONGOING`,
  `RIDER_ARRIVED_AT_STORE`, `DISPATCHED`, `ORDER_COLLECTED`, `DELIVERY_ONGOING`,
  `ARRIVED_AT_CUSTOMER`), cancelamento (`CANCELLATION_REQUESTED`, `CANCELLATION_REQUEST_ACCEPTED`,
  `CANCELLATION_REQUEST_DENIED`, `CANCELLED`) e `ITEM_CANCELLED`. **Saiu na V2:** `PICKED_UP`.
- **Campos que mudaram de lugar:** `Order.type` → `fulfillment.orderType`; entrega/retirada/no local
  em `fulfillment.*`; preços em `pricing`; `timing` agrupa `orderTiming`, `schedule` e
  `preparationStartDateTime`; `items[*].observations` (antes `specialInstructions`).
- **Cardápio:** acabou o `merchantUpdate` monolítico; agora CRUD por entidade e snapshot.

Decisão: o adaptador Open Delivery fala **V1 e V2**, escolhendo pelo Discovery (V2) ou pela
configuração do canal (V1, como a Keeta). O que muda entre as duas fica num tradutor só, para o
resto do Comandou ver o mesmo pedido normalizado. A seguir, o que vale na **V1**:

- O aplicativo hospeda: `GET /events:polling`, `POST /events/acknowledgment`,
  `POST /orders/{id}/confirm`, `/preparing`, `/readyForPickup`, `/pickedUp`, `/dispatch`,
  `/delivered`, `POST /v1/orders/{id}/validateCode`, `/requestCancellation`,
  `/acceptCancellation`, `/denyCancellation` e `POST /merchantUpdate`.
- **O Comandou hospeda** `GET /merchant` (uma URL única por loja, com `apiKey` se houver
  autenticação), de onde o aplicativo lê loja e cardápio, e opcionalmente o webhook de eventos.
- Webhook: header `X-App-Signature` = HMAC-SHA256 do corpo, chave = client secret, em **hexadecimal
  minúsculo**.
- Eventos: `CREATED`, `CONFIRMED`, `PREPARING`, `READY_FOR_PICKUP`, `DISPATCHED`, `PICKED_UP`,
  `DELIVERED`, `CONCLUDED`, `CANCELLATION_REQUESTED` (pedido pelo Comandou),
  `CANCELLATION_REQUEST_DENIED`, `CANCELLED` (e, na Keeta, `USER_REFUND_REQUEST`, `REFUNDED`,
  `REFUND_FAILED`). Prazo de confirmação e intervalo de polling: **a confirmar** por aplicativo (o
  padrão deixa para cada um).

## 4. Keeta (Open Delivery com ajustes)

[Keeta Open Delivery API](https://api-docs.mykeeta.com/apis/opendelivery) (v1.0.7+, base
`https://open.mykeeta.com/api/open/opendelivery`), sobre Open Delivery **1.5.0**.

- **Credencial do software**, não da loja: o mesmo `clientId`/`clientSecret` para todos os
  restaurantes do Comandou; a loja autoriza no portal da Keeta
  ([Portal do desenvolvedor](https://api-docs.mykeeta.com/apis/opendelivery/keeta-developer-portal)).
  O modo "client credentials" passou a se chamar `grant_type=app_level_token` (quem já usava
  `client_credentials` continua) ([Changelog](https://api-docs.mykeeta.com/apis/opendelivery/signature-calculation/signature-tools)).
- **Assinatura em toda chamada** (`X-App-Signature`) e no webhook `POST {baseURL}/v1/newEvent`, que
  traz `X-App-Id`, `X-App-MerchantId` e `X-App-Signature`
  ([newEvent](https://api-docs.mykeeta.com/apis/opendelivery/orderswebhook/newevent.md)). A
  assinatura é **HMAC-SHA256 em Base64** sobre a URL (sem query), os parâmetros e o corpo
  **canonizado pela RFC 8785 (JCS)**
  ([Cálculo de assinatura](https://api-docs.mykeeta.com/apis/opendelivery/signature-calculation.md)).
  Diferente do Open Delivery V1 (HMAC do corpo cru, hexadecimal): o adaptador trata as duas. A
  ordem exata da junção (separadores, ordenação dos parâmetros) está nas páginas "Processo de
  geração" e "Implementação de referência", que precisam ser lidas na Fase 10 contra a
  [ferramenta de assinatura](https://api-docs.mykeeta.com/apis/opendelivery/signature-calculation/signature-tools)
  da Keeta. **Exceção à regra "assinatura sobre o corpo cru":** na Keeta o corpo é lido como JSON
  (com limite de tamanho) só para canonizar, e nada é gravado nem processado antes de a assinatura
  conferir.
- O webhook deve responder **204** (200 é aceito); 400/403/404/503 com `application/problem+json`.
- Eventos da Keeta: `CREATED`, `CONFIRMED`, `DISPATCHED`, `READY_FOR_PICKUP`, `PICKUP_ONGOING`,
  `PICKED_UP`, `DELIVERED`, `CONCLUDED`, `CANCELLATION_REQUESTED`, `CANCELLED`,
  `USER_REFUND_REQUEST`, `REFUNDED`, `REFUND_FAILED`, `RIDER_ARRIVED_AT_STORE`, `ORDER_COLLECTED`,
  `RECOMMENDED_PREPARATION_START`; `metadata` é um texto JSON (no `CANCELLED`, `reason` e `code`:
  `INSUFFICIENT_DISHES`, `SUSPENSION_OF_BUSINESS`, `INSUFFICIENT_MANPOWER`, `OTHERS`).
- Tokens: `app_level_token` (um para todas as lojas autorizadas), `shop_level_authorization_code`
  (um por loja, renovado com `refresh_token`) e `client_credentials` (legado, igual ao primeiro)
  ([Autenticação](https://api-docs.mykeeta.com/apis/opendelivery/development-guides)).
- **Onboarding obrigatório** antes de qualquer evento: `PUT /v1/merchantOnboarding?merchantId=…`
  liga a loja Keeta ao id da loja no Comandou e registra o webhook
  ([Merchant](https://api-docs.mykeeta.com/apis/opendelivery/merchantendpoints)); autorização e
  revogação chegam pelo webhook de autorização (1301/1302)
  ([Autorização](https://api-docs.mykeeta.com/apis/opendelivery/authentication/receiveauthorizationwebhook)).
- Polling `GET /v1/events:polling` com `x-polling-merchants` (o id da loja **no Comandou**) e ack
  `POST /v1/events/acknowledgment` ([Polling](https://api-docs.mykeeta.com/apis/opendelivery/orderspolling/pollingevents.md)).
- Reembolso: `POST /v1/orders/{id}/acceptRefund` (e recusa), esperar `REFUNDED`
  ([Accept refund](https://api-docs.mykeeta.com/apis/opendelivery/orderapi/acceptrefund)).
  Motivos de cancelamento próprios (`SYSTEMIC_ISSUES`, `UNAVAILABLE_ITEM`…)
  ([Merchant Fulfill](https://api-docs.mykeeta.com/apis/opendelivery/development-guides/orders/merchant-fulfill-api)).
- Dados do cliente cifrados; só dá para decifrar (`POST /v1/batchDecrypt`) em entrega própria ou
  por operador logístico ([Guias](https://api-docs.mykeeta.com/apis/opendelivery/development-guides)).
- Acesso: **NDA → conta de desenvolvedor → autoteste → teste integrado (SIT) com a Keeta →
  produção** ([Integrando](https://api-docs.mykeeta.com/apis/opendelivery/integrating-with-keeta-api)).

## 5. 99Food

- **Portal:** [Plataforma Aberta da 99Food](https://developer-food.99app.com/pt-BR/openapi). Na
  primeira leitura constava "APIs e webhooks de autorização, pedidos, lojas e cardápio, arquivo YAML
  e sandbox"; na segunda, a página só abre com JavaScript e **não deu para confirmar**. Pedir o
  acesso pelo próprio portal e baixar o YAML antes da Fase 11.
- Relato de integrador (manual da Teknisa, 02/2026): a loja é identificada pelo id do
  estabelecimento no portal da 99 (Estabelecimentos › Configurações), **a 99Food não manda dados do
  cliente**, pedido agendado vem desligado (pedido por e-mail) e pausar é fechar a loja no portal
  ([manual](https://universidade.teknisa.com/wp-content/uploads/2026/02/RETAIL_INTEGRACAO_99FOOD_TEKNISA_INT99TEKV02_3.pdf)).
- Na vitrine do Open Delivery: padrão de Merchant "pronto para integrar", Logística "em
  desenvolvimento", eventos por webhook e polling
  ([Vitrine de aderentes](https://aderentes.opendelivery.com.br/companies/68f696345e89f79a1563008a)).
- Relato de parceiro (não oficial): a 99Food permite **um aplicativo autorizado por integradora**
  ([Foody Delivery](https://help.foodydelivery.com/knowledge-base/99food-integration/)). A confirmar
  com a 99Food.
- Decisão: começar pelo adaptador Open Delivery; se a API própria da 99Food tiver o que o padrão
  não tem, um ajuste como o da Keeta.

## 6. Rappi

- [Portal](https://dev-portal.rappi.com/). Domínio do Brasil `https://api.rappi.com.br` e de teste
  `https://api.dev.rappi.com`, caminhos `/restaurants/{módulo}`
  ([Rests API](https://dev-portal.rappi.com/en/rests-api/)); uma página antiga ainda cita
  `services.rappi.com.br` (a confirmar).
- Token: `POST /restaurants/auth/v1/token/login/integrations`; disponibilidade por SKU
  (`PATCH /restaurants/menu/v1/stores/{storeId}/products/{identityType}/stock`)
  ([Conteúdo](https://dev-portal.rappi.com/en/api-reference/content/)).
- Pedidos (REST novo): `GET restaurants/orders/v1/orders`, `…/stores/{storeId}/orders`,
  `PUT …/orders/{orderId}/take` (ou com `cooking_time`), `handoff` (código e QR)
  ([Orders](https://dev-portal.rappi.com/en/api-reference/orders-rests-api/)); API antiga
  v1.24.5: `take/{cookingTime}`, `reject`, `ready-for-pickup`, `events`
  ([API](https://dev-portal.rappi.com/api/)).
- Estados: `CREATED`, `WEBHOOK`, `READY`, `SENT`, `TAKEN`, `REJECTED`, `READY_FOR_PICKUP` (automático
  depois do `TAKEN`, por padrão), `TIMEOUT`; **6 minutos** para aceitar
  ([Pedidos](https://dev-portal.rappi.com/pt/managing-user-orders/)).
- Webhooks `NEW_ORDER` (o pedido inteiro, igual ao `getOrders`), `ORDER_EVENT_CANCEL`,
  `ORDER_OTHER_EVENT`, `MENU_APPROVED`, `MENU_REJECTED`, `PING` e `STORE_CONNECTIVITY`; assinatura
  `Rappi-Signature: t=<timestamp>,sign=<assinatura>` = HMAC-SHA256 de `<timestamp>.<corpo cru>` com
  o segredo do webhook (o exemplo é hexadecimal), **só se o segredo for configurado**: o Comandou
  sempre configura e recusa sem assinatura
  ([Webhooks](https://dev-portal.rappi.com/en/webhook-events/),
  [Configurar](https://dev-portal.rappi.com/en/api-reference/webhooks/)). O token precisa de **uma
  audiência só**, `{domínio do país}/api/v2/restaurants-integrations-public-api`
  ([Rests API](https://dev-portal.rappi.com/en/rests-api/)).
- API financeira com 13 endpoints (lojas, pagamento, cancelamentos, contrato)
  ([Financial](https://dev-portal.rappi.com/en/financial/)).

## 7. aiqfome

Atualizado na Fase 13: o aiqfome publicou o
[portal do desenvolvedor](https://developer.aiqfome.com/docs/guides/versions). A API V1 sai em
07/04/2026 e a V2 usa o **ID Magalu** ([guia de transição](https://aiqfomedev.discourse.group/t/guia-de-transicao-api-v2-aiqfome-impactos-e-mudancas/27)).

- **Credenciais**: Aplicativo de Integração no portal (login com ID Magalu, escopos Loja e
  Pedidos), Client ID e Client Secret (mostrado uma vez só)
  ([Passo 1](https://developer.aiqfome.com/docs/guides/get-started/step-1)).
- **Autorização por loja**: `GET https://id.magalu.com/login?client_id&response_type=code&redirect_uri&scope&state&choose_tenants=true`;
  a volta traz `code` e `state`; `POST https://id.magalu.com/oauth/token` (formulário,
  `authorization_code` ou `refresh_token`) devolve `access_token` (7.200 s) e `refresh_token`, que
  troca a cada renovação; um par por loja
  ([Autenticação](https://developer.aiqfome.com/docs/guides/opendelivery/authentication)).
- **Camada Open Delivery** (aiqfome e Magalu Delivery): `PUT /v1/merchantOnboarding/{id}` com
  `orderingAppMerchantId` (sem `ordersWebhookURL` = polling)
  ([Software Service](https://developer.aiqfome.com/docs/guides/opendelivery/merchant-onboarding));
  `GET /api/od/v1/events:polling` (até 100, 48 horas), `POST /api/od/v1/events/acknowledgment`
  (`id`, `orderId` e `eventType` obrigatórios), `GET /api/od/v1/orders/{id}` e as ações `confirm`,
  `ready-for-pickup` (só retirada), `dispatch` e `delivered`; eventos `CREATED`, `CONFIRMED`,
  `READY_FOR_PICKUP`, `DISPATCHED`, `DELIVERED`, `CANCELLED` e `CONCLUDED`
  ([Pedidos](https://developer.aiqfome.com/docs/guides/opendelivery/order-lifecycle)). Não há
  recusa nem cancelamento nessa camada: continuam no gestor do aiqfome.
- Suporte de integração: integracao@aiqfome.zendesk.com.

## 8. Nota fiscal com intermediador

- NT 2020.006 (Ajustes SINIEF 21 e 22/2020): `indIntermed` (0 sem intermediador, 1 em plataforma
  de terceiros), grupo `infIntermed` com `CNPJ` e `idCadIntTran` (identificação da loja no
  aplicativo, de 2 a 60 caracteres). Pela v1.31 da NT, `indIntermed` é obrigatório com `indPres`
  1, 2, 3, 4 ou 9 (rejeição **434**), `indIntermed = 1` é proibido fora dessa lista (435),
  `infIntermed` é obrigatório com `indIntermed = 1` (438) e proibido sem ele (439); as regras valem
  para o modelo 65 (NFC-e)
  ([NT 2020.006 v1.31](https://inventti.com.br/wp-content/uploads/2022/09/NT2020.006-v1.31.pdf),
  [Econet](https://blog.econeteditora.com.br/intermediador-da-operacao-marketplace/),
  [rejeições 434/438](https://www.notaas.com.br/blog/post/rejeicao-434-438-nfe-nfce-intermediador-indintermed-infintermed-crt-2-cstat-591/)).
- **NFC-e só aceita `indPres` 1 (presencial) ou 4 (entrega a domicílio)**: outro valor dá a
  rejeição 717 ([Cigam 717](https://www.cigam.com.br/wiki/index.php/Como_Resolver_a_Rejei%C3%A7%C3%A3o_717_-_NFC-e_em_opera%C3%A7%C3%A3o_n%C3%A3o_presencial)).
  Então: entrega de aplicativo = 4 + intermediador; retirada de aplicativo = 1 + intermediador
  (permitido, porque 1 está na lista da regra 435) — a confirmar com a contabilidade.
- Pagamento pelo intermediador: no grupo do cartão vai o CNPJ de quem pagou o vendedor
  (`YA05`, pode ser o do aplicativo) e `tpIntegra` (1 integrado, 2 não integrado) (mesma NT,
  seção 6.2).
- **Ajuste SINIEF 9/2026** (efeitos desde 03/08/2026): toda NFC-e de operação **não presencial**
  (aplicativo, site, WhatsApp) leva o endereço
  ([Portal SPED](https://portalspedbrasil.com.br/forum/nfc-e-operacoes-nao-presenciais-ajuste-sinief-no-9-de-6-de-abril-de-2026/)).
  Conferir na Fase 2 se o `recipientPayload` do Comandou manda o endereço em todo delivery.
- Na Focus: `indicador_intermediario`, `cnpj_intermediario`, `id_intermediario`
  ([Focus NT 2020.006](https://focusnfe.com.br/notas-tecnicas/nfe/2020-006/)).
- O Comandou manda `presenca_comprador = 4` no delivery e não manda o intermediador (a Focus usa 0
  por padrão). Pedido de aplicativo passa a mandar 1 + CNPJ + id. **Com a contabilidade:** qual
  `indPres` usar na retirada de pedido de aplicativo e se a nota sai no pago no app (ao concluir) ou
  só no pago na entrega.

---

## 9. Comparação ponto a ponto

| Precisa | Hoje no Comandou | Falta | Fase |
| --- | --- | --- | --- |
| Receber eventos (polling 30 s, ack depois de gravar) | nada | caixa de entrada, polling com trava, ack | 1–2 |
| Criar o pedido | só PDV e loja própria; preço sempre do banco | ingestão única com preço do aplicativo, item sem vínculo | 1–2 |
| Aceitar em 8 min (iFood) / 6 min (Rappi) | aceite manual ou automático da loja própria | aceite por canal, som até atender, contagem do prazo | 2 |
| Pronto, saiu, concluído | estados existem | caixa de saída que avisa o canal | 1–2 |
| Selo do canal em todo lugar | `source` staff/online | `source = app` + `app_channel` + código curto | 1–2 |
| Pago no app fora da gaveta | todo pagamento é movimento de caixa | forma `app` sem movimento; repasse por canal | 2, 7 |
| Estoque | baixa pela ficha na criação; devolve no cancelamento | só itens com vínculo | 2 |
| NFC-e | sem intermediador | intermediador, forma real, regra de emissão | 2 |
| Cancelar e negociar | cancelamento interno | motivos do canal, resultado assíncrono, disputas com prazo | 3 |
| Loja aberta/pausada | loja própria `is_open` | status, interrupções e horários no canal; alerta de polling | 4 |
| Entrega | entregadores, app e rastreio próprios | despacho/rastreio no canal; status do entregador do iFood; Sob Demanda | 5 |
| Cardápio | envio ao iFood | importar do iFood, disponibilidade pelo estoque, conflito de edição | 6 |
| Repasses | recebíveis por sessão de caixa | API financeira, conferência por pedido, conciliação | 7 |
| Não ser bloqueado | nada | métricas, alertas, tela de homologação | 1, 9 |

## 10. Credenciais, contratos e acessos que você precisa conseguir

| Canal | O que | Com quem / onde |
| --- | --- | --- |
| iFood | Conta profissional no Portal do Desenvolvedor (CNPJ com CNAE de tecnologia); app de teste já vem | [developer.ifood.com.br](https://developer.ifood.com.br) |
| iFood | App de **produção centralizado**, categoria PDV, e a homologação de Order + Events (automática) | Portal › Apps › Novo; Portal › Homologação |
| iFood | Homologação de Catálogo (já usamos) e Avaliações | chamado no Portal |
| iFood | Homologação do módulo Financeiro (reunião + questionário) | Portal › Suporte › Chamados › Homologação |
| iFood | Sob Demanda habilitado na loja (se for usar) | iFood (comercial da loja) |
| Keeta | NDA, conta de desenvolvedor, app de teste, teste integrado (SIT), credencial de produção | time de API da Keeta |
| 99Food | Conta na Plataforma Aberta, credenciais de sandbox e produção; confirmar o "um app por integradora" | [developer-food.99app.com](https://developer-food.99app.com/pt-BR/openapi) e o contato da vitrine Open Delivery |
| Rappi | Acesso ao Portal, `client_id`/`client_secret` do Brasil, segredo dos webhooks | [dev-portal.rappi.com](https://dev-portal.rappi.com/) |
| aiqfome | Aplicativo de Integração no portal do desenvolvedor (ID Magalu), Client ID e Secret, Redirect URI do Comandou | developer.aiqfome.com e integracao@aiqfome.zendesk.com |
| Open Delivery | Nada obrigatório; opcional entrar na vitrine de aderentes | Abrasel |
| Nota fiscal | CNPJ de cada aplicativo como intermediador e a regra de presença/emissão | contabilidade do restaurante (e o contrato de cada aplicativo) |

## 11. Roteiro de homologação do iFood

1. **Cadastro:** conta profissional (CNPJ). Anotar o app e a loja de teste que vêm junto.
2. **Desenvolver no sandbox** (Fases 1 e 2) com o app de teste: polling a cada 30 s com
   `x-polling-merchants`, ack depois de gravar, detalhes antes de confirmar, confirmar em até 8 min,
   `startPreparation`, `readyToPickup` em todos os tipos, `dispatch` só na entrega própria.
3. **Gerar pedidos de teste:** automático (Portal › Testes) e manuais no app em modo de teste —
   dinheiro com troco, cartão na entrega, cartão online, cupom `VOUCHER_ENTGRATIS`, retirada,
   agendado. Conferir na tela: bandeira, troco, cupom e quem paga, observações, código de retirada,
   CPF.
4. **Cancelamento:** buscar `cancellationReasons`, mostrar a lista, cancelar e esperar o
   `CANCELLED`; testar o CARF.
5. **Negociação** (Fase 3): abrir a disputa pelo app do cliente (Ajuda › Pedido chegou errado…) e
   responder aceitar, recusar e contraproposta antes de `expiresAt`.
6. **Medir uso indevido** no Super Admin (Fase 9): ack ≥ 95% (meta ≥ 99%), erro de polling ≤ 1%,
   nenhum pedido com mais de 10 consultas, zero 404/403 repetidos.
7. **Criar o app de produção** (centralizado, PDV) e rodar o assistente de homologação (Order +
   Events). Só o dono do app inicia; uma tentativa a cada 4 h.
8. **Catálogo e Avaliações:** pedir por chamado depois de aprovado.
9. **Financeiro:** chamado para agendar a reunião e responder o questionário com dados do sandbox
   (`x-request-homologation: true`).
10. **Produção:** cada lojista autoriza o app do Comandou no Portal do Parceiro; ligar a loja no
    Comandou; acompanhar as métricas na primeira semana.

## 12. Riscos e dúvidas

**De acesso (preciso de você):**
- A rede deste ambiente de trabalho bloqueia `developer.ifood.com.br` e `merchant-api.ifood.com.br`,
  e o portal do iFood recusa leitores automáticos. Para eu ler as páginas inteiras (estrutura do
  pedido, Plataforma de Negociação) e testar no sandbox, libere esses dois domínios em
  Configurações do projeto › ambiente › Acesso à rede, ou me mande o PDF/print das páginas
  "Order structure" e "Events". Até lá, tudo roda contra o iFood falso dos testes.

**Técnicas (resolvo investigando):**
- Caminho do polling/ack do iFood (Events × Order) e `POST` × `PUT` em `readyToPickup`/`dispatch`:
  conferir no sandbox; ficam num ponto só do adaptador.
- Estrutura exata de `payments`/`total`/`benefits` do iFood: escrever o tipo pela página "Order
  structure" e por pedidos reais do sandbox.
- `payments.cash_session_id` obrigatório e `order_items.product_id` obrigatório: forma `app` com
  sessão opcional e produto técnico "Item do aplicativo" (ADR 0015).
- Presença: polling abre a loja no iFood; só entram no polling as lojas que o restaurante ligou.
- Bloqueio do app inteiro: travas no código + métricas + alertas antes de qualquer loja real.

**De produto (preciso da sua decisão nas fases):**
- Aceite automático vem ligado ou desligado por padrão? (proposta: desligado, com som e contagem)
- Quando o canal cancela um pedido com NFC-e já autorizada: cancelar a nota sozinho (dentro do
  prazo da SEFAZ) ou só avisar? (proposta: cancelar sozinho com a justificativa do canal e avisar)
- Nota de pedido pago no app: emitir sempre, nunca ou só se o restaurante ligar? (depende da
  contabilidade; proposta: configurável, padrão ao concluir)
- Horários da loja: o Comandou manda no iFood (sincroniza) ou só mostra? (Fase 4)
- Avaliações e promoções (Fase 8): vale responder avaliação pelo Comandou?

## 13. As fases, com o que a pesquisa mudou

- **Fase 1** cria também a tela de vínculo de itens (o item sem vínculo nasce já na Fase 2) e a
  base genérica de outbox (não existe hoje).
- **Fase 2** usa polling (webhook do iFood não tem ack e só vale para app centralizado).
- **Fase 5:** a API de Logística do iFood é para empresas de entrega, não para o restaurante; para
  o restaurante valem o despacho, o rastreio do entregador do iFood e o Sob Demanda (Shipping).
- **Fase 8:** não há API de chat com o cliente na documentação lida; avaliações e promoções existem.
- **Fase 11:** a 99Food já tem portal público e é aderente ao Open Delivery.
- **Fase 13:** o aiqfome publicou a documentação (camada Open Delivery e ID Magalu); ver a seção 7.
