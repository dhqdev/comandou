import { levelOf, scheduleText, toCents } from '@comandou/shared';
import {
  Bell,
  Bike,
  ChevronRight,
  Clock,
  Gift,
  HandPlatter,
  MapPin,
  Moon,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Store,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import {
  CSSProperties,
  useCallback,
  useEffect,
  RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useNavigationType } from 'react-router';
import { Button, Mascot, Modal } from '../../design-system';
import { brl } from '../../lib/money';
import { CookingArt, DeliveryArt, FavoritesArt, SearchArt } from './art';
import { CustomerAvatar } from './avatars';
import { useStore } from './context';
import { reducedMotion, setMorph } from './morph';
import {
  buildSections,
  onJump,
  requestJump,
  type Section,
  sectionPhoto,
  setActiveSection,
  takePendingJump,
  useActiveSection,
  useLayout,
} from './sections';
import {
  loyaltyUnit,
  productPoints,
  PublicBanner,
  PublicProduct,
  ptsText,
  recentOrders,
  seenNotices,
} from './store';
import { track } from './pixel';
import { LoopRail } from './LoopRail';
import { useLoyalty } from './LoyaltyScreens';
import { ReserveCard } from './ReservationScreens';
import { AtTableTile } from './AtTableTile';
import { TableWelcome } from './TableWelcome';
import { HeartButton, Photo } from './ui';

/** Produto sem escolha obrigatória pode ir direto para a sacola pelo "+" (por peso abre o item). */
const quickAddable = (p: PublicProduct) =>
  !p.soldOut && !p.soldByWeight && p.optionGroups.every((g) => g.minSelect === 0);

function useOpenProduct() {
  const navigate = useNavigate();
  return (p: PublicProduct, card?: HTMLElement | null) => {
    const img = card?.querySelector<HTMLElement>('.ph');
    if (img) setMorph(p.id, img.getBoundingClientRect());
    navigate(`/pedir/produto/${p.id}`);
  };
}

function useQuickAdd() {
  const { addToCart } = useStore();
  return (p: PublicProduct, from: HTMLElement | null) =>
    addToCart(
      {
        key: `${p.id}::`,
        productId: p.id,
        name: p.name,
        imageUrl: p.imageUrl,
        unit: p.price,
        optionIds: [],
        optionNames: [],
        quantity: 1,
        notes: '',
      },
      from,
    );
}

/** Cartão do produto (grade de duas colunas): foto, coração, selo, nome, preço e "+". */
function ProductCard({ p, i = 0, rank }: { p: PublicProduct; i?: number; rank?: number }) {
  const { favs, toggleFav, menu, rules } = useStore();
  const open = useOpenProduct();
  // "Ganhe N pts": quanto o item rende na fidelidade (a loja pode esconder).
  const pts = rules.loyalty && !p.soldOut ? productPoints(menu.loyalty, p) : null;
  const quick = useQuickAdd();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="pcard"
      style={{ '--i': Math.min(i, 8) } as CSSProperties}
      data-soldout={p.soldOut || undefined}
      role="button"
      tabIndex={0}
      onClick={() => open(p, ref.current)}
      onKeyDown={(e) => {
        // Enter ou espaço no próprio cartão; nos botões de dentro (favorito, Adicionar) não abre.
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        open(p, ref.current);
      }}
      aria-label={`${p.name}, ${p.soldOut ? 'esgotado' : `${brl(p.price)}${p.soldByWeight ? ' o quilo' : ''}`}`}
    >
      <div className="pcard__media">
        <Photo src={p.imageUrl} alt={p.name} ratio="4 / 3" className="pcard__photo" />
        <HeartButton
          className="pcard__heart"
          on={favs.includes(p.id)}
          onToggle={() => toggleFav(p.id)}
        />
        {(p.soldOut || p.badge) && (
          <span className="pcard__badge">{p.soldOut ? 'Esgotado' : p.badge}</span>
        )}
        {rank && (
          <span className="pcard__rank" aria-hidden>
            {rank}
          </span>
        )}
        {pts && (
          <span className="pcard__pts" aria-label={`Ganhe ${ptsText(pts)}`}>
            <Gift size={12} aria-hidden /> Ganhe <b>{ptsText(pts)}</b>
          </span>
        )}
      </div>
      <div className="pcard__body">
        <span className="pcard__name">{p.name}</span>
        {p.rating && p.rating.count > 0 && (
          <span className="pcard__rating" aria-label={`Nota ${p.rating.average} de 5`}>
            <Star size={12} aria-hidden />
            {p.rating.average.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}
            <small>({p.rating.count})</small>
          </span>
        )}
        <span className="pcard__foot">
          <span className="pcard__price">
            {p.soldOut ? '—' : brl(p.price)}
            {!p.soldOut && p.soldByWeight && <small>/kg</small>}
          </span>
          {!p.soldOut && (
            <button
              type="button"
              className="addbtn"
              aria-label={`Adicionar ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!quickAddable(p)) return open(p, ref.current);
                // O "+" gira (tirar e pôr o atributo reinicia a animação em toques seguidos).
                const btn = e.currentTarget;
                delete btn.dataset.added;
                void btn.offsetWidth;
                btn.dataset.added = '';
                quick(p, ref.current?.querySelector('.ph') ?? null);
              }}
            >
              <Plus size={16} />
              <span className="addbtn__txt">Adicionar</span>
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/** Grade de produtos; `ranked` vira a fileira de lado com 1, 2, 3 nas fotos (Mais pedidos). */
function ProductGrid({ list, ranked = false }: { list: PublicProduct[]; ranked?: boolean }) {
  return (
    <div className={ranked ? 'pgrid pgrid--rail' : 'pgrid'}>
      {list.map((p, i) => (
        <ProductCard key={p.id} p={p} i={i} rank={ranked ? i + 1 : undefined} />
      ))}
    </div>
  );
}

/**
 * Banners que dão a volta sem fim (para os dois lados) e trocam sozinhos a cada 5 s. Sem
 * promoção cadastrada, a capa da loja ocupa o lugar (parada, sem os pontinhos).
 */
function Banners({
  banners,
  cover,
  name,
  onPick,
}: {
  banners: PublicBanner[];
  cover: string | null;
  name: string;
  onPick(b: PublicBanner): void;
}) {
  const [cur, setCur] = useState(0);
  const onIndex = useCallback((i: number) => setCur(i), []);
  if (!banners.length)
    return cover ? (
      <section className="banners banners--cover">
        <div className="banner banner--cover" data-img="">
          <img src={cover} alt={name} className="banner__img" />
        </div>
      </section>
    ) : null;
  return (
    <section className="banners">
      <LoopRail
        className="banners__rail"
        label="Promoções"
        items={banners}
        keyOf={(b) => b.id}
        auto
        interval={5000}
        onIndex={onIndex}
        render={(b, i, copy) => (
          <button
            type="button"
            className="banner"
            data-img={b.imageUrl ? '' : undefined}
            style={{ '--i': i } as CSSProperties}
            onClick={() => onPick(b)}
            disabled={b.targetType === 'none'}
            tabIndex={copy ? -1 : undefined}
          >
            {b.imageUrl && <img src={b.imageUrl} alt="" className="banner__img" loading="lazy" />}
            <span className="banner__text">
              {b.tag && <span className="banner__tag">{b.tag}</span>}
              <strong>{b.title}</strong>
              {b.subtitle && <span className="banner__sub">{b.subtitle}</span>}
              {b.cta && b.targetType !== 'none' && <span className="banner__cta">{b.cta}</span>}
            </span>
          </button>
        )}
      />
      {banners.length > 1 && (
        <div className="banners__dots" aria-hidden>
          {banners.map((b, i) => (
            <span key={b.id} data-on={i === cur || undefined} />
          ))}
        </div>
      )}
    </section>
  );
}

type Sort = 'relevance' | 'price-asc' | 'price-desc' | 'name';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'relevance', label: 'Ordem do cardápio' },
  { id: 'price-asc', label: 'Menor preço' },
  { id: 'price-desc', label: 'Maior preço' },
  { id: 'name', label: 'Nome (A–Z)' },
];
interface Filters {
  sort: Sort;
  available: boolean;
}
const NO_FILTERS: Filters = { sort: 'relevance', available: false };

/**
 * Filtros escolhidos: a tela do início é remontada ao voltar do produto, então
 * ficam aqui fora para o cliente voltar para onde estava (somem ao recarregar a página).
 */
const kept: { filters: Filters } = { filters: NO_FILTERS };

function refine(list: PublicProduct[], f: Filters) {
  const out = f.available ? list.filter((p) => !p.soldOut) : [...list];
  const price = (p: PublicProduct) => toCents(p.price);
  if (f.sort === 'price-asc') out.sort((a, b) => price(a) - price(b));
  if (f.sort === 'price-desc') out.sort((a, b) => price(b) - price(a));
  if (f.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return out;
}

/** Horário, entrega, retirada, mínimo e endereço da loja ("Mais informações"). */
function StoreInfo({ open, onClose }: { open: boolean; onClose(): void }) {
  const { menu, table } = useStore();
  const r = menu.restaurant;
  const s = menu.store;
  return (
    <Modal
      open={open}
      title={r.name}
      onClose={onClose}
      footer={<Button onClick={onClose}>Ver o cardápio</Button>}
    >
      <div className="sf-info">
        {!table && (s.acceptsDelivery || s.acceptsPickup) && (
          <DeliveryArt delivery={s.acceptsDelivery} ride={s.isOpen} className="sf-info__art" />
        )}
        <span className={`status ${s.isOpen ? 'is-open' : 'is-closed'}`}>
          {scheduleText(s.isOpen, s.schedule)}
        </span>
        {menu.appearance.headline && (
          <p className="sf-info__about sf-info__headline">{menu.appearance.headline}</p>
        )}
        {r.about && <p className="sf-info__about">{r.about}</p>}
        <ul className="sf-info__list">
          {table && (
            <li>
              <HandPlatter size={18} aria-hidden />
              <span>
                <strong>Mesa {table.label}</strong>
                {tableServiceText(table.serviceFeePercent, !!menu.pix)}
              </span>
            </li>
          )}
          <li>
            <Clock size={18} aria-hidden />
            <span>
              <strong>{table ? 'Tempo de preparo' : 'Tempo de preparo e entrega'}</strong>
              {s.etaMin}–{s.etaMax} min
            </span>
          </li>
          {!table && s.acceptsDelivery && (
            <li>
              <Bike size={18} aria-hidden />
              <span>
                <strong>Entrega</strong>
                {s.deliveryZones
                  ? 'Taxa conforme o bairro'
                  : toCents(s.deliveryFee)
                    ? brl(s.deliveryFee)
                    : 'Grátis'}
              </span>
            </li>
          )}
          {!table && s.acceptsPickup && (
            <li>
              <Store size={18} aria-hidden />
              <span>
                <strong>Retirada</strong>
                Busque no balcão da loja
              </span>
            </li>
          )}
          {!table && toCents(s.minOrder) > 0 && (
            <li>
              <Wallet size={18} aria-hidden />
              <span>
                <strong>Pedido mínimo</strong>
                {brl(s.minOrder)}
              </span>
            </li>
          )}
          {r.address && (
            <li>
              <MapPin size={18} aria-hidden />
              <span>
                <strong>Endereço</strong>
                {r.address}
              </span>
            </li>
          )}
        </ul>
      </div>
    </Modal>
  );
}

/** Como a conta da mesa é paga (e a taxa de serviço, se a casa cobra). */
function tableServiceText(percent: string | null, pix: boolean) {
  const fee = percent ? Number(percent) : 0;
  const service = fee > 0 ? ` (serviço de ${fee.toLocaleString('pt-BR')}%)` : '';
  return `Vai para a conta da mesa${service}. ${pix ? 'Pague pelo Pix aqui no app ou no fim, com o garçom.' : 'Você paga no fim, com o garçom.'}`;
}

/** Ordenar e esconder esgotados: vale para a categoria aberta e para a busca. */
function FilterSheet({
  open,
  value,
  count,
  onChange,
  onClose,
}: {
  open: boolean;
  value: Filters;
  count: number;
  onChange(f: Filters): void;
  onClose(): void;
}) {
  return (
    <Modal
      open={open}
      title="Filtrar"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => onChange(NO_FILTERS)}>
            Limpar
          </Button>
          <Button onClick={onClose}>
            Ver {count} {count === 1 ? 'produto' : 'produtos'}
          </Button>
        </>
      }
    >
      <div className="sf-filter">
        <span className="sf-filter__label">Ordenar por</span>
        <div className="sf-filter__opts" role="radiogroup" aria-label="Ordenar por">
          {SORTS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={value.sort === o.id}
              className="sf-filter__opt"
              onClick={() => onChange({ ...value, sort: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
        <label className="sf-filter__toggle">
          <span>
            <strong>Só o que está disponível</strong>
            <small>Esconde os produtos esgotados</small>
          </span>
          <input
            type="checkbox"
            checked={value.available}
            onChange={(e) => onChange({ ...value, available: e.target.checked })}
          />
        </label>
      </div>
    </Modal>
  );
}

/**
 * Selo "Loja aberta" / "Loja fechada" no canto de cima, à direita (celular e notebook, pedido do
 * David, 0.270). `isOpen` já vem do servidor com o horário de funcionamento e a pausa da loja.
 * Aberta: pontinho verde com uma onda que se espalha devagar; fechada: pontinho cinza parado.
 */
function OpenBadge({ open }: { open: boolean }) {
  return (
    <span className="hm-open" data-open={open || undefined} role="status">
      <i className="hm-open__dot" aria-hidden />
      <span key={open ? 'a' : 'f'} className="hm-open__label">
        {open ? 'Loja aberta' : 'Loja fechada'}
      </span>
    </span>
  );
}

/**
 * Topo do app (todas as telas): a saudação com o nível e os pontos, o sino dos avisos da loja, a
 * loja (logo, nome e endereço, que abrem as informações) e a faixa do horário: "Aberta até 23h" ou
 * "Fechada. Abre hoje às 10h30". A entrega e a retirada ficam na sacola, não no início.
 */
function AppTop({ onInfo }: { onInfo(): void }) {
  const { menu, account, table, rules } = useStore();
  const l = useLoyalty();
  const me = account?.customer ?? null;
  const r = menu.restaurant;
  const s = menu.store;
  const first = me?.name.trim().split(/\s+/)[0];
  // Avisos novos (que este aparelho ainda não abriu): bolinha no sino.
  const live = menu.notices ?? [];
  const fresh = useMemo(() => {
    const seen = new Set(seenNotices());
    return live.some((id) => !seen.has(id));
  }, [live]);
  const acc = l?.account ?? null;
  const level = acc && l?.levels?.length ? levelOf(l.levels, acc.earned ?? 0).current : null;
  const status =
    table && !s.isOpen ? 'Pedidos pelo celular pausados' : scheduleText(s.isOpen, s.schedule);
  // O "aberta/fechada" é o selo do canto (0.270, celular e notebook; no notebook saiu a faixa
  // "Aberta agora · 30–40 min"). Fechada, o horário de abrir vai na linha de baixo do cartão.
  const closedHere = !s.isOpen && !table;
  return (
    <section className="hm-top" aria-label="Sua conta e a loja">
      <div className="hm-hello">
        <div className="hm-hello__text">
          <p className="hm-hello__hi">
            {first ? (
              <>
                Olá, <strong>{first}</strong>
              </>
            ) : (
              <strong>Olá!</strong>
            )}
          </p>
          {l && acc ? (
            <Link className="hm-hello__pts" to="/pedir/fidelidade">
              {level && (
                <span
                  className="hm-level"
                  style={level.color ? ({ '--lv': level.color } as CSSProperties) : undefined}
                >
                  {level.name}
                </span>
              )}
              <Gift size={15} aria-hidden />
              <b>{acc.balance.toLocaleString('pt-BR')}</b> {loyaltyUnit(l, acc.balance)}
              <ChevronRight size={15} aria-hidden className="hm-hello__go" />
            </Link>
          ) : l && rules.accountLogin && !me ? (
            <Link className="hm-hello__pts hm-hello__pts--join" to="/pedir/conta">
              <Gift size={15} aria-hidden /> Entre e ganhe {loyaltyUnit(l)} a cada pedido
              <ChevronRight size={15} aria-hidden className="hm-hello__go" />
            </Link>
          ) : !me && rules.accountLogin ? (
            <Link className="hm-hello__pts hm-hello__pts--join" to="/pedir/conta">
              Entre na sua conta
              <ChevronRight size={15} aria-hidden className="hm-hello__go" />
            </Link>
          ) : (
            menu.appearance.headline && <p className="hm-hello__line">{menu.appearance.headline}</p>
          )}
        </div>
        <div className="hm-hello__tools">
          <OpenBadge open={s.isOpen} />
          {!table && live.length > 0 && (
            <Link
              className="hm-iconbtn"
              to="/pedir/conta/notificacoes"
              aria-label={fresh ? 'Avisos da loja (novos)' : 'Avisos da loja'}
            >
              <Bell size={20} />
              {fresh && <i className="hm-iconbtn__dot" aria-hidden />}
            </Link>
          )}
          {rules.accountLogin && (
            <Link
              className="hm-iconbtn hm-iconbtn--me"
              to="/pedir/conta"
              aria-label="Minha conta"
              data-me={me ? '' : undefined}
            >
              {me ? <CustomerAvatar customer={me} size={40} decorative /> : <UserRound size={20} />}
            </Link>
          )}
        </div>
      </div>
      <button type="button" className="hm-store" onClick={onInfo}>
        <Photo src={r.logoUrl} alt={r.name} className="hm-store__logo" eager />
        <span className="hm-store__text">
          <strong>{r.name}</strong>
          <small>
            {closedHere ? (
              <span className="hm-store__closed" role="status">
                <Moon size={13} aria-hidden /> {status}
              </span>
            ) : table ? (
              <>
                <HandPlatter size={13} aria-hidden /> Mesa {table.label}
                {!s.isOpen && ' · chame o garçom'}
              </>
            ) : (
              <span className="hm-store__addr">{r.address || 'Horários, entrega e retirada'}</span>
            )}
          </small>
        </span>
        <ChevronRight size={18} aria-hidden className="hm-store__more" />
      </button>
    </section>
  );
}

/**
 * Grupos do cardápio em quadradinhos com foto (como num app), de quatro em quatro com os
 * pontinhos embaixo: tocar leva o cardápio até a categoria. Quando passam por baixo da busca, as
 * categorias em texto aparecem presas nela.
 */
function CategoryTiles({
  sections,
  box,
}: {
  sections: Section[];
  box: RefObject<HTMLElement | null>;
}) {
  const cur = useActiveSection() ?? sections[0]?.id;
  const rail = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const w = el.clientWidth || 1;
      setPages(Math.max(1, Math.round(el.scrollWidth / w)));
      setPage(Math.round(el.scrollLeft / w));
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, [sections.length]);
  return (
    <nav className="ctiles" aria-label="Categorias" ref={box}>
      <div className="ctiles__track" ref={rail}>
        {sections.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className="ctile"
            style={{ '--i': Math.min(i, 8) } as CSSProperties}
            aria-current={c.id === cur}
            onClick={() => requestJump(c.id)}
          >
            <Photo src={sectionPhoto(c)} alt="" className="ctile__photo" eager={i < 5} />
            <span>{c.name}</span>
          </button>
        ))}
      </div>
      {pages > 1 && (
        <div className="ctiles__dots" aria-hidden>
          {Array.from({ length: pages }, (_, i) => (
            <span key={i} data-on={i === Math.min(page, pages - 1) || undefined} />
          ))}
        </div>
      )}
    </nav>
  );
}

/** Coluna de categorias do tablet (como no totem): foto e nome, a da tela fica marcada. */
function CategoryRail({ sections }: { sections: Section[] }) {
  const active = useActiveSection();
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[aria-current="true"]');
    const b = box.current;
    if (!el || !b) return;
    if (el.offsetTop < b.scrollTop || el.offsetTop + el.offsetHeight > b.scrollTop + b.clientHeight)
      b.scrollTo({
        top: el.offsetTop - b.clientHeight / 2 + el.offsetHeight / 2,
        behavior: 'smooth',
      });
  }, [active]);
  return (
    <nav className="sf-rail" aria-label="Categorias" ref={box}>
      {sections.map((c) => (
        <button
          key={c.id}
          type="button"
          className="sf-rail__item"
          aria-current={active === c.id}
          onClick={() => requestJump(c.id)}
        >
          <Photo src={sectionPhoto(c)} alt={c.name} className="sf-rail__photo" />
          <span>{c.name}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * Rolagem que marca a seção na tela (o menu lateral e a coluna do tablet seguem) e o pulo até a
 * seção tocada. Durante o pulo a marcação fica parada, para não piscar as do meio do caminho.
 */
function useScrollSpy(ids: string[], on: boolean) {
  const key = ids.join('|');
  useEffect(() => {
    if (!on || !ids.length) return;
    let frame = 0;
    let lockUntil = 0;
    // A seção vale a partir de quando passa de um terço da área visível (abaixo da busca e das
    // categorias presas nela).
    const line = () => {
      const bar =
        document.querySelector('.cchips[data-on]') ?? document.querySelector('.searchbar');
      const top = bar?.getBoundingClientRect().bottom ?? 0;
      return top + (window.innerHeight - top) * 0.3;
    };
    const spy = () => {
      frame = 0;
      if (performance.now() < lockUntil) return;
      const y = line();
      let cur = ids[0]!;
      for (const id of ids) {
        const el = document.getElementById(`sec-${id}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= y) cur = id;
        else break;
      }
      const doc = document.documentElement;
      if (window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 4)
        cur = ids[ids.length - 1]!;
      setActiveSection(cur);
    };
    const onScroll = () => {
      if (performance.now() < lockUntil) lockUntil = Math.max(lockUntil, performance.now() + 160);
      if (!frame) frame = requestAnimationFrame(spy);
    };
    const jump = (id: string, smooth: boolean) => {
      const el = document.getElementById(`sec-${id}`);
      if (!el) return;
      lockUntil = performance.now() + 900;
      setActiveSection(id);
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    };
    const off = onJump((id) => jump(id, !reducedMotion()));
    const pending = takePendingJump();
    if (pending) requestAnimationFrame(() => jump(pending, false));
    else spy();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      off();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    // A lista de seções muda só quando o cardápio muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);
}

/**
 * A busca gruda no topo (ganha fundo e linha) e, no celular, as categorias em texto aparecem
 * presas embaixo dela quando as categorias com foto passam por baixo (`past`). Medido na rolagem, um quadro por vez: a busca tem a mesma
 * altura grudada ou não, então o cardápio não dá pulo ao passar por ela.
 */
function useStickySearch(term: string) {
  const bar = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(false);
  const [past, setPast] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const b = bar.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      const on = r.top <= (parseFloat(getComputedStyle(b).top) || 0) + 0.5;
      setStuck(on);
      // As categorias com foto já passaram por baixo da busca: hora das categorias em texto.
      const u = under.current;
      setPast(on && (!u || u.getBoundingClientRect().bottom <= r.bottom + 4));
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, [term]);
  return { bar, under, stuck, past };
}

