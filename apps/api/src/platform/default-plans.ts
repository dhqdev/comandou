import type { ClientBase } from 'pg';

/**
 * Planos que já vêm no sistema. Entram uma vez só, quando a plataforma ainda não tem nenhum
 * plano (instalação nova ou que nunca criou plano). Depois disso o painel manda: dá para mudar
 * preço e limites, desligar ou criar outros, e nada aqui sobrescreve.
 */
export const DEFAULT_PLANS = [
  {
    code: 'essencial',
    name: 'Essencial',
    priceMonthly: '89.90',
    maxUsers: 5,
    maxProducts: 200,
    maxOrdersMonth: 1500,
    featureFiscal: false,
    featureWhatsapp: true,
    featureCustomDomain: false,
    trialDays: 14,
    isDefault: true,
  },
  {
    code: 'profissional',
    name: 'Profissional',
    priceMonthly: '179.90',
    maxUsers: 15,
    maxProducts: 800,
    maxOrdersMonth: 6000,
    featureFiscal: true,
    featureWhatsapp: true,
    featureCustomDomain: false,
    trialDays: 14,
    isDefault: false,
  },
  {
    code: 'premium',
    name: 'Premium',
    priceMonthly: '319.90',
    maxUsers: null,
    maxProducts: null,
    maxOrdersMonth: null,
    featureFiscal: true,
    featureWhatsapp: true,
    featureCustomDomain: true,
    trialDays: 14,
    isDefault: false,
  },
] as const;

/** Cria os planos padrão se não existe nenhum plano. Devolve quantos criou. */
export async function seedDefaultPlans(c: ClientBase): Promise<number> {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('comandou.default_plans'))`);
  const { rows } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM plans`);
  if (rows[0]!.n > 0) return 0;
  for (const p of DEFAULT_PLANS)
    await c.query(
      `INSERT INTO plans (code, name, price_monthly, max_users, max_products, max_orders_month,
                          feature_fiscal, feature_whatsapp, feature_custom_domain, trial_days,
                          is_default, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
       ON CONFLICT (code) DO NOTHING`,
      [
        p.code,
        p.name,
        p.priceMonthly,
        p.maxUsers,
        p.maxProducts,
        p.maxOrdersMonth,
        p.featureFiscal,
        p.featureWhatsapp,
        p.featureCustomDomain,
        p.trialDays,
        p.isDefault,
      ],
    );
  return DEFAULT_PLANS.length;
}
