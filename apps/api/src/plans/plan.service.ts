import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  FEATURE_LABELS,
  PlanFeature,
  PlanLimits,
  PlanResource,
  RESOURCE_LABELS,
  SubscriptionStatus,
  withinLimit,
} from '@comandou/shared';
import { one } from '../common/sql';
import type { Tx } from '../database/database.service';

export interface CurrentPlan {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    startedAt: Date;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
  };
  plan: {
    id: string;
    code: string;
    name: string;
    priceMonthly: string;
    limits: PlanLimits;
    features: Record<PlanFeature, boolean>;
  };
}

interface Row {
  sub_id: string;
  status: SubscriptionStatus;
  started_at: Date;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  plan_id: string;
  code: string;
  name: string;
  price_monthly: string;
  max_users: number | null;
  max_products: number | null;
  max_orders_month: number | null;
  feature_fiscal: boolean;
  feature_whatsapp: boolean;
  feature_custom_domain: boolean;
}

/** Contagens usadas pelos limites. Rodam com o RLS do restaurante (só veem os dados dele). */
const USAGE_SQL: Record<PlanResource, string> = {
  users: `SELECT count(*)::int AS n FROM memberships WHERE status = 'active'`,
  products: `SELECT count(*)::int AS n FROM products WHERE active`,
  orders_month: `SELECT count(*)::int AS n FROM orders o, tenants t
                  WHERE o.created_at >= (date_trunc('month', now() AT TIME ZONE t.timezone) AT TIME ZONE t.timezone)`,
};

/**
 * Plano do restaurante e aplicação dos limites. Sempre dentro da transação da operação, com o
 * RLS do restaurante: o tenant vem do contexto (Host + sessão), nunca do cliente.
 * Sem assinatura viva, nenhum limite se aplica (ver packages/shared/src/plans.ts).
 */
@Injectable()
export class PlanService {
  async current(tx: Tx): Promise<CurrentPlan | null> {
    const r = await one<Row>(
      tx,
      `SELECT s.id AS sub_id, s.status, s.started_at, s.trial_ends_at, s.current_period_end,
              p.id AS plan_id, p.code, p.name, p.price_monthly, p.max_users, p.max_products,
              p.max_orders_month, p.feature_fiscal, p.feature_whatsapp, p.feature_custom_domain
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.status <> 'cancelled'
        LIMIT 1`,
    );
    if (!r) return null;
    return {
      subscription: {
        id: r.sub_id,
        status: r.status,
        startedAt: r.started_at,
        trialEndsAt: r.trial_ends_at,
        currentPeriodEnd: r.current_period_end,
      },
      plan: {
        id: r.plan_id,
        code: r.code,
        name: r.name,
        priceMonthly: r.price_monthly,
        limits: {
          users: r.max_users,
          products: r.max_products,
          orders_month: r.max_orders_month,
        },
        features: {
          fiscal: r.feature_fiscal,
          whatsapp: r.feature_whatsapp,
          custom_domain: r.feature_custom_domain,
        },
      },
    };
  }

  async usage(tx: Tx, resource: PlanResource): Promise<number> {
    return (await one<{ n: number }>(tx, USAGE_SQL[resource]))!.n;
  }

  async usageAll(tx: Tx): Promise<Record<PlanResource, number>> {
    return {
      users: await this.usage(tx, 'users'),
      products: await this.usage(tx, 'products'),
      orders_month: await this.usage(tx, 'orders_month'),
    };
  }

  /** Lança 403 se adicionar `adding` unidades passar do limite do plano. */
  async assertCanAdd(tx: Tx, resource: PlanResource, adding = 1): Promise<void> {
    const cur = await this.current(tx);
    const limit = cur?.plan.limits[resource] ?? null;
    if (limit === null) return;
    const used = await this.usage(tx, resource);
    if (!withinLimit(limit, used, adding)) {
      throw new ForbiddenException(
        `Limite do plano ${cur!.plan.name} atingido: ${limit} ${RESOURCE_LABELS[resource]}. ` +
          'Fale com o suporte para mudar de plano.',
      );
    }
  }

  async hasFeature(tx: Tx, feature: PlanFeature): Promise<boolean> {
    const cur = await this.current(tx);
    return cur ? cur.plan.features[feature] : true;
  }

  async assertFeature(tx: Tx, feature: PlanFeature): Promise<void> {
    if (!(await this.hasFeature(tx, feature))) {
      throw new ForbiddenException(
        `Seu plano não inclui ${FEATURE_LABELS[feature]}. Fale com o suporte para mudar de plano.`,
      );
    }
  }
}
