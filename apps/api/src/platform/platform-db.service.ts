import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { ENV, Env } from '../config/env';
import {
  RegistryDatabaseRouter,
  TenantDatabaseLocation,
  TenantDatabaseRow,
} from '../database/tenant-database';

/** Acesso do painel ao banco de UM restaurante (central ou próprio). */
export interface TenantDbHandle {
  location: TenantDatabaseLocation;
  query<R extends QueryResultRow = QueryResultRow>(sql: string, p?: unknown[]): Promise<R[]>;
  tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T>;
}

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Caminho privilegiado e separado do painel Super Admin: pool próprio com o papel
 * comandou_platform. Nunca é usado pelas rotas do restaurante, e a API do restaurante
 * (comandou_app) não enxerga nenhuma tabela da plataforma.
 */
@Injectable()
export class PlatformDb implements OnModuleDestroy {
  readonly pool?: Pool;
  /**
   * Bancos dos restaurantes, com o mesmo papel da plataforma. Durante a mudança para banco
   * próprio os dados ainda estão no central; durante a exclusão ainda dá para ler o banco.
   */
  readonly router?: RegistryDatabaseRouter;

  constructor(@Inject(ENV) env: Env) {
    if (env.PLATFORM_DATABASE_URL) {
      const pool = new Pool({ connectionString: env.PLATFORM_DATABASE_URL, max: 4 });
      pool.on('error', () => undefined);
      this.pool = pool;
      this.router = new RegistryDatabaseRouter({
        central: pool,
        baseUrl: env.PLATFORM_DATABASE_URL,
        poolMax: 2,
        cacheMs: 0, // painel: sempre a situação atual (poucas consultas)
        lookup: async (tenantId) =>
          (
            await pool.query<TenantDatabaseRow>(
              'SELECT db_name, status FROM tenant_databases WHERE tenant_id = $1',
              [tenantId],
            )
          ).rows[0] ?? null,
        decide: (row) =>
          row.status === 'ready' || row.status === 'deleting'
            ? { kind: 'dedicated', dbName: row.db_name }
            : row.status === 'moving'
              ? { kind: 'shared' }
              : 'unavailable',
      });
    }
  }

  /** Banco do restaurante para ler equipe, sessões, uso... e gravar na auditoria dele. */
  async tenantDb(tenantId: string): Promise<TenantDbHandle> {
    const location = await this.router!.locationOf(tenantId);
    const pool = location.kind === 'shared' ? this.pool! : this.router!.poolOf(location.dbName);
    return {
      location,
      query: async <R extends QueryResultRow>(sql: string, p: unknown[] = []) =>
        (await pool.query<R>(sql, p)).rows,
      tx: (fn) => inTx(pool, fn),
    };
  }

  /**
   * Roda a mesma consulta em cada banco próprio pronto (no máximo 6 ao mesmo tempo). Um banco
   * com erro não derruba o painel: devolve lista vazia para ele.
   */
  async eachDedicated<R extends QueryResultRow>(
    sql: string,
    p: unknown[] = [],
  ): Promise<{ tenantId: string; dbName: string; rows: R[]; error?: string }[]> {
    const dbs = await this.query<{ tenant_id: string; db_name: string }>(
      `SELECT tenant_id, db_name FROM tenant_databases WHERE status = 'ready' ORDER BY db_name`,
    );
    const out: { tenantId: string; dbName: string; rows: R[]; error?: string }[] = [];
    for (let i = 0; i < dbs.length; i += 6) {
      const part = await Promise.all(
        dbs.slice(i, i + 6).map(async (d) => {
          try {
            const rows = (await this.poolOf(d.db_name).query<R>(sql, p)).rows;
            return { tenantId: d.tenant_id, dbName: d.db_name, rows };
          } catch (e) {
            return {
              tenantId: d.tenant_id,
              dbName: d.db_name,
              rows: [],
              error: (e as Error).message,
            };
          }
        }),
      );
      out.push(...part);
    }
    return out;
  }

  /** Pool de um banco de restaurante pelo nome (somatórios do painel). */
  poolOf(dbName: string): Pool {
    return this.router!.poolOf(dbName);
  }

  get enabled(): boolean {
    return !!this.pool;
  }

  async query<R extends QueryResultRow = QueryResultRow>(sql: string, p: unknown[] = []) {
    return (await this.pool!.query<R>(sql, p)).rows;
  }

  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return inTx(this.pool!, fn);
  }

  async onModuleDestroy() {
    await this.router?.close();
    await this.pool?.end();
  }
}

export interface PlatformAuditEntry {
  adminId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  tenantId?: string | null;
  data?: Record<string, unknown>;
  ip?: string | null;
}

/** Auditoria da plataforma na MESMA transação da ação. Nunca grave senhas, tokens ou códigos. */
export async function platformAudit(c: PoolClient, e: PlatformAuditEntry) {
  await c.query(
    `INSERT INTO platform_audit_log (admin_id, action, entity, entity_id, tenant_id, data, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      e.adminId ?? null,
      e.action,
      e.entity,
      e.entityId ?? null,
      e.tenantId ?? null,
      JSON.stringify(e.data ?? {}),
      e.ip ?? null,
    ],
  );
}
