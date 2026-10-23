import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RELEASES } from '@comandou/shared';
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from '../auth/password';
import type { PoolClient } from 'pg';
import { ENV, Env } from '../config/env';
import { HealthChecks } from '../health/checks.service';
import { Metrics } from '../health/metrics';
import { provisionTenant } from '../provisioning/provision';
import { QueueService } from '../queue/queue.service';
import type { PlatformAdmin } from './platform-auth';
import { PlatformDb, platformAudit } from './platform-db.service';
import type {
  NewTenantInput,
  PlanInput,
  StatusInput,
  SubscriptionInput,
  TenantProfileInput,
} from './platform.schemas';
import { EMPTY_PROFILE, PROFILE_COLS, saveProfile } from './tenant-profile';
import { TenantDatabaseUnavailable } from '../database/tenant-database';
import { PlatformDatabasesService } from './platform-databases.service';

/** Uso de um restaurante (a função existe em todos os bancos). */
const USAGE_SQL = `SELECT tenant_id AS "tenantId", users::int, products::int,
  orders_month::int AS "ordersMonth", last_order_at AS "lastOrderAt",
  fiscal_errors::int AS "fiscalErrors", message_failures::int AS "messageFailures"
  FROM platform_tenant_usage()`;
const EMPTY_USAGE = {
  users: 0,
  products: 0,
  ordersMonth: 0,
  lastOrderAt: null,
  fiscalErrors: 0,
  messageFailures: 0,
};

export interface Actor {
  admin: PlatformAdmin;
  ip?: string;
}

const PLAN_COLS = `id, code, name, price_monthly AS "priceMonthly", max_users AS "maxUsers",
  max_products AS "maxProducts", max_orders_month AS "maxOrdersMonth",
  feature_fiscal AS "featureFiscal", feature_whatsapp AS "featureWhatsapp",
  feature_custom_domain AS "featureCustomDomain", trial_days AS "trialDays",
  is_default AS "isDefault", active, created_at AS "createdAt"`;

const SUB_COLS = `s.id, s.status, s.plan_id AS "planId", s.started_at AS "startedAt",
  s.trial_ends_at AS "trialEndsAt", s.current_period_end AS "currentPeriodEnd",
  s.cancelled_at AS "cancelledAt", s.notes`;

