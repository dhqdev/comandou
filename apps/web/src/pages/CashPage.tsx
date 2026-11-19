import {
  channelInfo,
  CHANNEL_LABELS,
  fromCents,
  PAYMENT_METHODS,
  toCents,
  type OrderChannel,
  type PaymentMethod,
} from '@comandou/shared';
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Banknote,
  Lock,
  LockOpen,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Segmented,
  Select,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { useCan } from '../app/auth';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { dateTime, PAYMENT_METHOD_LABELS } from '../features/format';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl, parseBrlInput } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type {
  CashRegister,
  CashSession,
  CashTimeline,
  CashTimelineEvent,
  FiscalStatus,
} from '../lib/types';
import { StatusBadge } from './fiscal/common';
import { TourButton } from '../features/tour/PageTour';

const TERMINAL_KEY = 'cash.terminal';
const BASE_METHODS: PaymentMethod[] = ['cash', 'credit', 'debit', 'pix'];
const LIVE_FISCAL = ['draft', 'pending', 'processing', 'authorized', 'cancelling'];

function readTerminal() {
  try {
    return localStorage.getItem(TERMINAL_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveTerminal(id: string) {
  try {
    localStorage.setItem(TERMINAL_KEY, id);
  } catch {
    /* armazenamento indisponível */
  }
}

/** O evento e de onde ele veio, como o operador fala no balcão. */
function describe(e: CashTimelineEvent): { event: string; origin: string; ref: string } {
  const cx = `CX-${String(e.sessionNumber).padStart(6, '0')}`;
  switch (e.kind) {
    case 'opening':
      return { event: 'Suprimento', origin: 'Abertura', ref: cx };
    case 'supply':
      return { event: 'Suprimento', origin: 'Manual', ref: e.note ?? cx };
    case 'withdrawal':
      return { event: 'Sangria', origin: 'Manual', ref: e.note ?? cx };
    case 'refund':
      return {
        event: 'Estorno',
        origin: e.channel ? CHANNEL_LABELS[e.channel as OrderChannel] : 'Pedido',
        ref: e.orderNumber ? `#${e.orderNumber}` : cx,
      };
    default:
      return {
        event: 'Venda',
        origin: e.channel ? CHANNEL_LABELS[e.channel as OrderChannel] : 'Pedido',
        ref: e.orderNumber ? `#${e.orderNumber}` : cx,
      };
  }
}

/**
 * Caixa do PDV: totais desde a abertura, ações do terminal (suprimento, sangria, abrir e fechar)
 * e a linha do tempo com um registro por evento, separado por forma de pagamento.
 */
export function CashPage() {
  const toast = useToast();
  const canOperate = useCan('cash:operate');
  const canClose = useCan('cash:close');
  const canEmit = useCan('fiscal:emit');
  const canWriteOrders = useCan('orders:write');
  const canManagePrint = useCan('printing:manage');
  const canPrint = canWriteOrders || canManagePrint;
  const [registers, setRegisters] = useState<CashRegister[] | null>(null);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [terminalId, setTerminalId] = useState(readTerminal);
  const [scope, setScope] = useState<'terminal' | 'all'>('terminal');
  /** Sessão antiga aberta pelo histórico ou por link (só leitura, se já fechada). */
  const [viewing, setViewing] = useState<string | null>(null);
  useLinkParam('sessao', setViewing);
  const [timeline, setTimeline] = useState<CashTimeline | null>(null);
  const [session, setSession] = useState<CashSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<CashRegister | null>(null);
  const [mov, setMov] = useState<null | 'supply' | 'withdrawal'>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  const terminal =
    registers?.find((r) => r.id === terminalId) ??
    registers?.find((r) => r.openSessionId) ??
    registers?.[0] ??
    null;
  /** Sessão em que Suprimento, Sangria e Fechar caixa agem. */
  const actionSessionId = viewing ?? terminal?.openSessionId ?? null;
  const timelineUrl = viewing
    ? `/cash/sessions/${viewing}/timeline`
    : scope === 'all'
      ? '/cash/sessions/open/timeline'
      : terminal?.openSessionId
        ? `/cash/sessions/${terminal.openSessionId}/timeline`
        : null;

  const loadRegisters = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([
        api<CashRegister[]>('/cash-registers'),
        api<CashSession[]>('/cash/sessions'),
      ]);
      setRegisters(r.filter((x) => x.active));
      setHistory(h);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const loadTimeline = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        timelineUrl ? api<CashTimeline>(timelineUrl) : Promise.resolve(null),
        actionSessionId
          ? api<CashSession>(`/cash/sessions/${actionSessionId}`)
          : Promise.resolve(null),
      ]);
      setTimeline(t);
      setSession(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [timelineUrl, actionSessionId]);
  const loadAll = useCallback(async () => {
    await Promise.all([loadRegisters(), loadTimeline()]);
  }, [loadRegisters, loadTimeline]);
  useEffect(() => {
    void loadRegisters();
  }, [loadRegisters]);
  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);
  const reload = useDebounced(loadAll);
  useRealtime((e) => {
    if (e.type === 'cash.changed' || e.type === 'fiscal.changed') reload();
  }, loadAll);

  function chooseTerminal(id: string) {
    setTerminalId(id);
    saveTerminal(id);
    setViewing(null);
    setScope('terminal');
  }

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
      void loadTimeline();
    }
  }
  const emitNfce = (id: string) =>
    run(
      `nfce-${id}`,
      () => api(`/orders/${id}/nfce`, { method: 'POST', json: {} }),
      'NFC-e enviada para emissão',
    );
  const reprint = (id: string) =>
    run(
      `print-${id}`,
      () => api(`/orders/${id}/print`, { method: 'POST', json: { kind: 'receipt' } }),
      'Comprovante enviado para a impressora',
    );

  if (registers === null)
    return (
      <>
        <h1 className="page-title">Caixa</h1>
        {error ? <Alert tone="danger">{error}</Alert> : <Spinner />}
      </>
    );
  if (registers.length === 0)
    return (
      <>
        <div className="page-title-row">
          <h1 className="page-title">Caixa</h1>
          <TourButton tour="caixa" />
        </div>
        <Card>
          <EmptyState
            icon={<Wallet size={20} />}
            title="Nenhum terminal de caixa"
            description="Cadastre um terminal em Conta › Ajustes › Terminais de caixa (ex.: Caixa 1) e volte aqui para abrir o caixa."
          />
        </Card>
      </>
    );

  const shown = timeline?.sessions ?? [];
  const isOpen = session?.status === 'open';
  const methods = PAYMENT_METHODS.filter(
    (m) =>
      BASE_METHODS.includes(m) || (timeline?.events ?? []).some((e) => toCents(e.amounts[m]) !== 0),
  );
  const multi = shown.length > 1 || (scope === 'all' && !viewing);
  const t = timeline?.totals;

  let headline: string;
  if (viewing && session) {
    headline =
      session.status === 'open'
        ? `${session.registerName} · aberto em ${dateTime(session.openedAt)} por ${session.openedByName ?? '—'}`
        : `${session.registerName} · sessão ${session.number}, fechada em ${session.closedAt ? dateTime(session.closedAt) : '—'}`;
  } else if (scope === 'all') {
    headline =
      shown.length === 0
        ? 'Nenhum caixa aberto'
        : shown.length === 1
          ? `1 caixa aberto · ${shown[0]!.registerName}`
          : `${shown.length} caixas abertos`;
  } else if (terminal?.openSessionId && session) {
    headline = `Aberto em ${dateTime(session.openedAt)} por ${session.openedByName ?? '—'}`;
  } else {
    headline = `${terminal?.name ?? 'Caixa'} fechado`;
  }

  return (
    <>
      <h1 className="page-title cm-sr-only">Caixa</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="cash-head" data-search-id={terminal ? `caixa-${terminal.id}` : undefined}>
        <div className="cash-head__info">
          <strong className="cash-head__title">{headline}</strong>
          {registers.length > 1 && (
            <Select
              className="cm-input cash-head__terminal"
              aria-label="Terminal"
              value={terminal?.id ?? ''}
              onChange={(e) => chooseTerminal(e.target.value)}
            >
              {registers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.openSessionId ? ' · aberto' : ''}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="cash-head__actions">
          <TourButton tour="caixa" />
          {viewing ? (
            <Button variant="secondary" onClick={() => setViewing(null)}>
              Voltar ao caixa atual
            </Button>
          ) : (
            <Segmented
              label="Quais caixas mostrar"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'terminal', label: 'Este terminal' },
                { value: 'all', label: 'Todos os caixas' },
              ]}
            />
          )}
          {isOpen && canOperate && (
            <>
              <Button
                variant="secondary"
                icon={<ArrowDownCircle size={16} />}
                onClick={() => setMov('supply')}
              >
                Suprimento
              </Button>
              <Button
                variant="secondary"
                icon={<ArrowUpCircle size={16} />}
                onClick={() => setMov('withdrawal')}
              >
                Sangria
              </Button>
            </>
          )}
          {isOpen && canClose && (
            <Button icon={<Lock size={16} />} onClick={() => setClosing(true)}>
              Fechar caixa
            </Button>
          )}
          {!viewing && terminal && !terminal.openSessionId && canOperate && (
            <Button icon={<LockOpen size={16} />} onClick={() => setOpening(terminal)}>
              Abrir caixa
            </Button>
          )}
        </div>
      </div>

      {session?.status === 'closed' && (
        <Alert tone={closedClean(session) ? 'info' : 'warning'}>
          <span>
            Fechado em {session.closedAt && dateTime(session.closedAt)} por {session.closedByName}.
            Diferença: <DiffValue value={session.difference ?? '0'} />
            {methodDiffs(session).length > 0 && (
              <>
                {' ('}
                {methodDiffs(session).map(([m, v], i) => (
                  <span key={m}>
                    {i > 0 && ', '}
                    {PAYMENT_METHOD_LABELS[m]} <DiffValue value={v} />
                  </span>
                ))}
                {')'}
              </>
            )}
            {session.closingNote && ` — ${session.closingNote}`}
          </span>
        </Alert>
      )}

      {t && (
        <section className="cm-card cash-summary" aria-label="Resumo do caixa">
          <div className="cash-summary__main">
            <div className="cash-kpi">
              <span className="cash-kpi__label">
                <ShoppingBag size={15} aria-hidden /> Vendido no turno
              </span>
              <strong className="cash-kpi__value">{brl(t.sold)}</strong>
              <span className="cash-kpi__sub">
                {t.closedOrders} {t.closedOrders === 1 ? 'conta fechada' : 'contas fechadas'}
              </span>
            </div>
            {session && !multi && (
              <div className="cash-kpi">
                <span className="cash-kpi__label">
                  <Banknote size={15} aria-hidden />{' '}
                  {isOpen ? 'Dinheiro esperado' : 'Dinheiro esperado no fechamento'}
                </span>
                <strong className="cash-kpi__value">
                  {brl(
                    session.status === 'closed' && session.closedExpected
                      ? session.closedExpected.cash
                      : session.expected.cash,
                  )}
                </strong>
                <span className="cash-kpi__sub">na gaveta, com o fundo de troco</span>
              </div>
            )}
            <div className="cash-kpi">
              <span className="cash-kpi__label">
                <ArrowLeftRight size={15} aria-hidden /> Movimentado no caixa
              </span>
              <strong className="cash-kpi__value">{brl(t.moved)}</strong>
              <span className="cash-kpi__sub">todas as formas de pagamento</span>
            </div>
          </div>
          <dl className="cash-summary__extra">
            <div>
              <dt>Frete</dt>
              <dd>{brl(t.deliveryFees)}</dd>
            </div>
            <div>
              <dt>Taxas e serviço</dt>
              <dd>{brl(t.surcharges)}</dd>
            </div>
            <div>
              <dt>Suprimentos</dt>
              <dd>{brl(t.supplies)}</dd>
            </div>
            <div>
              <dt>Sangrias</dt>
              <dd>{brl(t.withdrawals)}</dd>
            </div>
            {!multi &&
              session?.appSales?.map((a) => (
                <div
                  key={a.channel}
                  title="Pago dentro do aplicativo: não entra na gaveta e chega no repasse"
                >
                  <dt>Pago no {channelInfo(a.channel).label}</dt>
                  <dd>
                    {brl(a.total)}{' '}
                    <span className="cash-summary__note">
                      {a.orders} {a.orders === 1 ? 'pedido' : 'pedidos'}, fora da gaveta
                    </span>
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      )}

      <section
        className="cm-card cash-timeline"
        data-search-id={actionSessionId ? `sessao-${actionSessionId}` : undefined}
      >
        <header className="cash-timeline__head">
          <h2 className="cash-timeline__title">Linha do tempo do caixa</h2>
          <p className="cm-hint">Primeiro registro: valor de abertura em dinheiro</p>
        </header>
        {!timeline ? (
          <EmptyState
            icon={<Wallet size={20} />}
            title={`${terminal?.name ?? 'Caixa'} fechado`}
            description={
              canOperate
                ? 'Abra o caixa com o fundo de troco para começar a registrar o turno.'
                : 'Peça para quem opera o caixa abrir o turno.'
            }
          />
        ) : timeline.events.length === 0 ? (
          <EmptyState title="Nenhum caixa aberto" />
        ) : (
          <div className="cash-timeline__scroll">
            <table className="cm-table cash-table">
              <thead>
                <tr>
                  <th>Data e hora</th>
                  <th>Evento</th>
                  <th>Origem</th>
                  <th>Referência</th>
                  {multi && <th>Terminal</th>}
                  <th className="cm-num">Frete</th>
                  <th className="cm-num">Desconto</th>
                  {methods.map((m) => (
                    <th key={m} className="cm-num">
                      {COLUMN_LABEL[m]}
                    </th>
                  ))}
                  <th>NFC-e</th>
                  <th>Fechamento</th>
                </tr>
              </thead>
              <tbody>
                {timeline.events.map((e) => {
                  const d = describe(e);
                  const sale = e.kind === 'sale' && e.orderId;
                  const fiscalLive = e.fiscal && LIVE_FISCAL.includes(e.fiscal.status);
                  return (
                    <tr key={e.id} data-kind={e.kind}>
                      <td className="cash-table__when">{dateTime(e.at)}</td>
                      <td>{d.event}</td>
                      <td>{d.origin}</td>
                      <td>
                        {e.orderId ? (
                          <button
                            type="button"
                            className="cash-table__ref"
                            onClick={() => setOrderId(e.orderId)}
                          >
                            {d.ref}
                          </button>
                        ) : (
                          <span title={e.createdByName ?? undefined}>{d.ref}</span>
                        )}
                      </td>
                      {multi && <td>{e.registerName}</td>}
                      <td className="cm-num" data-zero={toCents(e.deliveryFee) === 0 || undefined}>
                        {brl(e.deliveryFee)}
                      </td>
                      <td className="cm-num" data-zero={toCents(e.discount) === 0 || undefined}>
                        {brl(e.discount)}
                      </td>
                      {methods.map((m) => (
                        <td
                          key={m}
                          className="cm-num"
                          data-zero={toCents(e.amounts[m]) === 0 || undefined}
                          style={{
                            color: toCents(e.amounts[m]) < 0 ? 'var(--cm-danger)' : undefined,
                          }}
                        >
                          {brl(e.amounts[m])}
                        </td>
                      ))}
                      <td>
                        {sale && e.fiscal && fiscalLive ? (
                          <Link to={`/fiscal/nota/${e.fiscal.id}`} aria-label="Ver nota fiscal">
                            <StatusBadge status={e.fiscal.status as FiscalStatus} />
                          </Link>
                        ) : sale && canEmit && e.orderPaid ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy === `nfce-${e.orderId}`}
                            onClick={() => emitNfce(e.orderId!)}
                          >
                            Emitir NFC-e
                          </Button>
                        ) : null}
                      </td>
                      <td>
                        {sale && canPrint && (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy === `print-${e.orderId}`}
                            onClick={() => reprint(e.orderId!)}
                          >
                            Reimprimir
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Card title="Sessões recentes" bodyless>
        {history.length === 0 ? (
          <EmptyState title="Nenhuma sessão" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table cm-table--click">
              <thead>
                <tr>
                  <th>Sessão</th>
                  <th>Terminal</th>
                  <th>Abertura</th>
                  <th>Fechamento</th>
                  <th>Status</th>
                  <th className="cm-num">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr
                    key={s.id}
                    data-search-id={`sessao-${s.id}`}
                    aria-selected={viewing === s.id || undefined}
                    onClick={() => setViewing(s.id)}
                  >
                    <td>{s.number}</td>
                    <td>{s.registerName}</td>
                    <td>
                      {dateTime(s.openedAt)}{' '}
                      {s.openedByName && <span className="cm-hint">· {s.openedByName}</span>}
                    </td>
                    <td>{s.closedAt ? dateTime(s.closedAt) : '—'}</td>
                    <td>
                      <Badge tone={s.status === 'open' ? 'success' : 'neutral'}>
                        {s.status === 'open' ? 'Aberta' : 'Fechada'}
                      </Badge>
                    </td>
                    <td className="cm-num">
                      {s.difference !== null ? <DiffValue value={s.difference} /> : '—'}
                      {s.difference !== null &&
                        toCents(s.difference) === 0 &&
                        methodDiffs(s).length > 0 && (
                          <span className="cm-hint"> · formas não batem</span>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <OpenModal
        register={opening}
        onClose={() => setOpening(null)}
        onOpened={() => {
          setOpening(null);
          setViewing(null);
          setScope('terminal');
          void loadAll();
        }}
      />
      {session && (
        <>
          <MovementModal
            kind={mov}
            sessionId={session.id}
            cashExpected={session.expected.cash}
            onClose={() => setMov(null)}
            onDone={() => {
              setMov(null);
              void loadTimeline();
            }}
          />
          <CloseModal
            open={closing}
            session={session}
            onClose={() => setClosing(false)}
            onDone={() => {
              setClosing(false);
              // Fica na sessão que acabou de fechar, para conferir a diferença.
              setViewing(session.id);
              void loadRegisters();
            }}
          />
        </>
      )}
      <OrderDetailModal orderId={orderId} onClose={() => setOrderId(null)} />
    </>
  );
}

const COLUMN_LABEL: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit: 'Cartão de crédito',
  debit: 'Cartão de débito',
  pix: 'PIX',
  voucher: 'Vale-refeição',
  other: 'Outros',
};

/** Formas que não bateram no fechamento, na ordem das formas de pagamento. */
function methodDiffs(s: Pick<CashSession, 'differences'>): [PaymentMethod, string][] {
  const d = s.differences ?? {};
  return PAYMENT_METHODS.filter((m) => d[m] !== undefined).map((m) => [m, d[m]!]);
}

/** Fechamento sem diferença no total nem em forma nenhuma. */
function closedClean(s: CashSession) {
  return toCents(s.difference ?? '0') === 0 && methodDiffs(s).length === 0;
}

function DiffValue({ value }: { value: string }) {
  const c = toCents(value);
  return (
    <span
      style={{
        color: c < 0 ? 'var(--cm-danger)' : c > 0 ? 'var(--cm-warning)' : 'var(--cm-success)',
        fontWeight: 700,
      }}
    >
      {brl(value)}
    </span>
  );
}

function OpenModal({
  register,
  onClose,
  onOpened,
}: {
  register: CashRegister | null;
  onClose(): void;
  onOpened(s: CashSession): void;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const parsed = parseBrlInput(amount || '0');
  async function save() {
    if (!register || !parsed) return;
    setBusy(true);
    try {
      const s = await api<CashSession>('/cash/sessions', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        json: { registerId: register.id, openingAmount: parsed },
      });
      setAmount('');
      setKey(newIdempotencyKey());
      onOpened(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={!!register}
      onClose={onClose}
      title={`Abrir ${register?.name ?? 'caixa'}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!parsed} onClick={save}>
            Abrir caixa
          </Button>
        </>
      }
    >
      <TextField
        label="Fundo de troco (dinheiro na gaveta)"
        inputMode="decimal"
        placeholder="0,00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={!parsed ? 'Use o formato 100,00' : undefined}
      />
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
}

function MovementModal({
  kind,
  sessionId,
  cashExpected,
  onClose,
  onDone,
}: {
  kind: null | 'supply' | 'withdrawal';
  sessionId: string;
  cashExpected: string;
  onClose(): void;
  onDone(): void;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    setAmount('');
    setNote('');
    setError(null);
    setKey(newIdempotencyKey());
  }, [kind]);
  const parsed = parseBrlInput(amount);
  async function save() {
    setBusy(true);
    try {
      await api(`/cash/sessions/${sessionId}/movements`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        json: { kind, amount: parsed, note },
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
      open={!!kind}
      onClose={onClose}
      title={
        kind === 'supply' ? 'Suprimento (entrada de dinheiro)' : 'Sangria (retirada de dinheiro)'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={busy}
            disabled={!parsed || toCents(parsed) <= 0 || note.trim().length < 3}
            onClick={save}
          >
            Registrar
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {kind === 'withdrawal' && (
          <p className="cm-hint" style={{ margin: 0 }}>
            Dinheiro em caixa: {brl(cashExpected)}
          </p>
        )}
        <TextField
          label="Valor"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={amount && !parsed ? 'Use o formato 50,00' : undefined}
        />
        <TextField
          label="Motivo"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function CloseModal({
  open,
  session,
  onClose,
  onDone,
}: {
  open: boolean;
  session: CashSession;
  onClose(): void;
  onDone(): void;
}) {
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (!open) return;
    setCounted({});
    setNote('');
    setError(null);
    setKey(newIdempotencyKey());
  }, [open]);
  const methods = PAYMENT_METHODS.filter((m) => m === 'cash' || toCents(session.expected[m]) !== 0);
  const parsed = Object.fromEntries(
    methods.map((m) => [m, parseBrlInput(counted[m] ?? '')]),
  ) as Record<PaymentMethod, string | null>;
  const ready = methods.every((m) => parsed[m] !== null);
  const diff = ready
    ? methods.reduce((s, m) => s + toCents(parsed[m]!) - toCents(session.expected[m]), 0)
    : 0;
  // A conferência é forma por forma: sobra numa forma não cobre falta em outra.
  const mismatch =
    ready && methods.some((m) => toCents(parsed[m]!) !== toCents(session.expected[m]));
  async function save() {
    setBusy(true);
    try {
      await api(`/cash/sessions/${session.id}/close`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        json: {
          counted: Object.fromEntries(methods.map((m) => [m, parsed[m]])),
          note: note || undefined,
        },
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
      open={open}
      onClose={onClose}
      title="Fechamento conferido"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!ready || (mismatch && !note.trim())} onClick={save}>
            Fechar caixa
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <p className="cm-hint" style={{ margin: 0 }}>
          Conte o dinheiro da gaveta e confira os comprovantes de cada forma de pagamento.
        </p>
        <table className="cm-table">
          <thead>
            <tr>
              <th>Forma</th>
              <th className="cm-num">Esperado</th>
              <th>Contado</th>
              <th className="cm-num">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m}>
                <td>{PAYMENT_METHOD_LABELS[m]}</td>
                <td className="cm-num">{brl(session.expected[m])}</td>
                <td>
                  <input
                    className="cm-input"
                    inputMode="decimal"
                    aria-label={`Contado ${PAYMENT_METHOD_LABELS[m]}`}
                    placeholder="0,00"
                    value={counted[m] ?? ''}
                    onChange={(e) => setCounted((c) => ({ ...c, [m]: e.target.value }))}
                  />
                </td>
                <td className="cm-num">
                  {parsed[m] !== null ? (
                    <DiffValue
                      value={fromCents(toCents(parsed[m]!) - toCents(session.expected[m]))}
                    />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {ready && (
          <Alert tone={mismatch ? 'warning' : 'info'}>
            <span>
              Diferença total: <DiffValue value={fromCents(diff)} />
              {mismatch && diff === 0 && (
                <>
                  {' '}
                  O total bate, mas as formas não. Confira se algum pagamento foi lançado na forma
                  errada e explique na observação.
                </>
              )}
            </span>
          </Alert>
        )}
        <TextField
          label={mismatch ? 'Observação (obrigatória com diferença)' : 'Observação'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
