import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type {
  ChannelCancelReason,
  ChannelCapability,
  ChannelShift,
  ExternalOrder,
} from '@comandou/shared';
import { ENV, type Env } from '../../config/env';
import {
  ChannelHttpError,
  ChannelRegistry,
  type ActionRequest,
  type ChannelAdapter,
  type ChannelEvent,
  type ChannelPayout,
  type ChannelReview,
  type ChannelReviewSummary,
  type ChannelSaleFinance,
  type ChannelStoreStatus,
  type ChannelTracking,
  type DriverQuote,
  type OrderRef,
  type PollBatch,
  type StoreRef,
} from '../channels/channel-adapter';
import { ChannelHttp, RateGate, type ChannelRequest } from '../channels/channel-http';
import { ChannelMetrics } from '../channels/channel-metrics';
import {
  IFOOD_ACK_BATCH,
  IFOOD_CANCEL_REASONS,
  IFOOD_DEFAULT_CANCEL_CODE,
  IFOOD_LIMITS,
  IFOOD_MAX_PAUSE_MINUTES,
  IFOOD_PATHS,
  ifoodCancelReasons,
  ifoodDispute,
  ifoodEventKind,
  ifoodPatchChanges,
  ifoodSettlement,
  ifoodToExternal,
  ifoodVerb,
  type IfoodOrder,
} from './ifood-order';
import { ifoodDriverUpdate, ifoodQuote, ifoodTracking } from './ifood-delivery';
import {
  IFOOD_FINANCE_PATHS,
  IFOOD_SALES_MAX_PAGES,
  ifoodPayouts,
  ifoodSalesPage,
} from './ifood-finance';
import { ifoodShifts, ifoodStoreStatus } from './ifood-merchant';
import {
  IFOOD_REVIEW_MAX_PAGES,
  IFOOD_REVIEW_PAGE_SIZE,
  IFOOD_REVIEW_PATHS,
  ifoodReviewPage,
  ifoodReviewSummary,
} from './ifood-review';
import { IfoodService } from './ifood.service';

interface IfoodEvent {
  id?: string;
  code?: string;
  fullCode?: string;
  orderId?: string;
  merchantId?: string;
  createdAt?: string;
  salesChannel?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Pedidos do iFood (Events + Order API) pela camada comum de canais. Polling a cada 30 s com até
 * 100 lojas por x-polling-merchants, ack de tudo o que foi gravado, detalhes do pedido e ações
 * (confirmar, preparo, pronto, saiu, cancelar). Token pela IfoodService (o mesmo do cardápio):
 * 401 renova o token uma vez e repete; 4xx nunca se repete (regra do iFood contra bloqueio).
 */
@Injectable()
export class IfoodOrdersAdapter implements ChannelAdapter, OnModuleInit {
  readonly id = 'ifood';
  readonly capabilities: readonly ChannelCapability[] = [
    'orders',
    'polling',
    'confirm',
    'reject',
    'startPreparation',
    'ready',
    'dispatch',
    'cancel',
    'disputes',
    'tracking',
    'courier',
    'storeStatus',
    'pause',
    'openingHours',
    'menu',
    'settlements',
    'reviews',
  ];
  readonly maxPauseMinutes = IFOOD_MAX_PAUSE_MINUTES;
  private readonly http: ChannelHttp;

  constructor(
    @Inject(ENV) env: Env,
    private readonly ifood: IfoodService,
    private readonly registry: ChannelRegistry,
    metrics: ChannelMetrics,
  ) {
    this.http = new ChannelHttp(
      'ifood',
      env.IFOOD_API_URL,
      metrics,
      new RateGate(),
      () => this.ifood.fetcher,
      15_000,
    );
  }

  onModuleInit() {
    this.registry.register(this);
  }

  /** Chamada com o token da credencial; 401 → token novo e uma repetição. */
  private async call<T>(credential: string, tenantId: string, r: Omit<ChannelRequest, 'token'>) {
    for (let attempt = 0; ; attempt++) {
      let token: string;
      try {
        token = await this.ifood.bearer(credential, tenantId);
      } catch (e) {
        const status = (e as { status?: number }).status;
        throw new ChannelHttpError(
          typeof status === 'number' ? status : 0,
          (e as Error).message?.slice(0, 200) || 'Sem token do iFood',
        );
      }
      try {
        return await this.http.request<T>({ ...r, token });
      } catch (e) {
        if (e instanceof ChannelHttpError && e.status === 401 && attempt === 0) {
          this.ifood.forgetBearer(credential, tenantId);
          continue;
        }
        throw e;
      }
    }
  }

