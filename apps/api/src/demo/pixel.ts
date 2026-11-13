import { randomUUID } from 'node:crypto';
import type { ClientBase } from 'pg';

/**
 * Pixel do cardápio na demonstração: visitas, cliques, sacola e buscas coerentes com os pedidos
 * online já criados (cada pedido online ganha a sessão que o fez; as outras sessões olham e vão
 * embora). Assim Relatórios › Cardápio online já abre com números.
 */
export interface DemoPixelInput {
  T: string;
  now: number;
  rand: {
    next(): number;
    int(lo: number, hi: number): number;
    pick<T>(xs: readonly T[]): T;
    chance(p: number): boolean;
  };
  products: { id: string; name: string; cents: number }[];
  categoryIds: string[];
  bannerIds: string[];
  onlineOrders: {
    createdAt: number;
    total: number;
    items: { productId: string; qty: number; total: number }[];
  }[];
}

const MIN = 60_000;
const DAY = 86_400_000;

const SOURCES: { source: string | null; weight: number; campaign?: string }[] = [
  { source: null, weight: 44 },
  { source: 'instagram', weight: 22 },
  { source: 'instagram', weight: 6, campaign: 'promo-fim-de-semana' },
  { source: 'whatsapp', weight: 15 },
  { source: 'google', weight: 8 },
  { source: 'facebook', weight: 3 },
  { source: 'ifood', weight: 2, campaign: 'link-na-bio' },
];
const DEVICES = [
  { device: 'phone', weight: 78 },
  { device: 'desktop', weight: 15 },
  { device: 'tablet', weight: 7 },
];
const MISSING = ['açaí', 'vegano', 'sem glúten', 'combo família', 'sorvete'];

function weighted<T extends { weight: number }>(next: () => number, xs: readonly T[]): T {
  const total = xs.reduce((s, x) => s + x.weight, 0);
  let v = next() * total;
  for (const x of xs) if ((v -= x.weight) < 0) return x;
  return xs[xs.length - 1]!;
}

export async function seedDemoPixel(c: ClientBase, x: DemoPixelInput) {
  const { T, now, rand: r } = x;
  if (!x.products.length) return 0;
  const rows: unknown[][] = [];
  const visitors = Array.from({ length: Math.max(20, x.onlineOrders.length * 3) }, () =>
    randomUUID(),
  );
  // Itens que saem mais aparecem mais (tirados dos pedidos), com um pouco de acaso.
  const popular = x.onlineOrders.flatMap((o) => o.items.map((i) => i.productId));
  const anyProduct = () =>
    popular.length && r.chance(0.7) ? r.pick(popular) : r.pick(x.products).id;
  const price = new Map(x.products.map((p) => [p.id, p.cents]));
  const name = new Map(x.products.map((p) => [p.id, p.name]));

  const session = (start: number, buy?: DemoPixelInput['onlineOrders'][number]) => {
    const sid = randomUUID();
    const vid = r.pick(visitors);
    const src = weighted(r.next, SOURCES);
    const dev = weighted(r.next, DEVICES);
    let t = start;
    const step = () => (t += r.int(8, 70) * 1000);
    const ev = (
      type: string,
      d: {
        productId?: string;
        targetId?: string;
        value?: number;
        quantity?: number;
        term?: string;
      } = {},
    ) =>
      rows.push([
        T,
        new Date(Math.min(t, now - 1000)).toISOString(),
        sid,
        vid,
        type,
        d.productId ?? null,
        d.targetId ?? null,
        d.value ?? null,
        d.quantity ?? null,
        d.term ?? null,
        type === 'visit' ? dev.device : null,
        type === 'visit' ? src.source : null,
        type === 'visit' && src.campaign ? 'social' : null,
        type === 'visit' ? (src.campaign ?? null) : null,
        false,
      ]);
    ev('visit');
    if (x.bannerIds.length && r.chance(0.12)) {
      step();
      ev('click_banner', { targetId: r.pick(x.bannerIds) });
    }
    if (x.categoryIds.length && r.chance(0.35)) {
      step();
      ev('click_category', { targetId: r.pick(x.categoryIds) });
    }
    if (r.chance(0.18)) {
      step();
      const miss = r.chance(0.35);
      const term = miss
        ? r.pick(MISSING)
        : (name.get(anyProduct()) ?? 'x').toLowerCase().split(/\s+/)[0]!;
      ev('search', { term, quantity: miss ? 0 : r.int(1, 4) });
    }
    if (buy) {
      for (let k = r.int(0, 2); k > 0; k--) {
        step();
        ev('view_item', { productId: anyProduct() });
      }
      for (const i of buy.items) {
        step();
        ev('view_item', { productId: i.productId });
        step();
        ev('add_to_cart', { productId: i.productId, quantity: i.qty, value: i.total / 100 });
      }
      step();
      ev('view_cart', { value: buy.total / 100 });
      step();
      ev('begin_checkout', { value: buy.total / 100 });
      t = Math.max(t, buy.createdAt - 1000);
      ev('purchase', { value: buy.total / 100 });
      return;
    }
    // Olhou e foi embora: cada passo do funil perde gente.
    if (!r.chance(0.74)) return;
    const viewed: string[] = [];
    for (let k = r.int(1, 4); k > 0; k--) {
      step();
      const p = anyProduct();
      viewed.push(p);
      ev('view_item', { productId: p });
      if (r.chance(0.08)) ev('favorite', { productId: p });
    }
    if (!r.chance(0.3)) return;
    const p = r.pick(viewed);
    const q = r.int(1, 2);
    step();
    ev('add_to_cart', { productId: p, quantity: q, value: ((price.get(p) ?? 0) * q) / 100 });
    if (!r.chance(0.62)) return;
    step();
    ev('view_cart');
    if (r.chance(0.25)) {
      step();
      ev('remove_from_cart', { productId: p });
      return;
    }
    if (!r.chance(0.45)) return;
    step();
    ev('begin_checkout');
  };

  for (const o of x.onlineOrders) session(o.createdAt - r.int(4, 18) * MIN, o);
  // Quem não comprou: perto dos horários de movimento, espalhado pelos dias.
  const times = x.onlineOrders.map((o) => o.createdAt);
  const extra = Math.max(60, x.onlineOrders.length * 5);
  for (let k = 0; k < extra; k++) {
    const base = times.length ? r.pick(times) : now - r.int(0, 29) * DAY;
    const at = base + r.int(-3, 3) * DAY + r.int(-90, 90) * MIN;
    if (at >= now - 2 * MIN || (times.length && at < Math.min(...times))) continue;
    session(at);
  }

  const cols = [
    'tenant_id',
    'at',
    'session_id',
    'visitor_id',
    'type',
    'product_id',
    'target_id',
    'value',
    'quantity',
    'term',
    'device',
    'source',
    'medium',
    'campaign',
    'at_table',
  ];
  const per = Math.floor(30_000 / cols.length);
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params: unknown[] = [];
    const values = chunk.map(
      (row) => `(${row.map((v) => (params.push(v), `$${params.length}`)).join(',')})`,
    );
    await c.query(`INSERT INTO menu_events (${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
  return rows.length;
}
