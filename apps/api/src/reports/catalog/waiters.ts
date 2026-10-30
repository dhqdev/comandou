import {
  challengeProgress,
  WAITER_DAILY_CHALLENGES,
  waiterLevel,
  type WaiterDay,
} from '@comandou/shared';
import { type Built, dailySeries, n, type Period, q, serial, sum } from './kit';

/**
 * Pontuação e desafios dos garçons: os mesmos números do app do garçom (selo pelo total de
 * pedidos lançados e desafios do dia), agora para o gestor ver todos juntos e por período.
 * Como no app, conta todo pedido lançado pelo garçom que não foi cancelado.
 */

const LANCADO = `o.status <> 'cancelled'`;

/** Nome do desafio sem o "hoje" (na tabela do período, cada coluna conta dias). */
const short = (title: string) => title.replace(/ hoje$/, '');

interface DayRow {
  uid: string;
  day: string;
  orders: number;
  tables: number;
  sales: string;
}

/** Quantos desafios do dia um garçom cumpriu num dia. */
const doneIn = (d: WaiterDay) =>
  WAITER_DAILY_CHALLENGES.filter((c) => challengeProgress(c, d) >= 1).length;

const asDay = (r: DayRow): WaiterDay => ({
  orders: n(r.orders),
  tables: n(r.tables),
  sales: String(r.sales),
});

async function days(p: Period, from: Date, to: Date): Promise<DayRow[]> {
  return q<DayRow & Record<string, unknown>>(
    p.tx,
    `SELECT o.created_by AS uid, to_char(o.created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
            count(*)::int AS orders, count(DISTINCT o.tab_id)::int AS tables,
            COALESCE(sum(o.total), 0)::text AS sales
       FROM orders o JOIN memberships m ON m.user_id = o.created_by AND m.role = 'waiter'
      WHERE o.created_at >= $1 AND o.created_at < $2 AND ${LANCADO}
      GROUP BY 1, 2`,
    [from, to, p.tz],
  );
}

