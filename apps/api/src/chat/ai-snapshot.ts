import { ROLE_LABELS, type Role } from '@comandou/shared';
import { one, q } from '../common/sql';
import type { Tx } from '../database/database.service';

/**
 * Pedaços do "Estado agora" que o assistente da equipe recebe (0.269, pedido do David: "veja se
 * ela tem acesso a tudo quando o meu cliente pergunta"). Cada função roda no banco do restaurante
 * e devolve frases curtas; quem chama decide pela permissão de quem pergunta. Nada de nome,
 * telefone ou e-mail de cliente: só contagens e nomes de itens do cardápio e insumos.
 */

/** Começo do dia de hoje no fuso do restaurante. */
const TODAY = `(date_trunc('day', now() AT TIME ZONE (SELECT timezone FROM tenants LIMIT 1))
                 AT TIME ZONE (SELECT timezone FROM tenants LIMIT 1))`;

/** Pedido que conta como venda: nem cancelado, nem esperando o pagamento online. */
const SOLD = `status NOT IN ('awaiting', 'cancelled')`;

/** "1234.5" → "R$ 1.234,50". */
export function brl(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(v);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "2.000" → "2", "1.500" → "1,5". */
function qty(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/** Vendas de hoje (com ontem para comparar) e, para quem vê relatórios, os mais vendidos. */
export async function salesLines(tx: Tx, withTop: boolean): Promise<string[]> {
  const r = await one<{
    n: number;
    total: string;
    y_n: number;
    y_total: string;
    table: number;
    counter: number;
    delivery: number;
    pickup: number;
    online: number;
    app: number;
  }>(
    tx,
    `SELECT count(*) FILTER (WHERE created_at >= ${TODAY})::int AS n,
            coalesce(sum(total) FILTER (WHERE created_at >= ${TODAY}), 0)::text AS total,
            count(*) FILTER (WHERE created_at < ${TODAY})::int AS y_n,
            coalesce(sum(total) FILTER (WHERE created_at < ${TODAY}), 0)::text AS y_total,
            count(*) FILTER (WHERE created_at >= ${TODAY} AND channel = 'table')::int AS "table",
            count(*) FILTER (WHERE created_at >= ${TODAY} AND channel = 'counter')::int AS counter,
            count(*) FILTER (WHERE created_at >= ${TODAY} AND channel = 'delivery')::int AS delivery,
            count(*) FILTER (WHERE created_at >= ${TODAY} AND channel = 'pickup')::int AS pickup,
            count(*) FILTER (WHERE created_at >= ${TODAY} AND source = 'online')::int AS online,
            count(*) FILTER (WHERE created_at >= ${TODAY} AND source = 'app')::int AS app
       FROM orders
      WHERE ${SOLD} AND created_at >= ${TODAY} - interval '1 day'`,
  );
  if (!r) return [];
  const out: string[] = [];
  const ticket = r.n > 0 ? Number(r.total) / r.n : 0;
  const how = [
    r.table && `${r.table} no salão`,
    r.counter && `${r.counter} no balcão`,
    r.delivery && `${r.delivery} entrega(s)`,
    r.pickup && `${r.pickup} retirada(s)`,
  ].filter(Boolean);
  const from = [
    r.online && `${r.online} pelo cardápio online`,
    r.app && `${r.app} pelos aplicativos`,
  ]
    .filter(Boolean)
    .join(', ');
  out.push(
    `Vendas de hoje até agora: ${r.n} pedido(s), ${brl(r.total)}${r.n ? `, ticket médio ${brl(ticket)}` : ''}${how.length ? ` (${how.join(', ')}${from ? `; ${from}` : ''})` : ''}. Ontem, o dia todo: ${r.y_n} pedido(s), ${brl(r.y_total)}.`,
  );
  if (withTop) {
    const top = await q<{ name: string; qty: string; total: string }>(
      tx,
      `SELECT p.name, sum(i.quantity)::text AS qty, sum(i.quantity * i.unit_price)::text AS total
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         JOIN products p ON p.id = i.product_id
        WHERE o.${SOLD} AND i.status <> 'cancelled' AND o.created_at >= now() - interval '7 days'
        GROUP BY p.id, p.name
        ORDER BY sum(i.quantity) DESC
        LIMIT 5`,
    );
    if (top.length)
      out.push(
        `Mais vendidos nos últimos 7 dias: ${top.map((t) => `${t.name} (${qty(t.qty)}, ${brl(t.total)})`).join('; ')}.`,
      );
  }
  return out;
}

/** Insumos no mínimo ou abaixo dele (o que precisa comprar). */
export async function stockLines(tx: Tx): Promise<string[]> {
  const rows = await q<{ name: string; unit: string; quantity: string; min: string; n: number }>(
    tx,
    `SELECT name, unit, quantity::text, min_quantity::text AS min, count(*) OVER ()::int AS n
       FROM stock_items
      WHERE active AND min_quantity > 0 AND quantity <= min_quantity
      ORDER BY quantity / min_quantity, name
      LIMIT 8`,
  );
  if (!rows.length) return ['Estoque: nenhum insumo abaixo do mínimo.'];
  const n = rows[0]!.n;
  return [
    `Estoque baixo (${n} insumo(s) no mínimo ou abaixo): ${rows
      .map((r) => `${r.name} ${qty(r.quantity)} ${r.unit} (mínimo ${qty(r.min)})`)
      .join('; ')}${n > rows.length ? '; e outros' : ''}.`,
  ];
}

/** Reservas de hoje (sem nomes) e as entregas em andamento com os entregadores disponíveis. */
export async function todayLines(
  tx: Tx,
  reservations: boolean,
  deliveries: boolean,
): Promise<string[]> {
  const out: string[] = [];
  if (reservations) {
    const r = await one<{ n: number; people: number; pending: number; next: string | null }>(
      tx,
      `SELECT count(*)::int AS n, coalesce(sum(party_size), 0)::int AS people,
              count(*) FILTER (WHERE status = 'pending')::int AS pending,
              to_char(min(starts_at) FILTER (WHERE starts_at > now())
                        AT TIME ZONE (SELECT timezone FROM tenants LIMIT 1), 'HH24:MI') AS next
         FROM reservations
        WHERE status IN ('pending', 'confirmed', 'seated')
          AND starts_at >= ${TODAY} AND starts_at < ${TODAY} + interval '1 day'`,
    );
    if (r)
      out.push(
        r.n
          ? `Reservas de hoje: ${r.n} (${r.people} pessoa(s))${r.pending ? `, ${r.pending} esperando confirmação` : ''}${r.next ? `; a próxima às ${r.next}` : ''}.`
          : 'Reservas de hoje: nenhuma.',
      );
  }
  if (deliveries) {
    const d = await one<{
      kitchen: number;
      ready: number;
      road: number;
      couriers: number;
      free: number;
    }>(
      tx,
      `SELECT count(*) FILTER (WHERE status IN ('new', 'in_production'))::int AS kitchen,
              count(*) FILTER (WHERE status = 'ready')::int AS ready,
              count(*) FILTER (WHERE status = 'dispatched')::int AS road,
              (SELECT count(*)::int FROM couriers WHERE active) AS couriers,
              (SELECT count(*)::int FROM couriers
                WHERE active AND greatest(link_seen_at, app_seen_at) > now() - interval '2 minutes') AS free
         FROM orders
        WHERE channel = 'delivery' AND created_at > now() - interval '1 day'`,
    );
    if (d)
      out.push(
        `Entregas agora: ${d.kitchen} em preparo, ${d.ready} pronta(s) esperando entregador, ${d.road} na rua. Entregadores: ${d.free} com o app aberto de ${d.couriers} cadastrado(s).`,
      );
  }
  return out;
}

/** Clientes cadastrados, equipe por função e se a IA do WhatsApp está ligada. */
export async function registryLines(
  tx: Tx,
  show: { customers: boolean; team: boolean; agent: boolean },
): Promise<string[]> {
  const out: string[] = [];
  if (show.customers) {
    const c = await one<{ total: number; new30: number; birthdays: number }>(
      tx,
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS new30,
              count(*) FILTER (
                WHERE birth_day = extract(day FROM now() AT TIME ZONE (SELECT timezone FROM tenants LIMIT 1))
                  AND birth_month = extract(month FROM now() AT TIME ZONE (SELECT timezone FROM tenants LIMIT 1))
              )::int AS birthdays
         FROM customers`,
    );
    if (c)
      out.push(
        `Clientes: ${c.total} cadastrado(s), ${c.new30} novo(s) nos últimos 30 dias${c.birthdays ? `, ${c.birthdays} fazendo aniversário hoje` : ''}.`,
      );
  }
  if (show.team) {
    const rows = await q<{ role: Role; n: number }>(
      tx,
      `SELECT role, count(*)::int AS n FROM memberships WHERE status = 'active' GROUP BY role ORDER BY 2 DESC`,
    );
    if (rows.length)
      out.push(
        `Equipe ativa: ${rows.map((r) => `${r.n} ${(ROLE_LABELS[r.role] ?? r.role).toLowerCase()}`).join(', ')}.`,
      );
  }
  if (show.agent) {
    const a = await one<{ on: boolean | null }>(
      tx,
      `SELECT (SELECT whatsapp_enabled FROM ai_agent_settings LIMIT 1) AS on`,
    );
    out.push(`IA que atende no WhatsApp: ${a?.on ? 'ligada' : 'desligada'}.`);
  }
  return out;
}
