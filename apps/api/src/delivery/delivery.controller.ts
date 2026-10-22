import {
  Body,
  Controller,
  Get,
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
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { reason, uuid } from '../common/schemas';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { DeliveryService } from './delivery.service';

const Courier = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).nullable().optional(),
  userId: uuid.nullable().optional(),
  active: z.boolean().optional(),
});
const COURIER_COLS = `c.id, c.name, c.phone, c.user_id AS "userId", u.name AS "userName", c.active`;

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
      const c = await one<{ id: string }>(
        tx,
        `INSERT INTO couriers (tenant_id, name, phone, user_id, active) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [t.id, b.name, b.phone ?? null, b.userId ?? null, b.active ?? true],
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
      const c = await one(
        tx,
        `UPDATE couriers SET name = COALESCE($2, name),
                phone = CASE WHEN $3 THEN $4 ELSE phone END,
                user_id = CASE WHEN $5 THEN $6::uuid ELSE user_id END,
                active = COALESCE($7, active)
          WHERE id = $1 RETURNING id`,
        [
          id,
          b.name ?? null,
          b.phone !== undefined,
          b.phone ?? null,
          b.userId !== undefined,
          b.userId ?? null,
          b.active ?? null,
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

  @Post('deliveries/:id/complete')
  @RequirePermission('delivery:manage', 'delivery:operate')
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.delivery.complete(ctxOf(t, u, req), id);
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
    @Body(
      new ZodPipe(
        z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
      ),
    )
    b: { lat: number; lng: number },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.delivery.location(ctxOf(t, u), id, b.lat, b.lng);
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

  /** Rastreio público (cliente final). Sem sessão; o tenant vem do Host. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('track/:token')
  track(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant) {
    return this.delivery.publicTrack(t.id, t.name, token);
  }
}
