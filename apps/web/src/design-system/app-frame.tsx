import { ChevronLeft, X } from 'lucide-react';
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
import { matchPath, NavLink, useLocation, useNavigate } from 'react-router';
import { useGlider } from './glider';
import { canAnimate, useLiquidDialog } from './liquid';
import { inViewTransition } from './transition';
import './app-frame.css';

/**
 * Moldura padrão de todos os apps do Comandou (restaurante e painel admin):
 *
 * - Computador/tablet: barra lateral fixa só de ícones (rótulo embaixo) e topo formam uma
 *   peça só; o conteúdo fica num painel com o canto arredondado. Itens com submenu abrem
 *   um painel que "escorre" para fora da barra.
 * - Celular/PWA: barra de abas embaixo com alvos grandes. A última aba ("Mais") abre uma tela
 *   própria (/mais) com o cartão da conta no topo e as outras telas em grupos de blocos; o
 *   submenu de uma aba sobe de baixo numa folha (Sheet) que fecha arrastando para baixo.
 */

/** Endereço da tela "Mais" do celular (a última aba). */
export const FRAME_MENU_PATH = '/mais';

/** Conta de quem está usando: cartão no topo da tela "Mais" e o grupo "Conta" no fim dela. */
export interface FrameAccount {
  name: string;
  /** Linha embaixo do nome (e-mail). */
  sub?: string;
  initials: string;
  /** Papel em destaque no cartão (ex.: Dono). */
  role?: string;
  /** Linha final do cartão (ex.: nome do restaurante). */
  note?: string;
  /** Ações da conta, em blocos. `danger` vira o botão largo do fim da tela (ex.: Sair). */
  actions: { key: string; label: string; icon: ReactNode; onClick: () => void; danger?: boolean }[];
  /** Texto miúdo no pé da tela (ex.: versão do app). */
  footnote?: ReactNode;
}
export interface FrameLink {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  /** Outro endereço que também acende o link (ex.: o cadastro do item acende "Itens"). */
  also?: string;
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
  /** Outro endereço que também acende o item (ex.: /pdv acende "PDV" quando ele mora em /). */
  also?: string;
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
  if (it.to) return isOn(pathname, it.to, it.end) || (!!it.also && isOn(pathname, it.also, true));
  return !!it.children?.some((c) => linkOn(pathname, c));
}
function linkOn(pathname: string, l: FrameLink) {
  return isOn(pathname, l.to, l.end) || (!!l.also && isOn(pathname, l.also, true));
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
  showWhere = true,
  moreActions = [],
  moreActionsTitle = 'Atalhos',
  linksTitle = 'Telas',
  account,
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
  /** No celular, mostra no topo o nome da tela atual (o painel admin já tem título próprio). */
  showWhere?: boolean;
  /** Atalhos no topo da tela "Mais" do celular, logo abaixo da conta (ex.: Conversas da equipe). */
  moreActions?: {
    key: string;
    label: string;
    icon: ReactNode;
    badge?: number;
    onClick: () => void;
  }[];
  /** Título do grupo dos atalhos (`moreActions`) na tela "Mais". */
  moreActionsTitle?: string;
  /** Título do grupo das telas soltas (sem submenu) que não viraram aba, na tela "Mais". */
  linksTitle?: string;
  /** Conta de quem está usando, para o topo da tela "Mais" (no computador segue o `panel`). */
  account?: FrameAccount;
}) {
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState<string | null>(null);
  // Item do submenu aberto na barra lateral; `closing` mantém o painel na tela durante a saída.
  const [fly, setFly] = useState<{ key: string; closing: boolean } | null>(null);
  const open = fly && !fly.closing ? fly.key : null;
  const setOpen = (key: string | null) =>
    setFly((f) => (key ? { key, closing: false } : f ? { ...f, closing: true } : null));
  const [anchor, setAnchor] = useState({ top: 0, bottom: 0 });
  const flyRef = useRef<HTMLDivElement>(null);
  const [flyTop, setFlyTop] = useState<number | null>(null);
  const [flySlide, setFlySlide] = useState(false);
  const rail = useGlider<HTMLDivElement>({ selector: '.cm-rail__item.is-active' });
  const tabbar = useGlider<HTMLElement>({
    selector: '.cm-tabbar__item.is-active',
  });
  const panel = useRef<HTMLDivElement>(null);
  const all = [...items, ...footer];
  useTableLabels(panel);
  // Celular: a última aba ("Mais") é uma tela, com a conta no topo e as outras telas em blocos.
  const onMenu = pathname === FRAME_MENU_PATH;
  const where = onMenu
    ? { label: 'Mais', icon: <MoreIcon />, order: -1 }
    : currentScreen(pathname, all);
  // Direção da troca de tela: indo para um item mais à direita/abaixo no menu, o conteúdo
  // entra deslizando da direita; voltando, da esquerda (como trocar de aba no celular).
  const order = where ? where.order : -1;
  const lastOrder = useRef(order);
  const pageDir = order < 0 || lastOrder.current < 0 ? 0 : Math.sign(order - lastOrder.current);
  useEffect(() => {
    lastOrder.current = order;
  }, [order]);
  // Tela desenhada dentro de uma troca com foto (transition.ts): a entrada própria fica de fora.
  const vtFor = useRef({ key: contentKey, vt: false });
  if (vtFor.current.key !== contentKey) vtFor.current = { key: contentKey, vt: inViewTransition() };
  // Celular: tela que não está nas abas de baixo (aberta pelo "Mais") ganha a seta de voltar no topo.
  const navigate = useNavigate();
  const onTabScreen = all.some((i) => tabs.includes(i.key) && itemActive(pathname, i));
  const onTab = onMenu || onTabScreen;
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(FRAME_MENU_PATH);
  };
  const [scrolled, setScrolled] = useState(false);

  // Trocou de tela: fecha menus e volta o painel ao topo.
  useEffect(() => {
    setFly(null);
    setFlyTop(null);
    setFlySlide(false);
    setSheet(null);
    panel.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Barra lateral: o panda e a conta ficam presos; só os itens do meio rolam (tela baixa).
  // Marca as bordas que ainda têm item escondido, para o CSS esmaecer e mostrar que dá para rolar.
  const itemCount = items.length;
  useEffect(() => {
    const nav = rail.ref.current;
    if (!nav) return;
    const edges = () => {
      const max = nav.scrollHeight - nav.clientHeight;
      nav.toggleAttribute('data-more-up', nav.scrollTop > 1);
      nav.toggleAttribute('data-more-down', nav.scrollTop < max - 1);
    };
    edges();
    nav.addEventListener('scroll', edges, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(edges) : null;
    if (ro) {
      ro.observe(nav);
      for (const c of nav.children) ro.observe(c);
    }
    return () => {
      nav.removeEventListener('scroll', edges);
      ro?.disconnect();
    };
  }, [itemCount]);

  // Tela atual escondida na parte que rola (ex.: abriu direto em Auditoria): traz o item à vista.
  const railShown = useRef(false);
  useLayoutEffect(() => {
    const nav = rail.ref.current;
    const el = nav?.querySelector<HTMLElement>('.cm-rail__item.is-active');
    if (!nav || !el) return;
    const pad = 12;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    let to: number | null = null;
    if (elTop < nav.scrollTop) to = Math.max(0, elTop - pad);
    else if (elBottom > nav.scrollTop + nav.clientHeight) to = elBottom - nav.clientHeight + pad;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (to !== null)
      nav.scrollTo({ top: to, behavior: railShown.current && !calm ? 'smooth' : 'auto' });
    railShown.current = true;
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    // Clique em outro item da barra troca o painel (o clique cuida disso); fora dela, fecha.
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.cm-flyout') && !t.closest('[data-rail-key]')) setOpen(null);
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
          data-tour-key={it.key}
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
        data-tour-key={it.key}
        className={`cm-rail__item ${active ? 'is-active' : ''}`}
        aria-expanded={hasMenu ? open === it.key : undefined}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        onClick={(e) => {
          if (!hasMenu) return it.onClick?.();
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ top: r.top, bottom: r.bottom });
          setOpen(open === it.key ? null : it.key);
        }}
      >
        {body}
      </button>
    );
  };

  const flyItem = fly ? all.find((i) => i.key === fly.key) : undefined;

  // Painel ao lado do botão: começa na altura dele; se não couber embaixo (ex.: Conta, no pé
  // da barra), termina na altura do botão, subindo a partir dele.
  useLayoutEffect(() => {
    const el = flyRef.current;
    if (!el || !fly || fly.closing) return;
    const h = el.offsetHeight;
    const max = window.innerHeight - h - 12;
    const top = anchor.top - 8 <= max ? anchor.top - 8 : anchor.bottom + 8 - h;
    setFlyTop(Math.max(12, Math.min(top, max)));
    // Só depois de aparecer no lugar certo o painel passa a deslizar entre os botões.
    const raf = requestAnimationFrame(() => setFlySlide(true));
    return () => cancelAnimationFrame(raf);
  }, [fly, anchor]);
  const sheetItem = sheet ? all.find((i) => i.key === sheet) : null;

  return (
    <div className={`cm-frame ${className}`}>
      <aside className="cm-rail" aria-label="Navegação principal">
        <div className="cm-rail__brand">{brand}</div>
        <nav
          className="cm-rail__nav cm-glide"
          ref={rail.ref}
          // Submenu aberto fica preso à altura do botão: rolando os itens, ele fecha.
          onScroll={() => open && setOpen(null)}
        >
          {items.map(railItem)}
          {rail.glider}
        </nav>
        {footer.length > 0 && <div className="cm-rail__foot">{footer.map(railItem)}</div>}
      </aside>

      {flyItem && (
        <div
          ref={flyRef}
          className="cm-flyout"
          role="menu"
          aria-label={flyItem.label}
          data-closing={fly?.closing || undefined}
          data-placed={flySlide || undefined}
          style={{ '--fly-top': `${flyTop ?? anchor.top - 8}px` } as CSSProperties}
          onAnimationEnd={(e) => {
            if (e.animationName === 'cm-fly-out') {
              setFly((f) => (f?.closing ? null : f));
              setFlyTop(null);
              setFlySlide(false);
            }
          }}
        >
          <div className="cm-flyout__body" key={flyItem.key}>
            <div className="cm-flyout__title">{flyItem.label}</div>
            {flyItem.children && <FlyLinks links={flyItem.children} />}
            {flyItem.panel}
          </div>
        </div>
      )}

      <header className="cm-frame__top" data-scrolled={scrolled || undefined}>
        {!onTab && (
          <button type="button" className="cm-frame__back" aria-label="Voltar" onClick={goBack}>
            <ChevronLeft size={24} aria-hidden />
          </button>
        )}
        {brandCompact && (
          <div className="cm-frame__compact" data-back={!onTab || undefined}>
            {brandCompact}
          </div>
        )}
        {showWhere && where && (
          <div className="cm-frame__where" aria-hidden>
            {where.icon}
            <span key={where.label}>{where.label}</span>
          </div>
        )}
        {top}
      </header>

      <div
        className="cm-frame__panel"
        ref={panel}
        onScroll={(e) => {
          const s = e.currentTarget.scrollTop > 4;
          if (s !== scrolled) setScrolled(s);
        }}
      >
        {banners}
        <main
          className="cm-frame__content cm-enter"
          key={contentKey}
          data-vt={vtFor.current.vt || undefined}
          style={{ '--cm-page-dir': pageDir } as CSSProperties}
        >
          {onMenu ? (
            <FrameMenu
              items={items.filter((i) => !tabs.includes(i.key))}
              footer={footer.filter((i) => !tabs.includes(i.key))}
              account={account}
              actions={moreActions}
              actionsTitle={moreActionsTitle}
              linksTitle={linksTitle}
            />
          ) : (
            children
          )}
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
                data-tour-key={it.key}
                className={`cm-tabbar__item ${active ? 'is-active' : ''}`}
              >
                {inner}
              </NavLink>
            ) : (
              <button
                key={it.key}
                type="button"
                data-tour-key={it.key}
                className={`cm-tabbar__item ${active ? 'is-active' : ''}`}
                onClick={() => (it.children || it.panel ? setSheet(it.key) : it.onClick?.())}
              >
                {inner}
              </button>
            );
          })}
        <NavLink
          to={FRAME_MENU_PATH}
          data-tour-key="more"
          className={`cm-tabbar__item ${onMenu || (!sheet && !onTabScreen) ? 'is-active' : ''}`}
          onClick={() => {
            // Já na tela "Mais": tocar de novo volta ao topo, como nas abas do iPhone.
            if (onMenu) panel.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <span className="cm-tabbar__icon">
            <MoreIcon />
          </span>
          <span className="cm-tabbar__label">Mais</span>
        </NavLink>
        {tabbar.glider}
      </nav>

      {/* Aba com submenu (ex.: Cardápio virou aba): os subitens sobem numa folha. */}
      <Sheet open={!!sheetItem} title={sheetItem?.label ?? ''} onClose={() => setSheet(null)}>
        {sheetItem?.children && <TileGrid links={sheetItem.children} />}
        {sheetItem?.panel}
      </Sheet>
    </div>
  );
}

