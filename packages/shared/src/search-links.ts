/**
 * Resultado da busca global (GET /search) e para onde cada um leva. Mora no compartilhado porque
 * dois lugares montam o mesmo link: a busca do topo (app) e o assistente de IA da equipe (API),
 * que manda a pessoa direto ao item com `?foco=` (a tela rola até ele e ele pisca).
 */
export type SearchKind =
  | 'order'
  | 'tab'
  | 'table'
  | 'customer'
  | 'product'
  | 'category'
  | 'option'
  | 'stock_item'
  | 'member'
  | 'courier'
  | 'finance_entry'
  | 'cash_register'
  | 'cash_session'
  | 'sector'
  | 'print_agent';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Linha de apoio (cliente, categoria, papel…). */
  detail: string | null;
  /** Id relacionado (comanda aberta da mesa, categoria do produto, grupo do adicional…). */
  ref: string | null;
  amount: string | null;
  status: string | null;
  at: string | null;
}

/** Para onde cada resultado leva. A tela de destino abre o item ou o destaca. */
export function hitHref(h: Pick<SearchHit, 'kind' | 'id' | 'ref'>): string {
  switch (h.kind) {
    case 'order':
      return `/pedidos?abrir=${h.id}`;
    case 'tab':
      return `/mesas?comanda=${h.id}`;
    case 'table':
      return h.ref ? `/mesas?comanda=${h.ref}` : `/mesas?foco=mesa-${h.id}`;
    case 'customer':
      return `/clientes?abrir=${h.id}`;
    case 'product':
      return `/cardapio?categoria=${h.ref}&foco=produto-${h.id}`;
    case 'category':
      return `/cardapio?categoria=${h.id}`;
    case 'option':
      return `/cardapio/complementos?foco=grupo-${h.id}`;
    case 'stock_item':
      return `/estoque?foco=insumo-${h.id}`;
    case 'member':
      return `/equipe?foco=membro-${h.id}`;
    case 'courier':
      return `/entregas?foco=entregador-${h.id}`;
    case 'finance_entry':
      return `/financeiro?conta=${h.id}&foco=conta-${h.id}`;
    case 'cash_register':
      return h.ref ? `/caixa?sessao=${h.ref}&foco=sessao-${h.ref}` : `/caixa?foco=caixa-${h.id}`;
    case 'cash_session':
      return `/caixa?sessao=${h.id}&foco=sessao-${h.id}`;
    case 'sector':
      return `/configuracoes?foco=setor-${h.id}`;
    case 'print_agent':
      return `/impressao?foco=agente-${h.id}`;
  }
}

/** Nome do tipo de resultado, no singular (para o assistente dizer o que achou). */
export const SEARCH_KIND_NAME: Record<SearchKind, string> = {
  order: 'Pedido',
  tab: 'Comanda',
  table: 'Mesa',
  customer: 'Cliente',
  product: 'Item do cardápio',
  category: 'Categoria do cardápio',
  option: 'Grupo de complementos',
  stock_item: 'Insumo do estoque',
  member: 'Pessoa da equipe',
  courier: 'Entregador',
  finance_entry: 'Conta do financeiro',
  cash_register: 'Terminal de caixa',
  cash_session: 'Sessão de caixa',
  sector: 'Setor de produção',
  print_agent: 'Computador de impressão',
};
