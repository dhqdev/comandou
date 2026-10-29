import {
  CHANNEL_LABELS,
  ROLE_LABELS,
  type OrderChannel,
  type ReportKpi,
  type Role,
} from '@comandou/shared';
import { findZone, type Zone } from '../../delivery/zones';
import {
  type Built,
  CUSTOMER_KEY,
  dailySeries,
  dayList,
  districtOf,
  dm,
  localDay,
  localTs,
  n,
  one,
  pct,
  type Period,
  q,
  r1,
  r2,
  SOLD,
  serial,
  sum,
  topWithOthers,
  WEEKDAYS,
  WEEKDAYS_SHORT,
} from './kit';

const ITEM_COST = `(i.quantity * (
    COALESCE((SELECT sum(pr.quantity * si.avg_cost) FROM product_recipes pr
               JOIN stock_items si ON si.id = pr.stock_item_id WHERE pr.product_id = i.product_id), 0)
  + COALESCE((SELECT sum(orc.quantity * si.avg_cost) FROM order_item_options oio
               JOIN option_recipes orc ON orc.option_id = oio.option_id
               JOIN stock_items si ON si.id = orc.stock_item_id WHERE oio.order_item_id = i.id), 0)))`;
const HAS_RECIPE = `EXISTS (SELECT 1 FROM product_recipes pr WHERE pr.product_id = i.product_id)`;
const ch = (c: string) => CHANNEL_LABELS[c as OrderChannel] ?? c;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface ProductRow {
  id: string;
  name: string;
  family: string;
  category: string;
  qty: number;
  revenue: number;
  cost: number;
  hasRecipe: boolean;
}

async function products(p: Period): Promise<ProductRow[]> {
  const rows = await q(
    p.tx,
    `SELECT i.product_id AS id, max(i.name) AS name,
            COALESCE(max(f.name), 'Sem família') AS family, COALESCE(max(c.name), 'Sem categoria') AS category,
            sum(i.quantity)::text AS qty, sum(i.total)::text AS revenue,
            round(sum(${ITEM_COST}), 2)::text AS cost, bool_and(${HAS_RECIPE}) AS has_recipe
       FROM order_items i JOIN orders o ON o.id = i.order_id
       LEFT JOIN products pr ON pr.id = i.product_id
       LEFT JOIN item_families f ON f.id = pr.family_id
       LEFT JOIN categories c ON c.id = pr.category_id
      WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} AND i.status <> 'cancelled'
      GROUP BY i.product_id ORDER BY sum(i.total) DESC LIMIT 2000`,
    [p.a, p.b],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    family: String(r.family),
    category: String(r.category),
    qty: n(r.qty),
    revenue: n(r.revenue),
    cost: n(r.cost),
    hasRecipe: !!r.has_recipe,
  }));
}

