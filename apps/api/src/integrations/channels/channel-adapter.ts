import { Injectable } from '@nestjs/common';
import type {
  ChannelAction,
  ChannelCapability,
  ChannelEventKind,
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
}

/** Adaptadores ativos. Cada canal se registra ao subir (e os testes registram o falso). */
@Injectable()
export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  register(a: ChannelAdapter) {
    this.adapters.set(a.id, a);
  }

  get(id: string): ChannelAdapter | undefined {
    return this.adapters.get(id);
  }

  all(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }
}
