import { useOutletContext } from 'react-router';

/**
 * Ações da conta que moram na moldura (AppShell): as janelas de trocar senha, a apresentação e
 * os primeiros passos ficam abertas por cima de qualquer tela, então a tela Conta só pede para
 * abrir. Chegam pelo contexto do `<Outlet>`.
 */
export interface AccountTools {
  openPassword: () => void;
  openTour: () => void;
  openOnboarding: () => void;
  install: { show: boolean; start: () => void };
  logout: () => void;
  /** Há versão nova ainda não vista na tela Novidades. */
  unseen: boolean;
}

export const useAccountTools = () => useOutletContext<AccountTools>();
