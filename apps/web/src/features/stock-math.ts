/** Contas de estoque na tela, em inteiros (milésimos de quantidade), sem float acumulando erro. */

/** "12.500" ou "-1.25" → 12500 / -1250 (milésimos). */
export function toMilli(q: string): number {
  const neg = q.startsWith('-');
  const [i = '0', f = ''] = (neg ? q.slice(1) : q).split('.');
  const v = Number(i) * 1000 + Number((f + '000').slice(0, 3));
  return neg ? -v : v;
}

/** 12500 → "12.500" (formato da API). */
export function milliToQty(m: number): string {
  const neg = m < 0;
  const a = Math.abs(m);
  return `${neg ? '-' : ''}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')}`;
}

/**
 * Custo unitário (4 casas, formato da API) a partir do total pago e da quantidade:
 * R$ 45,00 por 2,5 kg → "18.0000".
 */
export function unitCostFromTotal(totalCents: number, qtyMilli: number): string | null {
  if (qtyMilli <= 0 || totalCents < 0) return null;
  const n = Math.round((totalCents * 100_000) / qtyMilli); // décimos de milésimo de real
  return `${Math.floor(n / 10_000)}.${String(n % 10_000).padStart(4, '0')}`;
}

/** Custo por unidade com 2 a 4 casas ("1.8000" → "R$ 1,80"; "0.0350" → "R$ 0,035"). */
export function fmtCost(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/** Valor em R$ de uma quantidade (milésimos) a um custo unitário ("12.3456"), em centavos. */
export const valueCents = (qtyMilli: number, unitCost: string) =>
  Math.round((qtyMilli / 1000) * Number(unitCost) * 100);

/** Dias inteiros desde a data (0 = hoje). */
export const daysSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/** "hoje", "ontem", "há 5 dias", "nunca". */
export function agoLabel(iso: string | null): string {
  if (!iso) return 'nunca';
  const d = daysSince(iso);
  return d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`;
}

/** Quantos dias o saldo dura no consumo médio das vendas; null = sem consumo registrado. */
export function coverageDays(quantity: string, dailyUsage: string | null): number | null {
  if (!dailyUsage) return null;
  const daily = toMilli(dailyUsage);
  if (daily <= 0) return null;
  return Math.max(0, Math.floor(toMilli(quantity) / daily));
}
