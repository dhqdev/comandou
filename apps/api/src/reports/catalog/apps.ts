import { channelInfo } from '@comandou/shared';
import { type Built, n, pct, type Period, q, r2, SOLD, serial, sum } from './kit';

/** Rótulo da linha: o aplicativo ou a venda própria (equipe, PDV e cardápio online). */
const OWN = '';
const labelOf = (p: Period, ch: string) =>
  ch === OWN ? 'Venda própria (sem aplicativo)' : channelInfo(ch, p.labels?.[ch]).label;

interface Row {
  ch: string;
  sold_n: number;
  sold: string;
  cancelled: number;
  fees: string;
  net: string;
  fin_n: number;
}

async function byChannel(p: Period, a: Date, b: Date) {
  return q<Row>(
    p.tx,
    `SELECT COALESCE(o.app_channel, '') AS ch,
            count(*) FILTER (WHERE ${SOLD})::int AS sold_n,
            COALESCE(sum(o.total) FILTER (WHERE ${SOLD}), 0)::text AS sold,
            count(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
            COALESCE(sum(c.fin_fees) FILTER (WHERE ${SOLD}), 0)::text AS fees,
            COALESCE(sum(c.fin_net) FILTER (WHERE ${SOLD}), 0)::text AS net,
            count(c.fin_fees) FILTER (WHERE ${SOLD})::int AS fin_n
       FROM orders o LEFT JOIN channel_orders c ON c.order_id = o.id
      WHERE o.created_at >= $1 AND o.created_at < $2
      GROUP BY 1`,
    [a, b],
  );
}

/**
 * Vendas por aplicativo (ADR 0015, Fase 14): pedidos, vendido, ticket, cancelados, taxas e
 * líquido de cada aplicativo de delivery lado a lado, com a venda própria para comparar. Taxas e
 * líquido só dos pedidos cujo repasse já foi lido (Financeiro › Aplicativos).
 */
export async function aplicativos(p: Period): Promise<Built> {
  const [now, prev] = await serial(
    () => byChannel(p, p.a, p.b),
    () => byChannel(p, p.pa, p.a),
  );
  const prevOf = new Map(prev.map((r) => [r.ch, r]));
  const all = sum(now, (r) => n(r.sold));
  const apps = now.filter((r) => r.ch !== OWN && (r.sold_n > 0 || r.cancelled > 0));
  const prevApps = prev.filter((r) => r.ch !== OWN);
  const appSold = sum(apps, (r) => n(r.sold));
  const appOrders = apps.reduce((s, r) => s + r.sold_n, 0);
  const prevSold = sum(prevApps, (r) => n(r.sold));
  const prevOrders = prevApps.reduce((s, r) => s + r.sold_n, 0);
  const fees = sum(apps, (r) => n(r.fees));
  const withFin = apps.reduce((s, r) => s + r.fin_n, 0);
  const cancelled = apps.reduce((s, r) => s + r.cancelled, 0);
  const prevCancelled = prevApps.reduce((s, r) => s + r.cancelled, 0);
  const own = now.find((r) => r.ch === OWN);

  const line = (r: Row) => {
    const sold = n(r.sold);
    const before = prevOf.get(r.ch);
    return {
      channel: labelOf(p, r.ch),
      orders: r.sold_n,
      sold,
      ticket: r.sold_n ? r2(sold / r.sold_n) : 0,
      share: pct(sold, all),
      cancelled: r.cancelled,
      fees: r.ch === OWN ? null : r.fin_n ? n(r.fees) : null,
      net: r.ch === OWN ? null : r.fin_n ? n(r.net) : null,
      prev: before ? n(before.sold) : 0,
    };
  };
  const sorted = [...apps]
    .sort((x, y) => n(y.sold) - n(x.sold))
    .concat(own && (own.sold_n || own.cancelled) ? [own] : []);
  const rows = sorted.map(line);

  return {
    kpis: [
      {
        label: 'Vendido pelos aplicativos',
        value: appSold,
        fmt: 'money',
        prev: prevSold,
        main: true,
      },
      { label: 'Pedidos dos aplicativos', value: appOrders, fmt: 'int', prev: prevOrders },
      {
        label: 'Ticket médio nos aplicativos',
        value: appOrders ? r2(appSold / appOrders) : 0,
        fmt: 'money',
        prev: prevOrders ? r2(prevSold / prevOrders) : null,
      },
      { label: '% das vendas pelos aplicativos', value: pct(appSold, all), fmt: 'pct' },
      {
        label: 'Taxas dos aplicativos',
        value: fees,
        fmt: 'money',
        invert: true,
        hint: withFin
          ? `de ${withFin} ${withFin === 1 ? 'pedido' : 'pedidos'} com repasse lido`
          : 'nenhum repasse lido ainda',
      },
      {
        label: 'Cancelados nos aplicativos',
        value: cancelled,
        fmt: 'int',
        prev: prevCancelled,
        invert: true,
      },
    ],
    charts: apps.length
      ? [
          {
            kind: 'donut',
            title: 'Vendido por aplicativo',
            fmt: 'money',
            points: rows.map((r) => ({ label: r.channel, value: r.sold })),
          },
          {
            kind: 'bars',
            title: 'Pedidos por aplicativo',
            fmt: 'int',
            points: sorted.map((r) => ({
              label: labelOf(p, r.ch),
              value: r.sold_n,
              prev: prevOf.get(r.ch)?.sold_n ?? 0,
            })),
          },
        ]
      : [],
    tables: [
      {
        id: 'aplicativos',
        title: 'Cada aplicativo',
        columns: [
          { key: 'channel', label: 'Aplicativo', fmt: 'text', width: 30 },
          { key: 'orders', label: 'Pedidos', fmt: 'int' },
          { key: 'sold', label: 'Vendido', fmt: 'money' },
          { key: 'ticket', label: 'Ticket médio', fmt: 'money' },
          { key: 'share', label: '% do vendido', fmt: 'pct' },
          { key: 'cancelled', label: 'Cancelados', fmt: 'int' },
          { key: 'fees', label: 'Taxas do aplicativo', fmt: 'money' },
          { key: 'net', label: 'Líquido do repasse', fmt: 'money' },
          { key: 'prev', label: 'Período anterior', fmt: 'money' },
        ],
        rows,
        total: {
          channel: 'Total',
          orders: rows.reduce((s, r) => s + r.orders, 0),
          sold: sum(rows, (r) => r.sold),
          cancelled: rows.reduce((s, r) => s + r.cancelled, 0),
          fees: sum(rows, (r) => r.fees ?? 0),
          net: sum(rows, (r) => r.net ?? 0),
          prev: sum(rows, (r) => r.prev),
        },
        bar: 'sold',
      },
    ],
    notes: [
      'Vendido = o que o aplicativo cobrou do cliente (valor do pedido), sem os cancelados e os ainda em análise.',
      'Taxas e líquido vêm do repasse que o Comandou lê de cada aplicativo (Financeiro › Aplicativos). Pedido sem repasse lido fica em branco nessas colunas.',
      'Venda própria = PDV, salão, balcão e cardápio online, para comparar.',
    ],
  };
}