function groupBy(rows: ProductRow[], key: 'family' | 'category') {
  const m = new Map<
    string,
    { name: string; items: number; qty: number; revenue: number; profit: number }
  >();
  for (const r of rows) {
    const g = m.get(r[key]) ?? { name: r[key], items: 0, qty: 0, revenue: 0, profit: 0 };
    g.items++;
    g.qty = r2(g.qty + r.qty);
    g.revenue = r2(g.revenue + r.revenue);
    g.profit = r2(g.profit + (r.hasRecipe ? r.revenue - r.cost : 0));
    m.set(r[key], g);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}

/* ======================= Produtos ======================= */

export async function produtos(p: Period): Promise<Built> {
  const rows = await products(p);
  const total = sum(rows, (r) => r.revenue);
  const prevTotal = await one(
    p.tx,
    `SELECT COALESCE(sum(i.quantity), 0)::text AS qty, COALESCE(sum(i.total), 0)::text AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} AND i.status <> 'cancelled'`,
    [p.pa, p.a],
  );
  const withRecipe = rows.filter((r) => r.hasRecipe);
  const margin = pct(
    sum(withRecipe, (r) => r.revenue - r.cost),
    sum(withRecipe, (r) => r.revenue),
  );
  const fam = groupBy(rows, 'family');
  const cat = groupBy(rows, 'category');
  const groupCols = (label: string) => [
    { key: 'name', label, fmt: 'text' as const, width: 24 },
    { key: 'items', label: 'Produtos', fmt: 'int' as const },
    { key: 'qty', label: 'Quantidade', fmt: 'num' as const },
    { key: 'revenue', label: 'Vendido', fmt: 'money' as const },
    { key: 'share', label: '% do vendido', fmt: 'pct' as const },
    { key: 'profit', label: 'Lucro (com ficha)', fmt: 'money' as const },
  ];
  const withShare = <T extends { revenue: number }>(xs: T[]) =>
    xs.map((x) => ({ ...x, share: pct(x.revenue, total) }));
  return {
    kpis: [
      {
        label: 'Vendido em produtos',
        value: total,
        fmt: 'money',
        prev: n(prevTotal!.revenue),
        main: true,
      },
      {
        label: 'Itens vendidos',
        value: sum(rows, (r) => r.qty),
        fmt: 'num',
        prev: n(prevTotal!.qty),
      },
      { label: 'Produtos diferentes', value: rows.length, fmt: 'int' },
      { label: 'Margem média', value: margin, fmt: 'pct', hint: 'Dos produtos com ficha técnica' },
      {
        label: 'Mais vendido',
        value: rows[0]?.name ?? '—',
        fmt: 'text',
        hint: rows[0] ? brl(rows[0].revenue) : undefined,
      },
    ],
    charts: [
      {
        kind: 'bars',
        title: 'Os 12 que mais vendem',
        fmt: 'money',
        points: rows.slice(0, 12).map((r) => ({
          label: r.name,
          value: r.revenue,
          hint: `${r.qty.toLocaleString('pt-BR')} un.`,
        })),
        wide: true,
      },
      {
        kind: 'donut',
        title: 'Por família',
        fmt: 'money',
        points: topWithOthers(fam.map((f) => ({ label: f.name, value: f.revenue }))),
      },
      {
        kind: 'donut',
        title: 'Por categoria do cardápio',
        fmt: 'money',
        points: topWithOthers(cat.map((c) => ({ label: c.name, value: c.revenue }))),
      },
    ],
    tables: [
      {
        id: 'produtos',
        title: 'Produtos',
        columns: [
          { key: 'rank', label: '#', fmt: 'int', width: 6 },
          { key: 'name', label: 'Produto', fmt: 'text', width: 30 },
          { key: 'family', label: 'Família', fmt: 'text', width: 18 },
          { key: 'category', label: 'Categoria', fmt: 'text', width: 18 },
          { key: 'qty', label: 'Quantidade', fmt: 'num' },
          { key: 'avg', label: 'Preço médio', fmt: 'money' },
          { key: 'revenue', label: 'Vendido', fmt: 'money' },
          { key: 'share', label: '% do vendido', fmt: 'pct' },
          { key: 'cost', label: 'Custo', fmt: 'money' },
          { key: 'profit', label: 'Lucro', fmt: 'money' },
          { key: 'margin', label: 'Margem', fmt: 'pct' },
        ],
        rows: rows.map((r, i) => ({
          rank: i + 1,
          name: r.name,
          family: r.family,
          category: r.category,
          qty: r.qty,
          avg: r.qty ? r2(r.revenue / r.qty) : 0,
          revenue: r.revenue,
          share: pct(r.revenue, total),
          cost: r.hasRecipe ? r.cost : null,
          profit: r.hasRecipe ? r2(r.revenue - r.cost) : null,
          margin: r.hasRecipe ? pct(r.revenue - r.cost, r.revenue) : null,
        })),
        total: {
          rank: null,
          name: 'Total',
          qty: sum(rows, (r) => r.qty),
          revenue: total,
          share: 100,
        },
        bar: 'revenue',
      },
      {
        id: 'familias',
        title: 'Por família',
        columns: groupCols('Família'),
        rows: withShare(fam),
        bar: 'revenue',
      },
      {
        id: 'categorias',
        title: 'Por categoria',
        columns: groupCols('Categoria'),
        rows: withShare(cat),
        bar: 'revenue',
      },
    ],
    notes: ['Custo, lucro e margem aparecem só para produtos com ficha técnica.'],
  };
}

/* ======================= Engenharia de cardápio ======================= */

export const MENU_CLASSES = {
  star: { label: 'Carro-chefe', hint: 'Vende muito e deixa bom lucro. Mantenha em destaque.' },
  plowhorse: {
    label: 'Popular de margem baixa',
    hint: 'Vende muito, mas lucra pouco por unidade. Revise preço, porção ou ficha.',
  },
  puzzle: {
    label: 'Rentável que vende pouco',
    hint: 'Lucra bem por unidade, mas sai pouco. Destaque no cardápio, foto ou sugestão do garçom.',
  },
  dog: {
    label: 'Candidato a sair',
    hint: 'Vende pouco e lucra pouco. Reformule ou tire do cardápio.',
  },
} as const;
type MenuClass = keyof typeof MENU_CLASSES;

/** Matriz de engenharia de cardápio (popularidade ≥ 70% da média; margem ≥ média ponderada). */
export function classify(rows: ProductRow[]) {
  const sold = rows.filter((r) => r.hasRecipe && r.qty > 0);
  const out = new Map<string, MenuClass>();
  if (sold.length < 2) return { out, avgMargin: 0, popLine: 0, qtyTotal: 0 };
  const qtyTotal = sold.reduce((s, r) => s + r.qty, 0);
  const avgMargin = sold.reduce((s, r) => s + (r.revenue - r.cost), 0) / qtyTotal;
  const popLine = (1 / sold.length) * 0.7;
  for (const r of sold) {
    const popular = r.qty / qtyTotal >= popLine;
    const rich = (r.revenue - r.cost) / r.qty >= avgMargin;
    out.set(r.id, popular ? (rich ? 'star' : 'plowhorse') : rich ? 'puzzle' : 'dog');
  }
  return { out, avgMargin, popLine, qtyTotal };
}

export function abc(rows: ProductRow[]) {
  const sorted = [...rows].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((s, r) => s + r.revenue, 0);
  const out = new Map<string, { cls: 'A' | 'B' | 'C'; acc: number }>();
  let acc = 0;
  for (const r of sorted) {
    const before = total ? acc / total : 1;
    acc += r.revenue;
    out.set(r.id, {
      cls: before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C',
      acc: total ? r1((acc / total) * 100) : 0,
    });
  }
  return out;
}

export async function engenharia(p: Period): Promise<Built> {
  const rows = await products(p);
  const { out: cls, avgMargin, qtyTotal } = classify(rows);
  const curve = abc(rows);
  const keys = Object.keys(MENU_CLASSES) as MenuClass[];
  const table = rows.map((r) => {
    const c = cls.get(r.id);
    return {
      name: r.name,
      family: r.family,
      cls: c ? MENU_CLASSES[c].label : 'Sem ficha técnica',
      abc: curve.get(r.id)?.cls ?? 'C',
      qty: r.qty,
      mix: qtyTotal && r.hasRecipe ? pct(r.qty, qtyTotal) : null,
      revenue: r.revenue,
      unitMargin: r.hasRecipe && r.qty ? r2((r.revenue - r.cost) / r.qty) : null,
      margin: r.hasRecipe ? r2(r.revenue - r.cost) : null,
      acc: curve.get(r.id)?.acc ?? 0,
      action: c ? MENU_CLASSES[c].hint : 'Cadastre a ficha técnica para medir a margem.',
    };
  });
  const fams = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const f = fams.get(r.family) ?? {
      family: r.family,
      star: 0,
      plowhorse: 0,
      puzzle: 0,
      dog: 0,
      none: 0,
      revenue: 0,
    };
    const c = cls.get(r.id) ?? 'none';
    f[c] = (f[c] as number) + 1;
    f.revenue = r2((f.revenue as number) + r.revenue);
    fams.set(r.family, f);
  }
  const count = (k: MenuClass) => [...cls.values()].filter((v) => v === k).length;
  const revOf = (k: MenuClass) =>
    sum(
      rows.filter((r) => cls.get(r.id) === k),
      (r) => r.revenue,
    );
  const abcRev = (k: 'A' | 'B' | 'C') =>
    sum(
      rows.filter((r) => curve.get(r.id)?.cls === k),
      (r) => r.revenue,
    );
  const abcN = (k: 'A' | 'B' | 'C') => rows.filter((r) => curve.get(r.id)?.cls === k).length;
  return {
    kpis: keys
      .map((k, i): ReportKpi => ({
        label: MENU_CLASSES[k].label,
        value: count(k),
        fmt: 'int' as const,
        hint: `${brl(revOf(k))} vendidos`,
        main: i === 0,
      }))
      .concat([
        {
          label: 'Curva A',
          value: abcN('A'),
          fmt: 'int',
          hint: 'Itens que fazem 80% do faturamento',
          main: false,
        },
      ]),
    charts: [
      {
        kind: 'scatter',
        title: 'Popularidade × lucro por unidade',
        x: { label: 'Quantidade vendida', fmt: 'num' },
        y: { label: 'Lucro por unidade', fmt: 'money' },
        cut: { x: cls.size ? (qtyTotal / cls.size) * 0.7 : 0, y: r2(avgMargin) },
        groups: keys.map((k) => ({ id: k, label: MENU_CLASSES[k].label })),
        points: rows
          .filter((r) => cls.has(r.id))
          .map((r) => ({
            label: r.name,
            x: r.qty,
            y: r2((r.revenue - r.cost) / r.qty),
            group: cls.get(r.id)!,
          })),
        wide: true,
      },
      {
        kind: 'donut',
        title: 'Vendido por classe',
        fmt: 'money',
        points: keys
          .map((k) => ({ label: MENU_CLASSES[k].label, value: revOf(k) }))
          .filter((x) => x.value > 0),
      },
      {
        kind: 'bars',
        title: 'Curva ABC',
        fmt: 'money',
        points: (['A', 'B', 'C'] as const).map((k) => ({
          label: `Curva ${k} (${abcN(k)} itens)`,
          value: abcRev(k),
        })),
      },
    ],
    tables: [
      {
        id: 'engenharia',
        title: 'Engenharia de cardápio',
        columns: [
          { key: 'name', label: 'Produto', fmt: 'text', width: 28 },
          { key: 'family', label: 'Família', fmt: 'text', width: 16 },
          { key: 'cls', label: 'Classe', fmt: 'text', width: 24 },
          { key: 'abc', label: 'ABC', fmt: 'text', width: 6 },
          { key: 'qty', label: 'Quantidade', fmt: 'num' },
          { key: 'mix', label: '% do mix', fmt: 'pct' },
          { key: 'revenue', label: 'Vendido', fmt: 'money' },
          { key: 'unitMargin', label: 'Lucro por unidade', fmt: 'money' },
          { key: 'margin', label: 'Lucro total', fmt: 'money' },
          { key: 'acc', label: '% acumulado', fmt: 'pct' },
          { key: 'action', label: 'O que fazer', fmt: 'text', width: 46 },
        ],
        rows: table,
        bar: 'revenue',
      },
      {
        id: 'familias',
        title: 'Por família',
        columns: [
          { key: 'family', label: 'Família', fmt: 'text', width: 22 },
          { key: 'star', label: 'Carro-chefe', fmt: 'int' },
          { key: 'plowhorse', label: 'Popular margem baixa', fmt: 'int' },
          { key: 'puzzle', label: 'Rentável vende pouco', fmt: 'int' },
          { key: 'dog', label: 'Candidato a sair', fmt: 'int' },
          { key: 'none', label: 'Sem ficha', fmt: 'int' },
          { key: 'revenue', label: 'Vendido', fmt: 'money' },
        ],
        rows: [...fams.values()].sort((a, b) => (b.revenue as number) - (a.revenue as number)),
        bar: 'revenue',
      },
    ],
    notes: [
      'Popular = vende pelo menos 70% da média de unidades por produto. Lucro bom = lucro por unidade igual ou acima da média do cardápio.',
      'Curva ABC: A são os itens que somam os primeiros 80% do faturamento, B até 95% e C o restante.',
      'Só entram na matriz produtos com ficha técnica (sem custo não há como medir lucro).',
    ],
  };
}

