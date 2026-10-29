import {
  canTransition,
  fromCents,
  toCents,
  type ItemStatus,
  type OrderStatus,
} from '@comandou/shared';
import {
  Bike,
  CalendarClock,
  CreditCard,
  MapPin,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Phone,
  ShoppingBag,
  Timer,
  User,
  UtensilsCrossed,
  Wallet,
  XCircle,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ItemThumb,
  Alert,
  Badge,
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
  PAYMENT_STATUS_TONE,
  qty,
  STATUS_TONE,
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
  variant = 'panel',
  startWith,
}: {
  orderId: string | null;
  onClose(): void;
  /** Abre já no passo de despachar o entregador ou de recusar o pedido. */
  startWith?: 'dispatch' | 'reject';
  /** "panel" (padrão): desliza da direita, como uma gaveta. */
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
  const Frame = variant === 'panel' ? SidePanel : Modal;
  // Próximo passo do pedido (avançar, receber, despachar) fica no rodapé fixo, numa linha só,
  // junto com cancelar e o menu de impressão/ajustes: à vista mesmo rolando o detalhe.
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
  const canAdjust = !!order && !['completed', 'cancelled', 'awaiting'].includes(order.status);
  const cancelLabel = !order
    ? null
    : order.status === 'cancel_requested'
      ? canCancel
        ? 'Aprovar cancelamento'
        : null
      : ['completed', 'cancelled', 'awaiting'].includes(order.status)
        ? null
        : canCancel
          ? 'Cancelar pedido'
          : 'Solicitar cancelamento';
  const more: MenuAction[] = order
    ? [
        ...(canAdjust ? [{ label: 'Desconto ou acréscimo', run: () => setMode('adjust') }] : []),
        ...(canPrint && order.status !== 'cancelled'
          ? [
              { label: 'Reimprimir na cozinha', run: () => void print('kitchen') },
              { label: 'Imprimir conferência', run: () => void print('receipt') },
            ]
          : []),
      ]
    : [];
  const hasBar =
    !!order &&
    !mode &&
    (nextSteps.length > 0 || canReceive || canSend || canReject || !!cancelLabel || more.length);

  const header = order ? (
    <span className="odh">
      <span className="odh__icon" aria-hidden>
        <ChannelIcon channel={order.channel} />
      </span>
      <span className="odh__text">
        <span className="odh__title">Pedido #{order.number}</span>
        <span className="odh__chips">
          <span className="odh__chip">{CHANNEL_LABELS[order.channel]}</span>
          {order.tableLabel && <span className="odh__chip">Mesa {order.tableLabel}</span>}
          {order.tabNumber && <span className="odh__chip">Comanda {order.tabNumber}</span>}
          {order.source === 'online' && <span className="odh__chip">Cardápio online</span>}
        </span>
      </span>
    </span>
  ) : (
    'Pedido'
  );

  const footer = order ? (
    <div className="od-foot">
      <dl className="od-sum">
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
        <dt className="od-sum__total">Total do pedido</dt>
        <dd className="od-sum__total">{brl(order.total)}</dd>
        {toCents(order.paidAmount) > 0 && toCents(order.balance) > 0 && (
          <>
            <dt>Pago</dt>
            <dd>{brl(order.paidAmount)}</dd>
            <dt>Falta pagar</dt>
            <dd>
              <strong>{brl(order.balance)}</strong>
            </dd>
          </>
        )}
      </dl>
      {hasBar && (
        <div className="od-bar">
          {more.length > 0 && <MoreMenu actions={more} busy={printing} />}
          {cancelLabel && (
            <Button
              variant="secondary"
              className="od-bar__cancel"
              onClick={() => setMode('cancel')}
            >
              <XCircle size={15} aria-hidden /> {cancelLabel}
            </Button>
          )}
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
        </div>
      )}
    </div>
  ) : undefined;

  const showClient = !!(
    order &&
    (order.customerName || order.customerPhone || order.deliveryAddress)
  );
  return (
    <Frame open={open} onClose={onClose} title={header} size="md" footer={footer}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!order ? (
        !error && <Spinner />
      ) : (
        <div className="order-detail">
          <div className="od-card">
            <dl className="od-facts">
              {showClient && (
                <Fact icon={<User size={15} />} label="Cliente">
                  {order.customerName || '—'}
                </Fact>
              )}
              {showClient && (
                <Fact icon={<Phone size={15} />} label="Telefone">
                  {order.customerPhone || '—'}
                </Fact>
              )}
              <Fact icon={<CalendarClock size={15} />} label="Feito em">
                {dateTime(order.createdAt)}
              </Fact>
              <Fact icon={<Timer size={15} />} label="Status do pedido">
                <Badge tone={STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
              </Fact>
              <Fact icon={<CreditCard size={15} />} label="Pagamento">
                <span className="od-pay">
                  <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
                    {PAYMENT_STATUS_LABEL[order.paymentStatus]}
                  </Badge>
                </span>
              </Fact>
              {order.source === 'online' && order.paymentHint && (
                <Fact icon={<Wallet size={15} />} label="Vai pagar com">
                  {PAYMENT_METHOD_LABELS[order.paymentHint]}
                  {order.changeFor && ` · troco para ${brl(order.changeFor)}`}
                </Fact>
              )}
              {order.deliveryAddress && (
                <Fact icon={<MapPin size={15} />} label="Endereço" wide>
                  {order.deliveryAddress}
                </Fact>
              )}
            </dl>
            <div className="od-note">
              <MessageSquare size={15} aria-hidden />
              <div>
                <span>Observação do pedido</span>
                <strong>{order.notes || 'Sem observação'}</strong>
              </div>
            </div>
            {order.cancelReason && (
              <div className="od-note" data-tone="danger">
                <XCircle size={15} aria-hidden />
                <div>
                  <span>Motivo do cancelamento</span>
                  <strong>{order.cancelReason}</strong>
                </div>
              </div>
            )}
          </div>

          {order.channel === 'delivery' && order.status === 'dispatched' && canDispatch && (
            <OrderLiveMap orderId={order.id} />
          )}

          <section className="od-block">
            <h3 className="od-block__title">
              Itens do pedido
              <span className="od-pill">
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
                  <div className="od-item__top">
                    <ItemThumb src={mediaUrl(i.imageId)} name={i.name} size={32} />
                    <div className="od-item__main">
                      <div className="od-item__name">
                        <strong>{i.name}</strong>
                        <span className="od-item__status">{ITEM_STATUS_LABEL[i.status]}</span>
                      </div>
                      {i.options.length > 0 && (
                        <div className="od-item__sub">
                          {i.options.map((o) => o.name).join(' · ')}
                        </div>
                      )}
                      {i.notes && <div className="od-item__sub">Obs.: {i.notes}</div>}
                    </div>
                  </div>
                  <div className="od-item__bottom">
                    <span>
                      {qty(i.quantity)} UN × {brl(i.unitPrice)}
                    </span>
                    <strong>{brl(i.total)}</strong>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="od-block od-card">
            <h3 className="od-block__title">Pagamentos</h3>
            {order.payments && order.payments.length > 0 ? (
              <ul className="od-rows">
                {order.payments.map((p) => (
                  <li key={p.id}>
                    <div>
                      <strong>{PAYMENT_METHOD_LABELS[p.method]}</strong>
                      <div className="od-item__sub">
                        {dateTime(p.createdAt)}
                        {p.createdByName && ` · ${p.createdByName}`}
                        {toCents(p.refundedAmount) > 0 && ` · estornado ${brl(p.refundedAmount)}`}
                      </div>
                    </div>
                    <span className="od-rows__end">
                      <strong>{brl(p.amount)}</strong>
                      {canRefund && toCents(p.amount) > toCents(p.refundedAmount) && (
                        <Button variant="ghost" size="sm" onClick={() => setMode({ refund: p })}>
                          Estornar
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="od-empty">Nenhum pagamento registrado.</p>
            )}
          </section>

          <div className="od-card">
            <FiscalSection
              orderId={order.id}
              paid={order.paymentStatus === 'paid'}
              cancelled={order.status === 'cancelled' || order.status === 'cancel_requested'}
              taxDocument={order.taxDocument ?? null}
            />
          </div>

          {mode === 'cancel' && (
            <ReasonForm
              label="Motivo do cancelamento"
              confirm={
                order.status === 'cancel_requested' ? 'Aprovar cancelamento' : 'Cancelar pedido'
              }
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

          {order.history && order.history.length > 0 && (
            <details className="od-block od-history">
              <summary className="od-block__title">Histórico</summary>
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

const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'Pendente',
  preparing: 'Em preparo',
  ready: 'Pronto',
  cancelled: 'Cancelado',
};

function ChannelIcon({ channel }: { channel: Order['channel'] }) {
  if (channel === 'delivery') return <Bike size={18} />;
  if (channel === 'table') return <UtensilsCrossed size={18} />;
  return <ShoppingBag size={18} />;
}

interface MenuAction {
  label: string;
  run(): void;
}

/** Botão "⋯" com as ações menos usadas (ajuste e impressão): mantém o rodapé numa linha só. */
function MoreMenu({ actions, busy }: { actions: MenuAction[]; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <div className="od-more" ref={box}>
      <Button
        variant="secondary"
        aria-label="Mais ações"
        aria-haspopup="menu"
        aria-expanded={open}
        loading={busy}
        icon={<MoreHorizontal size={16} />}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="od-more__menu" role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rótulo pequeno em cima, valor embaixo (bloco de informações do pedido). */
function Fact({
  label,
  icon,
  wide,
  children,
}: {
  label: string;
  icon: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="od-fact" data-wide={wide || undefined}>
      <span className="od-fact__icon" aria-hidden>
        {icon}
      </span>
      <div>
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
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
