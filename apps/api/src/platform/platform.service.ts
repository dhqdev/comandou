import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RELEASES } from '@pedemais/shared';
import type { PoolClient } from 'pg';
import { ENV, Env } from '../config/env';
import { HealthChecks } from '../health/checks.service';
import { provisionTenant } from '../provisioning/provision';
import { QueueService } from '../queue/queue.service';
import type { PlatformAdmin } from './platform-auth';
import { PlatformDb, platformAudit } from './platform-db.service';
import type { NewTenantInput, PlanInput, StatusInput, SubscriptionInput } from './platform.schemas';

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
 * Regras do painel Super Admin. Tudo pelo pool da plataforma (papel pedemais_platform) e com
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
  ) {}

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
    const last = await this.db.query(
      `SELECT DISTINCT ON (kind) kind, status, started_at AS "startedAt", finished_at AS "finishedAt",
              size_bytes AS "sizeBytes", error
         FROM backup_runs ORDER BY kind, started_at DESC`,
    );
    const lastOk = await this.db.query<{ kind: string; at: Date }>(
      `SELECT kind, max(finished_at) AS at FROM backup_runs WHERE status = 'ok' GROUP BY kind`,
    );
    const alerts = await this.db.query<{ fiscal: number; messages: number }>(
      `SELECT coalesce(sum(fiscal_errors), 0)::int AS fiscal, coalesce(sum(message_failures), 0)::int AS messages
         FROM platform_tenant_usage()`,
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
      last7Days: { fiscalErrors: alerts[0].fiscal, messageFailures: alerts[0].messages },
    };
  }

  // ------------------------------------------------------------------ restaurantes
  async listTenants(f: { search?: string; status?: string }) {
    const where: string[] = [];
    const p: unknown[] = [];
    if (f.search) {
      p.push(`%${f.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
      where.push(`(t.slug ILIKE $${p.length} OR t.name ILIKE $${p.length})`);
    }
    if (f.status) {
      p.push(f.status);
      where.push(`t.status = $${p.length}`);
    }
    return this.db.query(
      `SELECT t.id, t.slug, t.name, t.status, t.created_at AS "createdAt",
              s.status AS "subscriptionStatus", pl.name AS "planName",
              u.users::int, u.products::int, u.orders_month::int AS "ordersMonth",
              u.last_order_at AS "lastOrderAt"
         FROM tenants t
         LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled'
         LEFT JOIN plans pl ON pl.id = s.plan_id
         LEFT JOIN platform_tenant_usage() u ON u.tenant_id = t.id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY t.created_at DESC LIMIT 300`,
      p,
    );
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
    const [usage] = await this.db.query(
      `SELECT users::int, products::int, orders_month::int AS "ordersMonth", last_order_at AS "lastOrderAt",
              fiscal_errors::int AS "fiscalErrors", message_failures::int AS "messageFailures"
         FROM platform_tenant_usage() WHERE tenant_id = $1`,
      [id],
    );
    const domains = await this.db.query(
      `SELECT id, hostname::text AS hostname, verified_at AS "verifiedAt", last_error AS "lastError",
              created_at AS "createdAt"
         FROM tenant_domains WHERE tenant_id = $1 AND removed_at IS NULL ORDER BY created_at`,
      [id],
    );
    const owners = await this.db.query(
      `SELECT u.name, u.email::text AS email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1 AND m.role = 'owner' AND m.status = 'active' ORDER BY u.name`,
      [id],
    );
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
      usage,
      domains,
      owners,
      provisioning,
      audit,
    };
  }

  /** Cria e provisiona um restaurante (mesmo fluxo idempotente da CLI). A senha não é auditada. */
  async createTenant(b: NewTenantInput, a: Actor) {
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
    await this.db.tx((c) =>
      platformAudit(c, {
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
        },
        ip: a.ip,
      }),
    );
    return this.tenant(r.tenantId);
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
      // Também no histórico do restaurante (visível para ele depois de reativado).
      await c.query(
        `INSERT INTO audit_log (tenant_id, action, entity, entity_id, data)
         VALUES ($1::uuid, $2, 'tenant', $1::text, jsonb_build_object('by', 'platform', 'reason', $3::text))`,
        [id, action, b.reason],
      );
    });
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
      `SELECT id, kind, status, started_at AS "startedAt", finished_at AS "finishedAt",
              object_key AS "objectKey", size_bytes AS "sizeBytes", sha256, details, error
         FROM backup_runs ORDER BY started_at DESC LIMIT 60`,
    );
  }
}
