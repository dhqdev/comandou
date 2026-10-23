import { ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

/** Onde ficam os dados de um restaurante (ADR 0011). */
export type TenantDatabaseLocation = { kind: 'shared' } | { kind: 'dedicated'; dbName: string };

/** Linha do registro (tenant_databases) de um restaurante; null = banco central. */
export interface TenantDatabaseRow {
  db_name: string;
  status: 'creating' | 'ready' | 'failed' | 'moving' | 'deleting';
}

/**
 * Ponto único que decide em qual banco ficam os dados de um restaurante.
 * Toda transação de negócio (DatabaseService.withTenant) pede o pool por aqui.
 */
export interface TenantDatabaseRouter {
  poolFor(tenantId: string): Promise<Pool>;
  locationOf(tenantId: string): Promise<TenantDatabaseLocation>;
  /** Esquece o que sabe de um restaurante (ou de todos) e fecha pools sem uso. */
  forget(tenantId?: string): void;
  close(): Promise<void>;
}

/** Só o banco central (testes e ferramentas que não precisam do registro). */
export class SharedDatabaseRouter implements TenantDatabaseRouter {
  constructor(private readonly shared: Pool) {}
  async poolFor(_tenantId: string): Promise<Pool> {
    return this.shared;
  }
  async locationOf(_tenantId: string): Promise<TenantDatabaseLocation> {
    return { kind: 'shared' };
  }
  forget() {}
  async close() {}
}

export const TENANT_DB_NAME_RE = /^comandou_[a-z0-9_]{1,54}$/;

/** Nome do banco de um restaurante a partir do endereço: pizzaria-do-ze → comandou_pizzaria_do_ze. */
export function tenantDatabaseName(slug: string): string {
  const name = `comandou_${slug.replace(/-/g, '_')}`;
  if (!TENANT_DB_NAME_RE.test(name)) throw new Error(`endereço inválido para banco: ${slug}`);
  return name;
}

/** Mesma conexão (servidor, papel e senha), outro banco. */
export function databaseUrl(base: string, dbName: string): string {
  if (!TENANT_DB_NAME_RE.test(dbName)) throw new Error('nome de banco inválido');
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  return u.toString();
}

export class TenantDatabaseUnavailable extends ServiceUnavailableException {
  constructor() {
    super('O banco deste restaurante está em manutenção. Tente de novo em instantes.');
  }
}

export interface RegistryRouterOptions {
  central: Pool;
  /** URL do banco central; os bancos dos restaurantes usam a mesma, trocando o nome do banco. */
  baseUrl: string;
  lookup: (tenantId: string) => Promise<TenantDatabaseRow | null>;
  /**
   * O que fazer com cada situação do registro. Padrão (API dos restaurantes): só "ready" usa o
   * banco próprio; qualquer outra situação bloqueia (nada é gravado no meio de uma mudança).
   */
  decide?: (row: TenantDatabaseRow) => TenantDatabaseLocation | 'unavailable';
  poolMax?: number;
  /** Quanto tempo a resposta do registro vale em memória. */
  cacheMs?: number;
  /** Conexões paradas fecham depois disso (bancos de restaurantes pouco usados não seguram conexão). */
  idleMs?: number;
  /** Máximo de pools abertos ao mesmo tempo; o menos usado é fechado. */
  maxPools?: number;
}

const appDecide = (row: TenantDatabaseRow): TenantDatabaseLocation | 'unavailable' =>
  row.status === 'ready' ? { kind: 'dedicated', dbName: row.db_name } : 'unavailable';

/**
 * Roteador pelo registro do banco central. Um pool pequeno por banco de restaurante, aberto sob
 * demanda e fechado quando fica parado. O RLS continua ativo dentro de cada banco.
 */
export class RegistryDatabaseRouter implements TenantDatabaseRouter {
  private readonly cache = new Map<
    string,
    { loc: TenantDatabaseLocation | 'unavailable'; at: number }
  >();
  private readonly pools = new Map<string, { pool: Pool; used: number }>();
  private readonly o: Required<Omit<RegistryRouterOptions, 'decide'>> & {
    decide: NonNullable<RegistryRouterOptions['decide']>;
  };

  constructor(opts: RegistryRouterOptions) {
    this.o = {
      poolMax: 3,
      cacheMs: 10_000,
      idleMs: 15_000,
      maxPools: 100,
      decide: appDecide,
      ...opts,
    };
  }

  async locationOf(tenantId: string): Promise<TenantDatabaseLocation> {
    const loc = await this.resolve(tenantId);
    if (loc === 'unavailable') throw new TenantDatabaseUnavailable();
    return loc;
  }

  async poolFor(tenantId: string): Promise<Pool> {
    const loc = await this.locationOf(tenantId);
    return loc.kind === 'shared' ? this.o.central : this.poolOf(loc.dbName);
  }

  /** Pool de um banco de restaurante pelo nome (limpeza periódica, painel). */
  poolOf(dbName: string): Pool {
    const hit = this.pools.get(dbName);
    if (hit) {
      hit.used = Date.now();
      return hit.pool;
    }
    if (this.pools.size >= this.o.maxPools) {
      const [oldest] = [...this.pools.entries()].sort((a, b) => a[1].used - b[1].used);
      if (oldest) {
        this.pools.delete(oldest[0]);
        void oldest[1].pool.end().catch(() => undefined);
      }
    }
    const pool = new Pool({
      connectionString: databaseUrl(this.o.baseUrl, dbName),
      max: this.o.poolMax,
      idleTimeoutMillis: this.o.idleMs,
    });
    // Banco excluído ou reiniciado derruba conexões paradas: nunca derrubar a API por isso.
    pool.on('error', () => undefined);
    this.pools.set(dbName, { pool, used: Date.now() });
    return pool;
  }

  forget(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  /** Fecha o pool de um banco (antes de excluí-lo, por exemplo). */
  async closeDatabase(dbName: string) {
    const hit = this.pools.get(dbName);
    if (!hit) return;
    this.pools.delete(dbName);
    await hit.pool.end().catch(() => undefined);
  }

  async close() {
    const all = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(all.map((p) => p.pool.end().catch(() => undefined)));
  }

  private async resolve(tenantId: string) {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < this.o.cacheMs) return hit.loc;
    const row = await this.o.lookup(tenantId);
    const loc = row ? this.o.decide(row) : ({ kind: 'shared' } as const);
    this.cache.set(tenantId, { loc, at: Date.now() });
    if (this.cache.size > 10_000) this.cache.clear();
    return loc;
  }
}
