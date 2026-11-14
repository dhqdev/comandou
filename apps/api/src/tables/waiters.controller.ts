import { Controller, Get } from '@nestjs/common';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

/** "Hoje" no fuso do restaurante (o dia vira à meia-noite local, não em UTC). */
const TODAY = `(date_trunc('day', now() AT TIME ZONE
  COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()), 'America/Sao_Paulo'))
  AT TIME ZONE COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()), 'America/Sao_Paulo'))`;

/** Números de um garçom: pedidos lançados (não cancelados) no total e hoje. */
const STATS = `
  count(o.id)::int AS "totalOrders",
  count(o.id) FILTER (WHERE o.created_at >= ${TODAY})::int AS "todayOrders",
  count(DISTINCT o.tab_id) FILTER (WHERE o.created_at >= ${TODAY})::int AS "todayTables",
  COALESCE(sum(o.total) FILTER (WHERE o.created_at >= ${TODAY}), 0)::text AS "todaySales"`;

interface StatsRow {
  totalOrders: number;
  todayOrders: number;
  todayTables: number;
  todaySales: string;
}

/**
 * App do garçom: os números que alimentam os desafios e selos (como no Anota AI) e, para o
 * gerente, a lista "Meus garçons" com o desempenho de cada um.
 */
@Controller({ version: '1' })
export class WaitersController {
  constructor(private readonly db: DatabaseService) {}

  /** Desafios do próprio garçom (qualquer pessoa do salão pode ver os seus). */
  @Get('waiter/me')
  @RequirePermission('tables:operate')
  async me(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    const r = await this.db.withTenant(ctxOf(t, u), (tx) =>
      one<StatsRow & { since: Date | null }>(
        tx,
        `SELECT ${STATS},
                (SELECT m.created_at FROM memberships m WHERE m.user_id = $1) AS since
           FROM orders o
          WHERE o.created_by = $1 AND o.status <> 'cancelled'`,
        [u.id],
      ),
    );
    return {
      name: u.name,
      since: r?.since ?? null,
      totalOrders: r?.totalOrders ?? 0,
      today: {
        orders: r?.todayOrders ?? 0,
        tables: r?.todayTables ?? 0,
        sales: r?.todaySales ?? '0',
      },
    };
  }

  /** Meus garçons: ativos e inativos, com pedidos de hoje e o total (para o selo). */
  @Get('waiters')
  @RequirePermission('users:manage', 'reports:read')
  list(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `SELECT u.id, u.name, u.email, m.status, m.created_at AS "createdAt",
                (m.pin_hash IS NOT NULL) AS "hasPin",
                (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS "lastSeenAt",
                ${STATS}
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN orders o ON o.created_by = u.id AND o.status <> 'cancelled'
          WHERE m.role = 'waiter'
          GROUP BY u.id, u.name, u.email, m.status, m.created_at, m.pin_hash
          ORDER BY m.status, u.name`,
      ),
    );
  }
}
