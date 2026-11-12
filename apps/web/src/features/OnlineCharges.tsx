import { ONLINE_CHARGE_LABELS, type OnlineChargeStatus } from '@comandou/shared';
import { useState } from 'react';
import { Badge, Button, useToast } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { Order } from '../lib/types';
import { dateTime } from './format';
import { useOpenSessions } from './PaymentModal';

const TONE: Record<OnlineChargeStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  paid: 'success',
  pending: 'warning',
  declined: 'danger',
  expired: 'neutral',
  refund_due: 'warning',
  refunded: 'neutral',
};

/**
 * Pago pelo app (PagBank), no detalhe do pedido: as tentativas, e "Lançar no caixa" quando o
 * pagamento chegou sem caixa aberto (o sistema também lança sozinho quando um caixa abre).
 */
export function OnlineCharges({ order, onDone }: { order: Order; onDone(o: Order): void }) {
  const toast = useToast();
  const charges = order.onlineCharges ?? [];
  const toLaunch = charges.find((c) => c.status === 'paid' && !c.paymentId);
  const { sessions, sessionId } = useOpenSessions(!!toLaunch);
  const [busy, setBusy] = useState(false);

  async function run(path: string, json?: object, ok?: string) {
    setBusy(true);
    try {
      await api(`/online-pay/orders/${order.id}/${path}`, { method: 'POST', json });
      onDone(await api<Order>(`/orders/${order.id}`));
      if (ok) toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="od-block od-card">
      <h3 className="od-block__title">Pagamento pelo app</h3>
      {charges.length === 0 ? (
        <p className="od-empty">
          O cliente ainda não pagou. O pedido fica em análise até o pagamento e cancela sozinho
          depois de 20 minutos sem pagar.
        </p>
      ) : (
        <ul className="pix-history">
          {charges.map((c) => (
            <li key={c.id}>
              {dateTime(c.createdAt)} · {c.method === 'card' ? 'Cartão' : 'Pix'}
              {c.cardLast4 ? ` final ${c.cardLast4}` : ''} · {brl(c.amount)}{' '}
              <Badge tone={TONE[c.status]}>
                {c.status === 'paid' && !c.paymentId
                  ? 'Pago, falta lançar no caixa'
                  : ONLINE_CHARGE_LABELS[c.status]}
              </Badge>
              {c.declineReason && c.status === 'declined' ? ` ${c.declineReason}` : ''}
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {toLaunch && (
          <Button
            variant="primary"
            disabled={busy || !sessionId}
            onClick={() => void run('launch', { cashSessionId: sessionId }, 'Lançado no caixa')}
          >
            {sessions && sessions.length === 0 ? 'Abra um caixa para lançar' : 'Lançar no caixa'}
          </Button>
        )}
        {charges.some((c) => c.status === 'pending' || c.status === 'refund_due') && (
          <Button variant="secondary" disabled={busy} onClick={() => void run('sync')}>
            Conferir no PagBank
          </Button>
        )}
      </div>
    </section>
  );
}
