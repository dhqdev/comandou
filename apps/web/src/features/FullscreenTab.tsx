import { Maximize, Minimize } from 'lucide-react';
import { useEffect, useState } from 'react';
import './fullscreen-tab.css';

/** Navegador deixa pôr a página em tela cheia? (iPhone não deixa.) */
export function fullscreenSupported() {
  return typeof document !== 'undefined' && !!document.fullscreenEnabled;
}

/** Está em tela cheia agora + liga/desliga. Acompanha o Esc e o F11 do navegador. */
export function useFullscreen() {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggle = () =>
    void (
      document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    ).catch(() => undefined);
  return { full, toggle };
}

/** Telas do cliente final (cardápio online, rastreio, preços): ficam sem a aba. */
const PUBLIC_PREFIXES = ['/pedir', '/pedido/', '/rastreio/', '/mesa/', '/precos', '/preços'];

export function isPublicPath(pathname: string) {
  let path = pathname;
  try {
    path = decodeURI(pathname);
  } catch {
    // Endereço com % solto: compara do jeito que veio.
  }
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));
}

/**
 * Abinha presa no topo da tela, no meio: um toque expande o sistema para a tela toda (some a barra
 * do navegador) e outro volta ao normal. Some onde o navegador não deixa (iPhone).
 */
export function FullscreenTab({ hidden }: { hidden?: boolean }) {
  const { full, toggle } = useFullscreen();
  if (hidden || !fullscreenSupported()) return null;
  const label = full ? 'Sair da tela cheia' : 'Tela cheia';
  return (
    <button
      type="button"
      className={`cm-fs-tab${full ? ' cm-fs-tab--on' : ''}`}
      aria-label={label}
      aria-pressed={full}
      title={label}
      onClick={toggle}
    >
      {full ? <Minimize size={13} aria-hidden /> : <Maximize size={13} aria-hidden />}
      <span className="cm-fs-tab__label">{label}</span>
    </button>
  );
}
