import type { ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SESSION_COOKIE } from '../auth/session.service';
import { PUBLIC, SKIP_TENANT } from './decorators';

/** Formato do token de sessão da equipe (32 bytes em base64url). */
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Teto por IP, acima do limite por pessoa: vale para todo o restaurante atrás do mesmo Wi-Fi. */
export const IP_LIMIT_FACTOR = 5;

function flag(context: ExecutionContext, key: string): boolean {
  return Boolean(
    Reflect.getMetadata(key, context.getHandler()) || Reflect.getMetadata(key, context.getClass()),
  );
}

export function clientIp(req: Record<string, any>): string {
  return (req.ips?.length ? req.ips[0] : req.ip) ?? '';
}

/**
 * Quem conta para o limite por minuto. Rotas da equipe contam por SESSÃO: todos os aparelhos de
 * um restaurante saem pelo mesmo IP do Wi-Fi, e contar por IP fazia o PDV, a cozinha e os
 * garçons dividirem a mesma cota (em horário de pico a tela parava de atualizar com 429).
 * Rotas públicas (login, cardápio, painel) continuam contando por IP; o throttler "ip" mantém um
 * teto por IP para quem tentar trocar de cookie a cada requisição.
 */
export function sessionOrIpTracker(req: Record<string, any>, context: ExecutionContext): string {
  const sid = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
  if (
    typeof sid === 'string' &&
    SESSION_TOKEN_RE.test(sid) &&
    !flag(context, PUBLIC) &&
    !flag(context, SKIP_TENANT)
  )
    return `s:${createHash('sha256').update(sid).digest('base64url').slice(0, 32)}`;
  return clientIp(req);
}

/** O throttler "ip" respeita o @SkipThrottle() das rotas (health, métricas, Traefik). */
export function skipsDefault(context: ExecutionContext): boolean {
  return flag(context, 'THROTTLER:SKIPdefault');
}
