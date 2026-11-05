/**
 * Textos dos planos usados na página pública /precos e nos cartões da tela Assinatura. Tudo que
 * muda por plano vem do Super Admin → Planos; aqui fica só o que vale para todos.
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

/** O que todo plano tem (o sistema é o mesmo; muda o tamanho e alguns extras). */
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
    q: 'Como funciona o teste grátis?',
    a: 'Você usa o sistema completo durante os dias de teste, sem cartão. Antes de acabar, a primeira fatura chega no seu e-mail.',
  },
  {
    q: 'Como eu pago?',
    a: 'Por Pix, boleto ou cartão de crédito. No cartão, a mensalidade sai sozinha no vencimento e você não precisa lembrar. No Pix, a fatura chega alguns dias antes no e-mail e aparece na tela Assinatura.',
  },
  {
    q: 'Posso trocar de plano?',
    a: 'Sim, na tela Assinatura. Subir vale na hora e você paga só a diferença dos dias que faltam. Descer vale a partir do próximo mês, sem multa.',
  },
  {
    q: 'Tem fidelidade?',
    a: 'O contrato é anual, mas a mensalidade é paga mês a mês. Fale com a gente se precisar parar.',
  },
  {
    q: 'E se eu atrasar?',
    a: 'Depois do vencimento, o sistema entra em modo só leitura: dá para consultar tudo e pagar, mas não lançar vendas. Pagou, libera na hora. Nenhum dado é apagado.',
  },
  {
    q: 'Passei do limite do plano. Perco algo?',
    a: 'Nada é apagado. Você só não consegue criar mais (pessoas, produtos ou pedidos) até subir de plano ou o mês virar.',
  },
];

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
