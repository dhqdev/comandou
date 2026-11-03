import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { TenantDatabaseUnavailable } from '../database/tenant-database';
import { GatewayClient, GatewaySession } from '../messaging/gateway.client';
import { PlatformDb } from './platform-db.service';
import { PlatformService } from './platform.service';

/** Resultado de um teste (site, domínio próprio ou banco). */
export interface SiteCheck {
  ok: boolean;
  /** Código HTTP (só nos testes de site). */
  http: number | null;
  ms: number | null;
  error?: string;
}

export type SiteState = 'online' | 'attention' | 'offline' | 'suspended' | 'setup';

export interface SiteStatus {
  id: string;
  slug: string;
  name: string;
  status: string;
  planName: string | null;
  subscriptionStatus: string | null;
  host: string;
  state: SiteState;
  /** O que está errado, em português (vazio = tudo certo). */
  issues: string[];
  web: SiteCheck | null;
  domains: { hostname: string; verified: boolean; check: SiteCheck | null }[];
  database: {
    kind: 'dedicated' | 'shared';
    name: string | null;
    status: string | null;
    server: string | null;
    check: SiteCheck | null;
  };
  whatsapp: { status: GatewaySession['status'] | 'unknown'; phone: string | null } | null;
  backup: { lastOkAt: string | null; lastStatus: string | null; lastAt: string | null };
  lastOrderAt: string | null;
  ordersMonth: number;
}

export interface SitesReport {
  checkedAt: string;
  baseDomain: string;
  whatsappGateway: 'ok' | 'error' | 'disabled';
  sites: SiteStatus[];
}

interface TenantListRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  planName: string | null;
  subscriptionStatus: string | null;
  ordersMonth: number;
  lastOrderAt: Date | null;
  dbName: string | null;
  dbStatus: string | null;
}

