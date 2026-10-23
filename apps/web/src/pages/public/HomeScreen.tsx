import { toCents } from '@comandou/shared';
import {
  Bike,
  ChevronRight,
  Clock,
  Heart,
  LayoutGrid,
  Plus,
  Search,
  Sparkles,
  Store,
  UserRound,
  X,
} from 'lucide-react';
import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Mascot } from '../../design-system';
import { brl } from '../../lib/money';
import { useStore } from './context';
import { setMorph } from './morph';
import { PublicBanner, PublicProduct, recentOrders } from './store';
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

/** Cartão alto (carrosséis de destaque e grade de favoritos). */
function ProductTile({ p, i = 0 }: { p: PublicProduct; i?: number }) {
  const { favs, toggleFav } = useStore();
  const open = useOpenProduct();
  const quick = useQuickAdd();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="tile"
      style={{ '--i': i } as CSSProperties}
      data-soldout={p.soldOut || undefined}
      role="button"
      tabIndex={0}
      onClick={() => open(p, ref.current)}
      onKeyDown={(e) => e.key === 'Enter' && open(p, ref.current)}
      aria-label={`${p.name}, ${brl(p.price)}`}
    >
      <Photo src={p.imageUrl} alt={p.name} ratio="1 / 1" className="tile__photo" />
      {p.badge && <span className="badge-chip tile__badge">{p.badge}</span>}
      <HeartButton
        className="tile__heart"
        on={favs.includes(p.id)}
        onToggle={() => toggleFav(p.id)}
      />
      <span className="tile__name">{p.name}</span>
      <span className="tile__foot">
        <span className="tile__price">{p.soldOut ? 'Esgotado' : brl(p.price)}</span>
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
  );
}

