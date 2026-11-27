/**
 * comandou.com/experimente: o sistema de exemplo do site (src/sandbox), com o app da equipe de
 * verdade e os dados da Fumaça Burger respondidos dentro do navegador. Este arquivo fica pequeno
 * de propósito: o app só pergunta "estou no exemplo?" (sem conexão do tempo real, sem modo
 * offline); o resto do exemplo baixa só em /experimente.
 */
export const SANDBOX_PATH = '/experimente';

export const isSandboxPath = (pathname: string) =>
  pathname === SANDBOX_PATH || pathname.startsWith(`${SANDBOX_PATH}/`);

/** O app está rodando como o exemplo do site (o endereço de verdade não muda dentro dele). */
export const inSandbox = () =>
  typeof window !== 'undefined' && isSandboxPath(window.location.pathname);

/** Telas do exemplo pelo nome curto que a página do site usa (`/experimente?tela=cozinha`). */
export const SANDBOX_SCREENS: Record<string, string> = {
  pdv: '/',
  pedidos: '/pedidos',
  mesas: '/mesas',
  cozinha: '/cozinha',
  caixa: '/caixa',
  cardapio: '/cardapio',
  entregas: '/entregas',
  estoque: '/estoque',
  financeiro: '/financeiro',
  relatorios: '/relatorios',
};

/** Nome curto da tela em que o exemplo está (o menu de dentro também troca de tela). */
export function sandboxScreenOf(pathname: string): string | null {
  let best: string | null = null;
  let len = -1;
  for (const [key, path] of Object.entries(SANDBOX_SCREENS)) {
    const hit =
      path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
    if (hit && path.length > len) {
      best = key;
      len = path.length;
    }
  }
  return best;
}

/** Mensagens entre a página do site e o exemplo (mesma origem). */
export const SITE_MSG = 'comandou-site';
export const SANDBOX_MSG = 'comandou-sandbox';
