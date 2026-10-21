/**
 * Dinheiro: o banco guarda NUMERIC(14,2) e a API trafega strings decimais ("12.90").
 * Em memória usamos centavos inteiros (BigInt-safe para valores de restaurante),
 * nunca ponto flutuante binário. Moeda padrão: BRL. Arredondamento: half-even
 * (bancário) apenas quando uma operação gerar frações de centavo.
 */
export const DEFAULT_CURRENCY = 'BRL';

const DECIMAL_RE = /^-?\d{1,12}(\.\d{1,2})?$/;

export function isMoneyString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/** Converte "12.9" | "12.90" | "-3" em centavos inteiros. Lança erro em formato inválido. */
export function toCents(value: string): number {
  if (!isMoneyString(value)) throw new Error(`Valor monetário inválido: ${value}`);
  const negative = value.startsWith('-');
  const [int, frac = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** Converte centavos inteiros em string decimal com 2 casas ("1290" -> "12.90"). */
export function fromCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Centavos devem ser inteiros seguros');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${s}` : s;
}

/** Multiplica um valor em centavos por uma quantidade decimal com arredondamento half-even. */
export function multiplyCents(cents: number, quantity: number, quantityScale = 1000): number {
  const q = Math.round(quantity * quantityScale);
  const raw = cents * q;
  const quotient = Math.trunc(raw / quantityScale);
  const remainder = Math.abs(raw % quantityScale);
  const half = quantityScale / 2;
  if (remainder > half || (remainder === half && Math.abs(quotient) % 2 === 1)) {
    return quotient + Math.sign(raw);
  }
  return quotient;
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