/** Iniciais da pessoa num círculo, no lugar do ícone do item da conta na barra lateral. */
export function FrameAvatar({ name }: { name?: string | null }) {
  const initials =
    (name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  return (
    <span className="cm-rail__avatar" aria-hidden>
      {initials}
    </span>
  );
}

/** Tela atual (o link mais específico que bate com o endereço), para o topo do celular. */
function currentScreen(pathname: string, all: FrameItem[]) {
  let best: { label: string; icon: ReactNode; len: number; order: number } | null = null;
  let order = 0;
  const consider = (to: string, end: boolean | undefined, label: string, icon: ReactNode) => {
    order++;
    if (isOn(pathname, to, end) && (!best || to.length > best.len))
      best = { label, icon, len: to.length, order };
  };
  for (const it of all) {
    if (it.to) consider(it.to, it.end, it.label, it.icon);
    if (it.to && it.also) consider(it.also, true, it.label, it.icon);
    for (const c of it.children ?? []) {
      consider(c.to, c.end, c.label, c.icon);
      if (c.also) consider(c.also, true, c.label, c.icon);
    }
  }
  return best as { label: string; icon: ReactNode; order: number } | null;
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
        for (const row of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
          let i = 0;
          let badges = false;
          for (const td of row.cells) {
            const text = heads[i] ?? '';
            if (heads.length && td.dataset.label !== text) td.dataset.label = text;
            // célula sem rótulo que é só um selo: no celular fica na mesma linha dos outros selos
            const badge =
              i > 0 &&
              !text &&
              td.childElementCount === 1 &&
              !!td.firstElementChild?.classList.contains('cm-badge');
            if (td.classList.contains('cm-td--badge') !== badge)
              td.classList.toggle('cm-td--badge', badge);
            badges ||= badge;
            i += td.colSpan || 1;
          }
          if (row.classList.contains('cm-tr--badges') !== badges)
            row.classList.toggle('cm-tr--badges', badges);
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
  const { pathname } = useLocation();
  const g = useGlider<HTMLDivElement>({ selector: '.cm-flyout__link.active' });
  return (
    <div className="cm-flyout__links cm-glide" ref={g.ref}>
      {links.map((l, i) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end ?? l.to === '/'}
          className={({ isActive }) =>
            `cm-flyout__link ${isActive || linkOn(pathname, l) ? 'active' : ''}`
          }
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

type TileLink = FrameLink & { dot?: boolean };
type TileAction = {
  key: string;
  label: string;
  icon: ReactNode;
  /** Contador no canto do bloco (ex.: mensagens não lidas). */
  badge?: number;
  onClick: () => void;
};

/** Blocos com ícone em cima e o nome embaixo, três por linha (tela "Mais" e folhas de submenu). */
function TileGrid({ links, actions = [] }: { links: TileLink[]; actions?: TileAction[] }) {
  const { pathname } = useLocation();
  if (!links.length && !actions.length) return null;
  return (
    <div className="cm-tiles">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end ?? l.to === '/'}
          className={({ isActive }) => `cm-tile ${isActive || linkOn(pathname, l) ? 'active' : ''}`}
        >
          <span className="cm-tile__icon">
            {l.icon}
            {l.dot && <span className="cm-tile__dot" aria-label="novo" />}
          </span>
          <span className="cm-tile__label">{l.label}</span>
          {l.badge && <span className="cm-tile__badge">{l.badge}</span>}
        </NavLink>
      ))}
      {actions.map((a) => (
        <button key={a.key} type="button" className="cm-tile" onClick={a.onClick}>
          <span className="cm-tile__icon">{a.icon}</span>
          <span className="cm-tile__label">{a.label}</span>
          {!!a.badge && (
            <span className="cm-tile__count" aria-label={`${a.badge} não lidas`}>
              {a.badge > 99 ? '99+' : a.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Tela "Mais" do celular (como o "Conta" dos apps do iPhone): cartão de quem está usando no
 * topo, atalhos, as telas que não viraram aba em grupos de blocos e, no fim, a conta e o Sair.
 */
function FrameMenu({
  items,
  footer,
  account,
  actions,
  actionsTitle,
  linksTitle,
}: {
  items: FrameItem[];
  footer: FrameItem[];
  account?: FrameAccount;
  actions: TileAction[];
  actionsTitle: string;
  linksTitle: string;
}) {
  const links = (list: FrameItem[]): TileLink[] =>
    list
      .filter((i) => i.to)
      .map((i) => ({
        to: i.to!,
        label: i.label,
        icon: i.icon,
        end: i.end,
        also: i.also,
        dot: i.dot,
      }));
  const plain = (list: FrameItem[]): TileAction[] =>
    list
      .filter((i) => !i.to && !i.children && !i.panel && i.onClick)
      .map((i) => ({ key: i.key, label: i.label, icon: i.icon, onClick: i.onClick! }));
  // Com o cartão da conta, os itens do pé da barra (ex.: Novidades) vão para o grupo "Conta".
  const loose = account ? items : [...items, ...footer];
  type Section = {
    key: string;
    title: string;
    links?: TileLink[];
    actions?: TileAction[];
    panel?: ReactNode;
  };
  const sections = (
    [
      { key: 'atalhos', title: actionsTitle, actions },
      { key: 'telas', title: linksTitle, links: links(loose), actions: plain(loose) },
      ...[...items, ...footer]
        .filter((g) => g.children?.length)
        .map((g) => ({ key: g.key, title: g.label, links: g.children })),
      // Sem o cartão, o painel livre do item (ex.: conta) aparece como veio.
      ...(account
        ? [
            {
              key: 'conta',
              title: 'Conta',
              links: links(footer),
              actions: [...plain(footer), ...account.actions.filter((a) => !a.danger)],
            },
          ]
        : [...items, ...footer]
            .filter((p) => p.panel)
            .map((p) => ({ key: p.key, title: p.label, panel: p.panel }))),
    ] as Section[]
  ).filter((x) => x.links?.length || x.actions?.length || x.panel);
  const danger = account?.actions.filter((a) => a.danger) ?? [];
  let i = 0;
  return (
    <div className="cm-menu">
      <h1 className="cm-sr-only">Mais</h1>
      {account && (
        <section className="cm-menu__card" style={{ '--i': i++ } as CSSProperties}>
          <div className="cm-menu__who">
            <div className="cm-menu__avatar" aria-hidden>
              {account.initials}
            </div>
            <div className="cm-menu__id">
              <div className="cm-menu__name">{account.name}</div>
              {account.sub && <div className="cm-menu__sub">{account.sub}</div>}
            </div>
          </div>
          {(account.role || account.note) && (
            <div className="cm-menu__plan">
              {account.role && <div className="cm-menu__role">{account.role}</div>}
              {account.note && <div className="cm-menu__note">{account.note}</div>}
            </div>
          )}
        </section>
      )}
      {sections.map((sec) => (
        <section
          key={sec.key}
          className="cm-menu__group"
          aria-labelledby={`cm-menu-${sec.key}`}
          style={{ '--i': i++ } as CSSProperties}
        >
          <h2 className="cm-menu__title" id={`cm-menu-${sec.key}`}>
            {sec.title}
          </h2>
          <TileGrid links={sec.links ?? []} actions={sec.actions} />
          {sec.panel}
        </section>
      ))}
      {danger.length > 0 && (
        <div className="cm-menu__end" style={{ '--i': i++ } as CSSProperties}>
          {danger.map((a) => (
            <button key={a.key} type="button" className="cm-menu__danger" onClick={a.onClick}>
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
      {account?.footnote && <p className="cm-menu__foot">{account.footnote}</p>}
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
    if (open && d && !d.open) d.style.removeProperty('--drag');
  }, [open]);
  // Nasce de quem foi clicado (no celular sobe de baixo) e volta ao fechar (liquid.ts).
  const { shown } = useLiquidDialog(ref, open);
  useLayoutEffect(() => {
    // Foco na folha (não no X): no iPhone o X ficava com o anel de foco aceso.
    if (open) ref.current?.focus();
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
    // Fechou arrastando: a folha desce dali mesmo, sem voltar para cima antes.
    if (d && d.dy > 90) onClose();
    else ref.current?.style.removeProperty('--drag');
  };

  return (
    <dialog
      ref={ref}
      className="cm-sheet"
      tabIndex={-1}
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (e.target !== e.currentTarget || !canAnimate(e.currentTarget)) return;
        e.preventDefault();
        onClose();
      }}
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
      <div className="cm-sheet__body">{shown ? children : null}</div>
      {footer && <div className="cm-sheet__footer">{footer}</div>}
    </dialog>
  );
}
