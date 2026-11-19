import { feeCents, fromCents, toCents, type DreRaw, type PaymentMethod } from '@comandou/shared';
import { one, q } from '../common/sql';
import type { Tx } from '../database/database.service';
import { loadPaymentTerms } from './closing';

export type DreBasis = 'accrual' | 'cash';

/** Filtro de período por dia do restaurante sobre uma coluna timestamptz (usa `tz.timezone`). */
const inPeriod = (col: string) =>
  `${col} >= ($1::date::timestamp AT TIME ZONE tz.timezone) AND ${col} < (($2::date + 1)::timestamp AT TIME ZONE tz.timezone)`;

/**
 * Os números crus do DRE de um período (datas do restaurante, inclusive). Competência: as contas
 * entram pelo vencimento; caixa: pela data em que foram pagas. Vendas sempre pelo dia em que o
 * caixa recebeu. Taxas das maquininhas: as do fechamento (com os acertos da conciliação) e, para
 * caixas ainda abertos, a estimativa pelas taxas cadastradas.
 */
export async function loadDreRaw(
  tx: Tx,
  from: string,
  to: string,
  basis: DreBasis,
): Promise<DreRaw> {
  const sales = await q<{ channel: string; sales: string; refunds: string; orders: number }>(
    tx,
    `WITH tz AS (SELECT timezone FROM tenants),
     mv AS (SELECT m.kind, m.amount, m.order_id FROM cash_movements m CROSS JOIN tz
             WHERE m.kind IN ('sale','refund') AND ${inPeriod('m.created_at')})
     SELECT COALESCE(o.channel, 'other') AS channel,
            COALESCE(sum(mv.amount) FILTER (WHERE mv.kind = 'sale'), 0)::numeric(14,2)::text AS sales,
            COALESCE(-sum(mv.amount) FILTER (WHERE mv.kind = 'refund'), 0)::numeric(14,2)::text AS refunds,
            count(DISTINCT mv.order_id) FILTER (WHERE mv.kind = 'sale')::int AS orders
       FROM mv LEFT JOIN orders o ON o.id = mv.order_id GROUP BY 1`,
    [from, to],
  );
  const entries = await q<{
    kind: 'payable' | 'receivable';
    category: string | null;
    amount: string;
  }>(
    tx,
    basis === 'accrual'
      ? `SELECT kind, category, sum(amount)::text AS amount FROM finance_entries
          WHERE status <> 'cancelled' AND due_date BETWEEN $1 AND $2 GROUP BY kind, category`
      : `SELECT kind, category, sum(amount)::text AS amount FROM finance_entries
          WHERE status = 'paid' AND paid_at BETWEEN $1 AND $2 GROUP BY kind, category`,
    [from, to],
  );
  const fees = await one<{ fees: string; adjust: string }>(
    tx,
    `SELECT COALESCE((SELECT sum(fee) FROM finance_settlements WHERE day BETWEEN $1 AND $2), 0)::numeric(14,2)::text AS fees,
            COALESCE((SELECT sum(r.difference) FROM bank_reconciliations r
                       WHERE r.kind IN ('settlement','manual')
                         AND r.id IN (SELECT reconciliation_id FROM finance_settlements
                                       WHERE day BETWEEN $1 AND $2 AND method <> 'cash')), 0)::numeric(14,2)::text AS adjust`,
    [from, to],
  );
  // Caixas ainda sem lançamento (abertos agora, ou fechados antes desta versão): estimativa.
  const unposted = await q<{ method: PaymentMethod; total: string }>(
    tx,
    `WITH tz AS (SELECT timezone FROM tenants)
     SELECT m.method, sum(m.amount)::text AS total FROM cash_movements m CROSS JOIN tz
      WHERE m.kind IN ('sale','refund') AND m.method <> 'cash' AND ${inPeriod('m.created_at')}
        AND NOT EXISTS (SELECT 1 FROM finance_settlements fs WHERE fs.cash_session_id = m.cash_session_id)
      GROUP BY m.method`,
    [from, to],
  );
  const terms = unposted.length ? await loadPaymentTerms(tx) : null;
  const estimated = unposted.reduce(
    (a, r) => a + feeCents(toCents(r.total), terms![r.method].feePercent),
    0,
  );
  const stock = await one<{ cmv: string; losses: string }>(
    tx,
    `WITH tz AS (SELECT timezone FROM tenants)
     SELECT round(COALESCE(-sum(m.quantity * COALESCE(m.unit_cost, s.avg_cost))
                    FILTER (WHERE m.kind IN ('sale','sale_reversal')), 0), 2)::text AS cmv,
            round(COALESCE(-sum(m.quantity * COALESCE(m.unit_cost, s.avg_cost))
                    FILTER (WHERE m.kind = 'loss'), 0), 2)::text AS losses
       FROM stock_movements m JOIN stock_items s ON s.id = m.stock_item_id CROSS JOIN tz
      WHERE ${inPeriod('m.created_at')}`,
    [from, to],
  );
  // Pago dentro dos aplicativos (forma 'app', sem caixa): venda pelo dia do pagamento, sem o que
  // o aplicativo estornou. As taxas vêm do financeiro do aplicativo (só vendas já fechadas lá).
  const app = await q<{ app: string; amount: string; orders: number }>(
    tx,
    `WITH tz AS (SELECT timezone FROM tenants)
     SELECT p.app_channel AS app, sum(p.amount - p.refunded_amount)::numeric(14,2)::text AS amount,
            count(DISTINCT p.order_id) FILTER (WHERE p.amount > p.refunded_amount)::int AS orders
       FROM payments p CROSS JOIN tz
      WHERE p.method = 'app' AND ${inPeriod('p.created_at')}
      GROUP BY 1`,
    [from, to],
  );
  const appFees = await one<{ total: string }>(
    tx,
    `WITH tz AS (SELECT timezone FROM tenants)
     SELECT COALESCE(sum(co.fin_fees), 0)::numeric(14,2)::text AS total
       FROM channel_orders co JOIN orders o ON o.id = co.order_id CROSS JOIN tz
      WHERE co.fin_fees IS NOT NULL AND ${inPeriod('o.created_at')}`,
    [from, to],
  );
  const breaks = await one<{ total: string }>(
    tx,
    `WITH tz AS (SELECT timezone FROM tenants)
     SELECT COALESCE(sum(COALESCE((s.counted->>'cash')::numeric, 0) - COALESCE((s.expected->>'cash')::numeric, 0)), 0)::numeric(14,2)::text AS total
       FROM cash_sessions s CROSS JOIN tz
      WHERE s.status = 'closed' AND ${inPeriod('s.opened_at')}`,
    [from, to],
  );
  return {
    sales: sales.map((s) => ({ channel: s.channel, amount: s.sales })),
    refunds: fromCents(sales.reduce((a, s) => a + toCents(s.refunds), 0)),
    orders: sales.reduce((a, s) => a + s.orders, 0),
    entries,
    // Diferença negativa na conciliação = caiu menos que o previsto = taxa maior.
    cardFees: fromCents(toCents(fees!.fees) - toCents(fees!.adjust) + estimated),
    stockCmv: stock!.cmv,
    stockLosses: stock!.losses,
    cashBreaks: breaks!.total,
    appSales: app,
    appFees: appFees!.total,
  };
}
