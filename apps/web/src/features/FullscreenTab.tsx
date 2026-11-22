import { useEffect, useState } from 'react';

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

/** Telas do cliente final (cardápio online, rastreio, preços). */
const PUBLIC_PREFIXES = [
  '/pedir',
  '/pedido/',
  '/rastreio/',
  '/mesa/',
  '/precos',
  '/preços',
  '/site',
];

export function isPublicPath(pathname: string) {
  let path = pathname;
  try {
    path = decodeURI(pathname);
  } catch {
    // Endereço com % solto: compara do jeito que veio.
  }
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));
}
