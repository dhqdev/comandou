import { formatBRL, fromCents, toCents } from './money';

/**
 * Como cada pessoa da equipe (fora os entregadores, que têm o Acerto de Entregas) ganha.
 * Tudo é somado: salário fixo do mês (proporcional aos dias do período pago), diária por dia
 * trabalhado, comissão sobre as vendas dos pedidos que a pessoa lançou e uma parte da taxa de
 * serviço desses pedidos. Valores em reais com ponto ("1800.00"); percentuais de 0 a 100.
 */
export interface StaffPayRule {
  /** Salário fixo do mês. */
  monthly: string;
  /** Diária por dia trabalhado (dia em que a pessoa entrou no sistema). */
  dailyRate: string;
  /** % sobre as vendas (itens, já com desconto) dos pedidos que a pessoa lançou. */
  salesPercent: number;
  /** % da taxa de serviço dos pedidos que a pessoa lançou (100 = a taxa toda). */
  servicePercent: number;
}

export const DEFAULT_STAFF_PAY_RULE: StaffPayRule = {
  monthly: '0.00',
  dailyRate: '0.00',
  salesPercent: 0,
  servicePercent: 0,
};

/** A regra não paga nada (ainda não foi cadastrada). */
export function staffRuleEmpty(r: StaffPayRule): boolean {
  return (
    toCents(r.monthly) === 0 &&
    toCents(r.dailyRate) === 0 &&
    r.salesPercent === 0 &&
    r.servicePercent === 0
  );
}

/** "Salário de R$ 1.800,00 por mês + diária de R$ 80,00 + 3% das vendas + toda a taxa de serviço". */
export function describeStaffPay(r: StaffPayRule): string {
  // O Intl separa "R$" do valor com espaço fixo; aqui vai o espaço comum (texto corrido).
  const brl = (v: string) => formatBRL(toCents(v)).replace(/\s/g, ' ');
  const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const parts: string[] = [];
  if (toCents(r.monthly) > 0) parts.push(`salário de ${brl(r.monthly)} por mês`);
  if (toCents(r.dailyRate) > 0) parts.push(`diária de ${brl(r.dailyRate)}`);
  if (r.salesPercent > 0) parts.push(`${n(r.salesPercent)}% das vendas`);
  if (r.servicePercent > 0)
    parts.push(
      r.servicePercent === 100
        ? 'toda a taxa de serviço'
        : `${n(r.servicePercent)}% da taxa de serviço`,
    );
  if (!parts.length) return 'Sem regra de pagamento';
  const text = parts.join(' + ');
  return text[0]!.toUpperCase() + text.slice(1);
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Dias corridos de `from` a `to`, os dois inclusos (datas AAAA-MM-DD). */
export function periodDays(from: string, to: string): number {
  return Math.max(0, Math.round((utc(to) - utc(from)) / DAY_MS) + 1);
}

/** Dia seguinte (AAAA-MM-DD). */
export function nextDay(iso: string): string {
  return isoOf(utc(iso) + DAY_MS);
}

/**
 * Salário proporcional ao período: em cada mês tocado, salário × dias do período naquele mês ÷
 * dias do mês. O mês inteiro dá o salário inteiro (em fevereiro também).
 */
export function prorateMonthly(monthly: string, from: string, to: string): string {
  const total = toCents(monthly);
  if (total <= 0 || utc(to) < utc(from)) return '0.00';
  let cents = 0;
  let cursor = utc(from);
  const end = utc(to);
  while (cursor <= end) {
    const d = new Date(cursor);
    const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    const inMonth = new Date(monthEnd).getUTCDate();
    const until = Math.min(monthEnd, end);
    const days = Math.round((until - cursor) / DAY_MS) + 1;
    cents += Math.round((total * days) / inMonth);
    cursor = until + DAY_MS;
  }
  return fromCents(cents);
}

export interface StaffPayInput {
  from: string;
  to: string;
  /** Dias trabalhados no período (as diárias). */
  days: number;
  /** Vendas (itens com desconto) dos pedidos que a pessoa lançou no período. */
  sales: string;
  /** Taxa de serviço desses pedidos. */
  service: string;
  /** Bônus (+) ou vale/desconto (−). */
  adjustments: string;
}

export interface StaffPayBreakdown {
  salary: string;
  daily: string;
  commission: string;
  serviceShare: string;
  adjustments: string;
  gross: string;
}

/** Conta do pagamento de um período. O total pode ficar negativo (vale maior que o ganho). */
export function staffPay(rule: StaffPayRule, i: StaffPayInput): StaffPayBreakdown {
  const salary = toCents(prorateMonthly(rule.monthly, i.from, i.to));
  const daily = Math.max(0, i.days) * toCents(rule.dailyRate);
  const commission = Math.round((toCents(i.sales) * rule.salesPercent) / 100);
  const serviceShare = Math.round((toCents(i.service) * rule.servicePercent) / 100);
  const adjustments = toCents(i.adjustments);
  return {
    salary: fromCents(salary),
    daily: fromCents(daily),
    commission: fromCents(commission),
    serviceShare: fromCents(serviceShare),
    adjustments: fromCents(adjustments),
    gross: fromCents(salary + daily + commission + serviceShare + adjustments),
  };
}

export const STAFF_PAY_METHODS = ['pix', 'cash', 'transfer', 'other'] as const;
export type StaffPayMethod = (typeof STAFF_PAY_METHODS)[number];
export const STAFF_PAY_METHOD_LABELS: Record<StaffPayMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  transfer: 'Transferência',
  other: 'Outro',
};
