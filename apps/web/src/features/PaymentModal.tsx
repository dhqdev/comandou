import {
  formatDocument,
  fromCents,
  isValidCnpj,
  isValidCpf,
  PAYMENT_METHODS,
  splitCents,
  toCents,
  type PaymentMethod,
} from '@comandou/shared';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, HelpScope, Modal, TextField, useToast, Select } from '../design-system';
import { api, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl, parseBrlInput } from '../lib/money';
import type { CashSession } from '../lib/types';
import { PAYMENT_METHOD_LABELS } from './format';
import { PAYMENT_FISCAL_HELP } from './help/fiscal-help';

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

/** Uma parte da conta dividida: quanto é e, depois de recebida, como foi paga. */
interface Part {
  cents: number;
  paid?: PaymentMethod;
}
const MAX_PARTS = 20;
const SPLIT_CHIPS = [1, 2, 3, 4, 5, 6];

/**
 * Divide o que falta entre as partes ainda não pagas (as pagas ficam como estão).
 * Se todas já foram pagas e ainda sobra saldo, cria mais uma parte com o resto.
 */
export function replan(plan: Part[], remainingCents: number, total = plan.length): Part[] {
  const paid = plan.filter((p) => p.paid);
  const open = Math.max(total - paid.length, remainingCents > 0 ? 1 : 0);
  if (open === 0) return paid;
  const cents = splitCents(Math.max(remainingCents, 0), open);
  // Mantém a ordem: pagas onde estavam, as abertas recebem os novos valores.
  const out: Part[] = [];
  let k = 0;
  for (const p of plan.slice(0, total)) out.push(p.paid ? p : { cents: cents[k++]! });
  while (k < open) out.push({ cents: cents[k++]! });
  return out;
}

