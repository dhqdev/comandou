import { pixBrCode, qtyLabel, toCents, type PixKeyType } from '@comandou/shared';
import {
  BadgeCheck,
  BellRing,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Hourglass,
  ReceiptText,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Skeleton } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import { WaiterArt } from './art';
import { useStore } from './context';
import { PixPay, ReceiptPicker, sendReceipt, type ReceiptFile } from './PixPay';
import { TableAppPay, TablePixWaiting, type TabOnline, type TablePagBank } from './TablePay';
import './table-service.css';

/** Conta da mesa como a API manda (GET /store/table/:id/bill). */
interface TableBill {
  table: { id: string; label: string };
  open: boolean;
  items: { name: string; quantity: string; unit: string; total: string }[];
  serviceFee: string;
  total: string;
  paid: string;
  due: string;
  awaiting: number;
  call: { kind: 'waiter' | 'bill'; createdAt: string } | null;
  /**
   * Formas de pagar pelo celular que a loja liberou: Pix com comprovante (`pix`), Pix do PagBank
   * que confirma sozinho (`pixAuto`, no lugar do outro) e cartão pelo PagBank (`card`).
   */
  methods: { pix: boolean; pixAuto: boolean; card: boolean };
  pix: { keyType: PixKeyType; key: string; name: string; city: string; keyLabel: string } | null;
  pagbank: TablePagBank | null;
  /** Pagamento da conta pelo PagBank (null sem conta aberta). */
  online: TabOnline | null;
  receipt: {
    status: 'submitted' | 'approved' | 'rejected';
    amount: string;
    rejectReason: string | null;
    at: string;
  } | null;
}

const minutesSince = (iso: string) =>
  Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
const sinceText = (iso: string) => {
  const m = minutesSince(iso);
  return m < 1 ? 'agora' : `há ${m} min`;
};

/**
 * Conta da mesa, atualizada a cada 10 s enquanto a tela está à vista (a cada 5 s enquanto o banco
 * confirma um pagamento pelo app; os celulares no Wi-Fi da loja dividem o limite por IP).
 */
function useTableBill() {
  const { table } = useStore();
  const [bill, setBill] = useState<TableBill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!table) return;
    try {
      setBill(await api<TableBill>(`/store/table/${table.id}/bill`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [table]);
  const waiting = !!bill?.online && (!!bill.online.pix || bill.online.processing);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = window.setInterval(
      () => document.visibilityState === 'visible' && load(),
      waiting ? 5_000 : 10_000,
    );
    return () => window.clearInterval(id);
  }, [load, waiting]);
  return { bill, error, reload: load, setBill };
}

