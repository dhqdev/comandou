/**
 * Textos dos planos usados na página pública /precos e nos cartões da tela Assinatura. Tudo que
 * muda por plano vem do Super Admin → Preço; aqui fica só o que vale para todos.
 */
export interface PublicPlan {
  id: string;
  name: string;
  priceMonthly: string;
  trialDays?: number;
  maxUsers: number | null;
  maxProducts: number | null;
  maxOrdersMonth: number | null;
  featureFiscal: boolean;
  featureWhatsapp: boolean;
  featureCustomDomain: boolean;
  tagline?: string;
  highlights?: string[];
  featured?: boolean;
}

const n = (v: number) => v.toLocaleString('pt-BR');

export const limitLabel = (v: number | null, unit: string) =>
  v === null ? `${unit[0]!.toUpperCase()}${unit.slice(1)} sem limite` : `Até ${n(v)} ${unit}`;

/** Destaques do cartão: os escritos no Super Admin; sem eles, os limites e extras do plano. */
export function planBullets(p: PublicPlan): string[] {
  if (p.highlights && p.highlights.length) return p.highlights;
  return [
    limitLabel(p.maxUsers, 'pessoas na equipe'),
    limitLabel(p.maxProducts, 'produtos'),
    limitLabel(p.maxOrdersMonth, 'pedidos por mês'),
    ...(p.featureFiscal ? ['Nota fiscal (NFC-e)'] : []),
    ...(p.featureWhatsapp ? ['Avisos no WhatsApp'] : []),
    ...(p.featureCustomDomain ? ['Domínio próprio'] : []),
  ];
}

/** O que o Comandou inclui (o sistema inteiro, para qualquer restaurante). */
export const INCLUDED_IN_ALL = [
  'PDV e caixa',
  'Mesas, comandas e app do garçom',
  'Tela da cozinha',
  'Cardápio online e pedidos pelo celular',
  'Delivery com rastreio e app do entregador',
  'Estoque e ficha técnica',
  'Financeiro e relatórios',
  'Reservas e clientes',
  'Suporte pelo chat',
];

export const PRICING_FAQ: { q: string; a: string }[] = [
  {
    q: 'O preço muda com o tamanho do restaurante?',
    a: 'Não. É um valor único por mês, com tudo do sistema, para qualquer número de pessoas na equipe, produtos e pedidos. Não tem plano maior nem cobrança por usuário.',
  },
  {
    q: 'Como funciona o teste grátis?',
    a: 'Você usa o sistema completo durante os dias de teste, sem cartão. Quando o teste vence, a mensalidade é o valor único, e a primeira fatura chega no seu e-mail alguns dias antes.',
  },
  {
    q: 'Como eu pago?',
    a: 'Por Pix, boleto ou cartão de crédito. No cartão, a mensalidade sai sozinha no vencimento e você não precisa lembrar. No Pix, a fatura chega alguns dias antes no e-mail e aparece na tela Assinatura.',
  },
  {
    q: 'Tem fidelidade?',
    a: 'O contrato é anual, mas a mensalidade é paga mês a mês. Fale com a gente se precisar parar.',
  },
  {
    q: 'E se eu atrasar?',
    a: 'Depois do vencimento, o sistema entra em modo só leitura: dá para consultar tudo e pagar, mas não lançar vendas. Pagou, libera na hora. Nenhum dado é apagado.',
  },
];

/** O plano do valor único: o destacado, senão o primeiro que a API mandar. */
export function singlePlan<T extends { featured?: boolean }>(plans: T[]): T | null {
  return plans.find((p) => p.featured) ?? plans[0] ?? null;
}

/** Lista do valor único: os destaques do Super Admin (ou os extras) e tudo que o sistema tem. */
export function singlePlanList(p: PublicPlan): string[] {
  const extras = [
    ...(p.featureFiscal ? ['Nota fiscal (NFC-e)'] : []),
    ...(p.featureWhatsapp ? ['Avisos no WhatsApp'] : []),
    ...(p.featureCustomDomain ? ['Domínio próprio'] : []),
  ];
  const top = p.highlights && p.highlights.length ? p.highlights : extras;
  const all = ['Sem limite de equipe, produtos e pedidos', ...top, ...INCLUDED_IN_ALL];
  return [...new Set(all)];
}

/** Link do botão "Falar com a gente": WhatsApp (número), e-mail ou endereço. */
export function contactHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes('@')) return `mailto:${v}`;
  const digits = v.replace(/\D/g, '');
  if (digits.length >= 10) return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
  return null;
}
