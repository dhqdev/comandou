import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { KITCHEN_DISPLAY_KEYS, normalizeKitchenDisplay, ORDER_CHANNELS } from '@comandou/shared';
import { z } from 'zod';
import { TenantDatabaseUnavailable } from '../database/tenant-database';
import { RealtimeService } from '../realtime/realtime.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import type { Actor } from './platform.service';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida');

export const KitchenSectorBody = z.object({
  name: z.string().trim().min(1).max(60),
  channels: z.array(z.enum(ORDER_CHANNELS)).min(1, 'Escolha ao menos um tipo de pedido'),
  warnAfterMin: z.number().int().min(0).max(600),
  lateAfterMin: z.number().int().min(0).max(600),
  color: hex.nullable(),
  active: z.boolean(),
  position: z.number().int().min(0).max(10_000),
});
export type KitchenSectorInput = z.infer<typeof KitchenSectorBody>;

export const KitchenDisplayBody = z
  .object(
    Object.fromEntries(KITCHEN_DISPLAY_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
      (typeof KITCHEN_DISPLAY_KEYS)[number],
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict();

const COLS = `id, name, channels, warn_after_min AS "warnAfterMin", late_after_min AS "lateAfterMin",
  color, active, position`;

/**
 * Aba "Cozinha" do restaurante no Super Admin: as cozinhas (Bar, Chapa...), que tipo de pedido
 * cada uma recebe e o que as telas da cozinha mostram. Grava direto no banco do restaurante
 * (compartilhado ou próprio) e avisa as telas abertas para se atualizarem.
 */
@Injectable()
export class PlatformKitchenService {
  constructor(
    private readonly db: PlatformDb,
    private readonly realtime: RealtimeService,
  ) {}

  private async handle(tenantId: string) {
    const t = await this.db.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
    if (!t.length) throw new NotFoundException('Restaurante não encontrado');
    try {
      return await this.db.tenantDb(tenantId);
    } catch (e) {
      if (e instanceof TenantDatabaseUnavailable)
        throw new ConflictException('O banco deste restaurante ainda não está pronto');
      throw e;
    }
  }

  async get(tenantId: string) {
    const h = await this.handle(tenantId);
    const [kitchens, settings] = await Promise.all([
      h.query(
        `SELECT ${COLS} FROM production_sectors s WHERE tenant_id = $1 ORDER BY position, name`,
        [tenantId],
      ),
      h.query<{ display: unknown; updatedAt: string }>(
        `SELECT display, updated_at AS "updatedAt" FROM kitchen_settings WHERE tenant_id = $1`,
        [tenantId],
      ),
    ]);
    return {
      kitchens,
      display: normalizeKitchenDisplay(settings[0]?.display),
      updatedAt: settings[0]?.updatedAt ?? null,
    };
  }

  private async audit(a: Actor, tenantId: string, action: string, data: Record<string, unknown>) {
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action,
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data,
        ip: a.ip,
      }),
    );
    this.realtime.publish(tenantId, { type: 'kitchen.settings' });
  }

  async saveDisplay(tenantId: string, patch: z.infer<typeof KitchenDisplayBody>, a: Actor) {
    const h = await this.handle(tenantId);
    await h.tx(async (c) => {
      const cur = await c.query<{ display: unknown }>(
        `SELECT display FROM kitchen_settings WHERE tenant_id = $1 FOR UPDATE`,
        [tenantId],
      );
      const next = { ...normalizeKitchenDisplay(cur.rows[0]?.display), ...patch };
      await c.query(
        `INSERT INTO kitchen_settings (tenant_id, display) VALUES ($1, $2::jsonb)
         ON CONFLICT (tenant_id) DO UPDATE SET display = EXCLUDED.display`,
        [tenantId, JSON.stringify(next)],
      );
    });
    await this.audit(a, tenantId, 'platform.tenant.kitchen_display', { changed: patch });
    return this.get(tenantId);
  }

  async createSector(tenantId: string, b: KitchenSectorInput, a: Actor) {
    const h = await this.handle(tenantId);
    const r = await h.tx(async (c) => {
      const dup = await c.query(
        `SELECT 1 FROM production_sectors WHERE tenant_id = $1 AND lower(name) = lower($2)`,
        [tenantId, b.name],
      );
      if (dup.rowCount) throw new ConflictException('Já existe uma cozinha com esse nome');
      return (
        await c.query<{ id: string }>(
          `INSERT INTO production_sectors
             (tenant_id, name, channels, warn_after_min, late_after_min, color, active, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            tenantId,
            b.name,
            b.channels,
            b.warnAfterMin,
            b.lateAfterMin,
            b.color,
            b.active,
            b.position,
          ],
        )
      ).rows[0]!;
    });
    await this.audit(a, tenantId, 'platform.tenant.kitchen_created', { id: r.id, name: b.name });
    return this.get(tenantId);
  }

  async updateSector(tenantId: string, sectorId: string, b: KitchenSectorInput, a: Actor) {
    const h = await this.handle(tenantId);
    await h.tx(async (c) => {
      const dup = await c.query(
        `SELECT 1 FROM production_sectors WHERE tenant_id = $1 AND lower(name) = lower($2) AND id <> $3`,
        [tenantId, b.name, sectorId],
      );
      if (dup.rowCount) throw new ConflictException('Já existe uma cozinha com esse nome');
      const r = await c.query(
        `UPDATE production_sectors SET name = $3, channels = $4, warn_after_min = $5,
                late_after_min = $6, color = $7, active = $8, position = $9
          WHERE tenant_id = $1 AND id = $2`,
        [
          tenantId,
          sectorId,
          b.name,
          b.channels,
          b.warnAfterMin,
          b.lateAfterMin,
          b.color,
          b.active,
          b.position,
        ],
      );
      if (!r.rowCount) throw new NotFoundException('Cozinha não encontrada');
    });
    await this.audit(a, tenantId, 'platform.tenant.kitchen_updated', { id: sectorId, ...b });
    return this.get(tenantId);
  }
}