/** Chamar o garçom (ou pagar com ele): manda onde o celular está, se a loja confere. */
function useCall(reload: () => Promise<void>) {
  const { table, here } = useStore();
  const [busy, setBusy] = useState<'waiter' | 'bill' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function call(kind: 'waiter' | 'bill') {
    if (!table) return;
    setBusy(kind);
    setError(null);
    try {
      await api(`/store/table/${table.id}/call`, {
        method: 'POST',
        json: { kind, ...(here ? { presence: here } : {}) },
      });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function cancel() {
    if (!table) return;
    setBusy('cancel');
    try {
      await api(`/store/table/${table.id}/call/cancel`, { method: 'POST', json: {} });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return { call, cancel, busy, error };
}

/** Aviso do chamado aberto: há quanto tempo e o botão de desistir. */
function CallStatus({
  call,
  onCancel,
  busy,
}: {
  call: NonNullable<TableBill['call']>;
  onCancel(): void;
  busy: boolean;
}) {
  return (
    <div className="tsv-called" role="status">
      <span className="tsv-called__icon" aria-hidden>
        <BellRing size={20} />
      </span>
      <span className="tsv-called__text">
        <strong>{call.kind === 'bill' ? 'Garçom chamado para receber' : 'Garçom chamado'}</strong>
        <small>{sinceText(call.createdAt)} · ele já está vindo até a sua mesa</small>
      </span>
      <button type="button" className="link" disabled={busy} onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

/**
 * Aba do meio do cardápio da mesa: dois botões grandes, "Chamar o garçom" e "Fechar a conta".
 * O chamado aparece no app do garçom e no sistema até alguém atender.
 */
export function TableServiceScreen() {
  const { table } = useStore();
  const navigate = useNavigate();
  const { bill, error, reload } = useTableBill();
  const { call, cancel, busy, error: callError } = useCall(reload);
  if (!table) return null;
  const open = bill?.call ?? null;
  return (
    <div className="sf-wrap sf-page tsv">
      <h1 className="page-h1">Mesa {table.label}</h1>
      <p className="tsv-lead">Precisa de alguma coisa? Chame o garçom ou feche a conta por aqui.</p>
      {open && <CallStatus call={open} onCancel={() => void cancel()} busy={busy === 'cancel'} />}
      <div className="tsv-actions">
        <button
          type="button"
          className="tsv-action"
          data-on={open?.kind === 'waiter' || undefined}
          disabled={!!busy}
          onClick={() => void call('waiter')}
        >
          <span className="tsv-action__icon" aria-hidden>
            <BellRing size={28} />
          </span>
          <span className="tsv-action__text">
            <strong>{busy === 'waiter' ? 'Chamando…' : 'Chamar o garçom'}</strong>
            <small>Ele recebe o aviso e vem até a sua mesa</small>
          </span>
        </button>
        <button type="button" className="tsv-action" onClick={() => navigate('/pedir/mesa/conta')}>
          <span className="tsv-action__icon" aria-hidden>
            <ReceiptText size={28} />
          </span>
          <span className="tsv-action__text">
            <strong>Fechar a conta</strong>
            <small>
              {bill?.open && toCents(bill.due) > 0
                ? `Falta pagar ${brl(bill.due)}`
                : bill?.open
                  ? 'Ver a conta da mesa'
                  : 'Nada pedido nesta mesa ainda'}
            </small>
          </span>
          <ChevronRight size={20} aria-hidden className="tsv-action__go" />
        </button>
      </div>
      {(callError || error) && (
        <p className="form-error" role="alert">
          {callError ?? error}
        </p>
      )}
      <WaiterArt live className="tsv-art" />
    </div>
  );
}

/**
 * Fechar a conta pelo celular: itens e saldo da mesa inteira (pedidos do garçom e de outros
 * celulares também), pagos pelas formas que a loja liberou: Pix do PagBank (confirma sozinho) ou
 * Pix com comprovante (o caixa confere), e cartão pelo PagBank. Sem nenhuma (ou se preferir),
 * chama o garçom para receber.
 */
export function TableBillScreen() {
  const { table } = useStore();
  const { bill, error, reload, setBill } = useTableBill();
  const { call, cancel, busy, error: callError } = useCall(reload);
  const [receipt, setReceipt] = useState<ReceiptFile | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [way, setWay] = useState<'pix' | 'card'>('pix');
  const [dropping, setDropping] = useState(false);
  // A conta fechou enquanto esta tela acompanhava o pagamento: agradece em vez de "nada pedido".
  const paying = useRef(false);
  const [thanks, setThanks] = useState(false);
  useEffect(() => {
    if (!bill) return;
    if (bill.open) {
      paying.current =
        !!bill.online?.pix ||
        !!bill.online?.processing ||
        bill.receipt?.status === 'submitted' ||
        toCents(bill.due) === 0;
      setThanks(false);
    } else if (paying.current) setThanks(true);
  }, [bill]);
  if (!table) return null;

  async function send() {
    if (!receipt || !table) return;
    setSending(true);
    setSendError(null);
    try {
      await sendReceipt(`/store/table/${table.id}/pix-receipt`, receipt);
      setReceipt(null);
      await reload();
    } catch (e) {
      setSendError(
        e instanceof ApiError || e instanceof Error ? e.message : 'Não foi possível enviar',
      );
    } finally {
      setSending(false);
    }
  }

  async function dropPix() {
    if (!table) return;
    setDropping(true);
    try {
      setBill(
        await api<TableBill>(`/store/table/${table.id}/pay/cancel`, { method: 'POST', json: {} }),
      );
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setDropping(false);
    }
  }

  const due = bill ? toCents(bill.due) : 0;
  const r = bill?.receipt ?? null;
  const online = bill?.online ?? null;
  const waitingReview = r?.status === 'submitted';
  const appBusy = !!online?.pix || !!online?.processing;
  const pixWay = !!bill && (bill.methods.pixAuto || (bill.methods.pix && !!bill.pix));
  const cardWay = !!bill?.methods.card;
  const chosen: 'pix' | 'card' | null =
    way === 'card' && cardWay ? 'card' : pixWay ? 'pix' : cardWay ? 'card' : null;
  const canPay = !!bill && !!chosen && due > 0 && !bill.awaiting && !waitingReview && !appBusy;
  const paidApp = online?.status === 'paid';
  const returned = online?.status === 'refund_due' || online?.status === 'refunded';

  return (
    <div className="sf-wrap sf-page tsv">
      <Link to="/pedir/mesa" className="tsv-back">
        <ChevronLeft size={18} aria-hidden /> Mesa {table.label}
      </Link>
      <h1 className="page-h1">Conta da mesa</h1>
      {!bill ? (
        error ? (
          <p className="form-error">{error}</p>
        ) : (
          <Skeleton />
        )
      ) : !bill.open ? (
        thanks ? (
          <div className="tsv-state" data-tone="ok" role="status">
            <BadgeCheck size={22} aria-hidden />
            <span>
              <strong>Conta paga</strong>
              <small>Pagamento confirmado e a mesa está livre. Obrigado e volte sempre!</small>
            </span>
          </div>
        ) : (
          <div className="empty-state">
            <WaiterArt live className="empty-state__art" />
            <strong>Nada pedido nesta mesa ainda</strong>
            <p>Quando você ou o garçom lançarem um pedido, a conta aparece aqui.</p>
            <Link className="cta cta--inline" to="/pedir">
              Ver o cardápio
            </Link>
          </div>
        )
      ) : (
        <>
          <section className="tsv-bill" aria-label="Itens da conta">
            <ul>
              {bill.items.map((it, i) => (
                <li key={i}>
                  <span>
                    {qtyLabel(it.quantity, it.unit)} {it.name}
                  </span>
                  <span>{brl(it.total)}</span>
                </li>
              ))}
            </ul>
            <dl>
              {toCents(bill.serviceFee) > 0 && (
                <div>
                  <dt>Taxa de serviço</dt>
                  <dd>{brl(bill.serviceFee)}</dd>
                </div>
              )}
              <div>
                <dt>Total</dt>
                <dd>{brl(bill.total)}</dd>
              </div>
              {toCents(bill.paid) > 0 && (
                <div>
                  <dt>Já pago</dt>
                  <dd>− {brl(bill.paid)}</dd>
                </div>
              )}
              <div className="tsv-bill__due">
                <dt>Falta pagar</dt>
                <dd>{brl(bill.due)}</dd>
              </div>
            </dl>
          </section>

          {due === 0 && (paidApp || r?.status === 'approved') ? (
            <div className="tsv-state" data-tone="ok" role="status">
              <BadgeCheck size={22} aria-hidden />
              <span>
                <strong>Pagamento confirmado</strong>
                <small>
                  {paidApp
                    ? `${brl(online!.amount ?? bill.paid)} ${online!.method === 'card' ? 'no cartão' : 'no Pix'} pelo app. Obrigado!`
                    : 'Obrigado! A conta da mesa está paga.'}
                </small>
              </span>
            </div>
          ) : due === 0 ? (
            <div className="tsv-state" data-tone="ok" role="status">
              <BadgeCheck size={22} aria-hidden />
              <span>
                <strong>Conta paga</strong>
                <small>Não falta nada para pagar nesta mesa.</small>
              </span>
            </div>
          ) : bill.awaiting > 0 ? (
            <div className="tsv-state" data-tone="wait" role="status">
              <Hourglass size={22} aria-hidden />
              <span>
                <strong>Pedido esperando a loja aceitar</strong>
                <small>Assim que a loja aceitar, você consegue pagar por aqui.</small>
              </span>
            </div>
          ) : waitingReview ? (
            <div className="tsv-state" data-tone="wait" role="status">
              <Hourglass size={22} aria-hidden />
              <span>
                <strong>Comprovante enviado</strong>
                <small>
                  O caixa está conferindo o Pix de {brl(r!.amount)}. Esta tela avisa quando
                  confirmar.
                </small>
              </span>
            </div>
          ) : online?.processing ? (
            <div className="tsv-state" data-tone="wait" role="status">
              <Clock3 size={22} aria-hidden />
              <span>
                <strong>Confirmando o pagamento</strong>
                <small>O banco ainda não respondeu. Esta tela avisa assim que confirmar.</small>
              </span>
            </div>
          ) : null}

          {returned && (
            <div className="tsv-state" role="status">
              <RotateCcw size={22} aria-hidden />
              <span>
                <strong>
                  {online!.status === 'refunded' ? 'Valor devolvido' : 'Devolução a caminho'}
                </strong>
                <small>
                  A conta já estava paga, então {brl(online!.amount ?? '0')}{' '}
                  {online!.method === 'card' ? 'voltam no seu cartão' : 'voltam pelo Pix'}.
                </small>
              </span>
            </div>
          )}

          {r?.status === 'rejected' && due > 0 && !appBusy && (
            <div className="tsv-state" data-tone="bad" role="alert">
              <XCircle size={22} aria-hidden />
              <span>
                <strong>O caixa não aprovou o comprovante</strong>
                <small>
                  {r.rejectReason ? `Motivo: ${r.rejectReason}. ` : ''}Confira e mande outro, ou
                  chame o garçom.
                </small>
              </span>
            </div>
          )}

          {online?.status === 'declined' && due > 0 && (
            <div className="tsv-state" data-tone="bad" role="alert">
              <XCircle size={22} aria-hidden />
              <span>
                <strong>{online.declineReason ?? 'Cartão recusado'}</strong>
                <small>
                  {online.cardAttemptsLeft > 0
                    ? 'Tente outro cartão ou pague com Pix.'
                    : 'Pague com Pix ou chame o garçom.'}
                </small>
              </span>
            </div>
          )}

          {online?.pix && due > 0 && (
            <TablePixWaiting
              online={{ ...online, pix: online.pix }}
              busy={dropping}
              onCancel={() => void dropPix()}
            />
          )}

          {canPay && (
            <section className="tsv-pay" aria-label="Pagar pelo celular">
              <h2>Pagar agora pelo celular</h2>
              {pixWay && cardWay && (
                <div className="pills" role="radiogroup" aria-label="Como pagar">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen === 'pix'}
                    className="pill"
                    onClick={() => setWay('pix')}
                  >
                    Pix
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen === 'card'}
                    className="pill"
                    onClick={() => setWay('card')}
                  >
                    Cartão de crédito
                  </button>
                </div>
              )}
              {chosen === 'pix' && bill.methods.pix && bill.pix ? (
                <PixPay code={pixBrCode(bill.pix, bill.due)} amount={bill.due} payee={bill.pix}>
                  <ReceiptPicker value={receipt} onChange={setReceipt} disabled={sending} />
                  <button
                    type="button"
                    className="cta"
                    disabled={!receipt || sending}
                    onClick={() => void send()}
                  >
                    {sending ? 'Enviando…' : 'Enviar comprovante'}
                  </button>
                  {sendError && (
                    <p className="form-error" role="alert">
                      {sendError}
                    </p>
                  )}
                  <p className="form-hint">
                    O comprovante vai para o caixa da loja, que confere se o Pix caiu e fecha a
                    conta.
                  </p>
                </PixPay>
              ) : (
                <TableAppPay<TableBill>
                  key={chosen!}
                  tableId={table.id}
                  due={bill.due}
                  way={chosen!}
                  pagbank={bill.pagbank}
                  cardAttemptsLeft={online?.cardAttemptsLeft ?? 0}
                  onBill={setBill}
                  onStale={reload}
                />
              )}
            </section>
          )}

          {sendError && !canPay && (
            <p className="form-error" role="alert">
              {sendError}
            </p>
          )}

          {due > 0 && (
            <section className="tsv-other">
              {!pixWay && !cardWay && (
                <p className="form-hint">
                  Esta loja ainda não recebe pelo celular. Chame o garçom para pagar.
                </p>
              )}
              {bill.call ? (
                <CallStatus
                  call={bill.call}
                  onCancel={() => void cancel()}
                  busy={busy === 'cancel'}
                />
              ) : (
                <button
                  type="button"
                  className="btn-line tsv-other__btn"
                  disabled={!!busy || dropping}
                  onClick={() =>
                    // Pix do app esperando: deixa de valer, senão o garçom não consegue cobrar.
                    void (online?.pix ? dropPix().then(() => call('bill')) : call('bill'))
                  }
                >
                  <CreditCard size={18} aria-hidden />
                  {busy === 'bill' ? 'Chamando…' : 'Pagar com o garçom (cartão ou dinheiro)'}
                </button>
              )}
              {callError && (
                <p className="form-error" role="alert">
                  {callError}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
