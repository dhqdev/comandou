import { canTransition, fromCents, toCents, type OrderStatus } from '@comandou/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Badge, Button, Modal, Spinner, TextField, useToast } from '../design-system';
import { useCan } from '../app/auth';
import { FiscalSection } from './FiscalSection';
import { api } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl, parseBrlInput } from '../lib/money';
import { useRealtime } from '../lib/realtime';
import type { Order, Payment } from '../lib/types';
import {
  CHANNEL_LABELS,
  dateTime,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  qty,
  STATUS_TONE,
} from './format';
import { PaymentModal, useOpenSessions } from './PaymentModal';

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }[]>> = {
  new: [
    { to: 'in_production', label: 'Iniciar preparo' },
    { to: 'ready', label: 'Marcar pronto' },
  ],
  in_production: [{ to: 'ready', label: 'Marcar pronto' }],
  ready: [{ to: 'completed', label: 'Concluir' }],
  dispatched: [{ to: 'completed', label: 'Entregue' }],
  cancel_requested: [{ to: 'new', label: 'Manter pedido' }],
};

export function OrderDetailModal({
  orderId,
  onClose,
}: {
  orderId: string | null;
  onClose(): void;
}) {
  const toast = useToast();
  const canCancel = useCan('orders:cancel');
  const canPay = useCan('payments:create');
  const canRefund = useCan('payments:refund');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canDispatch = useCan('delivery:manage');
  const canWrite = useCan('orders:write');
  const canManagePrint = useCan('printing:manage');
  const canPrint = canWrite || canManagePrint;
  const [printing, setPrinting] = useState(false);
  async function print(kind: 'kitchen' | 'receipt') {
    if (!orderId) return;
    setPrinting(true);
    try {
      await api(`/orders/${orderId}/print`, { method: 'POST', json: { kind } });
      toast('Enviado para a impressora', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setPrinting(false);
    }
  }
  const [paying, setPaying] = useState(false);
  const [mode, setMode] = useState<null | 'cancel' | 'adjust' | { refund: Payment }>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      setOrder(await api<Order>(`/orders/${orderId}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [orderId]);

  useEffect(() => {
    setOrder(null);
    setMode(null);
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'order.changed' && e.orderId === orderId) void load();
    if (e.type === 'kitchen.changed' && e.orderId === orderId) void load();
  }, load);

  async function go(to: OrderStatus, reason?: string) {
    if (!order) return;
    setBusy(true);
    try {
      setOrder(
        await api<Order>(`/orders/${order.id}/status`, {
          method: 'POST',
          json: { to, reason, expectedVersion: order.version },
        }),
      );
      setMode(null);
    } catch (e) {
      toast((e as Error).message, 'danger');
      void load();
    } finally {
      setBusy(false);
    }
  }

  const open = !!orderId;
  const title = order ? `Pedido #${order.number}` : 'Pedido';
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      {error && <Alert tone="danger">{error}</Alert>}
      {!order ? (
        <Spinner />
      ) : (
        <div className="order-detail">
          <div className="order-detail__badges">
            <Badge tone={STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
            <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
              {PAYMENT_STATUS_LABEL[order.paymentStatus]}
            </Badge>
            <Badge>{CHANNEL_LABELS[order.channel]}</Badge>
            {order.tableLabel && <Badge tone="brand">Mesa {order.tableLabel}</Badge>}
            {order.tabNumber && <Badge>Comanda {order.tabNumber}</Badge>}
          </div>
          {(order.customerName || order.deliveryAddress || order.notes) && (
            <p className="cm-hint" style={{ margin: 0 }}>
              {[order.customerName, order.customerPhone, order.deliveryAddress, order.notes]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          {order.cancelReason && <Alert tone="warning">Motivo: {order.cancelReason}</Alert>}
          <table className="cm-table">
            <tbody>
              {order.items.map((i) => (
                <tr
                  key={i.id}
                  style={
                    i.status === 'cancelled'
                      ? { textDecoration: 'line-through', opacity: 0.6 }
                      : undefined
                  }
                >
                  <td>
                    {qty(i.quantity)}× <strong>{i.name}</strong>
                    {i.options.length > 0 && (
                      <div className="cm-hint">{i.options.map((o) => o.name).join(', ')}</div>
                    )}
                    {i.notes && <div className="cm-hint">Obs.: {i.notes}</div>}
                  </td>
                  <td className="cm-num">{brl(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="totals">
            <dt>Subtotal</dt>
            <dd>{brl(order.subtotal)}</dd>
            {toCents(order.discount) > 0 && (
              <>
                <dt>Desconto</dt>
                <dd>− {brl(order.discount)}</dd>
              </>
            )}
            {toCents(order.surcharge) > 0 && (
              <>
                <dt>Acréscimo</dt>
                <dd>{brl(order.surcharge)}</dd>
              </>
            )}
            {toCents(order.deliveryFee) > 0 && (
              <>
                <dt>Entrega</dt>
                <dd>{brl(order.deliveryFee)}</dd>
              </>
            )}
            <dt className="totals__grand">Total</dt>
            <dd className="totals__grand">{brl(order.total)}</dd>
            <dt>Pago</dt>
            <dd>{brl(order.paidAmount)}</dd>
            <dt>Saldo</dt>
            <dd>{brl(order.balance)}</dd>
          </dl>

          {order.payments && order.payments.length > 0 && (
            <div>
              <h3 className="section-title">Pagamentos</h3>
              <ul className="plain-list">
                {order.payments.map((p) => (
                  <li key={p.id}>
                    <span>
                      {PAYMENT_METHOD_LABELS[p.method]} · {dateTime(p.createdAt)}
                      {toCents(p.refundedAmount) > 0 && (
                        <Badge tone="warning">estornado {brl(p.refundedAmount)}</Badge>
                      )}
                    </span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <strong>{brl(p.amount)}</strong>
                      {canRefund && toCents(p.amount) > toCents(p.refundedAmount) && (
                        <Button variant="ghost" onClick={() => setMode({ refund: p })}>
                          Estornar
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <FiscalSection
            orderId={order.id}
            paid={order.paymentStatus === 'paid'}
            cancelled={order.status === 'cancelled' || order.status === 'cancel_requested'}
          />

          {mode === 'cancel' && (
            <ReasonForm
              label="Motivo do cancelamento"
              confirm="Cancelar pedido"
              danger
              busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(r) => go(canCancel ? 'cancelled' : 'cancel_requested', r)}
            />
          )}
          {mode === 'adjust' && (
            <AdjustForm
              order={order}
              onDone={(o) => {
                setOrder(o);
                setMode(null);
              }}
              onCancel={() => setMode(null)}
            />
          )}
          {mode && typeof mode === 'object' && (
            <RefundForm
              payment={mode.refund}
              onCancel={() => setMode(null)}
              onDone={() => {
                setMode(null);
                void load();
              }}
            />
          )}

          {!mode && (
            <div className="actions-row">
              {(NEXT[order.status] ?? [])
                .filter((a) => canTransition(order.status, a.to, order.channel))
                .map((a) => (
                  <Button key={a.to} variant="secondary" loading={busy} onClick={() => go(a.to)}>
                    {a.label}
                  </Button>
                ))}
              {order.channel === 'delivery' && order.status === 'ready' && canDispatch && (
                <Link className="cm-btn cm-btn--secondary" to="/entregas" onClick={onClose}>
                  Despachar em Entregas
                </Link>
              )}
              {canPay && order.status !== 'cancelled' && toCents(order.balance) > 0 && (
                <Button onClick={() => setPaying(true)}>Receber {brl(order.balance)}</Button>
              )}
              {!['completed', 'cancelled'].includes(order.status) && (
                <Button variant="ghost" onClick={() => setMode('adjust')}>
                  Desconto/acréscimo
                </Button>
              )}
              {!['completed', 'cancelled', 'cancel_requested'].includes(order.status) && (
                <Button variant="danger" onClick={() => setMode('cancel')}>
                  {canCancel ? 'Cancelar' : 'Solicitar cancelamento'}
                </Button>
              )}
              {order.status === 'cancel_requested' && canCancel && (
                <Button variant="danger" onClick={() => setMode('cancel')}>
                  Aprovar cancelamento
                </Button>
              )}
            </div>
          )}

          {!mode && canPrint && order.status !== 'cancelled' && (
            <div className="actions-row">
              <Button variant="ghost" loading={printing} onClick={() => print('kitchen')}>
                Reimprimir cozinha
              </Button>
              <Button variant="ghost" loading={printing} onClick={() => print('receipt')}>
                Imprimir conferência
              </Button>
            </div>
          )}

          {order.history && (
            <details>
              <summary className="cm-hint">Histórico</summary>
              <ul className="plain-list">
                {order.history.map((h, i) => (
                  <li key={i}>
                    <span>
                      {ORDER_STATUS_LABELS[h.to]}{' '}
                      {h.reason && <span className="cm-hint">— {h.reason}</span>}
                    </span>
                    <span className="cm-hint">
                      {h.actorName} · {dateTime(h.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <PaymentModal
            open={paying}
            onClose={() => setPaying(false)}
            onPaid={() => {
              setPaying(false);
              void load();
            }}
            target={{ kind: 'order', id: order.id, number: order.number, balance: order.balance }}
          />
        </div>
      )}
    </Modal>
  );
}

function ReasonForm({
  label,
  confirm,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  label: string;
  confirm: string;
  danger?: boolean;
  busy?: boolean;
  onCancel(): void;
  onConfirm(r: string): void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="inline-form">
      <TextField
        label={label}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        autoFocus
      />
      <div className="actions-row">
        <Button variant="secondary" onClick={onCancel}>
          Voltar
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          loading={busy}
          disabled={reason.trim().length < 3}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirm}
        </Button>
      </div>
    </div>
  );
}

function AdjustForm({
  order,
  onDone,
  onCancel,
}: {
  order: Order;
  onDone(o: Order): void;
  onCancel(): void;
}) {
  const toast = useToast();
  const [discount, setDiscount] = useState(order.discount.replace('.', ','));
  const [surcharge, setSurcharge] = useState(order.surcharge.replace('.', ','));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const d = parseBrlInput(discount);
  const s = parseBrlInput(surcharge);
  async function save() {
    setBusy(true);
    try {
      onDone(
        await api<Order>(`/orders/${order.id}/adjustments`, {
          method: 'PATCH',
          json: { discount: d, surcharge: s, reason },
        }),
      );
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inline-form">
      <div className="two-cols">
        <TextField
          label="Desconto"
          inputMode="decimal"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          error={!d ? 'Valor inválido' : undefined}
          hint="Acima de 10% exige gerente"
        />
        <TextField
          label="Acréscimo"
          inputMode="decimal"
          value={surcharge}
          onChange={(e) => setSurcharge(e.target.value)}
          error={!s ? 'Valor inválido' : undefined}
        />
      </div>
      <TextField
        label="Motivo"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
      />
      <div className="actions-row">
        <Button variant="secondary" onClick={onCancel}>
          Voltar
        </Button>
        <Button loading={busy} disabled={!d || !s || reason.trim().length < 3} onClick={save}>
          Aplicar
        </Button>
      </div>
    </div>
  );
}

function RefundForm({
  payment,
  onCancel,
  onDone,
}: {
  payment: Payment;
  onCancel(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const { sessions, sessionId, choose } = useOpenSessions(true);
  const available = toCents(payment.amount) - toCents(payment.refundedAmount);
  const [amount, setAmount] = useState(fromCents(available).replace('.', ','));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const a = parseBrlInput(amount);
  async function save() {
    setBusy(true);
    try {
      await api(`/payments/${payment.id}/refunds`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        json: { cashSessionId: sessionId, amount: a, reason },
      });
      toast('Estorno registrado', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inline-form">
      <strong>Estornar {PAYMENT_METHOD_LABELS[payment.method]}</strong>
      {sessions?.length === 0 && (
        <Alert tone="warning">Abra um caixa para registrar o estorno.</Alert>
      )}
      <label className="cm-field">
        <span className="cm-label">Caixa</span>
        <select className="cm-input" value={sessionId} onChange={(e) => choose(e.target.value)}>
          {(sessions ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.registerName} · sessão {s.number}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label="Valor"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={!a || toCents(a) > available ? `Até ${brl(fromCents(available))}` : undefined}
      />
      <TextField
        label="Motivo"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
      />
      <div className="actions-row">
        <Button variant="secondary" onClick={onCancel}>
          Voltar
        </Button>
        <Button
          variant="danger"
          loading={busy}
          disabled={
            !a ||
            toCents(a) <= 0 ||
            toCents(a) > available ||
            reason.trim().length < 3 ||
            !sessionId
          }
          onClick={save}
        >
          Confirmar estorno
        </Button>
      </div>
    </div>
  );
}
