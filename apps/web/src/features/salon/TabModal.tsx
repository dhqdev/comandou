import { toCents, qtyLabel } from '@comandou/shared';
import {
  ArrowRightLeft,
  BellRing,
  CircleCheck,
  Plus,
  Receipt,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ItemThumbStrip,
  Modal,
  Spinner,
  useToast,
} from '../../design-system';
import { mediaUrl } from '../../lib/media';
import { useCan } from '../../app/auth';
import { NewSaleModal } from '../NewSaleModal';
import { OrderDetailModal } from '../OrderDetailModal';
import { PaymentModal } from '../PaymentModal';
import { ReceiptPreview } from '../ReceiptPreview';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  STATUS_TONE,
} from '../format';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useRealtime } from '../../lib/realtime';
import type { DiningTable, Tab } from '../../lib/types';
import '../../pages/salon.css';

const pct = (v: string) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/**
 * Comanda aberta: pedidos, taxa de serviço, troca de mesa, conta e pagamento. Usada no Salão e no
 * PDV (toque numa mesa ocupada ou numa comanda abre aqui mesmo, sem trocar de tela).
 */
export function TabModal({
  tabId,
  tables,
  onClose,
  onChanged,
  onBillRequested,
}: {
  tabId: string | null;
  tables: DiningTable[];
  onClose(): void;
  onChanged(): void;
  /** Quem marcou "pediu a conta" aqui não ouve o próprio aviso. */
  onBillRequested(tabId: string): void;
}) {
  const toast = useToast();
  const canPay = useCan('payments:create');
  const canOperate = useCan('tables:operate');
  const canManage = useCan('orders:manage');
  const [tab, setTab] = useState<Tab | null>(null);
  /** Taxa de serviço padrão do salão (Configurações), para religar numa comanda sem taxa. */
  const [defaultFee, setDefaultFee] = useState<string>('0.00');
  useEffect(() => {
    if (!tabId) return;
    api<{ serviceFeePercent: string }>('/salon/settings')
      .then((r) => setDefaultFee(r.serviceFeePercent))
      .catch(() => undefined);
  }, [tabId]);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Comprovante de fechamento na tela (antes ou logo depois de fechar a conta). */
  const [receipt, setReceipt] = useState<{ afterClose: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!tabId) return;
    try {
      setTab(await api<Tab>(`/tabs/${tabId}`));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }, [tabId, toast]);
  useEffect(() => {
    setTab(null);
    setTransfer(false);
    void load();
  }, [load]);
  useRealtime((e) => {
    if (
      (e.type === 'tab.changed' && e.tabId === tabId) ||
      (e.type === 'order.changed' && tab?.orders?.some((o) => o.id === e.orderId))
    )
      void load();
  }, load);

  async function close() {
    if (!tab) return;
    setBusy(true);
    try {
      await api(`/tabs/${tab.id}/close`, { method: 'POST' });
      toast(`Conta da comanda ${tab.number} fechada`, 'success');
      onChanged();
      setReceipt({ afterClose: true });
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function billRequest(requested: boolean) {
    if (!tab) return;
    if (requested) onBillRequested(tab.id);
    try {
      setTab(
        await api<Tab>(`/tabs/${tab.id}/bill-request`, { method: 'POST', json: { requested } }),
      );
      onChanged();
      toast(
        requested ? 'Caixa avisado: mesa pediu a conta' : 'Pedido de conta desfeito',
        'success',
      );
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  async function setFee(percent: string | null) {
    if (!tab) return;
    try {
      setTab(await api<Tab>(`/tabs/${tab.id}/service-fee`, { method: 'POST', json: { percent } }));
      onChanged();
      toast(percent ? 'Taxa de serviço cobrada' : 'Taxa de serviço retirada', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  async function moveTo(tableId: string) {
    if (!tab) return;
    try {
      setTab(await api<Tab>(`/tabs/${tab.id}/transfer`, { method: 'POST', json: { tableId } }));
      setTransfer(false);
      onChanged();
      toast('Mesa transferida', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const title = tab
    ? tab.tableLabel
      ? `Mesa ${tab.tableLabel} · comanda ${tab.number}`
      : `Comanda ${tab.number}`
    : 'Comanda';
  const label = tab?.tableLabel ? `Mesa ${tab.tableLabel}` : `Comanda ${tab?.number ?? ''}`;
  const open = tab?.status === 'open';
  const owes = !!tab && toCents(tab.balance) > 0;
  // Rodapé fixo (padrão das folhas): a ação principal fica sempre à vista, grande, embaixo.
  const footer =
    !tab || !open ? undefined : transfer ? (
      <Button variant="secondary" size="lg" onClick={() => setTransfer(false)}>
        Voltar
      </Button>
    ) : (
      <>
        {canOperate && (
          <Button
            variant={canPay ? 'secondary' : 'primary'}
            size="lg"
            icon={<Plus size={18} />}
            onClick={() => setAdding(true)}
          >
            Adicionar pedido
          </Button>
        )}
        <Button
          variant="secondary"
          size="lg"
          icon={<ReceiptText size={18} />}
          onClick={() => setReceipt({ afterClose: false })}
        >
          Comprovante
        </Button>
        {canPay &&
          (owes ? (
            <Button size="lg" icon={<Wallet size={18} />} onClick={() => setPaying(true)}>
              Receber {brl(tab.balance)}
            </Button>
          ) : (
            <Button
              variant="success"
              size="lg"
              loading={busy}
              icon={<CircleCheck size={18} />}
              onClick={close}
            >
              Fechar conta
            </Button>
          ))}
      </>
    );
  return (
    <Modal open={!!tabId} onClose={onClose} title={title} size="lg" footer={footer}>
      {!tab ? (
        <Spinner />
      ) : (
        <div className="order-detail">
          {tab.billRequestedAt && (
            <Alert tone="warning">
              Mesa pediu a conta às{' '}
              {new Date(tab.billRequestedAt).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {tab.billSplitParts
                ? `, dividida em ${tab.billSplitParts}. Ao receber, já vem uma parte por pessoa.`
                : '.'}
            </Alert>
          )}
          <div className="tab-summary">
            <div>
              <span>Total</span>
              <strong>{brl(tab.total)}</strong>
            </div>
            <div>
              <span>Pago</span>
              <strong>{brl(tab.paid)}</strong>
            </div>
            <div data-owes={owes || undefined}>
              <span>Saldo</span>
              <strong>{brl(tab.balance)}</strong>
            </div>
          </div>
          {open && (tab.serviceFeePercent || Number(defaultFee) > 0) && (
            <div className="tab-fee">
              {tab.serviceFeePercent ? (
                <span>
                  Taxa de serviço {pct(tab.serviceFeePercent)} ·{' '}
                  <strong>{brl(tab.serviceFee ?? '0')}</strong>
                </span>
              ) : (
                <span>Sem taxa de serviço nesta comanda</span>
              )}
              {canManage &&
                (tab.serviceFeePercent ? (
                  <Button variant="ghost" size="sm" onClick={() => void setFee(null)}>
                    Tirar taxa
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void setFee(defaultFee)}>
                    Cobrar {pct(defaultFee)}
                  </Button>
                ))}
            </div>
          )}
          {(tab.orders ?? []).length === 0 ? (
            <EmptyState title="Nenhum pedido nesta comanda" />
          ) : (
            <table className="cm-table cm-table--click">
              <tbody>
                {tab.orders!.map((o) => (
                  <tr key={o.id} onClick={() => setOrderId(o.id)}>
                    <td>
                      <strong>#{o.number}</strong>
                      <ItemThumbStrip
                        items={o.items.map((i) => ({
                          key: i.id,
                          src: mediaUrl(i.imageId),
                          name: i.name,
                        }))}
                        size={24}
                      />
                      <div className="cm-hint">
                        {o.items.map((i) => `${qtyLabel(i.quantity, i.unit)} ${i.name}`).join(', ')}
                      </div>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                    </td>
                    <td>
                      <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>
                        {PAYMENT_STATUS_LABEL[o.paymentStatus]}
                      </Badge>
                    </td>
                    <td className="cm-num">{brl(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {transfer && (
            <div className="inline-form">
              <strong>Transferir para</strong>
              <div className="chips">
                {tables
                  .filter((t) => !t.tabId)
                  .map((t) => (
                    <button key={t.id} className="chip" onClick={() => moveTo(t.id)}>
                      Mesa {t.label}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {open && !transfer && (
            <div className="tab-actions">
              {canPay && owes && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<Receipt size={18} />}
                  onClick={() => setPaying(true)}
                >
                  Receber / dividir
                </Button>
              )}
              {canOperate && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<BellRing size={18} />}
                  aria-pressed={!!tab.billRequestedAt}
                  onClick={() => billRequest(!tab.billRequestedAt)}
                >
                  {tab.billRequestedAt ? 'Desfazer pedido de conta' : 'Pediu a conta'}
                </Button>
              )}
              {canOperate && tab.tableId && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<ArrowRightLeft size={18} />}
                  onClick={() => setTransfer(true)}
                >
                  Transferir mesa
                </Button>
              )}
              {canPay && owes && (
                <p className="cm-hint tab-actions__hint">
                  Para fechar a conta, receba o saldo de {brl(tab.balance)}.
                </p>
              )}
            </div>
          )}
          <NewSaleModal
            open={adding}
            onClose={() => setAdding(false)}
            preset={{ channel: 'table', tabId: tab.id, label }}
            onCreated={() => {
              setAdding(false);
              void load();
              onChanged();
            }}
          />
          <PaymentModal
            open={paying}
            onClose={() => setPaying(false)}
            onPaid={() => {
              setPaying(false);
              void load();
              onChanged();
            }}
            target={{
              kind: 'tab',
              id: tab.id,
              number: tab.number,
              balance: tab.balance,
              splitParts: tab.billSplitParts,
            }}
          />
          <OrderDetailModal
            orderId={orderId}
            onClose={() => {
              setOrderId(null);
              void load();
            }}
          />
          <ReceiptPreview
            target={receipt ? { kind: 'tab', id: tab.id } : null}
            onClose={() => {
              const after = receipt?.afterClose;
              setReceipt(null);
              if (after) onClose();
            }}
          />
        </div>
      )}
    </Modal>
  );
}
