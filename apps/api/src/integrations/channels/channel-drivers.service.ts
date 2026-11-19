import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DRIVER_ACTIVE,
  driverMovesForward,
  type ChannelCancelReason,
  type DriverStatus,
} from '@comandou/shared';
import { AuditService } from '../../audit/audit.service';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  ChannelHttpError,
  ChannelRegistry,
  type ChannelDriverUpdate,
  type OrderRef,
} from './channel-adapter';

/** O iFood aceita no máximo uma consulta de rastreio a cada 30 s por pedido. */
export const TRACKING_SECONDS = 30;

interface LinkRow {
  order_id: string;
  channel: string;
  external_id: string;
  store_id: string | null;
  delivered_by: 'merchant' | 'channel';
  driver_status: DriverStatus | null;
  driver_quote_id: string | null;
  driver_quote_fee: string | null;
  driver_quote_until: Date | null;
  tracking_at: Date | null;
  order_status: string;
}

const LINK = `SELECT c.order_id, c.channel, c.external_id, s.store_id, c.delivered_by, c.driver_status,
                     c.driver_quote_id, c.driver_quote_fee::text, c.driver_quote_until, c.tracking_at,
                     o.status AS order_status
                FROM channel_orders c
                JOIN orders o ON o.id = c.order_id
                LEFT JOIN channel_stores s ON s.id = c.store_ref
               WHERE c.order_id = $1`;

/** Pedido onde ainda faz sentido chamar entregador (pronto ou ainda na cozinha). */
const CAN_REQUEST_AT = ['new', 'in_production', 'ready'];

/**
 * Entregador dos aplicativos (ADR 0015, Fase 5): a situação do entregador do canal (eventos de
 * entrega), as previsões do rastreio (no máximo a cada 30 s) e o Sob Demanda (o restaurante que
 * entrega chama um entregador do aplicativo: cota, pede e cancela). O valor cobrado vem SEMPRE da
 * cotação guardada aqui, nunca da tela.
 */
