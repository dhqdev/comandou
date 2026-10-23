import { X } from 'lucide-react';
import {
  CSSProperties,
  RefObject,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { matchPath, NavLink, useLocation } from 'react-router';
import { useGlider } from './glider';
import './app-frame.css';

/**
 * Moldura padrão de todos os apps do Comandou (restaurante e painel admin):
 *
 * - Computador/tablet: barra lateral fixa só de ícones (rótulo embaixo) e topo formam uma
 *   peça só; o conteúdo fica num painel com o canto arredondado. Itens com submenu abrem
 *   um painel que "escorre" para fora da barra.
 * - Celular/PWA: barra de abas embaixo com alvos grandes; submenus e "Mais" sobem de baixo
 *   numa folha (Sheet) que fecha arrastando para baixo.
 */
export interface FrameLink {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  badge?: ReactNode;
}
export interface FrameItem {
  key: string;
  label: string;
  /** Rótulo curto embaixo do ícone (o nome completo fica para leitores de tela). */
  short?: string;
  icon: ReactNode;
  /** Link direto. Sem `to`, o item abre o submenu (`children`) ou o painel (`panel`). */
  to?: string;
  end?: boolean;
  /** Bolinha de aviso no ícone. */
  dot?: boolean;
  children?: FrameLink[];
  /** Conteúdo livre do submenu (ex.: conta do usuário). */
  panel?: ReactNode;
  /** Ação simples (ex.: instalar). */
  onClick?: () => void;
}

function isOn(pathname: string, to: string, end?: boolean) {
  return !!matchPath({ path: to, end: end ?? to === '/' }, pathname);
}
function itemActive(pathname: string, it: FrameItem) {
  if (it.to) return isOn(pathname, it.to, it.end);
  return !!it.children?.some((c) => isOn(pathname, c.to, c.end));
}

export function AppFrame({
  brand,
  brandCompact,
  items,
  footer = [],
  top,
  tabs,
  banners,
  children,
  contentKey,
  className = '',
}: {
  /** Topo da barra lateral (logo). */
  brand: ReactNode;
  /** Logo pequeno do topo no celular. */
  brandCompact?: ReactNode;
  items: FrameItem[];
  /** Itens presos no pé da barra (novidades, conta…). */
  footer?: FrameItem[];
  /** Conteúdo do topo (título, busca, ações). */
  top: ReactNode;
  /** Chaves dos itens que aparecem como abas no celular (até 4; o resto vai em "Mais"). */
  tabs: string[];
  banners?: ReactNode;
  children: ReactNode;
  /** Muda a cada tela, para reiniciar a animação de entrada e voltar ao topo. */
  contentKey?: string;
  className?: string;
}) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(0);
  const rail = useGlider<HTMLDivElement>({ selector: '.cm-rail__item.is-active' });
  const tabbar = useGlider<HTMLElement>({
    selector: '.cm-tabbar__item.is-active .cm-tabbar__icon',
  });
  const panel = useRef<HTMLDivElement>(null);
  const all = [...items, ...footer];
  useTableLabels(panel);

  // Trocou de tela: fecha menus e volta o painel ao topo.
  useEffect(() => {
    setOpen(null);
    setSheet(null);
    panel.current?.scrollTo({ top: 0 });
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.cm-flyout') && !t.closest(`[data-rail-key="${open}"]`)) setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const railItem = (it: FrameItem) => {
    const active = itemActive(pathname, it) || open === it.key;
    const body = (
      <>
        <span className="cm-rail__icon">
          {it.icon}
          {it.dot && <span className="cm-rail__dot" aria-hidden />}
        </span>
        <span className="cm-rail__label" aria-hidden={it.short ? true : undefined}>
          {it.short ?? it.label}
        </span>
      </>
    );
    if (it.to)
      return (
        <NavLink
          key={it.key}
          to={it.to}
          end={it.end ?? it.to === '/'}
          aria-label={it.label}
          className={`cm-rail__item ${active ? 'is-active' : ''}`}
        >
          {body}
        </NavLink>
      );
    const hasMenu = !!(it.children || it.panel);
    return (
      <button
        key={it.key}
        type="button"
        data-rail-key={it.key}
        className={`cm-rail__item ${active ? 'is-active' : ''}`}
        aria-expanded={hasMenu ? open === it.key : undefined}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        onClick={(e) => {
          if (!hasMenu) return it.onClick?.();
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(r.top);
          setOpen((o) => (o === it.key ? null : it.key));
        }}
      >
        {body}
      </button>
    );
  };

  const flyItem = all.find((i) => i.key === open);
  const sheetItems = sheet === 'more' ? all.filter((i) => !tabs.includes(i.key)) : null;
  const sheetItem = sheet && sheet !== 'more' ? all.find((i) => i.key === sheet) : null;

  return (
    <div className={`cm-frame ${className}`}>
      <aside className="cm-rail" aria-label="Navegação principal">
        <div className="cm-rail__brand">{brand}</div>
        <nav className="cm-rail__nav cm-glide" ref={rail.ref}>
          {items.map(railItem)}
          {rail.glider}
        </nav>
        {footer.length > 0 && <div className="cm-rail__foot">{footer.map(railItem)}</div>}
      </aside>

      {flyItem && (
        <div
          className="cm-flyout"
          role="menu"
          aria-label={flyItem.label}
          style={{ '--fly-top': `${anchor}px` } as CSSProperties}
        >
          <div className="cm-flyout__title">{flyItem.label}</div>
          {flyItem.children && <FlyLinks links={flyItem.children} />}
          {flyItem.panel}
        </div>
      )}

      <header className="cm-frame__top">
        {brandCompact && <div className="cm-frame__compact">{brandCompact}</div>}
        {top}
      </header>

      <div className="cm-frame__panel" ref={panel}>
        {banners}
        <main className="cm-frame__content cm-enter" key={contentKey}>
          {children}
        </main>
      </div>

      <nav className="cm-tabbar cm-glide" aria-label="Navegação" ref={tabbar.ref}>
        {tabs
          .map((k) => all.find((i) => i.key === k))
          .filter((i): i is FrameItem => !!i)
          .map((it) => {
            const active = itemActive(pathname, it) || sheet === it.key;
            const inner = (
              <>
                <span className="cm-tabbar__icon">
                  {it.icon}
                  {it.dot && <span className="cm-rail__dot" aria-hidden />}
                </span>
                <span className="cm-tabbar__label">{it.short ?? it.label}</span>
              </>
            );
            return it.to ? (
              <NavLink
                key={it.key}
                to={it.to}
                end={it.end ?? it.to === '/'}
                aria-label={it.label}
                className={`cm-tabbar__item ${active ? 'is-active' : ''}`}
              >
                {inner}
              </NavLink>
            ) : (
              <button
                key={it.key}
                type="button"
                className={`cm-tabbar__item ${active ? 'is-active' : ''}`}
                onClick={() => (it.children || it.panel ? setSheet(it.key) : it.onClick?.())}
              >
                {inner}
              </button>
            );
          })}
        <button
          type="button"
          className={`cm-tabbar__item ${sheet === 'more' || (!sheet && !all.some((i) => tabs.includes(i.key) && itemActive(pathname, i))) ? 'is-active' : ''}`}
          onClick={() => setSheet('more')}
        >
          <span className="cm-tabbar__icon">
            <MoreIcon />
          </span>
          <span className="cm-tabbar__label">Mais</span>
        </button>
        {tabbar.glider}
      </nav>

      <Sheet
        open={!!sheet}
        title={sheet === 'more' ? 'Menu' : (sheetItem?.label ?? '')}
        onClose={() => setSheet(null)}
      >
        {sheetItem?.children && <TileGrid links={sheetItem.children} />}
        {sheetItem?.panel}
        {sheetItems && (
          <div className="cm-sheet-menu">
            <TileGrid
              links={sheetItems
                .filter((it) => it.to)
                .map((it) => ({ to: it.to!, label: it.label, icon: it.icon, end: it.end }))}
              actions={sheetItems
                .filter((it) => !it.to && !it.children && !it.panel && it.onClick)
                .map((it) => ({ label: it.label, icon: it.icon, onClick: it.onClick! }))}
            />
            {sheetItems
              .filter((it) => it.children)
              .map((it) => (
                <section key={it.key}>
                  <h3 className="cm-sheet-menu__group">{it.label}</h3>
                  <TileGrid links={it.children!} />
                </section>
              ))}
            {sheetItems
              .filter((it) => it.panel)
              .map((it) => (
                <section key={it.key}>
                  <h3 className="cm-sheet-menu__group">{it.label}</h3>
                  {it.panel}
                </section>
              ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}

/**
 * Copia o texto do cabeçalho de cada coluna para `data-label` das células, para a tabela
 * virar cartões "rótulo: valor" no celular (CSS em components.css). Vale para todas as telas.
 */
function useTableLabels(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const label = () => {
      for (const table of el.querySelectorAll<HTMLTableElement>('table.cm-table')) {
        const heads = [...table.querySelectorAll('thead th')].map(
          (th) => th.textContent?.trim() ?? '',
        );
        if (!heads.length) continue;
        for (const row of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
          let i = 0;
          for (const td of row.cells) {
            const text = heads[i] ?? '';
            if (td.dataset.label !== text) td.dataset.label = text;
            i += td.colSpan || 1;
          }
        }
      }
    };
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(label);
    });
    mo.observe(el, { childList: true, subtree: true });
    label();
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [root]);
}

function FlyLinks({ links }: { links: FrameLink[] }) {
  const g = useGlider<HTMLDivElement>({ selector: '.cm-flyout__link.active' });
  return (
    <div className="cm-flyout__links cm-glide" ref={g.ref}>
      {links.map((l, i) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end ?? l.to === '/'}
          className={({ isActive }) => `cm-flyout__link ${isActive ? 'active' : ''}`}
          style={{ '--i': i } as CSSProperties}
          role="menuitem"
        >
          {l.icon}
          <span>{l.label}</span>
          {l.badge}
        </NavLink>
      ))}
      {g.glider}
    </div>
  );
}

function TileGrid({
  links,
  actions = [],
}: {
  links: FrameLink[];
  actions?: { label: string; icon: ReactNode; onClick: () => void }[];
}) {
  if (!links.length && !actions.length) return null;
  return (
    <div className="cm-tiles">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end ?? l.to === '/'}
          className={({ isActive }) => `cm-tile ${isActive ? 'active' : ''}`}
        >
          {l.icon}
          <span>{l.label}</span>
          {l.badge && <span className="cm-tile__badge">{l.badge}</span>}
        </NavLink>
      ))}
      {actions.map((a) => (
        <button key={a.label} type="button" className="cm-tile" onClick={a.onClick}>
          {a.icon}
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </svg>
  );
}

/**
 * Folha que sobe de baixo (celular). Fecha no X, tocando fora, com Esc ou arrastando a
 * alça para baixo. No computador vira um modal centralizado.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const drag = useRef<{ y: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.style.removeProperty('--drag');
      d.showModal?.();
    }
    if (!open && d.open) d.close?.();
  }, [open]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    ref.current?.setAttribute('data-dragging', 'true');
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    drag.current.dy = dy;
    ref.current?.style.setProperty('--drag', `${dy}px`);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    ref.current?.removeAttribute('data-dragging');
    ref.current?.style.removeProperty('--drag');
    if (d && d.dy > 90) onClose();
  };

  return (
    <dialog
      ref={ref}
      className="cm-sheet"
      aria-labelledby={titleId}
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cm-sheet__head"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <span className="cm-sheet__handle" aria-hidden />
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="cm-sheet__close" aria-label="Fechar" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="cm-sheet__body">{open ? children : null}</div>
      {footer && <div className="cm-sheet__footer">{footer}</div>}
    </dialog>
  );
}
