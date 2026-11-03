/**
 * Cozinha (KDS): o que aparece nas telas da cozinha de cada restaurante. Quem decide é o
 * Super Admin (aba "Cozinha" do restaurante); cada aparelho só escolhe qual cozinha mostra e
 * os ajustes de leitura dele (tema, cor, layout, tamanho do texto, som).
 */
export interface KitchenDisplay {
  /** Ao abrir, o aparelho pergunta qual cozinha vai exibir (e lembra a escolha). */
  askKitchen: boolean;
  /** Mostra a opção "Todas as cozinhas" na escolha. */
  allowAll: boolean;
  /** Abas por tipo de pedido (Todos, Delivery, Mesa, Balcão, Retirada). */
  channelTabs: boolean;
  /** Foto do produto ao lado do item. */
  photos: boolean;
  /** Adicionais e opções escolhidas. */
  options: boolean;
  /** Observações do item e do pedido. */
  notes: boolean;
  /** Mesa, comanda ou nome do cliente no cartão. */
  customer: boolean;
  /** Cronômetro de espera no cartão. */
  timer: boolean;
  /** Coluna "Pronto" (o que acabou de sair). */
  doneColumn: boolean;
  /** Faixa de baixo com o total de cada item a produzir. */
  allDay: boolean;
  /** Botão de imprimir a comanda no cartão. */
  print: boolean;
}

export const DEFAULT_KITCHEN_DISPLAY: KitchenDisplay = {
  askKitchen: true,
  allowAll: true,
  channelTabs: true,
  photos: true,
  options: true,
  notes: true,
  customer: true,
  timer: true,
  doneColumn: true,
  allDay: true,
  print: true,
};

export const KITCHEN_DISPLAY_KEYS = Object.keys(
  DEFAULT_KITCHEN_DISPLAY,
) as (keyof KitchenDisplay)[];

/** Rótulos e explicações dos interruptores (tela do Super Admin). */
export const KITCHEN_DISPLAY_INFO: { key: keyof KitchenDisplay; label: string; hint: string }[] = [
  {
    key: 'askKitchen',
    label: 'Escolher a cozinha no aparelho',
    hint: 'Ao abrir, cada tela pergunta qual cozinha vai exibir e guarda a escolha.',
  },
  {
    key: 'allowAll',
    label: 'Opção "Todas as cozinhas"',
    hint: 'Uma tela pode mostrar os pedidos de todas as cozinhas juntas.',
  },
  {
    key: 'channelTabs',
    label: 'Separar por tipo de pedido',
    hint: 'Abas Delivery, Mesa, Balcão e Retirada, com a contagem de cada uma.',
  },
  { key: 'timer', label: 'Cronômetro', hint: 'Tempo de espera de cada pedido, com cor de atraso.' },
  { key: 'customer', label: 'Mesa e cliente', hint: 'Mesa, comanda ou nome de quem pediu.' },
  { key: 'photos', label: 'Foto do produto', hint: 'Miniatura ao lado de cada item.' },
  { key: 'options', label: 'Adicionais', hint: 'Opções e adicionais escolhidos no item.' },
  { key: 'notes', label: 'Observações', hint: 'Observação do item e do pedido, em destaque.' },
  { key: 'doneColumn', label: 'Coluna "Pronto"', hint: 'Mostra o que acabou de ficar pronto.' },
  {
    key: 'allDay',
    label: 'Resumo do que produzir',
    hint: 'Faixa de baixo com o total de cada item ainda por fazer.',
  },
  { key: 'print', label: 'Imprimir comanda', hint: 'Botão de imprimir em cada pedido.' },
];

/** Junta o que veio do banco com o padrão (chave desconhecida ou tipo errado é ignorado). */
export function normalizeKitchenDisplay(raw: unknown): KitchenDisplay {
  const out = { ...DEFAULT_KITCHEN_DISPLAY };
  if (raw && typeof raw === 'object') {
    for (const k of KITCHEN_DISPLAY_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

/** Cores sugeridas para identificar cada cozinha (Bar, Chapa...). */
export const KITCHEN_COLORS = [
  '#e23a00',
  '#d97706',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#475569',
] as const;