/** Linha da lista do cardápio: texto à esquerda, foto à direita. */
function ProductRow({ p, i = 0 }: { p: PublicProduct; i?: number }) {
  const open = useOpenProduct();
  const quick = useQuickAdd();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="prow"
      style={{ '--i': Math.min(i, 8) } as CSSProperties}
      data-soldout={p.soldOut || undefined}
      role="button"
      tabIndex={0}
      onClick={() => open(p, ref.current)}
      onKeyDown={(e) => e.key === 'Enter' && open(p, ref.current)}
    >
      <span className="prow__body">
        <span className="prow__name">
          {p.name}
          {p.badge && <span className="badge-chip badge-chip--inline">{p.badge}</span>}
        </span>
        {p.description && <span className="prow__desc">{p.description}</span>}
        <span className="prow__price">{p.soldOut ? 'Esgotado' : brl(p.price)}</span>
      </span>
      <span className="prow__media">
        <Photo src={p.imageUrl} alt={p.name} className="prow__photo" />
        {!p.soldOut && (
          <button
            type="button"
            className="addbtn prow__add"
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
  );
}

/** Banners com rolagem por toque, encaixe e troca automática a cada 5 s. */
function Banners({ banners, onPick }: { banners: PublicBanner[]; onPick(b: PublicBanner): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);
  const paused = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || banners.length < 2) return;
    const onScroll = () => setCur(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener('scroll', onScroll, { passive: true });
    const id = window.setInterval(() => {
      if (paused.current || document.visibilityState !== 'visible') return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % banners.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, 5000);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.clearInterval(id);
    };
  }, [banners.length]);
  if (!banners.length) return null;
  return (
    <section className="banners" aria-label="Promoções">
      <div
        className="banners__track"
        ref={ref}
        onPointerDown={() => (paused.current = true)}
        onPointerLeave={() => (paused.current = false)}
      >
        {banners.map((b, i) => (
          <button
            key={b.id}
            type="button"
            className="banner"
            data-img={b.imageUrl ? '' : undefined}
            style={{ '--i': i } as CSSProperties}
            onClick={() => onPick(b)}
            disabled={b.targetType === 'none'}
          >
            {b.imageUrl && <img src={b.imageUrl} alt="" className="banner__img" loading="lazy" />}
            <span className="banner__text">
              {b.tag && <span className="banner__tag">{b.tag}</span>}
              <strong>{b.title}</strong>
              {b.subtitle && <span className="banner__sub">{b.subtitle}</span>}
              {b.cta && b.targetType !== 'none' && <span className="banner__cta">{b.cta}</span>}
            </span>
          </button>
        ))}
      </div>
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

/** Destaca a última palavra do título com a cor da marca ("Bateu a *fome?*"). */
function Headline({ text }: { text: string }) {
  const words = text.trim().split(/\s+/);
  const last = words.pop();
  return (
    <h1 className="sf-hero__title">
      {words.join(' ')} <em>{last}</em>
    </h1>
  );
}

export function HomeScreen() {
  const { menu, account, product } = useStore();
  const open = useOpenProduct();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const recent = useMemo(recentOrders, []);
  const r = menu.restaurant;
  const s = menu.store;
  const first = account?.customer?.name.split(' ')[0];

  // A barra de busca gruda no topo e ganha sombra depois que a capa sai da tela.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const all = useMemo(() => menu.categories.flatMap((c) => c.products), [menu]);
  const featured = all.filter((p) => p.featured);
  const popular = menu.popular.map((id) => product(id)).filter(Boolean) as PublicProduct[];
  const term = search.trim().toLowerCase();
  const results = term
    ? all.filter(
        (p) =>
          p.name.toLowerCase().includes(term) || (p.description ?? '').toLowerCase().includes(term),
      )
    : [];
  const sections = cat === 'all' ? menu.categories : menu.categories.filter((c) => c.id === cat);

  function pickBanner(b: PublicBanner) {
    if (b.targetType === 'product') {
      const p = product(b.targetId!);
      if (p) open(p);
    } else if (b.targetType === 'category') {
      setCat(b.targetId!);
      document.querySelector('.catchips')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <>
      <header className="sf-hero">
        {r.coverUrl ? (
          <img src={r.coverUrl} alt="" className="sf-hero__img" />
        ) : (
          <div className="sf-hero__art" />
        )}
        <div className="sf-hero__inner sf-wrap">
          <div className="sf-hero__top">
            <Photo src={r.logoUrl} alt={r.name} className="sf-hero__logo" eager />
            <div className="sf-hero__name">
              <strong>{r.name}</strong>
              <span className={`status ${s.isOpen ? 'is-open' : 'is-closed'}`}>
                {s.isOpen ? 'Aberto agora' : 'Fechado'}
              </span>
            </div>
            {menu.appearance.accountsEnabled && (
              <Link className="sf-avatar" to="/pedir/conta" aria-label="Minha conta">
                {first ? first[0]!.toUpperCase() : <UserRound size={18} />}
              </Link>
            )}
          </div>
          <p className="sf-hero__hello">{first ? `Olá, ${first} 👋` : 'Bem-vindo! 👋'}</p>
          <Headline text={menu.appearance.headline || 'Bateu a fome? Peça agora!'} />
          <div className="sf-hero__meta">
            <span>
              <Clock size={14} /> {s.etaMin}–{s.etaMax} min
            </span>
            {s.acceptsDelivery && (
              <span>
                <Bike size={14} />{' '}
                {s.deliveryZones
                  ? 'Entrega conforme o bairro'
                  : toCents(s.deliveryFee)
                    ? `Entrega ${brl(s.deliveryFee)}`
                    : 'Entrega grátis'}
              </span>
            )}
            {s.acceptsPickup && (
              <span>
                <Store size={14} /> Retirada
              </span>
            )}
            {toCents(s.minOrder) > 0 && <span>Mínimo {brl(s.minOrder)}</span>}
          </div>
        </div>
      </header>
      <div ref={sentinel} aria-hidden />

      <div className="searchbar" data-stuck={stuck || undefined}>
        <div className="sf-wrap">
          <label className="searchbox">
            <Search size={18} aria-hidden />
            <input
              type="search"
              placeholder="Buscar no cardápio"
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
        </div>
      </div>

      <div className="sf-wrap sf-body">
        {recent[0] && (
          <Link className="ongoing" to={`/pedido/${recent[0].token}`}>
            <span className="ongoing__dot" aria-hidden />
            Acompanhe seu pedido #{recent[0].number}
            <ChevronRight size={16} />
          </Link>
        )}
        {!s.isOpen && (
          <p className="closed-note">
            A loja está fechada agora. Você pode ver o cardápio, mas os pedidos voltam quando ela
            abrir.
          </p>
        )}
        {r.about && !term && <p className="sf-about">{r.about}</p>}

        {term ? (
          <section className="sec" aria-live="polite">
            <h2 className="sec__title">
              {results.length
                ? `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}`
                : `Nada encontrado para “${search}”`}
            </h2>
            <div className="plist">
              {results.map((p, i) => (
                <ProductRow key={p.id} p={p} i={i} />
              ))}
            </div>
          </section>
        ) : (
          <>
            <Banners banners={menu.banners} onPick={pickBanner} />

            {menu.categories.length > 1 && (
              <div className="catchips" role="tablist" aria-label="Categorias">
                <button
                  type="button"
                  role="tab"
                  aria-selected={cat === 'all'}
                  className="catchip"
                  onClick={() => setCat('all')}
                >
                  <span className="catchip__img catchip__img--all">
                    <LayoutGrid size={22} />
                  </span>
                  <span>Tudo</span>
                </button>
                {menu.categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={cat === c.id}
                    className="catchip"
                    onClick={() => setCat(c.id)}
                  >
                    <Photo
                      src={c.imageUrl ?? c.products.find((p) => p.imageUrl)?.imageUrl ?? null}
                      alt={c.name}
                      className="catchip__img"
                    />
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            )}

            {cat === 'all' && featured.length > 0 && (
              <section className="sec">
                <h2 className="sec__title">
                  <Sparkles size={18} aria-hidden /> {menu.appearance.featuredTitle || 'Destaques'}
                </h2>
                <div className="hscroll">
                  {featured.map((p, i) => (
                    <ProductTile key={p.id} p={p} i={i} />
                  ))}
                </div>
              </section>
            )}
            {cat === 'all' && popular.length > 2 && (
              <section className="sec">
                <h2 className="sec__title">Mais pedidos</h2>
                <div className="hscroll">
                  {popular.map((p, i) => (
                    <ProductTile key={p.id} p={p} i={i} />
                  ))}
                </div>
              </section>
            )}

            <div className="cats" key={cat}>
              {sections.map((c) => (
                <section key={c.id} className="sec">
                  <h2 className="sec__title">{c.name}</h2>
                  <div className="plist">
                    {c.products.map((p, i) => (
                      <ProductRow key={p.id} p={p} i={i} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        <footer className="store-foot">
          {r.address && <p>{r.address}</p>}
          <p className="store-foot__brand">
            <Mascot size={20} badge /> Pedidos online por <strong>Comandou</strong>
          </p>
        </footer>
      </div>
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
        <div className="tgrid">
          {list.map((p, i) => (
            <ProductTile key={p.id} p={p} i={i} />
          ))}
        </div>
      )}
      <p className="cm-hint sf-note">Favoritos ficam salvos neste aparelho.</p>
    </div>
  );
}
