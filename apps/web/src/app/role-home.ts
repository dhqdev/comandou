/** Tela inicial de cada papel: garçom no salão, entregador nas entregas, cozinha na cozinha… */
export const ROLE_HOME: Record<string, string> = {
  waiter: '/mesas',
  driver: '/entregas',
  kitchen: '/cozinha',
  stock: '/estoque',
  finance: '/financeiro',
  fiscal: '/nota-fiscal',
};

/**
 * Quem pode abrir cada tela (ao menos uma das permissões). Mesmas regras do menu: quem chega
 * por um link direto sem acesso vê um aviso em vez de uma tela quebrada.
 */
export const ROUTE_PERMS: Record<string, string[]> = {
  pdv: ['orders:write'],
  pedidos: ['orders:read'],
  mesas: ['tables:operate', 'payments:create'],
  cozinha: ['kitchen:operate', 'orders:read'],
  caixa: ['cash:operate', 'cash:close', 'reports:read'],
  entregas: ['delivery:manage', 'delivery:operate'],
  cardapio: ['catalog:read'],
  'loja-online': ['settings:manage'],
  clientes: ['customers:read'],
  estoque: ['stock:read'],
  financeiro: ['finance:read'],
  relatorios: ['reports:read'],
  equipe: ['users:manage'],
  impressao: ['printing:manage'],
  'nota-fiscal': ['fiscal:emit', 'fiscal:manage'],
  whatsapp: ['messaging:manage'],
  plano: ['plan:read'],
};
