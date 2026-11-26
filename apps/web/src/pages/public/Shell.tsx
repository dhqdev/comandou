import { fromCents, toCents } from '@comandou/shared';
import { ChevronRight, Clock, HandPlatter, ShoppingBag } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { SlideTabs } from '../../features/SlideTabs';
import { brl } from '../../lib/money';
import { MotoboyArt, WaiterArt } from './art';
import { useStore } from './context';
import type { MagicTab } from './MagicNav';
import { buildSections, requestJump, sectionPhoto, useActiveSection } from './sections';
import { lineTotal, type StoreChannel } from './store';
import { Photo, Stepper } from './ui';

/**
 * Situação da loja numa linha: bolinha verde/vermelha e o texto. Com `withTable`, a mesa do QR
 * Code vem junto (barra do tablet e menu do notebook, que ficam à vista em todas as telas).
 */
export function StoreStatusLine({
  className = '',
  withTable = false,
}: {
  className?: string;
  withTable?: boolean;
}) {
  const { menu, table } = useStore();
  const open = menu.store.isOpen;
  return (
    <span className={`status ${open ? 'is-open' : 'is-closed'} ${className}`}>
      {open ? 'Aberto agora' : 'Fechado agora'}
      {withTable && table && <span className="status__table">· Mesa {table.label}</span>}
    </span>
  );
}

/** Texto da entrega: taxa fixa, grátis ou conforme o bairro. */
export function deliveryFeeText(s: { deliveryZones?: boolean; deliveryFee: string }) {
  if (s.deliveryZones) return 'Taxa por bairro';
  return toCents(s.deliveryFee) ? `Entrega ${brl(s.deliveryFee)}` : 'Entrega grátis';
}

/**
 * Entrega ou retirada escolhida, entre as que a loja aceita. Na mesa (QR Code) o pedido é sempre
 * para a mesa: sem escolha de entrega ou retirada.
 */
export function useChannel(): {
  channels: ('delivery' | 'pickup')[];
  channel: StoreChannel | undefined;
  setChannel(v: 'delivery' | 'pickup'): void;
} {
  const { menu, customer, setCustomer, table } = useStore();
  const s = menu.store;
  const channels = [
    s.acceptsDelivery && ('delivery' as const),
    s.acceptsPickup && ('pickup' as const),
  ].filter(Boolean) as ('delivery' | 'pickup')[];
  const setChannel = (v: 'delivery' | 'pickup') => setCustomer((c) => ({ ...c, channel: v }));
  if (table) return { channels: [], channel: 'table', setChannel };
  const channel = channels.includes(customer.channel) ? customer.channel : channels[0];
  return { channels, channel, setChannel };
}

/** Pedido mínimo da loja: vale na entrega e na retirada, não na mesa. */
export const minOrderOf = (s: { minOrder: string }, channel: StoreChannel | undefined) =>
  channel === 'table' ? 0 : toCents(s.minOrder);

/**
 * Menu lateral do notebook (e do tablet deitado): loja, abas, categorias e a sacola. Tocar numa
 * categoria rola o cardápio até ela; rolar o cardápio marca a categoria que está na tela.
 */