/** "Dividir em": 1 a 6 direto e "+" para mesas maiores (até 20). Usado no caixa e no garçom. */
export function SplitPicker({
  value,
  min = 1,
  onChange,
}: {
  value: number;
  min?: number;
  onChange(n: number): void;
}) {
  const more = value > SPLIT_CHIPS.length ? value : null;
  return (
    <div className="chips split-picker" role="group" aria-label="Dividir conta">
      <span className="cm-label">Dividir em</span>
      {SPLIT_CHIPS.map((n) => (
        <button
          key={n}
          type="button"
          className="chip"
          aria-pressed={value === n}
          disabled={n < min}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        className="chip"
        aria-pressed={!!more}
        aria-label={more ? `${more} pessoas (mais uma)` : 'Mais pessoas'}
        disabled={value >= MAX_PARTS}
        onClick={() => onChange(Math.max(value, SPLIT_CHIPS.length) + 1)}
      >
        {more ?? '+'}
      </button>
    </div>
  );
}

/**
 * Recebe pagamento de um pedido OU de uma comanda (com divisão da conta).
 * Dividir em N gera uma parte por pessoa: cada uma é recebida na sua vez, com a sua forma de
 * pagamento, e a janela já passa para a próxima sem precisar escolher tudo de novo.
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
    | {
        kind: 'tab';
        id: string;
        number: number;
        balance: string;
        /** Divisão pedida pela mesa (o garçom marca ao pedir a conta). */
        splitParts?: number | null;
      };
}) {
  const toast = useToast();
  const { sessions, sessionId, choose } = useOpenSessions(open);
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [amount, setAmount] = useState(brInput(target.balance));
  const [tendered, setTendered] = useState('');
  /** Saldo quando a janela abriu: a divisão é feita sobre ele, mesmo com o salão atualizando. */
  const [startCents, setStartCents] = useState(() => toCents(target.balance));
  const [plan, setPlan] = useState<Part[]>([{ cents: toCents(target.balance) }]);
  const [current, setCurrent] = useState(0);
  const [taxDoc, setTaxDoc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const paidCount = plan.filter((p) => p.paid).length;
  // Durante o envio e depois da 1ª parte, o saldo do salão muda sozinho (tempo real): a divisão
  // não pode ser refeita com ele, senão o que acabou de ser pago seria descontado duas vezes.
  const payingRef = useRef(false);
  const startedRef = useRef(false);
  startedRef.current = paidCount > 0;
  const askedParts = target.kind === 'tab' ? (target.splitParts ?? 1) : 1;

  useEffect(() => {
    if (!open) {
      setPlan([]);
      return;
    }
    // Já recebeu parte da divisão: o saldo do salão muda, mas a divisão continua a mesma.
    if (startedRef.current || payingRef.current) return;
    const cents = toCents(target.balance);
    const n = Math.min(Math.max(askedParts, 1), MAX_PARTS);
    const first = replan([], cents, n);
    setStartCents(cents);
    setPlan(first);
    setCurrent(0);
    setAmount(brInput(fromCents(first[0]?.cents ?? cents)));
    setTendered('');
    setTaxDoc('');
    setError(null);
    setIdemKey(newIdempotencyKey());
  }, [open, target.balance, askedParts]);

  const parts = plan.length;
  const paidCents = plan.reduce((s, p) => s + (p.paid ? p.cents : 0), 0);
  const remainingCents = startCents - paidCents;
  const parsed = parseBrlInput(amount);
  const tenderedParsed = parseBrlInput(tendered);
  const change =
    method === 'cash' && parsed && tenderedParsed ? toCents(tenderedParsed) - toCents(parsed) : 0;
  const taxDigits = taxDoc.replace(/\D/g, '');
  const taxError = !taxDigits
    ? undefined
    : taxDigits.length === 11
      ? isValidCpf(taxDigits)
        ? undefined
        : 'CPF inválido'
      : taxDigits.length === 14
        ? isValidCnpj(taxDigits)
          ? undefined
          : 'CNPJ inválido'
        : 'CPF tem 11 dígitos e CNPJ tem 14';

  function goTo(next: Part[], i: number) {
    setPlan(next);
    setCurrent(i);
    setAmount(brInput(fromCents(next[i]?.cents ?? 0)));
    setTendered('');
    setTaxDoc('');
    setError(null);
    setIdemKey(newIdempotencyKey());
  }

  function split(n: number) {
    const total = Math.min(Math.max(n, paidCount + 1, 1), MAX_PARTS);
    const next = replan(plan, remainingCents, total);
    goTo(
      next,
      next.findIndex((p) => !p.paid),
    );
  }

  /** Fechar no meio da divisão: o que já foi recebido precisa aparecer na comanda. */
  function close() {
    if (paidCount > 0) onPaid();
    else onClose();
  }

  async function pay() {
    if (!parsed) return;
    payingRef.current = true;
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
          taxDocument: taxDigits || undefined,
        },
      });
      const cents = toCents(parsed);
      const troco = toCents(res.change) > 0 ? ` Troco: ${brl(res.change)}` : '';
      const left = remainingCents - cents;
      if (parts <= 1 || left <= 0) {
        toast(
          parts > 1 ? `Conta dividida recebida.${troco}` : `Pagamento confirmado.${troco}`,
          'success',
        );
        onPaid();
        return;
      }
      const marked = plan.map((p, i) => (i === current ? { cents, paid: method } : p));
      const next = replan(marked, left, Math.max(parts, marked.filter((p) => p.paid).length + 1));
      const nextIdx = next.findIndex((p) => !p.paid);
      toast(`Parte ${current + 1} de ${next.length} recebida.${troco}`, 'success');
      goTo(next, nextIdx);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0
          ? 'Sem conexão. O pagamento NÃO foi confirmado. Tente de novo: não haverá cobrança duplicada.'
          : (e as Error).message,
      );
    } finally {
      payingRef.current = false;
      setBusy(false);
    }
  }

  const label = target.kind === 'order' ? `pedido #${target.number}` : `comanda ${target.number}`;
  return (
    <HelpScope dict={PAYMENT_FISCAL_HELP}>
      <Modal
        open={open}
        onClose={close}
        title={`Receber — ${label}`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {paidCount > 0 ? 'Fechar' : 'Cancelar'}
            </Button>
            <Button
              loading={busy}
              disabled={
                !parsed ||
                !sessionId ||
                !!taxError ||
                toCents(parsed) <= 0 ||
                toCents(parsed) > remainingCents ||
                (method === 'cash' && !!tendered && change < 0)
              }
              onClick={pay}
            >
              {parts > 1 ? `Receber parte ${current + 1} · ` : 'Confirmar '}
              {parsed ? brl(parsed) : ''}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="pay-balance">
            <span>{paidCount > 0 ? 'Falta' : 'Saldo'}</span>
            <strong>{brl(fromCents(remainingCents))}</strong>
          </div>
          {sessions !== null && sessions.length === 0 ? (
            <Alert tone="warning">Nenhum caixa aberto para receber pagamentos.</Alert>
          ) : (
            <label className="cm-field">
              <span className="cm-label">Caixa</span>
              <Select
                className="cm-input"
                value={sessionId}
                onChange={(e) => choose(e.target.value)}
              >
                {(sessions ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.registerName} · sessão {s.number}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <SplitPicker value={parts} min={Math.max(paidCount + 1, 1)} onChange={split} />
          {parts > 1 && (
            <ol className="pay-parts" aria-label="Partes da conta">
              {plan.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="pay-part"
                    data-paid={p.paid ? true : undefined}
                    aria-current={i === current && !p.paid ? 'step' : undefined}
                    disabled={!!p.paid || busy}
                    onClick={() => goTo(plan, i)}
                  >
                    <span className="pay-part__who">Pessoa {i + 1}</span>
                    <strong>{brl(fromCents(p.cents))}</strong>
                    <span className="pay-part__state">
                      {p.paid ? (
                        <>
                          <Check size={14} aria-hidden /> {PAYMENT_METHOD_LABELS[p.paid]}
                        </>
                      ) : i === current ? (
                        'agora'
                      ) : (
                        'a receber'
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
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
          <TextField
            label={parts > 1 ? `Valor da pessoa ${current + 1}` : 'Valor'}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint={
              parts > 1 && parsed && toCents(parsed) !== plan[current]?.cents
                ? 'O que sobrar é redividido entre as próximas pessoas.'
                : undefined
            }
            error={
              amount && !parsed
                ? 'Use o formato 12,90'
                : parsed && toCents(parsed) > remainingCents
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
          <TextField
            label="CPF/CNPJ na nota (opcional)"
            inputMode="numeric"
            placeholder="Só se o cliente pedir"
            value={taxDoc}
            maxLength={18}
            onChange={(e) => setTaxDoc(e.target.value)}
            onBlur={() => taxDigits && !taxError && setTaxDoc(formatDocument(taxDigits))}
            error={taxError}
            hint={
              !taxError && taxDigits ? 'A NFC-e deste pedido sai com este documento.' : undefined
            }
          />
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Modal>
    </HelpScope>
  );
}
