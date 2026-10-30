/**
 * Tela inicial de cada papel com app próprio: garçom no salão, entregador nas entregas, cozinha
 * na fila de preparo. Os outros começam no PDV.
 */
export const ROLE_HOME: Record<string, string> = {
  waiter: '/garcom/mesas',
  driver: '/entregas',
  kitchen: '/cozinha',
};

/**
 * Quem pode abrir cada tela (ao menos uma das permissões). Mesmas regras do menu: quem chega
 * por um link direto sem acesso vê um aviso em vez de uma tela quebrada.
 */
export const ROUTE_PERMS: Record<string, string[]> = {
  pdv: ['orders:write'],
  pedidos: ['orders:read'],
  mesas: ['tables:operate', 'payments:create'],
  reservas: ['tables:operate', 'settings:manage'],
  cozinha: ['kitchen:operate', 'orders:manage'],
  caixa: ['cash:operate', 'cash:close', 'reports:read'],
  entregas: ['delivery:manage'],
  cardapio: ['catalog:read'],
  'loja-online': ['settings:manage'],
  clientes: ['customers:read'],
  estoque: ['stock:read'],
  financeiro: ['finance:read'],
  relatorios: ['reports:read'],
  equipe: ['users:manage'],
  impressao: ['printing:manage'],
  fiscal: ['fiscal:emit', 'fiscal:manage'],
  whatsapp: ['messaging:manage'],
  plano: ['plan:read'],
  chamados: ['plan:read'],
};
