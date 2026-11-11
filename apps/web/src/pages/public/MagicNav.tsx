import type { LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import './magic-nav.css';

/**
 * Menu de baixo do cardápio no celular: barra simples presa na borda de baixo, com ícone e nome
 * em todas as abas. A aba aberta fica na cor da loja, com um fundo suave atrás do ícone.
 */

export interface MagicTab {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge: number;
}

/** Aba aberta para o caminho atual (as de baixo também valem para as telas dentro delas). */
function activeIndex(tabs: MagicTab[], pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  return tabs.findIndex((t) =>
    t.end ? path === t.to : path === t.to || path.startsWith(`${t.to}/`),
  );
}

export function MagicNav({
  tabs,
  hidden,
  label,
  dot,
}: {
  tabs: MagicTab[];
  hidden?: boolean;
  label: string;
  dot(n: number): React.ReactNode;
}) {
  const { pathname } = useLocation();
  const idx = activeIndex(tabs, pathname);
  return (
    <nav className="mnav" data-hidden={hidden || undefined} aria-label={label}>
      <div className="mnav__items">
        {tabs.map((t, i) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className="mnav__item"
            data-on={i === idx || undefined}
          >
            <span className="mnav__icon">
              <t.icon size={21} aria-hidden strokeWidth={i === idx ? 2.3 : 2} />
              {dot(t.badge)}
            </span>
            <span className="mnav__label">{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
