import { fromCents, toCents } from '@comandou/shared';
import { Bike, ChevronRight, MapPin, Plus, ShoppingBag, Store, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { SlideTabs } from '../../features/SlideTabs';
import { api, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { brl, parseBrlInput } from '../../lib/money';
import { useStore } from './context';
import {
  addressLine,
  CustomerInfo,
  fmtPhone,
  lineTotal,
  maskPhone,
  newOrderToken,
  PAYMENT_OPTIONS,
  rememberOrder,
  SavedAddress,
} from './store';
import { Field, Photo, ScreenHeader, Stepper, Switch } from './ui';

/** Sacola e finalização: com a conta aberta, nome, telefone e endereços já vêm preenchidos. */
export function CartScreen() {
  const { menu, cart, setCart, customer, setCustomer, account, setAccount, subtotal } = useStore();
  const navigate = useNavigate();
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  const [notes, setNotes] = useState('');
  const [changeFor, setChangeFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = account?.customer ?? null;
  const saved = account?.addresses ?? [];
  const [addrId, setAddrId] = useState<string | 'new'>('new');
  const [saveAddr, setSaveAddr] = useState(true);
  // Mesma chave e mesmo token em cada nova tentativa: reenviar não duplica o pedido.
  const attempt = useRef<{ key: string; token: string } | null>(null);

  useEffect(() => {
    if (saved.length && addrId === 'new')
      setAddrId((saved.find((a) => a.isDefault) ?? saved[0]!).id);
    // Só quando a lista de endereços chega.
  }, [saved.length]);

  const s = menu.store;
  const channels = [
    s.acceptsDelivery && ('delivery' as const),
    s.acceptsPickup && ('pickup' as const),
  ].filter(Boolean) as ('delivery' | 'pickup')[];
  const channel = channels.includes(customer.channel) ? customer.channel : channels[0];
  const fee = channel === 'delivery' ? toCents(s.deliveryFee) : 0;
  const total = subtotal + fee;
  const belowMin = subtotal < toCents(s.minOrder);
  const set = <K extends keyof CustomerInfo>(k: K, v: CustomerInfo[K]) =>
    setCustomer((c) => ({ ...c, [k]: v }));

  const name = me?.name ?? customer.customerName;
  const phone = me ? fmtPhone(me.phone) : customer.customerPhone;
  const chosen: SavedAddress | undefined =
    addrId !== 'new' ? saved.find((a) => a.id === addrId) : undefined;
  const phoneOk = phone.replace(/\D/g, '').length >= 10;
  const typedOk = !!(customer.street.trim() && customer.number.trim() && customer.district.trim());
  const addressOk = channel !== 'delivery' || !!chosen || typedOk;
  const changeCents = toCents(parseBrlInput(changeFor) ?? '0');
  const changeOk = customer.paymentMethod !== 'cash' || !changeFor || changeCents >= total;
  const canSend =
    !!channel && !belowMin && name.trim() && phoneOk && addressOk && changeOk && s.isOpen;

  async function send() {
    if (!channel) return;
    attempt.current ??= { key: newIdempotencyKey(), token: newOrderToken() };
    const { key, token } = attempt.current;
    setBusy(true);
    setError(null);
    const typed = {
      street: customer.street.trim(),
      number: customer.number.trim(),
      district: customer.district.trim(),
      complement: customer.complement.trim() || undefined,
      reference: customer.reference.trim() || undefined,
    };
    const address =
      channel !== 'delivery'
        ? undefined
        : chosen
          ? {
              street: chosen.street,
              number: chosen.number,
              district: chosen.district,
              complement: chosen.complement || undefined,
              reference: chosen.reference || undefined,
            }
          : typed;
    try {
      // Endereço novo vai para a conta antes do pedido (se o cliente quiser).
      if (me && channel === 'delivery' && !chosen && saveAddr) {
        const a = await api<SavedAddress>('/store/account/addresses', {
          method: 'POST',
          json: typed,
        }).catch(() => null);
        if (a) {
          setAccount({ customer: me, addresses: [...saved, a] });
          setAddrId(a.id);
        }
      }
      const r = await api<{ number: number; status: string }>('/store/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        json: {
          channel,
          token,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          address,
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

  if (cart.length === 0)
    return (
      <div className="sf-wrap sf-page">
        <ScreenHeader title="Sacola" />
        <div className="empty-state">
          <span className="empty-state__icon">
            <ShoppingBag size={26} />
          </span>
          <strong>Sua sacola está vazia</strong>
          <p>Escolha algo gostoso no cardápio.</p>
          <Link className="cta cta--inline" to="/pedir">
            Ver o cardápio
          </Link>
        </div>
      </div>
    );

  return (
    <div className="sf-wrap sf-page sf-page--bar">
      {step === 'cart' ? (
        <>
          <ScreenHeader title="Sua sacola" />
          <ul className="bag">
            {cart.map((l, i) => (
              <li key={l.key} className="bag__line" style={{ ['--i' as string]: i }}>
                <Photo src={l.imageUrl} alt={l.name} className="bag__photo" />
                <div className="bag__info">
                  <strong>{l.name}</strong>
                  {l.optionNames.length > 0 && <span>{l.optionNames.join(', ')}</span>}
                  {l.notes && <span>Obs.: {l.notes}</span>}
                  <b>{brl(fromCents(lineTotal(l)))}</b>
                </div>
                <Stepper
                  min={0}
                  size="sm"
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
          <Link className="addmore" to="/pedir">
            <Plus size={16} /> Adicionar mais itens
          </Link>
        </>
      ) : (
        <div className="checkout">
          <header className="screen-head">
            <button
              type="button"
              className="iconbtn"
              aria-label="Voltar para a sacola"
              onClick={() => setStep('cart')}
            >
              <ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <h1>Finalizar pedido</h1>
            <div />
          </header>

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

          <section className="ck-card">
            <h2 className="ck-card__title">
              <UserRound size={16} /> Seus dados
            </h2>
            {me ? (
              <div className="ck-who">
                <strong>{me.name}</strong>
                <span>{fmtPhone(me.phone)}</span>
                <Link to="/pedir/conta/dados" className="link">
                  Editar
                </Link>
              </div>
            ) : (
              <>
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
                </div>
                {menu.appearance.accountsEnabled && (
                  <Link className="ck-login" to="/pedir/conta">
                    <span>
                      <strong>Tem conta?</strong> Entre para salvar endereços e ver seus pedidos.
                    </span>
                    <ChevronRight size={16} />
                  </Link>
                )}
              </>
            )}
          </section>

          {channel === 'delivery' ? (
            <section className="ck-card">
              <h2 className="ck-card__title">
                <Bike size={16} /> Endereço de entrega
              </h2>
              {saved.length > 0 && (
                <div className="addr-pick" role="radiogroup" aria-label="Endereço">
                  {saved.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={addrId === a.id}
                      className="addr-opt"
                      onClick={() => setAddrId(a.id)}
                    >
                      <MapPin size={16} />
                      <span>
                        <strong>{a.label || 'Endereço'}</strong>
                        <small>{addressLine(a)}</small>
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={addrId === 'new'}
                    className="addr-opt"
                    onClick={() => setAddrId('new')}
                  >
                    <Plus size={16} />
                    <span>
                      <strong>Outro endereço</strong>
                    </span>
                  </button>
                </div>
              )}
              {addrId === 'new' && (
                <div className="grid2 ck-fields">
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
                  {me && (
                    <label className="ck-toggle f--wide">
                      <span>Salvar na minha conta</span>
                      <Switch
                        label="Salvar na minha conta"
                        checked={saveAddr}
                        onChange={setSaveAddr}
                      />
                    </label>
                  )}
                </div>
              )}
            </section>
          ) : (
            menu.restaurant.address && (
              <section className="ck-card">
                <h2 className="ck-card__title">
                  <Store size={16} /> Retirada na loja
                </h2>
                <p className="form-hint">{menu.restaurant.address}</p>
              </section>
            )
          )}

          <section className="ck-card">
            <h2 className="ck-card__title">
              Pagamento na {channel === 'delivery' ? 'entrega' : 'retirada'}
            </h2>
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
                {!changeOk && (
                  <small className="form-error">Valor menor que o total do pedido</small>
                )}
              </Field>
            )}
          </section>

          <Field label="Observação do pedido (opcional)" wide>
            <textarea
              rows={2}
              maxLength={300}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {!me && (
            <p className="form-hint">
              Seus dados ficam salvos neste aparelho para o próximo pedido.
            </p>
          )}
        </div>
      )}

      <div className="checkout-bar">
        <div className="checkout-bar__inner">
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
          {!s.isOpen && <p className="form-hint">A loja está fechada agora.</p>}
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
      </div>
    </div>
  );
}
