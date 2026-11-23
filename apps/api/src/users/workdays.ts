import { q } from '../common/sql';
import type { Tx } from '../database/database.service';

/**
 * Marca o dia de trabalho de quem está usando o sistema (diárias da equipe). Num ponto de
 * salvamento: se falhar (sem contexto do restaurante, por exemplo), a sessão segue normal.
 */
export async function markWorkday(tx: Tx, tenantId: string, userId: string) {
  await q(tx, 'SAVEPOINT staff_workday');
  try {
    await q(
      tx,
      `INSERT INTO staff_workdays (tenant_id, user_id, day)
       VALUES ($1, $2, (now() AT TIME ZONE COALESCE((SELECT timezone FROM tenants WHERE id = $1),
                                                     'America/Sao_Paulo'))::date)
       ON CONFLICT (tenant_id, user_id, day) DO UPDATE SET last_at = now()`,
      [tenantId, userId],
    );
    await q(tx, 'RELEASE SAVEPOINT staff_workday');
  } catch {
    await q(tx, 'ROLLBACK TO SAVEPOINT staff_workday');
  }
}
