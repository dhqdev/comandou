import { isCustomOd } from '@comandou/shared';
import { Injectable } from '@nestjs/common';
import type {
  ChannelAction,
  ChannelCancelReason,
  ChannelCapability,
  ChannelEventKind,
  ChannelShift,
  ChannelStoreState,
  DisputeAlternative,
  DriverStatus,
  ExternalOrder,
} from '@comandou/shared';

/**
 * Contrato de um aplicativo de delivery (ADR 0015). Cada canal (iFood, Keeta, 99Food, Rappi,
 * aiqfome, Open Delivery) tem um adaptador que só TRADUZ: busca eventos, confirma o recebimento,
 * busca os detalhes de um pedido e manda as ações. Regras de pedido, estoque, cozinha, caixa e
 * nota ficam no Comandou e são as mesmas para todos os canais.
 */

/** Loja do canal num lote de polling (até 100 por chamada). */
export interface PollStore {
  storeId: string;
  tenantId: string;
  /** channel_stores.id no banco do restaurante. */
  storeRef: string;
}

export interface PollBatch {
  /** Quem busca: 'ifood:central' (um token para todas) ou uma credencial por loja. */
  credential: string;
  stores: PollStore[];
}

/** Evento como o canal mandou, já com o tipo normalizado. */
export interface ChannelEvent {
  /** Id do evento no canal (único no canal; a caixa de entrada não grava duas vezes). */
  id: string;
  /** Código como veio (PLC, CREATED, NEW_ORDER…). */
  code: string;
  kind: ChannelEventKind;
  storeId: string;
  orderId?: string;
  occurredAt: string;
  /** O que guardar do evento, SEM dados pessoais (o pedido em si é buscado à parte). */
  payload?: Record<string, unknown>;
}

/**
 * Negociação aberta pelo cliente depois do pedido (cancelar, reembolso, mais tempo), já traduzida.
 * Vai no `payload.dispute` do evento `order.dispute`. Sem fotos nem dados do cliente.
 */
export interface ChannelDispute {
  externalId: string;
  kind: string;
  message?: string;
  expiresAt?: string;
  timeoutAction?: string;
  alternatives: DisputeAlternative[];
  acceptReasons: string[];
}

/** Fim da negociação (`payload.settlement` do evento `order.dispute_settled`). */
export interface ChannelSettlement {
  externalId: string;
  outcome: string;
}

/** Ação que sai pela caixa de saída. */
export interface ActionRequest {
  tenantId: string;
  storeId: string;
  credential: string;
  externalOrderId: string;
  action: ChannelAction;
  payload: Record<string, unknown>;
}

/** Onde buscar um pedido. */
export interface OrderRef {
  tenantId: string;
  storeId: string;
  credential: string;
  externalOrderId: string;
}

/**
 * Aviso do entregador do canal (vai no `payload.delivery` do evento `delivery.update`). Só o
 * primeiro nome e o veículo: nada de telefone, foto ou documento.
 */
export interface ChannelDriverUpdate {
  status: DriverStatus;
  name?: string;
  vehicle?: string;
}

/** Rastreio do entregador do canal: só as previsões (a posição não é guardada). */
export interface ChannelTracking {
  /** Quando deve chegar no cliente. */
  eta?: string;
  /** Quando deve chegar na loja para buscar. */
  pickupEta?: string;
}

/** Cotação de entregador do canal para um pedido com entrega da loja (Sob Demanda). */
export interface DriverQuote {
  id: string;
  /** Valor cobrado do restaurante (string decimal). */
  fee: string;
  minMinutes?: number;
  maxMinutes?: number;
  distanceM?: number;
  expiresAt?: string;
}

/**
 * O que uma venda rende no canal (API financeira). Valores em texto decimal. `net` e `fees` ficam
 * null enquanto o canal não fecha a conta da venda.
 */
export interface ChannelSaleFinance {
  externalId: string;
  /** Itens + entrega cobrada do cliente. */
  gross: string;
  /** O que fica com o restaurante. */
  net: string | null;
  /** Bruto − líquido (comissão, taxa de pagamento, entrega do canal, promoções…). */
  fees: string | null;
  /** Lançamentos do canal (só tipo e valor). */
  entries: { label: string; amount: string }[];
}

/** Um repasse do canal (dinheiro que cai na conta do restaurante). Sem dados da conta. */
export interface ChannelPayout {
  externalId: string;
  kind: string;
  periodStart?: string;
  periodEnd?: string;
  /** Quando cai (AAAA-MM-DD). */
  expectedDate: string;
  /** Quanto cai (pode ser negativo: débito do canal). */
  amount: string;
  originalAmount?: string;
  originalDate?: string;
  anticipationFee?: string;
  status: 'scheduled' | 'paid' | 'failed';
  channelStatus?: string;
}

/** Avaliação do cliente no canal. Do cliente, só o primeiro nome. */
export interface ChannelReview {
  externalId: string;
  /** Nota de 0 a 5. */
  score: number;
  comment?: string;
  customerName?: string;
  /** Situação no canal (iFood: NOT_REPLIED, REPLIED, PUBLISHED…). */
  status?: string;
  createdAt: string;
  orderExternalId?: string;
  orderCode?: string;
  /** Resposta da loja já publicada (feita aqui ou no portal). */
  reply?: { text: string; at: string };
  canReply: boolean;
}

export interface ChannelReviewSummary {
  score: number;
  count?: number;
}

