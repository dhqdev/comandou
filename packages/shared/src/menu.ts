/**
 * Cardápio: regras de cobrança dos grupos de complementos e tipo de cardápio por canal.
 * Usado pelo servidor (preço oficial) e pelas telas (preço de exibição), para os dois baterem.
 */
import { toCents } from './money';

/** sum = soma as opções; max = cobra só a mais cara; average = média das escolhidas (pizza meio a meio). */
export type ChargeRule = 'sum' | 'max' | 'average';
export type OptionGroupKind = 'additional' | 'variation' | 'flavor' | 'remove';
export type MenuKind = 'principal' | 'delivery';

/** O Principal vale no balcão e no salão; o Delivery, na entrega e na retirada. */
export function menuKindOf(channel: string): MenuKind {
  return channel === 'delivery' || channel === 'pickup' ? 'delivery' : 'principal';
}

/**
 * Quanto cada opção escolhida de UM grupo cobra, de modo que a soma seja o valor do grupo.
 * max: a mais cara cobra tudo, as outras zero. average: a média dividida entre as escolhidas
 * (a última leva o centavo que sobrar; média arredonda para cima, a favor da loja).
 */
export function groupOptionCharges(rule: ChargeRule | undefined, deltas: number[]): number[] {
  if (!deltas.length || !rule || rule === 'sum') return [...deltas];
  if (rule === 'max') {
    const top = deltas.indexOf(Math.max(...deltas));
    return deltas.map((d, i) => (i === top ? d : 0));
  }
  const avg = Math.ceil(deltas.reduce((a, b) => a + b, 0) / deltas.length);
  const each = Math.floor(avg / deltas.length);
  return deltas.map((_, i) => (i === deltas.length - 1 ? avg - each * (deltas.length - 1) : each));
}

interface PricedGroup {
  id: string;
  charge?: ChargeRule;
  options: { id: string; priceDelta: string }[];
}

/** Valor dos complementos escolhidos (centavos), respeitando a regra de cobrança de cada grupo. */
export function optionsTotalCents(groups: PricedGroup[], optionIds: string[]): number {
  let total = 0;
  for (const g of groups) {
    const deltas = g.options
      .filter((o) => optionIds.includes(o.id))
      .map((o) => toCents(o.priceDelta));
    total += groupOptionCharges(g.charge, deltas).reduce((a, b) => a + b, 0);
  }
  return total;
}

/** Opções marcadas como padrão, respeitando o máximo de cada grupo. */
export function defaultOptionIds(
  groups: { maxSelect: number; options: { id: string; isDefault?: boolean }[] }[],
): string[] {
  return groups.flatMap((g) =>
    g.options
      .filter((o) => o.isDefault)
      .slice(0, g.maxSelect)
      .map((o) => o.id),
  );
}
