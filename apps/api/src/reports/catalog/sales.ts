import {
  CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type OrderChannel,
  type OrderStatus,
  type PaymentMethod,
} from '@comandou/shared';
import {
  type Built,
  dailySeries,
  dayList,
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
  WEEKDAYS,
  weekday,
} from './kit';

/** Custo dos insumos de um pedido pela ficha técnica (produto + opções), itens não cancelados. */
const ORDER_COST = `(SELECT COALESCE(sum(i.quantity * (
    COALESCE((SELECT sum(pr.quantity * si.avg_cost) FROM product_recipes pr
               JOIN stock_items si ON si.id = pr.stock_item_id WHERE pr.product_id = i.product_id), 0)
  + COALESCE((SELECT sum(orc.quantity * si.avg_cost) FROM order_item_options oio
               JOIN option_recipes orc ON orc.option_id = oio.option_id
               JOIN stock_items si ON si.id = orc.stock_item_id WHERE oio.order_item_id = i.id), 0))), 0)
   FROM order_items i WHERE i.order_id = o.id AND i.status <> 'cancelled')`;

const ch = (c: string) => CHANNEL_LABELS[c as OrderChannel] ?? c;
const pm = (m: string) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;
const LIMIT = 5000;

interface Totals {
  orders: number;
  revenue: number;
  discounts: number;
  service: number;
  fees: number;
  cost: number;
  open: number;
  received: number;
}

async function totals(p: Period, from: Date, to: Date): Promise<Totals> {
  const t = await one(
    p.tx,
    `SELECT count(*)::int AS orders, COALESCE(sum(o.total), 0)::text AS revenue,
            COALESCE(sum(o.discount), 0)::text AS discounts, COALESCE(sum(o.surcharge), 0)::text AS service,
            COALESCE(sum(o.delivery_fee), 0)::text AS fees, COALESCE(round(sum(${ORDER_COST}), 2), 0)::text AS cost,
            COALESCE(sum(o.total - o.paid_amount) FILTER (WHERE o.paid_amount < o.total), 0)::text AS open
       FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD}`,
    [from, to],
  );
  const rec = await one(
    p.tx,
    `SELECT COALESCE(sum(amount), 0)::text AS net FROM cash_movements
      WHERE kind IN ('sale','refund') AND created_at >= $1 AND created_at < $2`,
    [from, to],
  );
  return {
    orders: n(t!.orders),
    revenue: n(t!.revenue),
    discounts: n(t!.discounts),
    service: n(t!.service),
    fees: n(t!.fees),
    cost: n(t!.cost),
    open: n(t!.open),
    received: n(rec!.net),
  };
}

const profit = (t: Totals) => r2(t.revenue - t.fees - t.cost);
const ticketOf = (t: Totals) => (t.orders ? r2(t.revenue / t.orders) : 0);
const varPct = (cur: number, prev: number) =>
  prev ? r1(((cur - prev) / Math.abs(prev)) * 100) : null;

async function dailyRevenue(p: Period, from: Date, to: Date) {
  const rows = await q(
    p.tx,
    `SELECT ${localDay('o.created_at', '$3')} AS day, sum(o.total)::text AS revenue, count(*)::int AS orders
       FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} GROUP BY 1`,
    [from, to, p.tz],
  );
  return {
    revenue: new Map(rows.map((r) => [String(r.day), n(r.revenue)])),
    orders: new Map(rows.map((r) => [String(r.day), n(r.orders)])),
  };
}

/* ======================= Resultado ======================= */

