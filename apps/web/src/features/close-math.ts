import { splitCents, toCents, type PaymentMethod } from '@comandou/shared';
import { parseBrlInput } from '../lib/money';

/** Uma linha de pagamento do "Fechar conta": meio e valor digitado (texto, como no campo). */
export interface PayRow {
  method: PaymentMethod;
  amount: string;
  /** Já confirmado pelo servidor: fica fixo e já está no pago do pedido (não abate o saldo). */
  done?: boolean;
}

/** Linha com a chave de idempotência: reenviar depois de uma falha não cobra duas vezes. */
export interface KeyedPayRow extends PayRow {
  key: string;
}

/** Lê "12,90" / "12.90" em centavos; texto vazio vale 0 e texto inválido vale null. */
export function centsOf(v: string): number | null {
  if (!v.trim()) return 0;
  const p = parseBrlInput(v);
  return p ? toCents(p) : null;
}

/** Percentual "10" / "10,5" em número; vazio vale 0 e inválido (ou fora de 0–100) vale null. */
export function percentOf(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (!t) return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= 100 ? n : null;
}

/** Taxa de serviço em centavos sobre a base (itens com desconto), arredondada ao centavo. */
export const percentCents = (base: number, pct: number) =>
  Math.round((Math.max(base, 0) * pct) / 100);

/** Percentual que um valor representa sobre a base (para mostrar a taxa de serviço já cobrada). */
export function percentFrom(cents: number, base: number): string {
  if (cents <= 0 || base <= 0) return '0';
  const p = Math.round((cents * 10000) / base) / 100;
  return String(p).replace('.', ',');
}

export interface CloseTotals {
  discount: number;
  surcharge: number;
  deliveryFee: number;
  total: number;
  /** O que falta receber depois do que já foi pago. */
  balance: number;
}

/** Total do fechamento: subtotal − desconto + taxa de serviço + frete (tudo em centavos). */
export function closeTotals(input: {
  subtotal: number;
  paid: number;
  discount: number;
  surcharge: number;
  deliveryFee: number;
}): CloseTotals {
  const total = input.subtotal - input.discount + input.surcharge + input.deliveryFee;
  return {
    discount: input.discount,
    surcharge: input.surcharge,
    deliveryFee: input.deliveryFee,
    total,
    balance: total - input.paid,
  };
}

export interface PayPlan {
  /** Soma digitada nas linhas. */
  typed: number;
  /** Quanto cada linha abate do saldo (o excesso em dinheiro vira troco). */
  applied: number[];
  /** Valor entregue em dinheiro de cada linha (só quando há troco). */
  tendered: (number | undefined)[];
  change: number;
  /** Quanto ainda falta (> 0) depois das linhas. */
  missing: number;
  /** Excesso que não dá para devolver como troco (cartão/pix acima do saldo). */
  excess: number;
  invalid: boolean;
}

/**
 * Distribui as linhas sobre o saldo. Pagar a mais só é aceito em dinheiro: o excesso sai como
 * troco da última linha em dinheiro (o servidor recebe o valor aplicado e o valor entregue).
 */
export function planPayments(rows: PayRow[], balance: number): PayPlan {
  const values = rows.map((r) => (r.done ? 0 : centsOf(r.amount)));
  const invalid = values.some((v) => v === null);
  const cents = values.map((v) => v ?? 0);
  const typed = cents.reduce((s, v) => s + v, 0);
  const applied = [...cents];
  const tendered: (number | undefined)[] = rows.map(() => undefined);
  let over = Math.max(typed - Math.max(balance, 0), 0);
  let change = 0;
  // Tira o excesso das linhas em dinheiro, da última para a primeira.
  for (let i = rows.length - 1; i >= 0 && over > 0; i--) {
    if (rows[i]!.method !== 'cash' || cents[i]! <= 0) continue;
    const take = Math.min(over, cents[i]!);
    applied[i] = cents[i]! - take;
    tendered[i] = cents[i];
    change += take;
    over -= take;
  }
  const paid = applied.reduce((s, v) => s + v, 0);
  return {
    typed,
    applied,
    tendered,
    change,
    missing: Math.max(balance - paid, 0),
    excess: over,
    invalid,
  };
}

/** "Dividir por N": N linhas com o saldo repartido, mantendo os meios já escolhidos. */
export function splitRows(rows: PayRow[], balance: number, n: number): PayRow[] {
  const parts = splitCents(Math.max(balance, 0), Math.max(1, Math.min(n, 20)));
  const fallback = rows[0]?.method ?? 'cash';
  return parts.map((c, i) => ({
    method: rows[i]?.method ?? fallback,
    amount: (c / 100).toFixed(2).replace('.', ','),
  }));
}

/**
 * Refaz a divisão sobre o saldo de agora sem mexer no que já foi recebido: as linhas confirmadas
 * ficam como estão e só as que faltam enviar dividem o saldo. Linha cujo valor muda ganha chave
 * nova (a chave antiga já pode ter ido ao servidor com o outro valor).
 */
export function resplitRows(
  rows: KeyedPayRow[],
  balance: number,
  n: number,
  newKey: () => string,
): KeyedPayRow[] {
  const done = rows.filter((r) => r.done);
  const pending = rows.filter((r) => !r.done);
  // Tudo recebido e nada mais a cobrar: não cria linha nova.
  if (!pending.length && balance <= 0) return rows;
  const parts = splitRows(
    pending.length ? pending : rows.slice(-1),
    balance,
    Math.max(n - done.length, 1),
  );
  return [
    ...done,
    ...parts.map((p, i) => {
      const old = pending[i];
      const same = old && centsOf(old.amount) === centsOf(p.amount);
      return { ...p, key: same ? old.key : newKey() };
    }),
  ];
}