/**
 * Regras do painel Super Admin. Tudo pelo pool da plataforma (papel comandou_platform) e com
 * auditoria na mesma transação. Não lê dados operacionais dos restaurantes (pedidos, clientes):
 * só números agregados de uso.
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly checks: HealthChecks,
    private readonly queue: QueueService,
    private readonly metrics: Metrics,
    private readonly databases: PlatformDatabasesService,
  ) {}

  // ------------------------------------------------------------------ consumo e operação
  /** Tráfego por restaurante desta réplica da API (só com METRICS_PER_TENANT=true). */
  private async traffic(): Promise<Map<
    string,
    { requests: number; seconds: number; errors: number }
  > | null> {
    const t = this.metrics.tenant;
    if (!t) return null;
    const out = new Map<string, { requests: number; seconds: number; errors: number }>();
    const add = (slug: string, k: 'requests' | 'seconds' | 'errors', v: number) => {
      const cur = out.get(slug) ?? { requests: 0, seconds: 0, errors: 0 };
      cur[k] = v;
      out.set(slug, cur);
    };
    for (const k of ['requests', 'seconds', 'errors'] as const)
      for (const v of (await t[k].get()).values) add(String(v.labels.tenant), k, v.value);
    return out;
  }

  /** Tamanho estimado dos dados de cada restaurante, para o ranking de consumo. */
  async consumption() {
    const [rows, tenants, dbSize, traffic, dedicated] = await Promise.all([
      this.db.query<{ tenantId: string; rows: string; bytes: string }>(
        `SELECT tenant_id AS "tenantId", sum(row_count)::text AS rows, sum(bytes)::text AS bytes
           FROM platform_tenant_footprint() GROUP BY tenant_id`,
      ),
      this.db.query<{ id: string; slug: string; name: string; status: string }>(
        `SELECT id, slug, name, status FROM tenants ORDER BY name`,
      ),
      this.db.query<{ bytes: string }>(
        `SELECT pg_database_size(current_database())::text AS bytes`,
      ),
      this.traffic(),
      this.db.eachDedicated<{ rows: string; bytes: string; dbBytes: string }>(
        `WITH f AS (SELECT * FROM platform_tenant_footprint())
         SELECT coalesce(sum(row_count), 0)::text AS rows, coalesce(sum(bytes), 0)::text AS bytes,
                pg_database_size(current_database())::text AS "dbBytes" FROM f`,
      ),
    ]);
    const by = new Map(rows.map((r) => [r.tenantId, r]));
    // Restaurante com banco próprio: os números vêm do banco dele.
    const own = new Map(dedicated.map((d) => [d.tenantId, d]));
    for (const d of dedicated)
      if (d.rows[0]) by.set(d.tenantId, { tenantId: d.tenantId, ...d.rows[0] });
    const dedicatedBytes = dedicated.reduce((n, d) => n + Number(d.rows[0]?.dbBytes ?? 0), 0);
    const totalSeconds = traffic ? [...traffic.values()].reduce((n, x) => n + x.seconds, 0) : 0;
    return {
      databaseBytes: Number(dbSize[0].bytes) + dedicatedBytes,
      centralBytes: Number(dbSize[0].bytes),
      trafficEnabled: !!traffic,
      tenants: tenants
        .map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          status: t.status,
          rows: Number(by.get(t.id)?.rows ?? 0),
          bytes: Number(by.get(t.id)?.bytes ?? 0),
          database: own.has(t.id) ? own.get(t.id)!.dbName : null,
          databaseBytes: own.has(t.id) ? Number(own.get(t.id)!.rows[0]?.dbBytes ?? 0) : null,
          requests: traffic?.get(t.slug)?.requests ?? null,
          seconds: traffic?.get(t.slug)?.seconds ?? null,
          errors: traffic?.get(t.slug)?.errors ?? null,
          timeShare:
            traffic && totalSeconds ? (traffic.get(t.slug)?.seconds ?? 0) / totalSeconds : null,
        }))
        .sort((a, b) => b.bytes - a.bytes),
    };
  }

  /** Consumo e operação detalhada de um restaurante (agregados, sem dados de clientes finais). */
  async insights(tenantId: string) {
    const t = (
      await this.db.query<{ slug: string }>(`SELECT slug FROM tenants WHERE id = $1`, [tenantId])
    )[0];
    if (!t) throw new NotFoundException('Restaurante não encontrado');
    const h = await this.tenantDbOrConflict(tenantId);
    const [tables, operation, dbSize, traffic, active] = await Promise.all([
      h.query<{ table: string; rows: string; bytes: string }>(
        `SELECT table_name AS "table", row_count::text AS rows, bytes::text AS bytes
           FROM platform_tenant_footprint($1) ORDER BY bytes DESC`,
        [tenantId],
      ),
      h.query<{ op: unknown }>(`SELECT platform_tenant_operation($1) AS op`, [tenantId]),
      h.query<{ bytes: string }>(`SELECT pg_database_size(current_database())::text AS bytes`),
      this.traffic(),
      h.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sessions
          WHERE tenant_id = $1 AND revoked_at IS NULL AND expires_at > now()
            AND last_seen_at > now() - interval '15 minutes'`,
        [tenantId],
      ),
    ]);
    const list = tables.map((r) => ({
      table: r.table,
      rows: Number(r.rows),
      bytes: Number(r.bytes),
    }));
    const bytes = list.reduce((n, r) => n + r.bytes, 0);
    const mine = traffic?.get(t.slug);
    const total = traffic ? [...traffic.values()].reduce((n, x) => n + x.seconds, 0) : 0;
    return {
      footprint: {
        tables: list,
        rows: list.reduce((n, r) => n + r.rows, 0),
        bytes,
        databaseBytes: Number(dbSize[0].bytes),
        database: h.location.kind === 'dedicated' ? h.location.dbName : null,
        share: Number(dbSize[0].bytes) ? bytes / Number(dbSize[0].bytes) : 0,
      },
      traffic: traffic
        ? {
            requests: mine?.requests ?? 0,
            seconds: mine?.seconds ?? 0,
            errors: mine?.errors ?? 0,
            timeShare: total ? (mine?.seconds ?? 0) / total : 0,
          }
        : null,
      onlineNow: active[0].n,
      operation: operation[0].op,
    };
  }

  // ------------------------------------------------------------------ visão geral
  async overview() {
    const [database, redis, whatsappGateway, queue] = await Promise.all([
      this.checks.database(),
      this.checks.redis(),
      this.checks.whatsappGateway(),
      this.queue.counts().catch(() => null),
    ]);
    const tenants = await this.db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM tenants GROUP BY status`,
    );
    const subs = await this.db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM subscriptions WHERE status <> 'cancelled' GROUP BY status`,
    );
    // Banco central: o "último backup" do painel é o dele (cada restaurante tem o seu na tela dele).
    const last = await this.db.query(
      `SELECT DISTINCT ON (kind) kind, status, started_at AS "startedAt", finished_at AS "finishedAt",
              size_bytes AS "sizeBytes", error
         FROM backup_runs WHERE tenant_id IS NULL ORDER BY kind, started_at DESC`,
    );
    const lastOk = await this.db.query<{ kind: string; at: Date }>(
      `SELECT kind, max(finished_at) AS at FROM backup_runs
        WHERE status = 'ok' AND tenant_id IS NULL GROUP BY kind`,
    );
    const ALERTS_SQL = `SELECT coalesce(sum(fiscal_errors), 0)::int AS fiscal,
              coalesce(sum(message_failures), 0)::int AS messages FROM platform_tenant_usage()`;
    const alerts = await this.db.query<{ fiscal: number; messages: number }>(ALERTS_SQL);
    for (const d of await this.db.eachDedicated<{ fiscal: number; messages: number }>(ALERTS_SQL)) {
      alerts[0].fiscal += d.rows[0]?.fiscal ?? 0;
      alerts[0].messages += d.rows[0]?.messages ?? 0;
    }
    const databases = await this.db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM tenant_databases GROUP BY status`,
    );
    const byKind = (k: string) => ({
      last: last.find((r) => r.kind === k) ?? null,
      lastOkAt: lastOk.find((r) => r.kind === k)?.at ?? null,
    });
    return {
      version: RELEASES[0].version,
      health: { database, redis, whatsappGateway },
      queue,
      tenants: Object.fromEntries(tenants.map((r) => [r.status, r.n])),
      subscriptions: Object.fromEntries(subs.map((r) => [r.status, r.n])),
      backups: { backup: byKind('backup'), restoreTest: byKind('restore_test') },
      databases: Object.fromEntries(databases.map((r) => [r.status, r.n])),
      last7Days: { fiscalErrors: alerts[0].fiscal, messageFailures: alerts[0].messages },
    };
  }

  // ------------------------------------------------------------------ restaurantes
  async listTenants(f: { search?: string; status?: string }) {
    const where: string[] = [];
    const p: unknown[] = [];
    if (f.search) {
      p.push(`%${f.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
      where.push(
        `(t.slug ILIKE $${p.length} OR t.name ILIKE $${p.length} OR pf.legal_name ILIKE $${p.length}
          OR pf.city ILIKE $${p.length} OR pf.document ILIKE regexp_replace($${p.length}, '[.\\/-]', '', 'g'))`,
      );
    }
    if (f.status) {
      p.push(f.status);
      where.push(`t.status = $${p.length}`);
    }
    const rows = await this.db.query<{
      id: string;
      users: number;
      products: number;
      ordersMonth: number;
      lastOrderAt: Date | null;
      dbName: string | null;
      dbStatus: string | null;
    }>(
      `SELECT t.id, t.slug, t.name, t.status, t.created_at AS "createdAt",
              pf.city, pf.state,
              s.status AS "subscriptionStatus", pl.name AS "planName",
              u.users::int, u.products::int, u.orders_month::int AS "ordersMonth",
              u.last_order_at AS "lastOrderAt", d.db_name AS "dbName", d.status AS "dbStatus"
         FROM tenants t
         LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled'
         LEFT JOIN plans pl ON pl.id = s.plan_id
         LEFT JOIN platform_tenant_usage() u ON u.tenant_id = t.id
         LEFT JOIN tenant_databases d ON d.tenant_id = t.id
         LEFT JOIN tenant_profiles pf ON pf.tenant_id = t.id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY t.created_at DESC LIMIT 300`,
      p,
    );
    if (rows.some((r) => r.dbStatus === 'ready')) {
      const usage = new Map<string, Record<string, unknown>>();
      for (const d of await this.db.eachDedicated(USAGE_SQL))
        for (const u of d.rows) if (u.tenantId === d.tenantId) usage.set(d.tenantId, u);
      for (const r of rows) {
        const u = usage.get(r.id);
        if (u && r.dbStatus === 'ready') Object.assign(r, u, { id: r.id });
      }
    }
    return rows;
  }

  /**
   * Banco do restaurante para o painel. Enquanto o banco próprio ainda está sendo criado (ou a
   * criação falhou), não há equipe nem dados para mostrar.
   */
  private async tenantDbOrConflict(tenantId: string) {
    try {
      return await this.db.tenantDb(tenantId);
    } catch (e) {
      if (e instanceof TenantDatabaseUnavailable)
        throw new ConflictException('O banco deste restaurante ainda não está pronto');
      throw e;
    }
  }

  private async tenantDbOrNull(tenantId: string) {
    try {
      return await this.db.tenantDb(tenantId);
    } catch (e) {
      if (e instanceof TenantDatabaseUnavailable) return null;
      throw e;
    }
  }

  async tenant(id: string) {
    const t = (
      await this.db.query(
        `SELECT id, slug, name, status, timezone, currency, created_at AS "createdAt"
           FROM tenants WHERE id = $1`,
        [id],
      )
    )[0];
    if (!t) throw new NotFoundException('Restaurante não encontrado');
    const [subscription] = await this.db.query(
      `SELECT ${SUB_COLS} FROM subscriptions s WHERE s.tenant_id = $1 AND s.status <> 'cancelled'`,
      [id],
    );
    const [profile] = await this.db.query(
      `SELECT ${PROFILE_COLS} FROM tenant_profiles WHERE tenant_id = $1`,
      [id],
    );
    const h = await this.tenantDbOrNull(id);
    const [usage] = h ? await h.query(`${USAGE_SQL} WHERE tenant_id = $1`, [id]) : [EMPTY_USAGE];
    const domains = await this.db.query(
      `SELECT id, hostname::text AS hostname, verified_at AS "verifiedAt", last_error AS "lastError",
              created_at AS "createdAt"
         FROM tenant_domains WHERE tenant_id = $1 AND removed_at IS NULL ORDER BY created_at`,
      [id],
    );
    const owners = h
      ? await h.query(
          `SELECT u.name, u.email::text AS email FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.tenant_id = $1 AND m.role = 'owner' AND m.status = 'active' ORDER BY u.name`,
          [id],
        )
      : [];
    const provisioning = await this.db.query(
      `SELECT step, status, attempts, last_error AS "lastError", updated_at AS "updatedAt"
         FROM tenant_provisioning_steps WHERE tenant_id = $1 ORDER BY updated_at`,
      [id],
    );
    const audit = await this.db.query(
      `SELECT l.id, l.action, l.data, l.created_at AS "createdAt", a.name AS "adminName"
         FROM platform_audit_log l LEFT JOIN platform_admins a ON a.id = l.admin_id
        WHERE l.tenant_id = $1 ORDER BY l.created_at DESC LIMIT 30`,
      [id],
    );
    return {
      ...t,
      subscription: subscription ?? null,
      profile: profile ?? EMPTY_PROFILE,
      usage: usage ?? EMPTY_USAGE,
      domains,
      owners,
      provisioning,
      audit,
      database: await this.databases.info(id),
    };
  }

  /** Cria e provisiona um restaurante (mesmo fluxo idempotente da CLI). A senha não é auditada. */
  async createTenant(b: NewTenantInput, a: Actor) {
    // Padrão: banco próprio, criado pelo serviço de backup (a resposta já volta "em criação").
    if (this.env.TENANT_DATABASE_MODE === 'dedicated')
      return this.tenant(await this.databases.create(b, a));
    const exists = await this.db.query(`SELECT 1 FROM tenants WHERE slug = $1`, [b.slug]);
    if (exists.length) throw new ConflictException('Já existe um restaurante com este endereço');
    let r;
    try {
      r = await provisionTenant(this.env.PLATFORM_DATABASE_URL!, {
        slug: b.slug,
        name: b.name,
        adminEmail: b.adminEmail,
        adminName: b.adminName,
        adminPassword: b.adminPassword,
        planCode: b.planCode,
      });
    } catch (e) {
      await this.db.tx((c) =>
        platformAudit(c, {
          adminId: a.admin.id,
          action: 'platform.tenant_provision_failed',
          entity: 'tenant',
          data: { slug: b.slug, error: (e as Error).message.slice(0, 300) },
          ip: a.ip,
        }),
      );
      throw new UnprocessableEntityException((e as Error).message);
    }
    await this.db.tx(async (c) => {
      await c.query(`UPDATE tenants SET timezone = $2 WHERE id = $1`, [
        r.tenantId,
        b.timezone ?? 'America/Sao_Paulo',
      ]);
      if (b.profile) await saveProfile(c, r.tenantId, b.profile);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant_created',
        entity: 'tenant',
        entityId: r.tenantId,
        tenantId: r.tenantId,
        data: {
          slug: b.slug,
          name: b.name,
          adminEmail: b.adminEmail,
          planCode: b.planCode ?? null,
          timezone: b.timezone ?? 'America/Sao_Paulo',
        },
        ip: a.ip,
      });
    });
    return this.tenant(r.tenantId);
  }

  // ------------------------------------------------------------------ controle do restaurante
  /** Equipe do restaurante com o último uso de cada pessoa (sem dados operacionais). */
  async team(tenantId: string) {
    await this.mustExist(tenantId);
    const h = await this.tenantDbOrNull(tenantId);
    if (!h) return [];
    return h.query(
      `SELECT u.id, u.name, u.email::text AS email, m.role, m.status, u.disabled_at AS "disabledAt",
              m.created_at AS "createdAt",
              (SELECT max(s.last_seen_at) FROM sessions s
                WHERE s.tenant_id = m.tenant_id AND s.user_id = m.user_id) AS "lastSeenAt",
              (SELECT count(*)::int FROM sessions s
                WHERE s.tenant_id = m.tenant_id AND s.user_id = m.user_id
                  AND s.revoked_at IS NULL AND s.expires_at > now()) AS "activeSessions",
              (SELECT count(*)::int FROM memberships o
                WHERE o.user_id = m.user_id AND o.tenant_id <> m.tenant_id AND o.status = 'active')
                AS "otherTenants"
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1
        ORDER BY m.status, (m.role = 'owner') DESC, u.name`,
      [tenantId],
    );
  }

  /**
   * Link de uso único (2 minutos) que abre o sistema do restaurante já logado, como o membro
   * escolhido (padrão: o primeiro administrador ativo). A sessão fica marcada como suporte.
   */
  async supportAccess(tenantId: string, userId: string | undefined, a: Actor) {
    const t = (
      await this.db.query<{ slug: string; status: string }>(
        `SELECT slug, status FROM tenants WHERE id = $1`,
        [tenantId],
      )
    )[0];
    if (!t) throw new NotFoundException('Restaurante não encontrado');
    if (t.status !== 'provisioned')
      throw new ConflictException('Só dá para abrir um restaurante ativo');
    const h = await this.tenantDbOrConflict(tenantId);
    const token = randomBytes(32).toString('base64url');
    // O token fica no banco do restaurante (é lá que o login de suporte o troca por uma sessão).
    const { member, expiresAt } = await h.tx(async (c) => {
      const member = (
        await c.query<{ id: string; name: string; email: string }>(
          `SELECT u.id, u.name, u.email::text AS email FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.tenant_id = $1 AND m.status = 'active' AND u.disabled_at IS NULL
              AND ($2::uuid IS NULL OR u.id = $2::uuid)
            ORDER BY (m.role = 'owner') DESC, m.created_at LIMIT 1`,
          [tenantId, userId ?? null],
        )
      ).rows[0];
      if (!member) throw new UnprocessableEntityException('Nenhum membro ativo para entrar');
      const r = await c.query<{ expires_at: Date }>(
        `INSERT INTO support_access_tokens (tenant_id, user_id, admin_id, admin_name, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '2 minutes') RETURNING expires_at`,
        [
          tenantId,
          member.id,
          a.admin.id,
          a.admin.name,
          createHash('sha256').update(token).digest(),
        ],
      );
      return { member, expiresAt: r.rows[0]!.expires_at };
    });
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant.support_access',
        entity: 'user',
        entityId: member.id,
        tenantId,
        data: { as: member.email },
        ip: a.ip,
      }),
    );
    return { slug: t.slug, token, expiresAt, user: member };
  }

  /** Encerra as sessões abertas do restaurante (todas ou só de um membro). */
  async revokeSessions(tenantId: string, userId: string | undefined, a: Actor) {
    await this.mustExist(tenantId);
    const h = await this.tenantDbOrConflict(tenantId);
    const r = await h.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE tenant_id = $1 AND ($2::uuid IS NULL OR user_id = $2::uuid)
          AND revoked_at IS NULL AND expires_at > now() RETURNING id`,
      [tenantId, userId ?? null],
    );
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant.sessions_revoked',
        entity: userId ? 'user' : 'tenant',
        entityId: userId ?? tenantId,
        tenantId,
        data: { count: r.length },
        ip: a.ip,
      }),
    );
    return { revoked: r.length };
  }

  /**
   * Nova senha para um membro. A conta é única por e-mail: vale em todos os restaurantes da
   * pessoa, e todas as sessões dela são encerradas. A senha nunca é auditada.
   */
  async resetPassword(tenantId: string, userId: string, password: string, a: Actor) {
    const hash = await hashPassword(password);
    const h = await this.tenantDbOrConflict(tenantId);
    const revoked = await h.tx(async (c) => {
      const m = await c.query(`SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [
        tenantId,
        userId,
      ]);
      if (!m.rowCount) throw new NotFoundException('Membro não encontrado neste restaurante');
      await c.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hash]);
      const r = await c.query(
        `UPDATE sessions SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [userId],
      );
      await c.query(
        `INSERT INTO audit_log (tenant_id, action, entity, entity_id, data)
         VALUES ($1::uuid, 'user.password_reset', 'user', $2::text, '{"by":"platform"}'::jsonb)`,
        [tenantId, userId],
      );
      return r.rowCount ?? 0;
    });
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.user.password_reset',
        entity: 'user',
        entityId: userId,
        tenantId,
        data: { sessionsRevoked: revoked },
        ip: a.ip,
      }),
    );
    return { ok: true };
  }

  /** Cadastro do cliente (contato e cobrança): só no banco central, só o painel vê. */
  async updateProfile(tenantId: string, b: TenantProfileInput, a: Actor) {
    await this.db.tx(async (c) => {
      const t = await c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
      if (!t.rowCount) throw new NotFoundException('Restaurante não encontrado');
      await saveProfile(c, tenantId, b);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant.profile_updated',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: { fields: Object.keys(b).filter((k) => k !== 'notes') },
        ip: a.ip,
      });
    });
    return this.tenant(tenantId);
  }

  async renameTenant(tenantId: string, name: string, a: Actor) {
    await this.db.tx(async (c) => {
      const r = await c.query<{ old: string }>(
        `UPDATE tenants t SET name = $2 FROM (SELECT id, name AS old FROM tenants WHERE id = $1) o
          WHERE t.id = o.id RETURNING o.old`,
        [tenantId, name],
      );
      if (!r.rowCount) throw new NotFoundException('Restaurante não encontrado');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant.renamed',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: { from: r.rows[0]!.old, to: name },
        ip: a.ip,
      });
    });
    await this.mirror(tenantId, `UPDATE tenants SET name = $2 WHERE id = $1`, [tenantId, name]);
    return this.tenant(tenantId);
  }

  /**
   * Repete no banco do restaurante o que mudou no central (nome, situação, histórico). Se o
   * restaurante fica no central, a mudança já foi feita lá e aqui só o histórico é gravado.
   */
  private async mirror(tenantId: string, sql: string, p: unknown[]) {
    const h = await this.tenantDbOrNull(tenantId);
    if (!h) return;
    if (h.location.kind === 'shared' && sql.startsWith('UPDATE tenants')) return;
    await h.query(sql, p).catch(() => undefined);
  }

  private async mustExist(tenantId: string) {
    const r = await this.db.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
    if (!r.length) throw new NotFoundException('Restaurante não encontrado');
  }

  /** Suspende (bloqueia login e operação) ou reativa. Nada é apagado. */
  async setStatus(id: string, b: StatusInput, a: Actor) {
    const from = b.status === 'suspended' ? 'provisioned' : 'suspended';
    await this.db.tx(async (c) => {
      const r = await c.query<{ slug: string }>(
        `UPDATE tenants SET status = $2 WHERE id = $1 AND status = $3 RETURNING slug`,
        [id, b.status, from],
      );
      if (!r.rowCount) {
        const cur = await c.query(`SELECT status FROM tenants WHERE id = $1`, [id]);
        if (!cur.rowCount) throw new NotFoundException('Restaurante não encontrado');
        throw new ConflictException(
          b.status === 'suspended'
            ? 'Só um restaurante ativo pode ser suspenso'
            : 'Só um restaurante suspenso pode ser reativado',
        );
      }
      const action = b.status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated';
      await platformAudit(c, {
        adminId: a.admin.id,
        action: `platform.${action}`,
        entity: 'tenant',
        entityId: id,
        tenantId: id,
        data: { reason: b.reason },
        ip: a.ip,
      });
    });
    // Também no banco do restaurante: situação e histórico (visível para ele depois de reativado).
    await this.mirror(id, `UPDATE tenants SET status = $2 WHERE id = $1`, [id, b.status]);
    await this.mirror(
      id,
      `INSERT INTO audit_log (tenant_id, action, entity, entity_id, data)
       VALUES ($1::uuid, $2, 'tenant', $1::text, jsonb_build_object('by', 'platform', 'reason', $3::text))`,
      [id, b.status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated', b.reason],
    );
    return this.tenant(id);
  }

  /** Cria, altera ou cancela a assinatura viva. Trocar de plano não apaga nem bloqueia nada já criado. */
  async setSubscription(tenantId: string, b: SubscriptionInput, a: Actor) {
    await this.db.tx(async (c) => {
      const t = await c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
      if (!t.rowCount) throw new NotFoundException('Restaurante não encontrado');
      const cur = (
        await c.query(
          `SELECT ${SUB_COLS} FROM subscriptions s WHERE s.tenant_id = $1 AND s.status <> 'cancelled' FOR UPDATE`,
          [tenantId],
        )
      ).rows[0] as { id: string; planId: string; status: string } | undefined;

      if (b.status === 'cancelled') {
        if (!cur) throw new NotFoundException('Sem assinatura ativa para cancelar');
        await c.query(
          `UPDATE subscriptions SET status = 'cancelled', cancelled_at = now(), notes = coalesce($2, notes)
            WHERE id = $1`,
          [cur.id, b.notes ?? null],
        );
      } else {
        const plan = (
          await c.query<{ id: string; active: boolean; trial_days: number }>(
            `SELECT id, active, trial_days FROM plans WHERE id = $1`,
            [b.planId],
          )
        ).rows[0];
        if (!plan) throw new NotFoundException('Plano não encontrado');
        if (!plan.active && cur?.planId !== plan.id)
          throw new ConflictException('Plano inativo não recebe novas assinaturas');
        let trialEnds = b.trialEndsAt ?? null;
        if (b.status === 'trialing' && !trialEnds) {
          if (plan.trial_days <= 0)
            throw new UnprocessableEntityException('Informe até quando vai o período de teste');
          trialEnds = new Date(Date.now() + plan.trial_days * 86_400_000).toISOString();
        }
        const vals = [
          b.planId,
          b.status,
          b.status === 'trialing' ? trialEnds : null,
          b.currentPeriodEnd ?? null,
          b.notes ?? null,
        ];
        if (cur) {
          await c.query(
            `UPDATE subscriptions SET plan_id = $2, status = $3, trial_ends_at = $4,
                    current_period_end = $5, notes = $6 WHERE id = $1`,
            [cur.id, ...vals],
          );
        } else {
          await c.query(
            `INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at, current_period_end, notes)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [tenantId, ...vals],
          );
        }
      }
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.subscription_changed',
        entity: 'subscription',
        entityId: cur?.id ?? null,
        tenantId,
        data: {
          from: cur ? { planId: cur.planId, status: cur.status } : null,
          to: { planId: b.planId ?? cur?.planId ?? null, status: b.status },
          notes: b.notes ?? null,
        },
        ip: a.ip,
      });
    });
    return this.tenant(tenantId);
  }

  async removeDomain(tenantId: string, domainId: string, a: Actor) {
    await this.db.tx(async (c) => {
      const r = await c.query<{ hostname: string }>(
        `UPDATE tenant_domains SET removed_at = now()
          WHERE id = $1 AND tenant_id = $2 AND removed_at IS NULL RETURNING hostname::text AS hostname`,
        [domainId, tenantId],
      );
      if (!r.rowCount) throw new NotFoundException('Domínio não encontrado');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.domain_removed',
        entity: 'tenant_domain',
        entityId: domainId,
        tenantId,
        data: { hostname: r.rows[0].hostname },
        ip: a.ip,
      });
    });
    return this.tenant(tenantId);
  }

  // ------------------------------------------------------------------ planos
  listPlans() {
    return this.db.query(
      `SELECT ${PLAN_COLS},
              (SELECT count(*)::int FROM subscriptions s WHERE s.plan_id = plans.id AND s.status <> 'cancelled') AS "subscribers"
         FROM plans ORDER BY active DESC, price_monthly, name`,
    );
  }

  private planValues(b: PlanInput) {
    return [
      b.name,
      b.priceMonthly,
      b.maxUsers ?? null,
      b.maxProducts ?? null,
      b.maxOrdersMonth ?? null,
      b.featureFiscal,
      b.featureWhatsapp,
      b.featureCustomDomain,
      b.trialDays,
      b.isDefault,
      b.active,
    ];
  }

  private async clearDefault(c: PoolClient, b: PlanInput, keepId?: string) {
    if (b.isDefault)
      await c.query(
        `UPDATE plans SET is_default = false WHERE is_default AND id IS DISTINCT FROM $1`,
        [keepId ?? null],
      );
  }

  async createPlan(b: PlanInput & { code: string }, a: Actor) {
    if (b.isDefault && !b.active)
      throw new UnprocessableEntityException('O plano padrão precisa estar ativo');
    return this.db.tx(async (c) => {
      await this.clearDefault(c, b);
      let row;
      try {
        row = (
          await c.query(
            `INSERT INTO plans (code, name, price_monthly, max_users, max_products, max_orders_month,
               feature_fiscal, feature_whatsapp, feature_custom_domain, trial_days, is_default, active)
             VALUES ($12,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${PLAN_COLS}`,
            [...this.planValues(b), b.code],
          )
        ).rows[0];
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new ConflictException('Já existe um plano com este código');
        throw e;
      }
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.plan_created',
        entity: 'plan',
        entityId: row.id,
        data: { ...b },
        ip: a.ip,
      });
      return row;
    });
  }

  async updatePlan(id: string, b: PlanInput, a: Actor) {
    if (b.isDefault && !b.active)
      throw new UnprocessableEntityException('O plano padrão precisa estar ativo');
    return this.db.tx(async (c) => {
      const before = (
        await c.query(`SELECT ${PLAN_COLS} FROM plans WHERE id = $1 FOR UPDATE`, [id])
      ).rows[0];
      if (!before) throw new NotFoundException('Plano não encontrado');
      await this.clearDefault(c, b, id);
      const row = (
        await c.query(
          `UPDATE plans SET name=$1, price_monthly=$2, max_users=$3, max_products=$4, max_orders_month=$5,
             feature_fiscal=$6, feature_whatsapp=$7, feature_custom_domain=$8, trial_days=$9,
             is_default=$10, active=$11
           WHERE id = $12 RETURNING ${PLAN_COLS}`,
          [...this.planValues(b), id],
        )
      ).rows[0];
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.plan_updated',
        entity: 'plan',
        entityId: id,
        data: { before, after: row },
        ip: a.ip,
      });
      return row;
    });
  }

  // ------------------------------------------------------------------ auditoria e backups
  audit(f: { tenantId?: string; limit: number }) {
    const p: unknown[] = [f.limit];
    let where = '';
    if (f.tenantId) {
      p.push(f.tenantId);
      where = `WHERE l.tenant_id = $2`;
    }
    return this.db.query(
      `SELECT l.id, l.action, l.entity, l.entity_id AS "entityId", l.tenant_id AS "tenantId",
              t.slug AS "tenantSlug", l.data, l.ip::text AS ip, l.created_at AS "createdAt",
              a.name AS "adminName", a.email::text AS "adminEmail"
         FROM platform_audit_log l
         LEFT JOIN platform_admins a ON a.id = l.admin_id
         LEFT JOIN tenants t ON t.id = l.tenant_id
         ${where} ORDER BY l.created_at DESC LIMIT $1`,
      p,
    );
  }

  backups() {
    return this.db.query(
      `SELECT b.id, b.kind, b.status, b.started_at AS "startedAt", b.finished_at AS "finishedAt",
              b.object_key AS "objectKey", b.size_bytes AS "sizeBytes", b.sha256, b.details, b.error,
              b.database, b.tenant_id AS "tenantId", t.slug AS "tenantSlug", t.name AS "tenantName"
         FROM backup_runs b LEFT JOIN tenants t ON t.id = b.tenant_id
        ORDER BY b.started_at DESC LIMIT 100`,
    );
  }

  /**
   * Pastas do bucket: a da plataforma (banco central, com os restaurantes que ainda estão nele)
   * e uma por restaurante com banco próprio, com o último backup de cada.
   */
  async backupFolders() {
    const [s] = await this.db.query<{ prefix: string }>(
      `SELECT prefix FROM platform_backup_settings WHERE id`,
    );
    const prefix = (s?.prefix ?? 'comandou').replace(/^\/+|\/+$/g, '');
    const last = `SELECT status, finished_at AS "finishedAt", started_at AS "startedAt",
                         size_bytes AS "sizeBytes", object_key AS "objectKey", error
                    FROM backup_runs b WHERE b.kind = 'backup'`;
    const [central] = await this.db.query(
      `${last} AND b.tenant_id IS NULL AND NOT coalesce((b.details->>'final')::boolean, false)
        ORDER BY b.started_at DESC LIMIT 1`,
    );
    const tenants = await this.db.query(
      `SELECT t.id, t.slug, t.name, t.status, d.db_name AS "database", d.status AS "databaseStatus",
              to_jsonb(lb) AS "lastBackup"
         FROM tenants t
         LEFT JOIN tenant_databases d ON d.tenant_id = t.id
         LEFT JOIN LATERAL (${last} AND b.tenant_id = t.id ORDER BY b.started_at DESC LIMIT 1) lb ON true
        ORDER BY t.slug`,
    );
    return {
      prefix,
      platform: { folder: `${prefix}/plataforma/`, lastBackup: central ?? null },
      tenants: tenants.map((t) => ({
        ...t,
        folder: t.database ? `${prefix}/restaurantes/${t.slug}/` : null,
      })),
    };
  }
}
