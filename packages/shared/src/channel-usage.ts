/**
 * Homologação dos aplicativos de delivery e as regras de uso indevido (ADR 0015, Fase 9). O
 * roteiro do iFood, passo a passo, e a leitura das contagens por hora (channel_usage) contra as
 * regras que bloqueiam o aplicativo: ack ≥ 95%, erro de polling ≤ 1%, erro do status ≤ 1%, até 10
 * consultas por pedido, nada de 4xx repetido.
 */

export interface HomologationStep {
  id: string;
  title: string;
  /** O que fazer, em frases curtas. */
  how: string[];
  /** Passo conferido pelas métricas (não precisa marcar à mão, mas pode). */
  auto?: 'metrics';
}

export const IFOOD_HOMOLOGATION_STEPS: readonly HomologationStep[] = [
  {
    id: 'account',
    title: 'Conta profissional no Portal do Parceiro',
    how: [
      'Crie a conta em developer.ifood.com.br com o CNPJ do Comandou (CNAE de tecnologia).',
      'Anote o app de teste e a loja de teste que vêm junto.',
    ],
  },
  {
    id: 'credentials',
    title: 'Chaves do app de teste no Comandou',
    how: [
      'Em Credenciais, cole o Client ID e o Client Secret do app de teste do iFood.',
      'Num restaurante de teste, ligue a loja de teste em Cardápio › Cardápios › iFood e marque "Receber pedidos" em Aplicativos de delivery.',
    ],
  },
  {
    id: 'test_orders',
    title: 'Pedidos de teste',
    how: [
      'No Portal › Testes › Gerar pedido de teste, e pelo app do iFood em modo de teste.',
      'Faça: dinheiro com troco, cartão na entrega, cartão online, cupom VOUCHER_ENTGRATIS, retirada e agendado.',
      'Confira na gaveta do pedido: bandeira, troco, cupom e quem paga, observações, código de retirada e CPF.',
      'Aceite, avise o preparo, pronto e saiu para entrega (entrega da loja).',
    ],
  },
  {
    id: 'cancellation',
    title: 'Cancelamento e cancelamento negado',
    how: [
      'Cancele um pedido pelo Comandou: a lista de motivos vem do iFood.',
      'Peça o cancelamento pelo app do cliente e veja a negociação aparecer no pedido.',
    ],
  },
  {
    id: 'disputes',
    title: 'Negociação com o cliente',
    how: [
      'Abra pelo app do cliente (Ajuda › Pedido chegou errado) e responda aceitar, recusar e contraproposta antes do prazo.',
    ],
  },
  {
    id: 'store',
    title: 'Loja, entrega e cardápio',
    how: [
      'Pause e reabra a loja pelo Comandou; feche a loja no PDV e veja a pausa no iFood.',
      'Chame entregador do iFood num pedido de entrega da loja (se a loja tiver o Sob Demanda).',
      'Mande o cardápio, mude um preço no portal e use "Mandar o do Comandou".',
    ],
  },
  {
    id: 'metrics',
    title: 'Uso dentro das regras por 24 horas',
    how: [
      'Deixe a loja de teste recebendo pedidos por um dia inteiro.',
      'Nesta tela: ack de 95% ou mais (meta 99%), erro de polling e do status até 1%, nenhum pedido com 10 consultas, nada de 401/403/404 repetidos.',
    ],
    auto: 'metrics',
  },
  {
    id: 'production_app',
    title: 'App de produção e assistente de homologação',
    how: [
      'Crie o app de produção (centralizado, categoria PDV) no Portal.',
      'Rode o assistente em Portal › Homologação › Nova (Order + Events). Só o dono do app inicia; uma tentativa a cada 4 horas.',
      'Aprovado: troque em Credenciais as chaves de teste pelas de produção.',
    ],
  },
  {
    id: 'modules',
    title: 'Catálogo, Avaliações e Financeiro',
    how: [
      'Catálogo e Avaliações: peça por chamado no Portal depois de aprovado.',
      'Financeiro: chamado para agendar a reunião e responder o questionário com dados do sandbox (cabeçalho x-request-homologation).',
    ],
  },
  {
    id: 'first_store',
    title: 'Primeira loja de verdade',
    how: [
      'O lojista autoriza o app do Comandou no Portal do Parceiro e liga a loja no Comandou.',
      'Acompanhe esta tela todos os dias na primeira semana.',
    ],
  },
];

/** Regras do iFood (taxa de erro nas últimas 24 horas e ack). */
export const IFOOD_USAGE_RULES = {
  ackMin: 95,
  ackGoal: 99,
  pollingErrorMax: 1,
  statusErrorMax: 1,
  merchantErrorMax: 2,
  lookupsMax: 10,
} as const;

export interface UsageCount {
  metric: string;
  label: string;
  count: number;
}

export type UsageTone = 'good' | 'warn' | 'bad' | 'none';

export interface EndpointUsage {
  endpoint: string;
  total: number;
  ok: number;
  /** Por resultado agrupado: 2xx, 4xx, 401, 403, 429, 5xx, network. */
  results: Record<string, number>;
  /** % de chamadas que não deram 2xx. */
  errorPct: number;
  /** Limite de erro do iFood para este endpoint (null = sem regra publicada). */
  limitPct: number | null;
  tone: UsageTone;
}

