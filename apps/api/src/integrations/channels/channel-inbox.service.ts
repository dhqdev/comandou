import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  canTransition,
  channelPath,
  statusForEvent,
  toCents,
  type ChannelAction,
  type ChannelEventKind,
  type ExternalOrder,
  type OrderStatus,
} from '@comandou/shared';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import { OrdersService } from '../../orders/orders.service';
import { QueueService } from '../../queue/queue.service';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  ChannelHttpError,
  ChannelRegistry,
  type ChannelEvent,
  type PollStore,
} from './channel-adapter';
import { ChannelDisputesService } from './channel-disputes.service';
import type { ChannelDispute, ChannelSettlement } from './channel-adapter';
import { ChannelMetrics } from './channel-metrics';
import { ChannelOutboxService } from './channel-outbox.service';
import { channelCtx, STORE_COLUMNS, type StoreRow } from './channel-stores.service';
import { ExternalOrdersService } from './external-orders.service';

export const PROCESS_JOB = 'channels.process';
/** Depois disso o evento fica "falhou" e aparece na tela. */
export const INBOX_MAX_ATTEMPTS = 8;
/** O iFood bloqueia quem consulta o mesmo pedido mais de 10 vezes. */
export const MAX_ORDER_LOOKUPS = 10;

export type StoreResult = 'stored' | 'duplicate' | 'orphan' | 'unavailable';

interface InboxRow {
  id: string;
  channel: string;
  event_id: string;
  kind: ChannelEventKind;
  store_id: string;
  external_order_id: string | null;
  attempts: number;
  occurred_at: Date;
  payload: Record<string, unknown> | null;
}

/** Evento do canal → ação nossa que ele confirma (a caixa de saída marca "confirmado"). */
const CONFIRMS: Partial<Record<ChannelEventKind, ChannelAction[]>> = {
  'order.confirmed': ['confirm'],
  'order.preparing': ['start_preparation'],
  'order.ready': ['ready'],
  'order.dispatched': ['dispatch'],
  'order.delivered': ['delivered'],
  'order.concluded': ['delivered'],
  'order.cancelled': ['reject', 'request_cancellation'],
  'order.cancellation_denied': ['request_cancellation'],
  'order.dispute_settled': ['dispute_accept', 'dispute_reject', 'dispute_alternative'],
};

/** Espera até a próxima tentativa de um evento: 10 s, 20 s, 40 s… até 15 min. */
export function inboxBackoffSeconds(attempts: number) {
  return Math.min(900, 10 * 2 ** Math.max(0, attempts - 1));
}

class Unavailable extends Error {}

/**
 * Caixa de entrada: cada evento do canal é gravado cru no banco do restaurante (uma vez só, pelo
 * id do evento) ANTES do ack. Depois é tratado em ordem por pedido, tolerando evento repetido,
 * fora de ordem e queda no meio (o que não terminou volta sozinho).
 */
