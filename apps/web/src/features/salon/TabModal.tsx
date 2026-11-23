import { toCents, qtyLabel } from '@comandou/shared';
import { ArrowRightLeft, BellRing, CircleCheck, Plus, ReceiptText, Wallet } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, EmptyState, Modal, useToast, Skeleton } from '../../design-system';
import { useCan } from '../../app/auth';
import { NewSaleModal } from '../NewSaleModal';
import { OrderDetailModal } from '../OrderDetailModal';
import { PaymentModal } from '../PaymentModal';
import { PixReceiptChip } from '../PixReceipt';
import { TabPixPanel, TabReceiptModal, useTabReceipts } from '../TableCalls';
import { ReceiptPreview } from '../ReceiptPreview';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  STATUS_TONE,
  time,
} from '../format';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useRealtime } from '../../lib/realtime';
import type { DiningTable, Tab } from '../../lib/types';
import '../../pages/salon.css';

const pct = (v: string) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/** O que a janela já faz ao abrir, vindo do menu do cartão no PDV. */
export type TabIntent = 'transfer' | 'close';

/**
 * Comanda aberta: pedidos, taxa de serviço, troca de mesa, conta e pagamento. Usada no Salão e no
 * PDV (toque numa mesa ocupada ou numa comanda abre aqui mesmo, sem trocar de tela).
 *
 * `intent` vem do menu de três pontinhos do PDV: `transfer` abre já na escolha da mesa e `close`
 * fecha a conta (com saldo, abre o recebimento e fecha sozinha quando o saldo zera).
 */