export async function resultado(p: Period): Promise<Built> {
  const shift = await one<{ wa: Date; wb: Date; ma: Date; mb: Date }>(
    p.tx,
    `SELECT ($1::date - 7)::timestamp AT TIME ZONE $3 AS wa, ($2::date - 6)::timestamp AT TIME ZONE $3 AS wb,
            ($1::date - interval '1 month') AT TIME ZONE $3 AS ma,
            ($2::date + 1 - interval '1 month') AT TIME ZONE $3 AS mb`,
    [p.from, p.to, p.tz],
  );
  const [cur, prev, week, month] = await serial(
    () => totals(p, p.a, p.b),
    () => totals(p, p.pa, p.a),
    () => totals(p, shift!.wa, shift!.wb),
    () => totals(p, shift!.ma, shift!.mb),
  );
  const margin = (t: Totals) => pct(profit(t), t.revenue);
  const channels = await q(
    p.tx,
    `SELECT o.channel, count(*)::int AS orders, sum(o.total)::text AS revenue
       FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD}
      GROUP BY 1 ORDER BY sum(o.total) DESC`,
    [p.a, p.b],
  );
  const methods = await q(
    p.tx,
    `SELECT method, sum(amount)::text AS net FROM cash_movements
      WHERE kind IN ('sale','refund') AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 2 DESC`,
    [p.a, p.b],
  );
  const open = await q(
    p.tx,
    `SELECT o.number, ${localTs('o.created_at', '$3')} AS at, o.channel,
            COALESCE(NULLIF(o.customer_name, ''), '—') AS customer, o.total::text AS total,
            o.paid_amount::text AS paid, (o.total - o.paid_amount)::text AS open
       FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} AND o.paid_amount < o.total
      ORDER BY o.total - o.paid_amount DESC LIMIT 300`,
    [p.a, p.b, p.tz],
  );
  const cd = await dailyRevenue(p, p.a, p.b);
  const pd = await dailyRevenue(p, p.pa, p.a);

  const metric = (label: string, f: (t: Totals) => number, fmt: 'money' | 'int' | 'pct') => ({
    metric: label,
    cur: f(cur),
    week: f(week),
    weekVar: fmt === 'pct' ? r1(f(cur) - f(week)) : varPct(f(cur), f(week)),
    month: f(month),
    monthVar: fmt === 'pct' ? r1(f(cur) - f(month)) : varPct(f(cur), f(month)),
    fmt,
  });
  const comp = [
    metric('Vendido', (t) => t.revenue, 'money'),
    metric('Recebido (caixa)', (t) => t.received, 'money'),
    metric('Pedidos', (t) => t.orders, 'int'),
    metric('Ticket médio', ticketOf, 'money'),
    metric('Lucro bruto', profit, 'money'),
    metric('Descontos', (t) => t.discounts, 'money'),
    metric('Taxa de serviço', (t) => t.service, 'money'),
    metric('Fiado em aberto', (t) => t.open, 'money'),
  ];
  const totalRev = sum(channels, (c) => n(c.revenue));
  return {
    kpis: [
      {
        label: 'Vendido',
        value: cur.revenue,
        fmt: 'money',
        prev: prev.revenue,
        main: true,
        hint: `${cur.orders} pedidos`,
      },
      {
        label: 'Recebido',
        value: cur.received,
        fmt: 'money',
        prev: prev.received,
        hint: 'Entradas no caixa menos estornos',
      },
      {
        label: 'Lucro bruto',
        value: profit(cur),
        fmt: 'money',
        prev: profit(prev),
        hint: `Margem ${margin(cur).toLocaleString('pt-BR')}%`,
      },
      { label: 'Margem', value: margin(cur), fmt: 'pct', prev: margin(prev) },
      { label: 'Ticket médio', value: ticketOf(cur), fmt: 'money', prev: ticketOf(prev) },
      {
        label: 'Fiado em aberto',
        value: cur.open,
        fmt: 'money',
        prev: prev.open,
        invert: true,
        hint: 'Vendido e ainda não recebido',
      },
      {
        label: 'Descontos',
        value: cur.discounts,
        fmt: 'money',
        prev: prev.discounts,
        invert: true,
      },
      { label: 'Taxa de serviço', value: cur.service, fmt: 'money', prev: prev.service },
    ],
    charts: [
      {
        kind: 'line',
        title: 'Vendido por dia',
        fmt: 'money',
        series: ['Este período', 'Período anterior'],
        points: dailySeries(p, cd.revenue, pd.revenue),
        wide: true,
      },
      {
        kind: 'donut',
        title: 'Vendas por canal',
        fmt: 'money',
        points: channels.map((c) => ({
          label: ch(String(c.channel)),
          value: n(c.revenue),
          hint: `${c.orders} pedidos`,
        })),
      },
      {
        kind: 'bars',
        title: 'Recebido por forma',
        fmt: 'money',
        points: methods.map((m) => ({ label: pm(String(m.method)), value: n(m.net) })),
      },
    ],
    tables: [
      {
        id: 'comparacao',
        title: 'Comparação',
        hint: 'O período escolhido contra os mesmos dias da semana anterior e do mês anterior. Na margem, a variação é em pontos percentuais.',
        columns: [
          { key: 'metric', label: 'Indicador', fmt: 'text', width: 22 },
          { key: 'cur', label: 'Período', fmt: 'money' },
          { key: 'week', label: 'Semana anterior', fmt: 'money' },
          { key: 'weekVar', label: 'Var. semana %', fmt: 'pct' },
          { key: 'month', label: 'Mês anterior', fmt: 'money' },
          { key: 'monthVar', label: 'Var. mês %', fmt: 'pct' },
        ],
        rows: [...comp.filter((c) => c.fmt === 'money').map(({ fmt: _f, ...r }) => r)],
      },
      {
        id: 'comparacao-qtd',
        title: 'Comparação (quantidade e margem)',
        columns: [
          { key: 'metric', label: 'Indicador', fmt: 'text', width: 22 },
          { key: 'cur', label: 'Período', fmt: 'num' },
          { key: 'week', label: 'Semana anterior', fmt: 'num' },
          { key: 'weekVar', label: 'Var. semana', fmt: 'num' },
          { key: 'month', label: 'Mês anterior', fmt: 'num' },
          { key: 'monthVar', label: 'Var. mês', fmt: 'num' },
        ],
        rows: [
          ...comp.filter((c) => c.fmt === 'int').map(({ fmt: _f, ...r }) => r),
          {
            metric: 'Margem bruta (%)',
            cur: margin(cur),
            week: margin(week),
            weekVar: week.revenue ? r1(margin(cur) - margin(week)) : null,
            month: margin(month),
            monthVar: month.revenue ? r1(margin(cur) - margin(month)) : null,
          },
        ],
      },
      {
        id: 'canais',
        title: 'Canais',
        columns: [
          { key: 'channel', label: 'Canal', fmt: 'text' },
          { key: 'orders', label: 'Pedidos', fmt: 'int' },
          { key: 'revenue', label: 'Vendido', fmt: 'money' },
          { key: 'share', label: '% do vendido', fmt: 'pct' },
          { key: 'ticket', label: 'Ticket médio', fmt: 'money' },
        ],
        rows: channels.map((c) => ({
          channel: ch(String(c.channel)),
          orders: n(c.orders),
          revenue: n(c.revenue),
          share: pct(n(c.revenue), totalRev),
          ticket: n(c.orders) ? r2(n(c.revenue) / n(c.orders)) : 0,
        })),
        total: {
          channel: 'Total',
          orders: sum(channels, (c) => n(c.orders)),
          revenue: totalRev,
          share: 100,
          ticket: ticketOf(cur),
        },
        bar: 'revenue',
      },
      {
        id: 'fiado',
        title: 'Fiado em aberto',
        hint: 'Pedidos do período ainda não pagos por completo.',
        columns: [
          { key: 'number', label: 'Pedido', fmt: 'int' },
          { key: 'at', label: 'Data/hora', fmt: 'datetime' },
          { key: 'channel', label: 'Canal', fmt: 'text' },
          { key: 'customer', label: 'Cliente', fmt: 'text' },
          { key: 'total', label: 'Total', fmt: 'money' },
          { key: 'paid', label: 'Pago', fmt: 'money' },
          { key: 'open', label: 'Em aberto', fmt: 'money' },
        ],
        rows: open.map((o) => ({
          number: n(o.number),
          at: String(o.at),
          channel: ch(String(o.channel)),
          customer: String(o.customer),
          total: n(o.total),
          paid: n(o.paid),
          open: n(o.open),
        })),
        total: {
          number: null,
          total: sum(open, (o) => n(o.total)),
          paid: sum(open, (o) => n(o.paid)),
          open: sum(open, (o) => n(o.open)),
        },
        bar: 'open',
        truncated: open.length >= 300,
      },
    ],
    notes: [
      'Vendido = pedidos feitos no período, sem os cancelados. Recebido = o que entrou no caixa no período (pagamentos menos estornos); os dois podem diferir quando um pedido é pago em outro dia.',
      'Lucro bruto = vendido − taxas de entrega − custo dos insumos pela ficha técnica (custo médio atual). Produto sem ficha conta custo zero.',
    ],
  };
}

/* ======================= Extrato ======================= */

