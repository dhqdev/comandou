import { useEffect } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { ToastProvider } from '../design-system';
import { StaffApp } from '../app/StaffApp';
import { TenantBrand } from '../app/TenantBrand';
import { SANDBOX_MSG, SANDBOX_SCREENS, SITE_MSG } from '../lib/sandbox';

const sameOrigin = (e: MessageEvent) => e.origin === window.location.origin;

/**
 * Ponte com a página do site: as abas de cima trocam a tela aqui dentro, e cada troca feita aqui
 * dentro (menu, links) acende a aba certa lá fora.
 */
function Bridge() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { source?: string; go?: string } | null;
      if (!sameOrigin(e) || d?.source !== SITE_MSG || typeof d.go !== 'string') return;
      const to = SANDBOX_SCREENS[d.go] ?? (d.go.startsWith('/') ? d.go : null);
      if (to) navigate(to);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [navigate]);
  useEffect(() => {
    if (window.parent === window) return;
    window.parent.postMessage({ source: SANDBOX_MSG, at: pathname }, window.location.origin);
  }, [pathname]);
  return null;
}

/**
 * O app da equipe de verdade, dentro do exemplo do site: mesmo menu, mesmas telas e mesmos
 * botões, com o histórico só na memória (trocar de tela aqui não mexe no endereço nem no voltar
 * do navegador da página de fora).
 */
export function SandboxApp({ start }: { start: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <TenantBrand />
      <ToastProvider>
        <Bridge />
        <StaffApp />
      </ToastProvider>
    </MemoryRouter>
  );
}
