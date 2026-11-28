import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { menuTreeSql } from '../catalog/menu-sql';
import { onlineCtx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { GeocoderService } from '../delivery/geocoder.service';
import { locateContext } from '../delivery/zones';
import { ZonesService } from '../delivery/zones.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CustomersService, normalizePhone } from '../store/customers.service';
import { StoreService, type OnlineOrderInput } from '../store/store.service';
import type { PinResult, QuoteResult } from './wa-flow-engine';
import {
  type CartLine,
  type Flow,
  type FlowAddress,
  type FlowCategory,
  type FlowLoyalty,
  fromCents,
  toCents,
} from './wa-flow';

/** PIN errado por número de WhatsApp em 24 horas (6 números se adivinham). */
export const PIN_MAX_FAILS = 5;

/** Linha da sacola do cardápio (a mesma forma que o navegador guarda em customers.online_cart). */
interface WebLine {
  key: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  unit: string;
  optionIds: string[];
  optionNames: string[];
  quantity: number;
  notes: string;
  weight?: boolean;
}

/** Chave da linha igual à do cardápio: produto, opções em ordem e observação. */
export const webKey = (l: Pick<CartLine, 'productId' | 'optionIds' | 'notes'>) =>
  `${l.productId}:${[...l.optionIds].sort().join(',')}:${(l.notes ?? '').trim()}`;

/**
 * A sacola do cardápio depois da mudança feita no WhatsApp: soma o que entrou, tira o que saiu
 * (pela diferença entre a sacola antes e depois da mensagem) e não mexe no que o cliente pôs pelo
 * cardápio. Assim os dois lados não brigam: o WhatsApp só mexe no que ele mesmo colocou.
 */
export function mirrorLines(saved: unknown[], before: CartLine[], after: CartLine[]): WebLine[] {
  const qty = (list: CartLine[]) => {
    const m = new Map<string, { line: CartLine; qty: number }>();
    for (const l of list) {
      const k = webKey(l);
      const cur = m.get(k);
      m.set(k, { line: l, qty: (cur?.qty ?? 0) + l.qty });
    }
    return m;
  };
  const was = qty(before);
  const now = qty(after);
  const out = saved.filter(
    (l): l is WebLine =>
      !!l &&
      typeof (l as WebLine).key === 'string' &&
      typeof (l as WebLine).productId === 'string' &&
      typeof (l as WebLine).quantity === 'number' &&
      Array.isArray((l as WebLine).optionIds) &&
      Array.isArray((l as WebLine).optionNames),
  );
  for (const k of new Set([...was.keys(), ...now.keys()])) {
    const delta = (now.get(k)?.qty ?? 0) - (was.get(k)?.qty ?? 0);
    if (!delta) continue;
    const i = out.findIndex((l) => l.key === k);
    if (i >= 0) {
      const q = out[i]!.quantity + delta;
      if (q > 0) out[i] = { ...out[i]!, quantity: Math.min(50, q) };
      else out.splice(i, 1);
    } else if (delta > 0) {
      const l = now.get(k)!.line;
      out.push({
        key: k,
        productId: l.productId,
        name: l.name,
        imageUrl: null, // o cardápio acerta foto, nome e preço com o cardápio atual (syncCart)
        unit: fromCents(l.unit),
        optionIds: l.optionIds,
        optionNames: l.optionNames,
        quantity: Math.min(50, delta),
        notes: (l.notes ?? '').trim(),
      });
    }
  }
  return out.slice(0, 60);
}

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
    private readonly loyalty: LoyaltyService,
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
        imageId: string | null;
        badge: string | null;
        featured: boolean | null;
        rating: { average: number | string; count: number | string } | null;
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
    }>(
      tx,
      menuTreeSql(
        `'aiVisible', p.ai_visible, 'badge', p.badge, 'featured', p.featured,
         'rating', (SELECT json_build_object('average', round(avg(r.rating), 1), 'count', count(*))
                      FROM product_reviews r WHERE r.product_id = p.id AND r.hidden_at IS NULL
                    HAVING count(*) > 0),`,
      ),
      ['delivery'],
    );
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
            imageId: p.imageId,
            badge: p.badge,
            featured: !!p.featured,
            rating: p.rating
              ? { average: Number(p.rating.average), count: Number(p.rating.count) }
              : null,
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

  /**
   * Conta pelo PIN de 6 números (o mesmo do balcão). Os erros contam por número de WhatsApp, no
   * banco (mandar "menu" não zera): PIN_MAX_FAILS por 24 horas.
   */
  async byPin(tenantId: string, phone: string, pin: string): Promise<PinResult> {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const chat = await one<{ fails: number }>(
        tx,
        `SELECT CASE WHEN pin_fail_at > now() - interval '24 hours' THEN pin_fails ELSE 0 END AS fails
           FROM ai_customer_chats WHERE phone = $1`,
        [phone],
      );
      const fails = chat?.fails ?? 0;
      if (fails >= PIN_MAX_FAILS) return { ok: false as const, left: 0 };
      const found = /^\d{6}$/.test(pin)
        ? await one<{ id: string; name: string }>(
            tx,
            `SELECT c.id, c.name FROM loyalty_members m JOIN customers c ON c.id = m.customer_id
              WHERE m.pin = $1 AND c.blocked_at IS NULL`,
            [pin],
          )
        : null;
      if (found) {
        await q(
          tx,
          `UPDATE ai_customer_chats SET pin_fails = 0, pin_fail_at = NULL WHERE phone = $1`,
          [phone],
        );
        return { ok: true as const, id: found.id, name: found.name };
      }
      const r = await one<{ fails: number }>(
        tx,
        `UPDATE ai_customer_chats
            SET pin_fails = CASE WHEN pin_fail_at > now() - interval '24 hours'
                                 THEN least(pin_fails + 1, 1000) ELSE 1 END,
                pin_fail_at = now()
          WHERE phone = $1 RETURNING pin_fails AS fails`,
        [phone],
      );
      return { ok: false as const, left: Math.max(0, PIN_MAX_FAILS - (r?.fails ?? fails + 1)) };
    });
  }

  /** Pontos, nível e recompensas da conta, no formato da tela "Meus pontos" do WhatsApp. */
  async loyaltyOf(
    tenantId: string,
    customerId: string,
    viaPin: boolean,
  ): Promise<FlowLoyalty | null> {
    const v = await this.loyalty.publicView(tenantId, customerId);
    if (!v.enabled || !v.account) return null;
    const earned = v.account.earned ?? v.account.balance;
    const levels = [...v.levels].sort((a, z) => a.minPoints - z.minPoints);
    const level = [...levels].reverse().find((l) => l.minPoints <= earned) ?? null;
    const next = levels.find((l) => l.minPoints > earned) ?? null;
    return {
      mode: v.mode,
      balance: v.account.balance,
      pending: v.account.pending ?? 0,
      expiresAt: v.account.expiresAt ? new Date(v.account.expiresAt) : null,
      level: level?.name ?? null,
      nextLevel: next ? { name: next.name, missing: next.minPoints - earned } : null,
      // O PIN só vai para o dono do número (quem entrou pelo PIN já sabe).
      pin: viaPin ? null : v.account.pin,
      rewards: v.rewards.map((r) => ({
        id: r.id,
        name: r.name,
        cost: r.cost,
        kind: r.kind,
        amount: r.amount,
        productId: r.productId,
      })),
    };
  }

  /**
   * Mesa com a comanda aberta deste número agora (pedido pelo QR Code da mesa ou lançado com o
   * telefone do cliente nas últimas 6 horas). Na mesa, o pedido não é pelo WhatsApp.
   */
  async atTable(tenantId: string, phone: string): Promise<string | null> {
    const d = normalizePhone(phone);
    if (d.length < 10) return null;
    const r = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ label: string }>(
        tx,
        `SELECT dt.label FROM tabs t
           JOIN dining_tables dt ON dt.id = t.table_id
           JOIN orders o ON o.tab_id = t.id
          WHERE t.status = 'open' AND t.table_id IS NOT NULL
            AND o.created_at > now() - interval '6 hours'
            AND o.customer_phone IS NOT NULL
            AND app_phone_key(o.customer_phone) = app_phone_key($1)
          ORDER BY o.created_at DESC LIMIT 1`,
        [d],
      ),
    );
    return r?.label ?? null;
  }

  /**
   * Leva a mudança da sacola do WhatsApp para a sacola da conta no cardápio (customers.online_cart,
   * a mesma que o navegador guarda). O cardápio aberto percebe pela data e mostra.
   */
  async mirrorCart(tenantId: string, customerId: string, before: CartLine[], after: CartLine[]) {
    await this.db.withTenant({ tenantId }, async (tx) => {
      const row = await one<{ lines: unknown[] }>(
        tx,
        `SELECT online_cart AS lines FROM customers WHERE id = $1 AND blocked_at IS NULL FOR UPDATE`,
        [customerId],
      );
      if (!row) return;
      const lines = mirrorLines(Array.isArray(row.lines) ? row.lines : [], before, after);
      await q(
        tx,
        `UPDATE customers SET online_cart = $2::jsonb, online_cart_at = now() WHERE id = $1`,
        [customerId, JSON.stringify(lines)],
      );
    });
  }

  /** Link do cardápio que já entra na conta (o cliente vê a sacola montada no WhatsApp). */
  async siteLink(tenantId: string, customerId: string, storeUrl: string | null) {
    if (!storeUrl) return null;
    const on = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ on: boolean }>(tx, `SELECT accounts_enabled AS on FROM tenant_store_settings LIMIT 1`),
    );
    if (on && !on.on) return null;
    const token = await this.customers.createLoginLink(tenantId, customerId);
    return token ? `${storeUrl}?entrar=${token}` : null;
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
      ...(f.customerId && f.rewardId ? { rewardId: f.rewardId } : {}),
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
