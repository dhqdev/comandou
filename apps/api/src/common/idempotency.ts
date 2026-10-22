import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Tx } from '../database/database.service';
import { one } from './sql';

const KEY_RE = /^[A-Za-z0-9_.:-]{8,100}$/;

export function validIdempotencyKey(key: string | undefined): string | undefined {
  if (key === undefined || key === '') return undefined;
  if (!KEY_RE.test(key)) throw new UnprocessableEntityException('Idempotency-Key inválida');
  return key;
}

/** Operações financeiras (pagamento, estorno, fechamento) exigem a chave. */
export function requireKey(key: string | undefined): string {
  const k = validIdempotencyKey(key);
  if (!k) throw new UnprocessableEntityException('Envie o cabeçalho Idempotency-Key');
  return k;
}

/**
 * Idempotência de operações críticas (pedido, pagamento, estorno, fechamento de caixa).
 * A chave é gravada NA MESMA transação da operação:
 *  - requisição repetida após sucesso → devolve a mesma resposta, sem executar de novo;
 *  - requisição concorrente com a mesma chave → espera o índice único; ao ver a chave, devolve
 *    o resultado (ou 409 se a primeira ainda não terminou);
 *  - mesma chave com corpo diferente → 422;
 *  - se a operação falhar, o ROLLBACK remove a chave e o cliente pode tentar de novo.
 * Isto NÃO é garantia de execução única de tarefas distribuídas (filas têm seu próprio controle).
 */
export async function withIdempotency<T>(
  tx: Tx,
  tenantId: string,
  scope: string,
  key: string | undefined,
  body: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  if (!key) return fn();
  const hash = createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
  const inserted = await one(
    tx,
    `INSERT INTO idempotency_keys (tenant_id, scope, key, request_hash) VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING RETURNING key`,
    [tenantId, scope, key, hash],
  );
  if (!inserted) {
    const prev = await one<{ request_hash: string; response: T | null }>(
      tx,
      `SELECT request_hash, response FROM idempotency_keys WHERE tenant_id=$1 AND scope=$2 AND key=$3`,
      [tenantId, scope, key],
    );
    if (!prev) throw new ConflictException('Operação em andamento; tente novamente');
    if (prev.request_hash !== hash) {
      throw new UnprocessableEntityException('Idempotency-Key já usada com outros dados');
    }
    if (prev.response === null)
      throw new ConflictException('Operação em andamento; tente novamente');
    return prev.response;
  }
  const result = await fn();
  await tx.$client.query(
    `UPDATE idempotency_keys SET response = $4, status_code = 200 WHERE tenant_id=$1 AND scope=$2 AND key=$3`,
    [tenantId, scope, key, JSON.stringify(result ?? null)],
  );
  return result;
}
