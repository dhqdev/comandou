import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { from, mergeMap, Observable, of, switchMap } from 'rxjs';
import { DatabaseService } from '../database/database.service';
import { IDEMPOTENCY_MISMATCH, validIdempotencyKey } from './idempotency';
import { one } from './sql';

/** Cabeçalho que o app manda em cada gravação que pode ir para a fila offline. */
export const OP_HEADER = 'x-comandou-op';

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

    return from(
      this.db.withTenant(scope, (tx) =>
        one<{ request_hash: string; response: unknown }>(
          tx,
          `SELECT request_hash, response FROM idempotency_keys
            WHERE tenant_id=$1 AND scope=$2 AND key=$3 AND status_code = 200`,
          [scope.tenantId, opScope, key],
        ),
      ),
    ).pipe(
      switchMap((prev) => {
        if (prev) {
          if (prev.request_hash !== hash)
            throw new UnprocessableEntityException({
              message: 'Este envio já foi registrado com outros dados. Atualize a tela e confira.',
              code: IDEMPOTENCY_MISMATCH,
            });
          return of(prev.response);
        }
        return next.handle().pipe(
          mergeMap(async (result: unknown) => {
            if (!(result instanceof StreamableFile) && !Buffer.isBuffer(result)) {
              // Guardar a resposta não pode derrubar uma gravação que já deu certo.
              await this.db
                .withTenant(scope, (tx) =>
                  tx.$client.query(
                    `INSERT INTO idempotency_keys (tenant_id, scope, key, request_hash, response, status_code)
                     VALUES ($1,$2,$3,$4,$5,200) ON CONFLICT DO NOTHING`,
                    [scope.tenantId, opScope, key, hash, JSON.stringify(result ?? null)],
                  ),
                )
                .catch(() => undefined);
            }
            return result;
          }),
        );
      }),
    );
  }
}
