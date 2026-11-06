import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, PoolClient } from 'pg';
import { ENV, Env } from '../config/env';
import { schema } from './schema';
import { DbServer, RegistryDatabaseRouter, serverOf, TenantDatabaseRow } from './tenant-database';
import { TenantLimiter } from './tenant-limiter';

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
  /**
   * Pool de uma conexão só para o teste de saúde. Com o pool principal cheio (horário de pico),
   * o teste ainda responde: o balanceador não tira todas as réplicas do ar por fila, só por banco
   * fora do ar de verdade.
   */
  private readonly healthPool: Pool;
  /** Vagas por restaurante: um restaurante sozinho não ocupa o pool inteiro. */
  readonly limiter: TenantLimiter;
  private readonly statementTimeout: string;

  constructor(@Inject(ENV) env: Env) {
    this.centralName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
    });
    this.pool.on('error', () => undefined);
    this.healthPool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 3_000,
      query_timeout: 3_000,
    });
    this.healthPool.on('error', () => undefined);
    this.limiter = new TenantLimiter(env.TENANT_MAX_CONCURRENT_TX, env.DATABASE_CONNECT_TIMEOUT_MS);
    this.statementTimeout = String(env.DATABASE_STATEMENT_TIMEOUT_MS);
    this.router = new RegistryDatabaseRouter({
      central: this.pool,
      baseUrl: env.DATABASE_URL,
      poolMax: env.TENANT_DATABASE_POOL_MAX,
      connectTimeoutMs: env.DATABASE_CONNECT_TIMEOUT_MS,
      lookup: async (tenantId) => {
        const { rows } = await this.pool.query<TenantDatabaseRow>(
          'SELECT db_name, status, host, port, ssl FROM app_tenant_database($1)',
          [tenantId],
        );
        return rows[0] ?? null;
      },
    });
  }

  /** Transação no banco do restaurante (central ou próprio), com o RLS dele. */
  async withTenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    checkScope(scope);
    return this.limiter.run(scope.tenantId, async () =>
      this.transaction(await this.router.poolFor(scope.tenantId), scope, fn),
    );
  }

  /**
   * Transação no banco CENTRAL com o RLS do restaurante: dados que ficam sempre lá (plano,
   * assinatura, domínios), mesmo quando o restaurante tem banco próprio.
   */
  async withCentral<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    checkScope(scope);
    return this.limiter.run(scope.tenantId, () => this.transaction(this.pool, scope, fn));
  }

  private async transaction<T>(pool: Pool, scope: TenantScope, fn: (tx: Tx) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // statement_timeout LOCAL: vale só nesta transação (funciona igual atrás do PgBouncer).
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('statement_timeout', $3, true)",
        [scope.tenantId, scope.userId ?? '', this.statementTimeout],
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
    return this.limiter.run(tenantId, async () => {
      const { rows } = await (await this.router.poolFor(tenantId)).query<R>(sql, params);
      return rows;
    });
  }

  /** Bancos próprios em uso (limpeza periódica roda em cada um). */
  async readyDatabases(): Promise<
    { tenantId: string; dbName: string; server: DbServer | null; pool: Pool }[]
  > {
    const rows = await this.queryUnscoped<{
      tenant_id: string;
      db_name: string;
      host: string | null;
      port: number | null;
      ssl: string | null;
    }>('SELECT tenant_id, db_name, host, port, ssl FROM app_tenant_databases_ready()', []);
    return rows.map((r) => {
      const server = serverOf(r);
      return {
        tenantId: r.tenant_id,
        dbName: r.db_name,
        server,
        pool: this.router.poolOf(r.db_name, server),
      };
    });
  }

  async ping(): Promise<boolean> {
    await this.healthPool.query('SELECT 1');
    return true;
  }

  async onModuleDestroy() {
    await this.router.close();
    await this.pool.end();
    await this.healthPool.end();
  }
}

function checkScope(scope: TenantScope) {
  if (!UUID_RE.test(scope.tenantId)) throw new Error('tenantId inválido');
  if (scope.userId && !UUID_RE.test(scope.userId)) throw new Error('userId inválido');
}
