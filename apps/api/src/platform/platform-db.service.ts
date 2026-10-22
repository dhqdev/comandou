import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { ENV, Env } from '../config/env';

/**
 * Caminho privilegiado e separado do painel Super Admin: pool próprio com o papel
 * pedemais_platform. Nunca é usado pelas rotas do restaurante, e a API do restaurante
 * (pedemais_app) não enxerga nenhuma tabela da plataforma.
 */
@Injectable()
export class PlatformDb implements OnModuleDestroy {
  readonly pool?: Pool;

  constructor(@Inject(ENV) env: Env) {
    if (env.PLATFORM_DATABASE_URL)
      this.pool = new Pool({ connectionString: env.PLATFORM_DATABASE_URL, max: 4 });
  }

  get enabled(): boolean {
    return !!this.pool;
  }

  async query<R extends QueryResultRow = QueryResultRow>(sql: string, p: unknown[] = []) {
    return (await this.pool!.query<R>(sql, p)).rows;
  }

  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool!.connect();
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

  async onModuleDestroy() {
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