/* ======================= Pedidos por hora ======================= */

export async function horarios(p: Period): Promise<Built> {
  const rows = await q(
    p.tx,
    `SELECT extract(hour FROM o.created_at AT TIME ZONE $3)::int AS hour, o.channel,
            count(*)::int AS orders, sum(o.total)::text AS revenue
       FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} GROUP BY 1, 2`,
    [p.a, p.b, p.tz],
  );
  const heat = await q(
    p.tx,
    `SELECT extract(dow FROM o.created_at AT TIME ZONE $3)::int AS dow,
            extract(hour FROM o.created_at AT TIME ZONE $3)::int AS hour, count(*)::int AS orders
       FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} GROUP BY 1, 2`,
    [p.a, p.b, p.tz],
  );
  const hours = rows.length
    ? Array.from(
        {
          length:
            Math.max(...rows.map((r) => n(r.hour))) - Math.min(...rows.map((r) => n(r.hour))) + 1,
        },
        (_, i) => Math.min(...rows.map((r) => n(r.hour))) + i,
      )
    : [];
  const channels = ['counter', 'table', 'delivery', 'pickup'] as const;
  const table = hours.map((h) => {
    const hs = rows.filter((r) => n(r.hour) === h);
    const by = (c: string) => n(hs.find((r) => r.channel === c)?.orders);
    const orders = sum(hs, (r) => n(r.orders));
    return {
      hour: `${String(h).padStart(2, '0')}h`,
      counter: by('counter'),
      table: by('table'),
      delivery: by('delivery'),
      pickup: by('pickup'),
      orders,
      perDay: r1(orders / p.days),
      revenue: sum(hs, (r) => n(r.revenue)),
    };
  });
  const total = sum(table, (r) => r.orders);
  const peak = [...table].sort((a, b) => b.orders - a.orders)[0];
  const byDow = [0, 1, 2, 3, 4, 5, 6].map((d) =>
    sum(
      heat.filter((h) => n(h.dow) === d),
      (h) => n(h.orders),
    ),
  );
  const order = [1, 2, 3, 4, 5, 6, 0];
  const bestDow = order.reduce((b, d) => (byDow[d]! > byDow[b]! ? d : b), order[0]!);
  const used = channels.filter((c) => table.some((r) => r[c] > 0));
  return {
    kpis: [
      {
        label: 'Horário de pico',
        value: peak?.hour ?? '—',
        fmt: 'text',
        main: true,
        hint: peak ? `${peak.orders} pedidos no período` : undefined,
      },
      {
        label: 'Dia mais movimentado',
        value: total ? WEEKDAYS[bestDow]! : '—',
        fmt: 'text',
        hint: total ? `${byDow[bestDow]} pedidos` : undefined,
      },
      { label: 'Pedidos por dia', value: r1(total / p.days), fmt: 'num' },
      { label: 'Pedidos no período', value: total, fmt: 'int' },
    ],
    charts: [
      {
        kind: 'columns',
        title: 'Pedidos por hora',
        fmt: 'int',
        points: table.map((r) => ({
          label: r.hour,
          value: r.orders,
          hint: `${r.perDay.toLocaleString('pt-BR')} por dia`,
        })),
        wide: true,
      },
      {
        kind: 'heat',
        title: 'Mapa da semana (pedidos por dia e hora)',
        fmt: 'int',
        rows: order.map((d) => WEEKDAYS_SHORT[d]!),
        cols: hours.map((h) => `${h}h`),
        values: order.map((d) =>
          hours.map((h) => n(heat.find((x) => n(x.dow) === d && n(x.hour) === h)?.orders)),
        ),
        wide: true,
      },
      {
        kind: 'donut',
        title: 'Por tipo de venda',
        fmt: 'int',
        points: used.map((c) => ({ label: ch(c), value: sum(table, (r) => r[c]) })),
      },
    ],
    tables: [
      {
        id: 'horas',
        title: 'Por hora e tipo de venda',
        columns: [
          { key: 'hour', label: 'Hora', fmt: 'text', width: 8 },
          ...used.map((c) => ({ key: c, label: ch(c), fmt: 'int' as const })),
          { key: 'orders', label: 'Total', fmt: 'int' },
          { key: 'perDay', label: 'Média por dia', fmt: 'num' },
          { key: 'revenue', label: 'Vendido', fmt: 'money' },
        ],
        rows: table,
        total: {
          hour: 'Total',
          ...Object.fromEntries(used.map((c) => [c, sum(table, (r) => r[c])])),
          orders: total,
          perDay: r1(total / p.days),
          revenue: sum(table, (r) => r.revenue),
        },
        bar: 'orders',
      },
    ],
    notes: [
      'Use o mapa da semana para montar a escala: as células mais fortes são os horários que pedem mais gente.',
    ],
  };
}

