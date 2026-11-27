import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary, ErrorFallback } from '../lib/error-boundary';
import { installServer } from './server/http';
import { registerRoutes } from './server/routes';
import { SANDBOX_MSG, SANDBOX_SCREENS } from '../lib/sandbox';
import { SandboxApp } from './SandboxApp';

/**
 * Liga o exemplo do site (comandou.com/experimente?tela=pdv): troca o fetch pelo servidor de
 * mentira e desenha o app da equipe. Só baixa quando alguém abre o exemplo.
 */
export function bootSandbox(root: HTMLElement) {
  registerRoutes();
  installServer();
  const tela = new URLSearchParams(window.location.search).get('tela') ?? 'pdv';
  const start = SANDBOX_SCREENS[tela] ?? '/';
  document.documentElement.dataset.sandbox = '';
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary fallback={ErrorFallback}>
        <SandboxApp start={start} />
      </ErrorBoundary>
    </StrictMode>,
  );
  if (window.parent !== window)
    window.parent.postMessage({ source: SANDBOX_MSG, ready: true }, window.location.origin);
}
