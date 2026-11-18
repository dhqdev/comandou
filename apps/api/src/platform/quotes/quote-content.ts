import type { FiscalCosts } from '@comandou/shared';
import { extenso } from '../contracts/contract-template';

/** "30 (trinta) dias" */
const qty = (n: number, one: string, many: string) =>
  `${n} (${extenso(n)}) ${n === 1 ? one : many}`;
/** "99.50" → "99,5%" */
const pctBR = (v: string) =>
  `${String(v)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
    .replace('.', ',')}%`;

/** Um custo de terceiro mostrado no orçamento (certificado, domínio, equipamentos...). */
export interface ExtraCost {
  label: string;
  value: string;
}

/**
 * Prazos escolhidos para este orçamento (versão 2). Orçamentos antigos não têm: o PDF usa o
 * teste do plano, 12 meses e a validade das datas.
 */
export interface QuoteTerms {
  /** Prazo da proposta em dias corridos (de issuedAt até validUntil). */
  validityDays: number;
  /** Dias de teste grátis oferecidos a este cliente (0 = sem teste). */
  trialDays: number;
  /** Vigência do contrato em meses. */
  termMonths: number;
  /** Prazo da implantação em dias úteis depois do aceite. */
  implementationDays: number;
  /** Dia do mês do vencimento e regras de atraso, copiados do contrato. */
  dueDay: number;
  lateFeePercent: string;
  lateInterestPercent: string;
  slaPercent: string;
  readjustIndex: string;
  supportHours: string;
  forumCity: string;
}

/** Orçamento congelado no banco: o PDF é sempre refeito a partir disto. */
export interface QuoteContent {
  version: 1 | 2;
  number: string;
  issuedAt: string;
  validUntil: string;
  provider: {
    name: string;
    document: string | null;
    email: string | null;
    representative: string | null;
    address?: string | null;
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
  /** Nível de serviço e suporte (versão 2). */
  service?: string[];
  /** Etapas da implantação (versão 2). */
  implementation?: string[];
  terms?: QuoteTerms;
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
      : 'Utilização sem limitação de usuários, produtos, pedidos, mesas ou pontos de venda',
    'Ponto de venda (PDV), gestão de pedidos e comandas nas modalidades balcão, mesa, entrega e retirada',
    'Gestão de salão com mapa de mesas, autoatendimento por QR Code e lançamento de pedidos pelo garçom via dispositivo móvel',
    'Painel de produção da cozinha em tempo real, segmentado por setor, com impressão automática de pedidos',
    'Controle de caixa com abertura, suprimento, sangria e fechamento conferido',
    'Cardápio digital e loja virtual próprios, com cadastro de clientes e programa de fidelidade',
    'Gestão de entregas com aplicativo do entregador, roteirização em mapa e apuração de repasses',
    'Reservas, controle de estoque, fichas técnicas com custeio automático, fornecedores e compras',
    'Gestão financeira com contas a pagar e a receber, conciliação e relatórios gerenciais',
    p.feature_fiscal
      ? 'Emissão de documentos fiscais eletrônicos (NFC-e e NF-e), com cancelamento, inutilização e manifestação de notas recebidas'
      : null,
    p.feature_whatsapp
      ? 'Notificações e atendimento automatizados pelo WhatsApp do próprio estabelecimento'
      : null,
    p.feature_custom_domain ? 'Vinculação de domínio próprio à loja virtual (facultativa)' : null,
    'Aplicativos para computador, tablet e celular, com operação de vendas mesmo sem conexão à internet',
    'Hospedagem em nuvem, cópias de segurança diárias criptografadas, atualizações contínuas e suporte técnico',
  ].filter((x): x is string => !!x);
}

/** Etapas da implantação, na ordem em que acontecem. */
export function implementationSteps(fiscal: boolean): string[] {
  return [
    'Criação e configuração do ambiente exclusivo do estabelecimento, com seus dados cadastrais, identidade visual e endereço da loja virtual.',
    'Cadastro do cardápio (produtos, categorias, adicionais e preços), a partir do material fornecido pela CONTRATANTE.',
    'Parametrização do salão, dos setores de produção, das impressoras, das formas de pagamento e dos perfis de acesso da equipe.',
    fiscal
      ? 'Configuração fiscal: certificado digital A1, CSC, regime tributário e dados de tributação dos produtos, com emissão de documento de homologação.'
      : null,
    'Capacitação remota da equipe (gestão, caixa, salão e cozinha), com material de apoio.',
    'Acompanhamento assistido nos primeiros dias de operação, para ajustes finos e esclarecimento de dúvidas.',
  ].filter((x): x is string => !!x);
}

/** Condições comerciais e nível de serviço da proposta, em linguagem formal. */
export function quoteClauses(t: {
  trialDays: number;
  termMonths: number;
  setupCents: number;
  readjustIndex: string;
  lateFeePercent: string;
  lateInterestPercent: string;
  slaPercent: string;
  supportHours: string;
}): { conditions: string[]; service: string[] } {
  return {
    conditions: [
      t.trialDays > 0
        ? `Período de avaliação gratuita de ${qty(t.trialDays, 'dia', 'dias')} corridos, contados da liberação do acesso, sem qualquer ônus para a CONTRATANTE. A primeira mensalidade vence ao término desse período.`
        : 'A primeira mensalidade vence na data de liberação do acesso à plataforma.',
      'As mensalidades são pagas antecipadamente, a cada 30 (trinta) dias, por Pix, boleto bancário ou cartão de crédito, admitida a cobrança recorrente automática no cartão.',
      t.setupCents > 0
        ? 'A taxa de implantação é devida uma única vez e cobrada juntamente com a primeira mensalidade.'
        : 'A implantação é realizada sem custo adicional para a CONTRATANTE.',
      `A contratação terá vigência de ${qty(t.termMonths, 'mês', 'meses')}, formalizada por contrato de licenciamento de uso assinado eletronicamente pelas partes, com renovação mediante novo instrumento ao final de cada período.`,
      `Os valores serão reajustados anualmente pela variação acumulada do ${t.readjustIndex} ou, na sua falta, pelo índice oficial que o substituir.`,
      `O atraso no pagamento sujeita o valor devido à multa de ${pctBR(t.lateFeePercent)} e a juros de ${pctBR(t.lateInterestPercent)} ao mês, calculados pro rata die. Persistindo a inadimplência, o acesso fica restrito à consulta até a regularização, sem exclusão de dados.`,
      'A rescisão pode ser solicitada a qualquer tempo, sem multa, mediante aviso prévio de 30 (trinta) dias. Os dados permanecem disponíveis para exportação por 30 (trinta) dias após o encerramento.',
      'Não estão compreendidos nesta proposta tributos ou serviços de terceiros que nela não estejam expressamente indicados.',
    ],
    service: [
      `Compromisso de disponibilidade mensal de ${pctBR(t.slaPercent)}, com abatimento proporcional na mensalidade caso não seja atingido.`,
      `Suporte técnico remoto por WhatsApp, e-mail ou pelo próprio sistema, ${t.supportHours}.`,
      'Hospedagem em infraestrutura de nuvem, com cópias de segurança diárias criptografadas e atualizações contínuas, sem custo adicional.',
      'Tratamento de dados pessoais em conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados), com acesso restrito, registro das operações e criptografia das informações sensíveis.',
    ],
  };
}
