import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { customerStep } from '@comandou/shared';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Ctx, onlineCtx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ZonesService } from '../delivery/zones.service';

export const mediaUrl = (id: string | null | undefined) => (id ? `/api/v1/media/${id}` : null);
export const publicTokenHash = (token: string) => createHash('sha256').update(token).digest();
export const PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export interface StoreSettings {
  enabled: boolean;
  isOpen: boolean;
  autoAccept: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryFee: string;
  minOrder: string;
  etaMin: number;
  etaMax: number;
  about: string | null;
  address: string | null;
  whatsapp: string | null;
  coverImageId: string | null;
  logoImageId: string | null;
  theme: 'auto' | 'light' | 'dark';
  headline: string | null;
  featuredTitle: string | null;
  accountsEnabled: boolean;
  showPopular: boolean;
  /** Ponto da loja no mapa (centro das áreas por raio e referência da busca de endereço). */
  storeLat: string | null;
  storeLng: string | null;
}

export interface BannerInput {
  title: string;
  subtitle: string | null;
  tag: string | null;
  cta: string | null;
  imageId: string | null;
  targetType: 'none' | 'product' | 'category';
  targetId: string | null;
  active: boolean;
  position: number;
}
const BANNER_COLS = `id, title, subtitle, tag, cta, image_id AS "imageId", target_type AS "targetType",
  target_id AS "targetId", active, position`;
const MAX_BANNERS = 12;

const SETTINGS_COLS = `enabled, is_open AS "isOpen", auto_accept AS "autoAccept",
  accepts_delivery AS "acceptsDelivery", accepts_pickup AS "acceptsPickup",
  delivery_fee::text AS "deliveryFee", min_order::text AS "minOrder", eta_min AS "etaMin",
  eta_max AS "etaMax", about, address, whatsapp, cover_image_id AS "coverImageId",
  logo_image_id AS "logoImageId", theme, headline, featured_title AS "featuredTitle",
  accounts_enabled AS "accountsEnabled", show_popular AS "showPopular",
  store_lat::text AS "storeLat", store_lng::text AS "storeLng"`;

const DEFAULTS: StoreSettings = {
  enabled: true,
  isOpen: true,
  autoAccept: false,
  acceptsDelivery: true,
  acceptsPickup: true,
  deliveryFee: '0.00',
  minOrder: '0.00',
  etaMin: 30,
  etaMax: 50,
  about: null,
  address: null,
  whatsapp: null,
  coverImageId: null,
  logoImageId: null,
  theme: 'auto',
  headline: null,
  featuredTitle: null,
  accountsEnabled: true,
  showPopular: true,
  storeLat: null,
  storeLng: null,
};

const COLUMN: Record<keyof StoreSettings, string> = {
  enabled: 'enabled',
  isOpen: 'is_open',
  autoAccept: 'auto_accept',
  acceptsDelivery: 'accepts_delivery',
  acceptsPickup: 'accepts_pickup',
  deliveryFee: 'delivery_fee',
  minOrder: 'min_order',
  etaMin: 'eta_min',
  etaMax: 'eta_max',
  about: 'about',
  address: 'address',
  whatsapp: 'whatsapp',
  coverImageId: 'cover_image_id',
  logoImageId: 'logo_image_id',
  theme: 'theme',
  headline: 'headline',
  featuredTitle: 'featured_title',
  accountsEnabled: 'accounts_enabled',
  showPopular: 'show_popular',
  storeLat: 'store_lat',
  storeLng: 'store_lng',
};

export interface OnlineOrderInput {
  channel: 'delivery' | 'pickup';
  token: string;
  customerName: string;
  customerPhone: string;
  address?: {
    street: string;
    number: string;
    district: string;
    complement?: string;
    reference?: string;
    lat?: number;
    lng?: number;
  };
  notes?: string;
  paymentMethod: 'cash' | 'credit' | 'debit' | 'pix' | 'voucher';
  changeFor?: string;
  items: { productId: string; quantity: number; notes?: string; optionIds?: string[] }[];
  /** Cliente com a conta aberta (cookie cm_cid). */
  customerId?: string;
}

