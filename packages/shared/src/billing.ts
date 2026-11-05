/**
 * Regras da cobrança da assinatura (docs/cobranca.md):
 * - teste grátis (dias do plano; padrão 7);
 * - cada mensalidade paga libera mais 30 dias, contados do fim do período anterior (ou do dia do
 *   pagamento, se ele chegou depois do fim);
 * - a fatura do período seguinte sai alguns dias antes do fim e vence no último dia liberado;
 * - não pagou até o fim (mais a tolerância configurada), o acesso é bloqueado automaticamente e
 *   volta assim que o pagamento é confirmado. Nada é apagado.
 * Funções puras: a API e as telas usam as mesmas contas.
 */
import { fromCents, toCents } from './money';

export const BILLING_PERIOD_DAYS = 30;
/** Menor valor que o Asaas aceita numa cobrança (boleto e Pix). */
export const MIN_CHARGE_CENTS = 500;

export const INVOICE_STATUSES = ['pending', 'paid', 'overdue', 'cancelled', 'refunded'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_LABELS: Record<InvoiceStatus, string> = {
  pending: 'A pagar',
  paid: 'Paga',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
  refunded: 'Estornada',
};

export const INVOICE_KINDS = ['monthly', 'upgrade', 'manual'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  monthly: 'Mensalidade',
  upgrade: 'Troca de plano',
  manual: 'Cobrança avulsa',
};

export type BillingMode = 'manual' | 'asaas';
export type BlockReason = 'payment' | 'contract';
export const BLOCK_LABELS: Record<BlockReason, string> = {
  payment: 'pagamento não confirmado',
  contract: 'contrato vencido sem renovação',
};

const DAY = 86_400_000;

/** Data AAAA-MM-DD no horário de Brasília. */
export function spDate(d: Date | string | number = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(d));
}

export function addDays(d: Date | string, days: number): Date {
  return new Date(new Date(d).getTime() + days * DAY);
}

/** Dias inteiros que faltam até `until` (arredonda para cima; 0 quando já passou). */
export function daysLeft(until: Date | string | null | undefined, now = new Date()): number | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY);
}

/** Até quando o acesso está liberado: fim do teste ou fim do período pago. */
export function accessUntil(s: {
  status: string;
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
}): Date | null {
  const v = s.status === 'trialing' ? s.trialEndsAt : (s.currentPeriodEnd ?? s.trialEndsAt);
  return v ? new Date(v) : null;
}

/** Novo fim do período depois de um pagamento confirmado: +30 dias do maior entre o fim atual e o pagamento. */
export function periodAfterPayment(
  currentEnd: Date | string | null,
  paidAt: Date | string,
  days = BILLING_PERIOD_DAYS,
): Date {
  const base = Math.max(
    currentEnd ? new Date(currentEnd).getTime() : 0,
    new Date(paidAt).getTime(),
  );
  return new Date(base + days * DAY);
}

/** Hora de gerar a fatura do próximo período? */
export function invoiceDue(until: Date | string, daysBefore: number, now = new Date()): boolean {
  return now.getTime() >= new Date(until).getTime() - daysBefore * DAY;
}

/**
 * Próximos vencimentos de mensalidade (AAAA-MM-DD, horário de Brasília) entre `from` e `to`:
 * o último dia liberado (`until`) e, depois, a cada 30 dias. Pula as datas que já passaram
 * (antes de `today`) e os períodos que já têm fatura (`billed`, pela data de início).
 */
export function forecastDueDates(
  until: Date | string | null,
  from: string,
  to: string,
  today: string,
  billed: ReadonlySet<string> = new Set(),
): string[] {
  if (!until) return [];
  let d = new Date(until);
  // Período muito antigo: pula direto para perto do intervalo pedido.
  const behind = Math.floor(
    (new Date(`${from}T12:00:00-03:00`).getTime() - d.getTime()) / (BILLING_PERIOD_DAYS * DAY),
  );
  if (behind > 1) d = new Date(d.getTime() + (behind - 1) * BILLING_PERIOD_DAYS * DAY);
  const out: string[] = [];
  for (; spDate(d) <= to; d = new Date(d.getTime() + BILLING_PERIOD_DAYS * DAY)) {
    const k = spDate(d);
    if (k < from || k < today || billed.has(k)) continue;
    out.push(k);
  }
  return out;
}

/** Bloqueia quando passou do fim + tolerância (em dias). */
export function paymentBlocked(
  until: Date | string | null,
  toleranceDays: number,
  now = new Date(),
): boolean {
  if (!until) return false;
  return now.getTime() > new Date(until).getTime() + toleranceDays * DAY;
}

/**
 * Valor proporcional de uma troca para um plano mais caro: diferença mensal × dias restantes / 30.
 * Abaixo do mínimo do Asaas não há cobrança (a troca sai sem custo).
 */
export function upgradeCharge(
  oldPrice: string,
  newPrice: string,
  until: Date | string | null,
  now = new Date(),
): { cents: number; amount: string; days: number } {
  const diff = toCents(newPrice) - toCents(oldPrice);
  const days = Math.min(BILLING_PERIOD_DAYS, daysLeft(until, now) ?? 0);
  let cents = diff > 0 ? Math.round((diff * days) / BILLING_PERIOD_DAYS) : 0;
  if (cents < MIN_CHARGE_CENTS) cents = 0;
  return { cents, amount: fromCents(cents), days };
}

/** Contrato: vence em `validUntil`; aviso de renovação `renewalDays` antes; bloqueio `graceDays` depois. */
export type ContractPhase = 'none' | 'valid' | 'renewal' | 'expired' | 'blocked';
export function contractPhase(
  validUntil: Date | string | null,
  renewalDays: number,
  graceDays: number,
  now = new Date(),
): ContractPhase {
  if (!validUntil) return 'none';
  const end = new Date(`${String(validUntil).slice(0, 10)}T23:59:59-03:00`).getTime();
  const t = now.getTime();
  if (t > end + graceDays * DAY) return 'blocked';
  if (t > end) return 'expired';
  if (t > end - renewalDays * DAY) return 'renewal';
  return 'valid';
}

/** Fim da vigência: início + meses − 1 dia (AAAA-MM-DD). */
export function contractValidUntil(startDate: string, termMonths: number): string {
  const [y, m, d] = startDate.slice(0, 10).split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + termMonths, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const end = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)));
  return new Date(end.getTime() - DAY).toISOString().slice(0, 10);
}
