/**
 * Venda por peso (sorveteria, restaurante por quilo, açougue): o preço do item é por kg e a
 * quantidade do item no pedido é o peso em kg, com até 3 casas (gramas). Tudo em gramas inteiras
 * para não errar com ponto flutuante.
 */

export type ItemUnit = 'un' | 'kg';

/** Maior peso de um item num pedido da equipe (kg). */
export const WEIGHT_MAX_KG = 999;
/** No cardápio online o cliente escolhe o peso de 50 em 50 g, de 100 g a 5 kg. */
export const ONLINE_WEIGHT_STEP_G = 50;
export const ONLINE_WEIGHT_MIN_G = 100;
export const ONLINE_WEIGHT_MAX_G = 5000;

/** kg → gramas inteiras (0.35 → 350). */
export const kgToGrams = (kg: number | string): number => Math.round(Number(kg) * 1000);

/**
 * Lê o peso digitado na balança ou à mão. Aceita kg ("0,350", "1.2", "1,250 kg") ou gramas
 * ("350 g", "350g"). Número inteiro sem unidade e maior que 30 vira gramas ("350" → 350 g),
 * porque ninguém vende 350 kg de sorvete. Devolve gramas, ou null se não der para ler.
 */
export function parseWeightGrams(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,6}(?:[.,]\d{1,3})?)(kg|g)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] ?? (Number.isInteger(n) && n > 30 && !/[.,]/.test(m[1]!) ? 'g' : 'kg');
  const grams = unit === 'g' ? Math.round(n) : Math.round(n * 1000);
  return grams > 0 && grams <= WEIGHT_MAX_KG * 1000 ? grams : null;
}

/** 350 → "350 g"; 1250 → "1,250 kg". */
export function formatGrams(grams: number): string {
  if (grams < 1000) return `${grams} g`;
  return `${(grams / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
}

/** Peso líquido: o lido na balança menos a tara (pote, prato). Nunca negativo. */
export function netGrams(grossGrams: number, tareKg: number | string | null | undefined): number {
  return Math.max(0, grossGrams - kgToGrams(tareKg ?? 0));
}

/** Quantidade do item para mostrar: "2×" para unidade, "0,350 kg" para peso. */
export function qtyLabel(quantity: number | string, unit?: ItemUnit | string | null): string {
  const n = Number(quantity);
  if (unit === 'kg') return formatGrams(kgToGrams(n));
  const txt = Number.isInteger(n)
    ? String(n)
    : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return `${txt}×`;
}

/** Item vendido por peso no cupom (sem acento, até 3 casas): "0,350kg". */
export function qtyTicket(quantity: number | string, unit?: ItemUnit | string | null): string {
  const n = Number(quantity);
  if (unit === 'kg')
    return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}kg`;
  return `${Number.isInteger(n) ? n : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}x`;
}

/** Peso válido para o pedido: positivo, até 3 casas. */
export function isValidKg(q: number, maxKg = WEIGHT_MAX_KG): boolean {
  return q > 0 && q <= maxKg && Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6;
}
