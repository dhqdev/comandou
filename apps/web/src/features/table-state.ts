import { toCents } from '@comandou/shared';
import type { DiningTable } from '../lib/types';

export type TableState = 'free' | 'busy' | 'paying';

/** Mesa "em pagamento": pediu a conta ou já pagou uma parte. */
export function tableState(t: DiningTable): TableState {
  if (!t.tabId) return 'free';
  if (t.billRequestedAt || toCents(t.tabPaid ?? '0') > 0) return 'paying';
  return 'busy';
}

export const STATE_LABEL: Record<TableState, string> = {
  free: 'Livre',
  busy: 'Ocupada',
  paying: 'Em pagamento',
};

/**
 * Lê o QR da mesa: aceita o link /mesa/<id>, o do cardápio (/pedir?mesa=<id>), o id puro ou o
 * número da mesa.
 */
export function tableFromQr(text: string, tables: DiningTable[]): DiningTable | undefined {
  const raw = text.trim();
  const m = raw.match(/(?:\/mesa\/|[?&]mesa=)([0-9a-f-]{36})/i);
  const id = m?.[1] ?? raw;
  return (
    tables.find((t) => t.id === id) ??
    tables.find((t) => t.label.toLowerCase() === raw.replace(/^mesa\s*/i, '').toLowerCase())
  );
}

/** Mesas ativas na ordem do cadastro e, no empate, número natural (2 antes de 10). */
export function sortTables(list: DiningTable[]): DiningTable[] {
  return list
    .filter((x) => x.active)
    .sort(
      (a, b) =>
        (a.position ?? 0) - (b.position ?? 0) ||
        a.label.localeCompare(b.label, 'pt-BR', { numeric: true }),
    );
}
