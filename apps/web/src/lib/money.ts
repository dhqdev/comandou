import { formatBRL, toCents } from '@comandou/shared';

/** Formata o valor decimal vindo da API ("12.90") sem passar por float. */
export const brl = (value: string) => formatBRL(toCents(value));

/** Aceita entrada no padrão brasileiro ("12,90" ou "1.234,50") e devolve "12.90". */
export function parseBrlInput(input: string): string | null {
  const clean = input
    .replace(/\s|R\$/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return /^\d{1,12}(\.\d{1,2})?$/.test(clean) ? clean : null;
}
