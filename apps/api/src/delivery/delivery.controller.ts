import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ctxOf } from '../common/context';
import {
  AllowWhenBlocked,
  CurrentTenant,
  CurrentUser,
  Public,
  RequirePermission,
} from '../common/decorators';
import { PAYMENT_METHODS } from '@comandou/shared';
import { requireKey } from '../common/idempotency';
import { reason, uuid } from '../common/schemas';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { CourierFix, DeliveryService } from './delivery.service';

const Courier = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).nullable().optional(),
  userId: uuid.nullable().optional(),
  active: z.boolean().optional(),
  /** Cor no mapa e no calendário de pagamento; null volta para a automática. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'cor no formato #RRGGBB')
    .nullable()
    .optional(),
});
/** Posição do celular. Campos opcionais vêm do GPS quando o aparelho informa. */
const Fix = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  speed: z.number().min(0).max(120).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
});
/** Código de entrega que o cliente passa ao entregador (o painel conclui sem ele). */
const Complete = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{4}$/, 'código de 4 números')
    .optional(),
  /** Como o cliente pagou na porta, quando o pedido ainda tinha saldo (vai para o acerto). */
  method: z.enum(PAYMENT_METHODS).optional(),
});
/** Histórico do entregador: página seguinte a partir da data da última corrida mostrada. */
const HistoryQuery = z.object({ before: z.coerce.date().optional() });
const Settle = z.object({ cashSessionId: uuid, method: z.enum(PAYMENT_METHODS).optional() });
const COURIER_COLS = `c.id, c.name, c.phone, c.user_id AS "userId", u.name AS "userName", c.active,
  c.access_created_at AS "linkCreatedAt", c.link_seen_at AS "linkSeenAt", c.app_seen_at AS "appSeenAt", c.color,
  (c.access_token_enc IS NOT NULL) AS "linkCopyable"`;

/** Bloqueio por cobrança não trava o que termina a venda já feita (só pedidos novos). */
@AllowWhenBlocked()
@Controller({ version: '1' })
export class DeliveryController {
  constructor(
    private readonly db: DatabaseService,
    private readonly delivery: DeliveryService,
    private readonly audit: AuditService,
  ) {}