export function SideBar({ tabs, dot }: { tabs: MagicTab[]; dot(n: number): ReactNode }) {
  const { menu, count, subtotal, bump, table } = useStore();
  const sections = useMemo(() => buildSections(menu), [menu]);
  const active = useActiveSection();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onHome = /^\/pedir\/?$/.test(pathname);
  const list = useRef<HTMLDivElement>(null);
  const r = menu.restaurant;
  const s = menu.store;

  // A categoria marcada fica sempre à vista na lista (sem mexer na rolagem da página).
  useEffect(() => {
    const box = list.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 8 || top + el.offsetHeight > box.scrollTop + box.clientHeight - 8)
      box.scrollTo({ top: top - box.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
  }, [active, onHome]);

  return (
    <aside className="sf-side">
      <Link to="/pedir" className="sf-side__brand">
        <Photo src={r.logoUrl} alt={r.name} className="sf-side__logo" eager />
        <span>
          <strong>{r.name}</strong>
          <StoreStatusLine withTable />
        </span>
      </Link>

      <nav className="sf-side__nav" aria-label="Menu do cardápio">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="sf-side__link">
            <t.icon size={18} aria-hidden />
            <span>{t.label}</span>
            {dot(t.badge)}
          </NavLink>
        ))}
      </nav>

      {sections.length > 0 && (
        <div className="sf-side__cats" ref={list}>
          <span className="sf-side__title">Categorias</span>
          {sections.map((c) => (
            <button
              key={c.id}
              type="button"
              className="sf-side__cat"
              aria-current={onHome && active === c.id}
              onClick={() => {
                requestJump(c.id);
                if (!onHome) navigate('/pedir');
              }}
            >
              <Photo src={sectionPhoto(c)} alt={c.name} className="sf-side__thumb" />
              <span className="sf-side__name">{c.name}</span>
              <small>{c.products.length}</small>
            </button>
          ))}
        </div>
      )}

      <div className="sf-side__foot">
        <Link
          to="/pedir/sacola"
          className="sf-side__cart"
          data-empty={count === 0 || undefined}
          aria-label={count ? `Sacola: ${count} itens, ${brl(fromCents(subtotal))}` : 'Sacola'}
        >
          {/* Chaves diferentes entre irmãos (com a mesma, a sacola se repetia na tela). */}
          <span
            className="sf-side__bag"
            data-cart-target
            key={`bag-${bump}`}
            data-bump={bump > 0 || undefined}
          >
            <ShoppingBag size={18} />
            {count > 0 && <span className="cartpill__count">{count}</span>}
          </span>
          <span>{count ? 'Ver sacola' : 'Sacola vazia'}</span>
          {count > 0 && (
            <strong key={`sum-${bump}`} className={bump > 0 ? 'sf-tick' : undefined}>
              {brl(fromCents(subtotal))}
            </strong>
          )}
        </Link>
        {table ? (
          <div className="sf-side__ride sf-side__ride--table">
            <HandPlatter size={20} aria-hidden />
            <span>
              <strong>Mesa {table.label}</strong>
              <small>O pedido vai direto para a sua mesa</small>
            </span>
          </div>
        ) : (
          // No início o bloco da moto já está no meio do cardápio.
          s.acceptsDelivery &&
          !onHome && (
            <div className="sf-side__ride">
              <MotoboyArt ride={s.isOpen} className="sf-side__art" />
              <span>
                <strong>
                  <Clock size={13} aria-hidden /> {s.etaMin}–{s.etaMax} min
                </strong>
                <small>{deliveryFeeText(s)}</small>
              </span>
            </div>
          )
        )}
      </div>
    </aside>
  );
}

/**
 * Sacola ao lado do cardápio (notebook largo), como no totem: itens com quantidade, entrega ou
 * retirada, total e o botão que já abre a finalização.
 */
