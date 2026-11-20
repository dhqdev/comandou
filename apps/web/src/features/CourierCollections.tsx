import type { PaymentMethod } from '@comandou/shared';
import { HandCoins } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, EmptyState, useToast, Skeleton } from '../design-system';
import { api } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl } from '../lib/money';
import { useRealtime } from '../lib/realtime';
import type { CourierCollection, Delivery } from '../lib/types';
import { PAYMENT_METHOD_LABELS } from './format';
import { SelectField } from './forms';
import { useOpenSessions } from './PaymentModal';

const METHODS: PaymentMethod[] = ['cash', 'pix', 'debit', 'credit', 'voucher', 'other'];

/**
 * Acerto do entregador: o que ele recebeu na porta e ainda não entregou no caixa. Cada acerto
 * vira um pagamento normal na sessão de caixa escolhida (entra no esperado do fechamento).
 */
export function CourierCollections() {
  const toast = useToast();
  const [groups, setGroups] = useState<CourierCollection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { sessions, sessionId, choose } = useOpenSessions(true);

  const load = useCallback(async () => {
    try {
      setGroups(await api<CourierCollection[]>('/deliveries/collections'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'order.changed' || e.type === 'delivery.changed') void load();
  }, load);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!groups) return <Skeleton />;
  return (
    <Card title="Acerto dos entregadores">
      {sessions && sessions.length === 0 && (
        <Alert tone="warning">Abra o caixa para receber o acerto dos entregadores.</Alert>
      )}
      {sessions && sessions.length > 1 && (
        <SelectField
          label="Caixa que recebe"
          value={sessionId}
          onChange={(e) => choose(e.target.value)}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.registerName} · sessão {s.number}
            </option>
          ))}
        </SelectField>
      )}
      {groups.length === 0 ? (
        <EmptyState
          icon={<HandCoins size={20} />}
          title="Nenhum acerto pendente"
          description="Quando o entregador concluir uma entrega com valor a receber, ela aparece aqui até o caixa conferir."
        />
      ) : (
        groups.map((g) => (
          <section key={g.courierId} style={{ marginTop: 12 }}>
            <h3 className="cm-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{g.courierName}</span>
              <strong>{brl(g.total)}</strong>
            </h3>
            <ul className="od-rows">
              {g.deliveries.map((d) => (
                <SettleRow
                  key={d.id}
                  d={d}
                  sessionId={sessionId}
                  onDone={() => {
                    toast(`Pedido #${d.orderNumber} acertado`, 'success');
                    void load();
                  }}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </Card>
  );
}

function SettleRow({ d, sessionId, onDone }: { d: Delivery; sessionId: string; onDone(): void }) {
  const toast = useToast();
  const [method, setMethod] = useState<PaymentMethod>(d.collectMethod ?? 'cash');
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  async function settle() {
    setBusy(true);
    try {
      await api(`/deliveries/${d.id}/settle`, {
        method: 'POST',
        json: { cashSessionId: sessionId, method },
        headers: { 'Idempotency-Key': key },
      });
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <li>
      <div>
        <strong>Pedido #{d.orderNumber}</strong>
        <div className="od-item__sub">{d.customerName ?? '—'}</div>
      </div>
      <span className="od-rows__end">
        <strong>{brl(d.collectAmount ?? '0')}</strong>
        <select
          aria-label={`Forma recebida no pedido ${d.orderNumber}`}
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
        <Button size="sm" loading={busy} disabled={!sessionId} onClick={() => void settle()}>
          Acertar
        </Button>
      </span>
    </li>
  );
}
