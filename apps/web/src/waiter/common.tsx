import { type WaiterDay, type WaiterSeal } from '@comandou/shared';
import { ArrowLeft, Star } from 'lucide-react';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

/** Números do garçom (GET /waiter/me): alimentam os selos e os desafios do dia. */
export interface WaiterStats {
  name: string;
  since: string | null;
  totalOrders: number;
  today: WaiterDay;
}

export const WaiterStatsContext = createContext<{
  stats: WaiterStats | null;
  reload(): void;
}>({ stats: null, reload: () => undefined });

export const useWaiterStats = () => useContext(WaiterStatsContext);

/** Notebook/tablet deitado: carrinho fixo ao lado e menu lateral em vez das abas de baixo. */
export function useWide(min = 1024) {
  const query = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [query]);
  return wide;
}

/** Cabeçalho das telas do garçom: voltar (ou nada), título, subtítulo e ações à direita. */
export function WaiterHead({
  title,
  sub,
  back,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Para onde o botão voltar leva. Sem ele, não há botão. */
  back?: string;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="wt-head">
      {back && (
        <button
          type="button"
          className="wt-icon-btn"
          aria-label="Voltar"
          onClick={() => navigate(back)}
        >
          <ArrowLeft size={20} />
        </button>
      )}
      <div className="wt-head__text">
        <h1 className="wt-head__title">{title}</h1>
        {sub && <p className="wt-head__sub">{sub}</p>}
      </div>
      {children && <div className="wt-head__actions">{children}</div>}
    </header>
  );
}

const TIER: Record<WaiterSeal['tier'], [string, string, string]> = {
  // [claro, escuro, contorno]
  welcome: ['var(--cm-brand-400)', 'var(--cm-brand-700)', 'var(--cm-brand-800)'],
  bronze: ['#e7a06a', '#a3561f', '#6f3712'],
  silver: ['#e4e8ee', '#8d97a5', '#5b6472'],
  gold: ['#ffd76a', '#c48a12', '#7d5604'],
  diamond: ['#9ae8ff', '#3a7bf0', '#1d3f8f'],
};

/**
 * Selo hexagonal (como os do Anota AI). Conquistado tem a cor do nível; bloqueado fica cinza.
 * O "Bem-vindo" usa a cor da loja.
 */
export function Seal({
  seal,
  earned,
  size = 64,
}: {
  seal: WaiterSeal;
  earned: boolean;
  size?: number;
}) {
  const [light, dark, rim] = earned
    ? TIER[seal.tier]
    : ['var(--cm-gray-200)', 'var(--cm-gray-400)', 'var(--cm-gray-500)'];
  const id = `seal-${seal.orders}-${earned ? 'on' : 'off'}`;
  const label = seal.orders >= 100 ? 26 : 34;
  return (
    <svg
      className="wt-seal"
      data-earned={earned || undefined}
      width={size}
      height={size * 1.1}
      viewBox="0 0 100 110"
      role="img"
      aria-label={`${seal.name}${earned ? ' (conquistado)' : ' (bloqueado)'}`}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <polygon points="50,3 95,29 95,81 50,107 5,81 5,29" fill={rim} />
      <polygon points="50,10 89,32.5 89,77.5 50,100 11,77.5 11,32.5" fill={`url(#${id})`} />
      <polygon
        points="50,18 82,36.5 82,73.5 50,92 18,73.5 18,36.5"
        fill="none"
        stroke="rgba(255,255,255,.45)"
        strokeWidth="2"
      />
      {seal.orders === 0 ? (
        <g transform="translate(30 35)" style={{ color: '#fff' }}>
          <Star width={40} height={40} strokeWidth={2.2} />
        </g>
      ) : (
        <text
          x="50"
          y={seal.orders >= 100 ? 64 : 67}
          textAnchor="middle"
          fontSize={label}
          fontWeight="800"
          fill="#fff"
          stroke="rgba(0,0,0,.25)"
          strokeWidth="1"
          style={{ fontFamily: 'var(--cm-font)' }}
        >
          {seal.orders}
        </text>
      )}
      <path
        d="M50 79 l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
        fill="rgba(255,255,255,.75)"
      />
    </svg>
  );
}
