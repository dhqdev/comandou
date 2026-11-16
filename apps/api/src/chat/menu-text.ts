import type { ImportedCategory, ImportedItem } from './menu-import.service';

const MAX_ITEMS = 300;
/** Preço no fim da linha: "28,90", "R$ 12", "7.5", "10 reais" (com ou sem traço antes). */
const PRICE = /^(.*?)[\s\-–—:=.…]*(?:R\$\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:reais)?$/i;
/** Marcador de lista no começo da linha: "-", "•", "*", "1.", "2)". */
const BULLET = /^(?:[-•*·–—]+|\d{1,2}[.)])\s+/;

function price(raw: string): string {
  const [int, dec = ''] = raw.replace('.', ',').split(',');
  return `${Number(int)}.${dec.padEnd(2, '0')}`;
}

function item(line: string): { name: string; description: string | null; price: string | null } {
  const m = PRICE.exec(line);
  const text = m && m[1]!.trim() ? m[1]!.trim() : line;
  // "Lasanha - bolonhesa e queijo 42": o que vem depois do traço é a descrição.
  const [name, ...rest] = text.split(/\s[-–—]\s|\s\(/);
  const description = rest.join(' - ').replace(/\)$/, '').trim();
  return {
    name: name!.trim().slice(0, 120),
    description: description ? description.slice(0, 500) : null,
    price: m && m[1]!.trim() ? price(m[2]!) : null,
  };
}

/**
 * Cardápio escrito pela pessoa, lido sem IA: um item por linha com o preço no fim ("X-Burger
 * 28,90", "Pastel de carne - R$ 12"). Linha sem preço que termina em dois-pontos, está toda em
 * maiúsculas ou abre um bloco (começo do texto ou depois de linha em branco) seguido de itens
 * com preço vira categoria. Serve para os primeiros passos quando a IA está desligada: o que a
 * pessoa digitou no site chega ao restaurante do mesmo jeito.
 */
export function parseMenuText(text: string): ImportedCategory[] {
  const raw = text.includes('\n') ? text.split(/\r?\n/) : text.split(';');
  const lines = raw.map((l) => l.replace(BULLET, '').replace(/\s+/g, ' ').trim());
  const out: ImportedCategory[] = [];
  let current: ImportedCategory | null = null;
  let total = 0;
  const hasPrice = (l: string | undefined) => !!l && !!PRICE.exec(l)?.[1]?.trim();
  const nextFilled = (i: number) => lines.slice(i + 1).find((l) => l.length > 0);
  const category = (name: string) => {
    const same = out.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (same) return same;
    const c: ImportedCategory = { name, items: [] };
    out.push(c);
    return c;
  };

  for (let i = 0; i < lines.length && total < MAX_ITEMS; i++) {
    const l = lines[i]!;
    if (l.length < 2) continue;
    if (!hasPrice(l)) {
      const opensBlock = i === 0 || !lines[i - 1];
      const letters = l.replace(/[^\p{L}]/gu, '');
      const header =
        l.endsWith(':') ||
        (letters.length >= 3 && letters === letters.toUpperCase() && !/\d/.test(l)) ||
        (opensBlock && l.length <= 40 && hasPrice(nextFilled(i)));
      if (header) {
        current = category(l.replace(/:+$/, '').trim().slice(0, 60) || 'Cardápio');
        continue;
      }
    }
    const it: ImportedItem = item(l);
    if (!it.name) continue;
    current ??= category('Cardápio');
    current.items.push(it);
    total++;
  }
  return out.filter((c) => c.items.length > 0);
}
