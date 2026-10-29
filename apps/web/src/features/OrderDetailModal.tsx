import { canTransition, fromCents, toCents, type OrderStatus } from '@comandou/shared';
import { MessageCircle } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ItemThumb,
  Alert,
  Button,
  Modal,
  Spinner,
  TextField,
  useToast,
  Select,
} from '../design-system';
import { useCan } from '../app/auth';
import { FiscalSection } from './FiscalSection';
import { OrderLiveMap } from './OrderLiveMap';
import { api } from '../lib/api';
import { mediaUrl } from '../lib/media';
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
  qty,
} from './format';
import { PaymentModal, useOpenSessions } from './PaymentModal';
import { SidePanel } from './SidePanel';

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }[]>> = {
  awaiting: [{ to: 'new', label: 'Aceitar pedido' }],
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
  variant = 'modal',
  startWith,
}: {
  orderId: string | null;
  onClose(): void;
  /** Abre já no passo de despachar o entregador ou de recusar o pedido. */
  startWith?: 'dispatch' | 'reject';
  /** "panel": desliza da direita (tela inicial de pedidos). */
  variant?: 'modal' | 'panel';
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
  const [mode, setMode] = useState<
    null | 'cancel' | 'reject' | 'adjust' | 'dispatch' | { refund: Payment }
  >(null);

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
    setMode(startWith ?? null);
    void load();
  }, [load, startWith]);
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
  const Frame = variant === 'panel' ? SidePanel : Modal;
  // Próximo passo do pedido (avançar, receber, despachar) fica no rodapé fixo: à vista mesmo
  // rolando o detalhe. Ajustes, cancelamento e impressão continuam no corpo.
  const nextSteps =
    order && !mode
      ? (NEXT[order.status] ?? []).filter((a) => canTransition(order.status, a.to, order.channel))
      : [];
  const canReceive =
    !!order && !mode && canPay && order.status !== 'cancelled' && toCents(order.balance) > 0;
  const canSend =
    !!order && !mode && order.channel === 'delivery' && order.status === 'ready' && canDispatch;
  const canReject = !!order && !mode && order.status === 'awaiting' && canWrite;
  const leadIsStep = !canReceive && !canSend;
  const footer =
    order && (nextSteps.length || canReceive || canSend || canReject) ? (
      <>
        {canReject && (
          <Button variant="secondary" onClick={() => setMode('reject')}>
            Recusar
          </Button>
        )}
        {nextSteps.map((a, i) => (
          <Button
            key={a.to}
            variant={
              (leadIsStep || order.status === 'awaiting') && i === 0 ? 'primary' : 'secondary'
            }
            loading={busy}
            onClick={() => go(a.to)}
          >
            {a.label}
          </Button>
        ))}
        {canSend && <Button onClick={() => setMode('dispatch')}>Despachar entregador</Button>}
        {canReceive && (
          <Button
            variant={order.status === 'awaiting' ? 'secondary' : 'primary'}
            onClick={() => setPaying(true)}
          >
            Receber {brl(order.balance)}
          </Button>
        )}
      </>
    ) : undefined;
  return (
    <Frame open={open} onClose={onClose} title={title} size="lg" footer={footer}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!order ? (
        <Spinner />
      ) : (
        <div className="order-detail">
          <dl className="od-facts">
            <Fact label="Status">
              <strong>{ORDER_STATUS_LABELS[order.status]}</strong>
            </Fact>
            <Fact label="Pagamento">
              <strong className="od-pay">{PAYMENT_STATUS_LABEL[order.paymentStatus]}</strong>
            </Fact>
            <Fact label="Tipo">
              {CHANNEL_LABELS[order.channel]}
              {order.tableLabel && ` · Mesa ${order.tableLabel}`}
              {order.tabNumber && ` · Comanda ${order.tabNumber}`}
            </Fact>
            <Fact label="Feito em">{dateTime(order.createdAt)}</Fact>
          </dl>

          {(order.customerName ||
            order.customerPhone ||
            order.deliveryAddress ||
            order.notes ||
            (order.source === 'online' && order.paymentHint)) && (
            <section className="od-section">
              <h3 className="od-section__title">Cliente</h3>
              <dl className="od-facts">
                {order.customerName && (
                  <Fact label="Nome">
                    <strong>{order.customerName}</strong>
                  </Fact>
                )}
                {order.customerPhone && <Fact label="Telefone">{order.customerPhone}</Fact>}
                {order.deliveryAddress && (
                  <Fact label="Endereço" wide>
                    {order.deliveryAddress}
                  </Fact>
                )}
                {order.source === 'online' && order.paymentHint && (
                  <Fact label="Vai pagar com" wide>
                    {PAYMENT_METHOD_LABELS[order.paymentHint]}
                    {order.changeFor && ` · troco para ${brl(order.changeFor)}`}
                  </Fact>
                )}
                {order.notes && (
                  <Fact label="Observação" wide>
                    {order.notes}
                  </Fact>
                )}
              </dl>
            </section>
          )}
          {order.cancelReason && (
            <dl className="od-facts">
              <Fact label="Motivo do cancelamento" wide>
                <strong>{order.cancelReason}</strong>
              </Fact>
            </dl>
          )}
          {order.channel === 'delivery' && order.status === 'dispatched' && canDispatch && (
            <OrderLiveMap orderId={order.id} />
          )}

          <section className="od-section">
            <h3 className="od-section__title">
              Itens do pedido
              <span className="od-section__count">
                {order.items.length} {order.items.length === 1 ? 'item' : 'itens'}
              </span>
            </h3>
            <ul className="od-items">
              {order.items.map((i) => (
                <li
                  key={i.id}
                  className="od-item"
                  data-cancelled={i.status === 'cancelled' || undefined}
                >
                  <ItemThumb src={mediaUrl(i.imageId)} name={i.name} />
                  <div className="od-item__main">
                    <div className="od-item__name">
                      <span className="od-item__qty">{qty(i.quantity)}×</span>
                      <strong>{i.name}</strong>
                    </div>
                    {i.options.length > 0 && (
                      <div className="od-item__sub">{i.options.map((o) => o.name).join(', ')}</div>
                    )}
                    {i.notes && <div className="od-item__sub">Obs.: {i.notes}</div>}
                  </div>
                  <span className="od-item__price">{brl(i.total)}</span>
                </li>
              ))}
            </ul>
          </section>

          <dl className="totals od-totals">
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
                <dt>Taxa de entrega</dt>
                <dd>{brl(order.deliveryFee)}</dd>
              </>
            )}
            <dt className="totals__grand">Total</dt>
            <dd className="totals__grand">{brl(order.total)}</dd>
            <dt>Pago</dt>
            <dd>{brl(order.paidAmount)}</dd>
            <dt>
              <strong>Falta pagar</strong>
            </dt>
            <dd>
              <strong>{brl(order.balance)}</strong>
            </dd>
          </dl>

          {order.payments && order.payments.length > 0 && (
            <section className="od-section">
              <h3 className="od-section__title">Pagamentos</h3>
              <ul className="od-rows">
                {order.payments.map((p) => (
                  <li key={p.id}>
                    <div>
                      <strong>{PAYMENT_METHOD_LABELS[p.method]}</strong>
                      <div className="od-item__sub">
                        {dateTime(p.createdAt)}
                        {toCents(p.refundedAmount) > 0 && ` · estornado ${brl(p.refundedAmount)}`}
                      </div>
                    </div>
                    <span className="od-rows__end">
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
            </section>
          )}

          <FiscalSection
            orderId={order.id}
            paid={order.paymentStatus === 'paid'}
            cancelled={order.status === 'cancelled' || order.status === 'cancel_requested'}
            taxDocument={order.taxDocument ?? null}
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
          {mode === 'reject' && (
            <ReasonForm
              label="Por que recusar? (o cliente vê este motivo)"
              confirm="Recusar pedido"
              danger
              busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(r) => go('cancelled', r)}
            />
          )}
          {mode === 'dispatch' && (
            <DispatchForm
              order={order}
              onCancel={() => setMode(null)}
              onDone={() => {
                setMode(null);
                void load();
              }}
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
            <div className="od-actions">
              {!mode && (
                <div className="actions-row order-actions">
                  {!['completed', 'cancelled', 'awaiting'].includes(order.status) && (
                    <Button variant="secondary" onClick={() => setMode('adjust')}>
                      Desconto/acréscimo
                    </Button>
                  )}
                  {!['completed', 'cancelled', 'cancel_requested', 'awaiting'].includes(
                    order.status,
                  ) && (
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
                <div className="actions-row order-actions">
                  <Button variant="secondary" loading={printing} onClick={() => print('kitchen')}>
                    Reimprimir cozinha
                  </Button>
                  <Button variant="secondary" loading={printing} onClick={() => print('receipt')}>
                    Imprimir conferência
                  </Button>
                </div>
              )}
            </div>
          )}

          {order.history && order.history.length > 0 && (
            <details className="od-section od-history">
              <summary className="od-section__title">Histórico</summary>
              <ol className="od-timeline">
                {order.history.map((h, i) => (
                  <li key={i}>
                    <strong>{ORDER_STATUS_LABELS[h.to]}</strong>
                    <span className="od-item__sub">
                      {[h.actorName, dateTime(h.at)].filter(Boolean).join(' · ')}
                    </span>
                    {h.reason && <span className="od-item__sub">{h.reason}</span>}
                  </li>
                ))}
              </ol>
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
    </Frame>
  );
}

/** Rótulo pequeno em cima, valor embaixo (bloco de informações do pedido). */
function Fact({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="od-fact" data-wide={wide || undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

interface Courier {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
}

/** Escolhe o entregador e despacha sem sair da tela; depois oferece avisar pelo WhatsApp. */
function DispatchForm({
  order,
  onCancel,
  onDone,
}: {
  order: Order;
  onCancel(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [couriers, setCouriers] = useState<Courier[] | null>(null);
  const [courierId, setCourierId] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Courier | null>(null);
  useEffect(() => {
    api<Courier[]>('/couriers')
      .then((c) => {
        const active = c.filter((x) => x.active);
        setCouriers(active);
        setCourierId(active[0]?.id ?? '');
      })
      .catch(() => setCouriers([]));
  }, []);
  async function dispatch() {
    setBusy(true);
    try {
      await api(`/orders/${order.id}/dispatch`, { method: 'POST', json: { courierId } });
      toast(`Pedido #${order.number} saiu para entrega`, 'success');
      setSent(couriers?.find((c) => c.id === courierId) ?? null);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  if (sent) {
    const phone = sent.phone?.replace(/\D/g, '');
    const text = [
      `Entrega do pedido #${order.number}`,
      order.customerName &&
        `Cliente: ${order.customerName}${order.customerPhone ? ` (${order.customerPhone})` : ''}`,
      order.deliveryAddress && `Endereço: ${order.deliveryAddress}`,
      `Total: ${brl(order.total)}${toCents(order.balance) > 0 ? ` (cobrar ${brl(order.balance)}${order.paymentHint ? ` em ${PAYMENT_METHOD_LABELS[order.paymentHint]}` : ''}${order.changeFor ? `, troco para ${brl(order.changeFor)}` : ''})` : ' (pago)'}`,
    ]
      .filter(Boolean)
      .join('\n');
    return (
      <div className="inline-form">
        <strong>{sent.name} está com o pedido.</strong>
        <div className="actions-row">
          {phone && (
            <a
              className="cm-btn cm-btn--secondary"
              href={`https://wa.me/${phone.length <= 11 ? `55${phone}` : phone}?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={16} /> Avisar {sent.name.split(' ')[0]} no WhatsApp
            </a>
          )}
          <Button onClick={onDone}>Pronto</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="inline-form">
      <strong>Quem vai levar?</strong>
      {couriers === null ? (
        <Spinner />
      ) : couriers.length === 0 ? (
        <Alert tone="warning">
          Nenhum entregador ativo. Cadastre em <Link to="/entregas">Entregas</Link>.
        </Alert>
      ) : (
        <label className="cm-field">
          <span className="cm-label">Entregador</span>
          <Select
            className="cm-input"
            value={courierId}
            onChange={(e) => setCourierId(e.target.value)}
          >
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <div className="actions-row">
        <Button variant="secondary" onClick={onCancel}>
          Voltar
        </Button>
        <Button loading={busy} disabled={!courierId} onClick={dispatch}>
          Saiu para entrega
        </Button>
      </div>
    </div>
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
        <Select className="cm-input" value={sessionId} onChange={(e) => choose(e.target.value)}>
          {(sessions ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.registerName} · sessão {s.number}
            </option>
          ))}
        </Select>
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
