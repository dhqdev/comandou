import {
  Body,
  Controller,
  Delete,
  Get,
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
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { money } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import { StoreService } from '../store/store.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { GeocoderService } from './geocoder.service';
import { ZonesService } from './zones.service';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const ZoneFields = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  kind: z.enum(['polygon', 'radius']),
  polygon: z
    .array(z.tuple([lat, lng]))
    .min(3)
    .max(200)
    .nullable(),
  centerLat: lat.nullable(),
  centerLng: lng.nullable(),
  radiusM: z.number().int().min(50).max(100_000).nullable(),
  fee: money,
  minOrder: money.nullable(),
  etaMin: z.number().int().min(1).max(600).nullable(),
  etaMax: z.number().int().min(1).max(600).nullable(),
  active: z.boolean(),
  position: z.number().int().min(0).max(10_000),
});
const ZoneCreate = ZoneFields.partial()
  .required({ name: true, kind: true, fee: true })
  .transform((z) => ({
    color: '#ea8a0b',
    polygon: null,
    centerLat: null,
    centerLng: null,
    radiusM: null,
    minOrder: null,
    etaMin: null,
    etaMax: null,
    active: true,
    position: 0,
    ...z,
  }));
const ZoneUpdate = ZoneFields.partial().refine(
  (o) => Object.keys(o).length > 0,
  'nada para atualizar',
);
const Point = z.object({ lat, lng });
const Search = z.object({ q: z.string().trim().min(3).max(200) });

/** Áreas de entrega desenhadas no mapa + busca de endereço. */
@Controller({ version: '1' })
export class ZonesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly zones: ZonesService,
    private readonly geocoder: GeocoderService,
    private readonly store: StoreService,
  ) {}

  @Get('delivery-zones')
  @RequirePermission('delivery:manage', 'settings:manage')
  async list(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const s = await this.store.settingsIn(tx);
      return {
        zones: await this.zones.listIn(tx),
        store: {
          lat: s.storeLat,
          lng: s.storeLng,
          address: s.address,
          deliveryFee: s.deliveryFee,
          minOrder: s.minOrder,
        },
      };
    });
  }

  @Post('delivery-zones')
  @RequirePermission('settings:manage')
  create(
    @Body(new ZodPipe(ZoneCreate)) b: z.infer<typeof ZoneCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.zones.create(ctxOf(t, u, req), b);
  }

  @Patch('delivery-zones/:id')
  @RequirePermission('settings:manage')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ZoneUpdate)) b: z.infer<typeof ZoneUpdate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.zones.update(ctxOf(t, u, req), id, b);
  }

  @Delete('delivery-zones/:id')
  @RequirePermission('settings:manage')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.zones.remove(ctxOf(t, u, req), id);
  }

  /** Busca de endereço para a equipe (marcar a loja no mapa). */
  @Get('geocode')
  @RequirePermission('delivery:manage', 'settings:manage')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async geocode(
    @Query(new ZodPipe(Search)) f: z.infer<typeof Search>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const s = await this.db.withTenant(ctxOf(t, u), (tx) => this.store.settingsIn(tx));
    return this.geocoder.search(f.q, near(s));
  }

  /** Cliente final: endereço → ponto no mapa (perto da loja). */
  @Public()
  @Get('store/geocode')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async publicGeocode(
    @Query(new ZodPipe(Search)) f: z.infer<typeof Search>,
    @CurrentTenant() t: ResolvedTenant,
  ) {
    const s = await this.db.withTenant({ tenantId: t.id }, (tx) => this.store.settingsIn(tx));
    return this.geocoder.search(f.q, near(s));
  }

  /** Cliente final: taxa e tempo de entrega para um ponto. A API recalcula no pedido. */
  @Public()
  @Post('store/delivery-quote')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async quote(
    @Body(new ZodPipe(Point)) p: z.infer<typeof Point>,
    @CurrentTenant() t: ResolvedTenant,
  ) {
    return this.db.withTenant({ tenantId: t.id }, async (tx) => {
      const s = await this.store.settingsIn(tx);
      const { hasZones: _h, ...q } = await this.zones.quoteIn(tx, [p.lat, p.lng], s.deliveryFee);
      return q;
    });
  }
}

function near(s: { storeLat: string | null; storeLng: string | null }) {
  return s.storeLat && s.storeLng
    ? { lat: Number(s.storeLat), lng: Number(s.storeLng) }
    : undefined;
}