  async poll(batch: PollBatch): Promise<ChannelEvent[]> {
    const tenantId = batch.stores[0]?.tenantId ?? '';
    const r = await this.call<IfoodEvent[] | null>(batch.credential, tenantId, {
      endpoint: 'events:polling',
      method: 'GET',
      path: IFOOD_PATHS.polling,
      headers: { 'x-polling-merchants': batch.stores.map((s) => s.storeId).join(',') },
      perMinute: IFOOD_LIMITS.polling,
      // Polling não repete na hora: a próxima rodada (30 s) é a repetição.
      retries: 0,
    });
    const list = Array.isArray(r.body) ? r.body : [];
    const out: ChannelEvent[] = [];
    for (const e of list) {
      if (!e?.id || typeof e.id !== 'string') continue;
      const kind = ifoodEventKind(e.code, e.fullCode);
      out.push({
        id: e.id.slice(0, 120),
        code: String(e.fullCode ?? e.code ?? 'UNKNOWN').slice(0, 60),
        kind,
        storeId: String(e.merchantId ?? '').toLowerCase(),
        ...(e.orderId ? { orderId: String(e.orderId).slice(0, 100) } : {}),
        occurredAt:
          e.createdAt && Number.isFinite(Date.parse(e.createdAt))
            ? e.createdAt
            : new Date().toISOString(),
        // Sem dados pessoais: o pedido é buscado à parte.
        payload: {
          code: e.code ?? null,
          fullCode: e.fullCode ?? null,
          salesChannel: e.salesChannel ?? null,
          // Negociação: só o necessário para responder (prazo, alternativas, motivos).
          ...(kind === 'order.dispute' ? { dispute: ifoodDispute(e.metadata) } : {}),
          ...(kind === 'delivery.update'
            ? { delivery: ifoodDriverUpdate(e.code, e.fullCode, e.metadata) }
            : {}),
          ...(kind === 'order.dispute_settled' ? { settlement: ifoodSettlement(e.metadata) } : {}),
          // Pedido alterado pelo cliente: só o tipo da mudança (o endereço novo não é guardado).
          ...(kind === 'order.patched' ? { changes: ifoodPatchChanges(e.metadata) } : {}),
        },
      });
    }
    return out;
  }

  async ack(batch: PollBatch, events: ChannelEvent[]) {
    const tenantId = batch.stores[0]?.tenantId ?? '';
    for (let i = 0; i < events.length; i += IFOOD_ACK_BATCH) {
      const part = events.slice(i, i + IFOOD_ACK_BATCH);
      await this.call(batch.credential, tenantId, {
        endpoint: 'events:ack',
        method: 'POST',
        path: IFOOD_PATHS.ack,
        json: part.map((e) => ({ id: e.id })),
        perMinute: IFOOD_LIMITS.ack,
        retries: 2,
      });
    }
  }

  async fetchOrder(ref: OrderRef): Promise<ExternalOrder> {
    const r = await this.call<IfoodOrder>(ref.credential, ref.tenantId, {
      endpoint: 'orders:details',
      method: 'GET',
      path: IFOOD_PATHS.order(ref.externalOrderId),
      perMinute: IFOOD_LIMITS.order,
      // Cada consulta conta no limite de 10 por pedido: a repetição fica com a caixa de entrada.
      retries: 0,
    });
    if (!r.body || typeof r.body !== 'object' || !r.body.id)
      throw new ChannelHttpError(502, 'O iFood devolveu o pedido vazio');
    const o = ifoodToExternal(r.body);
    if (!o.storeId) o.storeId = ref.storeId;
    return o;
  }

