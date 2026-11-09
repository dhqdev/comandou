import { fromCents, splitCents, toCents, qtyLabel } from '@comandou/shared';
import { ArrowRightLeft, BellRing, Check, Plus, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ItemThumb,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { mediaUrl } from '../lib/media';
import { ORDER_STATUS_LABELS, STATUS_TONE, time } from '../features/format';
import { sortTables } from '../features/table-state';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useRealtime } from '../lib/realtime';
import type { DiningTable, Order, Tab } from '../lib/types';
import { SplitPicker } from '../features/PaymentModal';
import '../app/ops.css';
import { WaiterHead } from './common';

/** Pedido que ainda dá para pedir cancelamento (o caixa/gerente aprova). */
const CAN_ASK_CANCEL = new Set(['new', 'in_production', 'ready']);

/**
 * Comanda no app do garçom: o que a mesa pediu e o andamento na cozinha. Ele adiciona itens,
 * marca "pediu a conta", transfere a mesa e pede cancelamento. Receber e fechar ficam no caixa.
 */
export function WaiterTab() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [cancelOf, setCancelOf] = useState<Order | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTab(await api<Tab>(`/tabs/${id}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (
      (e.type === 'tab.changed' && e.tabId === id) ||
      (e.type === 'order.changed' && tab?.orders?.some((o) => o.id === e.orderId))
    )
      void load();
  }, load);

  async function billRequest(requested: boolean, splitParts = 1) {
    if (!tab) return;
    setBusy(true);
    try {
      setTab(
        await api<Tab>(`/tabs/${tab.id}/bill-request`, {
          method: 'POST',
          json: { requested, splitParts: requested && splitParts > 1 ? splitParts : null },
        }),
      );
      setAsking(false);
      toast(
        requested
          ? splitParts > 1
            ? `Caixa avisado: conta dividida em ${splitParts}`
            : 'Caixa avisado: a mesa pediu a conta'
          : 'Pedido de conta desfeito',
        'success',
      );
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  // Levou o pedido pronto: pago pelo Pix, conclui (e a conta paga inteira fecha sozinha).
  async function serve(o: Order) {
    setBusy(true);
    try {
      await api(`/orders/${o.id}/served`, { method: 'POST' });
      navigator.vibrate?.(12);
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const title = tab
    ? tab.tableLabel
      ? `Mesa ${tab.tableLabel}`
      : `Comanda ${tab.number}`
    : 'Comanda';
  const open = tab?.status === 'open';
  const orders = (tab?.orders ?? []).filter((o) => o.status !== 'cancelled');

  return (
    <div className="wt-page wt-page--dock">
      <WaiterHead
        title={title}
        sub={
          tab
            ? `Comanda ${tab.number}${tab.customerName ? ` · ${tab.customerName}` : ''}`
            : undefined
        }
        back="/garcom/mesas"
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {!tab ? (
        !error && <Spinner />
      ) : (
        <>
          {!open && <Alert tone="info">Esta comanda já foi fechada no caixa.</Alert>}
          {tab.billRequestedAt && open && (
            <Alert tone="warning">
              Pediu a conta às {time(tab.billRequestedAt)}
              {tab.billSplitParts
                ? `, dividida em ${tab.billSplitParts} (${splitCents(
                    toCents(tab.balance),
                    tab.billSplitParts,
                  )
                    .map((c) => brl(fromCents(c)))
                    .join(' + ')})`
                : ''}
              . O caixa já foi avisado.
            </Alert>
          )}
          <div className="wt-summary">
            <div>
              <span>Total</span>
              <strong>{brl(tab.total)}</strong>
            </div>
            <div>
              <span>Pago</span>
              <strong>{brl(tab.paid)}</strong>
            </div>
            <div data-owes={toCents(tab.balance) > 0 || undefined}>
              <span>Saldo</span>
              <strong>{brl(tab.balance)}</strong>
            </div>
          </div>

          {orders.length === 0 ? (
            <EmptyState
              title="Nenhum pedido nesta comanda"
              description="Toque em Adicionar itens para lançar o primeiro."
            />
          ) : (
            <div className="wt-list">
              {orders.map((o) => (
                <article key={o.id} className="wt-ticket">
                  <header className="wt-ticket__head">
                    <strong>#{o.number}</strong>
                    <span className="cm-hint">{time(o.createdAt)}</span>
                    {o.servedAt && o.status === 'ready' ? (
                      <Badge tone="success">Na mesa</Badge>
                    ) : (
                      <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                    )}
                    <strong className="wt-ticket__total">{brl(o.total)}</strong>
                  </header>
                  <ul className="wt-ticket__items">
                    {o.items.map((i) => (
                      <li key={i.id} data-status={i.status}>
                        <span className="cm-item-line">
                          <ItemThumb src={mediaUrl(i.imageId)} name={i.name} size={32} />
                          <span>
                            {qtyLabel(i.quantity, i.unit)} {i.name}
                            {i.options.length > 0 && (
                              <em> · {i.options.map((x) => x.name).join(', ')}</em>
                            )}
                            {i.notes && <em> · {i.notes}</em>}
                          </span>
                        </span>
                        {i.status === 'ready' && <Badge tone="success">pronto</Badge>}
                      </li>
                    ))}
                  </ul>
                  {open && o.status === 'ready' && !o.servedAt && (
                    <button
                      type="button"
                      className="wt-serve__done wt-ticket__serve"
                      disabled={busy}
                      onClick={() => void serve(o)}
                    >
                      <Check size={18} aria-hidden /> Entreguei na mesa
                    </button>
                  )}
                  {o.status === 'cancel_requested' ? (
                    <p className="wt-ticket__note">
                      Cancelamento pedido: {o.cancelReason}. Aguardando o caixa.
                    </p>
                  ) : (
                    open &&
                    CAN_ASK_CANCEL.has(o.status) && (
                      <button type="button" className="wt-link-btn" onClick={() => setCancelOf(o)}>
                        <Undo2 size={14} /> Pedir cancelamento
                      </button>
                    )
                  )}
                </article>
              ))}
            </div>
          )}

          {open && (
            <div className="wt-dock wt-dock--actions">
              <Button
                variant="secondary"
                size="lg"
                loading={busy}
                icon={<BellRing size={18} />}
                aria-pressed={!!tab.billRequestedAt}
                aria-label={tab.billRequestedAt ? 'Desfazer pedido de conta' : 'Pediu a conta'}
                onClick={() => (tab.billRequestedAt ? void billRequest(false) : setAsking(true))}
              >
                <span className="wt-hide-sm">
                  {tab.billRequestedAt ? 'Desfazer conta' : 'Pediu a conta'}
                </span>
              </Button>
              {tab.tableId && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<ArrowRightLeft size={18} />}
                  onClick={() => setTransfer(true)}
                  aria-label="Transferir mesa"
                >
                  <span className="wt-hide-sm">Transferir</span>
                </Button>
              )}
              <Button
                size="lg"
                icon={<Plus size={18} />}
                onClick={() => navigate(`/garcom/pedido?comanda=${tab.id}`)}
              >
                Adicionar itens
              </Button>
            </div>
          )}
        </>
      )}

      {tab && (
        <TransferModal
          open={transfer}
          onClose={() => setTransfer(false)}
          tab={tab}
          onMoved={(t) => {
            setTab(t);
            setTransfer(false);
            toast('Mesa transferida', 'success');
          }}
        />
      )}
      {tab && (
        <BillRequestModal
          open={asking}
          balance={tab.balance}
          busy={busy}
          onClose={() => setAsking(false)}
          onConfirm={(n) => void billRequest(true, n)}
        />
      )}
      <CancelRequestModal
        order={cancelOf}
        onClose={() => setCancelOf(null)}
        onDone={() => {
          setCancelOf(null);
          toast('Pedido de cancelamento enviado ao caixa', 'success');
          void load();
        }}
      />
    </div>
  );
}

/**
 * "Pediu a conta": o garçom já diz em quantas pessoas a mesa vai dividir. Mostra quanto dá para
 * cada um (para falar na mesa) e o caixa abre o recebimento com uma parte por pessoa.
 */
function BillRequestModal({
  open,
  balance,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  balance: string;
  busy: boolean;
  onClose(): void;
  onConfirm(parts: number): void;
}) {
  const [parts, setParts] = useState(1);
  useEffect(() => {
    if (open) setParts(1);
  }, [open]);
  const cents = toCents(balance);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pediu a conta"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} icon={<BellRing size={18} />} onClick={() => onConfirm(parts)}>
            Avisar o caixa
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="wt-summary wt-summary--one">
          <div>
            <span>Saldo da mesa</span>
            <strong>{brl(balance)}</strong>
          </div>
        </div>
        <SplitPicker value={parts} onChange={setParts} />
        {parts > 1 ? (
          <ol className="pay-parts" aria-label="Quanto fica para cada um">
            {splitCents(cents, parts).map((c, i) => (
              <li key={i}>
                <div className="pay-part">
                  <span className="pay-part__who">Pessoa {i + 1}</span>
                  <strong>{brl(fromCents(c))}</strong>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="cm-hint" style={{ margin: 0 }}>
            Vai dividir? Escolha em quantas pessoas: o caixa já recebe uma parte por vez.
          </p>
        )}
      </div>
    </Modal>
  );
}

function TransferModal({
  open,
  onClose,
  tab,
  onMoved,
}: {
  open: boolean;
  onClose(): void;
  tab: Tab;
  onMoved(t: Tab): void;
}) {
  const toast = useToast();
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setTables(null);
    api<DiningTable[]>('/tables').then(
      (t) => setTables(sortTables(t).filter((x) => !x.tabId)),
      (e: Error) => toast(e.message, 'danger'),
    );
  }, [open, toast]);
  async function move(tableId: string) {
    try {
      onMoved(await api<Tab>(`/tabs/${tab.id}/transfer`, { method: 'POST', json: { tableId } }));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Transferir mesa ${tab.tableLabel ?? ''}`}>
      {tables === null ? (
        <Spinner />
      ) : tables.length === 0 ? (
        <EmptyState title="Nenhuma mesa livre agora" />
      ) : (
        <>
          <p className="cm-hint" style={{ marginTop: 0 }}>
            Escolha a mesa livre para onde a comanda vai.
          </p>
          <div className="wt-grid wt-grid--sm">
            {tables.map((t) => (
              <button
                key={t.id}
                type="button"
                className="wt-table"
                data-state="free"
                onClick={() => move(t.id)}
              >
                <span className="wt-table__name">Mesa {t.label}</span>
                <span className="wt-table__meta">{t.seats} lugares</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function CancelRequestModal({
  order,
  onClose,
  onDone,
}: {
  order: Order | null;
  onClose(): void;
  onDone(): void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReason('');
    setError(null);
  }, [order]);
  async function send() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${order.id}/status`, {
        method: 'POST',
        json: { to: 'cancel_requested', reason: reason.trim(), expectedVersion: order.version },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={`Pedir cancelamento do #${order?.number ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={send}
          >
            Pedir cancelamento
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="cm-hint" style={{ margin: 0 }}>
          O caixa ou o gerente aprova. Até lá, o pedido continua na conta.
        </p>
        <TextField
          label="Motivo"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="Ex.: cliente desistiu, item errado"
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