/** Loja online: configurações, cardápio público e pedidos feitos pelo cliente final. */
@Injectable()
export class StoreService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly zones: ZonesService,
  ) {}

  async settingsIn(tx: Tx): Promise<StoreSettings> {
    const s = await one<StoreSettings>(tx, `SELECT ${SETTINGS_COLS} FROM tenant_store_settings`);
    return s ?? { ...DEFAULTS };
  }

  settings(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) => this.settingsIn(tx));
  }

  async updateSettings(ctx: Ctx, patch: Partial<StoreSettings>) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const cur = await this.settingsIn(tx);
      const next = { ...cur, ...patch };
      if (next.etaMax < next.etaMin)
        throw new UnprocessableEntityException('O tempo máximo deve ser maior que o mínimo');
      const keys = Object.keys(COLUMN) as (keyof StoreSettings)[];
      const cols = keys.map((k) => COLUMN[k]);
      await q(
        tx,
        `INSERT INTO tenant_store_settings (tenant_id, ${cols.join(', ')})
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (tenant_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
        [ctx.tenantId, ...keys.map((k) => next[k])],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'store.settings_updated',
        entity: 'store',
        entityId: ctx.tenantId,
        data: { changes: patch },
        ip: ctx.ip,
      });
      return this.settingsIn(tx);
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return res;
  }

  /** Cardápio público: só o que o cliente precisa ver. Sem custos, fichas, setores ou dados fiscais. */
  publicMenu(tenantId: string, tenantName: string, slug: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      if (!s.enabled) throw new NotFoundException('Cardápio online desativado');
      const categories = await q<{
        id: string;
        name: string;
        imageId: string | null;
        products: {
          id: string;
          name: string;
          description: string | null;
          price: string;
          soldOut: boolean;
          imageId: string | null;
          featured: boolean;
          badge: string | null;
          optionGroups: unknown[];
        }[];
      }>(
        tx,
        `SELECT c.id, c.name, c.image_id AS "imageId",
           COALESCE((SELECT json_agg(json_build_object(
               'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price::text,
               'soldOut', p.sold_out, 'imageId', p.image_id, 'featured', p.featured, 'badge', p.badge,
               'optionGroups', COALESCE((SELECT json_agg(json_build_object(
                   'id', g.id, 'name', g.name, 'minSelect', g.min_select, 'maxSelect', g.max_select,
                   'options', COALESCE((SELECT json_agg(json_build_object('id', o.id, 'name', o.name, 'priceDelta', o.price_delta::text)
                                        ORDER BY o.position, o.name)
                                       FROM options o WHERE o.group_id = g.id AND o.active), '[]'))
                 ORDER BY pog.position)
                 FROM product_option_groups pog JOIN option_groups g ON g.id = pog.group_id
                WHERE pog.product_id = p.id AND g.active), '[]'))
             ORDER BY p.position, p.name)
             FROM products p WHERE p.category_id = c.id AND p.active), '[]') AS products
           FROM categories c WHERE c.active ORDER BY c.position, c.name`,
      );
      const banners = await q<BannerInput & { id: string }>(
        tx,
        `SELECT ${BANNER_COLS} FROM store_banners WHERE active ORDER BY position, created_at`,
      );
      // "Mais pedidos": os produtos que mais saíram nos últimos 30 dias (pedidos não cancelados).
      const popular = s.showPopular
        ? await q<{ id: string }>(
            tx,
            `SELECT i.product_id AS id FROM order_items i JOIN orders o ON o.id = i.order_id
              WHERE o.created_at > now() - interval '30 days' AND o.status <> 'cancelled'
                AND i.product_id IS NOT NULL
              GROUP BY i.product_id ORDER BY sum(i.quantity) DESC LIMIT 10`,
          )
        : [];
      const zoneCount = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM delivery_zones WHERE active`,
      );
      const visible = categories.filter((c) => c.products.length > 0);
      const productIds = new Set(visible.flatMap((c) => c.products.map((p) => p.id)));
      const categoryIds = new Set(visible.map((c) => c.id));
      return {
        restaurant: {
          name: tenantName,
          slug,
          about: s.about,
          address: s.address,
          whatsapp: s.whatsapp,
          coverUrl: mediaUrl(s.coverImageId),
          logoUrl: mediaUrl(s.logoImageId),
        },
        store: {
          isOpen: s.isOpen,
          acceptsDelivery: s.acceptsDelivery,
          acceptsPickup: s.acceptsPickup,
          deliveryFee: s.deliveryFee,
          minOrder: s.minOrder,
          etaMin: s.etaMin,
          etaMax: s.etaMax,
          /** Taxa por área no mapa: o cardápio pede a localização do endereço antes do pedido. */
          deliveryZones: (zoneCount?.n ?? 0) > 0,
        },
        appearance: {
          theme: s.theme,
          headline: s.headline,
          featuredTitle: s.featuredTitle,
          accountsEnabled: s.accountsEnabled,
        },
        // Banner que aponta para produto/categoria fora do cardápio vira banner sem link.
        banners: banners.map(({ imageId, active: _a, position: _p, ...b }) => {
          const ok =
            (b.targetType === 'product' && productIds.has(b.targetId!)) ||
            (b.targetType === 'category' && categoryIds.has(b.targetId!));
          return {
            ...b,
            targetType: ok ? b.targetType : 'none',
            targetId: ok ? b.targetId : null,
            imageUrl: mediaUrl(imageId),
          };
        }),
        popular: popular.map((p) => p.id).filter((id) => productIds.has(id)),
        categories: visible.map(({ imageId, products, ...c }) => ({
          ...c,
          imageUrl: mediaUrl(imageId),
          products: products.map(({ imageId: img, ...p }) => ({ ...p, imageUrl: mediaUrl(img) })),
        })),
      };
    });
  }

  /** Pedido do cliente final. Preços, taxa e pedido mínimo vêm sempre do banco. */
  async placeOrder(tenantId: string, input: OnlineOrderInput, key: string, ip?: string) {
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    const s = await this.db.withTenant(ctx, (tx) => this.settingsIn(tx));
    if (!s.enabled) throw new NotFoundException('Cardápio online desativado');
    if (!s.isOpen)
      throw new ConflictException('A loja está fechada agora. Tente novamente mais tarde.');
    if (input.channel === 'delivery' && !s.acceptsDelivery)
      throw new UnprocessableEntityException('Esta loja não está fazendo entregas agora');
    if (input.channel === 'pickup' && !s.acceptsPickup)
      throw new UnprocessableEntityException('Esta loja não está aceitando retirada agora');
    if (input.channel === 'delivery' && !input.address)
      throw new UnprocessableEntityException('Informe o endereço de entrega');
    const a = input.address;
    const address =
      input.channel === 'delivery' && a
        ? [
            `${a.street}, ${a.number}`,
            a.complement,
            a.district,
            a.reference ? `Ref.: ${a.reference}` : undefined,
          ]
            .filter(Boolean)
            .join(' — ')
        : undefined;
    // Taxa e pedido mínimo da área de entrega (se a loja desenhou áreas no mapa).
    let fee = s.deliveryFee;
    let minSubtotal = s.minOrder;
    const point =
      a?.lat !== undefined && a?.lng !== undefined ? { lat: a.lat, lng: a.lng } : undefined;
    if (input.channel === 'delivery') {
      const quote = await this.db.withTenant(ctx, async (tx) =>
        point ? this.zones.quoteIn(tx, [point.lat, point.lng], s.deliveryFee) : null,
      );
      const hasZones =
        quote?.hasZones ??
        (await this.db.withTenant(ctx, async (tx) =>
          (await this.zones.listIn(tx)).some((z) => z.active),
        ));
      if (hasZones && !quote)
        throw new UnprocessableEntityException(
          'Confirme o endereço no mapa para calcular a taxa de entrega',
        );
      if (quote && !quote.covered)
        throw new UnprocessableEntityException('Ainda não entregamos neste endereço');
      if (quote?.zone) {
        fee = quote.fee;
        if (quote.minOrder) minSubtotal = quote.minOrder;
      }
    }
    const order = await this.orders.create(
      ctx,
      {
        channel: input.channel,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        deliveryAddress: address,
        deliveryLocation: input.channel === 'delivery' ? point : undefined,
        notes: input.notes,
        deliveryFee: input.channel === 'delivery' ? fee : undefined,
        items: input.items,
        online: {
          tokenHash: publicTokenHash(input.token),
          autoAccept: s.autoAccept,
          paymentHint: input.paymentMethod,
          changeFor: input.paymentMethod === 'cash' ? input.changeFor : undefined,
          customerId: input.customerId,
        },
        minSubtotal,
      },
      key,
    );
    return { number: order.number, status: order.status };
  }

  private async byToken(tx: Tx, token: string) {
    if (!PUBLIC_TOKEN_RE.test(token)) throw new NotFoundException('Pedido não encontrado');
    const o = await one<{ id: string; created_at: Date }>(
      tx,
      `SELECT id, created_at FROM orders WHERE public_token_hash = $1`,
      [publicTokenHash(token)],
    );
    // O link vale por 7 dias; depois disso o pedido some do acompanhamento.
    if (!o || Date.now() - new Date(o.created_at).getTime() > 7 * 86_400_000)
      throw new NotFoundException('Pedido não encontrado');
    return o.id;
  }

  /** Acompanhamento do pedido pelo cliente (quem tem o link). */
  publicOrder(tenantId: string, tenantName: string, token: string) {
    return this.db.withTenant({ tenantId }, async (tx) =>
      this.orderView(tx, await this.byToken(tx, token), tenantName),
    );
  }

  /** Mesmo acompanhamento, pelo histórico da conta do cliente (id já conferido como dele). */
  accountOrder(tenantId: string, tenantName: string, orderId: string) {
    return this.db.withTenant({ tenantId }, (tx) => this.orderView(tx, orderId, tenantName));
  }

  private async orderView(tx: Tx, id: string, tenantName: string) {
    const o = await one<{
      number: number;
      status: Parameters<typeof customerStep>[0];
      channel: string;
      createdAt: Date;
      acceptedAt: Date | null;
      customerName: string | null;
      deliveryAddress: string | null;
      notes: string | null;
      subtotal: string;
      deliveryFee: string;
      discount: string;
      total: string;
      paymentHint: string | null;
      changeFor: string | null;
      paymentStatus: string;
      cancelReason: string | null;
    }>(
      tx,
      `SELECT number, status, channel, created_at AS "createdAt", accepted_at AS "acceptedAt",
                customer_name AS "customerName", delivery_address AS "deliveryAddress", notes,
                subtotal::text, delivery_fee::text AS "deliveryFee", discount::text, total::text,
                payment_hint AS "paymentHint", change_for::text AS "changeFor",
                payment_status AS "paymentStatus", cancel_reason AS "cancelReason"
           FROM orders WHERE id = $1`,
      [id],
    );
    const items = await q(
      tx,
      `SELECT i.name, i.quantity::text, i.total::text, i.notes, i.status,
                COALESCE((SELECT json_agg(io.name) FROM order_item_options io WHERE io.order_item_id = i.id), '[]') AS options
           FROM order_items i WHERE i.order_id = $1 ORDER BY i.created_at, i.id`,
      [id],
    );
    const history = await q<{ to: string; at: Date }>(
      tx,
      `SELECT to_status AS "to", created_at AS "at" FROM order_status_history WHERE order_id = $1 ORDER BY id`,
      [id],
    );
    const delivery = await one<{
      courier: string;
      status: string;
      lat: string | null;
      lng: string | null;
      at: Date | null;
    }>(
      tx,
      `SELECT split_part(c.name, ' ', 1) AS courier, d.status, d.last_lat::text AS lat,
                d.last_lng::text AS lng, d.last_location_at AS at
           FROM deliveries d JOIN couriers c ON c.id = d.courier_id
          WHERE d.order_id = $1 ORDER BY d.dispatched_at DESC LIMIT 1`,
      [id],
    );
    const s = await this.settingsIn(tx);
    const when = (st: string) => history.find((h) => h.to === st)?.at ?? null;
    return {
      restaurant: { name: tenantName, whatsapp: s.whatsapp, logoUrl: mediaUrl(s.logoImageId) },
      etaMin: s.etaMin,
      etaMax: s.etaMax,
      ...o!,
      step: customerStep(o!.status),
      canCancel: o!.status === 'awaiting',
      timeline: {
        awaiting: o!.createdAt,
        accepted: o!.acceptedAt ?? when('new') ?? when('in_production'),
        ready: when('ready'),
        dispatched: when('dispatched'),
        completed: when('completed'),
        cancelled: when('cancelled'),
      },
      items,
      courier:
        delivery && o!.status === 'dispatched'
          ? {
              name: delivery.courier,
              location:
                delivery.status === 'out' && delivery.lat && delivery.lng
                  ? { lat: delivery.lat, lng: delivery.lng, at: delivery.at }
                  : null,
            }
          : null,
    };
  }

  /** O cliente pode desistir enquanto o pedido ainda está em análise. */
  async cancelByCustomer(tenantId: string, token: string | { orderId: string }, ip?: string) {
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    const orderId = await this.db.withTenant(ctx, async (tx) => {
      const id = typeof token === 'string' ? await this.byToken(tx, token) : token.orderId;
      const o = await this.orders.lock(tx, id);
      if (o.status !== 'awaiting')
        throw new ConflictException(
          'O restaurante já aceitou o pedido. Para cancelar, fale com a loja.',
        );
      await this.orders.transitionInTx(tx, ctx, o, 'cancelled', 'Cancelado pelo cliente');
      return id;
    });
    this.realtime.publish(tenantId, { type: 'order.changed', orderId, status: 'cancelled' });
    return { ok: true };
  }

  // ------------------------------------------------------------------ banners
  listBanners(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q<BannerInput & { id: string }>(
        tx,
        `SELECT ${BANNER_COLS} FROM store_banners ORDER BY position, created_at`,
      );
      return rows.map((b) => ({ ...b, imageUrl: mediaUrl(b.imageId) }));
    });
  }

  private async checkTarget(tx: Tx, b: Partial<BannerInput>) {
    if (b.targetType === undefined && b.targetId === undefined) return;
    if ((b.targetType === 'none') !== (b.targetId == null))
      throw new UnprocessableEntityException('Escolha para onde o banner leva');
    if (b.targetType === 'product' || b.targetType === 'category') {
      const table = b.targetType === 'product' ? 'products' : 'categories';
      const ok = await one(tx, `SELECT 1 FROM ${table} WHERE id = $1`, [b.targetId]);
      if (!ok)
        throw new NotFoundException(
          b.targetType === 'product' ? 'Produto não encontrado' : 'Categoria não encontrada',
        );
    }
  }

  async createBanner(ctx: Ctx, b: Partial<BannerInput> & { title: string }) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const n = await one<{ n: number; pos: number }>(
        tx,
        `SELECT count(*)::int AS n, COALESCE(max(position) + 1, 0)::int AS pos FROM store_banners`,
      );
      if (n!.n >= MAX_BANNERS)
        throw new UnprocessableEntityException(`Limite de ${MAX_BANNERS} banners`);
      const targetType = b.targetType ?? 'none';
      const targetId = targetType === 'none' ? null : (b.targetId ?? null);
      await this.checkTarget(tx, { targetType, targetId });
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO store_banners (tenant_id, title, subtitle, tag, cta, image_id, target_type, target_id, active, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          ctx.tenantId,
          b.title,
          b.subtitle ?? null,
          b.tag ?? null,
          b.cta ?? null,
          b.imageId ?? null,
          targetType,
          targetId,
          b.active ?? true,
          b.position ?? n!.pos,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'store.banner_created',
        entity: 'store_banner',
        entityId: row!.id,
        data: { title: b.title },
        ip: ctx.ip,
      });
      return row!;
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return res;
  }

  async updateBanner(ctx: Ctx, id: string, b: Partial<BannerInput>) {
    const cols: [keyof BannerInput, string][] = [
      ['title', 'title'],
      ['subtitle', 'subtitle'],
      ['tag', 'tag'],
      ['cta', 'cta'],
      ['imageId', 'image_id'],
      ['targetType', 'target_type'],
      ['targetId', 'target_id'],
      ['active', 'active'],
      ['position', 'position'],
    ];
    if (b.targetType === 'none') b.targetId = null;
    await this.db.withTenant(ctx, async (tx) => {
      const cur = await one<BannerInput>(
        tx,
        `SELECT ${BANNER_COLS} FROM store_banners WHERE id = $1`,
        [id],
      );
      if (!cur) throw new NotFoundException('Banner não encontrado');
      if (b.targetType !== undefined || b.targetId !== undefined)
        await this.checkTarget(tx, {
          targetType: b.targetType ?? cur.targetType,
          targetId: b.targetId !== undefined ? b.targetId : cur.targetId,
        });
      const set = cols.filter(([k]) => b[k] !== undefined);
      await q(
        tx,
        `UPDATE store_banners SET ${set.map(([, c], i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...set.map(([k]) => b[k])],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'store.banner_updated',
        entity: 'store_banner',
        entityId: id,
        data: { changes: b },
        ip: ctx.ip,
      });
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return { ok: true };
  }

  async deleteBanner(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(tx, `DELETE FROM store_banners WHERE id = $1 RETURNING id`, [id]);
      if (!r) throw new NotFoundException('Banner não encontrado');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'store.banner_deleted',
        entity: 'store_banner',
        entityId: id,
        ip: ctx.ip,
      });
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return { ok: true };
  }
}
