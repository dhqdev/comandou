import { randomUUID } from 'node:crypto';
import type { ClientBase } from 'pg';
import { fromCents, type CourierPayRule } from '@comandou/shared';
import type { DemoUser } from './types';

/**
 * O que uma demonstração tem além do básico de seed.ts: marca da loja, famílias, cardápio do
 * delivery, chat da equipe e mural, fidelidade, reservas, notas de entrada e produção no estoque,
 * regras fiscais, precificação, rastreio do motoboy, assistente e roupinhas do panda.
 * Só os textos ficam aqui no formato; o conteúdo vem do catálogo (fumaca.ts).
 */
export interface DemoExtras {
  branding: {
    brandColor: string;
    accentColor: string;
    fontStyle: 'padrao' | 'sistema' | 'classica' | 'arredondada';
    cornerStyle: 'padrao' | 'reto' | 'arredondado';
    city: string;
    state: string;
  };
  /** Famílias de itens: [nome, categorias]. */
  families: [string, string[]][];
  /** Precificação: imposto, taxas, custo fixo e margem desejada (%). */
  pricing: { tax: number; fee: number; fixed: number; margin: number };
  /** Cardápio próprio do delivery: produtos fora dele e acréscimo nos preços (%). */
  deliveryMenu: { name: string; exclude: string[]; markupPercent: number };
  chat: {
    /** Conversas em grupo ou canal; mensagens: [autor, minutos atrás, texto, reações?]. */
    rooms: {
      kind: 'group' | 'channel';
      name: string;
      description: string;
      members: string[] | 'all';
      admin: string;
      messages: [string, number, string, Record<string, string[]>?][];
    }[];
    directs: { a: string; b: string; messages: [string, number, string][] }[];
    /** Mural: [autor, horas atrás, texto, fixado, foto?, comentários: [autor, minutos depois, texto]]. */
    posts: [string, number, string, boolean, (string | null)?, [string, number, string][]?][];
    /** Avisos de menção: [para, de, sala, texto]. */
    mentions: [string, string, string, string][];
  };
  loyalty: {
    pointsPerReal: number;
    expiryDays: number;
    /** [nome, pontos, desconto em R$ | chave do produto]. */
    rewards: [string, number, string][];
  };
  reservations: {
    weekdays: number[];
    opensAt: string;
    closesAt: string;
    maxParty: number;
    note: string;
    /** [nome, telefone, pessoas, daqui a quantos dias, hora, minuto, situação, ocasião, observação, mesa]. */
    list: [
      string,
      string,
      number,
      number,
      number,
      number,
      'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show',
      string | null,
      string | null,
      string | null,
    ][];
  };
  stock: {
    /** Fornecedor de cada categoria de insumo (notas de entrada). */
    suppliers: Record<string, string>;
    /** Insumos produzidos na casa: ficha (ingrediente → quantidade) e rendimento. */
    recipes: Record<string, { yields: number; ingredients: Record<string, number> }>;
    /** Produções de hoje cedo: [insumo, quantidade, observação]. */
    productions: [string, number, string][];
  };
  fiscal: {
    /** [código, nome, CFOP, CST/CSOSN do ICMS, padrão?, NCMs]. */
    rules: [string, string, string, string, boolean, string[]][];
  };
  couriers: Record<string, { pix: string; regime: 'mei' | 'autonomo' | 'clt' }>;
  courierPay: CourierPayRule;
  ai: { monthlyTokens: number; conversation: [string, ['user' | 'assistant', string][]] };
  /** Prefixo do código das reservas (padrão AUR). */
  reservationPrefix?: string;
  /** Fotos a mais de cada item (galeria do cardápio): chave do produto → fotos. */
  gallery?: Record<string, string[]>;
  /** Avaliações dos itens pelos clientes com conta: comentários por categoria do cardápio. */
  reviews?: { perProduct: [number, number]; comments: Record<string, string[]>; low: string[] };
  /** Conversas da loja (chat do cardápio): [cliente, mensagens [quem, minutos atrás, texto]]. */
  storeChats?: [string, ['customer' | 'staff', number, string][]][];
  /** WhatsApp: avisos ligados (Baileys), textos da casa, atendente IA e conversas dela. */
  whatsapp?: {
    texts: Partial<Record<'accepted' | 'ready' | 'dispatched' | 'delivered' | 'cancelled', string>>;
    agent: {
      name: string;
      tone: 'friendly' | 'formal' | 'fun';
      greeting: string;
      about: string;
      rules: string;
      handoff: string;
    };
    /** Conversas da IA no WhatsApp: [cliente (nome da lista), horas atrás, [papel, texto][]]. */
    chats: [string, number, ['user' | 'assistant', string][]][];
  };
  /** Taxa de serviço sugerida nas comandas (%). */
  serviceFeePercent?: number;
  /** Dia em que começa o mês do financeiro. */
  financeMonthStart?: number;
}

