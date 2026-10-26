/**
 * Perfis da equipe de um restaurante, na ordem em que aparecem ao criar alguém. O Super Admin
 * (painel da plataforma) e o cliente do cardápio online não são papéis da equipe: têm login
 * próprio. Estoquista, Financeiro e Fiscal viraram Gerente na migração 0026.
 */
export const ROLES = [
  'owner',
  'manager',
  'cashier',
  'attendant',
  'waiter',
  'kitchen',
  'driver',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Administrador',
  manager: 'Gerente',
  cashier: 'Caixa',
  attendant: 'PDV (balcão)',
  waiter: 'Garçom',
  kitchen: 'Cozinha',
  driver: 'Entregador',
};

/** O que cada perfil faz, em uma linha (tela Equipe). */
export const ROLE_HINTS: Record<Role, string> = {
  owner: 'Tudo, inclusive equipe, plano e domínio.',
  manager: 'Tudo da loja, menos equipe e domínio: estoque, financeiro, nota fiscal, relatórios.',
  cashier: 'PDV, pedidos, salão, entregas e caixa (abre, recebe e fecha).',
  attendant: 'PDV e pedidos no balcão, salão e despacho de entregas. Não mexe no caixa.',
  waiter: 'Só o app do garçom (/garcom): mesas, comandas e os próprios pedidos.',
  kitchen: 'Só a tela da cozinha (/cozinha), em tela cheia.',
  driver: 'Só as próprias entregas, concluídas com o código do cliente.',
};

/** Permissões por operação. Formato "<recurso>:<ação>". */
export const PERMISSIONS = [
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
  /**
   * Gerir qualquer pedido: mudar status, ajustar valores, ver delivery/balcão de todos e mexer na
   * loja online. O garçom não tem: ele só lança pedidos e vê os do salão e os que ele lançou.
   */
  'orders:manage',
  /** Cancelar pedido diretamente (sem só solicitar). */
  'orders:cancel',
  /** Desconto acima do limite padrão (DISCOUNT_FREE_LIMIT_PERCENT). */
  'orders:discount',
  'kitchen:operate',
  /** Reabrir item já concluído na cozinha. */
  'kitchen:reopen',
  'tables:operate',
  'payments:create',
  'payments:refund',
  'cash:operate',
  'cash:close',
  'reports:read',
  'users:manage',
  'settings:manage',
  'stock:read',
  /** Entradas, perdas, contagens e fichas técnicas. */
  'stock:write',
  /** Despachar pedidos, cadastrar entregadores e acompanhar entregas. */
  'delivery:manage',
  /** Entregador: ver e concluir as próprias entregas. */
  'delivery:operate',
  'finance:read',
  'finance:write',
  /** Agentes de impressão e reimpressões. */
  'printing:manage',
  /** Emitir e cancelar nota fiscal de um pedido. */
  'fiscal:emit',
  /** Configuração fiscal do restaurante (CNPJ, token, ambiente). */
  'fiscal:manage',
  /** Configurar o WhatsApp e as mensagens automáticas. */
  'messaging:manage',
  /** Ver o plano, a assinatura e o uso do restaurante. */
  'plan:read',
  /** Ver os clientes com conta no cardápio online (contato, endereços, pedidos). */
  'customers:read',
  /** Anotar e bloquear clientes do cardápio online. */
  'customers:manage',
  /** Domínio próprio do restaurante (muda o endereço de acesso). Só o administrador. */
  'domains:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Desconto até este percentual não exige permissão especial. */
export const DISCOUNT_FREE_LIMIT_PERCENT = 10;

/** Permissões padrão por papel. Futuramente configuráveis por tenant (tabela role_permissions). */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => p !== 'users:manage' && p !== 'domains:manage'),
  cashier: [
    'catalog:read',
    'orders:read',
    'orders:write',
    'orders:manage',
    'tables:operate',
    'payments:create',
    'cash:operate',
    'cash:close',
    'delivery:manage',
    'stock:read',
    'fiscal:emit',
    'customers:read',
  ],
  /** App do garçom (/garcom): mesas, comandas e pedido rápido. Sem caixa, desconto ou status. */
  waiter: ['catalog:read', 'orders:read', 'orders:write', 'tables:operate'],
  /** Só a tela da cozinha (/cozinha): fila de preparo por setor. */
  kitchen: ['catalog:read', 'kitchen:operate'],
  /** Só as próprias corridas (/entregas): sem pedidos, cardápio ou clientes da loja. */
  driver: ['delivery:operate'],
  attendant: [
    'catalog:read',
    'orders:read',
    'orders:write',
    'orders:manage',
    'tables:operate',
    'delivery:manage',
    'customers:read',
  ],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Papel que lança pedidos mas não gere todos (o garçom): só enxerga os pedidos do salão (mesa ou
 * comanda) e os que ele mesmo lançou, e não muda status além de pedir cancelamento.
 */
export function ordersLimitedToOwn(role: Role): boolean {
  return roleHas(role, 'orders:write') && !roleHas(role, 'orders:manage');
}