export async function extrato(p: Period): Promise<Built> {
  const rows = await q(
    p.tx,
    `SELECT o.number, ${localTs('o.created_at', '$3')} AS at, o.channel, o.status,
            COALESCE(NULLIF(o.customer_name, ''), c.name, '') AS customer,
            COALESCE(dt.label, CASE WHEN t.number IS NOT NULL THEN 'Comanda ' || t.number END, '') AS place,
            COALESCE(u.name, CASE WHEN o.source = 'online' THEN 'Cardápio online' END, '') AS staff,
            o.subtotal::text AS subtotal, o.discount::text AS discount, o.surcharge::text AS service,
            o.delivery_fee::text AS fee, o.total::text AS total, o.paid_amount::text AS paid,
            COALESCE((SELECT json_agg(json_build_object('m', pay.method, 'v', (pay.amount - pay.refunded_amount)::text) ORDER BY pay.created_at)
                        FROM payments pay WHERE pay.order_id = o.id AND pay.amount > pay.refunded_amount), '[]') AS pays
       FROM orders o
       LEFT JOIN tabs t ON t.id = o.tab_id LEFT JOIN dining_tables dt ON dt.id = t.table_id
       LEFT JOIN users u ON u.id = o.created_by LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD}
      ORDER BY o.created_at LIMIT ${LIMIT + 1}`,
    [p.a, p.b, p.tz],
  );
  const truncated = rows.length > LIMIT;
  const list = rows.slice(0, LIMIT);
  const byMethod = new Map<string, number>();
  const byDay = new Map<string, number>();
  const out = list.map((o) => {
    const pays = (o.pays as { m: string; v: string }[]) ?? [];
    for (const x of pays) byMethod.set(x.m, (byMethod.get(x.m) ?? 0) + n(x.v));
    const day = String(o.at).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    return {
      number: n(o.number),
      at: String(o.at),
      channel: ch(String(o.channel)),
      status: ORDER_STATUS_LABELS[o.status as OrderStatus] ?? String(o.status),
      place: String(o.place),
      customer: String(o.customer),
      staff: String(o.staff),
      subtotal: n(o.subtotal),
      discount: n(o.discount),
      service: n(o.service),
      fee: n(o.fee),
      total: n(o.total),
      paid: n(o.paid),
      open: r2(n(o.total) - n(o.paid)),
      methods: pays
        .map(
          (x) =>
            `${pm(x.m)} ${n(x.v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        )
        .join(' + '),
    };
  });
  const total = sum(out, (o) => o.total);
  const paid = sum(out, (o) => o.paid);
  return {
    kpis: [
      { label: 'Contas', value: out.length, fmt: 'int', main: true },
      { label: 'Total das contas', value: total, fmt: 'money' },
      { label: 'Pago', value: paid, fmt: 'money' },
      { label: 'Em aberto', value: r2(total - paid), fmt: 'money', invert: true },
      { label: 'Ticket médio', value: out.length ? r2(total / out.length) : 0, fmt: 'money' },
    ],
    charts: [
      {
        kind: 'donut',
        title: 'Pago por forma',
        fmt: 'money',
        points: [...byMethod]
          .map(([m, v]) => ({ label: pm(m), value: r2(v) }))
          .sort((x, y) => y.value - x.value),
      },
      {
        kind: 'columns',
        title: 'Contas por dia',
        fmt: 'int',
        points: dayList(p.from, p.days).map((d) => ({ label: dm(d), value: byDay.get(d) ?? 0 })),
      },
    ],
    tables: [
      {
        id: 'extrato',
        title: 'Extrato de vendas',
        hint: 'Cada conta do período, na ordem em que foi aberta. Use o filtro do cabeçalho para conferir por canal, atendente ou forma de pagamento.',
        columns: [
          { key: 'number', label: 'Pedido', fmt: 'int', width: 9 },
          { key: 'at', label: 'Data/hora', fmt: 'datetime' },
          { key: 'channel', label: 'Canal', fmt: 'text', width: 11 },
          { key: 'status', label: 'Situação', fmt: 'text', width: 14 },
          { key: 'place', label: 'Mesa/comanda', fmt: 'text', width: 13 },
          { key: 'customer', label: 'Cliente', fmt: 'text', width: 22 },
          { key: 'staff', label: 'Atendente', fmt: 'text', width: 18 },
          { key: 'subtotal', label: 'Itens', fmt: 'money' },
          { key: 'discount', label: 'Desconto', fmt: 'money' },
          { key: 'service', label: 'Serviço', fmt: 'money' },
          { key: 'fee', label: 'Frete', fmt: 'money' },
          { key: 'total', label: 'Total', fmt: 'money' },
          { key: 'paid', label: 'Pago', fmt: 'money' },
          { key: 'open', label: 'Em aberto', fmt: 'money' },
          { key: 'methods', label: 'Formas de pagamento', fmt: 'text', width: 36 },
        ],
        rows: out,
        total: {
          number: null,
          subtotal: sum(out, (o) => o.subtotal),
          discount: sum(out, (o) => o.discount),
          service: sum(out, (o) => o.service),
          fee: sum(out, (o) => o.fee),
          total,
          paid,
          open: r2(total - paid),
        },
        truncated,
      },
    ],
    notes: ['Formas de pagamento mostram o valor líquido de cada pagamento (já sem estornos).'],
  };
}

/* ======================= Evolução ======================= */

export async function evolucao(p: Period): Promise<Built> {
  const q1 = (from: Date, to: Date) =>
    q(
      p.tx,
      `SELECT ${localDay('o.created_at', '$3')} AS day,
              count(*) FILTER (WHERE ${SOLD})::int AS orders,
              count(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
              COALESCE(sum(o.total) FILTER (WHERE ${SOLD}), 0)::text AS revenue,
              COALESCE(sum(o.delivery_fee) FILTER (WHERE ${SOLD}), 0)::text AS fees,
              COALESCE(round(sum(${ORDER_COST}) FILTER (WHERE ${SOLD}), 2), 0)::text AS cost
         FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 GROUP BY 1`,
      [from, to, p.tz],
    );
  const [cur, prev] = await serial(
    () => q1(p.a, p.b),
    () => q1(p.pa, p.a),
  );
  const map = new Map(cur.map((r) => [String(r.day), r]));
  const days = dayList(p.from, p.days).map((d) => {
    const r = map.get(d);
    const revenue = n(r?.revenue);
    const prof = r2(revenue - n(r?.fees) - n(r?.cost));
    return {
      day: d,
      weekday: WEEKDAYS[weekday(d)]!,
      orders: n(r?.orders),
      revenue,
      ticket: n(r?.orders) ? r2(revenue / n(r?.orders)) : 0,
      cost: n(r?.cost),
      profit: prof,
      margin: pct(prof, revenue),
      cancelled: n(r?.cancelled),
    };
  });
  const totalRev = sum(days, (d) => d.revenue);
  const prevRev = sum(prev, (d) => n(d.revenue));
  const withSales = days.filter((d) => d.orders > 0);
  const best = [...withSales].sort((x, y) => y.revenue - x.revenue)[0];
  const worst = [...withSales].sort((x, y) => x.revenue - y.revenue)[0];
  const byWd = WEEKDAYS.map((w, i) => {
    const ds = days.filter((d) => weekday(d.day) === i);
    return {
      label: w,
      value: ds.length ? r2(sum(ds, (d) => d.revenue) / ds.length) : 0,
      hint: `${ds.length} dias`,
    };
  });
  const order = [1, 2, 3, 4, 5, 6, 0];
  return {
    kpis: [
      { label: 'Vendido', value: totalRev, fmt: 'money', prev: prevRev, main: true },
      {
        label: 'Média por dia',
        value: r2(totalRev / p.days),
        fmt: 'money',
        prev: r2(prevRev / p.days),
      },
      {
        label: 'Pedidos',
        value: sum(days, (d) => d.orders),
        fmt: 'int',
        prev: sum(prev, (d) => n(d.orders)),
      },
      {
        label: 'Melhor dia',
        value: best ? best.revenue : 0,
        fmt: 'money',
        hint: best ? `${best.weekday}, ${dm(best.day)}` : 'Sem vendas',
      },
      {
        label: 'Dia mais fraco',
        value: worst ? worst.revenue : 0,
        fmt: 'money',
        hint: worst ? `${worst.weekday}, ${dm(worst.day)}` : 'Sem vendas',
      },
      { label: 'Dias com venda', value: withSales.length, fmt: 'int', hint: `de ${p.days} dias` },
    ],
    charts: [
      {
        kind: 'line',
        title: 'Vendido por dia de caixa',
        fmt: 'money',
        series: ['Este período', 'Período anterior'],
        points: dailySeries(
          p,
          new Map(days.map((d) => [d.day, d.revenue])),
          new Map(prev.map((r) => [String(r.day), n(r.revenue)])),
        ),
        wide: true,
      },
      {
        kind: 'columns',
        title: 'Pedidos por dia',
        fmt: 'int',
        points: days.map((d) => ({ label: dm(d.day), value: d.orders })),
        wide: true,
      },
      {
        kind: 'bars',
        title: 'Média vendida por dia da semana',
        fmt: 'money',
        points: order.map((i) => byWd[i]!),
      },
    ],
    tables: [
      {
        id: 'dias',
        title: 'Dia a dia',
        columns: [
          { key: 'day', label: 'Data', fmt: 'date' },
          { key: 'weekday', label: 'Dia', fmt: 'text', width: 11 },
          { key: 'orders', label: 'Pedidos', fmt: 'int' },
          { key: 'revenue', label: 'Vendido', fmt: 'money' },
          { key: 'ticket', label: 'Ticket médio', fmt: 'money' },
          { key: 'cost', label: 'Custo insumos', fmt: 'money' },
          { key: 'profit', label: 'Lucro bruto', fmt: 'money' },
          { key: 'margin', label: 'Margem', fmt: 'pct' },
          { key: 'cancelled', label: 'Cancelados', fmt: 'int' },
        ],
        rows: days,
        total: {
          day: 'Total',
          orders: sum(days, (d) => d.orders),
          revenue: totalRev,
          ticket: sum(days, (d) => d.orders) ? r2(totalRev / sum(days, (d) => d.orders)) : 0,
          cost: sum(days, (d) => d.cost),
          profit: sum(days, (d) => d.profit),
          margin: pct(
            sum(days, (d) => d.profit),
            totalRev,
          ),
          cancelled: sum(days, (d) => d.cancelled),
        },
        bar: 'revenue',
      },
    ],
    notes: ['Dia de caixa = data em que o pedido foi feito, no fuso do restaurante.'],
  };
}

/* ======================= Ticket e formas ======================= */

export async function ticket(p: Period): Promise<Built> {
  const net = `(o.total - o.surcharge - o.delivery_fee)`;
  const agg = (from: Date, to: Date) =>
    one(
      p.tx,
      `SELECT count(*)::int AS n, COALESCE(round(avg(${net}), 2), 0)::text AS net,
              COALESCE(round(avg(o.total), 2), 0)::text AS full, COALESCE(max(${net}), 0)::text AS max,
              COALESCE(round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${net}))::numeric, 2), 0)::text AS median
         FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD}`,
      [from, to],
    );
  const [cur, prev] = await serial(
    () => agg(p.a, p.b),
    () => agg(p.pa, p.a),
  );
  const byChannel = await q(
    p.tx,
    `SELECT o.channel, count(*)::int AS n, round(avg(${net}), 2)::text AS net, round(avg(o.total), 2)::text AS full,
            sum(o.surcharge)::text AS service, sum(o.delivery_fee)::text AS fees
       FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD}
      GROUP BY 1 ORDER BY 2 DESC`,
    [p.a, p.b],
  );
  const daily = (from: Date, to: Date) =>
    q(
      p.tx,
      `SELECT ${localDay('o.created_at', '$3')} AS day, round(avg(${net}), 2)::text AS net
         FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} GROUP BY 1`,
      [from, to, p.tz],
    );
  const [dc, dp] = await serial(
    () => daily(p.a, p.b),
    () => daily(p.pa, p.a),
  );
  const buckets = await q(
    p.tx,
    `SELECT LEAST(floor(${net} / 20)::int, 10) AS b, count(*)::int AS n
       FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} GROUP BY 1 ORDER BY 1`,
    [p.a, p.b],
  );
  const methods = await q(
    p.tx,
    `SELECT method, count(*) FILTER (WHERE kind = 'sale')::int AS count,
            COALESCE(sum(amount) FILTER (WHERE kind = 'sale'), 0)::text AS received,
            COALESCE(-sum(amount) FILTER (WHERE kind = 'refund'), 0)::text AS refunded,
            sum(amount)::text AS net
       FROM cash_movements WHERE kind IN ('sale','refund') AND created_at >= $1 AND created_at < $2
      GROUP BY 1 ORDER BY sum(amount) DESC`,
    [p.a, p.b],
  );
  const totalNet = sum(methods, (m) => n(m.net));
  const bmap = new Map(buckets.map((b) => [n(b.b), n(b.n)]));
  return {
    kpis: [
      {
        label: 'Ticket médio (sem serviço e frete)',
        value: n(cur!.net),
        fmt: 'money',
        prev: n(prev!.net),
        main: true,
        hint: `${cur!.n} contas`,
      },
      {
        label: 'Ticket com serviço e frete',
        value: n(cur!.full),
        fmt: 'money',
        prev: n(prev!.full),
      },
      {
        label: 'Mediana',
        value: n(cur!.median),
        fmt: 'money',
        hint: 'Metade das contas fica abaixo deste valor',
      },
      { label: 'Maior conta', value: n(cur!.max), fmt: 'money' },
      {
        label: 'Recebido',
        value: totalNet,
        fmt: 'money',
        hint: `${sum(methods, (m) => n(m.count))} pagamentos`,
      },
    ],
    charts: [
      {
        kind: 'line',
        title: 'Ticket médio por dia (sem serviço e frete)',
        fmt: 'money',
        series: ['Este período', 'Período anterior'],
        points: dailySeries(
          p,
          new Map(dc.map((r) => [String(r.day), n(r.net)])),
          new Map(dp.map((r) => [String(r.day), n(r.net)])),
        ),
        wide: true,
      },
      {
        kind: 'columns',
        title: 'Quantas contas em cada faixa de valor',
        fmt: 'int',
        points: Array.from({ length: 11 }, (_, i) => ({
          label: i === 10 ? 'R$ 200+' : `R$ ${i * 20}–${i * 20 + 20}`,
          value: bmap.get(i) ?? 0,
        })),
      },
      {
        kind: 'donut',
        title: 'Recebido por forma',
        fmt: 'money',
        points: methods.map((m) => ({ label: pm(String(m.method)), value: n(m.net) })),
      },
    ],
    tables: [
      {
        id: 'formas',
        title: 'Recebido por forma',
        columns: [
          { key: 'method', label: 'Forma', fmt: 'text' },
          { key: 'count', label: 'Pagamentos', fmt: 'int' },
          { key: 'received', label: 'Recebido', fmt: 'money' },
          { key: 'refunded', label: 'Estornos', fmt: 'money' },
          { key: 'net', label: 'Líquido', fmt: 'money' },
          { key: 'share', label: '% do total', fmt: 'pct' },
          { key: 'avg', label: 'Valor médio', fmt: 'money' },
        ],
        rows: methods.map((m) => ({
          method: pm(String(m.method)),
          count: n(m.count),
          received: n(m.received),
          refunded: n(m.refunded),
          net: n(m.net),
          share: pct(n(m.net), totalNet),
          avg: n(m.count) ? r2(n(m.received) / n(m.count)) : 0,
        })),
        total: {
          method: 'Total',
          count: sum(methods, (m) => n(m.count)),
          received: sum(methods, (m) => n(m.received)),
          refunded: sum(methods, (m) => n(m.refunded)),
          net: totalNet,
          share: 100,
        },
        bar: 'net',
      },
      {
        id: 'ticket-canal',
        title: 'Ticket por canal',
        columns: [
          { key: 'channel', label: 'Canal', fmt: 'text' },
          { key: 'n', label: 'Contas', fmt: 'int' },
          { key: 'net', label: 'Ticket sem serviço e frete', fmt: 'money' },
          { key: 'full', label: 'Ticket cheio', fmt: 'money' },
          { key: 'service', label: 'Serviço', fmt: 'money' },
          { key: 'fees', label: 'Frete', fmt: 'money' },
        ],
        rows: byChannel.map((c) => ({
          channel: ch(String(c.channel)),
          n: n(c.n),
          net: n(c.net),
          full: n(c.full),
          service: n(c.service),
          fees: n(c.fees),
        })),
        bar: 'net',
      },
    ],
    notes: [
      'Ticket sem serviço e frete = total da conta − taxa de serviço − taxa de entrega: mostra quanto o cliente consome de fato.',
      'Recebido por forma considera o que entrou no caixa no período (pagamentos menos estornos).',
    ],
  };
}

/* ======================= Perdas e controle ======================= */

export async function perdas(p: Period): Promise<Built> {
  const cancelSql = (from: Date, to: Date) =>
    q(
      p.tx,
      `SELECT COALESCE(h.actor_id, o.created_by) AS uid, count(*)::int AS n, sum(o.total)::text AS v
         FROM orders o
         LEFT JOIN LATERAL (SELECT actor_id FROM order_status_history
                             WHERE order_id = o.id AND to_status = 'cancelled' ORDER BY id DESC LIMIT 1) h ON true
        WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status = 'cancelled' GROUP BY 1`,
      [from, to],
    );
  const discountSql = (from: Date, to: Date) =>
    q(
      p.tx,
      `SELECT o.created_by AS uid, count(*)::int AS n, sum(o.discount)::text AS v
         FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD} AND o.discount > 0 GROUP BY 1`,
      [from, to],
    );
  const cashSql = (from: Date, to: Date) =>
    q(
      p.tx,
      `SELECT s.closed_by AS uid, count(*)::int AS n, COALESCE(sum(s.difference), 0)::text AS v,
              COALESCE(-sum(s.difference) FILTER (WHERE s.difference < 0), 0)::text AS short
         FROM cash_sessions s WHERE s.closed_at >= $1 AND s.closed_at < $2 GROUP BY 1`,
      [from, to],
    );
  const stockSql = (from: Date, to: Date) =>
    q(
      p.tx,
      `SELECT m.created_by AS uid, count(*)::int AS n,
              COALESCE(round(sum(-m.quantity * COALESCE(m.unit_cost, si.avg_cost)), 2), 0)::text AS v
         FROM stock_movements m JOIN stock_items si ON si.id = m.stock_item_id
        WHERE m.kind = 'loss' AND m.created_at >= $1 AND m.created_at < $2 GROUP BY 1`,
      [from, to],
    );
  const [c, d, k, s, pc, pd, pk, ps] = await serial(
    () => cancelSql(p.a, p.b),
    () => discountSql(p.a, p.b),
    () => cashSql(p.a, p.b),
    () => stockSql(p.a, p.b),
    () => cancelSql(p.pa, p.a),
    () => discountSql(p.pa, p.a),
    () => cashSql(p.pa, p.a),
    () => stockSql(p.pa, p.a),
  );
  const users = await q(p.tx, `SELECT id, name FROM users WHERE id = ANY($1::uuid[])`, [
    [...new Set([...c, ...d, ...k, ...s].map((r) => r.uid).filter(Boolean))],
  ]);
  const names = new Map(users.map((u) => [String(u.id), String(u.name)]));
  const ops = new Map<
    string,
    {
      op: string;
      cN: number;
      cV: number;
      dN: number;
      dV: number;
      cash: number;
      short: number;
      sV: number;
    }
  >();
  const get = (uid: unknown) => {
    const key = uid ? String(uid) : '-';
    if (!ops.has(key))
      ops.set(key, {
        op: uid ? (names.get(key) ?? 'Usuário removido') : 'Cardápio online / sistema',
        cN: 0,
        cV: 0,
        dN: 0,
        dV: 0,
        cash: 0,
        short: 0,
        sV: 0,
      });
    return ops.get(key)!;
  };
  for (const r of c) Object.assign(get(r.uid), { cN: n(r.n), cV: n(r.v) });
  for (const r of d) Object.assign(get(r.uid), { dN: n(r.n), dV: n(r.v) });
  for (const r of k) Object.assign(get(r.uid), { cash: n(r.v), short: n(r.short) });
  for (const r of s) Object.assign(get(r.uid), { sV: n(r.v) });
  const rows = [...ops.values()]
    .map((o) => ({
      op: o.op,
      cN: o.cN,
      cV: o.cV,
      dN: o.dN,
      dV: o.dV,
      cash: o.cash,
      sV: o.sV,
      total: r2(o.cV + o.dV + o.short + o.sV),
    }))
    .sort((x, y) => y.total - x.total);
  const tot = (cr: typeof c, dr: typeof d, kr: typeof k, sr: typeof s) => ({
    cancel: sum(cr, (r) => n(r.v)),
    discount: sum(dr, (r) => n(r.v)),
    short: sum(kr, (r) => n(r.short)),
    cash: sum(kr, (r) => n(r.v)),
    stock: sum(sr, (r) => n(r.v)),
  });
  const T = tot(c, d, k, s);
  const P = tot(pc, pd, pk, ps);
  const risk = (t: typeof T) => r2(t.cancel + t.discount + t.short + t.stock);
  const sold = await one(
    p.tx,
    `SELECT COALESCE(sum(o.total), 0)::text AS v FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${SOLD}`,
    [p.a, p.b],
  );
  const dailyLoss = (from: Date, to: Date) =>
    q(
      p.tx,
      `SELECT ${localDay('o.created_at', '$3')} AS day,
              COALESCE(sum(o.total) FILTER (WHERE o.status = 'cancelled'), 0) + COALESCE(sum(o.discount) FILTER (WHERE ${SOLD}), 0) AS v
         FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 GROUP BY 1`,
      [from, to, p.tz],
    );
  const [lc, lp] = await serial(
    () => dailyLoss(p.a, p.b),
    () => dailyLoss(p.pa, p.a),
  );
  return {
    kpis: [
      {
        label: 'Total em risco',
        value: risk(T),
        fmt: 'money',
        prev: risk(P),
        invert: true,
        main: true,
        hint: `${pct(risk(T), n(sold!.v)).toLocaleString('pt-BR')}% do vendido`,
      },
      {
        label: 'Cancelado',
        value: T.cancel,
        fmt: 'money',
        prev: P.cancel,
        invert: true,
        hint: `${sum(c, (r) => n(r.n))} pedidos`,
      },
      {
        label: 'Descontos',
        value: T.discount,
        fmt: 'money',
        prev: P.discount,
        invert: true,
        hint: `${sum(d, (r) => n(r.n))} contas com desconto`,
      },
      {
        label: 'Diferença de caixa',
        value: T.cash,
        fmt: 'money',
        prev: P.cash,
        hint: `Faltas somam ${T.short.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        tone: T.cash < 0 ? 'bad' : undefined,
      },
      {
        label: 'Perdas de estoque',
        value: T.stock,
        fmt: 'money',
        prev: P.stock,
        invert: true,
        hint: 'Descartes e quebras pelo custo',
      },
    ],
    charts: [
      {
        kind: 'bars',
        title: 'Total em risco por operador',
        fmt: 'money',
        points: rows.filter((r) => r.total > 0).map((r) => ({ label: r.op, value: r.total })),
      },
      {
        kind: 'donut',
        title: 'De onde vem a perda',
        fmt: 'money',
        points: [
          { label: 'Cancelamentos', value: T.cancel },
          { label: 'Descontos', value: T.discount },
          { label: 'Faltas de caixa', value: T.short },
          { label: 'Perdas de estoque', value: T.stock },
        ].filter((x) => x.value > 0),
      },
      {
        kind: 'line',
        title: 'Cancelado + descontos por dia',
        fmt: 'money',
        series: ['Este período', 'Período anterior'],
        points: dailySeries(
          p,
          new Map(lc.map((r) => [String(r.day), n(r.v)])),
          new Map(lp.map((r) => [String(r.day), n(r.v)])),
        ),
        wide: true,
      },
    ],
    tables: [
      {
        id: 'operadores',
        title: 'Por operador',
        hint: 'Cancelamento conta para quem autorizou; desconto para quem lançou o pedido; diferença de caixa para quem fechou o caixa.',
        columns: [
          { key: 'op', label: 'Operador', fmt: 'text', width: 24 },
          { key: 'cN', label: 'Cancelamentos', fmt: 'int' },
          { key: 'cV', label: 'Valor cancelado', fmt: 'money' },
          { key: 'dN', label: 'Descontos', fmt: 'int' },
          { key: 'dV', label: 'Valor em descontos', fmt: 'money' },
          { key: 'cash', label: 'Diferença de caixa', fmt: 'money' },
          { key: 'sV', label: 'Perdas de estoque', fmt: 'money' },
          { key: 'total', label: 'Total em risco', fmt: 'money' },
        ],
        rows,
        total: {
          op: 'Total',
          cN: sum(rows, (r) => r.cN),
          cV: T.cancel,
          dN: sum(rows, (r) => r.dN),
          dV: T.discount,
          cash: T.cash,
          sV: T.stock,
          total: risk(T),
        },
        bar: 'total',
      },
    ],
    notes: [
      'Total em risco = valor cancelado + descontos + faltas de caixa + perdas de estoque. Sobras de caixa não abatem as faltas.',
    ],
  };
}

