import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { findZone, LatLng, Zone } from './zones';

export const ZONE_COLS = `id, name, color, kind, polygon, center_lat::text AS "centerLat",
  center_lng::text AS "centerLng", radius_m AS "radiusM", fee::text, min_order::text AS "minOrder",
  eta_min AS "etaMin", eta_max AS "etaMax", active, position`;

export interface ZoneInput {
  name: string;
  color: string;
  kind: 'polygon' | 'radius';
  polygon: LatLng[] | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number | null;
  fee: string;
  minOrder: string | null;
  etaMin: number | null;
  etaMax: number | null;
  active: boolean;
  position: number;
}

export interface DeliveryQuote {
  covered: boolean;
  zone: { id: string; name: string } | null;
  fee: string;
  minOrder: string | null;
  etaMin: number | null;
  etaMax: number | null;
}

const MAX_ZONES = 30;

/** Áreas de entrega do restaurante (desenhadas no mapa da tela Entregas). */
@Injectable()
export class ZonesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  listIn(tx: Tx) {
    return q<Zone>(tx, `SELECT ${ZONE_COLS} FROM delivery_zones ORDER BY position, created_at`);
  }

  /** Taxa para um ponto. Sem áreas ativas: não há como recusar, vale a taxa fixa da loja. */
  async quoteIn(
    tx: Tx,
    p: LatLng,
    flatFee: string,
  ): Promise<DeliveryQuote & { hasZones: boolean }> {
    const zones = (await this.listIn(tx)).filter((z) => z.active);
    if (zones.length === 0)
      return {
        hasZones: false,
        covered: true,
        zone: null,
        fee: flatFee,
        minOrder: null,
        etaMin: null,
        etaMax: null,
      };
    const z = findZone(zones, p);
    if (!z)
      return {
        hasZones: true,
        covered: false,
        zone: null,
        fee: '0.00',
        minOrder: null,
        etaMin: null,
        etaMax: null,
      };
    return {
      hasZones: true,
      covered: true,
      zone: { id: z.id, name: z.name },
      fee: z.fee,
      minOrder: z.minOrder,
      etaMin: z.etaMin,
      etaMax: z.etaMax,
    };
  }

  private check(z: Partial<ZoneInput>, kind: ZoneInput['kind'] | undefined) {
    if (kind === 'polygon' && z.polygon !== undefined && (!z.polygon || z.polygon.length < 3))
      throw new UnprocessableEntityException('Desenhe a área com pelo menos 3 pontos no mapa');
    if (kind === 'radius' && (z.centerLat === null || z.centerLng === null || z.radiusM === null))
      throw new UnprocessableEntityException('Área por raio precisa do centro e da distância');
    if (z.etaMin && z.etaMax && z.etaMax < z.etaMin)
      throw new UnprocessableEntityException('O tempo máximo deve ser maior que o mínimo');
  }

  async create(ctx: Ctx, z: ZoneInput) {
    this.check(z, z.kind);
    const res = await this.db.withTenant(ctx, async (tx) => {
      const n = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM delivery_zones`);
      if (n!.n >= MAX_ZONES)
        throw new UnprocessableEntityException(`Limite de ${MAX_ZONES} áreas de entrega`);
      const row = await one<Zone>(
        tx,
        `INSERT INTO delivery_zones (tenant_id, name, color, kind, polygon, center_lat, center_lng, radius_m,
                                     fee, min_order, eta_min, eta_max, active, position)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${ZONE_COLS}`,
        [
          ctx.tenantId,
          z.name,
          z.color,
          z.kind,
          z.kind === 'polygon' ? JSON.stringify(z.polygon) : null,
          z.kind === 'radius' ? z.centerLat : null,
          z.kind === 'radius' ? z.centerLng : null,
          z.kind === 'radius' ? z.radiusM : null,
          z.fee,
          z.minOrder,
          z.etaMin,
          z.etaMax,
          z.active,
          z.position,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'delivery_zone.created',
        entity: 'delivery_zone',
        entityId: row!.id,
        data: { name: z.name, kind: z.kind, fee: z.fee },
        ip: ctx.ip,
      });
      return row;
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return res;
  }

  async update(ctx: Ctx, id: string, z: Partial<ZoneInput>) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const cur = await one<Zone>(
        tx,
        `SELECT ${ZONE_COLS} FROM delivery_zones WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!cur) throw new NotFoundException('Área de entrega não encontrada');
      const kind = z.kind ?? cur.kind;
      const next = {
        name: z.name ?? cur.name,
        color: z.color ?? cur.color,
        polygon: z.polygon !== undefined ? z.polygon : cur.polygon,
        centerLat:
          z.centerLat !== undefined
            ? z.centerLat
            : cur.centerLat === null
              ? null
              : Number(cur.centerLat),
        centerLng:
          z.centerLng !== undefined
            ? z.centerLng
            : cur.centerLng === null
              ? null
              : Number(cur.centerLng),
        radiusM: z.radiusM !== undefined ? z.radiusM : cur.radiusM,
        fee: z.fee ?? cur.fee,
        minOrder: z.minOrder !== undefined ? z.minOrder : cur.minOrder,
        etaMin: z.etaMin !== undefined ? z.etaMin : cur.etaMin,
        etaMax: z.etaMax !== undefined ? z.etaMax : cur.etaMax,
        active: z.active ?? cur.active,
        position: z.position ?? cur.position,
      };
      this.check(next, kind);
      const row = await one<Zone>(
        tx,
        `UPDATE delivery_zones SET name = $2, color = $3, kind = $4, polygon = $5::jsonb, center_lat = $6,
                center_lng = $7, radius_m = $8, fee = $9, min_order = $10, eta_min = $11, eta_max = $12,
                active = $13, position = $14
          WHERE id = $1 RETURNING ${ZONE_COLS}`,
        [
          id,
          next.name,
          next.color,
          kind,
          kind === 'polygon' ? JSON.stringify(next.polygon) : null,
          kind === 'radius' ? next.centerLat : null,
          kind === 'radius' ? next.centerLng : null,
          kind === 'radius' ? next.radiusM : null,
          next.fee,
          next.minOrder,
          next.etaMin,
          next.etaMax,
          next.active,
          next.position,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'delivery_zone.updated',
        entity: 'delivery_zone',
        entityId: id,
        data: { ...z, polygon: z.polygon ? `${z.polygon.length} pontos` : undefined },
        ip: ctx.ip,
      });
      return row;
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return res;
  }

  async remove(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one<{ name: string }>(
        tx,
        `DELETE FROM delivery_zones WHERE id = $1 RETURNING name`,
        [id],
      );
      if (!r) throw new NotFoundException('Área de entrega não encontrada');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'delivery_zone.deleted',
        entity: 'delivery_zone',
        entityId: id,
        data: { name: r.name },
        ip: ctx.ip,
      });
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return { ok: true };
  }
}
