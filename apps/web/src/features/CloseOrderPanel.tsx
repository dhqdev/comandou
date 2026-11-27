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
  resplitRows,
  type KeyedPayRow,
} from './close-math';
import { PAYMENT_METHOD_LABELS } from './format';
import { PAYMENT_FISCAL_HELP } from './help/fiscal-help';
import { useOpenSessions } from './PaymentModal';
import { printReceiptNow } from './ReceiptPreview';
import { SidePanel } from './SidePanel';
import './close-order.css';

const money = (cents: number) => formatBRL(cents);
const input = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/** Linha de pagamento com chave própria; `done` = confirmada numa tentativa que parou no meio. */
type Row = KeyedPayRow;

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
  const canAdjust = useCan('orders:manage');
  const canReceivable = useCan('orders:cancel');
  const { sessions, sessionId, choose } = useOpenSessions(open);
  const toast = useToast();

  /** Pedido mais novo que o próprio painel recebeu do servidor (pagamento ou ajuste aceito). */
  const [fresh, setFresh] = useState<Order | null>(null);
  // O mais novo entre o que veio em tempo real e o que o servidor devolveu ao painel: o saldo
  // já desconta as linhas confirmadas, mesmo antes do tempo real chegar.
  const live = fresh && fresh.version > order.version ? fresh : order;
  const subtotal = toCents(live.subtotal);
  const paid = toCents(live.paidAmount);
  const base0 = subtotal - toCents(live.discount);
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
  /**
   * Pedido como ficou depois de fechar a conta. O comprovante só é liberado aqui: antes disso ele
   * sairia sem a taxa, o frete, o desconto e os pagamentos que ainda não foram gravados.
   */
  const [closed, setClosed] = useState<Order | null>(null);
  /** Troco da conta fechada: depois de gravar, o saldo zera e o plano já não mostra o troco. */
  const [change, setChange] = useState(0);
  const locked = busy || !!closed;
  // Retirada não tem taxa de serviço nem frete (o servidor também zera os dois).
  const pickup = order.channel === 'pickup';
  /** O caixa mexeu nos valores das linhas: o total mudar não reescreve o que ele digitou. */
  const typed = useRef(false);

  // Cada abertura começa do pedido como está agora.
  useEffect(() => {
    if (!open) return;
    setFeePct(pickup ? '0' : percentFrom(toCents(order.surcharge), base0));
    setFreight(pickup ? '0,00' : input(toCents(order.deliveryFee)));
    setDiscMode('brl');
    setDisc(input(toCents(order.discount)));
    setWhen('now');
    setFresh(null);
    setRows([newRow(order.paymentHint ?? 'cash', toCents(order.balance))]);
    setSplit(1);
    setTaxDoc('');
    setReason('');
    setError(null);
    setClosed(null);
    setChange(0);
    typed.current = false;
    // Só ao abrir: o pedido em tempo real não apaga o que está sendo digitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id]);

  const pct = pickup ? 0 : percentOf(feePct);
  const freightC = pickup ? 0 : centsOf(freight);
  const discRaw = discMode === 'brl' ? centsOf(disc) : percentOf(disc);
  const discountC =
    discRaw === null ? null : discMode === 'brl' ? discRaw : percentCents(subtotal, discRaw);
  const surchargeC =
    pct === null || discountC === null
      ? null
      : pickup
        ? 0
        : // Mantém o centavo já cobrado quando o percentual não mudou (ex.: 10% arredondado).
          feePct === percentFrom(toCents(live.surcharge), base0) &&
            discountC === toCents(live.discount)
          ? toCents(live.surcharge)
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
    (totals.discount !== toCents(live.discount) ||
      totals.surcharge !== toCents(live.surcharge) ||
      totals.deliveryFee !== toCents(live.deliveryFee));

  // Total mudou e o caixa ainda não mexeu nas linhas: refaz a divisão sobre o novo saldo
  // (o que já foi recebido fica; linha com valor novo ganha chave nova). Durante o envio espera:
  // as linhas que estão indo ao servidor não podem mudar no meio.
  useEffect(() => {
    if (!open || busy || closed || typed.current || !valid) return;
    setRows((cur) => resplitRows(cur, totals.balance, Math.max(split, 1), newIdempotencyKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.balance, open, busy]);

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

  /**
   * Taxa, frete ou desconto mudou: o total é outro, então os valores dos pagamentos voltam a
   * seguir o saldo novo. Sem isso, o dinheiro digitado sobre o total antigo virava "troco"
   * (ex.: R$ 2,00 de desconto aparecendo como R$ 2,00 de troco no comprovante).
   */
  function adjust(set: (v: string) => void, v: string) {
    typed.current = false;
    set(v);
  }
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
    setRows((cur) => resplitRows(cur, totals.balance, next, newIdempotencyKey));
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
    !closed &&
    valid &&
    !taxError &&
    !busy &&
    (nowReady || laterReady || (totals.balance === 0 && canComplete));

  async function finish(print = false) {
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
        setFresh(current);
        if (toCents(current.balance) !== totals.balance) {
          setError(
            'O pedido mudou enquanto a conta era fechada. Confira os valores e tente de novo.',
          );
          return;
        }
      }
      if (when === 'now' && totals.balance > 0) {
        // O saldo já desconta as linhas confirmadas antes; só as que faltam abatem dele.
        let left = totals.balance;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i]!;
          const amount = plan.applied[i] ?? 0;
          if (r.done || amount <= 0) continue;
          const tendered = plan.tendered[i];
          const res = await api<{ order?: Order }>(`/orders/${order.id}/payments`, {
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
          if (res?.order) setFresh(res.order);
          setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, done: true } : x)));
        }
        if (left > 0) {
          setError(`Ainda falta receber ${money(left)}. Confira os valores e tente de novo.`);
          return;
        }
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
      // Fechar a conta já conclui: sem o clique a mais em "Concluir". O painel some e o aviso
      // (com o troco) aparece no pedido. "Fechar e imprimir" imprime o comprovante direto (app de
      // impressão ou impressora do navegador), sem prévia, já com tudo gravado.
      const troco = when === 'now' ? plan.change : 0;
      setChange(troco);
      setClosed(current);
      toast(
        when === 'later'
          ? 'Pedido concluído a receber'
          : troco > 0
            ? `Conta fechada. Troco: ${money(troco)}`
            : 'Conta fechada',
        'success',
      );
      if (print) {
        try {
          const where = await printReceiptNow({ kind: 'order', id: order.id });
          if (where === 'agent') toast('Comprovante enviado para a impressora do caixa', 'success');
        } catch (e) {
          toast(`Conta fechada, mas o comprovante não imprimiu: ${(e as Error).message}`, 'danger');
        }
      }
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
  const closedText =
    when === 'later'
      ? 'Pedido concluído a receber'
      : change > 0
        ? `Conta fechada. Troco: ${money(change)}`
        : 'Conta fechada';
  const statusLine = closed
    ? when === 'later'
      ? 'Concluído a receber'
      : 'Conta fechada'
    : when === 'later'
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
        onClose={busy ? () => undefined : closed ? () => onDone(closed) : onClose}
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
                  disabled={split <= 1 || when === 'later' || locked}
                  onClick={() => changeSplit(split - 1)}
                >
                  <Minus size={14} aria-hidden />
                </button>
                <input
                  aria-label="Pessoas"
                  inputMode="numeric"
                  value={split}
                  disabled={when === 'later' || locked}
                  onChange={(e) => changeSplit(Number(e.target.value.replace(/\D/g, '')) || 1)}
                />
                <button
                  type="button"
                  aria-label="Mais uma pessoa"
                  disabled={split >= 20 || when === 'later' || locked}
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
              {when === 'now' && !closed && <span>Recebendo: {money(plan.typed)}</span>}
              {closed && change > 0 && <span>Troco: {money(change)}</span>}
              <strong>{statusLine}</strong>
            </div>
            <div className="cop-bar__actions">
              <Button
                variant="secondary"
                icon={<Printer size={15} />}
                disabled={!ready}
                title="Fecha a conta e imprime o comprovante na hora, já com taxa, frete, desconto e pagamentos"
                onClick={() => void finish(true)}
              >
                Fechar e imprimir
              </Button>
              <Button loading={busy} disabled={!ready} onClick={() => void finish()}>
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
              {!pickup && (
                <>
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
                        disabled={!canAdjust || locked}
                        aria-invalid={pct === null || undefined}
                        onChange={(e) => adjust(setFeePct, e.target.value)}
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
                        disabled={!canAdjust || locked}
                        aria-invalid={freightC === null || undefined}
                        onChange={(e) => adjust(setFreight, e.target.value)}
                      />
                      <span className="cop-num">{money(totals.deliveryFee)}</span>
                    </dd>
                  </div>
                </>
              )}
              <div className="cop-line">
                <dt>
                  <label htmlFor="cop-disc">Desconto</label>
                </dt>
                <dd>
                  <Select
                    className="cm-input cop-unit"
                    aria-label="Tipo de desconto"
                    value={discMode}
                    disabled={!canAdjust || locked}
                    onChange={(e) => {
                      typed.current = false;
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
                    disabled={!canAdjust || locked}
                    aria-invalid={discountC === null || (discountC ?? 0) > subtotal || undefined}
                    onChange={(e) => adjust(setDisc, e.target.value)}
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
            {pickup && (
              <p className="cop-hint">Retirada no balcão: sem taxa de serviço e sem frete.</p>
            )}
            {closed && (
              <Alert tone="info">
                {`${closedText}. O comprovante já sai com taxa, frete, desconto, pagamentos e troco.`}
              </Alert>
            )}
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
                disabled={locked}
                onClick={() => setWhen('now')}
              >
                Imediato
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={when === 'later'}
                disabled={locked}
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
                      disabled={locked}
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
                        disabled={r.done || locked}
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
                        disabled={r.done || locked}
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
                          disabled={rows.length <= 1 || locked}
                          onClick={() => removeRow(i)}
                        >
                          <X size={14} aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <button type="button" className="cop-add" disabled={locked} onClick={addRow}>
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
                  disabled={locked}
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
    </HelpScope>
  );
}
