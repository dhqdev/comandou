import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/** Compara o "Authorization: Bearer <token>" em tempo constante. Sem token configurado, recusa. */
export function bearerMatches(req: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const got = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1] ?? '';
  const h = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(h(got), h(expected));
}
