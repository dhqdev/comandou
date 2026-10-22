import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ORDER_CHANNELS } from '@pedemais/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

const Sector = z.object({
  name: z.string().trim().min(1).max(60),
  channels: z.array(z.enum(ORDER_CHANNELS)).min(1).optional(),
  warnAfterMin: z.number().int().min(0).max(600).optional(),
  lateAfterMin: z.number().int().min(0).max(600).optional(),
  active: z.boolean().optional(),
});
const Table = z.object({
  label: z.string().trim().min(1).max(20),
  seats: z.number().int().min(1).max(100).optional(),
  area: z.string().trim().max(40).nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});
const Register = z.object({
  name: z.string().trim().min(1).max(40),
  active: z.boolean().optional(),
});

const SECTOR_COLS = `id, name, channels, warn_after_min AS "warnAfterMin", late_after_min AS "lateAfterMin", active`;
const TABLE_COLS = `id, label, seats, area, position, active`;

/** Cadastros operacionais: setores de produção (KDS), mesas e terminais de caixa. */
@Controller({ version: '1' })
export class SetupController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('sectors')
  @RequirePermission('orders:read')
  sectors(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(tx, `SELECT ${SECTOR_COLS} FROM production_sectors ORDER BY name`),
    );
  }

  @Post('sectors')
  @RequirePermission('settings:manage')
  createSector(
    @Body(new ZodPipe(Sector)) b: z.infer<typeof Sector>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO production_sectors (tenant_id, name, channels, warn_after_min, late_after_min)
         VALUES ($1, $2, COALESCE($3, ARRAY['counter','table','delivery','pickup']), COALESCE($4, 10), COALESCE($5, 20))
         RETURNING ${SECTOR_COLS}`,
        [t.id, b.name, b.channels ?? null, b.warnAfterMin ?? null, b.lateAfterMin ?? null],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'setup.sector_created',
        entity: 'production_sector',
        entityId: row!.id,
        data: b,
        ip: req.ip,
      });
      return row;
    });
  }

  @Patch('sectors/:id')
  @RequirePermission('settings:manage')
  async updateSector(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Sector.partial())) b: Partial<z.infer<typeof Sector>>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `UPDATE production_sectors SET
           name = COALESCE($2, name), channels = COALESCE($3, channels),
           warn_after_min = COALESCE($4, warn_after_min), late_after_min = COALESCE($5, late_after_min),
           active = COALESCE($6, active)
         WHERE id = $1 RETURNING ${SECTOR_COLS}`,
        [
          id,
          b.name ?? null,
          b.channels ?? null,
          b.warnAfterMin ?? null,
          b.lateAfterMin ?? null,
          b.active ?? null,
        ],
      );
      if (r)
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'setup.sector_updated',
          entity: 'production_sector',
          entityId: id,
          data: b,
          ip: req.ip,
        });
      return r;
    });
    if (!row) throw new NotFoundException('Setor não encontrado');
    return row;
  }

  @Get('tables')
  @RequirePermission('orders:read')
  tables(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(
        tx,
        `SELECT ${TABLE_COLS.split(', ')
          .map((c) => 'dt.' + c)
          .join(', ')},
                tb.id AS "tabId", tb.number AS "tabNumber", tb.opened_at AS "openedAt",
                COALESCE((SELECT sum(o.total) FROM orders o WHERE o.tab_id = tb.id AND o.status <> 'cancelled'), 0)::text AS "tabTotal"
           FROM dining_tables dt
           LEFT JOIN tabs tb ON tb.table_id = dt.id AND tb.status = 'open'
          ORDER BY dt.position, dt.label`,
      ),
    );
  }

  @Post('tables')
  @RequirePermission('settings:manage')
  createTable(
    @Body(new ZodPipe(Table)) b: z.infer<typeof Table>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO dining_tables (tenant_id, label, seats, area, position)
         VALUES ($1, $2, COALESCE($3, 4), $4, COALESCE($5, 0)) RETURNING ${TABLE_COLS}`,
        [t.id, b.label, b.seats ?? null, b.area ?? null, b.position ?? null],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'setup.table_created',
        entity: 'dining_table',
        entityId: row!.id,
        data: b,
        ip: req.ip,
      });
      this.realtime.publish(t.id, { type: 'menu.changed' });
      return row;
    });
  }

  @Patch('tables/:id')
  @RequirePermission('settings:manage')
  async updateTable(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Table.partial())) b: Partial<z.infer<typeof Table>>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `UPDATE dining_tables SET label = COALESCE($2, label), seats = COALESCE($3, seats),
           area = CASE WHEN $6 THEN $4 ELSE area END, position = COALESCE($5, position), active = COALESCE($7, active)
         WHERE id = $1 RETURNING ${TABLE_COLS}`,
        [
          id,
          b.label ?? null,
          b.seats ?? null,
          b.area ?? null,
          b.position ?? null,
          b.area !== undefined,
          b.active ?? null,
        ],
      );
      if (r)
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'setup.table_updated',
          entity: 'dining_table',
          entityId: id,
          data: b,
          ip: req.ip,
        });
      return r;
    });
    if (!row) throw new NotFoundException('Mesa não encontrada');
    return row;
  }

  @Get('cash-registers')
  @RequirePermission('orders:read')
  registers(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(
        tx,
        `SELECT r.id, r.name, r.active, s.id AS "openSessionId", s.number AS "openSessionNumber"
           FROM cash_registers r LEFT JOIN cash_sessions s ON s.register_id = r.id AND s.status = 'open'
          ORDER BY r.name`,
      ),
    );
  }

  @Post('cash-registers')
  @RequirePermission('settings:manage')
  createRegister(
    @Body(new ZodPipe(Register)) b: z.infer<typeof Register>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO cash_registers (tenant_id, name) VALUES ($1, $2) RETURNING id, name, active`,
        [t.id, b.name],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'setup.register_created',
        entity: 'cash_register',
        entityId: row!.id,
        data: b,
        ip: req.ip,
      });
      return row;
    });
  }
}
