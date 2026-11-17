import {
  feeCents,
  fromCents,
  normalizePaymentTerms,
  PAYMENT_METHODS,
  settlementDate,
  toCents,
  type PaymentMethod,
  type PaymentTerms,
} from '@comandou/shared';
import { one, q } from '../common/sql';
import type { Tx } from '../database/database.service';

/**
 * Taxas e prazos das maquininhas do restaurante (o salvo completado com o padrão). Na API o RLS
 * já filtra o restaurante; `tenantId` serve para quem roda como dono do banco (demonstração).
 */
export async function loadPaymentTerms(tx: Tx, tenantId?: string): Promise<PaymentTerms> {
  const r = await one<{ terms: unknown }>(
    tx,
    `SELECT payment_terms AS terms FROM finance_settings WHERE ($1::uuid IS NULL OR tenant_id = $1)`,
    [tenantId ?? null],
  );
  return normalizePaymentTerms(r?.terms ?? null);
}

/** Vendas líquidas (vendas − estornos) de cada forma de pagamento numa sessão de caixa. */
export async function sessionNetByMethod(tx: Tx, sessionId: string) {
  const rows = await q<{ method: PaymentMethod; total: string }>(
    tx,
    `SELECT method, sum(amount)::text AS total FROM cash_movements
      WHERE cash_session_id = $1 AND kind IN ('sale','refund') GROUP BY method`,
    [sessionId],
  );
  const out = new Map<PaymentMethod, number>();
  for (const r of rows) out.set(r.method, toCents(r.total));
  return out;
}

/**
 * Leva um caixa fechado para o financeiro: uma linha por forma de pagamento com o bruto, a taxa
 * da maquininha, o líquido e o dia em que o dinheiro deve cair na conta. O dinheiro da gaveta já
 * nasce recebido (foi contado no fechamento). Roda na mesma transação do fechamento; chamar de
 * novo não duplica nada (uma linha por sessão e forma).
 */
export async function postCashSession(
  tx: Tx,
  tenantId: string,
  userId: string | null,
  sessionId: string,
): Promise<number> {
  const s = await one<{ day: string; status: string }>(
    tx,
    `SELECT (s.opened_at AT TIME ZONE t.timezone)::date::text AS day, s.status
       FROM cash_sessions s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1`,
    [sessionId],
  );
  if (!s || s.status !== 'closed') return 0;
  const terms = await loadPaymentTerms(tx, tenantId);
  const net = await sessionNetByMethod(tx, sessionId);
  let posted = 0;
  for (const m of PAYMENT_METHODS) {
    const gross = net.get(m) ?? 0;
    if (gross === 0) continue;
    const term = terms[m];
    const fee = m === 'cash' ? 0 : feeCents(gross, term.feePercent);
    const expected = m === 'cash' ? s.day : settlementDate(s.day, term.days);
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO finance_settlements (tenant_id, cash_session_id, day, method, gross, fee_percent, fee, net,
                                        expected_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, cash_session_id, method) DO NOTHING RETURNING id`,
      [
        tenantId,
        sessionId,
        s.day,
        m,
        fromCents(gross),
        m === 'cash' ? '0.00' : term.feePercent,
        fromCents(fee),
        fromCents(gross - fee),
        expected,
        userId,
      ],
    );
    if (!row) continue;
    posted++;
    if (m === 'cash') {
      // Dinheiro: contado na gaveta, já está com o restaurante.
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO bank_reconciliations (tenant_id, kind, day, lines_total, target_total, difference, auto, note, created_by)
         VALUES ($1,'manual',$2,$3,$3,0,true,'Dinheiro conferido no fechamento do caixa',$4) RETURNING id`,
        [tenantId, s.day, fromCents(gross), userId],
      );
      await q(tx, `UPDATE finance_settlements SET reconciliation_id = $2 WHERE id = $1`, [
        row.id,
        r!.id,
      ]);
    }
  }
  return posted;
}
