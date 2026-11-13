import type { FiscalCosts } from '@comandou/shared';

/** Um custo de terceiro mostrado no orçamento (certificado, domínio, equipamentos...). */
export interface ExtraCost {
  label: string;
  value: string;
}

/** Orçamento congelado no banco: o PDF é sempre refeito a partir disto. */
export interface QuoteContent {
  version: 1;
  number: string;
  issuedAt: string;
  validUntil: string;
  provider: {
    name: string;
    document: string | null;
    email: string | null;
    representative: string | null;
  };
  client: {
    name: string;
    document: string | null;
    contact: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
  };
  plan: {
    name: string;
    priceMonthly: string;
    trialDays: number;
    included: string[];
  };
  setupFee: string;
  fiscal: {
    enabled: boolean;
    costs: FiscalCosts;
    nfcePerMonth: number;
    nfePerMonth: number;
    estimateCents: number;
    clause: string;
  };
  onlinePay: { percent: string; fixed: string } | null;
  extraCosts: ExtraCost[];
  conditions: string[];
  notes: string;
  totals: { monthlyCents: number; firstPaymentCents: number };
}

/** O que vem com o plano, na ordem em que o restaurante usa. */
export function planIncluded(p: {
  max_users: number | null;
  max_products: number | null;
  max_orders_month: number | null;
  feature_fiscal: boolean;
  feature_whatsapp: boolean;
  feature_custom_domain: boolean;
}): string[] {
  const lim = (v: number | null, what: string) =>
    v === null ? null : `até ${v.toLocaleString('pt-BR')} ${what}`;
  const limits = [
    lim(p.max_users, 'pessoas na equipe'),
    lim(p.max_products, 'produtos'),
    lim(p.max_orders_month, 'pedidos por mês'),
  ].filter(Boolean);
  return [
    limits.length
      ? `Limites do plano: ${limits.join(', ')}`
      : 'Sem limite de equipe, produtos, pedidos, mesas ou pontos de venda',
    'PDV, pedidos e comandas (balcão, mesa, delivery e retirada)',
    'Salão com mapa de mesas, QR Code na mesa e garçom pelo celular',
    'Cozinha em tempo real por setor, com impressão de pedidos',
    'Caixa com abertura, suprimento, sangria e fechamento conferido',
    'Cardápio e loja online próprios, com conta do cliente e pontos de fidelidade',
    'Entregas com entregador pelo celular, mapa e repasse',
    'Reservas, estoque, ficha técnica, fornecedores e compras',
    'Financeiro, contas a pagar e receber e relatórios',
    p.feature_fiscal
      ? 'Nota fiscal: NFC-e e NF-e, cancelamento, inutilização e notas recebidas'
      : null,
    p.feature_whatsapp ? 'Avisos e atendimento pelo WhatsApp do restaurante' : null,
    p.feature_custom_domain ? 'Domínio próprio para a loja online (opcional)' : null,
    'App para computador, tablet e celular, que continua vendendo sem internet',
    'Hospedagem, backups diários cifrados, atualizações e suporte',
  ].filter((x): x is string => !!x);
}
