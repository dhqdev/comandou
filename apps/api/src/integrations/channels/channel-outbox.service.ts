import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  actionForTransition,
  CHANNEL_ACTION_CAPABILITY,
  type ChannelAction,
} from '@comandou/shared';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import { OrdersService } from '../../orders/orders.service';
import { QueueService } from '../../queue/queue.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { ChannelHttpError, ChannelRegistry } from './channel-adapter';
import { ChannelMetrics } from './channel-metrics';
import { ChannelStoresService } from './channel-stores.service';

export const OUTBOX_JOB = 'channels.outbox';
/** Depois disso a ação fica "falhou" e aparece na tela (nada some calado). */
export const OUTBOX_MAX_ATTEMPTS = 8;

interface OutboxRow {
  id: string;
  target: string;
  order_id: string | null;
  external_order_id: string | null;
  action: ChannelAction;
  payload: Record<string, unknown>;
  attempts: number;
  store_ref: string | null;
  store_id: string | null;
  credential: string | null;
}

/** Espera até a próxima tentativa: 5 s, 10 s, 20 s… até 10 min. */
export function outboxBackoffSeconds(attempts: number) {
  return Math.min(600, 5 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Caixa de saída: cada ação para o aplicativo é gravada NA MESMA TRANSAÇÃO da mudança no Comandou
 * (aceitar, pronto, saiu…) e enviada depois, em ordem por pedido, com repetição e sem duplicar
 * (idem_key). A tela mostra "enviando…", "enviado" e "falhou: motivo".
 */
@Injectable()
export class ChannelOutboxService implements OnModuleInit {
  private readonly logger = new Logger('ChannelsOutbox');
  private readonly running = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeService,
    private readonly registry: ChannelRegistry,
    private readonly stores: ChannelStoresService,
    private readonly metrics: ChannelMetrics,
  ) {}

  onModuleInit() {
    this.queue.register(OUTBOX_JOB, (d) => this.deliver(d.tenantId).then(() => undefined));
    // Mudança feita no Comandou num pedido de aplicativo → ação para o aplicativo.
    this.orders.onTransitionInTx(async (tx, ctx, o, from, to, extra) => {
      if (o.source !== 'app' || extra.fromChannel) return;
      const link = await one<{ delivered_by: 'merchant' | 'channel'; channel: string }>(
        tx,
        `SELECT delivered_by, channel FROM channel_orders WHERE order_id = $1`,
        [o.id],
      );
      if (!link) return;
      const action = actionForTransition(from, to, link.delivered_by);
      if (!action) return;
      // O canal não tem essa ação (ex.: "entregue" no iFood, que conclui sozinho): não manda.
      const adapter = this.registry.get(link.channel);
      if (adapter && !adapter.capabilities.includes(CHANNEL_ACTION_CAPABILITY[action])) return;
      await this.enqueueInTx(tx, ctx.tenantId, o.id, action, {
        ...(to === 'cancelled' || to === 'cancel_requested'
          ? {
              reason: (await this.reasonOf(tx, o.id)) ?? undefined,
              ...(extra.channelReason ? { cancellationCode: extra.channelReason } : {}),
            }
          : {}),
      });
    });
  }

  private async reasonOf(tx: Tx, orderId: string) {
    return (
      await one<{ cancel_reason: string | null }>(
        tx,
        `SELECT cancel_reason FROM orders WHERE id = $1`,
        [orderId],
      )
    )?.cancel_reason;
  }

  /** Grava a ação (uma por pedido e ação) e agenda o envio. */
  async enqueueInTx(
    tx: Tx,
    tenantId: string,
    orderId: string,
    action: ChannelAction,
    payload: Record<string, unknown> = {},
    idemSuffix = '',
  ) {
    const link = await one<{ channel: string; store_ref: string | null; external_id: string }>(
      tx,
      `SELECT channel, store_ref, external_id FROM channel_orders WHERE order_id = $1`,
      [orderId],
    );
    if (!link) return false;
    const row = await one(
      tx,
      `INSERT INTO integration_outbox (tenant_id, target, store_ref, order_id, external_order_id,
                                       action, payload, idem_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF(current_setting('app.user_id', true), '')::uuid)
       ON CONFLICT (tenant_id, idem_key) DO NOTHING RETURNING id`,
      [
        tenantId,
        link.channel,
        link.store_ref,
        orderId,
        link.external_id,
        action,
        payload,
        `order:${orderId}:${action}${idemSuffix}`,
      ],
    );
    if (row) this.kick(tenantId, 300);
    return !!row;
  }

  /** Agenda o envio (a transação pode ainda não ter terminado: espera um pouco). */
  kick(tenantId: string, delayMs = 0) {
    void this.queue.add(OUTBOX_JOB, { tenantId }, { delayMs, attempts: 1 }).catch(() => undefined);
  }

  /**
   * Envia as ações vencidas deste restaurante. Pega com SKIP LOCKED (duas réplicas não mandam a
   * mesma) e só a primeira pendente de cada pedido (ordem garantida). "sending" vale 2 min: se o
   * processo cair no meio, a ação volta sozinha.
   */
  async deliver(tenantId: string): Promise<number> {
    if (this.running.has(tenantId)) return 0;
    this.running.add(tenantId);
    let sent = 0;
    try {
      for (let round = 0; round < 10; round++) {
        const batch = await this.db.withTenant({ tenantId }, (tx) =>
          q<OutboxRow>(
            tx,
            `UPDATE integration_outbox x
                SET status = 'sending', attempts = x.attempts + 1,
                    next_attempt_at = now() + interval '2 minutes'
               FROM (SELECT o.id FROM integration_outbox o
                      WHERE o.status IN ('pending','sending') AND o.next_attempt_at <= now()
                        AND NOT EXISTS (
                          SELECT 1 FROM integration_outbox p
                           WHERE p.order_id = o.order_id AND p.status IN ('pending','sending')
                             AND (p.created_at, p.id) < (o.created_at, o.id))
                      ORDER BY o.created_at, o.id LIMIT 20
                      FOR UPDATE SKIP LOCKED) d
              WHERE x.id = d.id
              RETURNING x.id, x.target, x.order_id, x.external_order_id, x.action, x.payload,
                        x.attempts, x.store_ref,
                        (SELECT s.store_id FROM channel_stores s WHERE s.id = x.store_ref) AS store_id,
                        NULL::text AS credential`,
          ),
        );
        if (!batch.length) break;
        for (const r of batch) if (await this.sendOne(tenantId, r)) sent++;
      }
    } finally {
      this.running.delete(tenantId);
    }
    return sent;
  }

  private async sendOne(tenantId: string, r: OutboxRow): Promise<boolean> {
    const adapter = this.registry.get(r.target);
    let error: ChannelHttpError | null = null;
    if (!adapter) error = new ChannelHttpError(400, 'Aplicativo não disponível neste servidor');
    else if (!r.store_id || !r.external_order_id)
      error = new ChannelHttpError(400, 'Loja do aplicativo desligada');
    else {
      try {
        const credential = await this.credentialOf(tenantId, r.target, r.store_id);
        await adapter.send({
          tenantId,
          storeId: r.store_id,
          credential,
          externalOrderId: r.external_order_id,
          action: r.action,
          payload: r.payload ?? {},
        });
      } catch (e) {
        error =
          e instanceof ChannelHttpError
            ? e
            : new ChannelHttpError(0, (e as Error).message?.slice(0, 200) || 'falha');
      }
    }
    const ok = !error;
    const retry = !!error && error.retryable && r.attempts < OUTBOX_MAX_ATTEMPTS;
    await this.db.withTenant({ tenantId }, (tx) =>
      q(
        tx,
        `UPDATE integration_outbox
            SET status = $2, last_error = $3, last_status = $4,
                sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
                next_attempt_at = now() + make_interval(secs => $5)
          WHERE id = $1 AND status = 'sending'`,
        [
          r.id,
          ok ? 'sent' : retry ? 'pending' : 'failed',
          error?.message.slice(0, 300) ?? null,
          error ? error.status : 200,
          retry ? outboxBackoffSeconds(r.attempts) : 0,
        ],
      ),
    );
    this.metrics.outbox.inc({
      channel: r.target,
      result: ok ? 'sent' : retry ? 'retry' : 'failed',
    });
    if (error?.status === 403 && r.store_ref)
      await this.stores.markRevoked(tenantId, r.store_ref, error.message).catch(() => undefined);
    if (!ok && !retry)
      this.logger.warn(`ação ${r.action} para ${r.target} falhou de vez (${error!.status})`);
    if (r.order_id) this.realtime.publish(tenantId, { type: 'order.changed', orderId: r.order_id });
    if (retry) this.kick(tenantId, outboxBackoffSeconds(r.attempts) * 1000);
    return ok;
  }

  /** Credencial que fala por esta loja (a mesma que faz o polling dela). */
  private async credentialOf(tenantId: string, channel: string, storeId: string) {
    const row = await this.db.withCentral({ tenantId }, (tx) =>
      one<{ credential: string }>(
        tx,
        `SELECT credential FROM channel_store_claims WHERE channel = $1 AND store_id = $2`,
        [channel, storeId],
      ),
    );
    if (!row) throw new ChannelHttpError(400, 'Loja do aplicativo desligada');
    return row.credential;
  }

  /** O aplicativo confirmou o que mandamos (evento correspondente chegou). */
  async confirmInTx(tx: Tx, orderId: string, actions: ChannelAction[]) {
    if (!actions.length) return;
    await q(
      tx,
      `UPDATE integration_outbox SET status = 'confirmed', confirmed_at = now()
        WHERE order_id = $1 AND action = ANY($2::text[]) AND status IN ('sent','sending','pending')`,
      [orderId, actions],
    );
  }
}