const WEB_TIMEOUT_MS = 6000;
const DB_TIMEOUT_MS = 4000;
const WA_TIMEOUT_MS = 4000;
/** Testes ao mesmo tempo (o servidor e os bancos não sentem a rodada). */
const PARALLEL = 8;
/** Vários admins ou abas abertas: a rodada vale por alguns segundos. */
const CACHE_MS = 8000;
/** "Recarregar" refaz na hora, mas não mais que isto. */
const FRESH_MIN_MS = 2000;
/** Backup do dia: alerta depois de 26 h. */
const BACKUP_WARN_H = 26;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${what} sem resposta em ${ms / 1000} s`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Erro de rede em português, sem detalhes internos. */
export function networkError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } };
  const code = err.cause?.code ?? (err as { code?: string }).code ?? '';
  if (err.name === 'TimeoutError' || err.name === 'AbortError')
    return `sem resposta em ${WEB_TIMEOUT_MS / 1000} s`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'endereço não encontrado (DNS)';
  if (code === 'ECONNREFUSED') return 'conexão recusada';
  if (code === 'ECONNRESET') return 'conexão interrompida';
  if (/CERT|SSL|TLS/i.test(code)) return 'certificado HTTPS inválido';
  return 'sem conexão';
}

const HTTP_REASON: Record<number, string> = {
  403: 'restaurante bloqueado',
  404: 'restaurante não encontrado neste endereço',
  502: 'servidor fora do ar (502)',
  503: 'banco do restaurante sem resposta',
  504: 'servidor sem resposta (504)',
};

/**
 * Status em tempo real de cada restaurante (cada site) para a tela inicial do Super Admin: o
 * site responde pelo endereço público, os domínios próprios, o banco, o WhatsApp e o último
 * backup. Só leitura; nada aqui muda o restaurante.
 */
@Injectable()
export class PlatformSitesService {
  private cache: { at: number; report: Promise<SitesReport> } | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly platform: PlatformService,
    private readonly gateway: GatewayClient,
  ) {}

  async report(fresh = false): Promise<SitesReport> {
    const age = this.cache ? Date.now() - this.cache.at : Infinity;
    if (this.cache && age < (fresh ? FRESH_MIN_MS : CACHE_MS)) return this.cache.report;
    const report = this.build();
    this.cache = { at: Date.now(), report };
    report.catch(() => {
      if (this.cache?.report === report) this.cache = null;
    });
    return report;
  }

  /** Endereço testado: o mesmo caminho que o navegador do cliente faz (Traefik → API → banco). */
  siteUrl(host: string) {
    const scheme = this.env.COOKIE_SECURE ? 'https' : 'http';
    const port = this.env.SITE_CHECK_PORT ? `:${this.env.SITE_CHECK_PORT}` : '';
    return `${scheme}://${host}${port}/api/v1/health/site`;
  }

  /** Um teste HTTP. Separado para os testes trocarem a rede por uma chamada direta. */
  async probeSite(host: string): Promise<SiteCheck> {
    const t0 = performance.now();
    try {
      const res = await fetch(this.siteUrl(host), {
        redirect: 'manual',
        headers: { 'User-Agent': 'Comandou-Status/1' },
        signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
      });
      await res.arrayBuffer().catch(() => undefined);
      const ms = Math.round(performance.now() - t0);
      return res.ok
        ? { ok: true, http: res.status, ms }
        : {
            ok: false,
            http: res.status,
            ms,
            error: HTTP_REASON[res.status] ?? `respondeu ${res.status}`,
          };
    } catch (e) {
      return { ok: false, http: null, ms: null, error: networkError(e) };
    }
  }

  private async pingDb(tenantId: string): Promise<SiteCheck> {
    const t0 = performance.now();
    try {
      const h = await this.db.tenantDb(tenantId);
      await withTimeout(h.query('SELECT 1'), DB_TIMEOUT_MS, 'banco');
      return { ok: true, http: null, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      return {
        ok: false,
        http: null,
        ms: null,
        error:
          e instanceof TenantDatabaseUnavailable
            ? 'banco ainda não está pronto'
            : /sem resposta/.test((e as Error).message)
              ? (e as Error).message
              : 'banco sem conexão',
      };
    }
  }

  private async whatsapp(tenantId: string): Promise<SiteStatus['whatsapp']> {
    try {
      const s = await withTimeout(this.gateway.session(tenantId), WA_TIMEOUT_MS, 'WhatsApp');
      return { status: s.status ?? 'unknown', phone: s.phone ?? null };
    } catch {
      return { status: 'unknown', phone: null };
    }
  }

  private async gatewayHealth(): Promise<SitesReport['whatsappGateway']> {
    if (!this.gateway.configured) return 'disabled';
    try {
      const res = await fetch(`${this.env.WHATSAPP_GATEWAY_URL!.replace(/\/+$/, '')}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }

  private async build(): Promise<SitesReport> {
    const base = this.env.COMANDOU_BASE_DOMAIN;
    const [tenants, domains, backups, central, gateway] = await Promise.all([
      this.platform.listTenants({}) as unknown as Promise<TenantListRow[]>,
      this.db.query<{ tenantId: string; hostname: string; verified: boolean }>(
        `SELECT tenant_id AS "tenantId", hostname::text AS hostname, verified_at IS NOT NULL AS verified
           FROM tenant_domains WHERE removed_at IS NULL ORDER BY created_at`,
      ),
      this.db.query<{ tenantId: string; lastOkAt: Date | null; lastStatus: string; lastAt: Date }>(
        `SELECT DISTINCT ON (tenant_id) tenant_id AS "tenantId", status AS "lastStatus",
                started_at AS "lastAt",
                (SELECT max(finished_at) FROM backup_runs o
                  WHERE o.tenant_id = r.tenant_id AND o.kind = 'backup' AND o.status = 'ok') AS "lastOkAt"
           FROM backup_runs r WHERE kind = 'backup' AND tenant_id IS NOT NULL
          ORDER BY tenant_id, started_at DESC`,
      ),
      // Restaurante no banco central: o backup dele é o do banco central.
      this.db.query<{ lastOkAt: Date | null; lastStatus: string | null; lastAt: Date | null }>(
        `SELECT (SELECT max(finished_at) FROM backup_runs
                  WHERE tenant_id IS NULL AND kind = 'backup' AND status = 'ok') AS "lastOkAt",
                r.status AS "lastStatus", r.started_at AS "lastAt"
           FROM (SELECT 1) one
           LEFT JOIN LATERAL (SELECT status, started_at FROM backup_runs
                               WHERE tenant_id IS NULL AND kind = 'backup'
                               ORDER BY started_at DESC LIMIT 1) r ON true`,
      ),
      this.gatewayHealth(),
    ]);
    const servers = new Map(
      (
        await this.db.query<{ tenantId: string; server: string | null }>(
          `SELECT d.tenant_id AS "tenantId", s.name AS server
             FROM tenant_databases d LEFT JOIN platform_db_servers s ON s.id = d.server_id`,
        )
      ).map((r) => [r.tenantId, r.server]),
    );
    const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

    const sites = await mapLimit(tenants, PARALLEL, async (t): Promise<SiteStatus> => {
      const host = `${t.slug}.${base}`;
      const live = t.status === 'provisioned';
      const own = domains.filter((d) => d.tenantId === t.id);
      const [web, dbCheck, wa, domainChecks] = await Promise.all([
        live ? this.probeSite(host) : Promise.resolve(null),
        live || t.status === 'suspended' ? this.pingDb(t.id) : Promise.resolve(null),
        live && gateway === 'ok' ? this.whatsapp(t.id) : Promise.resolve(null),
        Promise.all(own.map((d) => (live && d.verified ? this.probeSite(d.hostname) : null))),
      ]);
      const dedicated = !!t.dbName;
      const b = dedicated ? backups.find((x) => x.tenantId === t.id) : central[0];
      const backup = {
        lastOkAt: iso(b?.lastOkAt),
        lastStatus: b?.lastStatus ?? null,
        lastAt: iso(b?.lastAt),
      };

      const issues: string[] = [];
      let state: SiteState;
      if (t.status === 'suspended') state = 'suspended';
      else if (!live) state = 'setup';
      else {
        if (web && !web.ok) issues.push(`Site: ${web.error}`);
        if (dbCheck && !dbCheck.ok) issues.push(`Banco: ${dbCheck.error}`);
        const hard = issues.length > 0;
        own.forEach((d, i) => {
          const c = domainChecks[i];
          if (c && !c.ok) issues.push(`${d.hostname}: ${c.error}`);
        });
        if (!backup.lastOkAt) issues.push('Nenhum backup bom ainda');
        else if ((Date.now() - new Date(backup.lastOkAt).getTime()) / 3_600_000 > BACKUP_WARN_H)
          issues.push('Backup atrasado (mais de 26 h)');
        state = hard ? 'offline' : issues.length ? 'attention' : 'online';
      }

      return {
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        planName: t.planName ?? null,
        subscriptionStatus: t.subscriptionStatus ?? null,
        host,
        state,
        issues,
        web,
        domains: own.map((d, i) => ({
          hostname: d.hostname,
          verified: d.verified,
          check: domainChecks[i] ?? null,
        })),
        database: {
          kind: dedicated ? 'dedicated' : 'shared',
          name: t.dbName,
          status: t.dbStatus,
          server: dedicated ? (servers.get(t.id) ?? 'Principal') : 'Central',
          check: dbCheck,
        },
        whatsapp: wa,
        backup,
        lastOrderAt: iso(t.lastOrderAt),
        ordersMonth: t.ordersMonth ?? 0,
      };
    });

    return {
      checkedAt: new Date().toISOString(),
      baseDomain: base,
      whatsappGateway: gateway,
      sites,
    };
  }
}