/* ======================= Vendas por funcionário ======================= */

export async function equipe(p: Period): Promise<Built> {
  const rows = await q(
    p.tx,
    `SELECT o.created_by AS uid, COALESCE(u.name, CASE WHEN o.created_by IS NULL THEN 'Cardápio online' ELSE 'Usuário removido' END) AS name,
            max(m.role) AS role,
            count(*) FILTER (WHERE ${SOLD})::int AS orders,
            COALESCE(sum(o.total) FILTER (WHERE ${SOLD}), 0)::text AS revenue,
            COALESCE(sum(o.surcharge) FILTER (WHERE ${SOLD}), 0)::text AS service,
            COALESCE(sum(o.discount) FILTER (WHERE ${SOLD}), 0)::text AS discount,
            count(DISTINCT o.tab_id) FILTER (WHERE ${SOLD})::int AS tabs,
            count(*) FILTER (WHERE ${SOLD} AND o.tab_id IS NULL)::int AS loose,
            count(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
            COALESCE(sum(o.total) FILTER (WHERE o.status = 'cancelled'), 0)::text AS cancelled_value
       FROM orders o LEFT JOIN users u ON u.id = o.created_by
       LEFT JOIN memberships m ON m.user_id = o.created_by
      WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'awaiting'
      GROUP BY 1, 2 ORDER BY sum(o.total) FILTER (WHERE ${SOLD}) DESC NULLS LAST`,
    [p.a, p.b],
  );
  const closed = await q(
    p.tx,
    `SELECT closed_by AS uid, count(*)::int AS n FROM tabs WHERE status = 'closed' AND closed_at >= $1 AND closed_at < $2 GROUP BY 1`,
    [p.a, p.b],
  );
  const closedBy = new Map(closed.map((c) => [String(c.uid), n(c.n)]));
  const out = rows.map((r) => {
    const orders = n(r.orders);
    const revenue = n(r.revenue);
    const accounts = n(r.tabs) + n(r.loose);
    return {
      name: String(r.name),
      role: r.role ? (ROLE_LABELS[r.role as Role] ?? String(r.role)) : r.uid ? '—' : 'Cliente',
      orders,
      accounts,
      closed: r.uid ? (closedBy.get(String(r.uid)) ?? 0) : 0,
      revenue,
      ticket: accounts ? r2(revenue / accounts) : 0,
      service: n(r.service),
      discount: n(r.discount),
      cancelled: n(r.cancelled),
      cancelledValue: n(r.cancelled_value),
    };
  });
  const total = sum(out, (r) => r.revenue);
  return {
    kpis: [
      { label: 'Vendido pela equipe', value: total, fmt: 'money', main: true },
      {
        label: 'Quem mais vendeu',
        value: out[0]?.name ?? '—',
        fmt: 'text',
        hint: out[0] ? brl(out[0].revenue) : undefined,
      },
      { label: 'Taxa de serviço', value: sum(out, (r) => r.service), fmt: 'money' },
      {
        label: 'Cancelamentos',
        value: sum(out, (r) => r.cancelled),
        fmt: 'int',
        invert: true,
        hint: brl(sum(out, (r) => r.cancelledValue)),
      },
    ],
    charts: [
      {
        kind: 'bars',
        title: 'Consumo lançado por pessoa',
        fmt: 'money',
        points: out
          .filter((r) => r.revenue > 0)
          .map((r) => ({ label: r.name, value: r.revenue, hint: `${r.orders} pedidos` })),
      },
      {
        kind: 'bars',
        title: 'Taxa de serviço por pessoa',
        fmt: 'money',
        points: out.filter((r) => r.service > 0).map((r) => ({ label: r.name, value: r.service })),
      },
    ],
    tables: [
      {
        id: 'equipe',
        title: 'Por funcionário',
        columns: [
          { key: 'name', label: 'Funcionário', fmt: 'text', width: 24 },
          { key: 'role', label: 'Função', fmt: 'text', width: 14 },
          { key: 'orders', label: 'Pedidos', fmt: 'int' },
          { key: 'accounts', label: 'Contas', fmt: 'int' },
          { key: 'closed', label: 'Contas fechadas', fmt: 'int' },
          { key: 'revenue', label: 'Consumo', fmt: 'money' },
          { key: 'ticket', label: 'Ticket por conta', fmt: 'money' },
          { key: 'service', label: 'Taxa de serviço', fmt: 'money' },
          { key: 'discount', label: 'Descontos', fmt: 'money' },
          { key: 'cancelled', label: 'Cancelamentos', fmt: 'int' },
          { key: 'cancelledValue', label: 'Valor cancelado', fmt: 'money' },
        ],
        rows: out,
        total: {
          name: 'Total',
          orders: sum(out, (r) => r.orders),
          accounts: sum(out, (r) => r.accounts),
          closed: sum(out, (r) => r.closed),
          revenue: total,
          service: sum(out, (r) => r.service),
          discount: sum(out, (r) => r.discount),
          cancelled: sum(out, (r) => r.cancelled),
          cancelledValue: sum(out, (r) => r.cancelledValue),
        },
        bar: 'revenue',
      },
    ],
    notes: [
      'Cada pedido conta para quem o lançou. Conta = comanda/mesa atendida (no balcão e delivery, cada pedido é uma conta). Contas fechadas = comandas que a pessoa fechou no caixa.',
    ],
  };
}

