import { q } from '../common/sql';
import type { Tx } from '../database/database.service';

/**
 * A conta da mesa fechou: a reserva que estava sentada ali termina junto (a mesa fica livre na
 * agenda). Devolve as reservas concluídas para avisar as telas depois do COMMIT.
 */
export async function completeSeatedForTab(tx: Tx, tabId: string): Promise<string[]> {
  const rows = await q<{ id: string }>(
    tx,
    `UPDATE reservations r SET status = 'completed', status_changed_at = now()
       FROM tabs tb
      WHERE tb.id = $1 AND tb.table_id IS NOT NULL AND r.table_id = tb.table_id
        AND r.status = 'seated'
      RETURNING r.id`,
    [tabId],
  );
  return rows.map((r) => r.id);
}