@Injectable()
export class ChannelInboxService implements OnModuleInit {
  private readonly logger = new Logger('ChannelsInbox');
  private readonly running = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly ingest: ExternalOrdersService,
    private readonly outbox: ChannelOutboxService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeService,
    private readonly registry: ChannelRegistry,
    private readonly disputes: ChannelDisputesService,
    private readonly metrics: ChannelMetrics,
  ) {}

  onModuleInit() {
    this.queue.register(PROCESS_JOB, (d) => this.process(d.tenantId).then(() => undefined));
  }

  kick(tenantId: string, delayMs = 0) {
    void this.queue.add(PROCESS_JOB, { tenantId }, { delayMs, attempts: 1 }).catch(() => undefined);
  }

  /**
   * Grava os eventos de um lote no banco de cada restaurante e diz o que dá para confirmar (ack).
   * Banco do restaurante fora do ar ou em manutenção: "unavailable", sem ack (o canal manda de novo).
   */
  async store(
    channel: string,
    events: ChannelEvent[],
    stores: Map<string, PollStore>,
  ): Promise<Map<string, StoreResult>> {
    const out = new Map<string, StoreResult>();
    const byTenant = new Map<string, { store: PollStore; ev: ChannelEvent }[]>();
    for (const ev of events) {
      const s = stores.get(ev.storeId.toLowerCase());
      if (!s) {
        out.set(ev.id, 'orphan');
        continue;
      }
      const list = byTenant.get(s.tenantId) ?? [];
      list.push({ store: s, ev });
      byTenant.set(s.tenantId, list);
    }
    for (const [tenantId, list] of byTenant) {
      try {
        const results = await this.db.withTenant({ tenantId }, async (tx) => {
          const r: [string, StoreResult][] = [];
          for (const { store, ev } of list) {
            const row = await one(
              tx,
              `INSERT INTO channel_inbox (tenant_id, channel, event_id, event_code, kind, store_id,
                                          external_order_id, occurred_at, payload)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (tenant_id, channel, event_id) DO NOTHING RETURNING id`,
              [
                tenantId,
                channel,
                ev.id.slice(0, 200),
                ev.code.slice(0, 80),
                ev.kind,
                store.storeId,
                ev.orderId?.slice(0, 100) ?? null,
                ev.occurredAt,
                ev.payload ?? null,
              ],
            );
            r.push([ev.id, row ? 'stored' : 'duplicate']);
          }
          const refs = [...new Set(list.map((x) => x.store.storeRef))];
          await q(
            tx,
            `UPDATE channel_stores SET last_event_at = now() WHERE id = ANY($1::uuid[])`,
            [refs],
          );
          return r;
        });
        for (const [id, res] of results) out.set(id, res);
        if (results.some(([, r]) => r === 'stored')) this.kick(tenantId);
      } catch (e) {
        this.logger.warn(`eventos de ${channel} não gravados (sem ack): ${(e as Error).message}`);
        for (const { ev } of list) out.set(ev.id, 'unavailable');
      }
    }
    for (const r of out.values()) this.metrics.events.inc({ channel, result: r });
    if (events.length) this.metrics.lastEvent.set({ channel }, Date.now() / 1000);
    return out;
  }

  /**
   * Trata os eventos vencidos deste restaurante. Cada evento pego ganha 2 min de "reserva": se o
   * processo cair no meio, ele volta sozinho. Por pedido, na ordem em que aconteceram; se um falha,
   * os seguintes do mesmo pedido esperam a próxima rodada.
   */
  async process(tenantId: string): Promise<number> {
    if (this.running.has(tenantId)) return 0;
    this.running.add(tenantId);
    let done = 0;
    try {
      for (let round = 0; round < 10; round++) {
        const due = await this.db.withTenant({ tenantId }, (tx) =>
          q<InboxRow>(
            tx,
            `UPDATE channel_inbox x
                SET attempts = x.attempts + 1, next_attempt_at = now() + interval '2 minutes'
               FROM (SELECT id FROM channel_inbox
                      WHERE status = 'pending' AND next_attempt_at <= now()
                      ORDER BY occurred_at, received_at LIMIT 100
                      FOR UPDATE SKIP LOCKED) d
              WHERE x.id = d.id
              RETURNING x.id, x.channel, x.event_id, x.kind, x.store_id, x.external_order_id,
                        x.attempts, x.occurred_at, x.payload`,
          ),
        );
        if (!due.length) break;
        // Agrupa por pedido mantendo a ordem dos acontecimentos.
        const sorted = [...due].sort((a, b) => +a.occurred_at - +b.occurred_at);
        const groups = new Map<string, InboxRow[]>();
        for (const r of sorted) {
          const k = `${r.channel}:${r.external_order_id ?? r.id}`;
          groups.set(k, [...(groups.get(k) ?? []), r]);
        }
        for (const list of groups.values()) {
          for (const [i, ev] of list.entries()) {
            const ok = await this.handleSafely(tenantId, ev);
            if (ok) done++;
            else {
              // Os seguintes do mesmo pedido voltam junto com este (ordem preservada).
              const rest = list.slice(i + 1).map((r) => r.id);
              if (rest.length)
                await this.db.withTenant({ tenantId }, (tx) =>
                  q(
                    tx,
                    `UPDATE channel_inbox SET attempts = GREATEST(attempts - 1, 0),
                            next_attempt_at = (SELECT next_attempt_at FROM channel_inbox WHERE id = $2)
                      WHERE id = ANY($1::uuid[]) AND status = 'pending'`,
                    [rest, ev.id],
                  ),
                );
              break;
            }
          }
        }
        if (due.length < 100) break;
      }
    } finally {
      this.running.delete(tenantId);
    }
    if (done) this.realtime.publish(tenantId, { type: 'channels.changed' });
    return done;
  }

  private async handleSafely(tenantId: string, ev: InboxRow): Promise<boolean> {
    try {
      const result = await this.handle(tenantId, ev);
      this.metrics.processed.inc({ channel: ev.channel, result });
      return true;
    } catch (e) {
      const err = e as Error;
      // 4xx do canal ao buscar o pedido (ex.: 404) não melhora repetindo muitas vezes.
      const final =
        ev.attempts >= INBOX_MAX_ATTEMPTS ||
        (e instanceof ChannelHttpError && !e.retryable && ev.attempts >= 3);
      await this.db
        .withTenant({ tenantId }, (tx) =>
          q(
            tx,
            `UPDATE channel_inbox SET status = $2, last_error = $3,
                    next_attempt_at = now() + make_interval(secs => $4)
              WHERE id = $1 AND status = 'pending'`,
            [
              ev.id,
              final ? 'failed' : 'pending',
              (err.message || 'falha').slice(0, 300),
              inboxBackoffSeconds(ev.attempts),
            ],
          ),
        )
        .catch(() => undefined);
      this.metrics.processed.inc({ channel: ev.channel, result: final ? 'failed' : 'retry' });
      if (final) this.logger.warn(`evento ${ev.kind} de ${ev.channel} falhou de vez`);
      return false;
    }
  }

  /** Um evento. Devolve 'done' ou 'ignored'. Erro → nova tentativa. */
  private async handle(tenantId: string, ev: InboxRow): Promise<'done' | 'ignored'> {
    const mark = (tx: Tx, status: 'done' | 'ignored', note?: string) =>
      q(
        tx,
        `UPDATE channel_inbox SET status = $2, processed_at = now(), last_error = $3 WHERE id = $1`,
        [ev.id, status, note ?? null],
      );
    if (!ev.external_order_id || ev.kind === 'other' || ev.kind === 'delivery.update') {
      await this.db.withTenant({ tenantId }, (tx) => mark(tx, 'ignored'));
      return 'ignored';
    }
    const known = await this.db.withTenant({ tenantId }, async (tx) => {
      const store = await one<StoreRow>(
        tx,
        `SELECT ${STORE_COLUMNS} FROM channel_stores WHERE channel = $1 AND store_id = $2`,
        [ev.channel, ev.store_id],
      );
      const link = await one<{ order_id: string }>(
        tx,
        `SELECT order_id FROM channel_orders WHERE channel = $1 AND external_id = $2`,
        [ev.channel, ev.external_order_id],
      );
      return { store, link };
    });
    if (!known.store) {
      await this.db.withTenant({ tenantId }, (tx) => mark(tx, 'ignored', 'Loja desligada'));
      return 'ignored';
    }
    // Pedido que não conhecemos: busca os detalhes e entra (mesmo que o primeiro evento que
    // chegou seja "confirmado" ou "pronto": evento fora de ordem). Cancelado ou concluído antes
    // de chegar aqui não vira pedido (nada para fazer na cozinha).
    let orderId = known.link?.order_id;
    let fresh: ExternalOrder | null = null;
    if (!orderId) {
      if (['order.cancelled', 'order.concluded', 'order.delivered'].includes(ev.kind)) {
        await this.db.withTenant({ tenantId }, (tx) =>
          mark(tx, 'ignored', 'Pedido encerrado no aplicativo antes de chegar'),
        );
        return 'ignored';
      }
      fresh = await this.fetchOrder(tenantId, known.store, ev.external_order_id);
    }
    const fx = { stock: 0, print: 0 };
    let created = false;
    let attention: string | undefined;
    await this.db.withTenant({ tenantId }, async (tx) => {
      if (fresh) {
        const r = await this.ingest.ingestInTx(tx, tenantId, known.store!, fresh, fx);
        orderId = r.orderId;
        created = r.created;
      }
      attention = await this.applyInTx(tx, tenantId, orderId!, ev);
      await mark(tx, 'done', attention);
    });
    if (created) this.ingest.afterCommit(tenantId, orderId!, fx);
    else this.orders.publishChanged(tenantId, orderId!, { stock: true, print: true });
    return 'done';
  }

  /** Busca o pedido no canal, no máximo 10 vezes por pedido (regra do iFood). */
  private async fetchOrder(tenantId: string, store: StoreRow, externalId: string) {
    const adapter = this.registry.get(store.channel);
    if (!adapter) throw new Error('Aplicativo não disponível neste servidor');
    const count = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ lookups: number }>(
        tx,
        `INSERT INTO channel_order_lookups (tenant_id, channel, external_id, lookups)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (tenant_id, channel, external_id) DO UPDATE
           SET lookups = channel_order_lookups.lookups + 1, last_at = now()
           WHERE channel_order_lookups.lookups < $4
         RETURNING lookups`,
        [tenantId, store.channel, externalId, MAX_ORDER_LOOKUPS],
      ),
    );
    if (!count) {
      this.metrics.lookupsBlocked.inc({ channel: store.channel });
      throw new ChannelHttpError(429, 'Pedido já consultado 10 vezes no aplicativo');
    }
    const credential = await this.db.withCentral({ tenantId }, (tx) =>
      one<{ credential: string }>(
        tx,
        `SELECT credential FROM channel_store_claims WHERE channel = $1 AND store_id = $2`,
        [store.channel, store.store_id],
      ),
    );
    if (!credential) throw new Error('Loja do aplicativo desligada');
    return adapter.fetchOrder({
      tenantId,
      storeId: store.store_id,
      credential: credential.credential,
      externalOrderId: externalId,
    });
  }

  /**
   * Aplica o evento no pedido: só para a frente, pelos passos da máquina de estados, e confirma
   * na caixa de saída o que mandamos. Devolve um aviso quando o evento não pôde ser aplicado.
   */
  private async applyInTx(tx: Tx, tenantId: string, orderId: string, ev: InboxRow) {
    const ctx = channelCtx(tenantId);
    await q(tx, `UPDATE channel_orders SET channel_status = $2 WHERE order_id = $1`, [
      orderId,
      ev.kind,
    ]);
    await this.outbox.confirmInTx(tx, orderId, CONFIRMS[ev.kind] ?? []);
    if (ev.kind === 'order.dispute')
      return this.disputes.openInTx(
        tx,
        tenantId,
        orderId,
        ev.channel,
        ev.payload?.dispute as ChannelDispute | null | undefined,
      );
    if (ev.kind === 'order.dispute_settled')
      return this.disputes.settleInTx(
        tx,
        ev.channel,
        ev.payload?.settlement as ChannelSettlement | null | undefined,
      );
    if (ev.kind === 'order.cancellation_denied')
      return this.cancellationDeniedInTx(tx, ctx, orderId);
    const target = statusForEvent(ev.kind);
    if (!target) return undefined;
    const o = await this.orders.lock(tx, orderId);
    const steps = channelPath(o.status, target, o.channel);
    if (steps === null)
      return `O aplicativo informou "${ev.kind}" e o pedido está ${o.status}: confira na tela`;
    if (target === 'cancelled' && steps.length) {
      // Cancelado pelo aplicativo com dinheiro recebido no caixa ou nota emitida: não desfaz
      // sozinho. O pago dentro do aplicativo some sozinho (quem devolve é o aplicativo).
      const blocker = await one<{ why: string }>(
        tx,
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id
                                    AND p.method <> 'app' AND p.amount > p.refunded_amount)
                     THEN 'pagamento' ELSE 'nota' END AS why
           FROM orders o WHERE o.id = $1 AND (
             EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id
                        AND p.method <> 'app' AND p.amount > p.refunded_amount)
             OR EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.order_id = o.id
                AND f.status IN ('pending','processing','authorized','cancelling')))`,
        [orderId],
      );
      if (blocker) return `Cancelado no aplicativo: estorne o ${blocker.why} e cancele no Comandou`;
    }
    for (const s of steps)
      await this.orders.transitionInTx(tx, ctx, o, s, `Aplicativo: ${ev.kind}`, {
        fromChannel: true,
      });
    return undefined;
  }

  /**
   * O aplicativo negou o cancelamento que pedimos: o pedido sai de "Cancelamento solicitado" e
   * volta para onde estava (a cozinha continua). Já cancelado aqui: só avisa.
   */
  private async cancellationDeniedInTx(
    tx: Tx,
    ctx: ReturnType<typeof channelCtx>,
    orderId: string,
  ): Promise<string | undefined> {
    const o = await this.orders.lock(tx, orderId);
    if (o.status !== 'cancel_requested')
      return o.status === 'cancelled'
        ? 'O aplicativo negou o cancelamento, mas o pedido já está cancelado aqui: confira no aplicativo'
        : undefined;
    const prev = await one<{ from_status: OrderStatus | null }>(
      tx,
      `SELECT from_status FROM order_status_history
        WHERE order_id = $1 AND to_status = 'cancel_requested' ORDER BY id DESC LIMIT 1`,
      [orderId],
    );
    const back: OrderStatus =
      prev?.from_status &&
      prev.from_status !== 'awaiting' &&
      canTransition('cancel_requested', prev.from_status, o.channel)
        ? prev.from_status
        : 'new';
    await this.orders.transitionInTx(
      tx,
      ctx,
      o,
      back,
      'Aplicativo: cancelamento negado (o pedido continua)',
      { fromChannel: true },
    );
    return 'O aplicativo negou o cancelamento: o pedido continua';
  }
}
