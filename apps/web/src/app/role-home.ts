import type { Role } from '@comandou/shared';

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
  integracoes: ['orders:manage'],
  'assistente-ia': ['settings:manage'],
  plano: ['plan:read'],
  chamados: ['plan:read'],
};

/** Área do login aberta pelo endereço: muda o título e, no garçom e entregador, mostra o PIN. */
export type LoginArea = 'waiter' | 'driver' | 'kitchen' | 'attendant' | 'cashier';

/**
 * Qual login o endereço abre. Também vale nas telas de dentro (/garcom/mesas, /entregas/…): a
 * sessão que venceu ali volta para o login da mesma área.
 */
export function loginAreaFor(pathname: string): LoginArea | null {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    // endereço malformado: compara como veio
  }
  if (/^\/gar[cç]om(\/|$)/i.test(p)) return 'waiter';
  if (/^\/entregas(\/|$)/.test(p)) return 'driver';
  if (/^\/cozinha(\/|$)/.test(p)) return 'kitchen';
  if (/^\/pdv(\/|$)/.test(p)) return 'attendant';
  if (/^\/caixa(\/|$)/.test(p)) return 'cashier';
  return null;
}

/**
 * Link de acesso de cada área (tela Equipe › Links de acesso): o dono copia e manda para a pessoa.
 * Cada link abre o login certo e, depois de entrar, a tela da área. `roles` são os papéis que usam
 * o link; o teste confere que cada um cai no login e na tela que o papel pode abrir.
 */
export const ACCESS_LINKS: readonly {
  path: string;
  label: string;
  how: string;
  roles: readonly Role[];
}[] = [
  { path: '/garcom', label: 'Garçom', how: 'Entra com o PIN', roles: ['waiter'] },
  { path: '/entregas', label: 'Entregador', how: 'Entra com o PIN', roles: ['driver'] },
  { path: '/cozinha', label: 'Cozinha', how: 'Entra com e-mail e senha', roles: ['kitchen'] },
  { path: '/pdv', label: 'PDV (balcão)', how: 'Entra com e-mail e senha', roles: ['attendant'] },
  { path: '/caixa', label: 'Caixa', how: 'Entra com e-mail e senha', roles: ['cashier'] },
  {
    path: '/',
    label: 'Gerente e administrador',
    how: 'Entra com e-mail e senha',
    roles: ['manager', 'owner'],
  },
];

/** Link completo de uma área neste restaurante (o endereço aberto agora). */
export const accessUrl = (path: string) => `${window.location.origin}${path === '/' ? '' : path}`;
