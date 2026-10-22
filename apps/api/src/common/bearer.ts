import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/** Compara o "Authorization: Bearer <token>" em tempo constante. Sem token configurado, recusa. */
export function bearerMatches(req: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const got = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1] ?? '';
  return sameSecret(got, expected);
}

/**
 * Como bearerMatches, mas também aceita `?token=<token>` na URL. Existe porque o Traefik 2.x não
 * consegue enviar cabeçalhos ao provider HTTP. O token vai mascarado nos logs (maskSecretsInUrl).
 */
export function bearerOrQueryMatches(req: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  if (bearerMatches(req, expected)) return true;
  const q = req.query['token'];
  return typeof q === 'string' && sameSecret(q, expected);
}

function sameSecret(got: string, expected: string): boolean {
  const h = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(h(got), h(expected));
}
