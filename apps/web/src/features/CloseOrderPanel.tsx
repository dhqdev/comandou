import {
  canTransition,
  formatBRL,
  formatDocument,
  fromCents,
  isValidCnpj,
  isValidCpf,
  PAYMENT_METHODS,
  toCents,
  qtyLabel,
} from '@comandou/shared';
import { Minus, Plus, Printer, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, HelpScope, Select, TextField, useToast } from '../design-system';
import { useCan } from '../app/auth';
import { api, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import type { Order } from '../lib/types';
import {
  centsOf,
  closeTotals,
  percentCents,
  percentFrom,
  percentOf,
  planPayments,
  splitRows,
  type PayRow,
} from './close-math';
import { PAYMENT_METHOD_LABELS } from './format';
import { PAYMENT_FISCAL_HELP } from './help/fiscal-help';
import { useOpenSessions } from './PaymentModal';
import { ReceiptPreview } from './ReceiptPreview';
import { SidePanel } from './SidePanel';
import './close-order.css';

const money = (cents: number) => formatBRL(cents);
const input = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

interface Row extends PayRow {
  /** Chave de idempotência da linha: reenviar depois de uma falha não cobra duas vezes. */
  key: string;
  /** Já confirmado pelo servidor (numa tentativa anterior que parou no meio). */
  done?: boolean;
}

const newRow = (method: Row['method'], cents: number): Row => ({
  method,
  amount: input(cents),
  key: newIdempotencyKey(),
});

/**
 * "Fechar conta" do pedido: painel que desliza da direita com os itens à esquerda e, à direita,
 * taxa de serviço, frete, desconto, Imediato ou Posterior (a receber), vários meios de pagamento
 * e a divisão por pessoa. Nada aparece como pago até o servidor confirmar cada linha.
 * As regras do servidor continuam valendo: desconto alto e "a receber" exigem o gerente,
 * e o pedido só é concluído quando o saldo zera (ou fica a receber, com motivo).
 */
export function CloseOrderPanel({
  order,
  open,
  onClose,
  onDone,
}: {
  order: Order;
  open: boolean;
  onClose(): void;
  onDone(o: Order | null): void;
}) {
  const toast = useToast();
  const canAdjust = useCan('orders:manage');
  const canReceivable = useCan('orders:cancel');
  const { sessions, sessionId, choose } = useOpenSessions(open);

  const subtotal = toCents(order.subtotal);
  const paid = toCents(order.paidAmount);
  const base0 = subtotal - toCents(order.discount);
  const [feePct, setFeePct] = useState('0');
  const [freight, setFreight] = useState('0,00');
  const [discMode, setDiscMode] = useState<'brl' | 'pct'>('brl');
  const [disc, setDisc] = useState('0,00');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [rows, setRows] = useState<Row[]>([]);
  const [split, setSplit] = useState(1);
  const [taxDoc, setTaxDoc] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  /** O caixa mexeu nos valores das linhas: o total mudar não reescreve o que ele digitou. */
  const typed = useRef(false);

  // Cada abertura começa do pedido como está agora.
  useEffect(() => {
    if (!open) return;
    setFeePct(percentFrom(toCents(order.surcharge), base0));
    setFreight(input(toCents(order.deliveryFee)));
    setDiscMode('brl');
    setDisc(input(toCents(order.discount)));
    setWhen('now');
    setRows([newRow(order.paymentHint ?? 'cash', toCents(order.balance))]);
    setSplit(1);
    setTaxDoc('');
    setReason('');
    setError(null);
    typed.current = false;
    // Só ao abrir: o pedido em tempo real não apaga o que está sendo digitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id]);

  const pct = percentOf(feePct);
  const freightC = centsOf(freight);
  const discRaw = discMode === 'brl' ? centsOf(disc) : percentOf(disc);
  const discountC =
    discRaw === null ? null : discMode === 'brl' ? discRaw : percentCents(subtotal, discRaw);
  const surchargeC =
    pct === null || discountC === null
      ? null
      : // Mantém o centavo já cobrado quando o percentual não mudou (ex.: 10% arredondado).
        feePct === percentFrom(toCents(order.surcharge), base0) &&
          discountC === toCents(order.discount)
        ? toCents(order.surcharge)
        : percentCents(subtotal - discountC, pct);
  const valid =
    pct !== null &&
    freightC !== null &&
    discountC !== null &&
    surchargeC !== null &&
    discountC <= subtotal;
  const totals = closeTotals({
    subtotal,
    paid,
    discount: discountC ?? 0,
    surcharge: surchargeC ?? 0,
    deliveryFee: freightC ?? 0,
  });
  const changedValues =
    valid &&
    (totals.discount !== toCents(order.discount) ||
      totals.surcharge !== toCents(order.surcharge) ||
      totals.deliveryFee !== toCents(order.deliveryFee));

  // Total mudou e o caixa ainda não mexeu nas linhas: refaz a divisão sobre o novo saldo.
  useEffect(() => {
    if (!open || typed.current || !valid) return;
    setRows((cur) =>
      splitRows(cur, totals.balance, Math.max(split, 1)).map((r, i) => ({
        ...r,
        key: cur[i]?.key ?? newIdempotencyKey(),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.balance, open]);

  const plan = useMemo(() => planPayments(rows, totals.balance), [rows, totals.balance]);
  const perPerson = split > 1 ? Math.ceil(Math.max(totals.total, 0) / split) : null;

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

  // "A receber" só fecha o pedido: precisa poder concluir (pronto, fora da rua) e do gerente.
  const canComplete =
    order.status !== 'dispatched' && canTransition(order.status, 'completed', order.channel);
  const laterBlocked = !canReceivable
    ? 'Deixar a receber exige o gerente.'
    : !canComplete
      ? 'Fica disponível quando o pedido estiver pronto.'
      : null;

  function setRow(i: number, patch: Partial<Row>) {
    if ('amount' in patch) typed.current = true;
    setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    typed.current = true;
    setRows((cur) => [...cur, newRow('pix', plan.missing)]);
  }
  function removeRow(i: number) {
    typed.current = true;
    setRows((cur) => (cur.length > 1 ? cur.filter((_, k) => k !== i) : cur));
  }
  function changeSplit(n: number) {
    const next = Math.min(Math.max(n, 1), 20);
    setSplit(next);
    typed.current = false;
    setRows((cur) =>
      splitRows(cur, totals.balance, next).map((r, i) => ({
        ...r,
        key: cur[i]?.done ? newIdempotencyKey() : (cur[i]?.key ?? newIdempotencyKey()),
      })),
    );
  }

  const nowReady =
    when === 'now' &&
    !plan.invalid &&
    plan.excess === 0 &&
    plan.missing === 0 &&
    !!sessionId &&
    totals.balance >= 0;
  const laterReady = when === 'later' && !laterBlocked && reason.trim().length >= 3;
  const ready =
    valid &&
    !taxError &&
    !busy &&
    (nowReady || laterReady || (totals.balance === 0 && canComplete));

  async function finish() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    let current: Order = order;
    try {
      if (changedValues) {
        current = await api<Order>(`/orders/${order.id}/adjustments`, {
          method: 'PATCH',
          json: {
            discount: fromCents(totals.discount),
            surcharge: fromCents(totals.surcharge),
            deliveryFee: fromCents(totals.deliveryFee),
            reason: 'Ajuste no fechamento da conta',
          },
        });
        if (toCents(current.balance) !== totals.balance) {
          setError(
            'O pedido mudou enquanto a conta era fechada. Confira os valores e tente de novo.',
          );
          return;
        }
      }
      if (when === 'now' && totals.balance > 0) {
        let left = totals.balance;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i]!;
          const amount = plan.applied[i] ?? 0;
          if (r.done || amount <= 0) continue;
          const tendered = plan.tendered[i];
          await api(`/orders/${order.id}/payments`, {
            method: 'POST',
            headers: { 'Idempotency-Key': r.key },
            json: {
              cashSessionId: sessionId,
              method: r.method,
              amount: fromCents(amount),
              tendered: tendered ? fromCents(tendered) : undefined,
              taxDocument: taxDigits || undefined,
            },
          });
          left -= amount;
          setRows((cur) => cur.map((x, k) => (k === i ? { ...x, done: true } : x)));
        }
        if (left > 0) return;
      }
      current = await api<Order>(`/orders/${order.id}`);
      // Conta paga e pedido pronto no salão/balcão: fecha de vez. Entrega segue para despacho.
      const complete =
        when === 'later' ||
        (canComplete && order.channel !== 'delivery' && toCents(current.balance) === 0);
      if (complete) {
        current = await api<Order>(`/orders/${order.id}/status`, {
          method: 'POST',
          json: {
            to: 'completed',
            expectedVersion: current.version,
            reason: when === 'later' ? reason.trim() : undefined,
            receivable: when === 'later' || undefined,
          },
        });
      }
      toast(
        when === 'later'
          ? `Pedido #${order.number} concluído a receber`
          : plan.change > 0
            ? `Conta fechada. Troco: ${money(plan.change)}`
            : 'Conta fechada',
        'success',
      );
      onDone(current);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0
          ? 'Sem conexão. O que não apareceu como pago NÃO foi confirmado. Tente de novo: não haverá cobrança duplicada.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const activeItems = order.items.filter((i) => i.status !== 'cancelled');
  const statusLine =
    when === 'later'
      ? `A receber: ${money(Math.max(totals.balance, 0))}`
      : plan.change > 0
        ? `Troco: ${money(plan.change)}`
        : plan.missing > 0
          ? `Falta: ${money(plan.missing)}`
          : plan.excess > 0
            ? `Acima do saldo: ${money(plan.excess)}`
            : 'Pagamento exato';

  return (
    <HelpScope dict={PAYMENT_FISCAL_HELP}>
      <SidePanel
        open={open}
        onClose={busy ? () => undefined : onClose}
        size="xl"
        className="close-panel"
        title={
          <span className="cop-head">
            <span className="cop-head__title">Fechar conta</span>
            <span className="cop-head__sub">
              Pedido #{order.number} · confira os valores e escolha como vai receber
            </span>
          </span>
        }
        footer={
          <div className="cop-bar">
            <div className="cop-bar__total">
              <span>Total geral</span>
              <strong>{money(totals.total)}</strong>
            </div>
            <div className="cop-bar__split">
              <span id="cop-split">Dividir por</span>
              <div className="cop-stepper" role="group" aria-labelledby="cop-split">
                <button
                  type="button"
                  aria-label="Menos uma pessoa"
                  disabled={split <= 1 || when === 'later'}
                  onClick={() => changeSplit(split - 1)}
                >
                  <Minus size={14} aria-hidden />
                </button>
                <input
                  aria-label="Pessoas"
                  inputMode="numeric"
                  value={split}
                  disabled={when === 'later'}
                  onChange={(e) => changeSplit(Number(e.target.value.replace(/\D/g, '')) || 1)}
                />
                <button
                  type="button"
                  aria-label="Mais uma pessoa"
                  disabled={split >= 20 || when === 'later'}
                  onClick={() => changeSplit(split + 1)}
                >
                  <Plus size={14} aria-hidden />
                </button>
              </div>
              {perPerson !== null && (
                <strong className="cop-bar__per">
                  {money(perPerson)}
                  <small>/pessoa</small>
                </strong>
              )}
            </div>
            <div className="cop-bar__status">
              {paid > 0 && <span>Já pago: {money(paid)}</span>}
              {when === 'now' && <span>Recebendo: {money(plan.typed)}</span>}
              <strong>{statusLine}</strong>
            </div>
            <div className="cop-bar__actions">
              <Button
                variant="secondary"
                icon={<Printer size={15} />}
                onClick={() => setPreview(true)}
              >
                Imprimir
              </Button>
              <Button loading={busy} disabled={!ready} onClick={finish}>
                {when === 'later' ? 'Concluir a receber' : 'Fechar conta'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="cop">
          <section className="cop-items" aria-label="Itens da conta">
            <h3 className="cop-title">
              Itens da conta
              <span className="od-pill">
                {activeItems.length} {activeItems.length === 1 ? 'item' : 'itens'}
              </span>
            </h3>
            <ul>
              {activeItems.map((i) => (
                <li key={i.id} className="cop-item">
                  <div className="cop-item__top">
                    <strong>{i.name}</strong>
                    <strong className="cop-num">{money(toCents(i.total))}</strong>
                  </div>
                  <span className="cop-item__sub">
                    {qtyLabel(i.quantity, i.unit)} × {money(toCents(i.unitPrice))}
                    {i.unit === 'kg' ? '/kg' : ''}
                    {i.options.length > 0 && ` · ${i.options.map((o) => o.name).join(', ')}`}
                  </span>
                  {i.notes && <span className="cop-item__sub">Obs.: {i.notes}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section className="cop-pay" aria-label="Conferência e pagamento">
            <dl className="cop-lines">
              <div className="cop-line">
                <dt>Subtotal</dt>
                <dd className="cop-num">{money(subtotal)}</dd>
              </div>
              <div className="cop-line">
                <dt>
                  <label htmlFor="cop-fee">Taxa de serviço (%)</label>
                </dt>
                <dd>
                  <input
                    id="cop-fee"
                    className="cm-input cop-in"
                    inputMode="decimal"
                    value={feePct}
                    disabled={!canAdjust || busy}
                    aria-invalid={pct === null || undefined}
                    onChange={(e) => setFeePct(e.target.value)}
                  />
                  <span className="cop-num">{money(totals.surcharge)}</span>
                </dd>
              </div>
              <div className="cop-line">
                <dt>
                  <label htmlFor="cop-freight">Frete (R$)</label>
                </dt>
                <dd>
                  <input
                    id="cop-freight"
                    className="cm-input cop-in"
                    inputMode="decimal"
                    value={freight}
                    disabled={!canAdjust || busy}
                    aria-invalid={freightC === null || undefined}
                    onChange={(e) => setFreight(e.target.value)}
                  />
                  <span className="cop-num">{money(totals.deliveryFee)}</span>
                </dd>
              </div>
              <div className="cop-line">
                <dt>
                  <label htmlFor="cop-disc">Desconto</label>
                </dt>
                <dd>
                  <Select
                    className="cm-input cop-unit"
                    aria-label="Tipo de desconto"
                    value={discMode}
                    disabled={!canAdjust || busy}
                    onChange={(e) => {
                      setDiscMode(e.target.value as 'brl' | 'pct');
                      setDisc(e.target.value === 'pct' ? '0' : '0,00');
                    }}
                  >
                    <option value="brl">R$</option>
                    <option value="pct">%</option>
                  </Select>
                  <input
                    id="cop-disc"
                    className="cm-input cop-in"
                    inputMode="decimal"
                    value={disc}
                    disabled={!canAdjust || busy}
                    aria-invalid={discountC === null || (discountC ?? 0) > subtotal || undefined}
                    onChange={(e) => setDisc(e.target.value)}
                  />
                  <span className="cop-num">− {money(totals.discount)}</span>
                </dd>
              </div>
              {paid > 0 && (
                <div className="cop-line">
                  <dt>Já pago</dt>
                  <dd className="cop-num">− {money(paid)}</dd>
                </div>
              )}
              <div className="cop-line cop-line--total">
                <dt>{paid > 0 ? 'Falta receber' : 'Total'}</dt>
                <dd className="cop-num">{money(Math.max(totals.balance, 0))}</dd>
              </div>
            </dl>
            {!canAdjust && (
              <p className="cop-hint">
                Taxa, frete e desconto só podem ser mudados pelo caixa ou gerente.
              </p>
            )}
            {(discountC ?? 0) > subtotal && (
              <Alert tone="danger">Desconto maior que os itens.</Alert>
            )}
            {totals.balance < 0 && (
              <Alert tone="danger">O novo total fica abaixo do que já foi pago.</Alert>
            )}

            <div className="cop-when" role="radiogroup" aria-label="Quando recebe">
              <button
                type="button"
                role="radio"
                aria-checked={when === 'now'}
                onClick={() => setWhen('now')}
              >
                Imediato
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={when === 'later'}
                onClick={() => setWhen('later')}
              >
                Posterior (a receber)
              </button>
            </div>

            {when === 'later' ? (
              <div className="cop-later">
                {laterBlocked ? (
                  <Alert tone="warning">{laterBlocked}</Alert>
                ) : (
                  <>
                    <p className="cop-hint">
                      O pedido é concluído com {money(Math.max(totals.balance, 0))} em aberto e
                      aparece em "Concluídos em aberto" até ser recebido.
                    </p>
                    <TextField
                      label="Motivo (quem vai pagar e quando)"
                      value={reason}
                      maxLength={300}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </>
                )}
              </div>
            ) : (
              <>
                {sessions !== null && sessions.length === 0 ? (
                  <Alert tone="warning">Nenhum caixa aberto para receber pagamentos.</Alert>
                ) : (
                  (sessions?.length ?? 0) > 1 && (
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
                  )
                )}
                <ul className="cop-rows" aria-label="Meios de pagamento">
                  {rows.map((r, i) => (
                    <li key={r.key} className="cop-row" data-done={r.done || undefined}>
                      {split > 1 && <span className="cop-row__who">Pessoa {i + 1}</span>}
                      <Select
                        className="cm-input"
                        aria-label={`Meio de pagamento ${i + 1}`}
                        value={r.method}
                        disabled={r.done || busy}
                        onChange={(e) => setRow(i, { method: e.target.value as Row['method'] })}
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_METHOD_LABELS[m]}
                          </option>
                        ))}
                      </Select>
                      <input
                        className="cm-input cop-in"
                        inputMode="decimal"
                        aria-label={`Valor ${i + 1}`}
                        value={r.amount}
                        disabled={r.done || busy}
                        aria-invalid={centsOf(r.amount) === null || undefined}
                        onChange={(e) => setRow(i, { amount: e.target.value })}
                      />
                      {r.done ? (
                        <span className="cop-row__ok">Recebido</span>
                      ) : (
                        <button
                          type="button"
                          className="cop-row__x"
                          aria-label={`Tirar pagamento ${i + 1}`}
                          disabled={rows.length <= 1 || busy}
                          onClick={() => removeRow(i)}
                        >
                          <X size={14} aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <button type="button" className="cop-add" disabled={busy} onClick={addRow}>
                  <Plus size={14} aria-hidden /> Adicionar meio de pagamento
                </button>
                {plan.excess > 0 && (
                  <Alert tone="warning">
                    Só dinheiro pode passar do saldo (vira troco). Ajuste os valores.
                  </Alert>
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
                />
              </>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
          </section>
        </div>
      </SidePanel>
      <ReceiptPreview
        target={preview ? { kind: 'order', id: order.id } : null}
        onClose={() => setPreview(false)}
      />
    </HelpScope>
  );
}