export async function garcons(p: Period): Promise<Built> {
  const [people, cur, prev, today] = await serial(
    () =>
      q(
        p.tx,
        `SELECT u.id, u.name, m.status,
                count(o.id)::int AS total,
                count(o.id) FILTER (WHERE o.created_at < $1)::int AS before,
                count(o.id) FILTER (WHERE o.created_at < $2)::int AS upto
           FROM memberships m JOIN users u ON u.id = m.user_id
           LEFT JOIN orders o ON o.created_by = u.id AND ${LANCADO}
          WHERE m.role = 'waiter'
          GROUP BY u.id, u.name, m.status ORDER BY u.name`,
        [p.a, p.b],
      ),
    () => days(p, p.a, p.b),
    () => days(p, p.pa, p.a),
    () =>
      q<DayRow & Record<string, unknown>>(
        p.tx,
        `SELECT o.created_by AS uid, '' AS day, count(*)::int AS orders,
                count(DISTINCT o.tab_id)::int AS tables, COALESCE(sum(o.total), 0)::text AS sales
           FROM orders o
          WHERE ${LANCADO} AND o.created_by IS NOT NULL
            AND o.created_at >= (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1)
          GROUP BY 1`,
        [p.tz],
      ),
  );

  const byUser = new Map<string, DayRow[]>();
  for (const r of cur) byUser.set(String(r.uid), [...(byUser.get(String(r.uid)) ?? []), r]);
  const todayOf = new Map(today.map((r) => [String(r.uid), asDay(r)]));

  const rows = people
    .map((w) => {
      const list = byUser.get(String(w.id)) ?? [];
      const level = waiterLevel(n(w.total));
      const challenges = list.reduce((s, r) => s + doneIn(asDay(r)), 0);
      const perChallenge = Object.fromEntries(
        WAITER_DAILY_CHALLENGES.map((c) => [
          c.id,
          list.filter((r) => challengeProgress(c, asDay(r)) >= 1).length,
        ]),
      );
      const td = todayOf.get(String(w.id)) ?? { orders: 0, tables: 0, sales: '0' };
      const worked = list.length;
      return {
        name: String(w.name),
        status: w.status === 'active' ? 'Ativo' : 'Inativo',
        active: w.status === 'active',
        seal: level.seal.name,
        total: n(w.total),
        next: level.next
          ? `${level.missing} ${level.missing === 1 ? 'pedido' : 'pedidos'} para ${level.next.name}`
          : 'Todos os selos',
        sealsWon: waiterLevel(n(w.upto)).index - waiterLevel(n(w.before)).index,
        orders: sum(list, (r) => n(r.orders)),
        tables: sum(list, (r) => n(r.tables)),
        sales: sum(list, (r) => n(r.sales)),
        worked,
        challenges,
        perDay: worked ? Math.round((challenges / worked) * 10) / 10 : 0,
        perChallenge,
        today: td,
        todayDone: doneIn(td),
      };
    })
    // Inativos só aparecem se lançaram algo no período.
    .filter((r) => r.active || r.orders > 0)
    .sort((x, y) => y.challenges - x.challenges || y.orders - x.orders || y.total - x.total);

  const teamDay = (list: DayRow[]) => {
    const m = new Map<string, number>();
    for (const r of list) m.set(r.day, (m.get(r.day) ?? 0) + doneIn(asDay(r)));
    return m;
  };
  const curDays = teamDay(cur);
  const prevDays = teamDay(prev);
  const done = [...curDays.values()].reduce((s, v) => s + v, 0);
  const donePrev = [...prevDays.values()].reduce((s, v) => s + v, 0);
  const orders = sum(rows, (r) => r.orders);
  const ordersPrev = sum(prev, (r) => n(r.orders));
  const top = rows.find((r) => r.challenges > 0 || r.orders > 0);
  const nC = WAITER_DAILY_CHALLENGES.length;
  const tiers = new Map<string, number>();
  for (const r of rows.filter((x) => x.active)) tiers.set(r.seal, (tiers.get(r.seal) ?? 0) + 1);

  return {
    kpis: [
      {
        label: 'Desafios cumpridos',
        value: done,
        fmt: 'int',
        prev: donePrev,
        main: true,
        hint: `${nC} desafios por dia para cada garçom`,
      },
      {
        label: 'Quem mais pontuou',
        value: top?.name ?? '—',
        fmt: 'text',
        hint: top ? `${top.challenges} desafios · ${top.orders} pedidos` : undefined,
      },
      { label: 'Pedidos dos garçons', value: orders, fmt: 'int', prev: ordersPrev },
      {
        label: 'Selos conquistados',
        value: sum(rows, (r) => r.sealsWon),
        fmt: 'int',
        hint: `${rows.filter((r) => r.active).length} garçons ativos`,
      },
    ],
    charts: [
      {
        kind: 'bars',
        title: 'Desafios cumpridos por garçom',
        fmt: 'int',
        points: rows
          .filter((r) => r.challenges > 0)
          .map((r) => ({ label: r.name, value: r.challenges, hint: `${r.worked} dias` })),
      },
      {
        kind: 'line',
        title: 'Desafios cumpridos pela equipe, dia a dia',
        fmt: 'int',
        series: ['Este período', 'Período anterior'],
        points: dailySeries(p, curDays, prevDays),
        wide: true,
      },
      {
        kind: 'donut',
        title: 'Garçons por selo',
        fmt: 'int',
        points: [...tiers].map(([label, value]) => ({ label, value })),
      },
    ],
    tables: [
      {
        id: 'pontuacao',
        title: 'Pontuação por garçom',
        hint: 'O selo vem do total de pedidos lançados desde o começo; o resto é do período.',
        columns: [
          { key: 'name', label: 'Garçom', fmt: 'text', width: 24 },
          { key: 'status', label: 'Situação', fmt: 'text', width: 10 },
          { key: 'seal', label: 'Selo atual', fmt: 'text', width: 14 },
          { key: 'total', label: 'Pedidos no total', fmt: 'int' },
          { key: 'next', label: 'Próximo selo', fmt: 'text', width: 26 },
          { key: 'sealsWon', label: 'Selos no período', fmt: 'int' },
          { key: 'orders', label: 'Pedidos no período', fmt: 'int' },
          { key: 'tables', label: 'Mesas atendidas', fmt: 'int' },
          { key: 'sales', label: 'Vendido', fmt: 'money' },
          { key: 'worked', label: 'Dias com pedido', fmt: 'int' },
          { key: 'challenges', label: 'Desafios cumpridos', fmt: 'int' },
          { key: 'perDay', label: 'Desafios por dia', fmt: 'num' },
        ],
        rows: rows.map(({ perChallenge: _a, today: _b, todayDone: _c, active: _d, ...r }) => r),
        total: {
          name: 'Total',
          total: sum(rows, (r) => r.total),
          sealsWon: sum(rows, (r) => r.sealsWon),
          orders,
          tables: sum(rows, (r) => r.tables),
          sales: sum(rows, (r) => r.sales),
          challenges: done,
        },
        bar: 'challenges',
      },
      {
        id: 'desafios',
        title: 'Dias em que cada desafio foi cumprido',
        columns: [
          { key: 'name', label: 'Garçom', fmt: 'text', width: 24 },
          ...WAITER_DAILY_CHALLENGES.map((c) => ({
            key: c.id,
            label: short(c.title),
            fmt: 'int' as const,
            width: 18,
          })),
          { key: 'challenges', label: 'Total', fmt: 'int' },
        ],
        rows: rows.map((r) => ({ name: r.name, ...r.perChallenge, challenges: r.challenges })),
        total: {
          name: 'Total',
          ...Object.fromEntries(
            WAITER_DAILY_CHALLENGES.map((c) => [c.id, sum(rows, (r) => r.perChallenge[c.id]!)]),
          ),
          challenges: done,
        },
        bar: 'challenges',
      },
      {
        id: 'hoje',
        title: 'Desafios de hoje (agora)',
        hint: 'Não depende do período escolhido: é o placar de hoje, como o garçom vê no app.',
        columns: [
          { key: 'name', label: 'Garçom', fmt: 'text', width: 24 },
          { key: 'orders', label: 'Pedidos hoje', fmt: 'int' },
          { key: 'tables', label: 'Mesas hoje', fmt: 'int' },
          { key: 'sales', label: 'Vendido hoje', fmt: 'money' },
          { key: 'done', label: `Desafios cumpridos (de ${nC})`, fmt: 'int', width: 16 },
          { key: 'missing', label: 'Falta', fmt: 'text', width: 40 },
        ],
        rows: rows
          .filter((r) => r.active)
          .map((r) => ({
            name: r.name,
            orders: r.today.orders,
            tables: r.today.tables,
            sales: n(r.today.sales),
            done: r.todayDone,
            missing:
              WAITER_DAILY_CHALLENGES.filter((c) => challengeProgress(c, r.today) < 1)
                .map((c) => c.title)
                .join('; ') || 'Cumpriu todos',
          }))
          .sort((x, y) => y.done - x.done || y.orders - x.orders),
        bar: 'done',
      },
    ],
    notes: [
      'Como no app do garçom: cada pedido lançado e não cancelado conta. O selo sobe com o total de pedidos (Iniciante no 1º, Aprendiz no 5º, até Hall da fama no 500º).',
      `Desafios do dia: ${WAITER_DAILY_CHALLENGES.map((c) => short(c.title).toLowerCase()).join(', ')}. Recomeçam à meia-noite.`,
      'A ordem do ranking é desafios cumpridos, depois pedidos no período.',
    ],
  };
}