/* ======================= Delivery: bairros, motoboys e frete ======================= */

async function deliveryOrders(p: Period, from: Date, to: Date) {
  return q(
    p.tx,
    `SELECT o.id, o.number, ${localTs('o.created_at', '$3')} AS at, o.total::text AS total, o.delivery_fee::text AS fee,
            o.delivery_address AS address, o.delivery_lat::float AS lat, o.delivery_lng::float AS lng,
            COALESCE(NULLIF(o.customer_name, ''), '') AS customer, c.name AS courier
       FROM orders o
       LEFT JOIN LATERAL (SELECT cr.name FROM deliveries d JOIN couriers cr ON cr.id = d.courier_id
                           WHERE d.order_id = o.id ORDER BY d.dispatched_at DESC LIMIT 1) c ON true
      WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} AND o.channel = 'delivery'
      ORDER BY o.created_at LIMIT 10000`,
    [from, to, p.tz],
  );
}

async function zones(p: Period): Promise<Zone[]> {
  return q<Zone & Record<string, unknown>>(
    p.tx,
    `SELECT id, name, color, kind, polygon, center_lat::text AS "centerLat", center_lng::text AS "centerLng",
            radius_m AS "radiusM", fee::text AS fee, min_order::text AS "minOrder", eta_min AS "etaMin",
            eta_max AS "etaMax", active, position FROM delivery_zones ORDER BY position`,
  );
}

