import { fromCents, multiplyCents, toCents } from '@comandou/shared';
import {
  Bike,
  ChevronRight,
  Clock,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Mascot } from '../../design-system';
import { SlideTabs } from '../../features/SlideTabs';
import { api, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { brl, parseBrlInput } from '../../lib/money';
import {
  CartLine,
  CustomerInfo,
  EMPTY_CUSTOMER,
  initials,
  lineTotal,
  maskPhone,
  newOrderToken,
  PAYMENT_OPTIONS,
  PublicMenu,
  PublicProduct,
  recentOrders,
  rememberOrder,
  useStored,
} from './store';
import './public.css';

/** Foto com proporção fixa, carregamento preguiçoso, fade-in e plano B com iniciais. */
export function Photo({
  src,
  alt,
  ratio = '1 / 1',
  className = '',
}: {
  src: string | null;
  alt: string;
  ratio?: string;
  className?: string;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error');
  useEffect(() => setState(src ? 'loading' : 'error'), [src]);
  return (
    <div className={`ph ${className}`} style={{ aspectRatio: ratio }} data-state={state}>
      {src && state !== 'error' && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
      {state === 'error' && (
        <span className="ph__fallback" aria-hidden>
          {initials(alt)}
        </span>
      )}
    </div>
  );
}

/** Painel que sobe de baixo no celular e aparece ao lado no computador. */
export function Sheet({
  open,
  onClose,
  label,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose(): void;
  label: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet" role="presentation">
      <button className="sheet__backdrop" aria-label="Fechar" onClick={onClose} tabIndex={-1} />
      <div
        className={`sheet__panel ${wide ? 'sheet__panel--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <button className="sheet__close" aria-label="Fechar" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </div>
  );
}

function Stepper({
  value,
  onChange,
  min = 1,
}: {
  value: number;
  onChange(n: number): void;
  min?: number;
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label="Diminuir"
        onClick={() => onChange(Math.max(min - 1, value - 1))}
        disabled={value <= min - 1}
      >
        {value <= 1 && min === 0 ? <Trash2 size={15} /> : <Minus size={15} />}
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label="Aumentar" onClick={() => onChange(Math.min(50, value + 1))}>
        <Plus size={15} />
      </button>
    </div>
  );
}

function ProductSheet({
  product,
  onClose,
  onAdd,
}: {
  product: PublicProduct | null;
  onClose(): void;
  onAdd(line: CartLine): void;
}) {
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  useEffect(() => {
    setSel({});
    setQty(1);
    setNotes('');
  }, [product?.id]);
  if (!product) return null;
  const p = product;
  const options = p.optionGroups.flatMap((g) => g.options);
  const ids = Object.values(sel).flat();
  const unit =
    toCents(p.price) +
    options.filter((o) => ids.includes(o.id)).reduce((s, o) => s + toCents(o.priceDelta), 0);
  const missing = p.optionGroups.filter((g) => (sel[g.id]?.length ?? 0) < g.minSelect);
  function toggle(gid: string, oid: string, single: boolean, max: number) {
    setSel((s) => {
      const cur = s[gid] ?? [];
      if (single) return { ...s, [gid]: [oid] };
      if (cur.includes(oid)) return { ...s, [gid]: cur.filter((x) => x !== oid) };
      if (cur.length >= max) return s;
      return { ...s, [gid]: [...cur, oid] };
    });
  }
  return (
    <Sheet
      open
      onClose={onClose}
      label={p.name}
      footer={
        <div className="add-bar">
          <Stepper value={qty} onChange={(n) => setQty(Math.max(1, n))} />
          <button
            className="cta"
            disabled={missing.length > 0 || p.soldOut}
            onClick={() =>
              onAdd({
                key: `${p.id}:${[...ids].sort().join(',')}:${notes.trim()}`,
                productId: p.id,
                name: p.name,
                imageUrl: p.imageUrl,
                unit: fromCents(unit),
                optionIds: ids,
                optionNames: options.filter((o) => ids.includes(o.id)).map((o) => o.name),
                quantity: qty,
                notes: notes.trim(),
              })
            }
          >
            {p.soldOut
              ? 'Esgotado'
              : missing.length
                ? `Escolha ${missing[0]!.name.toLowerCase()}`
                : `Adicionar · ${brl(fromCents(multiplyCents(unit, qty)))}`}
          </button>
        </div>
      }
    >
      <Photo src={p.imageUrl} alt={p.name} ratio="4 / 3" className="pdp__photo" />
      <div className="pdp__head">
        <h2>{p.name}</h2>
        <strong>{brl(p.price)}</strong>
      </div>
      {p.description && <p className="pdp__desc">{p.description}</p>}
      {p.optionGroups.map((g) => {
        const single = g.maxSelect === 1;
        const chosen = sel[g.id]?.length ?? 0;
        return (
          <fieldset key={g.id} className="opt-group">
            <legend>
              <span>{g.name}</span>
              <span
                className={`opt-group__tag ${g.minSelect > 0 && chosen < g.minSelect ? 'is-req' : ''}`}
              >
                {g.minSelect > 0
                  ? single
                    ? 'Escolha 1'
                    : `Escolha ${g.minSelect}${g.maxSelect > g.minSelect ? ` a ${g.maxSelect}` : ''}`
                  : `Opcional${g.maxSelect > 1 ? ` · até ${g.maxSelect}` : ''}`}
              </span>
            </legend>
            {g.options.map((o) => {
              const on = sel[g.id]?.includes(o.id) ?? false;
              return (
                <label key={o.id} className="opt" data-on={on || undefined}>
                  <input
                    type={single ? 'radio' : 'checkbox'}
                    name={g.id}
                    checked={on}
                    onChange={() => toggle(g.id, o.id, single, g.maxSelect)}
                  />
                  <span className="opt__mark" aria-hidden />
                  <span className="opt__name">{o.name}</span>
                  {toCents(o.priceDelta) > 0 && (
                    <span className="opt__price">+ {brl(o.priceDelta)}</span>
                  )}
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <label className="pdp__notes">
        <span>Alguma observação?</span>
        <textarea
          rows={2}
          maxLength={200}
          placeholder="Ex.: sem cebola, ponto da carne…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
    </Sheet>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`f ${wide ? 'f--wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function CartSheet({
  open,
  onClose,
  menu,
  cart,
  setCart,
  customer,
  setCustomer,
}: {
  open: boolean;
  onClose(): void;
  menu: PublicMenu;
  cart: CartLine[];
  setCart(fn: (c: CartLine[]) => CartLine[]): void;
  customer: CustomerInfo;
  setCustomer(fn: (c: CustomerInfo) => CustomerInfo): void;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  const [notes, setNotes] = useState('');
  const [changeFor, setChangeFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mesma chave e mesmo token em cada nova tentativa: reenviar não duplica o pedido.
  const attempt = useRef<{ key: string; token: string } | null>(null);
  useEffect(() => {
    if (open) {
      setStep('cart');
      setError(null);
    }
  }, [open]);

  const s = menu.store;
  const channels = [
    s.acceptsDelivery && ('delivery' as const),
    s.acceptsPickup && ('pickup' as const),
  ].filter(Boolean) as ('delivery' | 'pickup')[];
  const channel = channels.includes(customer.channel) ? customer.channel : channels[0];
  const subtotal = cart.reduce((sum, l) => sum + lineTotal(l), 0);
  const fee = channel === 'delivery' ? toCents(s.deliveryFee) : 0;
  const total = subtotal + fee;
  const belowMin = subtotal < toCents(s.minOrder);
  const set = <K extends keyof CustomerInfo>(k: K, v: CustomerInfo[K]) =>
    setCustomer((c) => ({ ...c, [k]: v }));

  const phoneOk = customer.customerPhone.replace(/\D/g, '').length >= 10;
  const addressOk =
    channel !== 'delivery' ||
    (customer.street.trim() && customer.number.trim() && customer.district.trim());
  const changeCents = toCents(parseBrlInput(changeFor) ?? '0');
  const changeOk = customer.paymentMethod !== 'cash' || !changeFor || changeCents >= total;
  const canSend =
    !!channel && !belowMin && customer.customerName.trim() && phoneOk && addressOk && changeOk;

  async function send() {
    if (!channel) return;
    attempt.current ??= { key: newIdempotencyKey(), token: newOrderToken() };
    const { key, token } = attempt.current;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ number: number; status: string }>('/store/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        json: {
          channel,
          token,
          customerName: customer.customerName.trim(),
          customerPhone: customer.customerPhone.trim(),
          address:
            channel === 'delivery'
              ? {
                  street: customer.street,
                  number: customer.number,
                  district: customer.district,
                  complement: customer.complement || undefined,
                  reference: customer.reference || undefined,
                }
              : undefined,
          notes: notes.trim() || undefined,
          paymentMethod: customer.paymentMethod,
          changeFor:
            customer.paymentMethod === 'cash' && changeCents > 0
              ? fromCents(changeCents)
              : undefined,
          items: cart.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            optionIds: l.optionIds,
            notes: l.notes || undefined,
          })),
        },
      });
      rememberOrder({ token, number: r.number, at: new Date().toISOString() });
      attempt.current = null;
      setCart(() => []);
      setNotes('');
      navigate(`/pedido/${token}`);
    } catch (e) {
      const err = e as ApiError;
      // Erro de regra (loja fechou, produto esgotou): o próximo envio é um pedido novo.
      if (err.status >= 400 && err.status < 500 && err.status !== 409 && err.status !== 429)
        attempt.current = null;
      setError(
        err.status === 0
          ? 'Sem conexão. Toque em enviar de novo: o pedido não será duplicado.'
          : err.status === 429
            ? 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
            : err.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={step === 'cart' ? 'Sacola' : 'Finalizar pedido'}
      wide
      footer={
        cart.length > 0 && (
          <div className="checkout-bar">
            <dl className="sum">
              <dt>Subtotal</dt>
              <dd>{brl(fromCents(subtotal))}</dd>
              {channel === 'delivery' && (
                <>
                  <dt>Entrega</dt>
                  <dd>{fee ? brl(s.deliveryFee) : 'Grátis'}</dd>
                </>
              )}
              <dt className="sum__total">Total</dt>
              <dd className="sum__total">{brl(fromCents(total))}</dd>
            </dl>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {belowMin && (
              <p className="form-hint">
                Pedido mínimo de {brl(s.minOrder)} (sem a entrega). Faltam{' '}
                {brl(fromCents(toCents(s.minOrder) - subtotal))}.
              </p>
            )}
            {step === 'cart' ? (
              <button className="cta" disabled={belowMin} onClick={() => setStep('checkout')}>
                Continuar <ChevronRight size={18} />
              </button>
            ) : (
              <button className="cta" disabled={!canSend || busy} onClick={send}>
                {busy ? 'Enviando…' : `Fazer pedido · ${brl(fromCents(total))}`}
              </button>
            )}
          </div>
        )
      }
    >
      {step === 'cart' ? (
        <>
          <h2 className="sheet__title">Sua sacola</h2>
          {cart.length === 0 ? (
            <div className="empty">
              <ShoppingBag size={28} />
              <p>Sua sacola está vazia.</p>
              <button className="link" onClick={onClose}>
                Ver o cardápio
              </button>
            </div>
          ) : (
            <ul className="bag">
              {cart.map((l) => (
                <li key={l.key} className="bag__line">
                  <Photo src={l.imageUrl} alt={l.name} className="bag__photo" />
                  <div className="bag__info">
                    <strong>{l.name}</strong>
                    {l.optionNames.length > 0 && <span>{l.optionNames.join(', ')}</span>}
                    {l.notes && <span>Obs.: {l.notes}</span>}
                    <b>{brl(fromCents(lineTotal(l)))}</b>
                  </div>
                  <Stepper
                    min={0}
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
        </>
      ) : (
        <div className="checkout">
          <button className="link back" onClick={() => setStep('cart')}>
            ← Voltar para a sacola
          </button>
          <h2 className="sheet__title">Como você quer receber?</h2>
          {channels.length > 1 && (
            <SlideTabs
              label="Entrega ou retirada"
              value={channel!}
              onChange={(v) => set('channel', v)}
              tabs={[
                { value: 'delivery', label: 'Entrega' },
                { value: 'pickup', label: 'Retirar na loja' },
              ]}
            />
          )}
          {channel === 'pickup' && menu.restaurant.address && (
            <p className="form-hint">Retirada em: {menu.restaurant.address}</p>
          )}
          <div className="grid2">
            <Field label="Seu nome">
              <input
                autoComplete="name"
                value={customer.customerName}
                maxLength={80}
                onChange={(e) => set('customerName', e.target.value)}
              />
            </Field>
            <Field label="WhatsApp">
              <input
                autoComplete="tel"
                inputMode="tel"
                placeholder="(11) 98888-7777"
                value={customer.customerPhone}
                onChange={(e) => set('customerPhone', maskPhone(e.target.value))}
              />
            </Field>
            {channel === 'delivery' && (
              <>
                <Field label="Rua" wide>
                  <input
                    autoComplete="address-line1"
                    value={customer.street}
                    maxLength={120}
                    onChange={(e) => set('street', e.target.value)}
                  />
                </Field>
                <Field label="Número">
                  <input
                    value={customer.number}
                    maxLength={20}
                    onChange={(e) => set('number', e.target.value)}
                  />
                </Field>
                <Field label="Bairro">
                  <input
                    value={customer.district}
                    maxLength={80}
                    onChange={(e) => set('district', e.target.value)}
                  />
                </Field>
                <Field label="Complemento (opcional)">
                  <input
                    value={customer.complement}
                    maxLength={80}
                    onChange={(e) => set('complement', e.target.value)}
                  />
                </Field>
                <Field label="Ponto de referência (opcional)">
                  <input
                    value={customer.reference}
                    maxLength={120}
                    onChange={(e) => set('reference', e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
          <h3 className="sub">Pagamento na {channel === 'delivery' ? 'entrega' : 'retirada'}</h3>
          <div className="pills" role="radiogroup" aria-label="Forma de pagamento">
            {PAYMENT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={customer.paymentMethod === o.value}
                className="pill"
                onClick={() => set('paymentMethod', o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {customer.paymentMethod === 'cash' && (
            <Field label="Troco para quanto? (opcional)">
              <input
                inputMode="decimal"
                placeholder="Ex.: 100,00"
                value={changeFor}
                onChange={(e) => setChangeFor(e.target.value)}
              />
              {!changeOk && <small className="form-error">Valor menor que o total do pedido</small>}
            </Field>
          )}
          <Field label="Observação do pedido (opcional)" wide>
            <textarea
              rows={2}
              maxLength={300}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <p className="form-hint">Seus dados ficam salvos neste aparelho para o próximo pedido.</p>
        </div>
      )}
    </Sheet>
  );
}

export function PublicStorePage() {
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useStored<CartLine[]>('cm-cart', []);
  const [customer, setCustomer] = useStored<CustomerInfo>('cm-customer', EMPTY_CUSTOMER);
  const [product, setProduct] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('');
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const jumping = useRef(false);
  const recent = useMemo(recentOrders, []);

  useEffect(() => {
    api<PublicMenu>('/store')
      .then((m) => {
        setMenu(m);
        setActiveCat(m.categories[0]?.id ?? '');
        document.title = `${m.restaurant.name} · Cardápio`;
        // Remove da sacola o que saiu do cardápio.
        const ids = new Set(m.categories.flatMap((c) => c.products.map((p) => p.id)));
        setCart((c) => c.filter((l) => ids.has(l.productId)));
      })
      .catch((e: ApiError) =>
        setError(
          e.status === 404
            ? 'Este restaurante não está recebendo pedidos online.'
            : 'Não foi possível carregar o cardápio. Tente de novo em instantes.',
        ),
      );
  }, [setCart]);

  // Categoria em destaque acompanha a rolagem.
  useEffect(() => {
    if (!menu || search) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (jumping.current) return;
        const vis = entries.filter((e) => e.isIntersecting);
        if (vis[0]) setActiveCat(vis[0].target.getAttribute('data-cat') ?? '');
      },
      { rootMargin: '-140px 0px -65% 0px' },
    );
    Object.values(sections.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [menu, search]);

  const filtered = useMemo(() => {
    if (!menu) return [];
    const s = search.trim().toLowerCase();
    if (!s) return menu.categories;
    return menu.categories
      .map((c) => ({
        ...c,
        products: c.products.filter(
          (p) =>
            p.name.toLowerCase().includes(s) || (p.description ?? '').toLowerCase().includes(s),
        ),
      }))
      .filter((c) => c.products.length);
  }, [menu, search]);

  if (error)
    return (
      <main className="store store--center">
        <Mascot size={72} mood="sleep" />
        <p>{error}</p>
      </main>
    );
  if (!menu)
    return (
      <main className="store">
        <div className="hero hero--skeleton" />
        <div className="wrap">
          <div className="sk sk--card" />
          <div className="sk-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="sk sk--product" />
            ))}
          </div>
        </div>
      </main>
    );

  const r = menu.restaurant;
  const s = menu.store;
  const count = cart.reduce((n, l) => n + l.quantity, 0);
  const subtotal = cart.reduce((n, l) => n + lineTotal(l), 0);

  function jump(id: string) {
    setActiveCat(id);
    jumping.current = true;
    sections.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => (jumping.current = false), 700);
  }

  return (
    <main className="store">
      <header className="hero">
        {r.coverUrl ? (
          <img src={r.coverUrl} alt="" className="hero__img" />
        ) : (
          <div className="hero__art" />
        )}
      </header>
      <div className="wrap">
        <section className="brandcard" aria-label="Restaurante">
          <Photo src={r.logoUrl} alt={r.name} className="brandcard__logo" />
          <div className="brandcard__info">
            <h1>{r.name}</h1>
            <div className="meta">
              <span className={`status ${s.isOpen ? 'is-open' : 'is-closed'}`}>
                {s.isOpen ? 'Aberto agora' : 'Fechado'}
              </span>
              <span>
                <Clock size={14} /> {s.etaMin}–{s.etaMax} min
              </span>
              {s.acceptsDelivery && (
                <span>
                  <Bike size={14} />{' '}
                  {toCents(s.deliveryFee) ? `Entrega ${brl(s.deliveryFee)}` : 'Entrega grátis'}
                </span>
              )}
              {toCents(s.minOrder) > 0 && <span>Mínimo {brl(s.minOrder)}</span>}
            </div>
            {r.about && <p className="brandcard__about">{r.about}</p>}
          </div>
        </section>

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

        <div className="catbar">
          <label className="searchbox">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder="Buscar no cardápio"
              aria-label="Buscar no cardápio"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {!search && menu.categories.length > 1 && (
            <SlideTabs
              label="Categorias"
              size="sm"
              className="catbar__tabs"
              value={activeCat}
              onChange={jump}
              tabs={menu.categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
        </div>

        {filtered.length === 0 && <p className="empty">Nada encontrado para “{search}”.</p>}
        {filtered.map((c) => (
          <section
            key={c.id}
            className="cat"
            data-cat={c.id}
            ref={(el) => {
              sections.current[c.id] = el;
            }}
          >
            <h2>{c.name}</h2>
            <div className="products">
              {c.products.map((p) => (
                <button
                  key={p.id}
                  className="product"
                  data-soldout={p.soldOut || undefined}
                  onClick={() => setProduct(p)}
                >
                  <Photo src={p.imageUrl} alt={p.name} className="product__photo" />
                  <span className="product__body">
                    <span className="product__name">{p.name}</span>
                    {p.description && <span className="product__desc">{p.description}</span>}
                    <span className="product__foot">
                      <span className="product__price">
                        {p.soldOut ? 'Esgotado' : brl(p.price)}
                      </span>
                      {!p.soldOut && (
                        <span className="product__add" aria-hidden>
                          <Plus size={16} />
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <footer className="store-foot">
          {r.address && <p>{r.address}</p>}
          <p className="store-foot__brand">
            <Mascot size={20} /> Pedidos online por <strong>Comandou</strong>
          </p>
        </footer>
      </div>

      {count > 0 && (
        <button className="bagbtn" onClick={() => setCartOpen(true)}>
          <span className="bagbtn__icon">
            <ShoppingBag size={18} />
            <span className="bagbtn__count">{count}</span>
          </span>
          Ver sacola
          <strong>{brl(fromCents(subtotal))}</strong>
        </button>
      )}

      <ProductSheet
        product={product}
        onClose={() => setProduct(null)}
        onAdd={(line) => {
          setCart((c) => {
            const same = c.find((x) => x.key === line.key);
            return same
              ? c.map((x) =>
                  x === same ? { ...x, quantity: Math.min(50, x.quantity + line.quantity) } : x,
                )
              : [...c, line];
          });
          setProduct(null);
        }}
      />
      <CartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        menu={menu}
        cart={cart}
        setCart={setCart}
        customer={customer}
        setCustomer={setCustomer}
      />
    </main>
  );
}
