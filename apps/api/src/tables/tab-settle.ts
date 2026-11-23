import { PaymentMethod, toCents } from '@comandou/shared';
import type { AuditService } from '../audit/audit.service';
import type { CashService } from '../cash/cash.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import type { Tx } from '../database/database.service';
import { ON_ACCOUNT_SQL, OrderRow } from '../orders/orders.service';
import { completeSeatedForTab } from '../reservations/seated';

/**
 * Pagar a conta inteira da mesa de uma vez (comprovante do Pix aprovado ou PagBank): o valor
 * entra nos pedidos da comanda, do mais antigo ao mais novo, e a mesa fica livre quando não sobra
 * saldo nem nada em preparo. Usado por `TableSelfService.approve` e pelo `OnlinePayService`.
 */
export type TabOrder = OrderRow & { pix_status: string | null; on_account: boolean };

const ORDER_COLS = `o.id, o.number, o.channel, o.status, o.total::text, o.subtotal::text,
  o.discount::text, o.surcharge::text, o.delivery_fee::text, o.paid_amount::text,
  o.payment_status, o.tab_id, o.version, o.pix_status, ${ON_ACCOUNT_SQL} AS on_account`;

/** Pedidos da comanda (travados com `lock`: a ordem do caixa é comanda → pedidos). */
export function tabOrdersIn(tx: Tx, tabId: string, lock = false) {
  return q<TabOrder>(
    tx,
    `SELECT ${ORDER_COLS} FROM orders o WHERE o.tab_id = $1 ORDER BY o.created_at, o.id
      ${lock ? 'FOR UPDATE' : ''}`,
    [tabId],
  );
}

/** Saldo que a conta da mesa cobra (sem o fiado e o "a receber", que são cobrados à parte). */
export const tabDueOf = (orders: TabOrder[]) =>
  orders
    .filter((o) => o.status !== 'cancelled' && !o.on_account)
    .reduce((s, o) => s + Math.max(0, toCents(o.total) - toCents(o.paid_amount)), 0);

/**
 * Lança até `cents` (nunca mais que o saldo) nos pedidos em aberto da comanda, do mais antigo ao
 * mais novo. Quem chama já travou a sessão do caixa, a comanda e os pedidos (`tabOrdersIn(…, true)`).
 */
export async function payTabOrdersIn(
  tx: Tx,
  ctx: Ctx,
  cash: CashService,
  orders: TabOrder[],
  p: { cashSessionId: string; method: PaymentMethod; cents: number },
) {
  let left = Math.min(p.cents, tabDueOf(orders));
  const applied = left;
  const payments: { id: string; orderId: string; cents: number }[] = [];
  for (const o of orders) {
    if (left === 0) break;
    if (o.status === 'cancelled' || o.on_account) continue;
    const open = toCents(o.total) - toCents(o.paid_amount);
    if (open <= 0) continue;
    const part = Math.min(open, left);
    const pay = await cash.applyPayment(tx, ctx, o, {
      cashSessionId: p.cashSessionId,
      method: p.method,
      amountCents: part,
    });
    payments.push({ id: pay.id, orderId: o.id, cents: part });
    left -= part;
  }
  return { applied, payments };
}

/** Comanda sem saldo e sem pedido aberto: fecha (a mesa fica livre). */
export async function closeTabIfDoneIn(
  tx: Tx,
  audit: AuditService,
  ctx: Ctx,
  tabId: string,
  auto: string,
) {
  const left = await one<{ open: number; due: string; number: number }>(
    tx,
    `SELECT count(o.id) FILTER (WHERE o.status NOT IN ('completed','cancelled'))::int AS open,
            COALESCE(sum(o.total - o.paid_amount)
              FILTER (WHERE o.status <> 'cancelled' AND NOT ${ON_ACCOUNT_SQL}), 0)::text AS due,
            tb.number
       FROM tabs tb LEFT JOIN orders o ON o.tab_id = tb.id
      WHERE tb.id = $1 AND tb.status = 'open'
      GROUP BY tb.id`,
    [tabId],
  );
  if (!left || left.open > 0 || toCents(left.due) > 0)
    return { done: false, reservations: [] as string[] };
  await q(
    tx,
    `UPDATE tabs SET status = 'closed', closed_by = $2, closed_at = now() WHERE id = $1`,
    [tabId, ctx.userId],
  );
  const reservations = await completeSeatedForTab(tx, tabId);
  await audit.record(tx, {
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    action: 'tab.closed',
    entity: 'tab',
    entityId: tabId,
    data: { number: left.number, auto },
    ip: ctx.ip,
  });
  return { done: true, reservations };
}
