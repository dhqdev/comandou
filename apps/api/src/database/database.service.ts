import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, PoolClient } from 'pg';
import { ENV, Env } from '../config/env';
import { schema } from './schema';
import { RegistryDatabaseRouter, TenantDatabaseRow } from './tenant-database';

export type Tx = NodePgDatabase<typeof schema> & { $client: PoolClient };

export interface TenantScope {
  tenantId: string;
  userId?: string | null;
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
  /** Pool do banco central. Consultas sem restaurante usam sempre este. */
  readonly pool: Pool;
  /** Decide o banco de cada restaurante pelo registro do banco central (ADR 0011). */
  readonly router: RegistryDatabaseRouter;
  /** Nome do banco central (o das URLs de conexão). */
  readonly centralName: string;

  constructor(@Inject(ENV) env: Env) {
    this.centralName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
    this.pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
    this.pool.on('error', () => undefined);
    this.router = new RegistryDatabaseRouter({
      central: this.pool,
      baseUrl: env.DATABASE_URL,
      poolMax: env.TENANT_DATABASE_POOL_MAX,
      lookup: async (tenantId) => {
        const { rows } = await this.pool.query<TenantDatabaseRow>(
          'SELECT db_name, status FROM app_tenant_database($1)',
          [tenantId],
        );
        return rows[0] ?? null;
      },
    });
  }

  /** Transação no banco do restaurante (central ou próprio), com o RLS dele. */
  async withTenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    checkScope(scope);
    return this.transaction(await this.router.poolFor(scope.tenantId), scope, fn);
  }

  /**
   * Transação no banco CENTRAL com o RLS do restaurante: dados que ficam sempre lá (plano,
   * assinatura, domínios), mesmo quando o restaurante tem banco próprio.
   */
  async withCentral<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    checkScope(scope);
    return this.transaction(this.pool, scope, fn);
  }

  private async transaction<T>(pool: Pool, scope: TenantScope, fn: (tx: Tx) => Promise<T>) {
    const client = await pool.connect();
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

  /** Consultas pré-autenticação no banco central (funções SECURITY DEFINER estreitas). */
  async queryUnscoped<R extends object>(sql: string, params: unknown[]): Promise<R[]> {
    const { rows } = await this.pool.query<R>(sql, params);
    return rows;
  }

  /** Mesma coisa, no banco do restaurante (login, acesso de suporte). */
  async queryTenantDb<R extends object>(
    tenantId: string,
    sql: string,
    params: unknown[],
  ): Promise<R[]> {
    checkScope({ tenantId });
    const { rows } = await (await this.router.poolFor(tenantId)).query<R>(sql, params);
    return rows;
  }

  /** Bancos próprios em uso (limpeza periódica roda em cada um). */
  async readyDatabases(): Promise<{ tenantId: string; dbName: string; pool: Pool }[]> {
    const rows = await this.queryUnscoped<{ tenant_id: string; db_name: string }>(
      'SELECT tenant_id, db_name FROM app_tenant_databases_ready()',
      [],
    );
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      dbName: r.db_name,
      pool: this.router.poolOf(r.db_name),
    }));
  }

  async ping(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }

  async onModuleDestroy() {
    await this.router.close();
    await this.pool.end();
  }
}

function checkScope(scope: TenantScope) {
  if (!UUID_RE.test(scope.tenantId)) throw new Error('tenantId inválido');
  if (scope.userId && !UUID_RE.test(scope.userId)) throw new Error('userId inválido');
}