export interface UsageReport {
  polls: number;
  pollsWithEvents: number;
  /** % dos pollings com eventos que terminaram com ack de tudo. */
  ackPct: number | null;
  ackTone: UsageTone;
  events: number;
  eventsAcked: number;
  eventsHeld: number;
  pollErrorPct: number | null;
  pollTone: UsageTone;
  ordersLooked: number;
  /** Pedidos que chegaram a 6 consultas ou mais (atenção) e os que bateram no limite. */
  ordersOver5: number;
  ordersBlocked: number;
  lookupTone: UsageTone;
  /** 401/403/404 e outros 4xx somados (o iFood bloqueia quando se repetem). */
  clientErrors: number;
  endpoints: EndpointUsage[];
  /** Pior situação de todas. */
  tone: UsageTone;
}

const pct = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 10000) / 100 : null;

const ENDPOINT_LIMIT: Record<string, number> = {
  'events:polling': IFOOD_USAGE_RULES.pollingErrorMax,
  'merchant:status': IFOOD_USAGE_RULES.statusErrorMax,
};

const RANK: Record<UsageTone, number> = { none: 0, good: 1, warn: 2, bad: 3 };

/** Lê as contagens de um canal num período e diz o que está dentro e fora das regras. */
export function usageReport(rows: UsageCount[]): UsageReport {
  const sum = (metric: string, label?: string) =>
    rows
      .filter((r) => r.metric === metric && (label === undefined || r.label === label))
      .reduce((a, r) => a + r.count, 0);

  const byEndpoint = new Map<string, Record<string, number>>();
  for (const r of rows.filter((x) => x.metric === 'request')) {
    const [endpoint, result = 'x'] = r.label.split('|');
    const m = byEndpoint.get(endpoint!) ?? {};
    m[result] = (m[result] ?? 0) + r.count;
    byEndpoint.set(endpoint!, m);
  }
  const endpoints: EndpointUsage[] = [...byEndpoint.entries()]
    .map(([endpoint, results]) => {
      const total = Object.values(results).reduce((a, b) => a + b, 0);
      const ok = results['2xx'] ?? 0;
      const errorPct = pct(total - ok, total) ?? 0;
      const limitPct = ENDPOINT_LIMIT[endpoint] ?? null;
      const tone: UsageTone =
        limitPct === null
          ? errorPct > 10
            ? 'warn'
            : 'good'
          : errorPct > limitPct
            ? 'bad'
            : errorPct > limitPct / 2
              ? 'warn'
              : 'good';
      return { endpoint, total, ok, results, errorPct, limitPct, tone };
    })
    .sort((a, b) => b.total - a.total);

  const polling = endpoints.find((e) => e.endpoint === 'events:polling');
  const polls = sum('poll') - sum('poll', 'error');
  const pollsWithEvents = sum('poll', 'with_events');
  const ackedAll = sum('poll_acked', 'all');
  const ackPct = pct(ackedAll, sum('poll_acked'));
  const ackTone: UsageTone =
    ackPct === null
      ? 'none'
      : ackPct < IFOOD_USAGE_RULES.ackMin
        ? 'bad'
        : ackPct < IFOOD_USAGE_RULES.ackGoal
          ? 'warn'
          : 'good';
  const pollErrorPct = polling ? polling.errorPct : null;
  const pollTone: UsageTone = polling ? polling.tone : 'none';

  const ordersLooked = sum('order_lookup', '1');
  const ordersOver5 = rows
    .filter((r) => r.metric === 'order_lookup' && /^\d+$/.test(r.label) && Number(r.label) === 6)
    .reduce((a, r) => a + r.count, 0);
  const ordersBlocked = sum('order_lookup', 'blocked');
  const lookupTone: UsageTone = ordersBlocked
    ? 'bad'
    : ordersOver5
      ? 'warn'
      : rows.some((r) => r.metric === 'order_lookup')
        ? 'good'
        : 'none';

  const clientErrors = endpoints.reduce(
    (a, e) => a + (e.results['4xx'] ?? 0) + (e.results['401'] ?? 0) + (e.results['403'] ?? 0),
    0,
  );
  const clientTone: UsageTone =
    clientErrors > 50 ? 'bad' : clientErrors > 0 ? 'warn' : endpoints.length ? 'good' : 'none';

  const tones = [ackTone, pollTone, lookupTone, clientTone, ...endpoints.map((e) => e.tone)];
  const tone = tones.reduce<UsageTone>((w, t) => (RANK[t] > RANK[w] ? t : w), 'none');

  return {
    polls,
    pollsWithEvents,
    ackPct,
    ackTone,
    events: sum('event'),
    eventsAcked: sum('ack', 'ok'),
    eventsHeld: sum('ack', 'held'),
    pollErrorPct,
    pollTone,
    ordersLooked,
    ordersOver5,
    ordersBlocked,
    lookupTone,
    clientErrors,
    endpoints,
    tone,
  };
}
