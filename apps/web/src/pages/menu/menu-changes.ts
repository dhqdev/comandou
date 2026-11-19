import { toCents } from '@comandou/shared';
import { brl, parseBrlInput } from '../../lib/money';

/** Linha do cardápio na tela: no cardápio ou não, e o preço próprio digitado ("" = do item). */
export interface MenuRow {
  on: boolean;
  price: string;
}

/** O que é gravado: nome e linhas. Serve de "última versão salva" no salvamento automático. */
export interface MenuSnapshot {
  name: string;
  rows: Record<string, MenuRow>;
}

interface ProductRef {
  id: string;
  name: string;
  price: string;
}

/** Preço próprio em centavos (null = usa o preço do item ou está inválido). */
const cents = (v: string) => {
  const p = v ? parseBrlInput(v) : null;
  return p ? toCents(p) : null;
};

/** Mesma linha para o servidor (14,9 e 14,90 são o mesmo preço). */
const sameRow = (a: MenuRow | undefined, b: MenuRow | undefined) =>
  !!a?.on === !!b?.on && (!a?.on || cents(a.price) === cents(b?.price ?? ''));

export function itemsChanged(before: MenuSnapshot, after: MenuSnapshot) {
  const ids = new Set([...Object.keys(before.rows), ...Object.keys(after.rows)]);
  for (const id of ids) if (!sameRow(before.rows[id], after.rows[id])) return true;
  return false;
}

export const nameChanged = (before: MenuSnapshot, after: MenuSnapshot) =>
  !!after.name.trim() && after.name.trim() !== before.name.trim();

/** Itens ligados com preço que não dá para ler (ex.: "12,,9"): não salva até corrigir. */
export function invalidPrices(snap: MenuSnapshot, products: ProductRef[]) {
  return products.filter((p) => {
    const r = snap.rows[p.id];
    return !!r?.on && !!r.price && !parseBrlInput(r.price);
  });
}

/** "Chopp", "Chopp e IPA" ou "5 itens". */
function names(list: ProductRef[]) {
  if (list.length > 2) return `${list.length} itens`;
  return list.map((p) => p.name).join(' e ');
}

/**
 * O que mudou entre a última versão salva e a nova, em frases curtas para o aviso
 * pequeno do salvamento automático. Muitos itens de uma vez viram uma contagem.
 */
export function describeMenuChanges(
  before: MenuSnapshot,
  after: MenuSnapshot,
  products: ProductRef[],
): string[] {
  const lines: string[] = [];
  if (nameChanged(before, after)) lines.push(`Nome do cardápio: ${after.name.trim()}`);
  const entered: ProductRef[] = [];
  const left: ProductRef[] = [];
  const priced: { p: ProductRef; price: string }[] = [];
  for (const p of products) {
    const a = before.rows[p.id];
    const b = after.rows[p.id];
    if (sameRow(a, b)) continue;
    if (b?.on && !a?.on) entered.push(p);
    else if (!b?.on && a?.on) left.push(p);
    else if (b?.on) priced.push({ p, price: b.price });
  }
  const many = (n: number, one: string, more: string) => (n === 1 ? one : more);
  if (entered.length)
    lines.push(`${names(entered)} ${many(entered.length, 'entrou', 'entraram')} no cardápio`);
  if (left.length) lines.push(`${names(left)} ${many(left.length, 'saiu', 'saíram')} do cardápio`);
  if (priced.length > 2) lines.push(`Preço de ${priced.length} itens alterado`);
  else
    for (const { p, price } of priced) {
      const parsed = price ? parseBrlInput(price) : null;
      lines.push(
        parsed
          ? `${p.name}: ${brl(parsed)}`
          : `${p.name}: volta ao preço do item (${brl(p.price)})`,
      );
    }
  return lines;
}
