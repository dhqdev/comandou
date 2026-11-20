import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { isIdempotencyMismatch } from './checkout-retry';

describe('pedido reenviado com a sacola mudada', () => {
  it('reconhece pelo code do servidor', () => {
    const err = new ApiError(422, 'qualquer texto', { code: 'idempotency_mismatch' });
    expect(isIdempotencyMismatch(err)).toBe(true);
  });

  it('reconhece pelo texto (servidor sem o code)', () => {
    const msg =
      'Este envio já foi registrado com outros dados. Atualize a tela e confira antes de enviar de novo.';
    expect(isIdempotencyMismatch(new ApiError(422, msg, { message: msg }))).toBe(true);
  });

  it('outros erros seguem como antes (o próximo envio é um pedido novo)', () => {
    expect(isIdempotencyMismatch(new ApiError(422, 'Produto fora do cardápio'))).toBe(false);
    expect(isIdempotencyMismatch(new ApiError(409, 'x', { code: 'idempotency_mismatch' }))).toBe(
      false,
    );
    expect(isIdempotencyMismatch(new ApiError(0, 'Sem conexão'))).toBe(false);
  });
});