/* ======================= Cancelamentos ======================= */

export async function cancelamentos(p: Period): Promise<Built> {
  const rows = await q(
    p.tx,
    `SELECT o.number, ${localTs('o.created_at', '$3')} AS at, ${localTs('COALESCE(hc.created_at, o.updated_at)', '$3')} AS cancelled_at,
            o.channel, COALESCE(NULLIF(o.customer_name, ''), '') AS customer, o.total::text AS total,
            COALESCE(NULLIF(trim(o.cancel_reason), ''), 'Sem motivo informado') AS reason,
            COALESCE(ur.name, ua.name, '') AS requested, COALESCE(ua.name, '') AS authorized,
            COALESCE(uc.name, CASE WHEN o.source = 'online' THEN 'Cardápio online' END, '') AS creator,
            (SELECT string_agg(trim(to_char(i.quantity, 'FM999990.###')) || '× ' || i.name, ', ' ORDER BY i.created_at)
               FROM order_items i WHERE i.order_id = o.id) AS items,
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS item_count
       FROM orders o
       LEFT JOIN LATERAL (SELECT actor_id, created_at FROM order_status_history
                           WHERE order_id = o.id AND to_status = 'cancelled' ORDER BY id DESC LIMIT 1) hc ON true
       LEFT JOIN LATERAL (SELECT actor_id FROM order_status_history
                           WHERE order_id = o.id AND to_status = 'cancel_requested' ORDER BY id DESC LIMIT 1) hr ON true
       LEFT JOIN users ua ON ua.id = hc.actor_id
       LEFT JOIN users ur ON ur.id = hr.actor_id
       LEFT JOIN users uc ON uc.id = o.created_by
      WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status = 'cancelled'
      ORDER BY o.created_at LIMIT ${LIMIT + 1}`,
    [p.a, p.b, p.tz],
  );
  const prev = await one(
    p.tx,
    `SELECT count(*) FILTER (WHERE o.status = 'cancelled')::int AS n,
            COALESCE(sum(o.total) FILTER (WHERE o.status = 'cancelled'), 0)::text AS v
       FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2`,
    [p.pa, p.a],
  );
  const all = await one(
    p.tx,
    `SELECT count(*)::int AS n FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'awaiting'`,
    [p.a, p.b],
  );
  const list = rows.slice(0, LIMIT).map((r) => ({
    number: n(r.number),
    at: String(r.at),
    cancelledAt: String(r.cancelled_at),
    channel: ch(String(r.channel)),
    customer: String(r.customer),
    total: n(r.total),
    reason: String(r.reason),
    requested: String(r.requested) || String(r.authorized) || '—',
    authorized: String(r.authorized) || '—',
    creator: String(r.creator) || '—',
    items: String(r.items ?? ''),
  }));
  const group = <K extends 'reason' | 'authorized'>(k: K) => {
    const m = new Map<string, { label: string; count: number; value: number }>();
    for (const r of list) {
      const g = m.get(r[k]) ?? { label: r[k], count: 0, value: 0 };
      g.count++;
      g.value = r2(g.value + r.total);
      m.set(r[k], g);
    }
    return [...m.values()].sort((x, y) => y.count - x.count || y.value - x.value);
  };
  const reasons = group('reason');
  const auth = group('authorized');
  const total = sum(list, (r) => r.total);
  return {
    kpis: [
      {
        label: 'Cancelamentos',
        value: list.length,
        fmt: 'int',
        prev: n(prev!.n),
        invert: true,
        main: true,
      },
      { label: 'Valor cancelado', value: total, fmt: 'money', prev: n(prev!.v), invert: true },
      {
        label: '% dos pedidos',
        value: pct(list.length, n(all!.n)),
        fmt: 'pct',
        hint: `${n(all!.n)} pedidos no período`,
      },
      {
        label: 'Motivo mais comum',
        value: reasons[0]?.label ?? '—',
        fmt: 'text',
        hint: reasons[0] ? `${reasons[0].count} vezes` : undefined,
      },
    ],
    charts: [
      {
        kind: 'bars',
        title: 'Cancelamentos por motivo',
        fmt: 'int',
        points: reasons.slice(0, 12).map((r) => ({
          label: r.label,
          value: r.count,
          hint: r.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        })),
      },
      {
        kind: 'bars',
        title: 'Valor cancelado por quem autorizou',
        fmt: 'money',
        points: auth.map((r) => ({ label: r.label, value: r.value, hint: `${r.count} pedidos` })),
      },
    ],
    tables: [
      {
        id: 'cancelamentos',
        title: 'Pedidos cancelados',
        columns: [
          { key: 'number', label: 'Pedido', fmt: 'int', width: 9 },
          { key: 'at', label: 'Feito em', fmt: 'datetime' },
          { key: 'cancelledAt', label: 'Cancelado em', fmt: 'datetime' },
          { key: 'channel', label: 'Canal', fmt: 'text', width: 11 },
          { key: 'customer', label: 'Cliente', fmt: 'text', width: 20 },
          { key: 'items', label: 'Itens', fmt: 'text', width: 40 },
          { key: 'total', label: 'Valor', fmt: 'money' },
          { key: 'reason', label: 'Motivo', fmt: 'text', width: 30 },
          { key: 'creator', label: 'Lançou', fmt: 'text', width: 18 },
          { key: 'requested', label: 'Pediu', fmt: 'text', width: 18 },
          { key: 'authorized', label: 'Autorizou', fmt: 'text', width: 18 },
        ],
        rows: list,
        total: { number: null, total },
        truncated: rows.length > LIMIT,
      },
      {
        id: 'motivos',
        title: 'Por motivo',
        columns: [
          { key: 'label', label: 'Motivo', fmt: 'text', width: 34 },
          { key: 'count', label: 'Pedidos', fmt: 'int' },
          { key: 'value', label: 'Valor', fmt: 'money' },
        ],
        rows: reasons,
        total: { label: 'Total', count: list.length, value: total },
        bar: 'value',
      },
    ],
    notes: [
      'Pediu = quem solicitou o cancelamento (ex.: o garçom); quando o pedido foi cancelado direto, é a mesma pessoa que autorizou.',
    ],
  };
}

