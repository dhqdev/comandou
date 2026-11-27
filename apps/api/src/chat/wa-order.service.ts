import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { menuTreeSql } from '../catalog/menu-sql';
import { onlineCtx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { GeocoderService } from '../delivery/geocoder.service';
import { locateContext } from '../delivery/zones';
import { ZonesService } from '../delivery/zones.service';
import { CustomersService, normalizePhone } from '../store/customers.service';
import { StoreService, type OnlineOrderInput } from '../store/store.service';
import type { QuoteResult } from './wa-flow-engine';
import { type Flow, type FlowAddress, type FlowCategory, fromCents, toCents } from './wa-flow';

/**
 * O que o atendimento por menu do WhatsApp precisa do restaurante: o cardápio liberado para a IA
 * (com ids e complementos), o cadastro do número da conversa, os endereços salvos, a taxa da área
 * de entrega do endereço e o pedido, feito pelo mesmo caminho do cardápio online
 * (`StoreService.placeOrder`: horário, áreas, pedido mínimo, estoque e aceite automático).
 */
@Injectable()
export class WaOrderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: StoreService,
    private readonly customers: CustomersService,
    private readonly zones: ZonesService,
    @Optional() private readonly geocoder?: GeocoderService,
  ) {}

  /** Cardápio de delivery, só com os itens que o gerente deixou a IA oferecer. */
  async menuIn(tx: Tx): Promise<FlowCategory[]> {
    const rows = await q<{
      name: string;
      products: {
        id: string;
        name: string;
        description: string | null;
        price: string;
        soldOut: boolean;
        soldByWeight: boolean | null;
        aiVisible: boolean;
        optionGroups:
          | {
              id: string;
              name: string;
              minSelect: number;
              maxSelect: number;
              allowRepeat: boolean | null;
              options: { id: string; name: string; priceDelta: string; stockOut: boolean | null }[];
            }[]
          | null;
      }[];
    }>(tx, menuTreeSql(`'aiVisible', p.ai_visible,`), ['delivery']);
    return rows
      .map((c) => ({
        name: c.name,
        items: c.products
          .filter((p) => p.aiVisible)
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: p.price,
            soldOut: !!p.soldOut,
            soldByWeight: !!p.soldByWeight,
            groups: (p.optionGroups ?? []).map((g) => ({
              id: g.id,
              name: g.name,
              minSelect: g.minSelect,
              maxSelect: Math.max(1, g.maxSelect),
              allowRepeat: !!g.allowRepeat,
              options: g.options.map((o) => ({
                id: o.id,
                name: o.name,
                priceDelta: o.priceDelta,
                stockOut: !!o.stockOut,
              })),
            })),
          })),
      }))
      .filter((c) => c.items.length > 0);
  }

  menu(tenantId: string) {
    return this.db.withTenant({ tenantId }, (tx) => this.menuIn(tx));
  }

  /** Cadastro do número da conversa (DDD + 8 últimos dígitos: o WhatsApp às vezes tira o 9). */
  async customer(tenantId: string, phone: string): Promise<{ id: string; name: string } | null> {
    const d = normalizePhone(phone);
    if (d.length < 10) return null;
    return this.db.withTenant(
      { tenantId },
      async (tx) =>
        (await one<{ id: string; name: string }>(
          tx,
          `SELECT id, name FROM customers
          WHERE blocked_at IS NULL AND app_phone_key(phone) = app_phone_key($1)
          ORDER BY (phone = $1) DESC, last_login_at DESC NULLS LAST, created_at LIMIT 1`,
          [d],
        )) ?? null,
    );
  }

  /**
   * Cadastro novo pelo WhatsApp (nome e o número da conversa, que já vale como confirmado: quem
   * escreve é o dono do número). A senha é aleatória; no cardápio online o cliente cria a dele em
   * "Esqueci minha senha".
   */
  async signup(tenantId: string, phone: string, name: string) {
    const c = await this.customers.staffCreate(onlineCtx(tenantId), {
      name: name.slice(0, 80),
      phone: normalizePhone(phone),
    });
    return { id: c.id, name: c.name };
  }

  async addresses(tenantId: string, customerId: string): Promise<FlowAddress[]> {
    const rows = await this.db.withTenant({ tenantId }, (tx) =>
      q<{
        id: string;
        street: string;
        number: string;
        district: string;
        complement: string | null;
        reference: string | null;
        cep: string | null;
        city: string | null;
        state: string | null;
        lat: string | null;
        lng: string | null;
      }>(
        tx,
        `SELECT id, street, number, district, complement, reference, cep, city, state,
                lat::text, lng::text
           FROM customer_addresses WHERE customer_id = $1
          ORDER BY is_default DESC, created_at DESC LIMIT 8`,
        [customerId],
      ),
    );
    return rows.map((r) => ({
      savedId: r.id,
      street: r.street,
      number: r.number,
      district: r.district,
      ...(r.complement ? { complement: r.complement } : {}),
      ...(r.reference ? { reference: r.reference } : {}),
      ...(r.cep ? { cep: r.cep } : {}),
      ...(r.city ? { city: r.city } : {}),
      ...(r.state ? { state: r.state } : {}),
      ...(r.lat && r.lng ? { lat: Number(r.lat), lng: Number(r.lng) } : {}),
    }));
  }

  async saveAddress(tenantId: string, customerId: string, a: FlowAddress) {
    await this.db.withTenant({ tenantId }, async (tx) => {
      const n = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM customer_addresses WHERE customer_id = $1`,
        [customerId],
      );
      if ((n?.n ?? 0) >= 10) return;
      await q(
        tx,
        `INSERT INTO customer_addresses (tenant_id, customer_id, label, street, number, district,
                                         complement, reference, cep, city, state, lat, lng, is_default)
         VALUES ($1, $2, 'WhatsApp', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          tenantId,
          customerId,
          a.street.slice(0, 120),
          a.number.slice(0, 20),
          a.district.slice(0, 80),
          a.complement?.slice(0, 80) ?? null,
          a.reference?.slice(0, 120) ?? null,
          a.cep ?? null,
          a.city?.slice(0, 80) ?? null,
          a.state?.slice(0, 2).toUpperCase() ?? null,
          a.lat ?? null,
          a.lng ?? null,
          (n?.n ?? 0) === 0,
        ],
      );
    });
  }

  /**
   * Taxa de entrega do endereço: acha o ponto no mapa (a mesma busca do cardápio) e a área que
   * cobre. Sem áreas desenhadas, vale a taxa fixa da loja (o mapa nem é preciso).
   */
  async quote(tenantId: string, a: FlowAddress): Promise<QuoteResult> {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.store.settingsIn(tx);
      const zones = await this.zones.listIn(tx);
      const active = zones.some((z) => z.active);
      let point = a.lat !== undefined && a.lng !== undefined ? { lat: a.lat, lng: a.lng } : null;
      if (!point && this.geocoder) {
        const region = await this.store.regionIn(tx, s);
        const found = await this.geocoder
          .locate(
            {
              street: a.street,
              number: a.number,
              district: a.district,
              city: a.city ?? region.city ?? undefined,
              state: a.state ?? region.state ?? undefined,
              cep: a.cep,
            },
            locateContext(s, region, zones),
          )
          .catch(() => null);
        if (found && found.precision !== 'city' && found.precision !== 'store')
          point = { lat: found.lat, lng: found.lng };
      }
      if (!active)
        return { ok: true as const, fee: toCents(s.deliveryFee), minOrder: null, ...(point ?? {}) };
      if (!point) return { ok: false as const, reason: 'not_found' as const };
      const qt = await this.zones.quoteIn(tx, [point.lat, point.lng], s.deliveryFee, a.district);
      if (!qt.covered) return { ok: false as const, reason: 'not_covered' as const };
      return {
        ok: true as const,
        fee: toCents(qt.fee),
        minOrder: qt.minOrder ? toCents(qt.minOrder) : null,
        ...point,
      };
    });
  }

  /** Faz o pedido (mesmas regras do cardápio online) e devolve número, situação e total. */
  async place(tenantId: string, phone: string, f: Flow, trackBase: string | null) {
    const token = randomBytes(24).toString('base64url');
    const a = f.address;
    const input: OnlineOrderInput = {
      channel: f.mode ?? 'delivery',
      token,
      customerName: (f.name ?? 'Cliente do WhatsApp').slice(0, 80),
      customerPhone: normalizePhone(phone),
      ...(f.mode === 'delivery' && a
        ? {
            address: {
              street: a.street,
              number: a.number,
              district: a.district,
              ...(a.complement ? { complement: a.complement } : {}),
              ...(a.reference ? { reference: a.reference } : {}),
              ...(a.cep ? { cep: a.cep } : {}),
              ...(a.city ? { city: a.city } : {}),
              ...(a.state ? { state: a.state } : {}),
              ...(a.lat !== undefined && a.lng !== undefined ? { lat: a.lat, lng: a.lng } : {}),
            },
          }
        : {}),
      notes: 'Pedido feito pelo WhatsApp (atendimento automático)',
      paymentMethod: f.pay,
      ...(f.pay === 'cash' && f.changeFor ? { changeFor: fromCents(f.changeFor) } : {}),
      items: f.cart.map((l) => ({
        productId: l.productId,
        quantity: l.qty,
        optionIds: l.optionIds,
        ...(l.notes ? { notes: l.notes } : {}),
      })),
      ...(f.customerId ? { customerId: f.customerId } : {}),
      whatsapp: true,
    };
    // A mesma sacola confirmada duas vezes em 2 minutos (mensagem repetida) não vira dois pedidos.
    const key = `wa:${createHash('sha256')
      .update(
        `${normalizePhone(phone)}|${JSON.stringify(input.items)}|${f.pay}|${Math.floor(Date.now() / 120_000)}`,
      )
      .digest('hex')
      .slice(0, 48)}`;
    const r = await this.store.placeOrder(tenantId, input, key);
    return {
      number: r.number,
      status: r.status,
      total: r.total,
      trackUrl: trackBase ? `${trackBase}/pedido/${token}` : null,
    };
  }
}