export async function bairros(p: Period): Promise<Built> {
  const [orders, zs] = await serial(
    () => deliveryOrders(p, p.a, p.b),
    () => zones(p),
  );
  const byDistrict = new Map<
    string,
    { district: string; orders: number; revenue: number; fees: number }
  >();
  const byZone = new Map<
    string,
    { zone: string; fee: number; orders: number; revenue: number; fees: number }
  >();
  for (const z of zs.filter((z) => z.active))
    byZone.set(z.id, { zone: z.name, fee: n(z.fee), orders: 0, revenue: 0, fees: 0 });
  let outside = 0;
  for (const o of orders) {
    const d = districtOf(o.address as string) ?? 'Não identificado';
    const g = byDistrict.get(d) ?? { district: d, orders: 0, revenue: 0, fees: 0 };
    g.orders++;
    g.revenue = r2(g.revenue + n(o.total));
    g.fees = r2(g.fees + n(o.fee));
    byDistrict.set(d, g);
    if (o.lat !== null && o.lng !== null) {
      const z = findZone(zs, [n(o.lat), n(o.lng)]);
      if (z) {
        const x = byZone.get(z.id)!;
        x.orders++;
        x.revenue = r2(x.revenue + n(o.total));
        x.fees = r2(x.fees + n(o.fee));
      } else outside++;
    }
  }
  const districts = [...byDistrict.values()]
    .map((d) => ({ ...d, ticket: d.orders ? r2(d.revenue / d.orders) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = sum(districts, (d) => d.revenue);
  // Bairros dos clientes cadastrados que não pediram delivery no período.
  const known = await q(
    p.tx,
    `SELECT district, count(DISTINCT customer_id)::int AS customers FROM customer_addresses GROUP BY 1`,
  );
  const sold = new Set(districts.map((d) => d.district.toLowerCase()));
  const missing = new Map<string, number>();
  for (const k of known) {
    const d = districtOf(` — ${String(k.district)}`) ?? String(k.district);
    if (!sold.has(d.toLowerCase())) missing.set(d, (missing.get(d) ?? 0) + n(k.customers));
  }
  const noSales = [...missing]
    .map(([district, customers]) => ({ district, customers }))
    .sort((a, b) => b.customers - a.customers);
  const zonesList = [...byZone.values()].sort((a, b) => b.revenue - a.revenue);
  const prev = await one(
    p.tx,
    `SELECT count(*)::int AS n, COALESCE(sum(o.total), 0)::text AS v FROM orders o
      WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} AND o.channel = 'delivery'`,
    [p.pa, p.a],
  );
  const named = districts.filter((d) => d.district !== 'Não identificado');
  return {
    kpis: [
      { label: 'Vendido no delivery', value: total, fmt: 'money', prev: n(prev!.v), main: true },
      { label: 'Pedidos de delivery', value: orders.length, fmt: 'int', prev: n(prev!.n) },
      { label: 'Bairros atendidos', value: named.length, fmt: 'int' },
      {
        label: 'Bairro que mais compra',
        value: named[0]?.district ?? '—',
        fmt: 'text',
        hint: named[0] ? brl(named[0].revenue) : undefined,
      },
      {
        label: 'Áreas sem pedido',
        value: zonesList.filter((z) => z.orders === 0).length,
        fmt: 'int',
        hint: `de ${zonesList.length} áreas de entrega`,
      },
    ],
    charts: [
      {
        kind: 'bars',
        title: 'Vendido por bairro',
        fmt: 'money',
        points: districts
          .slice(0, 15)
          .map((d) => ({ label: d.district, value: d.revenue, hint: `${d.orders} pedidos` })),
        wide: true,
      },
      ...(zonesList.length
        ? [
            {
              kind: 'bars' as const,
              title: 'Pedidos por área de entrega',
              fmt: 'int' as const,
              points: zonesList.map((z) => ({ label: z.zone, value: z.orders })),
            },
          ]
        : []),
    ],
    tables: [
      {
        id: 'bairros',
        title: 'Por bairro',
        columns: [
          { key: 'district', label: 'Bairro', fmt: 'text', width: 26 },
          { key: 'orders', label: 'Pedidos', fmt: 'int' },
          { key: 'revenue', label: 'Vendido', fmt: 'money' },
          { key: 'share', label: '% do delivery', fmt: 'pct' },
          { key: 'ticket', label: 'Ticket médio', fmt: 'money' },
          { key: 'fees', label: 'Frete', fmt: 'money' },
        ],
        rows: districts.map((d) => ({ ...d, share: pct(d.revenue, total) })),
        total: {
          district: 'Total',
          orders: orders.length,
          revenue: total,
          share: 100,
          fees: sum(districts, (d) => d.fees),
        },
        bar: 'revenue',
      },
      {
        id: 'areas',
        title: 'Por área de entrega',
        hint: outside
          ? `${outside} pedidos com localização ficaram fora das áreas desenhadas.`
          : undefined,
        columns: [
          { key: 'zone', label: 'Área', fmt: 'text', width: 24 },
          { key: 'fee', label: 'Taxa da área', fmt: 'money' },
          { key: 'orders', label: 'Pedidos', fmt: 'int' },
          { key: 'revenue', label: 'Vendido', fmt: 'money' },
          { key: 'fees', label: 'Frete arrecadado', fmt: 'money' },
        ],
        rows: zonesList,
        bar: 'orders',
      },
      {
        id: 'sem-venda',
        title: 'Bairros sem venda',
        hint: 'Bairros dos endereços de clientes cadastrados que não tiveram nenhum delivery no período.',
        columns: [
          { key: 'district', label: 'Bairro', fmt: 'text', width: 26 },
          { key: 'customers', label: 'Clientes cadastrados', fmt: 'int' },
        ],
        rows: noSales,
      },
    ],
    notes: [
      'O bairro sai do endereço do pedido (no cardápio online ele é obrigatório). No PDV, escreva o endereço como "Rua, número - Bairro" para o bairro ser reconhecido.',
      'A área de entrega usa a localização do pedido no mapa (pedidos sem localização não entram nessa tabela).',
    ],
  };
}

export async function motoboys(p: Period): Promise<Built> {
  const rows = await q(
    p.tx,
    `SELECT cr.name AS courier, ${localDay('d.dispatched_at', '$3')} AS day, d.status,
            o.delivery_fee::text AS fee, COALESCE(d.courier_pay, 0)::text AS pay, COALESCE(d.distance_m, 0) AS dist,
            CASE WHEN d.finished_at IS NOT NULL THEN extract(epoch FROM d.finished_at - d.dispatched_at) / 60 END AS minutes
       FROM deliveries d JOIN couriers cr ON cr.id = d.courier_id JOIN orders o ON o.id = d.order_id
      WHERE d.dispatched_at >= $1 AND d.dispatched_at < $2`,
    [p.a, p.b, p.tz],
  );
  const prev = await one(
    p.tx,
    `SELECT count(*) FILTER (WHERE status = 'delivered')::int AS n FROM deliveries WHERE dispatched_at >= $1 AND dispatched_at < $2`,
    [p.pa, p.a],
  );
  type Agg = {
    delivered: number;
    failed: number;
    out: number;
    fees: number;
    pay: number;
    km: number;
    mins: number[];
  };
  const blank = (): Agg => ({ delivered: 0, failed: 0, out: 0, fees: 0, pay: 0, km: 0, mins: [] });
  const add = (a: Agg, r: Record<string, unknown>) => {
    if (r.status === 'delivered') {
      a.delivered++;
      a.fees = r2(a.fees + n(r.fee));
      if (r.minutes !== null && n(r.minutes) > 0 && n(r.minutes) < 360) a.mins.push(n(r.minutes));
    } else if (r.status === 'failed') a.failed++;
    else a.out++;
    a.pay = r2(a.pay + n(r.pay));
    a.km = r2(a.km + n(r.dist) / 1000);
  };
  const byCourier = new Map<string, Agg>();
  const byDay = new Map<string, Agg>();
  const byBoth = new Map<string, Agg>();
  for (const r of rows) {
    const c = String(r.courier);
    const d = String(r.day);
    for (const [m, k] of [
      [byCourier, c],
      [byDay, d],
      [byBoth, `${d}|${c}`],
    ] as const) {
      if (!m.has(k)) m.set(k, blank());
      add(m.get(k)!, r);
    }
  }
  const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  const view = (a: Agg) => ({
    delivered: a.delivered,
    failed: a.failed,
    fees: a.fees,
    pay: a.pay,
    km: r1(a.km),
    minutes: avg(a.mins),
  });
  const couriers = [...byCourier]
    .map(([courier, a]) => ({ courier, ...view(a) }))
    .sort((x, y) => y.delivered - x.delivered);
  const days = dayList(p.from, p.days).map((d) => ({ day: d, ...view(byDay.get(d) ?? blank()) }));
  const both = [...byBoth]
    .map(([k, a]) => ({ day: k.split('|')[0]!, courier: k.split('|')[1]!, ...view(a) }))
    .sort((x, y) => x.day.localeCompare(y.day) || x.courier.localeCompare(y.courier));
  const all = [...byCourier.values()].reduce((s, a) => s.concat(a.mins), [] as number[]);
  const cols = [
    { key: 'delivered', label: 'Entregas', fmt: 'int' as const },
    { key: 'failed', label: 'Não entregues', fmt: 'int' as const },
    { key: 'fees', label: 'Frete cobrado', fmt: 'money' as const },
    { key: 'pay', label: 'Ganho do motoboy', fmt: 'money' as const },
    { key: 'km', label: 'Km rodados', fmt: 'num' as const },
    { key: 'minutes', label: 'Tempo médio', fmt: 'min' as const },
  ];
  const totals = {
    delivered: sum(couriers, (c) => c.delivered),
    failed: sum(couriers, (c) => c.failed),
    fees: sum(couriers, (c) => c.fees),
    pay: sum(couriers, (c) => c.pay),
    km: sum(couriers, (c) => c.km),
    minutes: avg(all),
  };
  return {
    kpis: [
      { label: 'Entregas', value: totals.delivered, fmt: 'int', prev: n(prev!.n), main: true },
      { label: 'Frete cobrado', value: totals.fees, fmt: 'money' },
      {
        label: 'Ganho dos motoboys',
        value: totals.pay,
        fmt: 'money',
        hint: 'Pela regra de repasse de cada um',
      },
      {
        label: 'Tempo médio de entrega',
        value: totals.minutes,
        fmt: 'min',
        invert: true,
        hint: 'Da saída até a entrega',
      },
      { label: 'Não entregues', value: totals.failed, fmt: 'int', invert: true },
    ],
    charts: [
      {
        kind: 'bars',
        title: 'Entregas por motoboy',
        fmt: 'int',
        points: couriers.map((c) => ({ label: c.courier, value: c.delivered, hint: brl(c.fees) })),
      },
      {
        kind: 'columns',
        title: 'Entregas por dia',
        fmt: 'int',
        points: days.map((d) => ({ label: dm(d.day), value: d.delivered })),
        wide: true,
      },
    ],
    tables: [
      {
        id: 'motoboys',
        title: 'Por motoboy',
        columns: [{ key: 'courier', label: 'Motoboy', fmt: 'text', width: 22 }, ...cols],
        rows: couriers,
        total: { courier: 'Total', ...totals },
        bar: 'delivered',
      },
      {
        id: 'dias',
        title: 'Por dia',
        columns: [{ key: 'day', label: 'Data', fmt: 'date' }, ...cols],
        rows: days,
        total: { day: 'Total', ...totals },
        bar: 'delivered',
      },
      {
        id: 'dia-motoboy',
        title: 'Por dia e motoboy',
        columns: [
          { key: 'day', label: 'Data', fmt: 'date' },
          { key: 'courier', label: 'Motoboy', fmt: 'text', width: 22 },
          ...cols,
        ],
        rows: both,
      },
    ],
    notes: [
      'Conta as corridas que saíram no período. Frete cobrado = taxa de entrega dos pedidos entregues.',
    ],
  };
}

export async function frete(p: Period): Promise<Built> {
  const [orders, prevOrders] = await serial(
    () => deliveryOrders(p, p.a, p.b),
    () => deliveryOrders(p, p.pa, p.a),
  );
  const withFee = orders.filter((o) => n(o.fee) > 0);
  const prevFee = prevOrders.filter((o) => n(o.fee) > 0);
  const allRev = await one(
    p.tx,
    `SELECT COALESCE(sum(o.total), 0)::text AS v FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD}`,
    [p.a, p.b],
  );
  const fees = sum(withFee, (o) => n(o.fee));
  const prevFees = sum(prevFee, (o) => n(o.fee));
  const byDay = (xs: typeof orders) => {
    const m = new Map<string, number>();
    for (const o of xs)
      m.set(String(o.at).slice(0, 10), r2((m.get(String(o.at).slice(0, 10)) ?? 0) + n(o.fee)));
    return m;
  };
  const byDistrict = new Map<string, number>();
  for (const o of withFee) {
    const d = districtOf(o.address as string) ?? 'Não identificado';
    byDistrict.set(d, r2((byDistrict.get(d) ?? 0) + n(o.fee)));
  }
  const list = withFee.map((o) => ({
    number: n(o.number),
    at: String(o.at),
    customer: String(o.customer),
    district: districtOf(o.address as string) ?? '',
    courier: String(o.courier ?? ''),
    fee: n(o.fee),
    total: n(o.total),
  }));
  return {
    kpis: [
      { label: 'Frete arrecadado', value: fees, fmt: 'money', prev: prevFees, main: true },
      {
        label: 'Contas com taxa de entrega',
        value: withFee.length,
        fmt: 'int',
        prev: prevFee.length,
      },
      {
        label: 'Frete médio',
        value: withFee.length ? r2(fees / withFee.length) : 0,
        fmt: 'money',
        prev: prevFee.length ? r2(prevFees / prevFee.length) : null,
      },
      { label: '% do vendido', value: pct(fees, n(allRev!.v)), fmt: 'pct' },
      {
        label: 'Entregas sem taxa',
        value: orders.length - withFee.length,
        fmt: 'int',
        hint: 'Frete grátis ou taxa zerada',
      },
    ],
    charts: [
      {
        kind: 'line',
        title: 'Frete por dia',
        fmt: 'money',
        series: ['Este período', 'Período anterior'],
        points: dailySeries(p, byDay(withFee), byDay(prevFee)),
        wide: true,
      },
      {
        kind: 'bars',
        title: 'Frete por bairro',
        fmt: 'money',
        points: [...byDistrict]
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 15),
      },
    ],
    tables: [
      {
        id: 'frete',
        title: 'Contas com taxa de entrega',
        columns: [
          { key: 'number', label: 'Pedido', fmt: 'int', width: 9 },
          { key: 'at', label: 'Data/hora', fmt: 'datetime' },
          { key: 'customer', label: 'Cliente', fmt: 'text', width: 22 },
          { key: 'district', label: 'Bairro', fmt: 'text', width: 20 },
          { key: 'courier', label: 'Motoboy', fmt: 'text', width: 18 },
          { key: 'fee', label: 'Frete', fmt: 'money' },
          { key: 'total', label: 'Total da conta', fmt: 'money' },
        ],
        rows: list,
        total: { number: null, fee: fees, total: sum(list, (o) => o.total) },
        bar: 'fee',
      },
    ],
    notes: [],
  };
}

/* ======================= Clientes ======================= */

export async function clientes(p: Period): Promise<Built> {
  const stats = (from: Date, to: Date) =>
    one(
      p.tx,
      `WITH cur AS (
         SELECT ${CUSTOMER_KEY} AS k, sum(o.total) AS v FROM orders o
          WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} AND ${CUSTOMER_KEY} IS NOT NULL GROUP BY 1),
       firsts AS (
         SELECT ${CUSTOMER_KEY} AS k, min(o.created_at) AS f FROM orders o
          WHERE ${SOLD} AND ${CUSTOMER_KEY} IN (SELECT k FROM cur) GROUP BY 1)
       SELECT count(*)::int AS identified, count(*) FILTER (WHERE firsts.f >= $1)::int AS "new",
              COALESCE(sum(cur.v), 0)::text AS revenue,
              COALESCE(sum(cur.v) FILTER (WHERE firsts.f >= $1), 0)::text AS "newRevenue",
              (SELECT COALESCE(sum(o.total), 0) FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD})::text AS "all"
         FROM cur JOIN firsts ON firsts.k = cur.k`,
      [from, to],
    );
  const [cur, prev] = await serial(
    () => stats(p.a, p.b),
    () => stats(p.pa, p.a),
  );
  const top = await q(
    p.tx,
    `WITH life AS (
       SELECT ${CUSTOMER_KEY} AS k, min(o.created_at) AS first, max(o.created_at) AS last FROM orders o
        WHERE ${SOLD} AND ${CUSTOMER_KEY} IS NOT NULL GROUP BY 1)
     SELECT ${CUSTOMER_KEY} AS k, max(COALESCE(NULLIF(o.customer_name, ''), c.name, '')) AS name,
            max(COALESCE(c.phone, regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g'))) AS phone,
            count(*)::int AS orders, sum(o.total)::text AS revenue,
            ${localDay('max(life.first)', '$3')} AS first, ${localDay('max(o.created_at)', '$3')} AS last,
            bool_or(life.first >= $1) AS is_new
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       JOIN life ON life.k = ${CUSTOMER_KEY}
      WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD}
      GROUP BY 1 ORDER BY sum(o.total) DESC LIMIT 200`,
    [p.a, p.b, p.tz],
  );
  // Parou de comprar: comprou 2+ vezes antes, a última foi nos 6 meses antes do período e não voltou.
  const stopped = await q(
    p.tx,
    `WITH hist AS (
       SELECT ${CUSTOMER_KEY} AS k, max(COALESCE(NULLIF(o.customer_name, ''), c.name, '')) AS name,
              max(COALESCE(c.phone, regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g'))) AS phone,
              count(*)::int AS orders, sum(o.total) AS revenue, max(o.created_at) AS last
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE ${SOLD} AND ${CUSTOMER_KEY} IS NOT NULL AND o.created_at < $1
        GROUP BY 1
       HAVING count(*) >= 2 AND max(o.created_at) >= $1::timestamptz - interval '180 days'),
     back AS (
       SELECT DISTINCT ${CUSTOMER_KEY} AS k FROM orders o WHERE o.created_at >= $1 AND ${SOLD})
     SELECT h.name, h.phone, h.orders, h.revenue::text AS revenue, ${localDay('h.last', '$3')} AS last,
            floor(extract(epoch FROM $2::timestamptz - h.last) / 86400)::int AS idle
       FROM hist h WHERE h.k NOT IN (SELECT k FROM back WHERE k IS NOT NULL)
      ORDER BY h.revenue DESC LIMIT 200`,
    [p.a, p.b, p.tz],
  );
  const newDaily = await q(
    p.tx,
    `WITH firsts AS (SELECT ${CUSTOMER_KEY} AS k, min(o.created_at) AS f FROM orders o
                      WHERE ${SOLD} AND ${CUSTOMER_KEY} IS NOT NULL GROUP BY 1)
     SELECT ${localDay('f', '$3')} AS day, count(*)::int AS n FROM firsts WHERE f >= $1 AND f < $2 GROUP BY 1`,
    [p.pa, p.b, p.tz],
  );
  const phoneFmt = (s: unknown) => {
    const d = String(s ?? '')
      .replace(/\D/g, '')
      .replace(/^55(?=\d{10,11}$)/, '');
    return d.length === 11
      ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
      : d.length === 10
        ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
        : d;
  };
  const identified = n(cur!.identified);
  const fresh = n(cur!.new);
  const nd = new Map(newDaily.map((r) => [String(r.day), n(r.n)]));
  return {
    kpis: [
      {
        label: 'Clientes que compraram',
        value: identified,
        fmt: 'int',
        prev: n(prev!.identified),
        main: true,
      },
      {
        label: 'Novos',
        value: fresh,
        fmt: 'int',
        prev: n(prev!.new),
        hint: 'Primeira compra no período',
      },
      {
        label: 'Voltaram',
        value: identified - fresh,
        fmt: 'int',
        prev: n(prev!.identified) - n(prev!.new),
        hint: 'Já tinham comprado antes',
      },
      {
        label: 'Vendas identificadas',
        value: pct(n(cur!.revenue), n(cur!.all)),
        fmt: 'pct',
        hint: 'Do vendido com nome/telefone do cliente',
      },
      {
        label: 'Pararam de comprar',
        value: stopped.length,
        fmt: 'int',
        invert: true,
        hint: 'Compravam e sumiram',
      },
    ],
    charts: [
      {
        kind: 'donut',
        title: 'Vendido: clientes novos × que voltaram',
        fmt: 'money',
        points: [
          { label: 'Novos', value: n(cur!.newRevenue) },
          { label: 'Voltaram', value: r2(n(cur!.revenue) - n(cur!.newRevenue)) },
        ].filter((x) => x.value > 0),
      },
      {
        kind: 'line',
        title: 'Clientes novos por dia',
        fmt: 'int',
        series: ['Este período', 'Período anterior'],
        points: dailySeries(p, nd, nd),
        wide: true,
      },
      {
        kind: 'bars',
        title: 'Quem mais compra',
        fmt: 'money',
        points: top.slice(0, 10).map((t) => ({
          label: String(t.name) || phoneFmt(t.phone) || 'Cliente',
          value: n(t.revenue),
          hint: `${t.orders} pedidos`,
        })),
      },
    ],
    tables: [
      {
        id: 'top',
        title: 'Quem mais compra',
        columns: [
          { key: 'name', label: 'Cliente', fmt: 'text', width: 26 },
          { key: 'phone', label: 'Telefone', fmt: 'text', width: 16 },
          { key: 'orders', label: 'Pedidos', fmt: 'int' },
          { key: 'revenue', label: 'Gastou', fmt: 'money' },
          { key: 'ticket', label: 'Ticket médio', fmt: 'money' },
          { key: 'first', label: 'Primeira compra', fmt: 'date' },
          { key: 'last', label: 'Última compra', fmt: 'date' },
          { key: 'status', label: 'Situação', fmt: 'text', width: 12 },
        ],
        rows: top.map((t) => ({
          name: String(t.name) || '—',
          phone: phoneFmt(t.phone),
          orders: n(t.orders),
          revenue: n(t.revenue),
          ticket: n(t.orders) ? r2(n(t.revenue) / n(t.orders)) : 0,
          first: String(t.first),
          last: String(t.last),
          status: t.is_new ? 'Novo' : 'Voltou',
        })),
        bar: 'revenue',
        truncated: top.length >= 200,
      },
      {
        id: 'pararam',
        title: 'Pararam de comprar',
        hint: 'Compraram pelo menos 2 vezes, a última nos 6 meses antes do período, e não voltaram. Bom público para uma mensagem ou cupom.',
        columns: [
          { key: 'name', label: 'Cliente', fmt: 'text', width: 26 },
          { key: 'phone', label: 'Telefone', fmt: 'text', width: 16 },
          { key: 'orders', label: 'Pedidos', fmt: 'int' },
          { key: 'revenue', label: 'Gastou', fmt: 'money' },
          { key: 'last', label: 'Última compra', fmt: 'date' },
          { key: 'idle', label: 'Dias sem comprar', fmt: 'int' },
        ],
        rows: stopped.map((s) => ({
          name: String(s.name) || '—',
          phone: phoneFmt(s.phone),
          orders: n(s.orders),
          revenue: n(s.revenue),
          last: String(s.last),
          idle: n(s.idle),
        })),
        bar: 'revenue',
      },
    ],
    notes: [
      'Cliente identificado = pedido com conta no cardápio online ou com telefone. Pedidos sem telefone não entram aqui.',
    ],
  };
}
