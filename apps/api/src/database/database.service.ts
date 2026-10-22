import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, PoolClient } from 'pg';
import { ENV, Env } from '../config/env';
import { schema } from './schema';

export type Tx = NodePgDatabase<typeof schema> & { $client: PoolClient };

export interface TenantScope {
  tenantId: string;
  userId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Único caminho de acesso a dados de negócio: withTenant().
 * Abre transação, define app.tenant_id com set_config(..., true) — escopo LOCAL à transação —
 * e libera a conexão ao pool somente após COMMIT/ROLLBACK. Assim uma conexão reutilizada
 * nunca carrega o contexto de uma requisição anterior.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  }

  async withTenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(scope.tenantId)) throw new Error('tenantId inválido');
    if (scope.userId && !UUID_RE.test(scope.userId)) throw new Error('userId inválido');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [scope.tenantId, scope.userId ?? ''],
      );
      const tx = drizzle(client, { schema }) as Tx;
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Consultas pré-autenticação que usam apenas funções SECURITY DEFINER estreitas. */
  async queryUnscoped<R extends object>(sql: string, params: unknown[]): Promise<R[]> {
    const { rows } = await this.pool.query<R>(sql, params);
    return rows;
  }

  async ping(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
