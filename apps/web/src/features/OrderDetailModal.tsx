import {
  canTransition,
  CHANNEL_ACTION_LABELS,
  type ChannelAction,
  fromCents,
  toCents,
  type ItemStatus,
  type OrderStatus,
  qtyLabel,
} from '@comandou/shared';
import {
  Bike,
  CalendarClock,
  ChefHat,
  HandCoins,
  Pencil,
  Percent,
  CreditCard,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  Printer,
  Receipt,
  ShoppingBag,
  Timer,
  User,
  UtensilsCrossed,
  Wallet,
  XCircle,
  Smartphone,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ItemThumb,
  Alert,
  Badge,
  Button,
  Modal,
  TextField,
  useToast,
  Select,
  Skeleton,
} from '../design-system';
import { useCan } from '../app/auth';
import { FiscalSection } from './FiscalSection';
import { OrderEditor } from './OrderEditor';
import { OrderLiveMap } from './OrderLiveMap';
import { api } from '../lib/api';
import { maskPhone } from '../lib/br-format';
import { ReceiptPreview } from './ReceiptPreview';
import { mediaUrl } from '../lib/media';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl, parseBrlInput } from '../lib/money';
import { useRealtime } from '../lib/realtime';
import type { AppOrderInfo, Order, OrderItem, Payment } from '../lib/types';
import {
  CHANNEL_LABELS,
  dateTime,
  elapsed,
  minutesSince,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  paymentLabel,
  qty,
  STATUS_TONE,
  time,
} from './format';
import { CloseOrderPanel } from './CloseOrderPanel';
import { FiadoForm, localPhone } from './FiadoDialog';
import { OnlineCharges } from './OnlineCharges';
import { useOpenSessions } from './PaymentModal';
import {
  PixReceiptChip,
  PixReceiptReview,
  ReceiptFileModal,
  receiptFile,
  type ReceiptFile,
} from './PixReceipt';
import { SidePanel } from './SidePanel';
import { AcceptDeadline } from './channels/AcceptDeadline';
import { AppCancelForm, AppDisputeCard } from './channels/AppDispute';
import { AppDriverCard, appDriverTakes } from './channels/AppDriver';
import { AppOrderFinance } from './channels/AppOrderFinance';
import { OrderReviewNote } from './channels/AppReviews';
import { ChannelBadge } from './channels/ChannelBadge';

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
  const canFinance = useCan('finance:read');
  const canWrite = useCan('orders:write');
  const canManagePrint = useCan('printing:manage');
  const canPrint = canWrite || canManagePrint;
  const [printing, setPrinting] = useState(false);
  /** Comprovante do Pix aberto na prévia (na mesma tela, sem outra aba). */
  const [receiptView, setReceiptView] = useState<ReceiptFile | null>(null);
  const [previewKind, setPreviewKind] = useState<'receipt' | 'delivery' | null>(null);
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
    | null
    | 'cancel'
    | 'reject'
    | 'adjust'
    | 'dispatch'
    | 'receivable'
    | 'fiado'
    | 'edit'
    | { refund: Payment }
    | { cancelItem: OrderItem }
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

  async function serve() {
    if (!order) return;
    setBusy(true);
    try {
      setOrder(await api<Order>(`/orders/${order.id}/served`, { method: 'POST' }));
    } catch (e) {
      toast((e as Error).message, 'danger');
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function go(
    to: OrderStatus,
    reason?: string,
    receivable?: boolean,
    channelReason?: string,
  ) {
    if (!order) return;
    setBusy(true);
    try {
      setOrder(
        await api<Order>(`/orders/${order.id}/status`, {
          method: 'POST',
          json: { to, reason, expectedVersion: order.version, receivable, channelReason },
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

  async function cancelItem(item: OrderItem, reason: string) {
    if (!order) return;
    setBusy(true);
    try {
      setOrder(
        await api<Order>(`/orders/${order.id}/items/${item.id}/cancel`, {
          method: 'POST',
          json: { reason },
        }),
      );
      setMode(null);
      toast(`${item.name} cancelado`, 'success');
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
  const hasBalance = !!order && toCents(order.balance) > 0;
  // Concluir com saldo em aberto só vale saindo da rua (vira acerto do entregador) ou "a receber".
  const nextSteps =
    order && !mode
      ? (NEXT[order.status] ?? []).filter(
          (a) =>
            canTransition(order.status, a.to, order.channel) &&
            // Fiado marcado: conclui com saldo (vira "a receber" sozinho).
            !(
              a.to === 'completed' &&
              hasBalance &&
              order.status !== 'dispatched' &&
              !order.fiadoAt
            ) &&
            // Mesa: "Entregue na mesa" no lugar de concluir (pago, conclui sozinho).
            !(a.to === 'completed' && order.channel === 'table' && !order.servedAt),
        )
      : [];
  const canServe =
    !!order &&
    !mode &&
    canWrite &&
    order.channel === 'table' &&
    order.status === 'ready' &&
    !order.servedAt;
  // Vender fiado: o mesmo poder do "a receber" (gerente), em qualquer pedido com saldo.
  // Pedido de aplicativo: itens, valores e cobrança mandam no aplicativo (sem fiado, desconto ou
  // troca de itens aqui; a observação interna continua).
  const isApp = order?.source === 'app';
  const canFiado = !!order && !isApp && canCancel && hasBalance && order.status !== 'cancelled';
  const canReceivable =
    !!order &&
    canCancel &&
    hasBalance &&
    !order.fiadoAt &&
    order.status !== 'dispatched' &&
    canTransition(order.status, 'completed', order.channel);
  // Quem lançou: o primeiro passo do histórico (sem situação anterior).
  const launchedBy = order?.history?.find((h) => h.from === null)?.actorName ?? null;
  const activeItems = order ? order.items.filter((i) => i.status !== 'cancelled').length : 0;
  const canCancelItem =
    !!order && !mode && !isApp && canCancel && !['completed', 'cancelled'].includes(order.status);
  const canReceive =
    !!order && !mode && canPay && order.status !== 'cancelled' && toCents(order.balance) > 0;
  // Pedido que o entregador do aplicativo leva (ou com entregador do aplicativo chamado) não sai
  // com o motoboy da loja.
  const appTakes = !!order && appDriverTakes(order);
  const canSend =
    !!order &&
    !mode &&
    order.channel === 'delivery' &&
    order.status === 'ready' &&
    canDispatch &&
    !appTakes;
  const canReject = !!order && !mode && order.status === 'awaiting' && canWrite;
  const leadIsStep = !canReceive && !canSend;
  const canAdjust =
    !!order && !isApp && !['completed', 'cancelled', 'awaiting'].includes(order.status);
  // Editar itens: pedido aceito que ainda não saiu nem fechou (o servidor confere o resto).
  const canManage = useCan('orders:manage');
  const canEdit =
    !!order && !isApp && canManage && ['new', 'in_production', 'ready'].includes(order.status);
  // Pedido de aplicativo: o cancelamento é pedido ao aplicativo e só vale quando ele confirmar.
  const cancelLabel = !order
    ? null
    : isApp
      ? ['new', 'in_production', 'ready'].includes(order.status) && canWrite
        ? 'Pedir cancelamento'
        : null
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
        // Editar itens não entra aqui: o botão Editar fica ao lado de "Itens do pedido".
        ...(canAdjust
          ? [
              {
                label: 'Desconto ou acréscimo',
                icon: <Percent size={15} />,
                hue: 'green' as const,
                run: () => setMode('adjust'),
              },
            ]
          : []),
        ...(canFiado
          ? [
              {
                label: order.fiadoAt ? 'Editar fiado' : 'Vender fiado',
                icon: <CalendarClock size={15} />,
                hue: 'amber' as const,
                run: () => setMode('fiado'),
              },
            ]
          : []),
        ...(canReceivable
          ? [
              {
                label: 'Concluir a receber',
                icon: <HandCoins size={15} />,
                hue: 'rose' as const,
                run: () => setMode('receivable'),
              },
            ]
          : []),
        ...(canPrint && order.status !== 'cancelled'
          ? [
              {
                label: 'Reimprimir na cozinha',
                icon: <ChefHat size={15} />,
                hue: 'slate' as const,
                run: () => void print('kitchen'),
              },
            ]
          : []),
      ]
    : [];
  const canPrintSlip = !!order && !mode && canPrint && order.status !== 'cancelled';
  const hasBar =
    !!order &&
    !mode &&
    (nextSteps.length > 0 || canReceive || canSend || canReject || canServe || !!cancelLabel);

  const header = order ? (
    <span className="odh" data-hue={CHANNEL_HUE[order.channel]}>
      <span className="odh__icon" aria-hidden>
        <ChannelIcon channel={order.channel} />
      </span>
      <span className="odh__text">
        <span className="odh__title">Pedido #{order.number}</span>
        <span className="odh__chips">
          <span className="odh__chip odh__chip--main">{CHANNEL_LABELS[order.channel]}</span>
          {order.tableLabel && <span className="odh__chip">Mesa {order.tableLabel}</span>}
          {order.tabNumber && <span className="odh__chip">Comanda {order.tabNumber}</span>}
          {order.source === 'online' && <span className="odh__chip">Cardápio online</span>}
          {order.appChannel && (
            <ChannelBadge channel={order.appChannel} code={order.externalCode} />
          )}
        </span>
      </span>
    </span>
  ) : (
    'Pedido'
  );

  // Ações de apoio (imprimir, editar, desconto, fiado, cozinha): uma fileira de botões pequenos no
  // topo do pedido, à vista e longe dos botões que decidem o pedido (rodapé).
  const tools =
    order && !mode && (canPrintSlip || more.length > 0) ? (
      <div className="od-tools" role="toolbar" aria-label="Ações do pedido">
        {canPrintSlip && (
          <button type="button" data-hue="blue" onClick={() => setPreviewKind('receipt')}>
            <Printer size={15} aria-hidden /> <span>Imprimir pedido</span>
          </button>
        )}
        {canPrintSlip && order.channel === 'delivery' && (
          <button type="button" data-hue="violet" onClick={() => setPreviewKind('delivery')}>
            <Bike size={15} aria-hidden /> <span>Via de entrega</span>
          </button>
        )}
        {more.map((a) => (
          <button key={a.label} type="button" data-hue={a.hue} disabled={printing} onClick={a.run}>
            {a.icon} <span>{a.label}</span>
          </button>
        ))}
      </div>
    ) : null;

  const footer = order ? (
    <div className="od-foot">
      <dl className="od-sum">
        <dt>Subtotal</dt>
        <dd>{brl(order.subtotal)}</dd>
        {toCents(order.discount) > 0 && (
          <>
            <dt>Desconto</dt>
            <dd className="od-sum__good">− {brl(order.discount)}</dd>
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
            <dd className="od-sum__good">{brl(order.paidAmount)}</dd>
            <dt>Falta pagar</dt>
            <dd className="od-sum__due">
              <strong>{brl(order.balance)}</strong>
            </dd>
          </>
        )}
      </dl>
      {hasBar && (
        <div className="od-bar">
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
            <Button
              variant="secondary"
              className="od-bar__cancel"
              onClick={() => setMode('reject')}
            >
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
          {canServe && (
            <Button
              variant={canReceive ? 'secondary' : 'primary'}
              loading={busy}
              onClick={() => void serve()}
            >
              Entregue na mesa
            </Button>
          )}
          {canReceive && (
            <Button
              variant={order.status === 'awaiting' ? 'secondary' : 'primary'}
              icon={<Wallet size={15} />}
              onClick={() => setPaying(true)}
            >
              Fechar conta
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
    <Frame
      open={open}
      onClose={onClose}
      title={header}
      // Janela (aberta pelo chat): grande, para ter as mesmas duas colunas da gaveta no computador.
      size={variant === 'panel' ? 'md' : 'lg'}
      footer={footer}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!order ? (
        !error && <Skeleton variant="detail" />
      ) : (
        <div className="order-detail">
          {/* Gaveta larga (computador): o pedido à esquerda e o dinheiro à direita (ops.css). */}
          <div className="od-main">
            {tools}
            <div className="od-card">
              <dl className="od-facts">
                {showClient && (
                  <Fact icon={<User size={15} />} label="Cliente" hue="blue">
                    {order.customerName || '—'}
                  </Fact>
                )}
                {order.customerPhone && (
                  <Fact icon={<Phone size={15} />} label="Telefone" hue="green">
                    {maskPhone(localPhone(order.customerPhone))}
                  </Fact>
                )}
                <Fact icon={<CalendarClock size={15} />} label="Feito em" hue="violet">
                  {dateTime(order.createdAt)}
                  {OPEN_STATUSES.has(order.status) && (
                    <span className="od-fact__muted">
                      {' '}
                      · há {elapsed(minutesSince(order.createdAt))}
                    </span>
                  )}
                </Fact>
                {launchedBy && (
                  <Fact icon={<User size={15} />} label="Lançado por" hue="slate">
                    {launchedBy}
                  </Fact>
                )}
                {order.scheduledFor && (
                  <Fact icon={<CalendarClock size={15} />} label="Agendado para" hue="amber">
                    {dateTime(order.scheduledFor)}
                  </Fact>
                )}
                {order.servedAt && (
                  <Fact icon={<UtensilsCrossed size={15} />} label="Entregue na mesa" hue="green">
                    {time(order.servedAt)}
                  </Fact>
                )}
                <Fact
                  icon={<Timer size={15} />}
                  label="Status do pedido"
                  hue={STATUS_TONE[order.status]}
                >
                  <Badge tone={STATUS_TONE[order.status]}>
                    {ORDER_STATUS_LABELS[order.status]}
                  </Badge>
                </Fact>
                <Fact
                  icon={<CreditCard size={15} />}
                  label="Pagamento"
                  hue={PAYMENT_STATUS_TONE[order.paymentStatus]}
                >
                  <span className="od-pay">
                    <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
                      {PAYMENT_STATUS_LABEL[order.paymentStatus]}
                    </Badge>
                  </span>
                </Fact>
                {order.source === 'online' && order.paymentHint && (
                  <Fact icon={<Wallet size={15} />} label="Vai pagar com" hue="teal">
                    {PAYMENT_METHOD_LABELS[order.paymentHint]}
                    {order.changeFor && ` · troco para ${brl(order.changeFor)}`}
                  </Fact>
                )}
                {order.pixReceipts?.[0] && (
                  <Fact icon={<Receipt size={15} />} label="Comprovante Pix" hue="teal" wide>
                    {dateTime(order.pixReceipts[0].createdAt)}
                    {order.pixReceipts[0].hasFile ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="od-fact__link"
                          onClick={() =>
                            setReceiptView(
                              receiptFile(
                                order.id,
                                order.pixReceipts![0],
                                `Comprovante do Pix · Pedido #${order.number}`,
                              ),
                            )
                          }
                        >
                          Abrir
                        </button>
                      </>
                    ) : (
                      ' · arquivo já apagado'
                    )}
                  </Fact>
                )}
                {order.deliveryAddress && (
                  <Fact icon={<MapPin size={15} />} label="Endereço" hue="rose" wide>
                    {order.deliveryAddress}
                  </Fact>
                )}
              </dl>
              <div className="od-note" data-hue={order.notes ? 'amber' : undefined}>
                <MessageSquare size={15} aria-hidden />
                <div>
                  <span>Observação do pedido</span>
                  <strong>{order.notes || 'Sem observação'}</strong>
                </div>
              </div>
              {order.app && <AppOrderNote app={order.app} order={order} />}
              {order.app && canFinance && order.status !== 'awaiting' && (
                <AppOrderFinance orderId={order.id} />
              )}
              {order.app && ['completed', 'cancelled'].includes(order.status) && (
                <OrderReviewNote orderId={order.id} />
              )}
              {order.app && order.channel === 'delivery' && (
                <AppDriverCard orderId={order.id} canManage={canManage} />
              )}
              {order.app?.disputes?.slice(0, 3).map((d) => (
                <AppDisputeCard
                  key={d.id}
                  dispute={d}
                  canAnswer={canManage}
                  onDone={() => void load()}
                />
              ))}
              {order.fiadoAt && (
                <div className="od-note" data-tone="warning">
                  <CalendarClock size={15} aria-hidden />
                  <div>
                    <span>
                      Fiado
                      {order.fiadoDueAt ? ` · paga em ${dateTime(order.fiadoDueAt)}` : ''}
                    </span>
                    <strong>
                      {order.fiadoName}
                      {order.fiadoPhone ? ` · ${localPhone(order.fiadoPhone)}` : ''}
                    </strong>
                  </div>
                </div>
              )}
              {order.receivableAt && (
                <div className="od-note" data-tone="danger">
                  <Wallet size={15} aria-hidden />
                  <div>
                    <span>Concluído a receber · {dateTime(order.receivableAt)}</span>
                    <strong>{order.receivableReason || '—'}</strong>
                  </div>
                </div>
              )}
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

            {order.payOnline && <OnlineCharges order={order} onDone={(o) => setOrder(o)} />}

            {order.pixStatus && (
              <section className="od-block od-card">
                <h3 className="od-block__title">
                  Pix pelo cardápio <PixReceiptChip order={order} />
                </h3>
                {order.pixReceipts?.[0] ? (
                  <PixReceiptReview
                    key={order.pixReceipts[0].id}
                    order={order}
                    receipt={order.pixReceipts[0]}
                    onDone={(o) => setOrder(o)}
                  />
                ) : (
                  <p className="od-empty">
                    O cliente escolheu Pix e ainda não mandou o comprovante. Ele pode mandar pelo
                    acompanhamento do pedido.
                  </p>
                )}
                {(order.pixReceipts?.length ?? 0) > 1 && (
                  <ul className="pix-history" aria-label="Comprovantes anteriores">
                    {order.pixReceipts!.slice(1).map((r) => (
                      <li key={r.id}>
                        {dateTime(r.createdAt)} ·{' '}
                        {r.status === 'replaced'
                          ? 'trocado pelo cliente'
                          : r.status === 'rejected'
                            ? `recusado${r.rejectReason ? `: ${r.rejectReason}` : ''}`
                            : r.status === 'refunded'
                              ? 'devolvido'
                              : r.status}{' '}
                        {r.hasFile && (
                          <button
                            type="button"
                            className="od-fact__link"
                            onClick={() =>
                              setReceiptView(
                                receiptFile(
                                  order.id,
                                  r,
                                  `Comprovante anterior · Pedido #${order.number}`,
                                ),
                              )
                            }
                          >
                            ver
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {order.channel === 'delivery' && order.status === 'dispatched' && canDispatch && (
              <OrderLiveMap orderId={order.id} />
            )}

            <section className="od-block">
              <h3 className="od-block__title">
                {mode === 'edit' ? 'Editar itens do pedido' : 'Itens do pedido'}
                {mode !== 'edit' && (
                  <span className="od-pill">
                    {order.items.length} {order.items.length === 1 ? 'item' : 'itens'}
                  </span>
                )}
                {canEdit && !mode && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="od-block__edit"
                    icon={<Pencil size={14} />}
                    onClick={() => setMode('edit')}
                  >
                    Editar
                  </Button>
                )}
              </h3>
              {mode === 'edit' ? (
                <OrderEditor order={order} onSaved={setOrder} onClose={() => setMode(null)} />
              ) : (
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
                            <span className="od-item__status" data-hue={ITEM_STATUS_HUE[i.status]}>
                              {ITEM_STATUS_LABEL[i.status]}
                            </span>
                            {order.app?.unlinked.includes(i.id) && (
                              <Link className="od-item__status" data-hue="amber" to="/integracoes">
                                sem vínculo
                              </Link>
                            )}
                          </div>
                          {i.options.length > 0 && (
                            <div className="od-item__sub">
                              {i.options.map((o) => o.name).join(' · ')}
                            </div>
                          )}
                          {i.notes && <div className="od-item__sub">Obs.: {i.notes}</div>}
                          {i.status !== 'cancelled' && (i.readyAt || i.startedAt) && (
                            <div className="od-item__sub">
                              {i.readyAt
                                ? `Pronto às ${time(i.readyAt)}`
                                : `Em preparo desde ${time(i.startedAt!)}`}
                            </div>
                          )}
                          {i.cancelReason && (
                            <div className="od-item__sub">Cancelado: {i.cancelReason}</div>
                          )}
                        </div>
                      </div>
                      <div className="od-item__bottom">
                        <span>
                          {i.unit === 'kg'
                            ? `${qtyLabel(i.quantity, 'kg')} × ${brl(i.unitPrice)}/kg`
                            : `${qty(i.quantity)} UN × ${brl(i.unitPrice)}`}
                        </span>
                        <strong>{brl(i.total)}</strong>
                      </div>
                      {canCancelItem && i.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="od-item__cancel"
                          aria-label={`Cancelar ${i.name}`}
                          onClick={() =>
                            // O último item só sai cancelando o pedido inteiro (regra do servidor).
                            setMode(activeItems > 1 ? { cancelItem: i } : 'cancel')
                          }
                        >
                          <XCircle size={14} aria-hidden /> Cancelar item
                        </button>
                      )}
                      {mode &&
                        typeof mode === 'object' &&
                        'cancelItem' in mode &&
                        mode.cancelItem.id === i.id && (
                          <ReasonForm
                            label={`Motivo do cancelamento de ${i.name} (opcional)`}
                            confirm="Cancelar item"
                            danger
                            optional
                            busy={busy}
                            onCancel={() => setMode(null)}
                            onConfirm={(r) => void cancelItem(i, r)}
                          />
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {mode === 'cancel' && isApp && (
              <AppCancelForm
                orderId={order.id}
                confirm="Pedir cancelamento ao aplicativo"
                note='O pedido fica "Cancelamento solicitado" até o aplicativo confirmar. Se ele negar, o pedido volta para onde estava.'
                busy={busy}
                onCancel={() => setMode(null)}
                onConfirm={(r, code) => go('cancel_requested', r, undefined, code)}
              />
            )}
            {mode === 'reject' && isApp && (
              <AppCancelForm
                orderId={order.id}
                confirm="Recusar pedido"
                busy={busy}
                onCancel={() => setMode(null)}
                onConfirm={(r, code) => go('cancelled', r, undefined, code)}
              />
            )}
            {mode === 'cancel' && !isApp && (
              <ReasonForm
                label="Motivo do cancelamento (opcional)"
                confirm={
                  order.status === 'cancel_requested' ? 'Aprovar cancelamento' : 'Cancelar pedido'
                }
                danger
                optional
                busy={busy}
                onCancel={() => setMode(null)}
                onConfirm={(r) => go(canCancel ? 'cancelled' : 'cancel_requested', r)}
              />
            )}
            {mode === 'reject' && !isApp && (
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
            {mode === 'fiado' && (
              <FiadoForm
                order={order}
                onCancel={() => setMode(null)}
                onDone={(o) => {
                  setOrder(o);
                  setMode(null);
                }}
              />
            )}
            {mode === 'receivable' && (
              <ReasonForm
                label={`Por que concluir com ${brl(order.balance)} em aberto? (fica em "Concluídos em aberto")`}
                confirm="Concluir a receber"
                busy={busy}
                onCancel={() => setMode(null)}
                onConfirm={(r) => go('completed', r, true)}
              />
            )}
            {mode && typeof mode === 'object' && 'refund' in mode && (
              <RefundForm
                payment={mode.refund}
                onCancel={() => setMode(null)}
                onDone={() => {
                  setMode(null);
                  void load();
                }}
              />
            )}
          </div>

          <div className="od-side">
            <section className="od-block od-card">
              <h3 className="od-block__title">Pagamentos</h3>
              {order.payments && order.payments.length > 0 ? (
                <ul className="od-rows">
                  {order.payments.map((p) => (
                    <li key={p.id}>
                      <div>
                        <strong>{paymentLabel(p)}</strong>
                        <div className="od-item__sub">
                          {dateTime(p.createdAt)}
                          {p.createdByName && ` · ${p.createdByName}`}
                          {p.appBrand && ` · ${p.appBrand}`}
                          {p.method === 'app' && ' · fora do caixa, volta no repasse'}
                          {toCents(p.refundedAmount) > 0 && ` · estornado ${brl(p.refundedAmount)}`}
                        </div>
                      </div>
                      <span className="od-rows__end">
                        <strong className="od-rows__paid">{brl(p.amount)}</strong>
                        {canRefund &&
                          p.method !== 'app' &&
                          toCents(p.amount) > toCents(p.refundedAmount) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setMode({ refund: p })}
                            >
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

            {order.history && order.history.length > 0 && (
              <details className="od-block od-history" open={wideDrawer()}>
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
          </div>
          <CloseOrderPanel
            order={order}
            open={paying}
            onClose={() => setPaying(false)}
            onDone={(o) => {
              setPaying(false);
              if (o) setOrder(o);
              void load();
            }}
          />
          <ReceiptPreview
            target={previewKind ? { kind: 'order', id: order.id, doc: previewKind } : null}
            onClose={() => setPreviewKind(null)}
          />
          <ReceiptFileModal file={receiptView} onClose={() => setReceiptView(null)} />
        </div>
      )}
    </Frame>
  );
}

/** Pedido ainda andando: mostra há quanto tempo foi feito ao lado da hora. */
const OPEN_STATUSES = new Set<Order['status']>([
  'awaiting',
  'new',
  'in_production',
  'ready',
  'dispatched',
]);

/** Gaveta larga (computador, ops.css): o histórico já vem aberto na coluna da direita. */
const wideDrawer = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1100px)').matches;

const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'Pendente',
  preparing: 'Em preparo',
  ready: 'Pronto',
  cancelled: 'Cancelado',
};

/**
 * Tons suaves do detalhe do pedido (data-hue → --hue, em ops.css; cores em tokens.css): os de
 * apoio diferenciam ações e dados; os de situação repetem os selos (info, sucesso, aviso, perigo).
 */
const HUES = [
  'blue',
  'violet',
  'teal',
  'green',
  'amber',
  'rose',
  'slate',
  'info',
  'success',
  'warning',
  'danger',
  'brand',
  'neutral',
] as const;
type Hue = (typeof HUES)[number];

const ITEM_STATUS_HUE: Record<ItemStatus, Hue> = {
  pending: 'slate',
  preparing: 'warning',
  ready: 'success',
  cancelled: 'danger',
};

const CHANNEL_HUE: Record<Order['channel'], Hue> = {
  counter: 'blue',
  table: 'teal',
  delivery: 'violet',
  pickup: 'amber',
};

function ChannelIcon({ channel }: { channel: Order['channel'] }) {
  if (channel === 'delivery') return <Bike size={18} />;
  if (channel === 'table') return <UtensilsCrossed size={18} />;
  return <ShoppingBag size={18} />;
}

interface MenuAction {
  label: string;
  icon: ReactNode;
  hue: Hue;
  run(): void;
}

/** Rótulo pequeno em cima, valor embaixo (bloco de informações do pedido). */
function Fact({
  label,
  icon,
  hue,
  wide,
  children,
}: {
  label: string;
  icon: ReactNode;
  hue?: Hue;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="od-fact" data-wide={wide || undefined} data-hue={hue}>
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
  userId: string | null;
  linkCreatedAt: string | null;
}

/** Entregador sem app (sem PIN/login e sem link): o pedido não chega no celular dele. */
const offApp = (c: Courier) => !c.userId && !c.linkCreatedAt;

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
        // Só escolhe sozinho quando há um único entregador: com mais, quem despacha escolhe.
        setCourierId(active.length === 1 ? active[0]!.id : '');
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
        <span className="cm-hint">
          {offApp(sent)
            ? `${sent.name.split(' ')[0]} não usa o app: avise pelo WhatsApp ou gere o link em Entregas.`
            : 'A corrida já apareceu no app do entregador, com o som de chamada.'}
        </span>
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
        <Skeleton />
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
            {couriers.length > 1 && <option value="">Escolha o entregador…</option>}
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {offApp(c) ? ' (sem app)' : ''}
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
  optional,
  onCancel,
  onConfirm,
}: {
  label: string;
  confirm: string;
  danger?: boolean;
  busy?: boolean;
  /** Motivo opcional: confirma mesmo com o campo vazio. */
  optional?: boolean;
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
          disabled={!optional && reason.trim().length < 3}
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
  const canBigDiscount = useCan('orders:discount');
  const [discount, setDiscount] = useState(order.discount.replace('.', ','));
  const [surcharge, setSurcharge] = useState(order.surcharge.replace('.', ','));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = parseBrlInput(discount);
  const s = parseBrlInput(surcharge);
  // Mesmas contas do servidor (OrdersService.adjust), para dizer o motivo antes de tentar.
  const subtotal = toCents(order.subtotal);
  const paid = toCents(order.paidAmount);
  const dc = d ? toCents(d) : 0;
  const total = subtotal - dc + (s ? toCents(s) : 0) + toCents(order.deliveryFee);
  const pct = subtotal > 0 ? (dc * 100) / subtotal : 0;
  const problem = !d
    ? null
    : dc > subtotal
      ? `O desconto passa do valor dos itens (${brl(order.subtotal)}).`
      : total < paid
        ? `Este pedido já tem ${brl(order.paidAmount)} pago. Com esse valor o total ficaria ${brl(fromCents(total))}, menor que o pago: estorne a diferença em Pagamentos antes de dar o desconto.`
        : pct > 10 && !canBigDiscount
          ? 'Desconto acima de 10% só o gerente aplica.'
          : null;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api<Order>(`/orders/${order.id}/adjustments`, {
          method: 'PATCH',
          json: { discount: d, surcharge: s, reason },
        }),
      );
    } catch (e) {
      setError(`Não aplicou: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inline-form">
      {(problem || error) && <Alert tone="danger">{problem ?? error!}</Alert>}
      <div className="two-cols">
        <TextField
          label="Desconto"
          inputMode="decimal"
          value={discount}
          onChange={(e) => {
            setDiscount(e.target.value);
            setError(null);
          }}
          error={!d ? 'Valor inválido' : undefined}
          hint={canBigDiscount ? undefined : 'Acima de 10% exige gerente'}
        />
        <TextField
          label="Acréscimo"
          inputMode="decimal"
          value={surcharge}
          onChange={(e) => {
            setSurcharge(e.target.value);
            setError(null);
          }}
          error={!s ? 'Valor inválido' : undefined}
        />
      </div>
      <TextField
        label="Motivo"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        hint={reason.trim().length < 3 ? 'Escreva o motivo (pelo menos 3 letras)' : undefined}
      />
      <div className="actions-row">
        {d && s && !problem && <span className="cm-hint">Novo total: {brl(fromCents(total))}</span>}
        <Button variant="secondary" onClick={onCancel}>
          Voltar
        </Button>
        <Button
          loading={busy}
          disabled={!d || !s || !!problem || reason.trim().length < 3}
          onClick={save}
        >
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
      <strong>Estornar {paymentLabel(payment)}</strong>
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

const ACTION_STATUS: Record<AppOrderInfo['actions'][number]['status'], string> = {
  pending: 'na fila',
  sending: 'enviando…',
  sent: 'enviado',
  confirmed: 'confirmado',
  failed: 'falhou',
};

/** Pedido de aplicativo: quem paga, o desconto do aplicativo e o que já foi avisado a ele. */
function AppOrderNote({ app, order }: { app: AppOrderInfo; order: Order }) {
  const failed = app.actions.some((a) => a.status === 'failed');
  const method = app.paymentMethod ? PAYMENT_METHOD_LABELS[app.paymentMethod] : null;
  // Troco calculado (o iFood exige mostrar): "troco para" menos o que o cliente paga na entrega.
  const due = toCents(order.balance);
  const change = order.changeFor ? toCents(order.changeFor) - due : 0;
  return (
    <div className="od-note" data-tone={failed || app.unlinkedItems ? 'warning' : undefined}>
      <Smartphone size={15} aria-hidden />
      <div>
        {order.status === 'awaiting' && app.confirmBy && <AcceptDeadline until={app.confirmBy} />}
        <span>
          {app.prepaid
            ? `Pago no aplicativo${method ? ` (${method}${app.paymentBrand ? ` ${app.paymentBrand}` : ''})` : ''}`
            : `Cobrar na entrega${method ? `: ${method}${app.paymentBrand ? ` ${app.paymentBrand}` : ''}` : ''}${
                due > 0 ? ` ${brl(order.balance)}` : ''
              }${change > 0 ? `, levar troco de ${brl(fromCents(change))}` : ''}`}
          {' · '}
          {app.deliveredBy === 'channel' ? 'entrega do aplicativo' : 'entrega da loja'}
          {Number(app.channelDiscount) > 0 &&
            ` · cupom pago pelo aplicativo ${brl(app.channelDiscount)} (volta no repasse)`}
          {Number(app.merchantDiscount) > 0 &&
            ` · cupom pago pela loja ${brl(app.merchantDiscount)}`}
          {app.pickupCode && ` · código de retirada ${app.pickupCode}`}
          {order.taxDocument && ` · CPF/CNPJ na nota ${order.taxDocument}`}
        </span>
        {app.unlinkedItems > 0 && (
          <strong>
            {app.unlinkedItems === 1
              ? '1 item sem vínculo com o cardápio'
              : `${app.unlinkedItems} itens sem vínculo com o cardápio`}
          </strong>
        )}
        {app.actions.length > 0 && (
          <span>
            {app.actions
              .map(
                (a) =>
                  `${CHANNEL_ACTION_LABELS[a.action as ChannelAction] ?? a.action}: ${ACTION_STATUS[a.status]}${
                    a.status === 'failed' && a.lastError ? ` (${a.lastError})` : ''
                  }`,
              )
              .join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}
