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
  'cash:operate',
  'cash:close',
  'users:manage',
  'settings:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissões padrão por papel. Futuramente configuráveis por tenant (tabela role_permissions). */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: [
    'catalog:read',
    'catalog:write',
    'orders:read',
    'orders:write',
    'cash:operate',
    'cash:close',
  ],
  cashier: ['catalog:read', 'orders:read', 'orders:write', 'cash:operate'],
  waiter: ['catalog:read', 'orders:read', 'orders:write'],
  kitchen: ['catalog:read', 'orders:read'],
  driver: ['orders:read'],
  attendant: ['catalog:read', 'orders:read', 'orders:write'],
  stock: ['catalog:read'],
  finance: ['orders:read', 'cash:close'],
  fiscal: ['orders:read'],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
