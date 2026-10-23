import {
  fromCents,
  PAYMENT_METHODS,
  splitCents,
  toCents,
  type PaymentMethod,
} from '@comandou/shared';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal, TextField, useToast, Select } from '../design-system';
import { api, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl, parseBrlInput } from '../lib/money';
import type { CashSession } from '../lib/types';
import { PAYMENT_METHOD_LABELS } from './format';

const SESSION_KEY = 'pm.cashSession';
const brInput = (v: string) => v.replace('.', ',');

/** Sessão de caixa escolhida neste dispositivo (só conveniência local; o servidor valida). */
export function useOpenSessions(open: boolean) {
  const [sessions, setSessions] = useState<CashSession[] | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    if (!open) return;
    api<CashSession[]>('/cash/sessions?status=open')
      .then((s) => {
        setSessions(s);
        setSessionId((cur) => (s.some((x) => x.id === cur) ? cur : (s[0]?.id ?? '')));
      })
      .catch(() => setSessions([]));
  }, [open]);
  const choose = (id: string) => {
    setSessionId(id);
    try {
      sessionStorage.setItem(SESSION_KEY, id);
    } catch {
      /* armazenamento indisponível */
    }
  };
  return { sessions, sessionId, choose };
}

/**
 * Recebe pagamento de um pedido OU de uma comanda (com divisão da conta).
 * Nada aparece como pago até o servidor confirmar; reenvios usam a mesma chave de idempotência.
 */
export function PaymentModal({
  open,
  onClose,
  onPaid,
  target,
}: {
  open: boolean;
  onClose(): void;
  onPaid(): void;
  target:
    | { kind: 'order'; id: string; number: number; balance: string }
    | { kind: 'tab'; id: string; number: number; balance: string };
}) {
  const toast = useToast();
  const { sessions, sessionId, choose } = useOpenSessions(open);
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [amount, setAmount] = useState(brInput(target.balance));
  const [tendered, setTendered] = useState('');
  const [parts, setParts] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!open) return;
    setAmount(brInput(target.balance));
    setTendered('');
    setParts(1);
    setError(null);
    setIdemKey(newIdempotencyKey());
  }, [open, target.balance]);

  const parsed = parseBrlInput(amount);
  const tenderedParsed = parseBrlInput(tendered);
  const change =
    method === 'cash' && parsed && tenderedParsed ? toCents(tenderedParsed) - toCents(parsed) : 0;
  const balanceCents = toCents(target.balance);

  function split(n: number) {
    setParts(n);
    const [first] = splitCents(balanceCents, n);
    setAmount(brInput(fromCents(first)));
  }

  async function pay() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const url =
        target.kind === 'order' ? `/orders/${target.id}/payments` : `/tabs/${target.id}/payments`;
      const res = await api<{ change: string }>(url, {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        json: {
          cashSessionId: sessionId,
          method,
          amount: parsed,
          tendered: method === 'cash' && tenderedParsed ? tenderedParsed : undefined,
        },
      });
      toast(
        toCents(res.change) > 0
          ? `Pagamento confirmado. Troco: ${brl(res.change)}`
          : 'Pagamento confirmado',
        'success',
      );
      onPaid();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0
          ? 'Sem conexão. O pagamento NÃO foi confirmado. Tente de novo: não haverá cobrança duplicada.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const label = target.kind === 'order' ? `pedido #${target.number}` : `comanda ${target.number}`;
  return (
    <Modal open={open} onClose={onClose} title={`Receber — ${label}`}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="pay-balance">
          <span>Saldo</span>
          <strong>{brl(target.balance)}</strong>
        </div>
        {sessions !== null && sessions.length === 0 ? (
          <Alert tone="warning">
            Nenhum caixa aberto. Abra um caixa na tela Caixa para receber pagamentos.
          </Alert>
        ) : (
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
        )}
        <div className="chips" role="radiogroup" aria-label="Forma de pagamento">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              className="chip"
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
            >
              {PAYMENT_METHOD_LABELS[m]}
            </button>
          ))}
        </div>
        {target.kind === 'tab' && (
          <div className="chips" aria-label="Dividir conta">
            <span className="cm-label" style={{ alignSelf: 'center' }}>
              Dividir em
            </span>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button key={n} className="chip" aria-pressed={parts === n} onClick={() => split(n)}>
                {n}
              </button>
            ))}
          </div>
        )}
        {parts > 1 && (
          <p className="cm-hint" style={{ margin: 0 }}>
            {parts} partes:{' '}
            {splitCents(balanceCents, parts)
              .map((c) => brl(fromCents(c)))
              .join(' + ')}
            . Receba uma parte por vez.
          </p>
        )}
        <TextField
          label="Valor"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={
            amount && !parsed
              ? 'Use o formato 12,90'
              : parsed && toCents(parsed) > balanceCents
                ? 'Maior que o saldo'
                : undefined
          }
        />
        {method === 'cash' && (
          <TextField
            label="Valor entregue (troco)"
            inputMode="decimal"
            placeholder="0,00"
            value={tendered}
            onChange={(e) => setTendered(e.target.value)}
            hint={change > 0 ? `Troco: ${brl(fromCents(change))}` : undefined}
            error={
              tendered && (!tenderedParsed || change < 0) ? 'Menor que o valor pago' : undefined
            }
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Button
          size="lg"
          block
          loading={busy}
          disabled={
            !parsed ||
            !sessionId ||
            toCents(parsed) <= 0 ||
            toCents(parsed) > balanceCents ||
            (method === 'cash' && !!tendered && change < 0)
          }
          onClick={pay}
        >
          Confirmar {parsed ? brl(parsed) : ''}
        </Button>
      </div>
    </Modal>
  );
}
