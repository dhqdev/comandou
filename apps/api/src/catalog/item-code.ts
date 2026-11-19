import { one } from '../common/sql';
import type { Tx } from '../database/database.service';

/** Próximo código livre no padrão IT-000001 (os digitados à mão em outro formato não contam). */
export async function nextItemCode(tx: Tx) {
  const r = await one<{ n: number }>(
    tx,
    `SELECT COALESCE(max(substring(code from '^IT-([0-9]{1,9})$')::int), 0) + 1 AS n FROM products`,
  );
  return `IT-${String(r?.n ?? 1).padStart(6, '0')}`;
}
