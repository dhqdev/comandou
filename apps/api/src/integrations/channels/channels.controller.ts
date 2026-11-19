import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  CAPABILITY_LABELS,
  CHANNEL_CAPABILITIES,
  CHANNEL_ID_RE,
  KNOWN_CHANNELS,
  channelInfo,
} from '@comandou/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../../common/decorators';
import { one, q } from '../../common/sql';
import { isoDate, money } from '../../common/schemas';
import { ZodPipe } from '../../common/zod.pipe';
import { DatabaseService } from '../../database/database.service';
import { RealtimeService } from '../../realtime/realtime.service';
import type { AuthenticatedUser, ResolvedTenant } from '../../tenancy/tenant.types';
import { ChannelRegistry } from './channel-adapter';
import { ChannelCredentials } from './channel-credentials.service';
import { ChannelDisputesService } from './channel-disputes.service';
import { ChannelDriversService } from './channel-drivers.service';
import { ChannelFinanceService } from './channel-finance.service';
import { ChannelInboxService } from './channel-inbox.service';
import { ChannelOutboxService } from './channel-outbox.service';
import { ChannelStoreStateService } from './channel-store-state.service';
import { ChannelStoresService } from './channel-stores.service';

const StoreOptions = z
  .object({
    receiveOrders: z.boolean().optional(),
    autoAccept: z.boolean().optional(),
    followStoreOpen: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.receiveOrders !== undefined ||
      b.autoAccept !== undefined ||
      b.followStoreOpen !== undefined,
    'nada a mudar',
  );
const PauseBody = z.object({
  // null = até reabrir (no máximo o que o aplicativo aceita: 7 dias no iFood).
  minutes: z.number().int().min(1).max(10080).nullable(),
  reason: z.string().trim().min(3).max(200),
});
const LinkBody = z.object({
  channel: z.string().regex(CHANNEL_ID_RE),
  itemKey: z.string().min(1).max(200),
  productId: z.string().uuid(),
});
const Reason = z.string().trim().min(1).max(250);
const Code = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z_]{1,60}$/);
const DisputeBody = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('accept'), reason: Code.optional() }),
  z.object({ decision: z.literal('reject'), reason: Reason }),
  z.object({
    decision: z.literal('alternative'),
    alternativeId: z.string().trim().min(1).max(100),
    amount: money.optional(),
    minutes: z.number().int().positive().max(240).optional(),
    timeReason: Code.optional(),
  }),
]);
const FinancePeriod = z
  .object({ from: isoDate, to: isoDate })
  .refine((p) => p.from <= p.to, 'período inválido');
const DriverRequest = z.object({ quoteId: z.string().trim().min(1).max(100) });
const DriverCancel = z.object({ code: Code.optional(), reason: Reason });
const UnlinkBody = z.object({
  channel: z.string().regex(CHANNEL_ID_RE),
  itemKey: z.string().min(1).max(200),
});

/** Situação da loja no aplicativo, como a tela recebe. */
const STATE_COLUMNS = `s.channel_state AS "channelState", s.state_title AS "stateTitle",
  s.state_detail AS "stateDetail", s.state_at AS "stateAt", s.state_error AS "stateError",
  (s.pause_id IS NOT NULL) AS "pausedHere", s.pause_until AS "pauseUntil",
  s.pause_reason AS "pauseReason", s.pause_by_store AS "pauseByStore",
  s.follow_store_open AS "followStoreOpen", s.opening_hours AS "openingHours"`;

/**
 * Integrações › Aplicativos de delivery: um cartão por aplicativo (o que ele oferece, lojas,
 * último evento, erros e ajustes) e os itens que chegaram sem vínculo com o cardápio.
 */
