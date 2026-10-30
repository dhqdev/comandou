/**
 * Relatórios do gerente: cada relatório da aba Relatórios é montado na API como um documento
 * genérico (indicadores, gráficos e tabelas). A tela desenha o painel a partir dele e a mesma
 * estrutura vira a planilha do Excel, então o que se vê é o que se baixa.
 */

/** Formato de um número: dinheiro em reais, inteiro, decimal, porcentagem (0–100), minutos, data. */
export type ReportFmt = 'money' | 'int' | 'num' | 'pct' | 'min' | 'text' | 'date' | 'datetime';

export type ReportValue = string | number | null;

export interface ReportKpi {
  label: string;
  value: ReportValue;
  fmt: ReportFmt;
  /** Valor do período anterior (mesmo tamanho), para a variação. */
  prev?: number | null;
  /** Subir é ruim (cancelamentos, perdas): inverte a cor da variação. */
  invert?: boolean;
  hint?: string;
  /** Destaque (primeiro cartão, maior). */
  main?: boolean;
  tone?: 'good' | 'bad';
}

export interface ReportPoint {
  label: string;
  value: number;
  /** Valor de comparação (período anterior) no mesmo ponto. */
  prev?: number | null;
  hint?: string;
}

export type ReportChart =
  | {
      kind: 'line';
      title: string;
      fmt: ReportFmt;
      /** Nome da série principal e da comparação (ex.: "Este período" / "Período anterior"). */
      series: [string, string?];
      points: ReportPoint[];
      wide?: boolean;
    }
  | { kind: 'columns'; title: string; fmt: ReportFmt; points: ReportPoint[]; wide?: boolean }
  | { kind: 'bars'; title: string; fmt: ReportFmt; points: ReportPoint[]; wide?: boolean }
  | { kind: 'donut'; title: string; fmt: ReportFmt; points: ReportPoint[]; wide?: boolean }
  | {
      kind: 'heat';
      title: string;
      fmt: ReportFmt;
      rows: string[];
      cols: string[];
      values: number[][];
      wide?: boolean;
    }
  | {
      kind: 'scatter';
      title: string;
      x: { label: string; fmt: ReportFmt };
      y: { label: string; fmt: ReportFmt };
      /** Linhas de corte (médias) que dividem os quadrantes. */
      cut?: { x: number; y: number };
      groups: { id: string; label: string }[];
      points: { label: string; x: number; y: number; group: string }[];
      wide?: boolean;
    };

export interface ReportColumn {
  key: string;
  label: string;
  fmt: ReportFmt;
  /** Largura sugerida no Excel (caracteres). */
  width?: number;
}

export interface ReportTable {
  id: string;
  title: string;
  hint?: string;
  columns: ReportColumn[];
  rows: Record<string, ReportValue>[];
  /** Linha de total (só as colunas que somam). */
  total?: Record<string, ReportValue>;
  /** Coluna numérica que ganha barra de dados no Excel e na tela. */
  bar?: string;
  /** Linhas a mais que existiam e não vieram (limite). */
  truncated?: boolean;
}

export interface ReportDoc {
  id: string;
  group: string;
  title: string;
  description: string;
  restaurant: string;
  from: string;
  to: string;
  /** Período de comparação (mesmo tamanho, imediatamente antes). */
  prevFrom: string;
  prevTo: string;
  generatedAt: string;
  kpis: ReportKpi[];
  charts: ReportChart[];
  tables: ReportTable[];
  notes: string[];
}

export interface ReportInfo {
  id: string;
  title: string;
  description: string;
}

export interface ReportGroup {
  id: string;
  title: string;
  reports: ReportInfo[];
}

/** Catálogo da aba Relatórios, na ordem em que aparece. */
export const REPORT_GROUPS: readonly ReportGroup[] = [
  {
    id: 'resultado',
    title: 'Quanto vendi e quanto sobrou',
    reports: [
      {
        id: 'resultado',
        title: 'Resultado',
        description:
          'Vendido, recebido, ticket, canais, fiado em aberto, margem e comparação com a semana e o mês anteriores.',
      },
      {
        id: 'extrato',
        title: 'Vendas (extrato)',
        description: 'Cada conta fechada no período, com as formas de pagamento, para conferir.',
      },
      {
        id: 'evolucao',
        title: 'Vendas ao longo do tempo',
        description: 'Evolução por dia de caixa.',
      },
      {
        id: 'ticket',
        title: 'Ticket médio e formas de pagamento',
        description: 'Ticket por conta, sem serviço e frete, e o recebido por forma.',
      },
    ],
  },
  {
    id: 'perdas',
    title: 'Onde estou perdendo dinheiro',
    reports: [
      {
        id: 'perdas',
        title: 'Perdas e controle',
        description: 'Cancelamentos, descontos e diferença de caixa por operador.',
      },
      {
        id: 'cancelamentos',
        title: 'Cancelamentos',
        description: 'Cada pedido cancelado, com motivo, itens, quem pediu e quem autorizou.',
      },
      {
        id: 'fechamentos',
        title: 'Fechamentos de caixa',
        description:
          'Esperado × contado por forma, como o dinheiro esperado se forma e o resumo do turno.',
      },
    ],
  },
  {
    id: 'cardapio',
    title: 'Cardápio',
    reports: [
      {
        id: 'produtos',
        title: 'Produtos',
        description: 'O que mais vende, por família do cadastro e por categoria do cardápio.',
      },
      {
        id: 'engenharia',
        title: 'Engenharia de cardápio',
        description:
          'Carro-chefe, popular de margem baixa, rentável que vende pouco e candidato a sair, por família, com curva ABC.',
      },
    ],
  },
  {
    id: 'operacao',
    title: 'Operação e equipe',
    reports: [
      {
        id: 'horarios',
        title: 'Pedidos por hora',
        description:
          'Quando os pedidos chegam, por tipo de venda, e o mapa da semana, para montar a escala.',
      },
      {
        id: 'equipe',
        title: 'Vendas por funcionário',
        description:
          'Consumo, contas, ticket por conta, taxa de serviço e cancelamentos de cada garçom ou operador.',
      },
      {
        id: 'garcons',
        title: 'Pontuação e desafios dos garçons',
        description:
          'Selo de cada garçom, desafios do dia cumpridos no período, ranking e o placar de hoje.',
      },
    ],
  },
  {
    id: 'delivery',
    title: 'Delivery',
    reports: [
      {
        id: 'bairros',
        title: 'Delivery por bairro',
        description:
          'Onde você mais vende, as áreas de entrega e os bairros dos clientes onde você não vende.',
      },
      {
        id: 'motoboys',
        title: 'Entregas por motoboy',
        description: 'Entregas, frete e ganho por motoboy e por dia.',
      },
      {
        id: 'frete',
        title: 'Frete arrecadado',
        description: 'Contas com taxa de entrega no período.',
      },
    ],
  },
  {
    id: 'clientes',
    title: 'Clientes',
    reports: [
      {
        id: 'clientes',
        title: 'Clientes',
        description: 'Novos e que voltaram, quem mais compra e quem parou de comprar.',
      },
    ],
  },
];

export const REPORT_IDS: readonly string[] = REPORT_GROUPS.flatMap((g) =>
  g.reports.map((r) => r.id),
);

export function findReport(id: string): (ReportInfo & { group: string }) | undefined {
  for (const g of REPORT_GROUPS) {
    const r = g.reports.find((x) => x.id === id);
    if (r) return { ...r, group: g.title };
  }
  return undefined;
}
