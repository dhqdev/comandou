import { ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * Servidor Postgres extra (platform_db_servers). Só endereço, porta e SSL: usuário e senha são os
 * mesmos da conexão do servidor principal. null/undefined = servidor principal.
 */
export interface DbServer {
  host: string;
  port: number;
  ssl: 'disable' | 'require';
}

/** Onde ficam os dados de um restaurante (ADR 0011). */
export type TenantDatabaseLocation =
  { kind: 'shared' } | { kind: 'dedicated'; dbName: string; server?: DbServer | null };

/** Linha do registro (tenant_databases) de um restaurante; null = banco central. */
export interface TenantDatabaseRow {
  db_name: string;
  status: 'creating' | 'ready' | 'failed' | 'moving' | 'deleting' | 'transferring';
  /** Servidor (vazio = principal). */
  host?: string | null;
  port?: number | null;
  ssl?: string | null;
}

/** Servidor da linha do registro (null = principal). */
export function serverOf(row: {
  host?: string | null;
  port?: number | null;
  ssl?: string | null;
}): DbServer | null {
  if (!row.host) return null;
  return {
    host: row.host,
    port: row.port ?? 5432,
    ssl: row.ssl === 'require' ? 'require' : 'disable',
  };
}

/** Chave de um banco: nome sozinho no principal, servidor/nome nos outros. */
export function databaseKey(dbName: string, server?: DbServer | null): string {
  return server ? `${server.host}:${server.port}/${dbName}` : dbName;
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

export const TENANT_DB_NAME_RE = /^comandou_[a-z0-9_]{1,54}$/;

/** Nome do banco de um restaurante a partir do endereço: pizzaria-do-ze → comandou_pizzaria_do_ze. */
export function tenantDatabaseName(slug: string): string {
  const name = `comandou_${slug.replace(/-/g, '_')}`;
  if (!TENANT_DB_NAME_RE.test(name)) throw new Error(`endereço inválido para banco: ${slug}`);
  return name;
}

/**
 * Mesmo papel e senha, outro banco. Com `server`, também outro servidor (endereço, porta e SSL);
 * sem ele, o mesmo servidor da conexão base.
 */
export function databaseUrl(base: string, dbName: string, server?: DbServer | null): string {
  if (!TENANT_DB_NAME_RE.test(dbName)) throw new Error('nome de banco inválido');
  return onServer(base, dbName, server);
}

/** Banco de manutenção ("postgres") de um servidor: criar e apagar bancos, conferir papéis. */
export function maintenanceUrl(base: string, server?: DbServer | null): string {
  return onServer(base, 'postgres', server);
}

function onServer(base: string, dbName: string, server?: DbServer | null): string {
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  if (server) {
    u.hostname = server.host;
    u.port = String(server.port);
    u.searchParams.delete('ssl');
    if (server.ssl === 'require') {
      // Cifrada sem conferir o certificado (como o sslmode=require do libpq).
      u.searchParams.set('sslmode', 'require');
      u.searchParams.set('uselibpqcompat', 'true');
    } else {
      u.searchParams.delete('sslmode');
      u.searchParams.delete('uselibpqcompat');
    }
  }
  return u.toString();
}

/** A mesma URL para os programas do Postgres (pg_dump/psql não conhecem uselibpqcompat). */
export function libpqUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.delete('uselibpqcompat');
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
  /** Espera máxima por uma conexão livre (pool cheio ou banco fora): erro em vez de travar. */
  connectTimeoutMs?: number;
}

/** Banco próprio (com o servidor só quando não é o principal). */
export function dedicated(row: TenantDatabaseRow): TenantDatabaseLocation {
  const server = serverOf(row);
  return server
    ? { kind: 'dedicated', dbName: row.db_name, server }
    : { kind: 'dedicated', dbName: row.db_name };
}

const appDecide = (row: TenantDatabaseRow): TenantDatabaseLocation | 'unavailable' =>
  row.status === 'ready' ? dedicated(row) : 'unavailable';

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
      connectTimeoutMs: 10_000,
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
    return loc.kind === 'shared' ? this.o.central : this.poolOf(loc.dbName, loc.server);
  }

  /** Pool de um banco de restaurante pelo nome e servidor (limpeza periódica, painel). */
  poolOf(dbName: string, server?: DbServer | null): Pool {
    const key = databaseKey(dbName, server);
    const hit = this.pools.get(key);
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
      connectionString: databaseUrl(this.o.baseUrl, dbName, server),
      max: this.o.poolMax,
      idleTimeoutMillis: this.o.idleMs,
      connectionTimeoutMillis: this.o.connectTimeoutMs,
    });
    // Banco excluído ou reiniciado derruba conexões paradas: nunca derrubar a API por isso.
    pool.on('error', () => undefined);
    this.pools.set(key, { pool, used: Date.now() });
    return pool;
  }

  forget(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
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
