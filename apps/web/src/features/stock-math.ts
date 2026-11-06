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

/** Linha da ficha com o saldo do insumo: quanto precisa, quanto tem e quantas unidades dá. */
export interface RecipeStockLine {
  stockItemId: string;
  name: string;
  unit: string;
  need: string;
  have: string;
  /** Unidades que este insumo sozinho ainda dá (null = pode ficar negativo ou venda por peso). */
  portions: number | null;
  short: boolean;
}

/** Quanto dá para vender de um item com o estoque de hoje, e o que falta. */
export interface RecipeStock {
  /** Unidades que ainda dá para vender; null = sem limite (sem ficha, por peso, negativo liberado). */
  portions: number | null;
  /** Nomes dos insumos que não dão para mais uma unidade: com algum, o item não vende. */
  missing: string[];
  lines: RecipeStockLine[];
}

/**
 * Mesma regra do servidor: o item trava quando algum insumo não dá para mais uma unidade.
 * Insumo que pode ficar negativo nunca trava; item por peso (ficha por kg) só trava se zerar.
 */
export function recipeStock(
  lines: { stockItemId: string; quantity: string | null }[],
  byId: Map<string, { name: string; unit: string; quantity: string; allowNegative: boolean }>,
  byWeight = false,
): RecipeStock {
  const out: RecipeStockLine[] = [];
  for (const l of lines) {
    const it = byId.get(l.stockItemId);
    if (!it || !l.quantity) continue;
    const need = toMilli(l.quantity);
    if (need <= 0) continue;
    const have = toMilli(it.quantity);
    const portions = it.allowNegative || byWeight ? null : Math.max(0, Math.floor(have / need));
    const short = !it.allowNegative && (byWeight ? have <= 0 : have < need);
    out.push({
      stockItemId: l.stockItemId,
      name: it.name,
      unit: it.unit,
      need: l.quantity,
      have: it.quantity,
      portions,
      short,
    });
  }
  const limits = out.map((l) => l.portions).filter((p): p is number => p !== null);
  return {
    portions: limits.length ? Math.min(...limits) : null,
    missing: out.filter((l) => l.short).map((l) => l.name),
    lines: out,
  };
}