/** Uma loja no canal (situação, pausa, horários). */
export interface StoreRef {
  tenantId: string;
  storeId: string;
  credential: string;
}

/** Situação da loja no canal, já traduzida. */
export interface ChannelStoreStatus {
  state: ChannelStoreState;
  /** Frase do canal (ex.: "Loja fechada", "Fora do horário"). */
  title?: string;
  detail?: string;
  /** Pausa ativa no canal (feita pelo Comandou ou no portal do aplicativo). */
  pause?: { id: string; until?: string; reason?: string } | null;
}

/**
 * Erro de uma chamada ao canal. 0 = rede/tempo esgotado. Repetir só em rede, 429 e 5xx; 4xx
 * nunca se repete (o canal recusou: repetir só aumenta a taxa de erro e pode bloquear o app).
 */
export class ChannelHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface ChannelAdapter {
  readonly id: string;
  readonly capabilities: readonly ChannelCapability[];
  /** Busca os eventos novos das lojas do lote. Sem polling (só webhook): não implementa. */
  poll?(batch: PollBatch): Promise<ChannelEvent[]>;
  /** Confirma o recebimento (só dos eventos já gravados), com a credencial e as lojas do lote. */
  ack?(batch: PollBatch, events: ChannelEvent[]): Promise<void>;
  /** Detalhes do pedido, traduzidos para o pedido normalizado. */
  fetchOrder(ref: OrderRef): Promise<ExternalOrder>;
  /** Manda uma ação. Erro → ChannelHttpError (a caixa de saída decide se repete). */
  send(req: ActionRequest): Promise<void>;
  /**
   * O aplicativo não tem esta ação para este tipo de pedido (ex.: "pronto para retirar" só na
   * retirada do aiqfome): a caixa de saída nem grava, para a tela não mostrar "enviado".
   */
  skipsAction?(action: ChannelAction, orderType: string): boolean;
  /** Motivos de cancelamento aceitos para este pedido (sem isso, a tela pede só o texto). */
  cancellationReasons?(ref: OrderRef): Promise<ChannelCancelReason[]>;
  /** Situação da loja (aberta, fechada, pausada). Leia com calma: a varredura e a tela já espaçam. */
  storeStatus?(ref: StoreRef): Promise<ChannelStoreStatus>;
  /** Pausa a loja no canal até `until` (id da pausa gerado pelo Comandou, quando o canal aceita). */
  pauseStore?(ref: StoreRef, p: { id: string; reason: string; until: string }): Promise<string>;
  /** Tira a pausa feita antes. */
  resumeStore?(ref: StoreRef, pauseId: string): Promise<void>;
  /** Pausa mais longa que o canal aceita, em minutos (iFood: 7 dias). */
  readonly maxPauseMinutes?: number;
  /** Horários de funcionamento cadastrados no canal (só para mostrar). */
  openingHours?(ref: StoreRef): Promise<ChannelShift[]>;
  /** Previsões do entregador do canal (no iFood, no máximo uma chamada a cada 30 s por pedido). */
  tracking?(ref: OrderRef): Promise<ChannelTracking | null>;
  /** Cotação de entregador do canal para pedido com entrega da loja. */
  quoteDriver?(ref: OrderRef): Promise<DriverQuote>;
  /** Chama o entregador com a cotação aceita. */
  requestDriver?(ref: OrderRef, quoteId: string): Promise<void>;
  /** Cancela o entregador chamado. */
  cancelDriver?(ref: OrderRef, c: { code?: string; reason: string }): Promise<void>;
  /** Motivos aceitos para cancelar o entregador chamado. */
  driverCancelReasons?(ref: OrderRef): Promise<ChannelCancelReason[]>;
  /** Vendas do período (AAAA-MM-DD, até 8 dias no iFood) com o que cada pedido rende. */
  financeSales?(ref: StoreRef, from: string, to: string): Promise<ChannelSaleFinance[]>;
  /** Repasses com data de pagamento no período (AAAA-MM-DD). */
  financePayouts?(ref: StoreRef, from: string, to: string): Promise<ChannelPayout[]>;
  /** Avaliações feitas a partir de `since` (ISO), da mais nova para a mais antiga. */
  reviews?(ref: StoreRef, since: string): Promise<ChannelReview[]>;
  /** Nota média da loja no canal (null = ainda sem avaliação). */
  reviewSummary?(ref: StoreRef): Promise<ChannelReviewSummary | null>;
  /** Publica a resposta da loja (texto escrito por uma pessoa). */
  replyReview?(ref: StoreRef, reviewId: string, text: string): Promise<void>;
}

/** Adaptadores ativos. Cada canal se registra ao subir (e os testes registram o falso). */
@Injectable()
export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  register(a: ChannelAdapter) {
    this.adapters.set(a.id, a);
  }

  /** Aplicativo Open Delivery apagado no Super Admin: para de buscar e de mandar ações. */
  unregister(id: string) {
    this.adapters.delete(id);
  }

  get(id: string): ChannelAdapter | undefined {
    return this.adapters.get(id);
  }

  all(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * Nome dado no Super Admin a cada aplicativo Open Delivery cadastrado (`od-<nome>` → "Anota
   * AI"), para telas e relatórios que só têm o id do canal. Os conhecidos têm nome fixo no shared.
   */
  labels(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const a of this.adapters.values()) {
      const label = (a as { label?: string }).label;
      if (label && isCustomOd(a.id)) out[a.id] = label;
    }
    return out;
  }
}
