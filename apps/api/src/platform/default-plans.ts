import type { ClientBase } from 'pg';

/**
 * Planos que já vêm no sistema. Entram uma vez só, quando a plataforma ainda não tem nenhum
 * plano (instalação nova ou que nunca criou plano). Depois disso o painel manda: dá para mudar
 * preço e limites, desligar ou criar outros, e nada aqui sobrescreve.
 */
export const DEFAULT_PLANS = [
  {
    // Plano único (0065): tudo do sistema por R$ 400,00 fixos por mês, sem limites.
    code: 'comandou',
    name: 'Comandou',
    priceMonthly: '400.00',
    maxUsers: null,
    maxProducts: null,
    maxOrdersMonth: null,
    featureFiscal: true,
    featureWhatsapp: true,
    featureCustomDomain: true,
    trialDays: 7,
    isDefault: true,
    tagline: 'Tudo do sistema por um valor fixo, sem cobrança por pedido',
    highlights: [
      'Sem limite de equipe, produtos e pedidos',
      'PDV, salão, cozinha, caixa e entregas',
      'Cardápio online próprio e WhatsApp',
      'Nota fiscal (NFC-e e NF-e)',
    ],
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
                          is_default, active, tagline, highlights, featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $13, true)
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
        p.tagline,
        JSON.stringify(p.highlights),
      ],
    );
  return DEFAULT_PLANS.length;
}