export function CartPanel() {
  const { cart, setCart, subtotal, count, menu, product, bump, table } = useStore();
  const { channels, channel, setChannel } = useChannel();
  const navigate = useNavigate();
  const s = menu.store;
  const fee = channel === 'delivery' && !s.deliveryZones ? toCents(s.deliveryFee) : 0;
  const minOrder = minOrderOf(s, channel);
  const belowMin = count > 0 && subtotal < minOrder;
  const soldOut = cart.some((l) => product(l.productId)?.soldOut);

  return (
    <aside className="sf-cart" aria-label="Seu pedido">
      <header className="sf-cart__head">
        <span
          className="sf-cart__icon"
          data-cart-target
          key={bump}
          data-bump={bump > 0 || undefined}
        >
          <ShoppingBag size={18} />
        </span>
        <h2>Seu pedido</h2>
        {count > 0 && (
          <small>
            {count} {count === 1 ? 'item' : 'itens'}
          </small>
        )}
      </header>
      {channels.length > 1 && (
        <SlideTabs
          label="Entrega ou retirada"
          size="sm"
          value={channel!}
          onChange={setChannel}
          tabs={[
            { value: 'delivery', label: 'Entrega' },
            { value: 'pickup', label: 'Retirada' },
          ]}
        />
      )}

      {cart.length === 0 ? (
        <div className="sf-cart__empty">
          {table ? (
            <WaiterArt live className="sf-cart__art" />
          ) : (
            <MotoboyArt ride={s.isOpen} className="sf-cart__art" />
          )}
          <strong>Sua sacola está vazia</strong>
          <p>Toque no + dos produtos para montar o seu pedido.</p>
        </div>
      ) : (
        <ul className="sf-cart__lines">
          {cart.map((l) => (
            <li key={l.key} className="sf-cart__line">
              <Photo src={l.imageUrl} alt={l.name} className="sf-cart__photo" />
              <span className="sf-cart__info">
                <strong>{l.name}</strong>
                {l.optionNames.length > 0 && <small>{l.optionNames.join(', ')}</small>}
                {product(l.productId)?.soldOut && (
                  <small className="sf-cart__soldout">Esgotado agora</small>
                )}
                <b>{brl(fromCents(lineTotal(l)))}</b>
              </span>
              <Stepper
                min={0}
                size="sm"
                grams={l.weight}
                value={l.quantity}
                onChange={(n) =>
                  setCart((c) =>
                    n <= 0
                      ? c.filter((x) => x.key !== l.key)
                      : c.map((x) => (x.key === l.key ? { ...x, quantity: n } : x)),
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}

      <footer className="sf-cart__foot">
        {count > 0 ? (
          <dl className="sum">
            <dt>Subtotal</dt>
            <dd>{brl(fromCents(subtotal))}</dd>
            {channel === 'delivery' && (
              <>
                <dt>Entrega</dt>
                <dd>{s.deliveryZones ? 'a calcular' : fee ? brl(fromCents(fee)) : 'Grátis'}</dd>
              </>
            )}
            <dt className="sum__total">Total</dt>
            <dd className="sum__total">{brl(fromCents(subtotal + fee))}</dd>
          </dl>
        ) : (
          <p className="form-hint sf-cart__hint">
            {table
              ? `Pedido para a Mesa ${table.label}: você paga no fim`
              : channel === 'delivery'
                ? deliveryFeeText(s)
                : 'Retirada no balcão da loja'}
            {minOrder > 0 && ` · Pedido mínimo ${brl(s.minOrder)}`}
          </p>
        )}
        {belowMin && (
          <p className="form-hint">
            Pedido mínimo de {brl(s.minOrder)}. Faltam {brl(fromCents(minOrder - subtotal))}.
          </p>
        )}
        <button
          type="button"
          className="cta"
          disabled={!count || belowMin || !s.isOpen || soldOut}
          onClick={() => navigate('/pedir/sacola', { state: { checkout: true } })}
        >
          {s.isOpen ? (
            <>
              Finalizar pedido <ChevronRight size={18} aria-hidden />
            </>
          ) : (
            'Loja fechada'
          )}
        </button>
      </footer>
    </aside>
  );
}

/** Barra do pedido no tablet (como no totem): itens, total e "Ver sacola", presa embaixo. */
export function OrderBar() {
  const { count, subtotal, bump } = useStore();
  const { pathname } = useLocation();
  const hidden = count === 0 || !/^\/pedir(\/favoritos)?\/?$/.test(pathname);
  return (
    <div className="sf-orderbar" data-hidden={hidden || undefined} aria-hidden={hidden}>
      <div className="sf-orderbar__inner">
        <span className="sf-orderbar__bag" key={bump} data-bump={bump > 0 || undefined}>
          <ShoppingBag size={20} />
          <span className="cartpill__count">{count}</span>
        </span>
        <span className="sf-orderbar__sum">
          <small>
            Seu pedido · {count} {count === 1 ? 'item' : 'itens'}
          </small>
          <strong key={bump} className={bump > 0 ? 'sf-tick' : undefined}>
            {brl(fromCents(subtotal))}
          </strong>
        </span>
        <Link className="cta sf-orderbar__cta" to="/pedir/sacola" tabIndex={hidden ? -1 : 0}>
          Ver sacola <ChevronRight size={18} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
