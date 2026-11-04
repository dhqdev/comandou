/**
 * Cardápio: regras de cobrança dos grupos de complementos e tipo de cardápio por canal.
 * Usado pelo servidor (preço oficial) e pelas telas (preço de exibição), para os dois baterem.
 */
import { toCents } from './money';

/** sum = soma as opções; max = cobra só a mais cara; average = média das escolhidas (pizza meio a meio). */
export type ChargeRule = 'sum' | 'max' | 'average';
export type OptionGroupKind = 'additional' | 'variation' | 'flavor' | 'remove';
/** ifood = cardápio de integração: não vale em canal nenhum do Comandou, vai para o iFood. */
export type MenuKind = 'principal' | 'delivery' | 'ifood';

/** O Principal vale no balcão e no salão; o Delivery, na entrega e na retirada. */
export function menuKindOf(channel: string): Exclude<MenuKind, 'ifood'> {
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

/**
 * Reajuste de preços em massa ("Reajustar preços" do cardápio).
 * none = só o percentual; x90/x99 = termina em ,90/,99; x50 = termina em ,00 ou ,50; x00 = inteiro.
 */
export type PriceRounding = 'none' | 'x90' | 'x99' | 'x50' | 'x00';
export const PRICE_ROUNDINGS: readonly PriceRounding[] = ['none', 'x90', 'x99', 'x50', 'x00'];

/** Limites do percentual aceito (-90% a +300%). */
export const PRICE_ADJUST_MIN = -90;
export const PRICE_ADJUST_MAX = 300;

/**
 * Novo preço (centavos) depois do percentual e do arredondamento.
 * Aumento arredonda para cima, redução para baixo e só arredondar vai para o final mais próximo,
 * então um aumento nunca baixa o preço (e vice-versa). Sem preço (0) continua sem preço.
 */
export function adjustPriceCents(cents: number, percent: number, rounding: PriceRounding): number {
  if (!Number.isSafeInteger(cents) || cents <= 0) return cents;
  const basis = Math.round(percent * 100);
  const raw = Math.round((cents * (10_000 + basis)) / 10_000);
  if (rounding === 'none') return Math.max(raw, 1);
  const step = rounding === 'x50' ? 50 : 100;
  const end = rounding === 'x90' ? 90 : rounding === 'x99' ? 99 : 0;
  const first = end || step; // menor preço possível com esse final
  const k = (raw - end) / step;
  const pick = basis > 0 ? Math.ceil(k) : basis < 0 ? Math.floor(k) : Math.round(k);
  return Math.max(pick * step + end, first);
}
