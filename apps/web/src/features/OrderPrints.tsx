import { ChevronDown, Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../design-system';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import type { OrderPrint } from '../lib/types';
import { dateTime } from './format';
import { PaperText } from './PaperText';

const KIND: Record<OrderPrint['kind'], string> = {
  kitchen_ticket: 'Comanda da cozinha',
  receipt: 'Conferência de conta',
  delivery_slip: 'Via de entrega',
  test: 'Teste',
  fiscal_receipt: 'Cupom fiscal',
  kitchen_cancel: 'Item cancelado',
};
const STATUS: Record<OrderPrint['status'], [string, 'neutral' | 'info' | 'success' | 'danger']> = {
  queued: ['Na fila', 'neutral'],
  printing: ['Imprimindo', 'info'],
  done: ['Impresso', 'success'],
  failed: ['Falhou', 'danger'],
  cancelled: ['Tirado da fila', 'neutral'],
};

/** Reimpressão e 2ª via vêm marcadas no topo do papel. */
function kindLabel(p: OrderPrint) {
  const base = KIND[p.kind] ?? 'Impressão';
  if (/^\*\*\* (REIMPRESSÃO|2ª VIA) \*\*\*/.test(p.text)) return `${base} (de novo)`;
  return base;
}

/**
 * Histórico de impressões dentro do pedido (0.220, pedido do David): cada papel que saiu, com a
 * hora, o quê, para onde e quem mandou, e a prévia do texto ao tocar. Atualiza sozinho quando a
 * impressora confirma.
 */
export function OrderPrints({ orderId, open }: { orderId: string; open?: boolean }) {
  const [rows, setRows] = useState<OrderPrint[] | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const load = useCallback(() => {
    api<OrderPrint[]>(`/orders/${orderId}/prints`)
      .then(setRows)
      .catch(() => setRows((r) => r ?? []));
  }, [orderId]);
  useEffect(() => {
    setRows(null);
    setShown(null);
    load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'print.changed') load();
    if (e.type === 'order.changed' && e.orderId === orderId) load();
  }, load);

  if (!rows) return null;
  return (
    <details className="od-block od-history od-prints" open={open}>
      <summary className="od-block__title">
        Impressões
        <span className="od-pill">{rows.length}</span>
      </summary>
      {rows.length === 0 ? (
        <p className="od-empty">Nada deste pedido foi para a impressora ainda.</p>
      ) : (
        <ul className="od-prints__list">
          {rows.map((p) => {
            const [label, tone] = STATUS[p.status];
            const isOpen = shown === p.id;
            const where = p.printerLabel ?? p.target;
            return (
              <li key={p.id} className="od-prints__row">
                <button
                  type="button"
                  className="od-prints__head"
                  aria-expanded={isOpen}
                  onClick={() => setShown(isOpen ? null : p.id)}
                >
                  <Printer size={15} aria-hidden className="od-prints__icon" />
                  <span className="od-prints__main">
                    <strong>{kindLabel(p)}</strong>
                    <span className="od-item__sub">
                      {[dateTime(p.createdAt), where, p.byName].filter(Boolean).join(' · ')}
                    </span>
                    {p.status === 'failed' && p.lastError && (
                      <span className="od-item__sub od-prints__error">{p.lastError}</span>
                    )}
                  </span>
                  <Badge tone={tone}>{label}</Badge>
                  <ChevronDown size={16} aria-hidden className="od-prints__chev" />
                </button>
                {isOpen && <PaperText text={p.text} className="receipt-paper od-prints__paper" />}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