export interface ExtrasContext {
  T: string;
  now: number;
  days: number;
  rand: {
    next: () => number;
    int: (lo: number, hi: number) => number;
    chance: (p: number) => boolean;
  };
  U: (key: string) => string;
  users: DemoUser[];
  media: Record<string, string>;
  byKey: Record<
    string,
    { id: string; category: string; cents: number; recipe?: Record<string, number> }
  >;
  categoryId: Record<string, string>;
  sectorId: Record<string, string>;
  tableId: Record<string, string>;
  stockId: Record<string, string>;
  stockCost: Record<string, number>;
  customers: { id: string; name: string; phone: string; hasAccount: boolean }[];
  orders: {
    id: string;
    number: number;
    status: string;
    channel: string;
    customerId: string | null;
    createdAt: number;
    updatedAt?: number;
    total: number;
    customerName?: string | null;
    customerPhone?: string | null;
    source?: string;
    productIds?: string[];
    history?: { to: string; at: number }[];
  }[];
  at: (daysAgo: number, hh: number, mm?: number) => number;
  localDate: (ms: number) => string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function seedDemoExtras(c: ClientBase, x: DemoExtras, ctx: ExtrasContext) {
  const { T, now, U, rand: r } = ctx;
  const userKeys = ctx.users.map((u) => u.key);

  // ------------------------------------------------------------------ loja: marca
  const b = x.branding;
  await c.query(
    `UPDATE tenant_store_settings SET brand_color = $2, accent_color = $3, font_style = $4,
            corner_style = $5, city = $6, state = $7, favicon_image_id = $8, brand_staff_app = true
      WHERE tenant_id = $1`,
    [T, b.brandColor, b.accentColor, b.fontStyle, b.cornerStyle, b.city, b.state, ctx.media.logo],
  );

  // ------------------------------------------------------------------ cardápio: famílias, custo, delivery
  for (const [name, cats] of x.families) {
    const id = randomUUID();
    await c.query(`INSERT INTO item_families (id, tenant_id, name) VALUES ($1, $2, $3)`, [
      id,
      T,
      name,
    ]);
    await c.query(
      `UPDATE products SET family_id = $3 WHERE tenant_id = $1 AND category_id = ANY($2::uuid[])`,
      [T, cats.map((k) => ctx.categoryId[k]), id],
    );
  }
  // Custo de cada produto pela ficha técnica (tela de precificação).
  let code = 0;
  for (const p of Object.values(ctx.byKey)) {
    const cost = Object.entries(p.recipe ?? {}).reduce(
      (s, [k, q]) => s + (ctx.stockCost[k] ?? 0) * q,
      0,
    );
    code += 1;
    await c.query(`UPDATE products SET cost = $2, code = $3 WHERE id = $1`, [
      p.id,
      cost ? fromCents(Math.round(cost)) : null,
      `IT-${String(code).padStart(4, '0')}`,
    ]);
  }
  await c.query(
    `INSERT INTO pricing_settings (tenant_id, tax_percent, fee_percent, fixed_percent, target_margin)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id) DO NOTHING`,
    [T, x.pricing.tax, x.pricing.fee, x.pricing.fixed, x.pricing.margin],
  );
  const menuId = randomUUID();
  await c.query(
    `INSERT INTO menus (id, tenant_id, name, kind, active) VALUES ($1, $2, $3, 'delivery', true)`,
    [menuId, T, x.deliveryMenu.name],
  );
  for (const [key, p] of Object.entries(ctx.byKey)) {
    if (x.deliveryMenu.exclude.includes(key)) continue;
    // Preço do delivery arredondado para terminar em ,90.
    const raised =
      Math.ceil((p.cents * (100 + x.deliveryMenu.markupPercent)) / 100 / 100) * 100 - 10;
    await c.query(
      `INSERT INTO menu_items (tenant_id, menu_id, product_id, price) VALUES ($1,$2,$3,$4)`,
      [T, menuId, p.id, fromCents(Math.max(raised, p.cents))],
    );
  }

  // ------------------------------------------------------------------ chat da equipe
  const convMembers = new Map<string, string[]>();
  const addMessages = async (
    conv: string,
    msgs: [string, number, string, Record<string, string[]>?][],
  ) => {
    let last = 0;
    for (const [author, ago, body, reactions] of msgs) {
      const at = now - ago * MIN;
      last = Math.max(last, at);
      const react: Record<string, string[]> = {};
      for (const [emoji, who] of Object.entries(reactions ?? {})) react[emoji] = who.map(U);
      await c.query(
        `INSERT INTO chat_messages (tenant_id, conversation_id, author_id, body, reactions, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [T, conv, U(author), body, JSON.stringify(react), iso(at)],
      );
    }
    await c.query(
      `UPDATE chat_conversations SET last_message_at = $2, updated_at = $2 WHERE id = $1`,
      [conv, iso(last)],
    );
    // Quem escreveu por último já leu; o resto fica com mensagens novas para ver.
    const lastAuthor = U(msgs[msgs.length - 1]![0]);
    await c.query(
      `UPDATE chat_members SET last_read_at = CASE WHEN user_id = $2 THEN $3::timestamptz ELSE $4::timestamptz END
        WHERE conversation_id = $1`,
      [conv, lastAuthor, iso(last), iso(last - 30 * MIN)],
    );
  };
  const roomId: Record<string, string> = {};
  for (const room of x.chat.rooms) {
    const id = randomUUID();
    roomId[room.name] = id;
    const first = now - (Math.max(...room.messages.map((m) => m[1])) + 60) * MIN;
    await c.query(
      `INSERT INTO chat_conversations (id, tenant_id, kind, name, description, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, T, room.kind, room.name, room.description, U(room.admin), iso(first)],
    );
    const members = room.members === 'all' ? userKeys : room.members;
    convMembers.set(id, members);
    for (const m of members)
      await c.query(
        `INSERT INTO chat_members (tenant_id, conversation_id, user_id, role, joined_at, pinned)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [T, id, U(m), m === room.admin ? 'admin' : 'member', iso(first), room.members === 'all'],
      );
    await addMessages(id, room.messages);
  }
  for (const d of x.chat.directs) {
    const id = randomUUID();
    const first = now - (Math.max(...d.messages.map((m) => m[1])) + 5) * MIN;
    await c.query(
      `INSERT INTO chat_conversations (id, tenant_id, kind, direct_key, created_by, created_at)
       VALUES ($1,$2,'direct',$3,$4,$5)`,
      [id, T, [U(d.a), U(d.b)].sort().join(':'), U(d.a), iso(first)],
    );
    for (const m of [d.a, d.b])
      await c.query(
        `INSERT INTO chat_members (tenant_id, conversation_id, user_id, role, joined_at)
         VALUES ($1,$2,$3,'member',$4)`,
        [T, id, U(m), iso(first)],
      );
    await addMessages(id, d.messages);
  }
  for (const [author, hoursAgo, body, pinned, image, comments = []] of x.chat.posts) {
    const reactions: Record<string, string[]> = {
      '❤️': userKeys.filter(() => r.chance(0.35)).map(U),
      '👍': userKeys.filter(() => r.chance(0.25)).map(U),
    };
    for (const k of Object.keys(reactions)) if (!reactions[k]!.length) delete reactions[k];
    const id = randomUUID();
    await c.query(
      `INSERT INTO chat_posts (id, tenant_id, author_id, body, image_id, pinned, reactions, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        T,
        U(author),
        body,
        image ? ctx.media[image] : null,
        pinned,
        JSON.stringify(reactions),
        iso(now - hoursAgo * HOUR),
      ],
    );
    for (const [who, minutesAfter, text] of comments)
      await c.query(
        `INSERT INTO chat_post_comments (tenant_id, post_id, author_id, body, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [T, id, U(who), text, iso(now - hoursAgo * HOUR + minutesAfter * MIN)],
      );
    for (const k of userKeys)
      if (k !== author)
        await c.query(
          `INSERT INTO chat_notices (tenant_id, user_id, kind, title, body, post_id, actor_id, created_at, read_at)
           VALUES ($1,$2,'post',$3,$4,$5,$6,$7,$8)`,
          [
            T,
            U(k),
            `${ctx.users.find((u) => u.key === author)!.name.split(' ')[0]} publicou no mural`,
            body.slice(0, 300),
            id,
            U(author),
            iso(now - hoursAgo * HOUR),
            hoursAgo > 30 ? iso(now - (hoursAgo - 2) * HOUR) : null,
          ],
        );
  }
  for (const [to, from, room, text] of x.chat.mentions)
    await c.query(
      `INSERT INTO chat_notices (tenant_id, user_id, kind, title, body, conversation_id, actor_id, created_at)
       VALUES ($1,$2,'mention',$3,$4,$5,$6,$7)`,
      [
        T,
        U(to),
        `${ctx.users.find((u) => u.key === from)!.name.split(' ')[0]} mencionou você em "${room}"`,
        text.slice(0, 300),
        roomId[room] ?? null,
        U(from),
        iso(now - 12 * MIN),
      ],
    );

  // ------------------------------------------------------------------ fidelidade
  const L = x.loyalty;
  await c.query(
    `INSERT INTO loyalty_programs (tenant_id, enabled, mode, points_per_real, expiry_days, count_staff_orders)
     VALUES ($1, true, 'points', $2, $3, true) ON CONFLICT (tenant_id) DO NOTHING`,
    [T, L.pointsPerReal, L.expiryDays],
  );
  const rewardIds: { id: string; cost: number; discount: number | null }[] = [];
  for (const [i, [name, cost, what]] of L.rewards.entries()) {
    const id = randomUUID();
    const product = ctx.byKey[what];
    const discount = product ? null : Math.round(Number(what) * 100);
    await c.query(
      `INSERT INTO loyalty_rewards (id, tenant_id, name, cost, kind, amount, product_id, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        T,
        name,
        cost,
        product ? 'product' : 'discount',
        discount === null ? null : fromCents(discount),
        product?.id ?? null,
        i,
      ],
    );
    rewardIds.push({ id, cost, discount });
  }
  const balance = new Map<string, number>();
  const loyaltyRows: unknown[][] = [];
  for (const o of ctx.orders) {
    if (!o.customerId || o.status !== 'completed') continue;
    const pts = Math.floor((o.total / 100) * L.pointsPerReal);
    if (pts <= 0) continue;
    balance.set(o.customerId, (balance.get(o.customerId) ?? 0) + pts);
    loyaltyRows.push([
      T,
      o.customerId,
      'earn',
      pts,
      o.id,
      null,
      null,
      null,
      iso(o.createdAt + 40 * MIN),
    ]);
    // Quem junta pontos para a recompensa mais barata às vezes troca no pedido seguinte.
    const cheapest = rewardIds[0];
    if (cheapest && balance.get(o.customerId)! >= cheapest.cost * 1.5 && r.chance(0.25)) {
      balance.set(o.customerId, balance.get(o.customerId)! - cheapest.cost);
      loyaltyRows.push([
        T,
        o.customerId,
        'redeem',
        -cheapest.cost,
        null,
        cheapest.id,
        cheapest.discount === null ? null : fromCents(cheapest.discount),
        'Troca no balcão',
        iso(o.createdAt + 50 * MIN),
      ]);
    }
  }
  if (loyaltyRows.length) {
    for (let i = 0; i < loyaltyRows.length; i += 500) {
      const chunk = loyaltyRows.slice(i, i + 500);
      const params: unknown[] = [];
      const values = chunk.map((row) => {
        const ph = row.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `(${ph.join(',')})`;
      });
      await c.query(
        `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, order_id, reward_id, discount, note, created_at)
         VALUES ${values.join(',')}`,
        params,
      );
    }
  }

  // ------------------------------------------------------------------ reservas
  const R = x.reservations;
  await c.query(
    `INSERT INTO reservation_settings (tenant_id, enabled, auto_confirm, weekdays, opens_at, closes_at,
        slot_minutes, duration_minutes, max_party, min_advance_minutes, max_days_ahead, note)
     VALUES ($1, true, false, $2, $3, $4, 30, 90, $5, 120, 30, $6) ON CONFLICT (tenant_id) DO NOTHING`,
    [T, R.weekdays, R.opensAt, R.closesAt, R.maxParty, R.note],
  );
  for (const [
    i,
    [name, phone, party, ahead, hh, mm, status, occasion, notes, table],
  ] of R.list.entries()) {
    const starts = ctx.at(-ahead, hh, mm);
    const created = Math.min(starts - 2 * DAY, now - (i + 1) * 3 * HOUR);
    const customer = ctx.customers.find((cu) => cu.name === name && cu.hasAccount);
    await c.query(
      `INSERT INTO reservations (tenant_id, code, customer_id, name, phone, party_size, starts_at, occasion,
          notes, status, table_id, source, cancel_reason, cancelled_by, created_by, status_changed_at,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
      [
        T,
        `${x.reservationPrefix ?? 'AUR'}${String(100 + i)}`,
        customer?.id ?? null,
        name,
        phone,
        party,
        iso(starts),
        occasion,
        notes,
        status,
        table ? ctx.tableId[table] : null,
        customer ? 'online' : 'staff',
        status === 'cancelled' ? 'Imprevisto, remarco outro dia' : null,
        status === 'cancelled' ? 'customer' : null,
        customer ? null : U('manager'),
        iso(Math.min(now, status === 'pending' ? created : created + HOUR)),
        iso(created),
      ],
    );
  }

  // ------------------------------------------------------------------ estoque: notas, contagem e produção
  // Cada compra do histórico vira uma nota de entrada por fornecedor (as das últimas semanas).
  const { rows: buys } = await c.query<{
    id: string;
    stock_item_id: string;
    quantity: string;
    unit_cost: string | null;
    created_at: Date;
    category: string | null;
  }>(
    `SELECT m.id, m.stock_item_id, m.quantity::text, m.unit_cost::text, m.created_at, s.category
       FROM stock_movements m JOIN stock_items s ON s.id = m.stock_item_id
      WHERE m.tenant_id = $1 AND m.kind = 'purchase' AND m.note = 'Compra do fornecedor'
        AND m.created_at > $2
      ORDER BY m.created_at`,
    [T, iso(now - 22 * DAY)],
  );
  const groups = new Map<string, typeof buys>();
  for (const m of buys) {
    const supplier = x.stock.suppliers[m.category ?? ''] ?? 'Fornecedor diverso';
    const k = `${ctx.localDate(m.created_at.getTime())}|${supplier}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  let nf = 48210;
  for (const [k, lines] of groups) {
    const [day, supplier] = k.split('|') as [string, string];
    const id = randomUUID();
    const total = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_cost ?? 0), 0);
    nf += r.int(3, 40);
    await c.query(
      `INSERT INTO stock_receipts (id, tenant_id, supplier, invoice, received_on, note, total, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        T,
        supplier,
        `NF ${nf}`,
        day,
        null,
        total.toFixed(2),
        U('manager'),
        iso(lines[0]!.created_at.getTime()),
      ],
    );
    for (const l of lines) {
      await c.query(
        `INSERT INTO stock_receipt_lines (tenant_id, receipt_id, stock_item_id, quantity, unit_cost,
            entered_quantity, entered_unit, factor)
         SELECT $1, $2, $3, $4, $5, $4, unit, 1 FROM stock_items WHERE id = $3`,
        [T, id, l.stock_item_id, l.quantity, l.unit_cost],
      );
      await c.query(`UPDATE stock_movements SET receipt_id = $2 WHERE id = $1`, [l.id, id]);
    }
  }
  // A contagem desta manhã (os ajustes "Contagem do inventário" de seed.ts) vira uma contagem.
  const { rows: adj } = await c.query<{ id: string; delta: string }>(
    `SELECT m.id, (m.quantity * s.avg_cost)::text AS delta FROM stock_movements m
       JOIN stock_items s ON s.id = m.stock_item_id
      WHERE m.tenant_id = $1 AND m.note = 'Contagem do inventário'`,
    [T],
  );
  const { rows: itemCount } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM stock_items WHERE tenant_id = $1`,
    [T],
  );
  const countId = randomUUID();
  await c.query(
    `INSERT INTO stock_counts (id, tenant_id, note, items_counted, items_changed, value_delta, created_by, created_at)
     VALUES ($1,$2,'Contagem da manhã',$3,$4,$5,$6,$7)`,
    [
      countId,
      T,
      itemCount[0]!.n,
      adj.length,
      adj.reduce((s, a) => s + Number(a.delta), 0).toFixed(2),
      U('manager'),
      iso(now - 5 * MIN),
    ],
  );
  await c.query(`UPDATE stock_movements SET count_id = $2 WHERE id = ANY($1::bigint[])`, [
    adj.map((a) => a.id),
    countId,
  ]);
  await c.query(`UPDATE stock_items SET counted_at = $2 WHERE tenant_id = $1`, [
    T,
    iso(now - 5 * MIN),
  ]);
  // Fichas dos insumos feitos na casa e as produções de hoje cedo.
  for (const [item, rec] of Object.entries(x.stock.recipes)) {
    await c.query(`UPDATE stock_items SET recipe_yield = $2, shelf_life_days = 3 WHERE id = $1`, [
      ctx.stockId[item],
      rec.yields,
    ]);
    for (const [ing, q] of Object.entries(rec.ingredients))
      await c.query(
        `INSERT INTO stock_item_recipes (tenant_id, stock_item_id, ingredient_id, quantity) VALUES ($1,$2,$3,$4)`,
        [T, ctx.stockId[item], ctx.stockId[ing], q],
      );
  }
  for (const [i, [item, qty, note]] of x.stock.productions.entries()) {
    const rec = x.stock.recipes[item]!;
    const when = ctx.at(0, 6, 10 + i * 20);
    if (when > now) continue;
    const factor = qty / rec.yields;
    let cost = 0;
    const needs: [string, number][] = [];
    for (const [ing, q] of Object.entries(rec.ingredients)) needs.push([ing, round3(q * factor)]);
    const { rows: have } = await c.query<{ id: string; quantity: string; avg_cost: string }>(
      `SELECT id, quantity::text, avg_cost::text FROM stock_items WHERE id = ANY($1::uuid[])`,
      [needs.map(([k]) => ctx.stockId[k])],
    );
    const qOf = (k: string) => have.find((h) => h.id === ctx.stockId[k])!;
    if (needs.some(([k, n]) => Number(qOf(k).quantity) < n)) continue;
    for (const [k, n] of needs) cost += n * Number(qOf(k).avg_cost);
    const prodId = randomUUID();
    await c.query(
      `INSERT INTO stock_productions (id, tenant_id, stock_item_id, quantity, total_cost, note, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [prodId, T, ctx.stockId[item], qty, cost.toFixed(2), note, U('kitchen'), iso(when)],
    );
    const move = async (k: string, delta: number, unitCost: string | null) => {
      const { rows } = await c.query<{ q: string }>(
        `UPDATE stock_items SET quantity = quantity + $2 WHERE id = $1 RETURNING quantity::text AS q`,
        [ctx.stockId[k], delta],
      );
      await c.query(
        `INSERT INTO stock_movements (tenant_id, stock_item_id, kind, quantity, unit_cost, balance_after,
            note, created_by, created_at, production_id)
         VALUES ($1,$2,'production',$3,$4,$5,$6,$7,$8,$9)`,
        [T, ctx.stockId[k], delta, unitCost, rows[0]!.q, note, U('kitchen'), iso(when), prodId],
      );
    };
    for (const [k, n] of needs) await move(k, -n, null);
    await move(item, qty, (cost / qty).toFixed(4));
  }

  // ------------------------------------------------------------------ fiscal
  for (const [code, name, cfop, cst, isDefault, ncms] of x.fiscal.rules) {
    const id = randomUUID();
    await c.query(
      `INSERT INTO fiscal_rules (id, tenant_id, code, name, scope, is_default, cfop, icms_cst, icms_origin,
          pis_cst, cofins_cst, approx_tax_rate)
       VALUES ($1,$2,$3,$4,'all',$5,$6,$7,0,'49','49',$8)`,
      [id, T, code, name, isDefault, cfop, cst, cst === '500' ? '31.45' : '16.13'],
    );
    for (const ncm of ncms)
      await c.query(`INSERT INTO fiscal_ncm_rules (tenant_id, ncm, rule_id) VALUES ($1,$2,$3)`, [
        T,
        ncm,
        id,
      ]);
  }

  // ------------------------------------------------------------------ entregas
  await c.query(
    `INSERT INTO courier_pay_settings (tenant_id, rule, taxes, updated_by)
     VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id) DO NOTHING`,
    [
      T,
      JSON.stringify(x.courierPay),
      JSON.stringify({
        inssRate: 11,
        inssCeiling: '8475.55',
        withholdIrrf: true,
        issRate: 0,
        employerRate: 0,
      }),
      U('owner'),
    ],
  );
  for (const [key, cfg] of Object.entries(x.couriers))
    await c.query(
      `UPDATE couriers SET pix_key = $3, tax_regime = $4 WHERE tenant_id = $1 AND name = $2`,
      [T, key, cfg.pix, cfg.regime],
    );
  // Rastro do GPS de quem está na rua agora (mapa da entrega).
  const { rows: out } = await c.query<{
    id: string;
    started: Date;
    lat: string;
    lng: string;
    olat: string;
    olng: string;
  }>(
    `SELECT d.id, d.dispatched_at AS started, d.last_lat::text AS lat, d.last_lng::text AS lng,
            o.delivery_lat::text AS olat, o.delivery_lng::text AS olng
       FROM deliveries d JOIN orders o ON o.id = d.order_id
      WHERE d.tenant_id = $1 AND d.status = 'out'`,
    [T],
  );
  const { rows: st } = await c.query<{ lat: string; lng: string }>(
    `SELECT store_lat::text AS lat, store_lng::text AS lng FROM tenant_store_settings WHERE tenant_id = $1`,
    [T],
  );
  for (const d of out) {
    const s = { lat: Number(st[0]!.lat), lng: Number(st[0]!.lng) };
    const e = { lat: Number(d.lat), lng: Number(d.lng) };
    const t0 = d.started.getTime();
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const wobble = Math.sin(f * Math.PI * 3) * 0.0006;
      await c.query(
        `INSERT INTO delivery_positions (tenant_id, delivery_id, lat, lng, accuracy, speed, heading, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          T,
          d.id,
          (s.lat + (e.lat - s.lat) * f + wobble).toFixed(6),
          (s.lng + (e.lng - s.lng) * f - wobble).toFixed(6),
          r.int(4, 15),
          i === steps ? 0 : (r.int(18, 34) / 3.6).toFixed(1),
          Math.round(((Math.atan2(e.lng - s.lng, e.lat - s.lat) * 180) / Math.PI + 360) % 360),
          iso(t0 + (now - MIN - t0) * f),
        ],
      );
    }
  }

  await seedDemoMore(c, x, ctx);

  // ------------------------------------------------------------------ assistente e panda
  // Limite do assistente e consumo ficam no banco central (platform.ts).
  const [who, talk] = x.ai.conversation;
  for (const [i, [role, content]] of talk.entries())
    await c.query(
      `INSERT INTO ai_messages (tenant_id, user_id, role, content, tokens, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        T,
        U(who),
        role,
        content,
        role === 'assistant' ? 380 + i * 40 : 0,
        iso(now - (90 - i * 2) * MIN),
      ],
    );
}

/** Linhas em blocos (abaixo do limite de parâmetros do Postgres). */
async function insertRows(c: ClientBase, table: string, cols: string[], rows: unknown[][]) {
  const per = Math.max(1, Math.floor(30_000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const params: unknown[] = [];
    const values = rows.slice(i, i + per).map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
}

/**
 * O que veio depois da Aurora: galeria de fotos e avaliações dos itens, conversas da loja,
 * WhatsApp ligado com os textos da casa (e o histórico de avisos enviados), atendente IA no
 * WhatsApp com conversas, taxa de serviço e mês do financeiro.
 */
async function seedDemoMore(c: ClientBase, x: DemoExtras, ctx: ExtrasContext) {
  const { T, now, U, rand: r } = ctx;
  const accounts = ctx.customers.filter((cu) => cu.hasAccount);
  const byName = (name: string) => ctx.customers.find((cu) => cu.name === name);

  // ------------------------------------------------------------------ galeria de fotos
  if (x.gallery) {
    const rows: unknown[][] = [];
    for (const [key, photos] of Object.entries(x.gallery)) {
      const p = ctx.byKey[key];
      if (!p) continue;
      const { rows: main } = await c.query<{ image_id: string | null }>(
        `SELECT image_id FROM products WHERE id = $1`,
        [p.id],
      );
      const all = [main[0]?.image_id, ...photos.map((ph) => ctx.media[ph])].filter(
        (v): v is string => !!v,
      );
      all.forEach((img, i) => rows.push([T, p.id, img, i]));
    }
    await insertRows(
      c,
      'product_photos',
      ['tenant_id', 'product_id', 'image_id', 'position'],
      rows,
    );
  }

  // ------------------------------------------------------------------ avaliações dos itens
  if (x.reviews && accounts.length) {
    const reviews: unknown[][] = [];
    const likes: unknown[][] = [];
    // Quem pediu o item avalia; o resto das avaliações vem de clientes com conta ao acaso.
    const buyers = new Map<string, Set<string>>();
    for (const o of ctx.orders)
      if (o.customerId && o.status === 'completed')
        for (const pid of o.productIds ?? []) {
          if (!buyers.has(pid)) buyers.set(pid, new Set());
          buyers.get(pid)!.add(o.customerId);
        }
    for (const p of Object.values(ctx.byKey)) {
      const comments = x.reviews.comments[p.category] ?? x.reviews.comments.default ?? [];
      const want = r.int(x.reviews.perProduct[0], x.reviews.perProduct[1]);
      const pool = [...(buyers.get(p.id) ?? [])];
      for (const cu of accounts) if (!pool.includes(cu.id)) pool.push(cu.id);
      const used = new Set<string>();
      for (let i = 0; i < want && used.size < pool.length; i++) {
        const who = pool[Math.min(pool.length - 1, Math.floor(r.next() ** 1.6 * pool.length))]!;
        if (used.has(who)) continue;
        used.add(who);
        const x5 = r.next();
        const rating = x5 < 0.62 ? 5 : x5 < 0.88 ? 4 : x5 < 0.95 ? 3 : x5 < 0.985 ? 2 : 1;
        const text =
          rating <= 3
            ? r.chance(0.8)
              ? x.reviews.low[Math.floor(r.next() * x.reviews.low.length)]!
              : null
            : r.chance(0.7) && comments.length
              ? comments[Math.floor(r.next() * comments.length)]!
              : null;
        const id = randomUUID();
        const at = now - r.int(1, Math.max(2, ctx.days - 5)) * DAY - r.int(0, 600) * MIN;
        reviews.push([id, T, p.id, who, rating, text, iso(at), iso(at)]);
        for (const fan of accounts)
          if (fan.id !== who && text && r.chance(0.12))
            likes.push([T, id, fan.id, iso(Math.min(now, at + r.int(1, 240) * HOUR))]);
      }
    }
    await insertRows(
      c,
      'product_reviews',
      [
        'id',
        'tenant_id',
        'product_id',
        'customer_id',
        'rating',
        'comment',
        'created_at',
        'updated_at',
      ],
      reviews,
    );
    await insertRows(
      c,
      'product_review_likes',
      ['tenant_id', 'review_id', 'customer_id', 'created_at'],
      likes,
    );
  }

  // ------------------------------------------------------------------ conversas da loja
  for (const [name, msgs] of x.storeChats ?? []) {
    const cu = byName(name);
    if (!cu?.hasAccount) continue;
    const id = randomUUID();
    const first = now - Math.max(...msgs.map((m) => m[1])) * MIN;
    const [lastWho, lastAgo, lastBody] = msgs[msgs.length - 1]!;
    const lastAt = now - lastAgo * MIN;
    await c.query(
      `INSERT INTO store_chats (id, tenant_id, customer_id, name, phone, status, last_message_at, last_preview,
          last_sender, customer_read_at, staff_read_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$7)`,
      [
        id,
        T,
        cu.id,
        cu.name,
        cu.phone,
        lastAgo > 24 * 60 ? 'closed' : 'open',
        iso(lastAt),
        lastBody.slice(0, 140),
        lastWho,
        iso(lastWho === 'customer' ? lastAt : lastAt - MIN),
        iso(lastWho === 'staff' || lastAgo > 60 ? lastAt : lastAt - MIN),
        iso(first),
      ],
    );
    await insertRows(
      c,
      'store_chat_messages',
      ['tenant_id', 'chat_id', 'sender', 'author_id', 'body', 'created_at'],
      msgs.map(([who, ago, body]) => [
        T,
        id,
        who,
        who === 'staff' ? U('attendant') : null,
        body,
        iso(now - ago * MIN),
      ]),
    );
  }

  // ------------------------------------------------------------------ WhatsApp
  if (x.whatsapp) {
    const w = x.whatsapp;
    await c.query(
      `UPDATE tenant_messaging_settings SET provider = 'baileys', enabled = true,
              text_accepted = COALESCE($2, text_accepted), text_ready = COALESCE($3, text_ready),
              text_dispatched = COALESCE($4, text_dispatched), text_delivered = COALESCE($5, text_delivered),
              text_cancelled = COALESCE($6, text_cancelled),
              notify_accepted = true, notify_ready = true, notify_dispatched = true,
              notify_delivered = true, notify_cancelled = true, updated_by = $7
        WHERE tenant_id = $1`,
      [
        T,
        w.texts.accepted ?? null,
        w.texts.ready ?? null,
        w.texts.dispatched ?? null,
        w.texts.delivered ?? null,
        w.texts.cancelled ?? null,
        U('owner'),
      ],
    );
    const { rows: st } = await c.query<Record<string, string>>(
      `SELECT text_accepted, text_ready, text_dispatched, text_delivered, text_cancelled,
              (SELECT name FROM tenants WHERE id = $1) AS restaurant
         FROM tenant_messaging_settings WHERE tenant_id = $1`,
      [T],
    );
    const s = st[0]!;
    // Histórico de avisos: os pedidos online e de entrega com telefone, como o sistema envia.
    const outbox: unknown[][] = [];
    for (const o of ctx.orders) {
      const phone = o.customerPhone?.replace(/\D/g, '');
      if (!phone || !o.history) continue;
      const to = phone.length <= 11 ? `55${phone}` : phone;
      const first = (o.customerName ?? '').split(' ')[0] || 'cliente';
      const msg = (tpl: string) =>
        tpl
          .replaceAll('{cliente}', first)
          .replaceAll('{pedido}', String(o.number))
          .replaceAll('{restaurante}', s.restaurant ?? '');
      const events: [string, string, number][] = [];
      for (const h of o.history) {
        if (h.to === 'new' && o.source === 'online')
          events.push(['order.accepted', s.text_accepted!, h.at]);
        if (h.to === 'ready' && o.channel === 'pickup')
          events.push(['order.ready', s.text_ready!, h.at]);
        if (h.to === 'dispatched') events.push(['order.dispatched', s.text_dispatched!, h.at]);
        if (h.to === 'completed' && o.channel === 'delivery')
          events.push(['order.delivered', s.text_delivered!, h.at]);
        if (h.to === 'cancelled') events.push(['order.cancelled', s.text_cancelled!, h.at]);
      }
      for (const [event, tpl, at] of events) {
        const sentAt = at + r.int(2, 9) * 1000;
        outbox.push([
          T,
          o.id,
          event,
          'baileys',
          to,
          msg(tpl),
          'sent',
          1,
          `3EB0${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`,
          iso(at),
          iso(sentAt),
          iso(sentAt),
        ]);
      }
    }
    await insertRows(
      c,
      'message_outbox',
      [
        'tenant_id',
        'order_id',
        'event',
        'provider',
        'to_phone',
        'body',
        'status',
        'attempts',
        'provider_message_id',
        'created_at',
        'updated_at',
        'sent_at',
      ],
      outbox,
    );
    const a = w.agent;
    await c.query(
      `INSERT INTO ai_agent_settings (tenant_id, whatsapp_enabled, agent_name, tone, greeting, about, rules,
          handoff_message, suggest_items, show_prices, send_store_link, reply_when, updated_by)
       VALUES ($1, true, $2, $3, $4, $5, $6, $7, true, true, true, 'always', $8)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [T, a.name, a.tone, a.greeting, a.about, a.rules, a.handoff, U('owner')],
    );
    for (const [name, hoursAgo, talk] of w.chats) {
      const cu = byName(name);
      if (!cu) continue;
      const phone = `55${cu.phone.replace(/\D/g, '')}`;
      const start = now - hoursAgo * HOUR;
      const last = start + (talk.length - 1) * 40_000;
      await c.query(
        `INSERT INTO ai_customer_chats (tenant_id, phone, name, paused_until, last_at) VALUES ($1,$2,$3,NULL,$4)
         ON CONFLICT (tenant_id, phone) DO NOTHING`,
        [T, phone, cu.name, iso(last)],
      );
      await insertRows(
        c,
        'ai_customer_messages',
        ['tenant_id', 'phone', 'role', 'content', 'tokens', 'created_at'],
        talk.map(([role, content], i) => [
          T,
          phone,
          role,
          content,
          role === 'assistant' ? 420 + content.length : 0,
          iso(start + i * 40_000),
        ]),
      );
    }
  }

  // ------------------------------------------------------------------ salão e financeiro
  if (x.serviceFeePercent !== undefined)
    await c.query(
      `INSERT INTO salon_settings (tenant_id, service_fee_percent) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`,
      [T, x.serviceFeePercent],
    );
  if (x.financeMonthStart !== undefined)
    await c.query(
      `INSERT INTO finance_settings (tenant_id, month_start_day, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [T, x.financeMonthStart, U('owner')],
    );
}
