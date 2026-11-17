import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { hashToken } from './session.service';

/**
 * Regras do código de nova senha (equipe do restaurante e Super Admin): 6 números, vale 15
 * minutos, aceita 5 tentativas, no máximo 5 pedidos por hora para a mesma conta. Código certo
 * vira um token de uso único (30 minutos) para a tela da senha nova.
 */
export const RESET_CODE_MINUTES = 15;
export const RESET_CODE_ATTEMPTS = 5;
export const RESET_CODES_PER_HOUR = 5;
export const RESET_TOKEN_MINUTES = 30;

export const newResetCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const newResetToken = () => randomBytes(32).toString('base64url');

/** Hash do código preso à conta: o mesmo código de outra pessoa não confere. */
export const resetCodeHash = (scope: 'staff' | 'platform', id: string, code: string) =>
  hashToken(`password-reset:${scope}:${id}:${code}`);

export const sameHash = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/** Só os números (o código pode vir colado com espaço ou traço). */
export const cleanCode = (raw: string) => raw.replace(/\D/g, '');

/** Por aparelho (IP), por minuto: pedir o código segue o limite do login (5; maior nos testes). */
const loginLimit = (ctx: ExecutionContext) =>
  (ctx.switchToHttp().getRequest<Request>().app.locals.loginRateLimit as number | undefined) ?? 5;
export const RESET_REQUEST_LIMIT = (ctx: ExecutionContext) => loginLimit(ctx);
/** Conferir o código e gravar a senha: o dobro (quem erra um número tenta de novo). */
export const RESET_STEP_LIMIT = (ctx: ExecutionContext) => loginLimit(ctx) * 2;
