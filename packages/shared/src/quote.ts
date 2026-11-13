/**
 * Orçamento e custo da nota fiscal (Focus NFe) repassado ao cliente. As mesmas contas e frases
 * aparecem na tela de orçamento do Super Admin, no PDF do orçamento e no contrato.
 */

/** 'passthrough' = custo da nota cobrado à parte; 'included' = dentro da mensalidade. */
export type FiscalCostMode = 'passthrough' | 'included';

export interface FiscalCosts {
  mode: FiscalCostMode;
  /** Mensalidade da nota por CNPJ emissor ("62.90"). */
  monthly: string;
  nfceIncluded: number;
  nfeIncluded: number;
  /** Preço por nota acima do pacote, com até 3 casas ("0.055"). */
  nfceExtra: string;
  nfeExtra: string;
}

/** Preço público do plano Retail da Focus NFe (nov/2026): o restaurante paga o mesmo que pagaria lá. */
export const FOCUS_RETAIL_DEFAULTS: FiscalCosts = {
  mode: 'passthrough',
  monthly: '62.90',
  nfceIncluded: 500,
  nfeIncluded: 100,
  nfceExtra: '0.055',
  nfeExtra: '0.16',
};

/** "0.055" em milésimos de real (55), sem erro de ponto flutuante. */
function mills(v: string): number {
  const [i, f = ''] = String(v).split('.');
  return Number(i) * 1000 + Number(f.padEnd(3, '0').slice(0, 3));
}

/** R$ com 2 casas, ou 3 quando o valor tem milésimos (R$ 0,055). */
export function formatUnitBRL(v: string): string {
  const m = mills(v);
  const digits = m % 10 === 0 ? 2 : 3;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(m / 1000);
}

const n = (v: number) => v.toLocaleString('pt-BR');

export interface FiscalEstimate {
  /** Centavos por mês: pacote + notas acima do pacote (o que o cliente paga à parte, ou 0). */
  totalCents: number;
  packageCents: number;
  nfceExtraCount: number;
  nfeExtraCount: number;
  extraCents: number;
}

/**
 * Custo estimado da nota fiscal num mês com `nfce` NFC-e e `nfe` NF-e. No modo 'included' o
 * pacote já está na mensalidade: só o que passa dele é cobrado.
 */
export function fiscalEstimate(c: FiscalCosts, nfce: number, nfe: number): FiscalEstimate {
  const nfceExtraCount = Math.max(0, Math.floor(nfce) - c.nfceIncluded);
  const nfeExtraCount = Math.max(0, Math.floor(nfe) - c.nfeIncluded);
  // Milésimos somados primeiro, arredondados para centavos uma vez só.
  const extraCents = Math.round(
    (nfceExtraCount * mills(c.nfceExtra) + nfeExtraCount * mills(c.nfeExtra)) / 10,
  );
  const packageCents = c.mode === 'included' ? 0 : Math.round(mills(c.monthly) / 10);
  return {
    totalCents: packageCents + extraCents,
    packageCents,
    nfceExtraCount,
    nfeExtraCount,
    extraCents,
  };
}

/** Pacote da nota em uma frase: "até 500 NFC-e e 100 NF-e por mês". */
export function fiscalPackageText(c: FiscalCosts): string {
  return `até ${n(c.nfceIncluded)} NFC-e e ${n(c.nfeIncluded)} NF-e por mês`;
}

/** Excedente em uma frase: "R$ 0,055 por NFC-e e R$ 0,16 por NF-e". */
export function fiscalExtraText(c: FiscalCosts): string {
  return `${formatUnitBRL(c.nfceExtra)} por NFC-e e ${formatUnitBRL(c.nfeExtra)} por NF-e`;
}

/**
 * Parágrafo do contrato e do orçamento sobre quanto custa a nota fiscal emitida pela Focus NFe.
 */
export function fiscalCostClause(c: FiscalCosts): string {
  if (c.mode === 'included')
    return `O custo do provedor de nota fiscal (Focus NFe) está incluído na mensalidade para ${fiscalPackageText(c)}, por CNPJ emissor. Acima disso, cada documento é cobrado pelo valor de custo do provedor: ${fiscalExtraText(c)}, somados no mês e cobrados junto com a mensalidade seguinte ou em cobrança à parte, com o extrato das notas emitidas.`;
  return `O custo do provedor de nota fiscal (Focus NFe) não está na mensalidade e é repassado à CONTRATANTE pelo valor de custo, somente nos meses em que a emissão estiver ligada: ${formatUnitBRL(c.monthly)} por mês por CNPJ emissor, com ${fiscalPackageText(c)} incluídas; acima disso, ${fiscalExtraText(c)}. O valor é cobrado junto com a mensalidade seguinte ou em cobrança à parte, com o extrato das notas emitidas no mês. Mudança de preço do provedor é avisada com 30 (trinta) dias de antecedência.`;
}