  /** Motivos que o iFood aceita para cancelar este pedido (a lista muda por pedido). */
  async cancellationReasons(ref: OrderRef): Promise<ChannelCancelReason[]> {
    try {
      const r = await this.call<unknown>(ref.credential, ref.tenantId, {
        endpoint: 'orders:cancellationReasons',
        method: 'GET',
        path: IFOOD_PATHS.cancelReasons(ref.externalOrderId),
        perMinute: IFOOD_LIMITS.cancellation,
        retries: 0,
      });
      const list = ifoodCancelReasons(r.body);
      return list.length ? list : IFOOD_CANCEL_REASONS;
    } catch {
      return IFOOD_CANCEL_REASONS;
    }
  }

  /** Situação da loja (operação de entrega) e a pausa ativa, numa leitura de cada. */
  async storeStatus(ref: StoreRef): Promise<ChannelStoreStatus> {
    const status = await this.call<unknown>(ref.credential, ref.tenantId, {
      endpoint: 'merchant:status',
      method: 'GET',
      path: IFOOD_PATHS.status(ref.storeId),
      perMinute: IFOOD_LIMITS.status,
      retries: 0,
    });
    const pauses = await this.call<unknown>(ref.credential, ref.tenantId, {
      endpoint: 'merchant:interruptions',
      method: 'GET',
      path: IFOOD_PATHS.interruptions(ref.storeId),
      perMinute: IFOOD_LIMITS.interruptions,
      retries: 0,
    });
    return ifoodStoreStatus(status.body, pauses.body);
  }

  /** Pausa = interrupção no iFood (de 1 minuto a 7 dias), com o id gerado aqui. */
  async pauseStore(ref: StoreRef, p: { id: string; reason: string; until: string }) {
    await this.call(ref.credential, ref.tenantId, {
      endpoint: 'merchant:interruptions:create',
      method: 'POST',
      path: IFOOD_PATHS.interruptions(ref.storeId),
      json: {
        id: p.id,
        description: p.reason.slice(0, 200),
        start: new Date().toISOString(),
        end: p.until,
      },
      perMinute: IFOOD_LIMITS.interruptions,
      retries: 0,
    });
    return p.id;
  }

  async resumeStore(ref: StoreRef, pauseId: string) {
    try {
      await this.call(ref.credential, ref.tenantId, {
        endpoint: 'merchant:interruptions:delete',
        method: 'DELETE',
        path: IFOOD_PATHS.interruption(ref.storeId, pauseId),
        perMinute: IFOOD_LIMITS.interruptions,
        retries: 0,
      });
    } catch (e) {
      // Já não existe (venceu ou tiraram no portal): a loja já está sem essa pausa.
      if (!(e instanceof ChannelHttpError && e.status === 404)) throw e;
    }
  }

  async openingHours(ref: StoreRef): Promise<ChannelShift[]> {
    const r = await this.call<unknown>(ref.credential, ref.tenantId, {
      endpoint: 'merchant:opening-hours',
      method: 'GET',
      path: IFOOD_PATHS.openingHours(ref.storeId),
      perMinute: IFOOD_LIMITS.openingHours,
      retries: 0,
    });
    return ifoodShifts(r.body);
  }