@Controller({ path: 'channels', version: '1' })
export class ChannelsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ChannelRegistry,
    private readonly credentials: ChannelCredentials,
    private readonly stores: ChannelStoresService,
    private readonly inbox: ChannelInboxService,
    private readonly outbox: ChannelOutboxService,
    private readonly disputes: ChannelDisputesService,
    private readonly drivers: ChannelDriversService,
    private readonly finance: ChannelFinanceService,
    private readonly storeState: ChannelStoreStateService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get()
  @RequirePermission('orders:manage')
  async overview(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    // Lojas ligadas antes (ex.: iFood só com cardápio) entram na camada de canais.
    await this.stores.sync(t.id);
    // Situação nos aplicativos: lê de novo o que passou de 1 minuto, sem segurar a tela (até 3 s).
    await Promise.race([
      this.storeState.refreshTenant(t.id).catch(() => undefined),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    const data = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const stores = await q<{ channel: string }>(
        tx,
        `SELECT s.id, s.channel, s.store_id AS "storeId", s.name, s.status,
                s.receive_orders AS "receiveOrders", s.auto_accept AS "autoAccept",
                s.last_error AS "lastError", s.last_event_at AS "lastEventAt",
                s.last_order_at AS "lastOrderAt", s.created_at AS "createdAt",
                ${STATE_COLUMNS}
           FROM channel_stores s ORDER BY s.channel, s.name`,
      );
      const problems = await q<{ channel: string; kind: string; n: number }>(
        tx,
        `SELECT channel, 'event' AS kind, count(*)::int AS n FROM channel_inbox
          WHERE status = 'failed' AND received_at > now() - interval '7 days' GROUP BY channel
         UNION ALL
         SELECT target, 'action', count(*)::int FROM integration_outbox
          WHERE status = 'failed' AND created_at > now() - interval '7 days' GROUP BY target
         UNION ALL
         SELECT target, 'pending', count(*)::int FROM integration_outbox
          WHERE status IN ('pending','sending') GROUP BY target`,
      );
      const unlinked = await one<{ n: number }>(
        tx,
        `SELECT count(DISTINCT (i.channel, i.item_key))::int AS n FROM channel_order_items i
          WHERE NOT i.linked AND NOT EXISTS (SELECT 1 FROM channel_item_links l
                 WHERE l.channel = i.channel AND l.item_key = i.item_key)`,
      );
      return { stores, problems, unlinked: unlinked?.n ?? 0 };
    });
    const ids = [
      ...new Set([
        ...KNOWN_CHANNELS,
        ...this.registry.all().map((a) => a.id),
        ...data.stores.map((s) => s.channel),
      ]),
    ];
    const channels = [];
    for (const id of ids) {
      const adapter = this.registry.get(id);
      const count = (kind: string) =>
        data.problems.find((p) => p.channel === id && p.kind === kind)?.n ?? 0;
      channels.push({
        id,
        ...channelInfo(id),
        available: !!adapter,
        configured: !!(await this.credentials.get(id)),
        capabilities: CHANNEL_CAPABILITIES.map((c) => ({
          id: c,
          label: CAPABILITY_LABELS[c],
          on: !!adapter?.capabilities.includes(c),
        })),
        stores: data.stores.filter((s) => s.channel === id),
        failedEvents: count('event'),
        failedActions: count('action'),
        pendingActions: count('pending'),
      });
    }
    return { channels, unlinked: data.unlinked };
  }

  @Patch('stores/:id')
  @RequirePermission('settings:manage')
  async setOptions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(StoreOptions)) b: z.infer<typeof StoreOptions>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.stores.setOptions(t.id, u.id, id, b);
    await this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'channel.store_options',
        entity: 'channel_store',
        entityId: id,
        data: { channel: row.channel, ...b },
        ip: req.ip,
      }),
    );
    this.realtime.publish(t.id, { type: 'channels.changed' });
    return row;
  }

  /** O que deu errado nos últimos 7 dias (eventos e ações que falharam de vez). */
  @Get('problems')
  @RequirePermission('orders:manage')
  problems(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => ({
      events: await q(
        tx,
        `SELECT id, channel, event_code AS "code", kind, external_order_id AS "externalOrderId",
                attempts, last_error AS "lastError", received_at AS "at"
           FROM channel_inbox WHERE status = 'failed' AND received_at > now() - interval '7 days'
          ORDER BY received_at DESC LIMIT 50`,
      ),
      actions: await q(
        tx,
        `SELECT x.id, x.target AS channel, x.action, x.order_id AS "orderId", o.number AS "orderNumber",
                o.external_code AS "externalCode", x.attempts, x.last_error AS "lastError",
                x.last_status AS "lastStatus", x.created_at AS "at"
           FROM integration_outbox x LEFT JOIN orders o ON o.id = x.order_id
          WHERE x.status = 'failed' AND x.created_at > now() - interval '7 days'
          ORDER BY x.created_at DESC LIMIT 50`,
      ),
    }));
  }

  /** Tentar de novo uma ação que falhou (ex.: depois de religar a loja). */
  @Post('actions/:id/retry')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  async retryAction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      one(
        tx,
        `UPDATE integration_outbox SET status = 'pending', attempts = 0, next_attempt_at = now()
          WHERE id = $1 AND status = 'failed' RETURNING id`,
        [id],
      ),
    );
    if (!row) throw new NotFoundException('Ação não encontrada');
    this.outbox.kick(t.id);
    return { ok: true };
  }

  @Post('events/:id/retry')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  async retryEvent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      one(
        tx,
        `UPDATE channel_inbox SET status = 'pending', attempts = 0, next_attempt_at = now()
          WHERE id = $1 AND status = 'failed' RETURNING id`,
        [id],
      ),
    );
    if (!row) throw new NotFoundException('Evento não encontrado');
    this.inbox.kick(t.id);
    return { ok: true };
  }

  /** Lojas nos aplicativos para o PDV: aberta, fechada ou pausada (só as que recebem pedidos). */
  @Get('stores/state')
  @RequirePermission('orders:write')
  storesState(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(
        tx,
        `SELECT s.id, s.channel, s.name, s.status, ${STATE_COLUMNS}
           FROM channel_stores s WHERE s.receive_orders ORDER BY s.channel, s.name`,
      ),
    );
  }

  /** Pausar a loja só no aplicativo (o Comandou continua aberto). */
  @Post('stores/:id/pause')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  pause(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PauseBody)) b: z.infer<typeof PauseBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.storeState.pause(t.id, u.id, id, b, req.ip);
  }

  /** Tirar a pausa que o Comandou fez. */
  @Post('stores/:id/resume')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  resume(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.storeState.resume(t.id, u.id, id, req.ip);
  }

  /** Motivos de cancelamento que o aplicativo aceita para este pedido (lista vazia: só o texto). */
  @Get('orders/:orderId/cancel-reasons')
  @RequirePermission('orders:write')
  async cancelReasons(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return { reasons: await this.disputes.cancelReasons(t.id, u.id, orderId) };
  }

  /** Resposta de uma pessoa à negociação do cliente (aceitar, recusar ou propor). */
  @Post('disputes/:id/decision')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(DisputeBody)) b: z.infer<typeof DisputeBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.disputes.decide(t.id, u.id, id, b, req.ip);
  }

  /** Entregador do aplicativo para este pedido: situação, previsões e o que dá para fazer. */
  @Get('orders/:orderId/driver')
  @RequirePermission('orders:write')
  driver(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.drivers.view(t.id, u.id, orderId);
  }

  /** Quanto custa um entregador do aplicativo (Sob Demanda) para este pedido. */
  @Post('orders/:orderId/driver/quote')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  driverQuote(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.drivers.quote(t.id, u.id, orderId);
  }

  /** Chama o entregador do aplicativo com a cotação que a pessoa viu. */
  @Post('orders/:orderId/driver')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  driverRequest(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body(new ZodPipe(DriverRequest)) b: z.infer<typeof DriverRequest>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.drivers.request(t.id, u.id, orderId, b.quoteId, req.ip);
  }

  /** Motivos para cancelar o entregador chamado (lista vazia: só o texto). */
  @Get('orders/:orderId/driver/cancel-reasons')
  @RequirePermission('orders:manage')
  async driverCancelReasons(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return { reasons: await this.drivers.cancelReasons(t.id, u.id, orderId) };
  }

  /** Cancela o entregador chamado (antes de ele sair com o pedido). */
  @Post('orders/:orderId/driver/cancel')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  driverCancel(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body(new ZodPipe(DriverCancel)) b: z.infer<typeof DriverCancel>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.drivers.cancel(t.id, u.id, orderId, b, req.ip);
  }

  /** Repasses dos aplicativos no período (pela data em que caem) e o que os pedidos renderam. */
  @Get('finance')
  @RequirePermission('finance:read')
  financeSummary(
    @Query(new ZodPipe(FinancePeriod)) p: z.infer<typeof FinancePeriod>,
    @CurrentTenant() t: ResolvedTenant,
  ) {
    return this.finance.summary(t.id, p.from, p.to);
  }

  /** Lê de novo o financeiro dos aplicativos (cada loja no máximo a cada 5 minutos). */
  @Post('finance/refresh')
  @HttpCode(200)
  @RequirePermission('finance:write')
  financeRefresh(@CurrentTenant() t: ResolvedTenant) {
    return this.finance.refreshNow(t.id);
  }

  /** O que um pedido de aplicativo rende (bruto, taxas e o que fica com a loja). */
  @Get('orders/:orderId/finance')
  @RequirePermission('finance:read')
  orderFinance(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentTenant() t: ResolvedTenant,
  ) {
    return this.finance.order(t.id, orderId);
  }

  /** Itens que chegaram sem vínculo (um por item do aplicativo), do mais recente. */
  @Get('unlinked')
  @RequirePermission('orders:manage')
  unlinked(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(
        tx,
        `SELECT i.channel, i.item_key AS "itemKey", max(i.external_code) AS "externalCode",
                (array_agg(i.name ORDER BY o.created_at DESC))[1] AS name,
                (array_agg(i.app_unit_price::text ORDER BY o.created_at DESC))[1] AS "lastPrice",
                count(*)::int AS orders, max(o.created_at) AS "lastAt"
           FROM channel_order_items i JOIN orders o ON o.id = i.order_id
          WHERE NOT i.linked AND NOT EXISTS (SELECT 1 FROM channel_item_links l
                 WHERE l.channel = i.channel AND l.item_key = i.item_key)
          GROUP BY i.channel, i.item_key ORDER BY max(o.created_at) DESC LIMIT 200`,
      ),
    );
  }

  /** Vínculos feitos (para desfazer). */
  @Get('links')
  @RequirePermission('orders:manage')
  links(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(
        tx,
        `SELECT l.channel, l.item_key AS "itemKey", l.product_id AS "productId", p.name AS "productName",
                l.created_at AS "createdAt",
                (SELECT i.name FROM channel_order_items i WHERE i.channel = l.channel
                    AND i.item_key = l.item_key LIMIT 1) AS "channelName"
           FROM channel_item_links l JOIN products p ON p.id = l.product_id
          ORDER BY l.created_at DESC LIMIT 500`,
      ),
    );
  }

  /** Liga um item do aplicativo a um produto do cardápio. Vale para os próximos pedidos. */
  @Post('links')
  @HttpCode(200)
  @RequirePermission('catalog:write')
  async link(
    @Body(new ZodPipe(LinkBody)) b: z.infer<typeof LinkBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const p = await one(tx, `SELECT 1 FROM products WHERE id = $1 AND system_kind IS NULL`, [
        b.productId,
      ]);
      if (!p) throw new NotFoundException('Produto não encontrado');
      await q(
        tx,
        `INSERT INTO channel_item_links (tenant_id, channel, item_key, product_id, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, channel, item_key) DO UPDATE SET product_id = EXCLUDED.product_id`,
        [t.id, b.channel, b.itemKey, b.productId, u.id],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'channel.item_linked',
        entity: 'product',
        entityId: b.productId,
        data: { channel: b.channel, itemKey: b.itemKey },
        ip: req.ip,
      });
    });
    this.realtime.publish(t.id, { type: 'channels.changed' });
    return { ok: true };
  }

  @Post('links/remove')
  @HttpCode(200)
  @RequirePermission('catalog:write')
  async unlink(
    @Body(new ZodPipe(UnlinkBody)) b: z.infer<typeof UnlinkBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const r = await one<{ product_id: string }>(
        tx,
        `DELETE FROM channel_item_links WHERE channel = $1 AND item_key = $2 RETURNING product_id`,
        [b.channel, b.itemKey],
      );
      if (r)
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'channel.item_unlinked',
          entity: 'product',
          entityId: r.product_id,
          data: { channel: b.channel, itemKey: b.itemKey },
          ip: req.ip,
        });
      return r;
    });
    if (!row) throw new NotFoundException('Vínculo não encontrado');
    this.realtime.publish(t.id, { type: 'channels.changed' });
    return { ok: true };
  }
}
