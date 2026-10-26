/**
 * Precificação por markup divisor. Todos os percentuais são sobre o PREÇO de venda:
 *  - impostos (ex.: Simples Nacional), taxas (maquininha, app de entrega), despesas fixas
 *    (aluguel, folha… como % do faturamento) e o lucro desejado;
 *  - preço sugerido = custo ÷ (1 − soma dos percentuais);
 *  - markup multiplicador = 1 ÷ (1 − soma), ou seja, preço sugerido = custo × markup.
 * Valores em centavos (podem ter fração: o custo da ficha tem 4 casas). Só para exibição e
 * simulação; o preço gravado continua sendo um valor monetário exato.
 */
export interface PricingParams {
  taxPercent: number;
  feePercent: number;
  fixedPercent: number;
  targetMargin: number;
}

export type PricingStatus = 'ok' | 'below' | 'loss' | 'no-recipe';

export interface PricingAnalysis {
  /** Custo dos insumos ÷ preço (CMV), em %. */
  cmvPercent: number | null;
  /** Preço ÷ custo (quantas vezes o custo). */
  markup: number | null;
  /** Preço − insumos − impostos − taxas, por unidade. */
  contributionCents: number;
  contributionPercent: number | null;
  /** Margem de contribuição − despesas fixas, por unidade. */
  netCents: number;
  netPercent: number | null;
  suggestedCents: number | null;
  /** Sugerido arredondado para cima terminando em ,90. */
  suggestedRoundCents: number | null;
  status: PricingStatus;
}

/** Soma dos percentuais que saem do preço (sem o custo dos insumos). */
export const deductions = (p: PricingParams) =>
  p.taxPercent + p.feePercent + p.fixedPercent + p.targetMargin;

/** Multiplicador sobre o custo; null se os percentuais não deixam espaço para o custo. */
export function markupFactor(p: PricingParams): number | null {
  const rest = 1 - deductions(p) / 100;
  return rest > 0 ? 1 / rest : null;
}

/** Arredonda para cima para o próximo valor terminado em ,90 (23,42 → 23,90; 23,95 → 24,90). */
export function roundTo90(cents: number): number {
  return Math.ceil((cents + 10) / 100) * 100 - 10;
}

export function analyzePrice(
  priceCents: number,
  costCents: number | null,
  p: PricingParams,
): PricingAnalysis {
  const cost = costCents ?? 0;
  const variable = (priceCents * (p.taxPercent + p.feePercent)) / 100;
  const contributionCents = priceCents - cost - variable;
  const netCents = contributionCents - (priceCents * p.fixedPercent) / 100;
  const pct = (v: number) => (priceCents > 0 ? (v / priceCents) * 100 : null);
  const factor = markupFactor(p);
  const suggestedCents = costCents !== null && factor !== null ? costCents * factor : null;
  const suggestedRoundCents = suggestedCents !== null ? roundTo90(suggestedCents) : null;
  let status: PricingStatus = 'ok';
  if (costCents === null) status = 'no-recipe';
  else if (netCents < 0) status = 'loss';
  else if (suggestedCents !== null && priceCents < suggestedCents * 0.98) status = 'below';
  return {
    cmvPercent: costCents !== null ? pct(cost) : null,
    markup: costCents !== null && cost > 0 ? priceCents / cost : null,
    contributionCents,
    contributionPercent: pct(contributionCents),
    netCents,
    netPercent: pct(netCents),
    suggestedCents,
    suggestedRoundCents,
    status,
  };
}

/** "8.0000" (reais, até 4 casas) → centavos com fração. */
export const costToCents = (v: string | null) => (v === null ? null : Number(v) * 100);

export const fmtPct = (v: number | null, digits = 1) =>
  v === null || !Number.isFinite(v)
    ? '—'
    : `${v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

export const fmtFactor = (v: number | null) =>
  v === null || !Number.isFinite(v)
    ? '—'
    : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