@Injectable()
export class ChannelDriversService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ChannelRegistry,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Aviso do entregador vindo da caixa de entrada: só para a frente. */
  async updateInTx(
    tx: Tx,
    orderId: string,
    d: ChannelDriverUpdate | null | undefined,
  ): Promise<string | undefined> {
    if (!d?.status) return undefined;
    const cur = await one<{ driver_status: DriverStatus | null }>(
      tx,
      `SELECT driver_status FROM channel_orders WHERE order_id = $1`,
      [orderId],
    );
    if (!cur) return undefined;
    const forward = driverMovesForward(cur.driver_status, d.status);
    // Evento atrasado não volta a situação, mas o nome e o veículo dele ainda valem.
    if (!forward && !d.name && !d.vehicle) return undefined;
    await q(
      tx,
      `UPDATE channel_orders
          SET driver_status = CASE WHEN $5 THEN $2 ELSE driver_status END,
              driver_status_at = CASE WHEN $5 THEN now() ELSE driver_status_at END,
              driver_name = COALESCE($3, driver_name), driver_vehicle = COALESCE($4, driver_vehicle)
        WHERE order_id = $1`,
      [orderId, d.status, d.name ?? null, d.vehicle ?? null, forward],
    );
    if (!forward) return undefined;
    return d.status === 'request_failed'
      ? 'O aplicativo não achou entregador: chame de novo ou entregue com o seu'
      : undefined;
  }

  private async link(tenantId: string, userId: string, orderId: string) {
    const l = await this.db.withTenant({ tenantId, userId }, (tx) =>
      one<LinkRow>(tx, LINK, [orderId]),
    );
    if (!l) throw new NotFoundException('Pedido não veio de aplicativo');
    return l;
  }

  private async ref(tenantId: string, l: LinkRow): Promise<OrderRef> {
    if (!l.store_id) throw new ConflictException('Loja do aplicativo desligada');
    const claim = await this.db.withCentral({ tenantId }, (tx) =>
      one<{ credential: string }>(
        tx,
        `SELECT credential FROM channel_store_claims WHERE channel = $1 AND store_id = $2`,
        [l.channel, l.store_id],
      ),
    );
    if (!claim) throw new ConflictException('Loja do aplicativo desligada');
    return {
      tenantId,
      storeId: l.store_id,
      credential: claim.credential,
      externalOrderId: l.external_id,
    };
  }

  /**
   * Entregador do pedido para a tela: situação, previsões (lidas de novo se passaram 30 s e o
   * entregador está em andamento) e o que dá para fazer.
   */
  async view(tenantId: string, userId: string, orderId: string) {
    const l = await this.link(tenantId, userId, orderId);
    const adapter = this.registry.get(l.channel);
    const active = !!l.driver_status && DRIVER_ACTIVE.includes(l.driver_status);
    const open = !['completed', 'cancelled'].includes(l.order_status);
    const stale = !l.tracking_at || Date.now() - l.tracking_at.getTime() >= TRACKING_SECONDS * 1000;
    if (adapter?.tracking && open && stale && (active || l.delivered_by === 'channel')) {
      try {
        const t = await adapter.tracking(await this.ref(tenantId, l));
        await this.db.withTenant({ tenantId }, (tx) =>
          q(
            tx,
            `UPDATE channel_orders SET tracking_at = now(),
                    tracking_eta = COALESCE($2::timestamptz, tracking_eta),
                    tracking_pickup_eta = COALESCE($3::timestamptz, tracking_pickup_eta)
              WHERE order_id = $1`,
            [orderId, t?.eta ?? null, t?.pickupEta ?? null],
          ),
        );
      } catch {
        // Falha conta como consulta (não repete antes de 30 s).
        await this.db
          .withTenant({ tenantId }, (tx) =>
            q(tx, `UPDATE channel_orders SET tracking_at = now() WHERE order_id = $1`, [orderId]),
          )
          .catch(() => undefined);
      }
    }
    const row = await this.db.withTenant({ tenantId, userId }, (tx) =>
      one<Record<string, unknown>>(
        tx,
        `SELECT delivered_by AS "deliveredBy", driver_status AS "status", driver_name AS "name",
                driver_vehicle AS "vehicle", driver_status_at AS "statusAt",
                tracking_eta AS "eta", tracking_pickup_eta AS "pickupEta",
                driver_fee::text AS "fee", pickup_code AS "pickupCode"
           FROM channel_orders WHERE order_id = $1`,
        [orderId],
      ),
    );
    return {
      ...row,
      channel: l.channel,
      canRequest:
        !!adapter?.requestDriver &&
        l.delivered_by === 'merchant' &&
        CAN_REQUEST_AT.includes(l.order_status) &&
        !active,
      canCancel:
        !!adapter?.cancelDriver &&
        l.delivered_by === 'merchant' &&
        open &&
        !!l.driver_status &&
        ['requested', 'assigned', 'to_store', 'at_store'].includes(l.driver_status),
    };
  }

  /** Cotação de entregador do aplicativo (guardada aqui: o pedido usa esta, nunca a da tela). */
  async quote(tenantId: string, userId: string, orderId: string) {
    const l = await this.link(tenantId, userId, orderId);
    this.assertCanRequest(l);
    const adapter = this.registry.get(l.channel)!;
    const qte = await this.callOrThrow(async () =>
      adapter.quoteDriver!(await this.ref(tenantId, l)),
    );
    const until = qte.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString();
    await this.db.withTenant({ tenantId, userId }, (tx) =>
      q(
        tx,
        `UPDATE channel_orders SET driver_quote_id = $2, driver_quote_fee = $3,
                driver_quote_until = $4 WHERE order_id = $1`,
        [orderId, qte.id, qte.fee, until],
      ),
    );
    return { ...qte, expiresAt: until };
  }

  /** Chama o entregador com a cotação guardada (a tela confirma o id que viu). */
  async request(tenantId: string, userId: string, orderId: string, quoteId: string, ip?: string) {
    const l = await this.link(tenantId, userId, orderId);
    this.assertCanRequest(l);
    if (!l.driver_quote_id || l.driver_quote_id !== quoteId)
      throw new ConflictException('Cotação não encontrada: peça uma nova');
    if (!l.driver_quote_until || l.driver_quote_until.getTime() <= Date.now())
      throw new ConflictException('A cotação venceu: peça uma nova');
    const adapter = this.registry.get(l.channel)!;
    await this.callOrThrow(async () =>
      adapter.requestDriver!(await this.ref(tenantId, l), quoteId),
    );
    await this.db.withTenant({ tenantId, userId }, async (tx) => {
      await q(
        tx,
        `UPDATE channel_orders
            SET driver_status = 'requested', driver_status_at = now(), driver_fee = driver_quote_fee,
                driver_quote_id = NULL, driver_quote_until = NULL, driver_name = NULL,
                driver_vehicle = NULL, tracking_at = NULL, tracking_eta = NULL,
                tracking_pickup_eta = NULL
          WHERE order_id = $1`,
        [orderId],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: 'channel.driver_requested',
        entity: 'order',
        entityId: orderId,
        data: { channel: l.channel, fee: l.driver_quote_fee },
        ip,
      });
    });
    this.realtime.publish(tenantId, { type: 'order.changed', orderId });
    return { ok: true };
  }

  async cancelReasons(
    tenantId: string,
    userId: string,
    orderId: string,
  ): Promise<ChannelCancelReason[]> {
    const l = await this.link(tenantId, userId, orderId);
    const adapter = this.registry.get(l.channel);
    if (!adapter?.driverCancelReasons) return [];
    try {
      return await adapter.driverCancelReasons(await this.ref(tenantId, l));
    } catch {
      return [];
    }
  }

  /** Cancela o entregador chamado (antes de ele sair com o pedido). */
  async cancel(
    tenantId: string,
    userId: string,
    orderId: string,
    c: { code?: string; reason: string },
    ip?: string,
  ) {
    const l = await this.link(tenantId, userId, orderId);
    const adapter = this.registry.get(l.channel);
    if (!adapter?.cancelDriver || l.delivered_by !== 'merchant')
      throw new ConflictException('Este pedido não tem entregador chamado pelo Comandou');
    if (
      !l.driver_status ||
      !['requested', 'assigned', 'to_store', 'at_store'].includes(l.driver_status)
    )
      throw new ConflictException('Não há entregador para cancelar (ou ele já saiu com o pedido)');
    await this.callOrThrow(async () => adapter.cancelDriver!(await this.ref(tenantId, l), c));
    await this.db.withTenant({ tenantId, userId }, async (tx) => {
      await q(
        tx,
        `UPDATE channel_orders SET driver_status = 'cancelled', driver_status_at = now(),
                driver_fee = NULL
          WHERE order_id = $1`,
        [orderId],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: 'channel.driver_cancelled',
        entity: 'order',
        entityId: orderId,
        data: { channel: l.channel, code: c.code ?? null },
        ip,
      });
    });
    this.realtime.publish(tenantId, { type: 'order.changed', orderId });
    return { ok: true };
  }

  private assertCanRequest(l: LinkRow) {
    const adapter = this.registry.get(l.channel);
    if (!adapter?.quoteDriver || !adapter.requestDriver)
      throw new ConflictException('Este aplicativo não oferece entregador para chamar');
    if (l.delivered_by !== 'merchant')
      throw new ConflictException('Quem entrega este pedido já é o entregador do aplicativo');
    if (!CAN_REQUEST_AT.includes(l.order_status))
      throw new ConflictException('Só dá para chamar entregador antes de o pedido sair');
    if (l.driver_status && DRIVER_ACTIVE.includes(l.driver_status))
      throw new ConflictException('Já tem entregador chamado para este pedido');
  }

  /** Erro do aplicativo vira mensagem clara; nada se repete sozinho (4xx nunca se repete). */
  private async callOrThrow<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ChannelHttpError)) throw e;
      if (e.status === 403)
        throw new ConflictException(
          'O Sob Demanda não está liberado para esta loja no aplicativo. Fale com o comercial dele.',
        );
      throw new UnprocessableEntityException(
        e.status === 0 || e.status >= 500 || e.status === 429
          ? 'O aplicativo não respondeu agora. Tente de novo em instantes.'
          : `O aplicativo recusou (${e.status}): ${e.message}`.slice(0, 250),
      );
    }
  }
}
