import type { QueryResultRow } from 'pg';
import type { Tx } from '../database/database.service';

/**
 * SQL explícito e parametrizado dentro da transação com contexto de tenant (RLS ativo).
 * Usado nos módulos com regras financeiras/concorrência, onde SQL claro vale mais que o builder.
 */
export async function q<R extends QueryResultRow = QueryResultRow>(
  tx: Tx,
  text: string,
  params: unknown[] = [],
): Promise<R[]> {
  const res = await tx.$client.query<R>(text, params);
  return res.rows;
}

export async function one<R extends QueryResultRow = QueryResultRow>(
  tx: Tx,
  text: string,
  params: unknown[] = [],
): Promise<R | undefined> {
  return (await q<R>(tx, text, params))[0];
}

/** Próximo número sequencial por tenant (pedido, comanda, sessão de caixa). Trava a linha até o COMMIT. */
export async function nextNumber(
  tx: Tx,
  tenantId: string,
  name: 'order' | 'tab' | 'cash_session',
): Promise<number> {
  const row = await one<{ value: string }>(
    tx,
    `INSERT INTO tenant_counters (tenant_id, name, value) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_counters.value + 1
     RETURNING value`,
    [tenantId, name],
  );
  return Number(row!.value);
}