  /**
   * Vendas do período na API financeira (no máximo 8 dias por chamada; 204 = nenhuma). Uma página
   * por vez, sem repetir na hora (a próxima varredura repete).
   */
  async financeSales(ref: StoreRef, from: string, to: string): Promise<ChannelSaleFinance[]> {
    const out: ChannelSaleFinance[] = [];
    for (let page = 1, pages = 1; page <= pages && page <= IFOOD_SALES_MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        beginSalesDate: from,
        endSalesDate: to,
        page: String(page),
      });
      const r = await this.call<unknown>(ref.credential, ref.tenantId, {
        endpoint: 'financial:sales',
        method: 'GET',
        path: `${IFOOD_FINANCE_PATHS.sales(ref.storeId)}?${qs}`,
        perMinute: IFOOD_LIMITS.financial,
        retries: 1,
      });
      if (r.status === 204 || !r.body) break;
      const p = ifoodSalesPage(r.body);
      out.push(...p.sales);
      pages = p.pageCount;
    }
    return out;
  }

  /** Repasses com data de pagamento no período (sem os dados da conta bancária). */
  async financePayouts(ref: StoreRef, from: string, to: string): Promise<ChannelPayout[]> {
    const qs = new URLSearchParams({ beginPaymentDate: from, endPaymentDate: to });
    const r = await this.call<unknown>(ref.credential, ref.tenantId, {
      endpoint: 'financial:settlements',
      method: 'GET',
      path: `${IFOOD_FINANCE_PATHS.settlements(ref.storeId)}?${qs}`,
      perMinute: IFOOD_LIMITS.financial,
      retries: 1,
    });
    return r.status === 204 ? [] : ifoodPayouts(ref.storeId, r.body);
  }

  /** Avaliações desde `since`, da mais nova para a mais antiga (até 10 páginas de 50). */
  async reviews(ref: StoreRef, since: string): Promise<ChannelReview[]> {
    const out: ChannelReview[] = [];
    for (let page = 1, pages = 1; page <= pages && page <= IFOOD_REVIEW_MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(IFOOD_REVIEW_PAGE_SIZE),
        addCount: 'true',
        dateFrom: since,
        dateTo: new Date().toISOString(),
        sort: 'DESC',
        sortBy: 'CREATED_AT',
      });
      const r = await this.call<unknown>(ref.credential, ref.tenantId, {
        endpoint: 'review:list',
        method: 'GET',
        path: `${IFOOD_REVIEW_PATHS.list(ref.storeId)}?${qs}`,
        perMinute: IFOOD_LIMITS.reviews,
        retries: 1,
      });
      if (r.status === 204 || !r.body) break;
      const p = ifoodReviewPage(r.body);
      out.push(...p.reviews);
      pages = p.pageCount;
    }
    return out;
  }

  /** Nota média (404 = loja ainda sem avaliação). */
  async reviewSummary(ref: StoreRef): Promise<ChannelReviewSummary | null> {
    try {
      const r = await this.call<unknown>(ref.credential, ref.tenantId, {
        endpoint: 'review:summary',
        method: 'GET',
        path: IFOOD_REVIEW_PATHS.summary(ref.storeId),
        perMinute: IFOOD_LIMITS.reviews,
        retries: 1,
      });
      return ifoodReviewSummary(r.body);
    } catch (e) {
      if (e instanceof ChannelHttpError && e.status === 404) return null;
      throw e;
    }
  }

  /** Resposta da loja (uma por avaliação; o iFood recusa se já respondida). Sem repetir. */
  async replyReview(ref: StoreRef, reviewId: string, text: string) {
    await this.call(ref.credential, ref.tenantId, {
      endpoint: 'review:answer',
      method: 'POST',
      path: IFOOD_REVIEW_PATHS.answer(ref.storeId, reviewId),
      json: { text },
      perMinute: IFOOD_LIMITS.reviews,
      retries: 0,
    });
  }

  /** Previsões do entregador do iFood (404 antes de ele existir = sem previsão ainda). */
  async tracking(ref: OrderRef): Promise<ChannelTracking | null> {
    try {
      const r = await this.call<unknown>(ref.credential, ref.tenantId, {
        endpoint: 'orders:tracking',
        method: 'GET',
        path: IFOOD_PATHS.tracking(ref.externalOrderId),
        perMinute: IFOOD_LIMITS.tracking,
        retries: 0,
      });
      return ifoodTracking(r.body);
    } catch (e) {
      if (e instanceof ChannelHttpError && e.status === 404) return null;
      throw e;
    }
  }

  async quoteDriver(ref: OrderRef): Promise<DriverQuote> {
    const r = await this.call<unknown>(ref.credential, ref.tenantId, {
      endpoint: 'shipping:deliveryAvailabilities',
      method: 'GET',
      path: IFOOD_PATHS.shipping(ref.externalOrderId, 'deliveryAvailabilities'),
      perMinute: IFOOD_LIMITS.shipping,
      retries: 0,
    });
    const q = ifoodQuote(r.body);
    if (!q) throw new ChannelHttpError(422, 'O iFood não mandou uma cotação válida');
    return q;
  }

  async requestDriver(ref: OrderRef, quoteId: string) {
    await this.call(ref.credential, ref.tenantId, {
      endpoint: 'shipping:requestDriver',
      method: 'POST',
      path: IFOOD_PATHS.shipping(ref.externalOrderId, 'requestDriver'),
      json: { quoteId },
      perMinute: IFOOD_LIMITS.shipping,
      retries: 0,
    });
  }

  async cancelDriver(ref: OrderRef, c: { code?: string; reason: string }) {
    await this.call(ref.credential, ref.tenantId, {
      endpoint: 'shipping:cancelRequestDriver',
      method: 'POST',
      path: IFOOD_PATHS.shipping(ref.externalOrderId, 'cancelRequestDriver'),
      json: {
        reason: c.reason.slice(0, 250),
        ...(c.code ? { cancellationCode: c.code } : {}),
      },
      perMinute: IFOOD_LIMITS.shipping,
      retries: 0,
    });
  }

  async driverCancelReasons(ref: OrderRef): Promise<ChannelCancelReason[]> {
    try {
      const r = await this.call<unknown>(ref.credential, ref.tenantId, {
        endpoint: 'shipping:cancellationReasons',
        method: 'GET',
        path: IFOOD_PATHS.shipping(ref.externalOrderId, 'cancellationReasons'),
        perMinute: IFOOD_LIMITS.shipping,
        retries: 0,
      });
      return ifoodCancelReasons(r.body);
    } catch {
      return [];
    }
  }

  async send(req: ActionRequest) {
    const verb = ifoodVerb(req.action);
    if (!verb) return;
    if (verb === 'dispute') return this.sendDispute(req);
    const cancel = verb === 'requestCancellation';
    const reason = typeof req.payload.reason === 'string' ? req.payload.reason.trim() : '';
    const code =
      typeof req.payload.cancellationCode === 'string' &&
      /^[A-Za-z0-9_-]{1,40}$/.test(req.payload.cancellationCode)
        ? req.payload.cancellationCode
        : IFOOD_DEFAULT_CANCEL_CODE;
    await this.call(req.credential, req.tenantId, {
      endpoint: `orders:${verb}`,
      method: 'POST',
      path: IFOOD_PATHS.action(req.externalOrderId, verb),
      ...(cancel
        ? {
            json: {
              reason: (reason || 'Pedido cancelado pelo restaurante').slice(0, 250),
              cancellationCode: code,
            },
          }
        : {}),
      perMinute: cancel ? IFOOD_LIMITS.cancellation : IFOOD_LIMITS.action,
      // A caixa de saída repete com espera crescente (5xx/429); aqui não.
      retries: 0,
    });
  }

  /** Resposta à negociação: aceitar, recusar ou propor uma alternativa (valores em centavos). */
  private async sendDispute(req: ActionRequest) {
    const p = req.payload as {
      disputeId?: string;
      reason?: string;
      alternativeId?: string;
      type?: string;
      amountCents?: number;
      minutes?: number;
      timeReason?: string;
    };
    if (!p.disputeId) throw new ChannelHttpError(400, 'Negociação sem id');
    const reason = p.reason?.trim().slice(0, 250);
    let path: string;
    let json: Record<string, unknown> = {};
    if (req.action === 'dispute_alternative') {
      if (!p.alternativeId) throw new ChannelHttpError(400, 'Proposta sem alternativa');
      path = IFOOD_PATHS.alternative(p.disputeId, p.alternativeId);
      json =
        p.type === 'ADDITIONAL_TIME'
          ? {
              type: p.type,
              metadata: {
                additionalTimeInMinutes: String(p.minutes ?? ''),
                ...(p.timeReason ? { additionalTimeReason: p.timeReason } : {}),
              },
            }
          : {
              type: p.type,
              metadata: { amount: { value: String(p.amountCents ?? 0), currency: 'BRL' } },
            };
    } else {
      path = IFOOD_PATHS.dispute(
        p.disputeId,
        req.action === 'dispute_accept' ? 'accept' : 'reject',
      );
      if (reason) json = { reason };
    }
    await this.call(req.credential, req.tenantId, {
      endpoint: `disputes:${req.action.replace('dispute_', '')}`,
      method: 'POST',
      path,
      json,
      perMinute: IFOOD_LIMITS.dispute,
      retries: 0,
    });
  }
}
