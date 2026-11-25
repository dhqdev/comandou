import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { catchError, from, mergeMap, Observable, of, switchMap, throwError } from 'rxjs';
import { DatabaseService } from '../database/database.service';
import { IDEMPOTENCY_MISMATCH, validIdempotencyKey } from './idempotency';
import { one } from './sql';

/** Cabeçalho que o app manda em cada gravação que pode ir para a fila offline. */
export const OP_HEADER = 'x-comandou-op';

/** Mesmo envio chegando enquanto o primeiro ainda grava (a fila tenta de novo). */
export const OP_BUSY = 'op_in_progress';

/**
 * Gravação reenviada pela fila offline do app (apps/web/src/lib/offline.ts) não se repete.
 *
 * Sem internet, o app guarda a gravação no aparelho e a reenvia quando a conexão volta. Se a
 * primeira tentativa chegou a gravar e só a resposta se perdeu, o reenvio leva a mesma chave
 * `X-Comandou-Op`: aqui a resposta guardada volta sem executar de novo.
 *
 * Vale para qualquer rota de restaurante com sessão. As rotas de dinheiro continuam com a própria
 * `Idempotency-Key` (common/idempotency.ts), que roda na mesma transação da operação; esta guarda
 * a resposta logo depois, em escopo próprio (`op:<método> <caminho>`), na mesma tabela.
 */
@Injectable()
export class OpReplayInterceptor implements NestInterceptor {
  constructor(private readonly db: DatabaseService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers[OP_HEADER];
    if (
      typeof header !== 'string' ||
      req.method === 'GET' ||
      req.method === 'HEAD' ||
      !req.tenant ||
      !req.user
    )
      return next.handle();
    const key = validIdempotencyKey(header);
    if (!key) return next.handle();
    const scope = { tenantId: req.tenant.id, userId: req.user.id };
    const opScope = `op:${req.method} ${req.path}`.slice(0, 300);
    const hash = createHash('sha256')
      .update(JSON.stringify(req.body ?? null))
      .digest('hex');

    // Reserva a chave antes de executar (status 0 = gravando): dois reenvios ao mesmo tempo (duas
    // abas, a fila e o botão) não executam duas vezes. O segundo recebe 429 e a fila tenta de
    // novo; reserva de envio que caiu (status -1) ou presa há mais de 2 minutos é retomada.
    const reserve = () =>
      this.db.withTenant(scope, async (tx) => {
        const mine = await one(
          tx,
          `INSERT INTO idempotency_keys (tenant_id, scope, key, request_hash, response, status_code)
           VALUES ($1,$2,$3,$4,NULL,0) ON CONFLICT DO NOTHING RETURNING 1`,
          [scope.tenantId, opScope, key, hash],
        );
        if (mine) return { run: true as const };
        const taken = await one(
          tx,
          `UPDATE idempotency_keys SET status_code = 0, request_hash = $4, created_at = now()
            WHERE tenant_id=$1 AND scope=$2 AND key=$3
              AND (status_code = -1 OR (status_code = 0 AND created_at < now() - interval '2 minutes'))
          RETURNING 1`,
          [scope.tenantId, opScope, key, hash],
        );
        if (taken) return { run: true as const };
        const prev = await one<{ request_hash: string; response: unknown; status_code: number }>(
          tx,
          `SELECT request_hash, response, status_code FROM idempotency_keys
            WHERE tenant_id=$1 AND scope=$2 AND key=$3`,
          [scope.tenantId, opScope, key],
        );
        return { run: false as const, prev };
      });
    const settle = (result: unknown, ok: boolean) =>
      this.db
        .withTenant(scope, (tx) =>
          tx.$client.query(
            `UPDATE idempotency_keys SET status_code = $5, response = $4
              WHERE tenant_id=$1 AND scope=$2 AND key=$3 AND status_code = 0`,
            [
              scope.tenantId,
              opScope,
              key,
              ok ? JSON.stringify(result ?? null) : null,
              ok ? 200 : -1,
            ],
          ),
        )
        // Guardar a resposta não pode derrubar uma gravação que já deu certo.
        .catch(() => undefined);

    return from(reserve()).pipe(
      switchMap((r) => {
        if (!r.run) {
          const prev = r.prev;
          if (prev && prev.request_hash !== hash)
            throw new UnprocessableEntityException({
              message: 'Este envio já foi registrado com outros dados. Atualize a tela e confira.',
              code: IDEMPOTENCY_MISMATCH,
            });
          if (prev?.status_code === 200) return of(prev.response);
          throw new HttpException(
            { message: 'Este envio ainda está sendo gravado. Tentando de novo.', code: OP_BUSY },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        return next.handle().pipe(
          mergeMap(async (result: unknown) => {
            // Arquivo não se guarda: libera a chave (um reenvio gera de novo, como antes).
            const file = result instanceof StreamableFile || Buffer.isBuffer(result);
            await settle(result, !file);
            return result;
          }),
          catchError((e: unknown) =>
            from(settle(null, false)).pipe(mergeMap(() => throwError(() => e))),
          ),
        );
      }),
    );
  }
}
