import { toCents } from '@comandou/shared';
import {
  Bike,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  Info,
  MapPin,
  Moon,
  Plus,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Store,
  TrendingUp,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import {
  CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Mascot, Modal } from '../../design-system';
import { brl } from '../../lib/money';
import { useStore } from './context';
import { setMorph } from './morph';
import { PublicBanner, PublicProduct, recentOrders } from './store';
import { LoopRail } from './LoopRail';
import { LoyaltyStrip } from './LoyaltyScreens';
import { ReserveCard } from './ReservationScreens';
import { HeartButton, Photo } from './ui';

/** Produto sem escolha obrigatória pode ir direto para a sacola pelo "+". */
const quickAddable = (p: PublicProduct) =>
  !p.soldOut && p.optionGroups.every((g) => g.minSelect === 0);

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
function ProductCard({ p, i = 0 }: { p: PublicProduct; i?: number }) {
  const { favs, toggleFav } = useStore();
  const open = useOpenProduct();
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
      onKeyDown={(e) => e.key === 'Enter' && open(p, ref.current)}
      aria-label={`${p.name}, ${p.soldOut ? 'esgotado' : brl(p.price)}`}
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
      </div>
      <div className="pcard__body">
        <span className="pcard__name">{p.name}</span>
        {p.description && <span className="pcard__desc">{p.description}</span>}
        <span className="pcard__foot">
          <span className="pcard__price">{p.soldOut ? '—' : brl(p.price)}</span>
          {!p.soldOut && (
            <button
              type="button"
              className="addbtn"
              aria-label={`Adicionar ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (quickAddable(p)) quick(p, ref.current?.querySelector('.ph') ?? null);
                else open(p, ref.current);
              }}
            >
              <Plus size={16} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function ProductGrid({ list }: { list: PublicProduct[] }) {
  return (
    <div className="pgrid">
      {list.map((p, i) => (
        <ProductCard key={p.id} p={p} i={i} />
      ))}
    </div>
  );
}

/** Banners que dão a volta sem fim (para os dois lados) e trocam sozinhos a cada 5 s. */
function Banners({ banners, onPick }: { banners: PublicBanner[]; onPick(b: PublicBanner): void }) {
  const [cur, setCur] = useState(0);
  const onIndex = useCallback((i: number) => setCur(i), []);
  if (!banners.length) return null;
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
 * Categoria e filtros escolhidos: a tela do início é remontada ao voltar do produto, então
 * ficam aqui fora para o cliente voltar para onde estava (somem ao recarregar a página).
 */
const kept: { cat: string | null; filters: Filters } = { cat: null, filters: NO_FILTERS };

function refine(list: PublicProduct[], f: Filters) {
  const out = f.available ? list.filter((p) => !p.soldOut) : [...list];
  const price = (p: PublicProduct) => toCents(p.price);
  if (f.sort === 'price-asc') out.sort((a, b) => price(a) - price(b));
  if (f.sort === 'price-desc') out.sort((a, b) => price(b) - price(a));
  if (f.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return out;
}

interface WheelItem {
  id: string;
  name: string;
  imageUrl: string | null;
  icon?: typeof Star;
  products: PublicProduct[];
}

const flat = () => window.matchMedia?.('(min-width: 900px)').matches;

/** Cópias das categorias lado a lado no celular: a do meio é a "de verdade"; as outras dão a volta. */
const WHEEL_COPIES = 5;
const WHEEL_MID = Math.floor(WHEEL_COPIES / 2);

/**
 * Carrossel de categorias (como no PedidoJá): rola de lado, a do meio fica maior e é a que
 * aparece embaixo. Tocar numa categoria a traz para o meio; soltar a rolagem escolhe a do meio.
 * No celular ele não tem fim: depois da última categoria vem a primeira de novo (a lista se
 * repete e, quando a rolagem para, volta em silêncio para a cópia do meio).
 */
function CategoryWheel({
  items,
  cur,
  onPick,
}: {
  items: WheelItem[];
  cur: string;
  onPick(id: string): void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(cur);
  const settle = useRef(0);
  const frame = useRef(0);
  const curRef = useRef(cur);
  curRef.current = cur;
  const canLoop = items.length > 2;
  const [loop, setLoop] = useState(() => canLoop && !flat());
  const copies = loop ? WHEEL_COPIES : 1;

  /** Largura de uma volta inteira (uma cópia da lista). */
  const period = () => {
    const t = track.current;
    if (!t || !loop) return 0;
    const first = t.querySelector<HTMLElement>(`.wheel__item[data-copy="0"]`);
    const next = t.querySelector<HTMLElement>(`.wheel__item[data-copy="1"]`);
    return first && next ? next.offsetLeft - first.offsetLeft : 0;
  };

  /** Rolagem parada fora da cópia do meio: pula uma volta inteira (a tela fica igual). */
  const recenter = () => {
    const t = track.current;
    const p = period();
    if (!t || !p) return;
    let x = t.scrollLeft;
    while (x < p * (WHEEL_MID - 0.5)) x += p;
    while (x >= p * (WHEEL_MID + 0.5)) x -= p;
    if (Math.abs(x - t.scrollLeft) > 1) t.scrollTo({ left: x, behavior: 'instant' });
  };

  /** Leva a categoria ao meio, usando a cópia mais perto de onde a faixa está. */
  const center = (id: string, behavior: ScrollBehavior, preferMiddle = false) => {
    const t = track.current;
    if (!t) return;
    const all = [...t.querySelectorAll<HTMLElement>(`.wheel__item[data-id="${CSS.escape(id)}"]`)];
    const mid = t.scrollLeft + t.clientWidth / 2;
    const el = preferMiddle
      ? (all.find((e) => e.dataset.copy === String(loop ? WHEEL_MID : 0)) ?? all[0])
      : all.reduce<HTMLElement | undefined>((best, e) => {
          const d = Math.abs(e.offsetLeft + e.offsetWidth / 2 - mid);
          return !best || d < Math.abs(best.offsetLeft + best.offsetWidth / 2 - mid) ? e : best;
        }, undefined);
    if (!el) return;
    t.scrollTo({ left: el.offsetLeft - (t.clientWidth - el.offsetWidth) / 2, behavior });
  };

  // Tamanho e altura de cada bolinha conforme a distância do meio: forma um arco.
  const paint = () => {
    const t = track.current;
    if (!t) return null;
    const mid = t.scrollLeft + t.clientWidth / 2;
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const el of t.querySelectorAll<HTMLElement>('.wheel__item')) {
      const d = (el.offsetLeft + el.offsetWidth / 2 - mid) / el.offsetWidth;
      const a = Math.min(Math.abs(d), 3);
      el.style.setProperty('--s', String(1 - a * 0.13));
      el.style.setProperty('--y', `${a * a * 3}px`);
      el.style.setProperty('--o', String(Math.max(0, 1 - a * 0.45)));
      if (Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        best = el;
      }
    }
    return best?.dataset.id ?? null;
  };

  useLayoutEffect(() => {
    center(curRef.current, 'instant', true);
    paint();
    const onResize = () => {
      // Celular ↔ computador: no computador as categorias ficam lado a lado, sem repetir.
      const want = canLoop && !flat();
      if (want !== loop) return setLoop(want);
      center(curRef.current, 'instant', true);
      paint();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame.current);
      window.clearTimeout(settle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop, canLoop]);
  useEffect(() => setLive(cur), [cur]);

  const onScroll = () => {
    // No computador as categorias ficam lado a lado (sem arco): rolar não troca a categoria.
    if (flat()) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const id = paint();
      if (id) setLive(id);
    });
    // Parou de rolar: a categoria do meio passa a ser a escolhida.
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      recenter();
      const id = paint();
      if (id && id !== curRef.current) onPick(id);
    }, 140);
  };

  const step = (dir: 1 | -1) => {
    const n = items.length;
    const i = items.findIndex((c) => c.id === cur);
    const j = loop ? (i + dir + n) % n : Math.max(0, Math.min(n - 1, i + dir));
    const next = items[j];
    if (next) {
      onPick(next.id);
      center(next.id, 'smooth');
    }
  };

  return (
    <section className="wheel" aria-label="Categorias">
      <div className="wheel__band">
        <button
          type="button"
          className="wheel__arrow wheel__arrow--prev"
          aria-label="Categoria anterior"
          onClick={() => step(-1)}
          disabled={!loop && items[0]?.id === cur}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="wheel__track" ref={track} onScroll={onScroll} role="tablist">
          {Array.from({ length: copies }, (_, k) =>
            items.map((c) => {
              const copy = loop && k !== WHEEL_MID;
              return (
                <button
                  key={`${k}:${c.id}`}
                  type="button"
                  role="tab"
                  data-id={c.id}
                  data-copy={k}
                  aria-hidden={copy || undefined}
                  tabIndex={copy ? -1 : undefined}
                  aria-selected={c.id === cur}
                  data-live={c.id === live || undefined}
                  aria-label={c.name}
                  title={c.name}
                  className="wheel__item"
                  onClick={(e) => {
                    onPick(c.id);
                    const t = track.current;
                    const el = e.currentTarget;
                    t?.scrollTo({
                      left: el.offsetLeft - (t.clientWidth - el.offsetWidth) / 2,
                      behavior: 'smooth',
                    });
                  }}
                >
                  <span className="wheel__disc">
                    {c.icon ? (
                      <c.icon size={24} />
                    ) : (
                      <Photo
                        src={c.imageUrl ?? c.products.find((p) => p.imageUrl)?.imageUrl ?? null}
                        alt={c.name}
                        className="wheel__photo"
                      />
                    )}
                  </span>
                  <span className="wheel__name" aria-hidden>
                    {c.name}
                  </span>
                </button>
              );
            }),
          )}
        </div>
        <button
          type="button"
          className="wheel__arrow wheel__arrow--next"
          aria-label="Próxima categoria"
          onClick={() => step(1)}
          disabled={!loop && items[items.length - 1]?.id === cur}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}

/** Horário, entrega, retirada, mínimo e endereço da loja ("Mais informações"). */
function StoreInfo({ open, onClose }: { open: boolean; onClose(): void }) {
  const { menu } = useStore();
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
        <span className={`status ${s.isOpen ? 'is-open' : 'is-closed'}`}>
          {s.isOpen ? 'Aberto agora' : 'Fechado agora'}
        </span>
        {r.about && <p className="sf-info__about">{r.about}</p>}
        <ul className="sf-info__list">
          <li>
            <Clock size={18} aria-hidden />
            <span>
              <strong>Tempo de preparo e entrega</strong>
              {s.etaMin}–{s.etaMax} min
            </span>
          </li>
          {s.acceptsDelivery && (
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
          {s.acceptsPickup && (
            <li>
              <Store size={18} aria-hidden />
              <span>
                <strong>Retirada</strong>
                Busque no balcão da loja
              </span>
            </li>
          )}
          {toCents(s.minOrder) > 0 && (
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

export function HomeScreen() {
  const { menu, account, product, count } = useStore();
  const open = useOpenProduct();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(kept.filters);
  const [sheet, setSheet] = useState<'info' | 'filter' | null>(null);
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const recent = useMemo(recentOrders, []);
  const r = menu.restaurant;
  const s = menu.store;
  const first = account?.customer?.name.split(' ')[0];

  // A busca gruda no topo e ganha uma linha embaixo depois que a capa sai da tela.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const all = useMemo(() => menu.categories.flatMap((c) => c.products), [menu]);
  const wheel = useMemo<WheelItem[]>(() => {
    const featured = all.filter((p) => p.featured);
    const popular = menu.popular.map((id) => product(id)).filter(Boolean) as PublicProduct[];
    return [
      ...(featured.length
        ? [
            {
              id: '__featured',
              name: menu.appearance.featuredTitle || 'Destaques',
              imageUrl: null,
              icon: Star,
              products: featured,
            },
          ]
        : []),
      ...(popular.length > 2
        ? [
            {
              id: '__popular',
              name: 'Mais pedidos',
              imageUrl: null,
              icon: TrendingUp,
              products: popular,
            },
          ]
        : []),
      ...menu.categories.filter((c) => c.products.length > 0),
    ];
  }, [all, menu, product]);
  const [cat, setCatState] = useState<string>(() =>
    wheel.some((c) => c.id === kept.cat) ? kept.cat! : (wheel[0]?.id ?? ''),
  );
  const setCat = (id: string) => {
    kept.cat = id;
    setCatState(id);
  };
  const changeFilters = (f: Filters) => {
    kept.filters = f;
    setFilters(f);
  };
  const filtered = filters.sort !== 'relevance' || filters.available;

  const term = search.trim().toLowerCase();
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
  const current = wheel.find((c) => c.id === cat) ?? wheel[0];
  // A grade entra pelo lado para onde o carrossel andou (direita = próxima categoria).
  const catIdx = current ? wheel.indexOf(current) : 0;
  const [slide, setSlide] = useState({ idx: catIdx, dir: 'fwd' as 'fwd' | 'back' });
  if (slide.idx !== catIdx) setSlide({ idx: catIdx, dir: catIdx < slide.idx ? 'back' : 'fwd' });
  const shown = current ? refine(current.products, filters) : [];

  function pickBanner(b: PublicBanner) {
    if (b.targetType === 'product') {
      const p = product(b.targetId!);
      if (p) open(p);
    } else if (b.targetType === 'category') {
      setCat(b.targetId!);
      document.querySelector('.wheel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <>
      {/* Topo do celular: saudação e sacola (no computador isso fica na barra do topo). */}
      <header className="sf-top">
        {menu.appearance.accountsEnabled ? (
          <Link className="sf-top__avatar" to="/pedir/conta" aria-label="Minha conta">
            {first ? first[0]!.toUpperCase() : <UserRound size={18} />}
          </Link>
        ) : (
          <Photo src={r.logoUrl} alt={r.name} className="sf-top__avatar" eager />
        )}
        <span className="sf-top__hello">
          <strong>{first ? `Olá, ${first}` : 'Olá!'}</strong>
          <small>{menu.appearance.headline || 'Bateu a fome? Peça agora!'}</small>
        </span>
        <Link
          className="sf-top__bag"
          to="/pedir/sacola"
          aria-label={count ? `Sacola com ${count} itens` : 'Sacola'}
        >
          <ShoppingBag size={20} />
          {count > 0 && <span className="cartpill__count">{count}</span>}
        </Link>
      </header>

      {/* Capa só com a foto; a logo redonda encosta nela por baixo, com nome e situação. */}
      <div className="sf-cover">
        {r.coverUrl ? (
          <img src={r.coverUrl} alt="" className="sf-cover__img" />
        ) : (
          <div className="sf-cover__art" />
        )}
      </div>
      <section className="sf-wrap sf-head">
        <Photo src={r.logoUrl} alt={r.name} className="sf-head__logo" eager />
        <h1>{r.name}</h1>
        <span className={`status ${s.isOpen ? 'is-open' : 'is-closed'}`}>
          {s.isOpen ? 'Aberto agora' : 'Fechado agora'}
        </span>
        <span className="sf-head__meta">
          <Clock size={14} aria-hidden /> {s.etaMin}–{s.etaMax} min
          {s.acceptsDelivery && !s.deliveryZones && (
            <>
              <span aria-hidden>·</span>
              {toCents(s.deliveryFee) ? `Entrega ${brl(s.deliveryFee)}` : 'Entrega grátis'}
            </>
          )}
        </span>
        <button type="button" className="sf-head__more" onClick={() => setSheet('info')}>
          <Info size={15} aria-hidden />
          Mais informações
        </button>
      </section>

      <div className="sf-wrap sf-notes">
        {recent[0] && (
          <Link className="ongoing" to={`/pedido/${recent[0].token}`}>
            <span className="ongoing__dot" aria-hidden />
            Acompanhe seu pedido #{recent[0].number}
            <ChevronRight size={16} />
          </Link>
        )}
        {!s.isOpen && (
          <p className="closed-note closed-note--big" role="status">
            <Moon size={20} aria-hidden />
            <span>
              <strong>Estamos fechados agora</strong>
              Você pode olhar o cardápio e montar a sacola, mas os pedidos só entram quando a loja
              abrir.
            </span>
          </p>
        )}
      </div>
      <div ref={sentinel} aria-hidden />

      <div className="searchbar" data-stuck={stuck || undefined}>
        <div className="sf-wrap searchbar__row">
          <label className="searchbox">
            <Search size={18} aria-hidden />
            <input
              type="search"
              placeholder="Buscar produto…"
              aria-label="Buscar no cardápio"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
      </div>

      <div className="sf-wrap sf-body">
        {term ? (
          <section className="sec" aria-live="polite">
            <h2 className="sec__title">
              {results.length
                ? `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}`
                : `Nada encontrado para “${search}”`}
            </h2>
            <ProductGrid list={results} />
          </section>
        ) : (
          <>
            <LoyaltyStrip />
            <ReserveCard />
            <Banners banners={menu.banners} onPick={pickBanner} />

            {wheel.length === 0 ? (
              <div className="empty-state">
                <Mascot size={64} />
                <strong>O cardápio está sendo preparado</strong>
                <p>Ainda não há pratos cadastrados. Volte em instantes!</p>
              </div>
            ) : (
              <>
                <CategoryWheel items={wheel} cur={current!.id} onPick={setCat} />
                <section className="sec sec--grid" key={current!.id} data-dir={slide.dir}>
                  <h2 className="sec__title sec__title--cat" aria-live="polite">
                    {current!.name}
                    <small>
                      {shown.length} {shown.length === 1 ? 'item' : 'itens'}
                    </small>
                  </h2>
                  {shown.length ? (
                    <ProductGrid list={shown} />
                  ) : (
                    <p className="sf-empty">Nenhum produto disponível nesta categoria agora.</p>
                  )}
                </section>
              </>
            )}
          </>
        )}

        <footer className="store-foot">
          {r.address && <p>{r.address}</p>}
          <p className="store-foot__brand">
            <Mascot size={20} badge /> Pedidos online por <strong>Comandou</strong>
          </p>
        </footer>
      </div>

      <StoreInfo open={sheet === 'info'} onClose={() => setSheet(null)} />
      <FilterSheet
        open={sheet === 'filter'}
        value={filters}
        count={term ? results.length : shown.length}
        onChange={changeFilters}
        onClose={() => setSheet(null)}
      />
    </>
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
          <span className="empty-state__icon">
            <Heart size={26} />
          </span>
          <strong>Nenhum favorito ainda</strong>
          <p>Toque no coração dos pratos que você mais gosta para achar rápido aqui.</p>
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
      <p className="cm-hint sf-note">Favoritos ficam salvos neste aparelho.</p>
    </div>
  );
}
