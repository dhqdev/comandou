import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientBase } from 'pg';
import { fromCents, multiplyCents, paymentStatusFor, toCents } from '@comandou/shared';
import { hashPassword } from '../auth/password';
import { distanceM, insidePolygon } from '../delivery/zones';
import * as C from './catalog';

/** Fotos e logo do restaurante de demonstração (geradas por tools/demo-images). */
export const DEMO_IMAGES_DIR = join(__dirname, '..', '..', 'db', 'demo', 'images');
/** Linha do audit_log que marca o restaurante como já preenchido (nunca preenche duas vezes). */
export const DEMO_MARKER = 'demo.seeded';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** São Paulo não tem horário de verão desde 2019: UTC−3 o ano todo. */
const TZ_OFFSET = 3 * HOUR;

type Method = 'cash' | 'credit' | 'debit' | 'pix' | 'voucher';
type Channel = 'counter' | 'table' | 'delivery' | 'pickup';
type Status =
  | 'awaiting'
  | 'new'
  | 'in_production'
  | 'ready'
  | 'dispatched'
  | 'completed'
  | 'cancel_requested'
  | 'cancelled';

export interface DemoSeedResult {
  orders: number;
  users: string[];
  courierLink: string;
}

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
    weighted: <T extends { weight: number }>(xs: readonly T[]): T => {
      const total = xs.reduce((s, x) => s + x.weight, 0);
      let r = next() * total;
      for (const x of xs) {
        r -= x.weight;
        if (r <= 0) return x;
      }
      return xs[xs.length - 1]!;
    },
  };
}