/**
 * Categorias presas embaixo da busca (celular), depois que o carrossel sai da tela: a categoria
 * na tela fica marcada (a pílula desliza até ela) e tocar em outra leva o cardápio até lá.
 */
function CategoryChips({ sections, show }: { sections: Section[]; show: boolean }) {
  const cur = useActiveSection() ?? sections[0]?.id;
  const box = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const b = box.current;
    const p = pill.current;
    const el = b?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!b || !p || !el) return;
    p.style.width = `${el.offsetWidth}px`;
    p.style.transform = `translateX(${el.offsetLeft}px)`;
    if (
      el.offsetLeft < b.scrollLeft + 16 ||
      el.offsetLeft + el.offsetWidth > b.scrollLeft + b.clientWidth - 16
    )
      b.scrollTo({
        left: el.offsetLeft - (b.clientWidth - el.offsetWidth) / 2,
        behavior: show && !reducedMotion() ? 'smooth' : 'instant',
      });
  }, [cur, show, sections]);
  return (
    <div className="cchips" ref={box} data-on={show || undefined} aria-hidden={!show}>
      <span className="cchips__pill" ref={pill} aria-hidden />
      {sections.map((c) => (
        <button
          key={c.id}
          type="button"
          className="cchips__chip"
          aria-current={c.id === cur}
          tabIndex={show ? 0 : -1}
          onClick={() => requestJump(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

/** Onde o início estava: ao voltar do produto, a página volta para lá. */
let keptScroll = 0;

/**
 * Os cartões e banners entram com um fade só na primeira vez que o cardápio aparece. Voltar do
 * item, buscar ou trocar de filtro monta tudo de novo: sem isto, o cardápio inteiro sumia e
 * voltava (piscava) a cada volta.
 */
function useFirstViewOnly() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.hasAttribute('data-sf-seen')) return;
    const t = window.setTimeout(() => root.setAttribute('data-sf-seen', ''), 600);
    return () => window.clearTimeout(t);
  }, []);
}

export function HomeScreen() {
  useFirstViewOnly();
  const { menu, product, table, rules } = useStore();
  const layout = useLayout();
  const phone = layout === 'phone';
  const nav = useNavigationType();
  const open = useOpenProduct();
  const [search, setSearch] = useState('');
  const [picked, setFilters] = useState<Filters>(kept.filters);
  // Sem busca nem filtro no celular: lá vale o cardápio na ordem da loja.
  const filters = phone ? NO_FILTERS : picked;
  const [sheet, setSheet] = useState<'info' | 'filter' | null>(null);
  // Pedidos da mesa ficam no bloco da mesa (e saem do celular quando a conta é paga).
  const recent = useMemo(() => recentOrders().filter((o) => !o.tableId), []);
  const r = menu.restaurant;
  const term = phone ? '' : search.trim().toLowerCase();
  const { bar, under, stuck, past } = useStickySearch(term);

  // Começou a buscar: a busca sobe para o topo e os resultados aparecem logo embaixo dela (antes,
  // buscando do fim do cardápio, a página encolhia e ficava só o rodapé na tela).
  const searching = !!term;
  useLayoutEffect(() => {
    const b = bar.current;
    if (!searching || !b) return;
    // A busca gruda no topo, então a conta parte do que vem logo depois dela (os resultados).
    const next = b.nextElementSibling;
    if (!next) return;
    const top = parseFloat(getComputedStyle(b).top) || 0;
    const y = Math.max(0, window.scrollY + next.getBoundingClientRect().top - top - b.offsetHeight);
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'instant' });
  }, [searching, bar]);
  // Teclado aberto na busca (celular): o menu de baixo e a sacola saem da frente.
  useEffect(
    () => () => {
      delete document.documentElement.dataset.sfTyping;
    },
    [],
  );

  const all = useMemo(() => menu.categories.flatMap((c) => c.products), [menu]);
  const wheel = useMemo(() => buildSections(menu), [menu]);
  const changeFilters = (f: Filters) => {
    kept.filters = f;
    setFilters(f);
  };
  const filtered = filters.sort !== 'relevance' || filters.available;

  const results = term
    ? refine(
        all.filter(
          (p) =>
            p.name.toLowerCase().includes(term) ||
            (p.description ?? '').toLowerCase().includes(term),
        ),
        filters,
      )
    : [];
  const lists = useMemo(
    () => wheel.map((c) => ({ ...c, products: refine(c.products, filters) })),
    [wheel, filters],
  );
  // Pixel: a busca conta quando o cliente para de digitar (com quantos itens achou).
  const found = results.length;
  useEffect(() => {
    if (term.length < 2) return;
    const id = window.setTimeout(() => track('search', { term, quantity: found }), 1200);
    return () => window.clearTimeout(id);
  }, [term, found]);
  const listed = lists.reduce((n, c) => n + c.products.length, 0);

  // O cardápio inteiro numa rolagem só (em todas as telas): a rolagem marca a categoria.
  useScrollSpy(
    wheel.map((c) => c.id),
    !term,
  );

  // Voltar do produto devolve a página para onde estava.
  useLayoutEffect(() => {
    if (nav === 'POP' && keptScroll) window.scrollTo({ top: keptScroll, behavior: 'instant' });
    return () => {
      keptScroll = window.scrollY;
    };
    // Só ao abrir e sair do início.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickBanner(b: PublicBanner) {
    track('click_banner', { targetId: b.id });
    if (b.targetType === 'product') {
      const p = product(b.targetId!);
      if (p) open(p);
    } else if (b.targetType === 'category') requestJump(b.targetId!);
  }
  const chips = phone && !term && wheel.length > 1;

  const body = (
    <>
      <div className="sf-hero">
        <div className="sf-wrap">
          <AppTop onInfo={() => setSheet('info')} />
        </div>
        {/* Mesa do QR Code: boas-vindas e os passos (chamar o garçom, a conta). */}
        {table && phone && (
          <div className="sf-wrap sf-ridewrap">
            <TableWelcome onInfo={() => setSheet('info')} />
          </div>
        )}
      </div>
      <div
        className="searchbar"
        ref={bar}
        data-stuck={stuck || undefined}
        data-chips={chips || undefined}
        data-chips-on={(chips && past) || undefined}
        data-bare={phone || undefined}
      >
        {/* No celular sai a busca e o filtro (pedido do David): a faixa fica só para as categorias
            em texto que grudam no topo. */}
        {!phone && (
          <div className="sf-wrap searchbar__row">
            <label className="searchbox">
              <Search size={18} aria-hidden />
              <input
                type="search"
                placeholder={phone ? 'Buscar' : `Buscar em ${r.name}…`}
                aria-label="Buscar no cardápio"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => {
                  if (phone) document.documentElement.dataset.sfTyping = '';
                }}
                onBlur={() => {
                  delete document.documentElement.dataset.sfTyping;
                }}
                enterKeyHint="search"
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              {search && (
                <button type="button" aria-label="Limpar busca" onClick={() => setSearch('')}>
                  <X size={16} />
                </button>
              )}
            </label>
            <button
              type="button"
              className="filterbtn"
              aria-label="Filtrar e ordenar"
              data-on={filtered || undefined}
              onClick={() => setSheet('filter')}
            >
              <SlidersHorizontal size={19} />
            </button>
          </div>
        )}
        {chips && <CategoryChips sections={wheel} show={past} />}
      </div>
      {/* O banner (ou a capa da loja) vem antes dos grupos, como na vitrine de um app. */}
      {!term && (
        <div className="sf-wrap hm-banners">
          <Banners banners={menu.banners} cover={r.coverUrl} name={r.name} onPick={pickBanner} />
        </div>
      )}
      {chips && <CategoryTiles sections={wheel} box={under} />}

      <div className="sf-wrap sf-body">
        {term ? (
          <section className="sec" aria-live="polite">
            <h2 className="sec__title">
              {results.length
                ? `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}`
                : `Nada encontrado para “${search}”`}
            </h2>
            {results.length ? (
              <ProductGrid list={results} />
            ) : (
              <div className="empty-state empty-state--search">
                <SearchArt live className="empty-state__art" />
                <p>Tente outra palavra.</p>
                <button type="button" className="cta cta--inline" onClick={() => setSearch('')}>
                  Limpar busca
                </button>
              </div>
            )}
          </section>
        ) : (
          <>
            <div className="sf-perks">
              {/* Na mesa, os pedidos enviados ficam no bloco da mesa. */}
              {recent[0] && !table && (
                <Link className="ongoing" to={`/pedido/${recent[0].token}`}>
                  <span className="ongoing__dot" aria-hidden />
                  Pedido #{recent[0].number}
                  <ChevronRight size={16} />
                </Link>
              )}
              {!phone && table && <TableWelcome onInfo={() => setSheet('info')} />}
              {/* Quem já está sentado na mesa não precisa reservar (store-rules.ts). */}
              {rules.reservations && <ReserveCard />}
              {/* Já no restaurante: lê o QR Code da mesa e pede para ela (sem entrega). */}
              <AtTableTile />
            </div>

            {wheel.length === 0 ? (
              <div className="empty-state">
                <CookingArt live className="empty-state__art" />
                <strong>Cardápio em preparo</strong>
              </div>
            ) : (
              <>
                {lists.map((c) => (
                  <section
                    key={c.id}
                    id={`sec-${c.id}`}
                    className="sec sf-sec"
                    aria-labelledby={`sec-${c.id}-t`}
                  >
                    <h2 className="sec__title sec__title--cat" id={`sec-${c.id}-t`}>
                      {c.name}
                    </h2>
                    {c.products.length ? (
                      <ProductGrid list={c.products} ranked={c.id === '__popular'} />
                    ) : (
                      <p className="sf-empty">Nada disponível agora.</p>
                    )}
                  </section>
                ))}
              </>
            )}
          </>
        )}

        <footer className="store-foot">
          <p className="store-foot__brand">
            <Mascot size={20} badge /> Pedidos online por <strong>Comandou</strong>
          </p>
        </footer>
      </div>
    </>
  );

  return (
    <div className="sf-home" data-mode="sections" data-searching={searching || undefined}>
      {layout === 'tablet' && wheel.length > 0 && <CategoryRail sections={wheel} />}
      <div className="sf-home__main">{body}</div>

      <StoreInfo open={sheet === 'info'} onClose={() => setSheet(null)} />
      <FilterSheet
        open={sheet === 'filter'}
        value={filters}
        count={term ? results.length : listed}
        onChange={changeFilters}
        onClose={() => setSheet(null)}
      />
    </div>
  );
}

export function FavoritesScreen() {
  const { favs, product } = useStore();
  const list = favs.map((id) => product(id)).filter(Boolean) as PublicProduct[];
  return (
    <div className="sf-wrap sf-page">
      <h1 className="page-h1">Favoritos</h1>
      {list.length === 0 ? (
        <div className="empty-state">
          <FavoritesArt live className="empty-state__art" />
          <strong>Nenhum favorito ainda</strong>
          <p>Toque no coração de um prato.</p>
          <Link className="cta cta--inline" to="/pedir">
            Ver o cardápio
          </Link>
        </div>
      ) : (
        <div className="pgrid">
          {list.map((p, i) => (
            <ProductCard key={p.id} p={p} i={i} />
          ))}
        </div>
      )}
    </div>
  );
}
