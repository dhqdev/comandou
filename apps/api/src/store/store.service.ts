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
}

const SETTINGS_COLS = `enabled, is_open AS "isOpen", auto_accept AS "autoAccept",
  accepts_delivery AS "acceptsDelivery", accepts_pickup AS "acceptsPickup",
  delivery_fee::text AS "deliveryFee", min_order::text AS "minOrder", eta_min AS "etaMin",
  eta_max AS "etaMax", about, address, whatsapp, cover_image_id AS "coverImageId",
  logo_image_id AS "logoImageId"`;

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
  };
  notes?: string;
  paymentMethod: 'cash' | 'credit' | 'debit' | 'pix' | 'voucher';
  changeFor?: string;
  items: { productId: string; quantity: number; notes?: string; optionIds?: string[] }[];
}

/** Loja online: configurações, cardápio público e pedidos feitos pelo cliente final. */
@Injectable()
export class StoreService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
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
          optionGroups: unknown[];
        }[];
      }>(
        tx,
        `SELECT c.id, c.name, c.image_id AS "imageId",
           COALESCE((SELECT json_agg(json_build_object(
               'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price::text,
               'soldOut', p.sold_out, 'imageId', p.image_id,
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
        },
        categories: categories
          .filter((c) => c.products.length > 0)
          .map(({ imageId, products, ...c }) => ({
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
    const order = await this.orders.create(
      ctx,
      {
        channel: input.channel,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        deliveryAddress: address,
        notes: input.notes,
        deliveryFee: input.channel === 'delivery' ? s.deliveryFee : undefined,
        items: input.items,
        online: {
          tokenHash: publicTokenHash(input.token),
          autoAccept: s.autoAccept,
          paymentHint: input.paymentMethod,
          changeFor: input.paymentMethod === 'cash' ? input.changeFor : undefined,
        },
        minSubtotal: s.minOrder,
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
    return this.db.withTenant({ tenantId }, async (tx) => {
      const id = await this.byToken(tx, token);
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
    });
  }

  /** O cliente pode desistir enquanto o pedido ainda está em análise. */
  async cancelByCustomer(tenantId: string, token: string, ip?: string) {
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    const orderId = await this.db.withTenant(ctx, async (tx) => {
      const id = await this.byToken(tx, token);
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
}