/* ======================= Fechamentos de caixa ======================= */

export async function fechamentos(p: Period): Promise<Built> {
  const sessions = await q(
    p.tx,
    `SELECT s.id, s.number, r.name AS register, uo.name AS opened_by, uc.name AS closed_by,
            ${localTs('s.opened_at', '$3')} AS opened_at, ${localTs('s.closed_at', '$3')} AS closed_at,
            s.opening_amount::text AS opening, s.expected, s.counted, s.difference::text AS diff,
            COALESCE(s.closing_note, '') AS note
       FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id
       LEFT JOIN users uo ON uo.id = s.opened_by LEFT JOIN users uc ON uc.id = s.closed_by
      WHERE s.status = 'closed' AND s.closed_at >= $1 AND s.closed_at < $2
      ORDER BY s.closed_at`,
    [p.a, p.b, p.tz],
  );
  const ids = sessions.map((s) => String(s.id));
  const cash = await q(
    p.tx,
    `SELECT kind, sum(amount)::text AS v, count(*)::int AS n FROM cash_movements
      WHERE cash_session_id = ANY($1::uuid[]) AND method = 'cash' GROUP BY 1`,
    [ids],
  );
  const kinds = new Map(cash.map((c) => [String(c.kind), n(c.v)]));
  const methods = new Map<string, { expected: number; counted: number }>();
  const tot = (o: unknown) =>
    Object.values((o as Record<string, string>) ?? {}).reduce((s, v) => s + n(v), 0);
  for (const s of sessions) {
    for (const [m, v] of Object.entries((s.expected as Record<string, string>) ?? {})) {
      const x = methods.get(m) ?? { expected: 0, counted: 0 };
      x.expected = r2(x.expected + n(v));
      methods.set(m, x);
    }
    for (const [m, v] of Object.entries((s.counted as Record<string, string>) ?? {})) {
      const x = methods.get(m) ?? { expected: 0, counted: 0 };
      x.counted = r2(x.counted + n(v));
      methods.set(m, x);
    }
  }
  const byMethod = [...methods]
    .map(([m, x]) => ({
      method: pm(m),
      expected: x.expected,
      counted: x.counted,
      diff: r2(x.counted - x.expected),
    }))
    .filter((x) => x.expected || x.counted)
    .sort((a, b) => b.expected - a.expected);
  const list = sessions.map((s) => ({
    number: n(s.number),
    register: String(s.register),
    openedBy: String(s.opened_by ?? '—'),
    openedAt: String(s.opened_at),
    closedBy: String(s.closed_by ?? '—'),
    closedAt: String(s.closed_at),
    opening: n(s.opening),
    expected: r2(tot(s.expected)),
    counted: r2(tot(s.counted)),
    diff: n(s.diff),
    note: String(s.note),
  }));
  const expectedCash = r2(
    (kinds.get('opening') ?? 0) +
      (kinds.get('sale') ?? 0) +
      (kinds.get('supply') ?? 0) +
      (kinds.get('withdrawal') ?? 0) +
      (kinds.get('refund') ?? 0),
  );
  const countedCash = methods.get('cash')?.counted ?? 0;
  const flow = [
    { step: 'Fundo de troco (abertura)', value: kinds.get('opening') ?? 0 },
    { step: '+ Vendas em dinheiro', value: kinds.get('sale') ?? 0 },
    { step: '+ Suprimentos', value: kinds.get('supply') ?? 0 },
    { step: '− Sangrias', value: kinds.get('withdrawal') ?? 0 },
    { step: '− Estornos em dinheiro', value: kinds.get('refund') ?? 0 },
    { step: '= Dinheiro esperado na gaveta', value: expectedCash },
    { step: 'Dinheiro contado', value: countedCash },
    { step: 'Diferença (contado − esperado)', value: r2(countedCash - expectedCash) },
  ];
  const diff = sum(list, (s) => s.diff);
  return {
    kpis: [
      { label: 'Fechamentos', value: list.length, fmt: 'int', main: true },
      { label: 'Esperado', value: sum(list, (s) => s.expected), fmt: 'money' },
      { label: 'Contado', value: sum(list, (s) => s.counted), fmt: 'money' },
      {
        label: 'Diferença',
        value: diff,
        fmt: 'money',
        tone: diff < 0 ? 'bad' : diff > 0 ? 'good' : undefined,
        hint: diff < 0 ? 'Faltou dinheiro' : diff > 0 ? 'Sobrou dinheiro' : 'Bateu',
      },
      {
        label: 'Caixas com falta',
        value: list.filter((s) => s.diff < 0).length,
        fmt: 'int',
        invert: true,
      },
    ],
    charts: [
      {
        kind: 'bars',
        title: 'Diferença por fechamento',
        fmt: 'money',
        points: list.map((s) => ({
          label: `Caixa ${s.number} · ${s.closedAt.slice(8, 10)}/${s.closedAt.slice(5, 7)}`,
          value: s.diff,
          hint: s.closedBy,
        })),
      },
      {
        kind: 'donut',
        title: 'Contado por forma',
        fmt: 'money',
        points: byMethod.map((m) => ({ label: m.method, value: m.counted })),
      },
    ],
    tables: [
      {
        id: 'fechamentos',
        title: 'Fechamentos',
        columns: [
          { key: 'number', label: 'Caixa nº', fmt: 'int', width: 9 },
          { key: 'register', label: 'Caixa', fmt: 'text', width: 14 },
          { key: 'openedBy', label: 'Abriu', fmt: 'text', width: 16 },
          { key: 'openedAt', label: 'Aberto em', fmt: 'datetime' },
          { key: 'closedBy', label: 'Fechou', fmt: 'text', width: 16 },
          { key: 'closedAt', label: 'Fechado em', fmt: 'datetime' },
          { key: 'opening', label: 'Fundo de troco', fmt: 'money' },
          { key: 'expected', label: 'Esperado', fmt: 'money' },
          { key: 'counted', label: 'Contado', fmt: 'money' },
          { key: 'diff', label: 'Diferença', fmt: 'money' },
          { key: 'note', label: 'Observação', fmt: 'text', width: 30 },
        ],
        rows: list,
        total: {
          number: null,
          opening: sum(list, (s) => s.opening),
          expected: sum(list, (s) => s.expected),
          counted: sum(list, (s) => s.counted),
          diff,
        },
      },
      {
        id: 'por-forma',
        title: 'Esperado × contado por forma',
        columns: [
          { key: 'method', label: 'Forma', fmt: 'text' },
          { key: 'expected', label: 'Esperado', fmt: 'money' },
          { key: 'counted', label: 'Contado', fmt: 'money' },
          { key: 'diff', label: 'Diferença', fmt: 'money' },
        ],
        rows: byMethod,
        total: {
          method: 'Total',
          expected: sum(byMethod, (m) => m.expected),
          counted: sum(byMethod, (m) => m.counted),
          diff: sum(byMethod, (m) => m.diff),
        },
      },
      {
        id: 'dinheiro',
        title: 'Como o dinheiro esperado se forma',
        hint: 'Soma de todos os fechamentos do período, só em dinheiro.',
        columns: [
          { key: 'step', label: 'Etapa', fmt: 'text', width: 34 },
          { key: 'value', label: 'Valor', fmt: 'money' },
        ],
        rows: flow,
      },
    ],
    notes: [
      'Esperado = abertura + entradas − saídas registradas no caixa, por forma. Contado = o que foi informado no fechamento.',
    ],
  };
}
