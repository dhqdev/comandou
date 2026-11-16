/**
 * Planos e limites. Limite null = ilimitado. Sem assinatura viva (não cancelada), nenhum limite
 * de plano se aplica: o acesso só é bloqueado suspendendo o restaurante no painel.
 */
export type PlanResource = 'users' | 'products' | 'orders_month';
export type PlanFeature = 'fiscal' | 'whatsapp' | 'custom_domain';

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Em teste',
  active: 'Ativa',
  past_due: 'Pagamento pendente',
  cancelled: 'Cancelada',
};

export const RESOURCE_LABELS: Record<PlanResource, string> = {
  users: 'pessoas na equipe',
  products: 'produtos ativos',
  orders_month: 'pedidos no mês',
};

export const FEATURE_LABELS: Record<PlanFeature, string> = {
  fiscal: 'Nota fiscal (NFC-e)',
  whatsapp: 'Mensagens no WhatsApp',
  custom_domain: 'Domínio próprio',
};

export interface PlanLimits {
  users: number | null;
  products: number | null;
  orders_month: number | null;
}

/** Cabe mais `adding` unidades? `used` é o uso atual. */
export function withinLimit(limit: number | null, used: number, adding = 1): boolean {
  return limit === null || used + adding <= limit;
}

/**
 * Valor único: desde 0.128.0 o Comandou tem um preço só (o plano com este código), sem cobrança
 * por pessoa, produto ou pedido. Os planos antigos ficam inativos e quem ainda está neles passa
 * para este na próxima mensalidade.
 */
export const SINGLE_PLAN_CODE = 'comandou';
