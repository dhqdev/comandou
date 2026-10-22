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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Desconto até este percentual não exige permissão especial. */
export const DISCOUNT_FREE_LIMIT_PERCENT = 10;

/** Permissões padrão por papel. Futuramente configuráveis por tenant (tabela role_permissions). */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => p !== 'users:manage'),
  cashier: [
    'catalog:read',
    'orders:read',
    'orders:write',
    'tables:operate',
    'payments:create',
    'cash:operate',
    'cash:close',
  ],
  waiter: ['catalog:read', 'orders:read', 'orders:write', 'tables:operate'],
  kitchen: ['catalog:read', 'orders:read', 'kitchen:operate'],
  driver: ['orders:read'],
  attendant: ['catalog:read', 'orders:read', 'orders:write', 'tables:operate'],
  stock: ['catalog:read'],
  finance: ['orders:read', 'cash:close', 'reports:read'],
  fiscal: ['orders:read', 'reports:read'],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