/** Insere muitas linhas de uma vez (em blocos, abaixo do limite de parâmetros do Postgres). */
async function bulk(c: ClientBase, table: string, cols: string[], rows: unknown[][]) {
  const per = Math.max(1, Math.floor(30_000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params: unknown[] = [];
    const values = chunk.map((r) => {
      const ph = r.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest();
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Preenche um restaurante VAZIO com uma operação de ~30 dias: cardápio com fotos, equipe com
 * todos os papéis, mesas, comandas, pedidos de todos os canais e situações, caixa, estoque com
 * ficha técnica, entregas, áreas de entrega, clientes, financeiro, nota fiscal (homologação) e a
 * loja online. Roda numa transação só (quem chama abre e fecha); datas relativas a `now`.
 * A senha de todos os usuários é DEMO_PASSWORD; o e-mail é <papel>@<emailDomain>.
 */
export async function seedDemoData(
  c: ClientBase,
  tenantId: string,
  opts: { now?: Date; emailDomain: string; days?: number; log?: (m: string) => void },
): Promise<DemoSeedResult> {
  const now = (opts.now ?? new Date()).getTime();
  const days = opts.days ?? 30;
  const r = rng(20261023);
  const T = tenantId;
  const log = opts.log ?? (() => undefined);

  const localMidnight = (daysAgo: number) => {
    const l = new Date(now - TZ_OFFSET);
    return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() - daysAgo) + TZ_OFFSET;
  };
  const at = (daysAgo: number, hh: number, mm = 0) => localMidnight(daysAgo) + hh * HOUR + mm * MIN;
  const localDate = (ms: number) => new Date(ms - TZ_OFFSET).toISOString().slice(0, 10);

  // ------------------------------------------------------------------ equipe
  const pw = await hashPassword(C.DEMO_PASSWORD);
  const userId: Record<string, string> = {};
  for (const u of C.USERS) {
    const email = `${u.email}@${opts.emailDomain}`;
    const row = await c.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [email, u.name, pw, iso(now - (days + 10) * DAY)],
    );
    userId[u.key] = row.rows[0]!.id;
    await c.query(
      `INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [T, userId[u.key], u.role, iso(now - (days + 10) * DAY)],
    );
  }
  const U = (k: string) => userId[k]!;

  // ------------------------------------------------------------------ fotos
  const manifest = JSON.parse(
    readFileSync(join(DEMO_IMAGES_DIR, 'manifest.json'), 'utf8'),
  ) as Record<string, { width: number; height: number }>;
  const media: Record<string, string> = {};
  for (const [name, m] of Object.entries(manifest)) {
    const bytes = readFileSync(join(DEMO_IMAGES_DIR, `${name}.webp`));
    const id = randomUUID();
    media[name] = id;
    await c.query(
      `INSERT INTO media (id, tenant_id, content_type, bytes, size, width, height, created_by)
       VALUES ($1, $2, 'image/webp', $3, $4, $5, $6, $7)`,
      [id, T, bytes, bytes.length, m.width, m.height, U('owner')],
    );
  }

  // ------------------------------------------------------------------ cardápio
  const sectorId: Record<string, string> = {};
  for (const s of C.SECTORS) {
    sectorId[s.key] = randomUUID();
    await c.query(
      `INSERT INTO production_sectors (id, tenant_id, name, channels, warn_after_min, late_after_min)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sectorId[s.key], T, s.name, [...s.channels], s.warn, s.late],
    );
  }
  const categoryId: Record<string, string> = {};
  await c.query(`DELETE FROM categories WHERE tenant_id = $1`, [T]); // "Mais pedidos" do cadastro
  await bulk(
    c,
    'categories',
    ['id', 'tenant_id', 'name', 'position', 'image_id'],
    C.CATEGORIES.map((cat, i) => {
      categoryId[cat.key] = randomUUID();
      return [categoryId[cat.key], T, cat.name, i, media[cat.image]];
    }),
  );

  const groupId: Record<string, string> = {};
  const options: Record<string, { id: string; name: string; delta: number }[]> = {};
  const optionRecipes: unknown[][] = [];
  for (const g of C.OPTION_GROUPS) {
    groupId[g.key] = randomUUID();
    await c.query(
      `INSERT INTO option_groups (id, tenant_id, name, min_select, max_select) VALUES ($1,$2,$3,$4,$5)`,
      [groupId[g.key], T, g.name, g.min, g.max],
    );
    options[g.key] = g.options.map(([name, delta]) => ({
      id: randomUUID(),
      name,
      delta: toCents(delta),
    }));
    await bulk(
      c,
      'options',
      ['id', 'tenant_id', 'group_id', 'name', 'price_delta', 'position'],
      options[g.key]!.map((o, i) => [o.id, T, groupId[g.key], o.name, fromCents(o.delta), i]),
    );
    g.options.forEach(([, , item, qty], i) => {
      if (item) optionRecipes.push([T, options[g.key]![i]!.id, item, qty]);
    });
  }

  const stockId: Record<string, string> = {};
  const stockCost: Record<string, number> = {};
  for (const [key, [name, unit, min, cost]] of Object.entries(C.STOCK_ITEMS)) {
    stockId[key] = randomUUID();
    stockCost[key] = toCents(cost);
    await c.query(
      `INSERT INTO stock_items (id, tenant_id, name, unit, quantity, min_quantity, avg_cost, created_at)
       VALUES ($1,$2,$3,$4,0,$5,$6,$7)`,
      [stockId[key], T, name, unit, min, cost, iso(now - (days + 2) * DAY)],
    );
  }
  await bulk(
    c,
    'option_recipes',
    ['tenant_id', 'option_id', 'stock_item_id', 'quantity'],
    optionRecipes.map(([t, o, item, q]) => [t, o, stockId[item as string], q]),
  );

  interface P extends C.DemoProduct {
    id: string;
    cents: number;
  }
  const products: P[] = C.PRODUCTS.map((p) => ({
    ...p,
    id: randomUUID(),
    cents: toCents(p.price),
  }));
  const byKey = Object.fromEntries(products.map((p) => [p.key, p])) as Record<string, P>;
  await bulk(
    c,
    'products',
    [
      'id',
      'tenant_id',
      'category_id',
      'name',
      'description',
      'price',
      'sector_id',
      'position',
      'image_id',
      'featured',
      'badge',
      'sold_out',
      'ncm',
      'created_at',
    ],
    products.map((p, i) => [
      p.id,
      T,
      categoryId[p.category],
      p.name,
      p.description,
      p.price,
      sectorId[p.sector],
      i,
      media[p.image],
      !!p.featured,
      p.badge ?? null,
      !!p.soldOut,
      p.ncm ?? null,
      iso(now - (days + 5) * DAY),
    ]),
  );
  await bulk(
    c,
    'product_option_groups',
    ['tenant_id', 'product_id', 'group_id', 'position'],
    products.flatMap((p) => (p.groups ?? []).map((g, i) => [T, p.id, groupId[g], i])),
  );
  await bulk(
    c,
    'product_recipes',
    ['tenant_id', 'product_id', 'stock_item_id', 'quantity'],
    products.flatMap((p) =>
      Object.entries(p.recipe ?? {}).map(([item, q]) => [T, p.id, stockId[item], q]),
    ),
  );

  // ------------------------------------------------------------------ salão, entregas e loja
  const tableId: Record<string, string> = {};
  await bulk(
    c,
    'dining_tables',
    ['id', 'tenant_id', 'label', 'seats', 'area', 'position'],
    C.TABLES.map((t, i) => {
      tableId[t.label] = randomUUID();
      return [tableId[t.label], T, t.label, t.seats, t.area, i];
    }),
  );

  const courierId: Record<string, string> = {};
  const courierToken = randomBytes(24).toString('base64url');
  for (const k of C.COURIERS) {
    courierId[k.key] = randomUUID();
    const link = k.user === null;
    await c.query(
      `INSERT INTO couriers (id, tenant_id, name, phone, user_id, access_token_hash, access_created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        courierId[k.key],
        T,
        k.name,
        k.phone,
        k.user ? U(k.user) : null,
        link ? sha(courierToken) : null,
        link ? iso(now - 3 * DAY) : null,
      ],
    );
  }

  const store = C.STORE_LOCATION;
  for (const [i, z] of C.ZONES.entries()) {
    await c.query(
      `INSERT INTO delivery_zones (tenant_id, name, color, kind, polygon, center_lat, center_lng, radius_m,
                                   fee, min_order, eta_min, eta_max, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        T,
        z.name,
        z.color,
        z.kind,
        z.kind === 'polygon' ? JSON.stringify(z.polygon) : null,
        z.kind === 'radius' ? store.lat : null,
        z.kind === 'radius' ? store.lng : null,
        z.kind === 'radius' ? z.radius : null,
        z.fee,
        z.min,
        z.eta[0],
        z.eta[1],
        i,
      ],
    );
  }
  const zoneFee = (lat: number, lng: number) => {
    for (const z of C.ZONES) {
      const inside =
        z.kind === 'radius'
          ? distanceM([store.lat, store.lng], [lat, lng]) <= z.radius
          : insidePolygon([lat, lng], z.polygon);
      if (inside) return toCents(z.fee);
    }
    return toCents(C.ZONES[C.ZONES.length - 1]!.fee);
  };

  await c.query(
    `INSERT INTO tenant_store_settings (tenant_id, enabled, is_open, auto_accept, accepts_delivery,
        accepts_pickup, delivery_fee, min_order, eta_min, eta_max, about, address, whatsapp,
        cover_image_id, logo_image_id, theme, headline, featured_title, accounts_enabled, show_popular,
        store_lat, store_lng)
     VALUES ($1, true, true, false, true, true, '8.00', '25.00', 30, 50, $2, $3, $4, $5, $6, 'auto',
             $7, $8, true, true, $9, $10)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [
      T,
      'Hambúrguer na brasa e pizza de forno a lenha desde 2014. Ingredientes frescos, pão brioche da casa e massa de fermentação natural. Restaurante de demonstração do Comandou.',
      'Rua dos Pinheiros, 870 - Pinheiros, São Paulo - SP',
      '(11) 98765-4321',
      media.capa,
      media.logo,
      'Bateu a fome? A brasa tá acesa!',
      'Os queridinhos da casa',
      store.lat,
      store.lng,
    ],
  );
  await bulk(
    c,
    'store_banners',
    [
      'tenant_id',
      'title',
      'subtitle',
      'tag',
      'cta',
      'image_id',
      'target_type',
      'target_id',
      'position',
    ],
    C.BANNERS.map((b, i) => {
      const product = 'product' in b ? byKey[b.product] : undefined;
      const category = 'category' in b ? categoryId[b.category] : undefined;
      return [
        T,
        b.title,
        b.subtitle,
        b.tag,
        b.cta,
        media[b.image],
        product ? 'product' : category ? 'category' : 'none',
        product?.id ?? category ?? null,
        i,
      ];
    }),
  );

  const customerPw = await hashPassword(C.DEMO_CUSTOMER_PASSWORD);
  const customers = C.CUSTOMERS.map((cu, i) => ({
    ...cu,
    id: randomUUID(),
    hasAccount: i < 16,
    address: `${cu.street}, ${cu.number} - ${cu.district}`,
    fee: zoneFee(cu.lat, cu.lng),
  }));
  await bulk(
    c,
    'customers',
    [
      'id',
      'tenant_id',
      'name',
      'phone',
      'email',
      'password_hash',
      'marketing_opt_in',
      'staff_notes',
      'created_at',
      'last_login_at',
    ],
    customers
      .filter((cu) => cu.hasAccount)
      .map((cu, i) => [
        cu.id,
        T,
        cu.name,
        cu.phone,
        `${cu.name
          .split(' ')[0]!
          .toLowerCase()
          .normalize('NFD')
          .replace(/[^a-z]/g, '')}${i}@exemplo.com`,
        customerPw,
        i % 3 !== 0,
        cu.notes ?? null,
        iso(now - (days - i) * DAY),
        iso(now - r.int(1, 72) * HOUR),
      ]),
  );
  await bulk(
    c,
    'customer_addresses',
    [
      'tenant_id',
      'customer_id',
      'label',
      'street',
      'number',
      'district',
      'is_default',
      'lat',
      'lng',
    ],
    customers
      .filter((cu) => cu.hasAccount)
      .map((cu, i) => [
        T,
        cu.id,
        i % 4 === 0 ? 'Trabalho' : 'Casa',
        cu.street,
        cu.number,
        cu.district,
        true,
        cu.lat,
        cu.lng,
      ]),
  );

  await c.query(
    `INSERT INTO tenant_fiscal_settings (tenant_id, enabled, environment, cnpj, default_ncm, updated_by)
     VALUES ($1, false, 'homologacao', '12345678000195', '21069090', $2) ON CONFLICT (tenant_id) DO NOTHING`,
    [T, U('fiscal')],
  );
  await c.query(
    `INSERT INTO tenant_messaging_settings (tenant_id, provider, enabled, updated_by)
     VALUES ($1, 'baileys', false, $2) ON CONFLICT (tenant_id) DO NOTHING`,
    [T, U('owner')],
  );
  const agentId = randomUUID();
  await c.query(
    `INSERT INTO print_agents (id, tenant_id, name, token_hash, active, last_seen_at, version, created_at)
     VALUES ($1, $2, 'Impressora da cozinha', $3, true, $4, '1.0.0', $5)`,
    [
      agentId,
      T,
      sha(randomBytes(24).toString('base64url')),
      iso(now - 26 * HOUR),
      iso(now - days * DAY),
    ],
  );
  const registerId = randomUUID();
  await c.query(
    `INSERT INTO cash_registers (id, tenant_id, name) VALUES ($1, $2, 'Caixa principal')`,
    [registerId, T],
  );

  // ------------------------------------------------------------------ operação (simulação)
  interface Item {
    id: string;
    productId: string;
    name: string;
    qty: number;
    unit: number;
    total: number;
    notes: string | null;
    sectorId: string;
    status: 'pending' | 'preparing' | 'ready' | 'cancelled';
    startedAt: number | null;
    readyAt: number | null;
    options: { id: string; name: string; delta: number }[];
    recipe: Record<string, number>;
  }
  interface Order {
    id: string;
    number: number;
    channel: Channel;
    status: Status;
    createdAt: number;
    updatedAt: number;
    tabId: string | null;
    customerName: string | null;
    customerPhone: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    notes: string | null;
    subtotal: number;
    discount: number;
    deliveryFee: number;
    paid: number;
    createdBy: string | null;
    source: 'staff' | 'online';
    paymentHint: Method | null;
    changeFor: number | null;
    acceptedAt: number | null;
    customerId: string | null;
    cancelReason: string | null;
    version: number;
    items: Item[];
    history: {
      from: Status | null;
      to: Status;
      actor: string | null;
      at: number;
      reason?: string;
    }[];
  }
  const total = (o: Order) => o.subtotal - o.discount + o.deliveryFee;

  const orders: Order[] = [];
  const payments: unknown[][] = [];
  const movements: unknown[][] = [];
  const deliveries: unknown[][] = [];
  const tabs: unknown[][] = [];
  const stockEvents: {
    at: number;
    kind: 'sale' | 'sale_reversal';
    orderId: string;
    need: Record<string, number>;
  }[] = [];
  const sessions: {
    id: string;
    number: number;
    openedAt: number;
    closedAt: number | null;
    day: number;
  }[] = [];
  let orderNo = 0;
  let tabNo = 0;

  const sessionFor = (ms: number) => {
    let s = sessions.find((x) => ms >= x.openedAt && (x.closedAt === null || ms <= x.closedAt));
    if (!s) s = [...sessions].reverse().find((x) => x.openedAt <= ms) ?? sessions[0]!;
    return s!;
  };

  const pickGroup = (key: string): { id: string; name: string; delta: number }[] => {
    const os = options[key]!;
    switch (key) {
      case 'ponto':
        return [os[r.chance(0.65) ? 1 : r.chance(0.5) ? 0 : 2]!];
      case 'extras':
        return r.chance(0.3) ? [r.pick(os)] : [];
      case 'tamanho':
        return [os[r.chance(0.6) ? 1 : 0]!];
      case 'borda':
        return r.chance(0.22) ? [r.pick(os)] : [];
      case 'molhos':
        return r.chance(0.3) ? [r.pick(os)] : [];
      case 'acai':
        return [os[0]!, os[1]!, ...(r.chance(0.5) ? [os[3]!] : [])];
      default:
        return [os[r.chance(0.55) ? 0 : r.int(0, os.length - 1)]!];
    }
  };
  const optRecipe = new Map<string, [string, number]>();
  for (const g of C.OPTION_GROUPS)
    g.options.forEach(([, , item, q], i) => {
      if (item) optRecipe.set(options[g.key]![i]!.id, [item, q!]);
    });

  const available = products.filter((p) => !p.soldOut);
  const mains = available.filter((p) => ['combos', 'burgers', 'pizzas'].includes(p.category));
  const sides = available.filter((p) => ['porcoes', 'saladas'].includes(p.category));
  const drinks = available.filter((p) => p.category === 'bebidas');
  const sweets = available.filter((p) => p.category === 'sobremesas');

  const line = (p: P, qty = 1): Item => {
    const chosen = (p.groups ?? []).flatMap(pickGroup);
    const unit = p.cents + chosen.reduce((s, o) => s + o.delta, 0);
    const recipe: Record<string, number> = {};
    for (const [k, q] of Object.entries(p.recipe ?? {})) recipe[k] = (recipe[k] ?? 0) + q * qty;
    for (const o of chosen) {
      const rec = optRecipe.get(o.id);
      if (rec) recipe[rec[0]] = (recipe[rec[0]] ?? 0) + rec[1] * qty;
    }
    return {
      id: randomUUID(),
      productId: p.id,
      name: p.name,
      qty,
      unit,
      total: multiplyCents(unit, qty),
      notes: r.chance(0.08) ? r.pick(C.ITEM_NOTES) : null,
      sectorId: sectorId[p.sector]!,
      status: 'pending',
      startedAt: null,
      readyAt: null,
      options: chosen,
      recipe,
    };
  };
  const basket = (people: number): Item[] => {
    const items: Item[] = [];
    for (let i = 0; i < people; i++) items.push(line(r.weighted(mains)));
    if (r.chance(0.55)) items.push(line(r.weighted(sides)));
    const nDrinks = r.int(0, people);
    for (let i = 0; i < nDrinks; i++) items.push(line(r.weighted(drinks)));
    if (r.chance(0.18)) items.push(line(r.weighted(sweets)));
    // Itens iguais sem adicionais viram uma linha com quantidade.
    const merged: Item[] = [];
    for (const it of items) {
      const same = merged.find(
        (m) =>
          m.productId === it.productId &&
          !m.options.length &&
          !it.options.length &&
          !m.notes &&
          !it.notes,
      );
      if (same) {
        same.qty += 1;
        same.total = multiplyCents(same.unit, same.qty);
        for (const [k, q] of Object.entries(it.recipe)) same.recipe[k] = (same.recipe[k] ?? 0) + q;
      } else merged.push(it);
    }
    return merged;
  };

  /** Cria o pedido e as transições até `target`, com horários realistas a partir de `t0`. */
  const makeOrder = (spec: {
    t0: number;
    channel: Channel;
    target: Status;
    people?: number;
    online?: boolean;
    customer?: (typeof customers)[number];
    walkIn?: string;
    tabId?: string;
    createdBy?: string;
    cancelReason?: string;
    discountPct?: number;
    prepMin?: number;
    items?: Item[];
  }): Order => {
    const items = spec.items ?? basket(spec.people ?? 1);
    const online = !!spec.online;
    const cu = spec.customer;
    const isDelivery = spec.channel === 'delivery';
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const discount = spec.discountPct ? Math.round((subtotal * spec.discountPct) / 100) : 0;
    const createdBy = online
      ? null
      : (spec.createdBy ??
        (spec.channel === 'table'
          ? r.pick([U('waiter'), U('waiter2')])
          : r.pick([U('cashier'), U('attendant')])));
    const o: Order = {
      id: randomUUID(),
      number: ++orderNo,
      channel: spec.channel,
      status: online ? 'awaiting' : 'new',
      createdAt: spec.t0,
      updatedAt: spec.t0,
      tabId: spec.tabId ?? null,
      customerName: cu?.name ?? spec.walkIn ?? null,
      customerPhone: cu && (isDelivery || online) ? cu.phone : null,
      address: isDelivery && cu ? cu.address : null,
      lat: isDelivery && cu ? cu.lat : null,
      lng: isDelivery && cu ? cu.lng : null,
      notes:
        isDelivery && r.chance(0.15)
          ? r.pick([
              'Interfone quebrado, ligar ao chegar',
              'Deixar na portaria',
              'Troco na entrega',
            ])
          : null,
      subtotal,
      discount,
      deliveryFee: isDelivery && cu ? cu.fee : 0,
      paid: 0,
      createdBy,
      source: online ? 'online' : 'staff',
      paymentHint: online ? r.pick(['pix', 'credit', 'credit', 'debit', 'cash'] as const) : null,
      changeFor: null,
      acceptedAt: null,
      customerId: online && cu?.hasAccount ? cu.id : null,
      cancelReason: null,
      version: 1,
      items,
      history: [{ from: null, to: online ? 'awaiting' : 'new', actor: createdBy, at: spec.t0 }],
    };
    if (o.paymentHint === 'cash') o.changeFor = Math.ceil((total(o) + 1) / 5000) * 5000;
    let t = spec.t0;
    const go = (to: Status, actor: string | null, dt: number, reason?: string) => {
      t += dt;
      o.history.push({ from: o.status, to, actor, at: t, reason });
      o.status = to;
      o.version += 1;
      o.updatedAt = t;
    };
    const target = spec.target;
    if (target === 'awaiting') return o;
    if (online) {
      if (target === 'cancelled') {
        go(
          'cancelled',
          U('attendant'),
          r.int(1, 4) * MIN,
          spec.cancelReason ?? 'Endereço fora da área de entrega',
        );
        o.cancelReason = spec.cancelReason ?? 'Endereço fora da área de entrega';
        o.items.forEach((i) => (i.status = 'cancelled'));
        return o;
      }
      go('new', U('attendant'), r.int(1, 3) * MIN);
      o.acceptedAt = t;
    }
    stockEvents.push({ at: t, kind: 'sale', orderId: o.id, need: mergeNeeds(items) });
    if (target === 'new') return o;
    if (target === 'cancelled' || target === 'cancel_requested') {
      const reason = spec.cancelReason ?? 'Cliente desistiu do pedido';
      if (target === 'cancel_requested') {
        go('cancel_requested', U('attendant'), r.int(2, 5) * MIN, reason);
        o.cancelReason = reason;
        return o;
      }
      go('cancelled', U('manager'), r.int(2, 6) * MIN, reason);
      o.cancelReason = reason;
      o.items.forEach((i) => (i.status = 'cancelled'));
      stockEvents.push({ at: t, kind: 'sale_reversal', orderId: o.id, need: mergeNeeds(items) });
      return o;
    }
    go('in_production', U('kitchen'), r.int(1, 3) * MIN);
    const prep = (spec.prepMin ?? r.int(12, 24)) * MIN;
    for (const it of o.items) {
      it.startedAt = t;
      it.status = 'preparing';
    }
    if (target === 'in_production') {
      // Bebidas já saíram; o resto ainda na chapa/forno.
      for (const it of o.items)
        if (it.sectorId === sectorId.bar) {
          it.status = 'ready';
          it.readyAt = t + 2 * MIN;
        }
      return o;
    }
    go('ready', U('kitchen'), prep);
    for (const it of o.items) {
      it.status = 'ready';
      it.readyAt = it.sectorId === sectorId.bar ? (it.startedAt ?? t) + r.int(2, 5) * MIN : t;
    }
    if (target === 'ready') return o;
    if (spec.channel === 'delivery') {
      go('dispatched', U('attendant'), r.int(2, 8) * MIN);
      if (target === 'dispatched') return o;
      go('completed', r.pick([U('driver'), U('driver2')]), r.int(10, 25) * MIN);
    } else {
      go('completed', U('cashier'), r.int(3, 12) * MIN);
    }
    return o;
  };

  function mergeNeeds(items: Item[]) {
    const need: Record<string, number> = {};
    for (const it of items)
      if (it.status !== 'cancelled')
        for (const [k, q] of Object.entries(it.recipe)) need[k] = (need[k] ?? 0) + q;
    return need;
  }

  const pay = (o: Order, at: number, method: Method, amount: number, by: string) => {
    const s = sessionFor(at);
    const id = randomUUID();
    const tendered = method === 'cash' ? Math.max(amount, Math.ceil(amount / 1000) * 1000) : null;
    payments.push([
      id,
      T,
      o.id,
      s.id,
      method,
      fromCents(amount),
      tendered === null ? null : fromCents(tendered),
      by,
      iso(at),
    ]);
    movements.push([T, s.id, 'sale', method, fromCents(amount), id, o.id, null, by, iso(at)]);
    o.paid += amount;
    o.version += 1;
  };
  const methodFor = (o: Order): Method => {
    if (o.paymentHint) return o.paymentHint === 'voucher' ? 'credit' : o.paymentHint;
    const x = r.next();
    return x < 0.34
      ? 'credit'
      : x < 0.58
        ? 'debit'
        : x < 0.88
          ? 'pix'
          : x < 0.97
            ? 'cash'
            : 'voucher';
  };
  const finishPayment = (o: Order, at: number, by: string) => {
    const due = total(o) - o.paid;
    if (due <= 0) return;
    if (o.channel === 'table' && r.chance(0.25) && due > 4000) {
      const half = Math.round(due / 2);
      pay(o, at, methodFor(o), half, by);
      pay(o, at + MIN, methodFor(o), due - half, by);
    } else pay(o, at, methodFor(o), due, by);
  };
  const deliver = (o: Order, courier: string, status: 'out' | 'delivered') => {
    const out = o.history.find((h) => h.to === 'dispatched')!.at;
    const done = o.history.find((h) => h.to === 'completed')?.at ?? null;
    const lat = status === 'out' ? (store.lat + o.lat!) / 2 : o.lat;
    const lng = status === 'out' ? (store.lng + o.lng!) / 2 : o.lng;
    deliveries.push([
      T,
      o.id,
      courierId[courier],
      status,
      sha(randomBytes(24).toString('base64url')),
      iso(status === 'out' ? now + 4 * HOUR : done! + 30 * MIN),
      iso(out),
      done ? iso(done) : null,
      lat,
      lng,
      iso(status === 'out' ? now - MIN : done!),
      U('attendant'),
    ]);
  };
  const courierFor = () => r.pick(['lucas', 'lucas', 'bruna', 'bruna', 'marcos']);

  const BUSY = [34, 0, 22, 24, 28, 40, 46]; // domingo a sábado (segunda fechado)
  const randomCustomer = () => r.pick(customers);

  /** Um dia de movimento (histórico ou hoje até `until`). */
  const simulateDay = (daysAgo: number, until: number | null) => {
    const weekday = new Date(localMidnight(daysAgo) - TZ_OFFSET + 12 * HOUR).getUTCDay();
    const base = BUSY[weekday]!;
    const opened = daysAgo === 0 ? Math.min(at(0, 10, 30), now - 4 * HOUR) : at(daysAgo, 10, 30);
    if (!base && daysAgo !== 0) return; // segunda: fechado
    const session = {
      id: randomUUID(),
      number: sessions.length + 1,
      openedAt: opened,
      closedAt: daysAgo === 0 ? null : at(daysAgo, 23, 50),
      day: daysAgo,
    };
    sessions.push(session);
    movements.push([
      T,
      session.id,
      'opening',
      'cash',
      '200.00',
      null,
      null,
      'Troco inicial',
      U('cashier'),
      iso(opened),
    ]);
    const n = daysAgo === 0 ? Math.round((base || 24) * 0.6) : base + r.int(-3, 4);
    for (let i = 0; i < n; i++) {
      const lunch = r.chance(0.4);
      const t0 = lunch
        ? at(daysAgo, 11, 30) + r.next() * 3 * HOUR
        : at(daysAgo, 18, 30) + r.next() * 4.4 * HOUR;
      if (until !== null && t0 > until) continue;
      const x = r.next();
      const channel: Channel =
        x < 0.36 ? 'table' : x < 0.5 ? 'counter' : x < 0.86 ? 'delivery' : 'pickup';
      const cancel = r.chance(0.035);
      if (channel === 'table') {
        tabNo += 1;
        const tabId = randomUUID();
        const label = r.pick(C.TABLES).label;
        const people = r.int(1, 4);
        const waiter = r.pick([U('waiter'), U('waiter2')]);
        const first = makeOrder({
          t0,
          channel,
          target: 'completed',
          people,
          tabId,
          createdBy: waiter,
        });
        const tabOrders = [first];
        if (r.chance(0.35))
          tabOrders.push(
            makeOrder({
              t0: t0 + r.int(25, 45) * MIN,
              channel,
              target: 'completed',
              people: 1,
              tabId,
              createdBy: waiter,
            }),
          );
        const close = Math.max(...tabOrders.map((o) => o.updatedAt)) + r.int(10, 35) * MIN;
        for (const o of tabOrders) {
          const h = o.history[o.history.length - 1]!;
          h.at = close;
          h.reason = 'Conta fechada';
          o.updatedAt = close;
        }
        if (r.chance(0.08)) tabOrders.forEach((o) => (o.discount = Math.round(o.subtotal * 0.1)));
        tabOrders.forEach((o) => finishPayment(o, close, U('cashier')));
        tabs.push([
          tabId,
          T,
          tabNo,
          tableId[label],
          null,
          'closed',
          waiter,
          iso(t0),
          U('cashier'),
          iso(close),
          r.chance(0.6) ? iso(close - 6 * MIN) : null,
          null,
        ]);
        orders.push(...tabOrders);
        continue;
      }
      const online = (channel === 'delivery' || channel === 'pickup') && r.chance(0.62);
      const cu = channel === 'delivery' || online ? randomCustomer() : undefined;
      const o = makeOrder({
        t0,
        channel,
        target: cancel ? 'cancelled' : 'completed',
        people: r.chance(0.3) ? 2 : 1,
        online,
        customer: cu,
        walkIn: cu ? undefined : r.pick(C.WALK_IN),
        cancelReason: cancel
          ? online
            ? r.pick(['Endereço fora da área de entrega', 'Item esgotado na hora'])
            : 'Cliente desistiu do pedido'
          : undefined,
        discountPct: !online && r.chance(0.05) ? 10 : 0,
      });
      if (o.status === 'completed') {
        if (channel === 'delivery') deliver(o, courierFor(), 'delivered');
        const payAt = channel === 'counter' ? o.createdAt + MIN : o.updatedAt;
        finishPayment(o, payAt, U('cashier'));
      }
      orders.push(o);
    }
    if (daysAgo !== 0) {
      // Sangria no fim da noite quando há muito dinheiro na gaveta.
      movements.push([
        T,
        session.id,
        'withdrawal',
        'cash',
        '-300.00',
        null,
        null,
        'Sangria para o cofre',
        U('manager'),
        iso(at(daysAgo, 21, 0)),
      ]);
    }
  };

  for (let d = days; d >= 1; d--) simulateDay(d, null);
  simulateDay(0, now - 45 * MIN);

  // ------------------------------------------------------------------ agora (tela ao vivo)
  const ago = (m: number) => now - m * MIN;
  const cust = (name: string) => customers.find((cu) => cu.name === name)!;
  const live: Order[] = [];
  const liveTab = (
    label: string | null,
    name: string | null,
    openedMin: number,
    waiter: string,
    billMin: number | null,
  ) => {
    tabNo += 1;
    const id = randomUUID();
    tabs.push([
      id,
      T,
      tabNo,
      label ? tableId[label] : null,
      name,
      'open',
      waiter,
      iso(ago(openedMin)),
      null,
      null,
      billMin === null ? null : iso(ago(billMin)),
      billMin === null ? null : waiter,
    ]);
    return id;
  };
  live.push(
    makeOrder({
      t0: ago(2),
      channel: 'delivery',
      target: 'awaiting',
      online: true,
      customer: cust('Mariana Oliveira'),
      people: 2,
    }),
  );
  live.push(
    makeOrder({
      t0: ago(1),
      channel: 'pickup',
      target: 'awaiting',
      online: true,
      customer: cust('Rafael Santos'),
    }),
  );
  const counterNew = makeOrder({ t0: ago(1), channel: 'counter', target: 'new', walkIn: 'João' });
  pay(counterNew, ago(1), 'debit', total(counterNew), U('cashier'));
  live.push(counterNew);
  const t5 = liveTab('5', null, 4, U('waiter'), null);
  live.push(
    makeOrder({
      t0: ago(3),
      channel: 'table',
      target: 'new',
      people: 3,
      tabId: t5,
      createdBy: U('waiter'),
    }),
  );
  live.push(
    makeOrder({
      t0: ago(9),
      channel: 'delivery',
      target: 'in_production',
      customer: cust('Camila Rodrigues'),
      people: 2,
      createdBy: U('attendant'),
      prepMin: 15,
    }),
  );
  const t3 = liveTab('3', null, 40, U('waiter2'), null);
  const t3a = makeOrder({
    t0: ago(38),
    channel: 'table',
    target: 'ready',
    people: 2,
    tabId: t3,
    createdBy: U('waiter2'),
    prepMin: 16,
  });
  live.push(t3a);
  live.push(
    makeOrder({
      t0: ago(12),
      channel: 'table',
      target: 'in_production',
      people: 1,
      tabId: t3,
      createdBy: U('waiter2'),
    }),
  );
  live.push(
    makeOrder({
      t0: ago(11),
      channel: 'pickup',
      target: 'in_production',
      online: true,
      customer: cust('Gustavo Pereira'),
    }),
  );
  const readyDelivery = makeOrder({
    t0: ago(22),
    channel: 'delivery',
    target: 'ready',
    online: true,
    customer: cust('Beatriz Lima'),
    prepMin: 14,
  });
  live.push(readyDelivery);
  const counterReady = makeOrder({
    t0: ago(16),
    channel: 'counter',
    target: 'ready',
    walkIn: 'Lívia',
    prepMin: 10,
  });
  pay(counterReady, ago(16), 'pix', total(counterReady), U('cashier'));
  live.push(counterReady);
  const out1 = makeOrder({
    t0: ago(38),
    channel: 'delivery',
    target: 'dispatched',
    customer: cust('Thiago Almeida'),
    createdBy: U('attendant'),
    prepMin: 15,
  });
  deliver(out1, 'lucas', 'out');
  live.push(out1);
  const out2 = makeOrder({
    t0: ago(33),
    channel: 'delivery',
    target: 'dispatched',
    online: true,
    customer: cust('Felipe Costa'),
    prepMin: 14,
  });
  deliver(out2, 'marcos', 'out');
  live.push(out2);
  live.push(
    makeOrder({
      t0: ago(16),
      channel: 'delivery',
      target: 'cancel_requested',
      online: true,
      customer: cust('Larissa Carvalho'),
      cancelReason: 'Cliente ligou pedindo para cancelar',
    }),
  );
  const t1 = liveTab('1', null, 70, U('waiter'), 2);
  live.push(
    makeOrder({
      t0: ago(66),
      channel: 'table',
      target: 'ready',
      people: 2,
      tabId: t1,
      createdBy: U('waiter'),
      prepMin: 18,
    }),
  );
  live.push(
    makeOrder({
      t0: ago(40),
      channel: 'table',
      target: 'ready',
      people: 1,
      tabId: t1,
      createdBy: U('waiter'),
    }),
  );
  const t8 = liveTab('8', null, 30, U('waiter2'), null);
  live.push(
    makeOrder({
      t0: ago(28),
      channel: 'table',
      target: 'ready',
      people: 4,
      tabId: t8,
      createdBy: U('waiter2'),
      prepMin: 17,
    }),
  );
  const avulsa = liveTab(null, 'Henrique (balcão)', 25, U('waiter'), null);
  live.push(
    makeOrder({
      t0: ago(24),
      channel: 'table',
      target: 'ready',
      people: 1,
      tabId: avulsa,
      createdBy: U('waiter'),
    }),
  );
  orders.push(...live);

  // ------------------------------------------------------------------ estoque (cronológico)
  const qty: Record<string, number> = Object.fromEntries(
    Object.keys(C.STOCK_ITEMS).map((k) => [k, 0]),
  );
  const avg: Record<string, number> = { ...stockCost };
  const stockRows: unknown[][] = [];
  const buy = (k: string, q: number, ms: number, note: string) => {
    if (q <= 0) return;
    const cost = Math.round(stockCost[k]! * (0.95 + r.next() * 0.1));
    avg[k] = Math.round((avg[k]! * Math.max(qty[k]!, 0) + cost * q) / (Math.max(qty[k]!, 0) + q));
    qty[k] = round3(qty[k]! + q);
    stockRows.push([
      T,
      stockId[k],
      'purchase',
      q,
      fromCents(cost),
      qty[k],
      null,
      note,
      U('stock'),
      iso(ms),
    ]);
  };
  const purchaseDays = [
    days + 1,
    ...Array.from({ length: days }, (_, i) => days - i).filter((d) => d % 4 === 2),
  ];
  const events: { at: number; run: () => void }[] = [];
  for (const d of purchaseDays) {
    events.push({
      at: at(d, 9, 15),
      run: () => {
        for (const [k, [, unit, , , target]] of Object.entries(C.STOCK_ITEMS)) {
          if (d < 4 && C.LOW_STOCK.includes(k)) continue; // última compra atrasada: alerta de estoque baixo
          const want = target - qty[k]!;
          buy(
            k,
            unit === 'un' ? Math.ceil(want) : round3(want),
            at(d, 9, 15),
            'Compra do fornecedor',
          );
        }
      },
    });
  }
  for (const e of stockEvents) {
    events.push({
      at: e.at,
      run: () => {
        for (const [k, q] of Object.entries(e.need)) {
          const amount = round3(q);
          if (amount <= 0) continue;
          if (e.kind === 'sale' && qty[k]! < amount)
            buy(
              k,
              round3(Math.max(amount * 4, C.STOCK_ITEMS[k]![4] / 4)),
              e.at - 5 * MIN,
              'Compra emergencial no atacarejo',
            );
          qty[k] = round3(qty[k]! + (e.kind === 'sale' ? -amount : amount));
          stockRows.push([
            T,
            stockId[k],
            e.kind,
            e.kind === 'sale' ? -amount : amount,
            null,
            qty[k],
            e.orderId,
            e.kind === 'sale_reversal' ? 'Pedido cancelado' : null,
            null,
            iso(e.at),
          ]);
        }
      },
    });
  }
  // Perdas e um inventário para a tela de movimentos ficar completa.
  const losses: [string, number, number, string][] = [
    ['tomate', 1.2, 18, 'Tomates passados'],
    ['alface', 0.8, 11, 'Validade vencida'],
    ['sorvete', 1, 6, 'Freezer desligou à noite'],
  ];
  for (const [k, q, d, note] of losses)
    events.push({
      at: at(d, 16, 0),
      run: () => {
        const amount = Math.min(q, qty[k]!);
        if (amount <= 0) return;
        qty[k] = round3(qty[k]! - amount);
        stockRows.push([
          T,
          stockId[k],
          'loss',
          -amount,
          null,
          qty[k],
          null,
          note,
          U('stock'),
          iso(at(d, 16, 0)),
        ]);
      },
    });
  events.push({
    at: at(9, 16, 30),
    run: () => {
      for (const k of ['oleo', 'cebola']) {
        const delta = k === 'oleo' ? -1.5 : 0.6;
        if (qty[k]! + delta < 0) continue;
        qty[k] = round3(qty[k]! + delta);
        stockRows.push([
          T,
          stockId[k],
          'adjustment',
          delta,
          null,
          qty[k],
          null,
          'Inventário semanal',
          U('stock'),
          iso(at(9, 16, 30)),
        ]);
      }
    },
  });
  events.sort((a, b) => a.at - b.at).forEach((e) => e.run());
  // Contagem desta manhã achou menos que o sistema: estes insumos ficam abaixo do mínimo.
  for (const k of C.LOW_STOCK) {
    const target = round3(C.STOCK_ITEMS[k]![2] * 0.5);
    const delta = round3(target - qty[k]!);
    if (delta >= 0) continue;
    qty[k] = target;
    stockRows.push([
      T,
      stockId[k],
      'adjustment',
      delta,
      null,
      target,
      null,
      'Contagem do inventário',
      U('stock'),
      iso(now - 5 * MIN),
    ]);
  }

  // ------------------------------------------------------------------ gravação
  await bulk(
    c,
    'cash_sessions',
    [
      'id',
      'tenant_id',
      'register_id',
      'number',
      'status',
      'opening_amount',
      'opened_by',
      'opened_at',
      'closed_at',
    ],
    sessions.map((s) => [
      s.id,
      T,
      registerId,
      s.number,
      s.closedAt === null ? 'open' : 'closed',
      '200.00',
      U('cashier'),
      iso(s.openedAt),
      s.closedAt === null ? null : iso(s.closedAt),
    ]),
  );
  await bulk(
    c,
    'tabs',
    [
      'id',
      'tenant_id',
      'number',
      'table_id',
      'customer_name',
      'status',
      'opened_by',
      'opened_at',
      'closed_by',
      'closed_at',
      'bill_requested_at',
      'bill_requested_by',
    ],
    tabs,
  );
  orders.sort((a, b) => a.createdAt - b.createdAt);
  // Números em ordem de criação (o histórico e o "agora" foram montados em momentos diferentes).
  orders.forEach((o, i) => (o.number = i + 1));
  await bulk(
    c,
    'orders',
    [
      'id',
      'tenant_id',
      'number',
      'channel',
      'status',
      'tab_id',
      'customer_name',
      'customer_phone',
      'delivery_address',
      'delivery_lat',
      'delivery_lng',
      'notes',
      'subtotal',
      'discount',
      'surcharge',
      'delivery_fee',
      'total',
      'paid_amount',
      'payment_status',
      'created_by',
      'source',
      'public_token_hash',
      'payment_hint',
      'change_for',
      'accepted_at',
      'customer_id',
      'cancel_reason',
      'version',
      'created_at',
      'updated_at',
    ],
    orders.map((o) => [
      o.id,
      T,
      o.number,
      o.channel,
      o.status,
      o.tabId,
      o.customerName,
      o.customerPhone,
      o.address,
      o.lat,
      o.lng,
      o.notes,
      fromCents(o.subtotal),
      fromCents(o.discount),
      '0',
      fromCents(o.deliveryFee),
      fromCents(total(o)),
      fromCents(o.paid),
      paymentStatusFor(total(o), o.paid),
      o.createdBy ?? null,
      o.source,
      o.source === 'online' ? sha(randomBytes(24).toString('base64url')) : null,
      o.paymentHint,
      o.changeFor === null ? null : fromCents(o.changeFor),
      o.acceptedAt === null ? null : iso(o.acceptedAt),
      o.customerId,
      o.cancelReason,
      o.version,
      iso(o.createdAt),
      iso(o.updatedAt),
    ]),
  );
  const items = orders.flatMap((o) => o.items.map((it, i) => ({ o, it, i })));
  await bulk(
    c,
    'order_items',
    [
      'id',
      'tenant_id',
      'order_id',
      'product_id',
      'name',
      'quantity',
      'unit_price',
      'total',
      'notes',
      'sector_id',
      'status',
      'started_at',
      'ready_at',
      'created_at',
    ],
    items.map(({ o, it, i }) => [
      it.id,
      T,
      o.id,
      it.productId,
      it.name,
      it.qty,
      fromCents(it.unit),
      fromCents(it.total),
      it.notes,
      it.sectorId,
      it.status,
      it.startedAt === null ? null : iso(it.startedAt),
      it.readyAt === null ? null : iso(it.readyAt),
      iso(o.createdAt + i),
    ]),
  );
  await bulk(
    c,
    'order_item_options',
    ['tenant_id', 'order_item_id', 'option_id', 'name', 'price_delta'],
    items.flatMap(({ it }) =>
      it.options.map((op) => [T, it.id, op.id, op.name, fromCents(op.delta)]),
    ),
  );
  await bulk(
    c,
    'order_status_history',
    ['tenant_id', 'order_id', 'from_status', 'to_status', 'actor_id', 'reason', 'created_at'],
    orders.flatMap((o) =>
      o.history.map((h) => [T, o.id, h.from, h.to, h.actor, h.reason ?? null, iso(h.at)]),
    ),
  );
  await bulk(
    c,
    'payments',
    [
      'id',
      'tenant_id',
      'order_id',
      'cash_session_id',
      'method',
      'amount',
      'tendered',
      'created_by',
      'created_at',
    ],
    payments,
  );
  await bulk(
    c,
    'cash_movements',
    [
      'tenant_id',
      'cash_session_id',
      'kind',
      'method',
      'amount',
      'payment_id',
      'order_id',
      'note',
      'created_by',
      'created_at',
    ],
    movements,
  );
  await bulk(
    c,
    'deliveries',
    [
      'tenant_id',
      'order_id',
      'courier_id',
      'status',
      'tracking_hash',
      'tracking_expires_at',
      'dispatched_at',
      'finished_at',
      'last_lat',
      'last_lng',
      'last_location_at',
      'created_by',
    ],
    deliveries,
  );
  await bulk(
    c,
    'stock_movements',
    [
      'tenant_id',
      'stock_item_id',
      'kind',
      'quantity',
      'unit_cost',
      'balance_after',
      'order_id',
      'note',
      'created_by',
      'created_at',
    ],
    stockRows,
  );
  for (const k of Object.keys(qty))
    await c.query(`UPDATE stock_items SET quantity = $2, avg_cost = $3 WHERE id = $1`, [
      stockId[k],
      qty[k],
      fromCents(avg[k]!),
    ]);

  // Fechamento dos caixas dos dias anteriores: esperado = soma do livro-razão.
  const notes = [
    'Faltaram R$ 2,50 de troco',
    'Sobrou R$ 1,00 (troco de cliente)',
    'Moeda de R$ 0,50 caiu atrás da gaveta',
  ];
  const diffs = [-250, 100, -50];
  let diffIdx = 0;
  for (const s of sessions.filter((x) => x.closedAt !== null)) {
    const { rows } = await c.query<{ method: string; total: string }>(
      `SELECT method, sum(amount)::text AS total FROM cash_movements WHERE cash_session_id = $1 GROUP BY method`,
      [s.id],
    );
    const expected: Record<string, string> = {
      cash: '0.00',
      credit: '0.00',
      debit: '0.00',
      pix: '0.00',
      voucher: '0.00',
      other: '0.00',
    };
    for (const row of rows) expected[row.method] = fromCents(toCents(row.total));
    const counted = { ...expected };
    let diff = 0;
    let note: string | null = null;
    if ([4, 11, 19].includes(s.day) && diffIdx < diffs.length) {
      diff = diffs[diffIdx]!;
      note = notes[diffIdx]!;
      diffIdx++;
      counted.cash = fromCents(toCents(expected.cash!) + diff);
    }
    await c.query(
      `UPDATE cash_sessions SET status = 'closed', closed_by = $2, closed_at = $3, expected = $4, counted = $5,
              difference = $6, closing_note = $7 WHERE id = $1`,
      [
        s.id,
        U('cashier'),
        iso(s.closedAt!),
        JSON.stringify(expected),
        JSON.stringify(counted),
        fromCents(diff),
        note,
      ],
    );
  }

  // ------------------------------------------------------------------ financeiro
  const finance: unknown[][] = [];
  const addEntry = (
    kind: 'payable' | 'receivable',
    description: string,
    category: string,
    counterparty: string,
    amount: number,
    due: number,
    paidMethod: string,
  ) => {
    const paid = due < now - 2 * DAY || (due < now && r.chance(0.6));
    finance.push([
      T,
      kind,
      description.slice(0, 200),
      category,
      counterparty,
      fromCents(amount),
      localDate(due),
      paid ? 'paid' : 'open',
      paid ? localDate(Math.min(due, now)) : null,
      paid ? paidMethod : null,
      paid ? U('finance') : null,
      U('finance'),
      iso(due - 20 * DAY),
    ]);
  };
  for (const back of [1, 0, -1]) {
    const ref = new Date(now - TZ_OFFSET);
    for (const [desc, cat, who, amount, dueDay] of C.MONTHLY_BILLS) {
      const due = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - back, dueDay, 12) + TZ_OFFSET;
      const month = new Date(due - TZ_OFFSET).toLocaleDateString('pt-BR', {
        month: 'long',
        timeZone: 'UTC',
      });
      const value = toCents(amount) + (cat === 'Contas de consumo' ? r.int(-8000, 8000) : 0);
      addEntry(
        'payable',
        `${desc} (${month})`,
        cat,
        who,
        Math.max(value, 1000),
        due,
        cat === 'Pessoal' ? 'transfer' : 'boleto',
      );
    }
  }
  for (let d = days; d >= -10; d -= 7)
    for (const [desc, cat, who] of C.SUPPLIERS)
      addEntry(
        'payable',
        desc,
        cat,
        who,
        r.int(80000, 420000),
        localMidnight(d) + 12 * HOUR,
        r.pick(['pix', 'boleto', 'transfer']),
      );
  for (let d = days; d >= -7; d -= 7)
    addEntry(
      'receivable',
      'Repasse das vendas no cartão',
      'Vendas',
      'Operadora de cartões',
      r.int(900000, 1800000),
      localMidnight(d) + 12 * HOUR,
      'transfer',
    );
  addEntry(
    'receivable',
    'Evento corporativo (50 pessoas)',
    'Eventos',
    'Agência Pinheiros Digital',
    375000,
    localMidnight(-6) + 12 * HOUR,
    'pix',
  );
  addEntry(
    'receivable',
    'Aniversário no mezanino (sinal)',
    'Eventos',
    'Cliente particular',
    80000,
    localMidnight(12) + 12 * HOUR,
    'pix',
  );
  await bulk(
    c,
    'finance_entries',
    [
      'tenant_id',
      'kind',
      'description',
      'category',
      'counterparty',
      'amount',
      'due_date',
      'status',
      'paid_at',
      'paid_method',
      'settled_by',
      'created_by',
      'created_at',
    ],
    finance,
  );
  await c.query(
    `INSERT INTO finance_entries (tenant_id, kind, description, category, counterparty, amount, due_date, status, cancel_reason, created_by)
     VALUES ($1, 'payable', 'Manutenção da coifa (orçamento recusado)', 'Manutenção', 'Refrigeração Polar', '1450.00', $2, 'cancelled', 'Orçamento mais barato com outro fornecedor', $3)`,
    [T, localDate(now - 9 * DAY), U('finance')],
  );
  // Conferência dos recebimentos dos últimos dias (cartão e Pix).
  for (const d of [1, 2, 3, 5]) {
    for (const method of ['credit', 'debit', 'pix'] as const) {
      const { rows } = await c.query<{ total: string | null }>(
        `SELECT sum(p.amount)::text AS total FROM payments p
          WHERE p.method = $1 AND p.created_at >= $2 AND p.created_at < $3`,
        [method, iso(localMidnight(d)), iso(localMidnight(d - 1))],
      );
      const system = toCents(rows[0]?.total ?? '0');
      if (!system) continue;
      const diff = d === 3 && method === 'credit' ? -1290 : 0;
      await c.query(
        `INSERT INTO finance_reconciliations (tenant_id, day, method, system_amount, informed_amount, difference, note, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          T,
          localDate(localMidnight(d) + 12 * HOUR),
          method,
          fromCents(system),
          fromCents(system + diff),
          fromCents(diff),
          diff ? 'Venda estornada pela operadora (chargeback)' : null,
          U('finance'),
          iso(localMidnight(d - 1) + 10 * HOUR),
        ],
      );
    }
  }

  // ------------------------------------------------------------------ nota fiscal (homologação)
  const fiscalCandidates = orders
    .filter((o) => o.status === 'completed' && o.paid > 0 && o.createdAt > now - 3 * DAY)
    .slice(-8);
  let nfNumber = 1200;
  for (const [i, o] of fiscalCandidates.entries()) {
    nfNumber += 1;
    const authorized = i !== 2;
    const key =
      `35${localDate(o.createdAt).slice(2, 4)}${localDate(o.createdAt).slice(5, 7)}12345678000195650010000${nfNumber}1${String(10000000 + i).slice(0, 8)}`
        .slice(0, 44)
        .padEnd(44, '0');
    await c.query(
      `INSERT INTO fiscal_documents (tenant_id, order_id, ref, environment, status, attempts, total, request_payload,
          provider_status, sefaz_status, sefaz_message, access_key, number, series, last_error, created_by, created_at,
          updated_at, authorized_at)
       VALUES ($1,$2,$3,'homologacao',$4,1,$5,$6,$7,$8,$9,$10,$11,'1',$12,$13,$14,$14,$15)`,
      [
        T,
        o.id,
        `demo-${o.number}-${randomBytes(4).toString('hex')}`,
        authorized ? 'authorized' : 'rejected',
        fromCents(total(o)),
        JSON.stringify({ pedido: o.number, ambiente: 'homologacao' }),
        authorized ? 'autorizado' : 'erro_autorizacao',
        authorized ? '100' : '778',
        authorized
          ? 'Autorizado o uso da NF-e'
          : 'Rejeição: Informado NCM inexistente (ambiente de homologação)',
        authorized ? key : null,
        authorized ? String(nfNumber) : null,
        authorized ? null : 'NCM inválido em um dos itens',
        U('fiscal'),
        iso(o.updatedAt + 2 * MIN),
        authorized ? iso(o.updatedAt + 2 * MIN) : null,
      ],
    );
  }

  // ------------------------------------------------------------------ impressão e WhatsApp
  await c.query(
    `INSERT INTO print_jobs (tenant_id, dedupe_key, kind, target, payload, status, attempts, claimed_by, claimed_at, done_at, created_by, created_at)
     VALUES ($1, $2, 'test', 'Cozinha', $3, 'done', 1, $4, $5, $5, $6, $5)`,
    [
      T,
      `test:${randomUUID()}`,
      'TESTE DE IMPRESSAO\nCasa Brasa\nDestino: Cozinha',
      agentId,
      iso(now - 26 * HOUR),
      U('manager'),
    ],
  );

  // ------------------------------------------------------------------ contadores e marcação
  await bulk(
    c,
    'tenant_counters',
    ['tenant_id', 'name', 'value'],
    [
      [T, 'order', orders.length],
      [T, 'tab', tabNo],
      [T, 'cash_session', sessions.length],
    ],
  );
  await c.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity, entity_id, data)
     VALUES ($1, $2, $3, 'tenant', $5, $4)`,
    [T, U('owner'), DEMO_MARKER, JSON.stringify({ orders: orders.length, seededAt: iso(now) }), T],
  );
  log(
    `restaurante de demonstração: ${orders.length} pedidos, ${payments.length} pagamentos, ${stockRows.length} movimentos de estoque`,
  );
  return {
    orders: orders.length,
    users: C.USERS.map((u) => `${u.email}@${opts.emailDomain}`),
    courierLink: courierToken,
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
