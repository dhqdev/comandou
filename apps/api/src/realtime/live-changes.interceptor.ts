import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { LiveArea, RealtimeService } from './realtime.service';

/**
 * Telas que não têm evento próprio: qualquer gravação da equipe nestas rotas avisa as outras
 * telas abertas do restaurante ("algo mudou nesta área"), que buscam de novo pela API.
 * `personal` = só as abas e aparelhos de quem gravou (a agenda é de cada pessoa).
 */
const AREAS = new Map<string, { area: LiveArea; personal?: boolean }>(
  Object.entries({
    finance: { area: 'finance' },
    customers: { area: 'customers' },
    loyalty: { area: 'customers' },
    birthdays: { area: 'customers' },
    users: { area: 'team' },
    waiters: { area: 'team' },
    // Pagamento da equipe lança no Financeiro: avisa a tela Financeiro (a Equipe ouve as duas).
    'staff-pay': { area: 'finance' },
    agenda: { area: 'agenda', personal: true },
  } satisfies Record<string, { area: LiveArea; personal?: boolean }>),
);

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Área avisada por uma gravação (`null` = leitura ou rota sem aviso genérico). */
export function liveAreaOf(
  method: string,
  path: string,
): { area: LiveArea; personal?: boolean } | null {
  if (!MUTATIONS.has(method.toUpperCase())) return null;
  const m = /^\/api\/v\d+\/([a-z-]+)(?:\/|$)/.exec(path);
  return (m && AREAS.get(m[1]!)) ?? null;
}

/** Publica o aviso só depois da resposta dar certo (a gravação já foi confirmada). */
@Injectable()
export class LiveChangesInterceptor implements NestInterceptor {
  constructor(private readonly realtime: RealtimeService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const hit = liveAreaOf(req.method, req.path);
    if (!hit || !req.tenant || !req.user?.id) return next.handle();
    const tenantId = req.tenant.id;
    const userId = req.user.id;
    return next.handle().pipe(
      tap(() => {
        const event = { type: 'data.changed' as const, area: hit.area };
        if (hit.personal) this.realtime.publishToUsers(tenantId, [userId], event);
        else this.realtime.publish(tenantId, event);
      }),
    );
  }
}
