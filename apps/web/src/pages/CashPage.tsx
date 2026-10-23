import { fromCents, PAYMENT_METHODS, toCents, type PaymentMethod } from '@comandou/shared';
import { ArrowDownCircle, ArrowUpCircle, Lock, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { useCan } from '../app/auth';
import { dateTime, PAYMENT_METHOD_LABELS } from '../features/format';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl, parseBrlInput } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { CashRegister, CashSession } from '../lib/types';

const KIND_LABEL: Record<string, string> = {
  opening: 'Abertura',
  sale: 'Venda',
  supply: 'Suprimento',
  withdrawal: 'Sangria',
  refund: 'Estorno',
};

export function CashPage() {
  const canOperate = useCan('cash:operate');
  const [registers, setRegisters] = useState<CashRegister[] | null>(null);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [opening, setOpening] = useState<CashRegister | null>(null);
  useLinkParam('sessao', setSelected);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([
        api<CashRegister[]>('/cash-registers'),
        api<CashSession[]>('/cash/sessions'),
      ]);
      setRegisters(r.filter((x) => x.active));
      setHistory(h);
      setSelected((s) => s ?? r.find((x) => x.openSessionId)?.openSessionId ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'cash.changed') reload();
  }, load);

  return (
    <>
      <div>
        <h1 className="page-title">Caixa</h1>
        <p className="page-sub">
          Abertura, suprimento, sangria e fechamento conferido por terminal.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {registers === null ? (
        <Spinner />
      ) : registers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet size={20} />}
            title="Nenhum terminal de caixa"
            description="Cadastre um terminal em Ajustes."
          />
        </Card>
      ) : (
        <div className="register-grid">
          {registers.map((r) => (
            <div
              key={r.id}
              data-search-id={`caixa-${r.id}`}
              className="register-tile"
              data-open={!!r.openSessionId || undefined}
            >
              <strong>{r.name}</strong>
              {r.openSessionId ? (
                <>
                  <Badge tone="success">Aberto</Badge>
                  <Button variant="secondary" onClick={() => setSelected(r.openSessionId)}>
                    Ver movimento
                  </Button>
                </>
              ) : (
                <>
                  <Badge>Fechado</Badge>
                  {canOperate && <Button onClick={() => setOpening(r)}>Abrir caixa</Button>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {selected && <SessionPanel sessionId={selected} onChanged={load} />}
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
                  <tr key={s.id} onClick={() => setSelected(s.id)}>
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
        onOpened={(s) => {
          setOpening(null);
          setSelected(s.id);
          void load();
        }}
      />
    </>
  );
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
    <Modal open={!!register} onClose={onClose} title={`Abrir ${register?.name ?? 'caixa'}`}>
      <div style={{ display: 'grid', gap: 16 }}>
        <TextField
          label="Fundo de troco (dinheiro na gaveta)"
          inputMode="decimal"
          placeholder="0,00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={!parsed ? 'Use o formato 100,00' : undefined}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button loading={busy} disabled={!parsed} onClick={save}>
          Abrir caixa
        </Button>
      </div>
    </Modal>
  );
}

function SessionPanel({ sessionId, onChanged }: { sessionId: string; onChanged(): void }) {
  const toast = useToast();
  const canOperate = useCan('cash:operate');
  const canClose = useCan('cash:close');
  const [s, setS] = useState<CashSession | null>(null);
  const [mov, setMov] = useState<null | 'supply' | 'withdrawal'>(null);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await api<CashSession>(`/cash/sessions/${sessionId}`));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }, [sessionId, toast]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'cash.changed' && e.sessionId === sessionId) void load();
  }, load);

  if (!s) return <Spinner />;
  const methods = PAYMENT_METHODS.filter((m) => m === 'cash' || toCents(s.expected[m]) !== 0);
  return (
    <Card
      searchId={`sessao-${s.id}`}
      title={`${s.registerName} · sessão ${s.number}`}
      actions={
        s.status === 'open' && (
          <>
            {canOperate && (
              <Button
                variant="secondary"
                icon={<ArrowDownCircle size={16} />}
                onClick={() => setMov('supply')}
              >
                Suprimento
              </Button>
            )}
            {canOperate && (
              <Button
                variant="secondary"
                icon={<ArrowUpCircle size={16} />}
                onClick={() => setMov('withdrawal')}
              >
                Sangria
              </Button>
            )}
            {canClose && (
              <Button icon={<Lock size={16} />} onClick={() => setClosing(true)}>
                Fechar caixa
              </Button>
            )}
          </>
        )
      }
    >
      <div className="stat-grid">
        {methods.map((m) => (
          <div key={m} className="cm-card stat">
            <div className="stat__label">
              {PAYMENT_METHOD_LABELS[m]}{' '}
              {s.status === 'open' ? 'esperado' : 'esperado no fechamento'}
            </div>
            <div className="stat__value">
              {brl(s.status === 'closed' && s.closedExpected ? s.closedExpected[m] : s.expected[m])}
            </div>
            {s.status === 'closed' && s.counted && (
              <div className="cm-hint">Contado: {brl(s.counted[m])}</div>
            )}
          </div>
        ))}
      </div>
      {s.status === 'closed' && (
        <Alert tone={toCents(s.difference ?? '0') === 0 ? 'info' : 'warning'}>
          Fechado em {s.closedAt && dateTime(s.closedAt)} por {s.closedByName}. Diferença:{' '}
          <DiffValue value={s.difference ?? '0'} />
          {s.closingNote && ` — ${s.closingNote}`}
        </Alert>
      )}
      <h3 className="section-title">Movimentos</h3>
      {(s.movements ?? []).length === 0 ? (
        <EmptyState title="Sem movimentos" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="cm-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Tipo</th>
                <th>Forma</th>
                <th>Detalhe</th>
                <th className="cm-num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {s.movements!.map((m) => (
                <tr key={m.id}>
                  <td>{dateTime(m.createdAt)}</td>
                  <td>{KIND_LABEL[m.kind]}</td>
                  <td>{PAYMENT_METHOD_LABELS[m.method]}</td>
                  <td>
                    {m.orderNumber ? `Pedido #${m.orderNumber}` : ''} {m.note}{' '}
                    <span className="cm-hint">{m.createdByName}</span>
                  </td>
                  <td
                    className="cm-num"
                    style={{ color: toCents(m.amount) < 0 ? 'var(--cm-danger)' : undefined }}
                  >
                    {brl(m.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MovementModal
        kind={mov}
        sessionId={s.id}
        cashExpected={s.expected.cash}
        onClose={() => setMov(null)}
        onDone={() => {
          setMov(null);
          void load();
        }}
      />
      <CloseModal
        open={closing}
        session={s}
        onClose={() => setClosing(false)}
        onDone={() => {
          setClosing(false);
          void load();
          onChanged();
        }}
      />
    </Card>
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
        <Button
          loading={busy}
          disabled={!parsed || toCents(parsed) <= 0 || note.trim().length < 3}
          onClick={save}
        >
          Registrar
        </Button>
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
    <Modal open={open} onClose={onClose} title="Fechamento conferido" size="lg">
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
          <Alert tone={diff === 0 ? 'info' : 'warning'}>
            Diferença total: <DiffValue value={fromCents(diff)} />
          </Alert>
        )}
        <TextField
          label={diff !== 0 ? 'Observação (obrigatória com diferença)' : 'Observação'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button
          size="lg"
          loading={busy}
          disabled={!ready || (diff !== 0 && !note.trim())}
          onClick={save}
        >
          Fechar caixa
        </Button>
      </div>
    </Modal>
  );
}
