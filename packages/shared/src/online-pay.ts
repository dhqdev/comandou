/**
 * Pagamento pelo app (PagBank com split): a taxa da Comandou sobre cada pagamento e os nomes que
 * as telas mostram. Regras em docs/pagamento-online.md.
 */
import { toCents } from './money';

/** Forma de pagar pelo app. */
export type OnlinePayMethod = 'card' | 'pix';

/** Situação da cobrança no Comandou (online_charges.status). */
export type OnlineChargeStatus =
  'pending' | 'paid' | 'declined' | 'expired' | 'refund_due' | 'refunded';

export const ONLINE_CHARGE_LABELS: Record<OnlineChargeStatus, string> = {
  pending: 'Esperando o pagamento',
  paid: 'Pago pelo app',
  declined: 'Recusado',
  expired: 'Não pago',
  refund_due: 'A devolver',
  refunded: 'Devolvido',
};

export const ONLINE_PAY_LABELS: Record<OnlinePayMethod, string> = {
  card: 'Cartão de crédito pelo app',
  pix: 'Pix pelo app',
};

/** Tentativas de cartão por pedido (recusou 3 vezes: o cliente fala com a loja). */
export const MAX_CARD_ATTEMPTS = 3;
/** Pedido pago pelo app sem pagamento depois disso é cancelado sozinho (o Pix vence junto). */
export const ONLINE_PAY_WINDOW_MINUTES = 20;
/**
 * Conta da mesa pelo app: o QR Code do Pix vale isso. Enquanto ele espera, ninguém cobra a
 * comanda de outro jeito; menos tempo trava menos a mesa se o cliente desistir.
 */
export const TABLE_PAY_PIX_MINUTES = 10;
/** Teto da taxa da Comandou: nunca mais que metade do pagamento. */
export const MAX_FEE_SHARE = 0.5;

/** "1.50" (%) → 150 pontos-base. Aceita 0 a 20%, com até 2 casas. */
export function feePercentToBps(percent: string): number {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(percent)) throw new Error(`Percentual inválido: ${percent}`);
  const bps = toCents(percent);
  if (bps > 2000) throw new Error('Taxa acima de 20%');
  return bps;
}

/** Divide com arredondamento metade-para-o-par (inteiros não negativos). */
function divHalfEven(n: number, d: number): number {
  const q = Math.floor(n / d);
  const r = n - q * d;
  if (r * 2 > d || (r * 2 === d && q % 2 === 1)) return q + 1;
  return q;
}

/**
 * Taxa da Comandou em centavos: percentual do total (metade para o par) mais o fixo, limitada a
 * metade do pagamento. Zero quer dizer "sem split" (o pagamento vai inteiro para o restaurante).
 */
export function platformFeeCents(totalCents: number, percent: string, fixedCents: number): number {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return 0;
  if (!Number.isSafeInteger(fixedCents) || fixedCents < 0) throw new Error('Fixo inválido');
  const fee = divHalfEven(totalCents * feePercentToBps(percent), 10_000) + fixedCents;
  return Math.min(fee, Math.floor(totalCents * MAX_FEE_SHARE));
}

/** Partes do split: restaurante e Comandou (somam o total). */
export function splitParts(totalCents: number, feeCents: number) {
  return { restaurant: totalCents - feeCents, platform: feeCents };
}
