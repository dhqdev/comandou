import { formatBRL, toCents } from '@comandou/shared';

/** Formata o valor decimal vindo da API ("12.90") sem passar por float. */
export const brl = (value: string) => formatBRL(toCents(value));

/**
 * Número digitado no padrão brasileiro com até `decimals` casas ("0,350", "12,3456"), em string com
 * ponto. Sem vírgula, um único ponto é a casa decimal quando vem "0." na frente ("0.350") ou quando
 * sobram 1 ou 2 dígitos depois dele ("1.5", "12.90": teclado que só mostra ponto); fora isso o ponto
 * separa milhar ("1.500" = 1500).
 */
export function parseDecimalInput(input: string, decimals: number, intDigits = 10): string | null {
  const raw = input.replace(/\s|R\$/g, '');
  const dotDecimal = /^\d+\.\d{1,2}$/.test(raw) || new RegExp(`^0\\.\\d{1,${decimals}}$`).test(raw);
  const clean = dotDecimal ? raw : raw.replace(/\./g, '').replace(',', '.');
  return new RegExp(`^\\d{1,${intDigits}}(\\.\\d{1,${decimals}})?$`).test(clean) ? clean : null;
}

/**
 * Aceita entrada no padrão brasileiro ("12,90" ou "1.234,50") e devolve "12.90". Sem vírgula, um
 * único ponto seguido de 1 ou 2 dígitos no fim é a casa decimal ("12.90", "0.5": teclado que só
 * mostra ponto); fora isso o ponto separa milhar ("1.234" = 1234).
 */
export function parseBrlInput(input: string): string | null {
  const raw = input.replace(/\s|R\$/g, '');
  const clean = /^\d+\.\d{1,2}$/.test(raw) ? raw : raw.replace(/\./g, '').replace(',', '.');
  return /^\d{1,12}(\.\d{1,2})?$/.test(clean) ? clean : null;
}