export function TabModal({
  tabId,
  tables,
  onClose,
  onChanged,
  onBillRequested,
  intent = null,
}: {
  tabId: string | null;
  intent?: TabIntent | null;
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
  /** Conferindo o comprovante do Pix que a mesa mandou (`reject` = abre já no motivo). */
  const [reviewPix, setReviewPix] = useState<{ reject: boolean } | null>(null);

  /** Ação do menu ainda por fazer (uma vez, assim que a comanda chega). */
  const pending = useRef<TabIntent | null>(null);
  /** Recebimento aberto pelo "Fechar conta": pago tudo, a conta fecha junto. */
  const closeAfterPay = useRef(false);
  /** Pergunta antes de fechar: fechar a conta libera a mesa e não tem volta. */
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    if (!tabId) return null;
    try {
      const t = await api<Tab>(`/tabs/${tabId}`);
      setTab(t);
      return t;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return null;
    }
  }, [tabId, toast]);
  // Comprovante do Pix da conta que a mesa mandou (só quem recebe pagamento vê o arquivo).
  const pixWaiting = !!tab?.pixReceiptAt && tab.status === 'open';
  const pixList = useTabReceipts(canPay && pixWaiting, false);
  const pix = pixWaiting ? (pixList.items.find((r) => r.tabId === tab?.id) ?? null) : null;
  const reloadPix = pixList.reload;
  useEffect(() => {
    if (pixWaiting && canPay) void reloadPix();
  }, [pixWaiting, canPay, tab?.pixReceiptAt, reloadPix]);

  useEffect(() => {
    setTab(null);
    setTransfer(false);
    setReviewPix(null);
    pending.current = intent;
    closeAfterPay.current = false;
    setConfirming(false);
    void load();
    // A ação do menu vale só para a comanda que abriu com ela.
  }, [load]);
  useRealtime((e) => {
    if (
      (e.type === 'tab.changed' && e.tabId === tabId) ||
      (e.type === 'order.changed' && tab?.orders?.some((o) => o.id === e.orderId))
    )
      void load();
  }, load);

  async function close(target: Tab | null = tab) {
    if (!target) return;
    setBusy(true);
    try {
      await api(`/tabs/${target.id}/close`, { method: 'POST' });
      setConfirming(false);
      toast(`Conta da comanda ${target.number} fechada`, 'success');
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

  // Ação pedida pelo menu do cartão, assim que a comanda carrega.
  useEffect(() => {
    const want = pending.current;
    if (!tab || !want || tab.id !== tabId) return;
    pending.current = null;
    if (tab.status !== 'open') return;
    if (want === 'transfer') {
      if (canOperate) setTransfer(true);
    } else if (canPay) {
      // Comprovante do Pix esperando: fechar a conta é conferir o Pix (cobrar de novo é barrado).
      if (tab.pixReceiptAt) setReviewPix({ reject: false });
      else if (toCents(tab.balance) > 0) {
        closeAfterPay.current = true;
        setPaying(true);
      } else setConfirming(true);
    }
  }, [tab, tabId, canOperate, canPay]);

  const label = tab?.tableLabel ? `Mesa ${tab.tableLabel}` : `Comanda ${tab?.number ?? ''}`;
  const title = tab ? (
    <span className="tabm-title">
      {label}
      {tab.tableLabel && <span className="tabm-title__sub">comanda {tab.number}</span>}
      <span className="tabm-title__sub">aberta às {time(tab.openedAt)}</span>
    </span>
  ) : (
    'Comanda'
  );
  const open = tab?.status === 'open';
  const owes = !!tab && toCents(tab.balance) > 0;
  const orders = tab?.orders ?? [];
  const feeCents = toCents(tab?.serviceFee ?? '0');
  const paidCents = toCents(tab?.paid ?? '0');
  const parts = tab?.billSplitParts ?? 0;
  // Rodapé fixo (padrão das folhas): lançar mais e a ação principal (receber ou fechar a conta).
  const footer =
    !tab || !open ? undefined : (
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
        {canPay &&
          (pixWaiting ? (
            <Button
              size="lg"
              icon={<ReceiptText size={18} />}
              disabled={!pix}
              onClick={() => setReviewPix({ reject: false })}
            >
              Conferir Pix {pix ? brl(pix.amount) : ''}
            </Button>
          ) : owes ? (
            <Button size="lg" icon={<Wallet size={18} />} onClick={() => setPaying(true)}>
              Receber {brl(tab.balance)}
            </Button>
          ) : (
            <Button
              variant="success"
              size="lg"
              loading={busy}
              icon={<CircleCheck size={18} />}
              onClick={() => setConfirming(true)}
            >
              Fechar conta
            </Button>
          ))}
      </>
    );
  return (
    <Modal
      open={!!tabId}
      onClose={onClose}
      title={title}
      size="lg"
      footer={footer}
      className="tabm-modal"
    >
      {!tab ? (
        <Skeleton variant="detail" />
      ) : (
        <div className="tabm-wrap">
          {pixWaiting && (
            <TabPixPanel
              receipt={pix}
              pendingSince={tab.pixReceiptAt!}
              canPay={canPay}
              onReview={(reject) => setReviewPix({ reject })}
            />
          )}
          <div className="tabm">
            {/* Pedidos: o que a mesa consumiu, um por linha, com o que tem dentro escrito por extenso. */}
            <section className="tabm__orders" aria-label="Pedidos da comanda">
              <h3 className="tabm__heading">
                Pedidos <span className="tabm__count">{orders.length}</span>
              </h3>
              {orders.length === 0 ? (
                <EmptyState title="Nenhum pedido nesta comanda" />
              ) : (
                <ul className="tabm-list">
                  {orders.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className="tabm-order"
                        onClick={() => setOrderId(o.id)}
                        aria-label={`Abrir o pedido ${o.number}`}
                      >
                        <span className="tabm-order__top">
                          <strong className="tabm-order__num">#{o.number}</strong>
                          <span className="tabm-order__time">{time(o.createdAt)}</span>
                          <strong className="tabm-order__total">{brl(o.total)}</strong>
                        </span>
                        <span className="tabm-order__states">
                          <span className="tabm-state" data-tone={STATUS_TONE[o.status]}>
                            <span className="cm-dot" aria-hidden />
                            {ORDER_STATUS_LABELS[o.status]}
                          </span>
                          <span
                            className="tabm-state"
                            data-tone={PAYMENT_STATUS_TONE[o.paymentStatus]}
                          >
                            <span className="cm-dot" aria-hidden />
                            {PAYMENT_STATUS_LABEL[o.paymentStatus]}
                          </span>
                        </span>
                        {/* Um item por linha: quantidade em destaque e o nome por extenso. */}
                        <span className="tabm-order__items">
                          {o.items.map((i) => (
                            <span key={i.id} className="tabm-item">
                              <span className="tabm-item__qty">{qtyLabel(i.quantity, i.unit)}</span>
                              {i.name}
                            </span>
                          ))}
                        </span>
                        {/* Cliente pagou pelo Pix do cardápio: tocar no pedido abre o comprovante. */}
                        {o.pixStatus && o.paymentStatus !== 'paid' && <PixReceiptChip order={o} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Conta: quanto falta (o número que importa), de onde ele vem e o que dá para fazer. */}
            <aside className="tabm__bill" aria-label="Conta">
              <div className="tabm-due" data-paid={!owes || undefined}>
                <span className="tabm-due__label">{owes ? 'Falta receber' : 'Conta paga'}</span>
                <strong className="tabm-due__value">{brl(tab.balance)}</strong>
                {owes && (
                  <span className="tabm-due__hint">
                    {parts > 1
                      ? `Dividida em ${parts}: cerca de ${brl(
                          (toCents(tab.balance) / parts / 100).toFixed(2),
                        )} por pessoa.`
                      : 'Ao receber, dá para dividir entre as pessoas.'}
                  </span>
                )}
              </div>
              <dl className="tabm-lines">
                <div>
                  <dt>Consumo</dt>
                  <dd>{brl(((toCents(tab.total) - feeCents) / 100).toFixed(2))}</dd>
                </div>
                {(tab.serviceFeePercent || (open && Number(defaultFee) > 0)) && (
                  <div className="tabm-fee">
                    <dt>
                      {tab.serviceFeePercent
                        ? `Taxa de serviço (${pct(tab.serviceFeePercent)})`
                        : 'Taxa de serviço'}
                      <span className="tabm-fee__hint">
                        {tab.serviceFeePercent
                          ? 'Opcional: tire se o cliente não quiser pagar.'
                          : 'Não cobrada nesta comanda.'}
                      </span>
                    </dt>
                    <dd>
                      {tab.serviceFeePercent ? brl(tab.serviceFee ?? '0') : '—'}
                      {open &&
                        canManage &&
                        (tab.serviceFeePercent ? (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => void setFee(null)}
                          >
                            Tirar taxa
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => void setFee(defaultFee)}
                          >
                            Cobrar {pct(defaultFee)}
                          </button>
                        ))}
                    </dd>
                  </div>
                )}
                <div className="tabm-lines__total">
                  <dt>Total da conta</dt>
                  <dd>{brl(tab.total)}</dd>
                </div>
                <div data-paid={paidCents > 0 || undefined}>
                  <dt>Já pago</dt>
                  <dd>{brl(tab.paid)}</dd>
                </div>
              </dl>

              {transfer ? (
                <div className="tabm-move">
                  <h3 className="tabm__heading">Transferir para qual mesa?</h3>
                  {tables.filter((t) => !t.tabId).length === 0 ? (
                    <p className="cm-hint">Nenhuma mesa livre agora.</p>
                  ) : (
                    <div className="chips">
                      {tables
                        .filter((t) => !t.tabId)
                        .map((t) => (
                          <button key={t.id} className="chip" onClick={() => moveTo(t.id)}>
                            Mesa {t.label}
                          </button>
                        ))}
                    </div>
                  )}
                  <Button variant="ghost" onClick={() => setTransfer(false)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="tabm-tools">
                  <h3 className="tabm__heading">Mais opções</h3>
                  {open && canOperate && (
                    <button
                      type="button"
                      className="tabm-tool"
                      aria-pressed={!!tab.billRequestedAt}
                      onClick={() => billRequest(!tab.billRequestedAt)}
                    >
                      <BellRing size={18} aria-hidden />
                      <span className="tabm-tool__text">
                        <strong>
                          {tab.billRequestedAt ? 'Desfazer pedido de conta' : 'Pediu a conta'}
                        </strong>
                        <span>
                          {tab.billRequestedAt
                            ? `A mesa pediu às ${time(tab.billRequestedAt)}${
                                parts > 1 ? `, dividida em ${parts}` : ''
                              }.`
                            : 'Avisa o caixa que a mesa quer fechar.'}
                        </span>
                      </span>
                    </button>
                  )}
                  {open && canOperate && tab.tableId && (
                    <button type="button" className="tabm-tool" onClick={() => setTransfer(true)}>
                      <ArrowRightLeft size={18} aria-hidden />
                      <span className="tabm-tool__text">
                        <strong>Transferir mesa</strong>
                        <span>Leva a comanda inteira para outra mesa livre.</span>
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="tabm-tool"
                    onClick={() => setReceipt({ afterClose: false })}
                  >
                    <ReceiptText size={18} aria-hidden />
                    <span className="tabm-tool__text">
                      <strong>Comprovante</strong>
                      <span>Mostra ou imprime a conta para o cliente conferir.</span>
                    </span>
                  </button>
                </div>
              )}
            </aside>
          </div>
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
            onClose={() => {
              setPaying(false);
              closeAfterPay.current = false;
            }}
            onPaid={() => {
              setPaying(false);
              const andClose = closeAfterPay.current;
              closeAfterPay.current = false;
              void load().then((t) => {
                // Pago tudo pelo "Fechar conta": ainda pergunta antes de fechar.
                if (andClose && t?.status === 'open' && toCents(t.balance) <= 0)
                  setConfirming(true);
              });
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
          <Modal
            open={confirming && tab.status === 'open'}
            onClose={() => setConfirming(false)}
            title={`Fechar a conta da comanda ${tab.number}?`}
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
                <Button
                  variant="success"
                  loading={busy}
                  icon={<CircleCheck size={18} />}
                  onClick={() => void close()}
                >
                  Fechar conta
                </Button>
              </>
            }
          >
            <div className="tab-summary">
              <div>
                <span>Total</span>
                <strong>{brl(tab.total)}</strong>
              </div>
              <div>
                <span>Pago</span>
                <strong>{brl(tab.paid)}</strong>
              </div>
            </div>
            <p className="cm-hint">
              {tab.tableLabel
                ? `A mesa ${tab.tableLabel} fica livre e a comanda sai do salão. `
                : 'A comanda sai do salão. '}
              Nenhum pagamento novo é lançado: só fecha o que já foi pago.
            </p>
          </Modal>
          {reviewPix && pix && (
            <TabReceiptModal
              receipt={pix}
              startRejecting={reviewPix.reject}
              onClose={() => setReviewPix(null)}
              onDone={() => {
                setReviewPix(null);
                void reloadPix();
                void load();
                onChanged();
              }}
            />
          )}
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
