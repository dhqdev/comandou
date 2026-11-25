import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { calmMotion } from './motion';

/**
 * Efeitos pequenos do site, sem biblioteca: o número que rola (no jeito do Counter do React Bits)
 * e a navegação entre o site e a lanchonete de demonstração sem recarregar a página.
 */

/**
 * Valor com os algarismos rolando como um contador mecânico quando muda ("R$ 2.184,60"). Só
 * transform; o leitor de tela lê o valor inteiro.
 */
export function RollingValue({ text, className = '' }: { text: string; className?: string }) {
  const chars = [...text];
  return (
    <span className={`st-roll ${className}`}>
      <span className="cm-sr-only">{text}</span>
      <span className="st-roll__vis" aria-hidden>
        {chars.map((c, i) => {
          // Chave contada da direita: os centavos ficam no mesmo lugar quando o valor cresce.
          const key = chars.length - i;
          if (!/\d/.test(c))
            return (
              <span key={`s${key}`} className="st-roll__s">
                {c}
              </span>
            );
          return (
            <span key={`d${key}`} className="st-roll__d">
              <span className="st-roll__col" style={{ '--d': Number(c) } as CSSProperties}>
                {'0123456789'.split('').map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

/**
 * Valor que nasce zerado e rola até o certo quando aparece na tela (o preço). Com "reduzir
 * movimento", já aparece certo.
 */
export function RollIn({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(() => calmMotion());
  useEffect(() => {
    const el = ref.current;
    if (seen || !el || !('IntersectionObserver' in window)) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        window.setTimeout(() => setSeen(true), 150);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <span ref={ref} className={className}>
      <RollingValue text={seen ? text : text.replace(/\d/g, '0')} />
    </span>
  );
}

/** Endereço atual do site (o site não usa o roteador do app: só o topo e a /demo). */
export function useSitePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

/** Vai para outro endereço do site sem recarregar (o voltar do navegador funciona). */
export function goTo(to: string) {
  const [path, hash = ''] = to.split('#');
  if (window.location.pathname !== path) {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
    if (!hash) window.scrollTo(0, 0);
  }
  if (hash)
    window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: 'center' }), 60);
}

/** Link interno do site: clique comum troca a tela na hora; Ctrl/⌘ ou botão do meio abrem aba. */
export function SiteLink({
  to,
  className,
  children,
  onClick,
  ...rest
}: {
  to: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.();
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        goTo(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
