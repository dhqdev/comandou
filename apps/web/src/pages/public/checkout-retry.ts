import type { ApiError } from '../../lib/api';

/**
 * 422 "Este envio já foi registrado com outros dados": a mesma chave já virou pedido (a resposta
 * não voltou) e a sacola mudou antes de reenviar. Pelo `code` do servidor; o texto cobre servidor
 * antigo, que ainda não manda o `code`.
 */
export function isIdempotencyMismatch(err: Pick<ApiError, 'status' | 'message' | 'body'>): boolean {
  if (err.status !== 422) return false;
  const code = (err.body as { code?: unknown } | undefined)?.code;
  return code === 'idempotency_mismatch' || /já foi registrado com outros dados/i.test(err.message);
}