  @Get('couriers')
  @RequirePermission('delivery:manage')
  couriers(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `SELECT ${COURIER_COLS} FROM couriers c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.active DESC, c.name`,
      ),
    );
  }

  @Post('couriers')
  @RequirePermission('delivery:manage')
  createCourier(
    @Body(new ZodPipe(Courier)) b: z.infer<typeof Courier>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      if (b.userId && (await one(tx, `SELECT 1 FROM couriers WHERE user_id = $1`, [b.userId])))
        throw new ConflictException('Esta pessoa já está na lista de entregadores.');
      const c = await one<{ id: string }>(
        tx,
        `INSERT INTO couriers (tenant_id, name, phone, user_id, active, color)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [t.id, b.name, b.phone ?? null, b.userId ?? null, b.active ?? true, b.color ?? null],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'courier.created',
        entity: 'courier',
        entityId: c!.id,
        data: { name: b.name },
        ip: req.ip,
      });
      return one(
        tx,
        `SELECT ${COURIER_COLS} FROM couriers c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
        [c!.id],
      );
    });
  }

  @Patch('couriers/:id')
  @RequirePermission('delivery:manage')
  updateCourier(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Courier.partial())) b: Partial<z.infer<typeof Courier>>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      // Entregador com login: ativo ou não é o acesso dele na Equipe (senão o app dizia
      // "desativado" para quem a Equipe mostrava ativo).
      if (b.active !== undefined) {
        const cur = await one<{ user_id: string | null; active: boolean }>(
          tx,
          `SELECT user_id, active FROM couriers WHERE id = $1`,
          [id],
        );
        if (cur?.user_id && b.userId === undefined && b.active !== cur.active)
          throw new ConflictException(
            'Este entregador entra com login: ative ou desative o acesso dele na tela Equipe.',
          );
      }
      const c = await one(
        tx,
        `UPDATE couriers SET name = COALESCE($2, name),
                phone = CASE WHEN $3 THEN $4 ELSE phone END,
                user_id = CASE WHEN $5 THEN $6::uuid ELSE user_id END,
                active = COALESCE($7, active),
                color = CASE WHEN $8 THEN $9 ELSE color END
          WHERE id = $1 RETURNING id`,
        [
          id,
          b.name ?? null,
          b.phone !== undefined,
          b.phone ?? null,
          b.userId !== undefined,
          b.userId ?? null,
          b.active ?? null,
          b.color !== undefined,
          b.color ?? null,
        ],
      );
      if (!c) throw new NotFoundException('Entregador não encontrado');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'courier.updated',
        entity: 'courier',
        entityId: id,
        data: b,
        ip: req.ip,
      });
      return one(
        tx,
        `SELECT ${COURIER_COLS} FROM couriers c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
        [id],
      );
    });
  }

  @Get('deliveries')
  @RequirePermission('delivery:manage', 'delivery:operate')
  list(
    @Query(new ZodPipe(z.object({ scope: z.enum(['active', 'today']).default('active') })))
    f: { scope: 'active' | 'today' },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.delivery.list(ctxOf(t, u), f.scope);
  }

  /** Mapa ao vivo: ponto da loja e trajeto das corridas pedidas (até 50 por vez). */
  @Get('deliveries/live-map')
  @RequirePermission('delivery:manage', 'delivery:operate')
  liveMap(
    @Query(
      new ZodPipe(
        z.object({
          ids: z
            .string()
            .default('')
            .transform((s) => s.split(',').filter(Boolean))
            .pipe(z.array(uuid).max(50)),
        }),
      ),
    )
    f: { ids: string[] },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.delivery.liveMap(ctxOf(t, u), f.ids);
  }

  @Post('orders/:id/dispatch')
  @RequirePermission('delivery:manage')
  dispatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(z.object({ courierId: uuid }))) b: { courierId: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.dispatch(ctxOf(t, u, req), id, b.courierId);
  }

  // ------------------------------------- app do entregador com login: pegar corrida e perfil
  /** Pedidos prontos e sem entregador, que o motoboy pode pegar sozinho. */
  @Get('deliveries/available')
  @RequirePermission('delivery:operate')
  available(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.delivery.available(ctxOf(t, u));
  }

  @Post('orders/:id/claim')
  @RequirePermission('delivery:operate')
  claim(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.claim(ctxOf(t, u, req), id);
  }

  @Get('deliveries/history')
  @RequirePermission('delivery:operate')
  history(
    @Query(new ZodPipe(HistoryQuery)) f: z.infer<typeof HistoryQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.delivery.history(ctxOf(t, u), f.before ?? null);
  }

  @Get('deliveries/profile')
  @RequirePermission('delivery:operate')
  profile(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.delivery.profile(ctxOf(t, u));
  }

  @Post('deliveries/:id/complete')
  @RequirePermission('delivery:manage', 'delivery:operate')
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Complete)) b: z.infer<typeof Complete>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.complete(ctxOf(t, u, req), id, { code: b.code, method: b.method });
  }

  /** Acertos pendentes: o que cada entregador recebeu na porta e ainda não entregou no caixa. */
  @Get('deliveries/collections')
  @RequirePermission('payments:create')
  collections(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.delivery.pendingCollections(ctxOf(t, u));
  }

  /** Acerto de uma entrega no caixa (vira pagamento na sessão). Exige `Idempotency-Key`. */
  @Post('deliveries/:id/settle')
  @RequirePermission('payments:create')
  settle(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Settle)) b: z.infer<typeof Settle>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.settle(ctxOf(t, u, req), id, b, requireKey(key));
  }

  @Post('deliveries/:id/fail')
  @RequirePermission('delivery:manage', 'delivery:operate')
  fail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(z.object({ reason }))) b: { reason: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.fail(ctxOf(t, u, req), id, b.reason);
  }

  @Post('deliveries/:id/location')
  @RequirePermission('delivery:operate')
  location(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Fix))
    b: CourierFix,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.delivery.location(ctxOf(t, u), id, b);
  }

  @Post('deliveries/:id/tracking-link')
  @RequirePermission('delivery:manage')
  trackingLink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.newTrackingLink(ctxOf(t, u, req), id);
  }

  /** Gera (ou troca) o link do entregador. O link aparece só agora. */
  @Post('couriers/:id/link')
  @RequirePermission('delivery:manage')
  courierLink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.newCourierLink(ctxOf(t, u, req), id);
  }

  /** O link que vale agora, para copiar ou mandar de novo (sem trocar). */
  @Get('couriers/:id/link')
  @RequirePermission('delivery:manage')
  currentCourierLink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.currentCourierLink(ctxOf(t, u, req), id);
  }

  @Delete('couriers/:id/link')
  @RequirePermission('delivery:manage')
  revokeCourierLink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.revokeCourierLink(ctxOf(t, u, req), id);
  }

  // ---------------------------------------------- tela do entregador pelo link (sem login)
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('courier-app/:token')
  courierHome(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant) {
    return this.delivery.courierHome(t.id, t.name, token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('courier-app/:token/deliveries/:id/complete')
  async courierComplete(
    @Param('token') token: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Complete)) b: z.infer<typeof Complete>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const { ctx, courier } = await this.delivery.courierCtx(t.id, token, req.ip);
    return this.delivery.complete(ctx, id, {
      viaLink: courier.id,
      code: b.code,
      method: b.method,
    });
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('courier-app/:token/deliveries/:id/fail')
  async courierFail(
    @Param('token') token: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(z.object({ reason }))) b: { reason: string },
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const { ctx, courier } = await this.delivery.courierCtx(t.id, token, req.ip);
    return this.delivery.fail(ctx, id, b.reason, courier.id);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('courier-app/:token/deliveries/:id/location')
  async courierLocation(
    @Param('token') token: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Fix))
    b: CourierFix,
    @CurrentTenant() t: ResolvedTenant,
  ) {
    const { ctx, courier } = await this.delivery.courierCtx(t.id, token);
    return this.delivery.location(ctx, id, b, courier.id);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('courier-app/:token/available')
  async courierAvailable(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant) {
    const { ctx, courier } = await this.delivery.courierCtx(t.id, token);
    return this.delivery.available(ctx, courier.id);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('courier-app/:token/orders/:id/claim')
  async courierClaim(
    @Param('token') token: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const { ctx, courier } = await this.delivery.courierCtx(t.id, token, req.ip);
    return this.delivery.claim(ctx, id, courier.id);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('courier-app/:token/history')
  async courierHistory(
    @Param('token') token: string,
    @Query(new ZodPipe(HistoryQuery)) f: z.infer<typeof HistoryQuery>,
    @CurrentTenant() t: ResolvedTenant,
  ) {
    const { ctx, courier } = await this.delivery.courierCtx(t.id, token);
    return this.delivery.history(ctx, f.before ?? null, courier.id);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('courier-app/:token/profile')
  async courierProfile(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant) {
    const { ctx, courier } = await this.delivery.courierCtx(t.id, token);
    return this.delivery.profile(ctx, courier.id);
  }

  /** Rastreio público (cliente final). Sem sessão; o tenant vem do Host. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('track/:token')
  track(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant) {
    return this.delivery.publicTrack(t.id, t.name, token);
  }
}
