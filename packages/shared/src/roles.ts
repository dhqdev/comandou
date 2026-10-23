export const ROLES = [
  'owner',
  'manager',
  'cashier',
  'waiter',
  'kitchen',
  'driver',
  'attendant',
  'stock',
  'finance',
  'fiscal',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Administrador',
  manager: 'Gerente',
  cashier: 'Caixa',
  waiter: 'Garçom',
  kitchen: 'Cozinha',
  driver: 'Entregador',
  attendant: 'Atendente',
  stock: 'Estoquista',
  finance: 'Financeiro',
  fiscal: 'Fiscal',
};

/** Permissões por operação. Formato "<recurso>:<ação>". */
export const PERMISSIONS = [
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
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
    'tables:operate',
    'payments:create',
    'cash:operate',
    'cash:close',
    'delivery:manage',
    'stock:read',
    'fiscal:emit',
    'customers:read',
  ],
  waiter: ['catalog:read', 'orders:read', 'orders:write', 'tables:operate'],
  kitchen: ['catalog:read', 'orders:read', 'kitchen:operate'],
  driver: ['orders:read', 'delivery:operate'],
  attendant: [
    'catalog:read',
    'orders:read',
    'orders:write',
    'tables:operate',
    'delivery:manage',
    'customers:read',
  ],
  stock: ['catalog:read', 'stock:read', 'stock:write'],
  finance: [
    'orders:read',
    'cash:close',
    'reports:read',
    'finance:read',
    'finance:write',
    'stock:read',
  ],
  fiscal: ['orders:read', 'reports:read', 'finance:read', 'fiscal:emit', 'fiscal:manage'],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
