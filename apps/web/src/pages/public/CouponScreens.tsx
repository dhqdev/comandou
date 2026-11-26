import { couponHeadline, fromCents, normalizeCouponCode, toCents } from '@comandou/shared';
import { Check, Copy, LockKeyhole, TicketPercent, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Skeleton, useToast } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import { useStore } from './context';
import type { CouponCheck, PublicCoupon } from './store';
import { Photo, ScreenHeader } from './ui';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/** Regras do cupom numa linha: mínimo, validade, primeiro pedido e quantas vezes vale. */
export function couponRules(c: PublicCoupon) {
  const out: string[] = [];
  if (toCents(c.minOrder) > 0) out.push(`Pedido mínimo ${brl(c.minOrder)}`);
  if (c.kind === 'percent' && c.maxDiscount) out.push(`Até ${brl(c.maxDiscount)} de desconto`);
  if (c.kind === 'free_delivery') out.push('Só na entrega');
  if (c.firstOrderOnly) out.push('Só no primeiro pedido');
  if (c.perCustomer > 1) out.push(`Vale ${c.perCustomer} vezes`);
  if (c.endsAt) out.push(`Até ${day(c.endsAt)}`);
  return out.join(' · ');
}

/** Cartão do cupom (cara de ticket): o que dá, as regras e o código com Copiar e Usar. */
function CouponCard({
  c,
  chosen,
  canUse,
  onUse,
}: {
  c: PublicCoupon;
  chosen: boolean;
  canUse: boolean;
  onUse(c: PublicCoupon): void;
}) {
  const toast = useToast();
  const used = c.blocked && c.usedByMe > 0;
  async function copy() {
    try {
      await navigator.clipboard.writeText(c.code);
      toast(`Código ${c.code} copiado`, 'success');
    } catch {
      toast(`Código: ${c.code}`);
    }
  }
  return (
    <li className="cpn" data-blocked={c.blocked ? '' : undefined} data-on={chosen || undefined}>
      <div className="cpn__body">
        {c.imageUrl && <Photo src={c.imageUrl} alt="" className="cpn__photo" />}
        <span className="cpn__text">
          <strong className="cpn__head">{couponHeadline(c)}</strong>
          {c.title.trim().toLowerCase() !== couponHeadline(c).toLowerCase() && (
            <span className="cpn__title">{c.title}</span>
          )}
          {c.description && <span className="cpn__desc">{c.description}</span>}
          {couponRules(c) && <small className="cpn__rules">{couponRules(c)}</small>}
        </span>
      </div>
      <div className="cpn__foot">
        <button
          type="button"
          className="cpn__code cm-selectable"
          onClick={copy}
          aria-label={`Copiar o código ${c.code}`}
        >
          {c.code} <Copy size={14} aria-hidden />
        </button>
        {c.blocked ? (
          <span className="cpn__why">{used ? 'Você já usou' : c.blocked}</span>
        ) : chosen ? (
          <span className="cpn__chosen">
            <Check size={15} aria-hidden /> No próximo pedido
          </span>
        ) : (
          <button
            type="button"
            className="cpn__use"
            onClick={() => onUse(c)}
            disabled={!canUse}
            title={canUse ? undefined : 'Entre na sua conta para usar'}
          >
            Usar no pedido
          </button>
        )}
      </div>
    </li>
  );
}

/** Aba Cupons: a vitrine da loja, o código digitado e o cupom escolhido para o próximo pedido. */
export function CouponsScreen() {
  const { account, coupon, setCoupon, cart, subtotal } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const me = account?.customer ?? null;
  const [list, setList] = useState<PublicCoupon[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [found, setFound] = useState<PublicCoupon | null>(null);
  // A vitrine depende de quem está vendo (limite por cliente e primeiro pedido).
  useEffect(() => {
    let off = false;
    setFailed(false);
    api<PublicCoupon[]>('/store/coupons')
      .then((l) => !off && setList(l))
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
    };
  }, [me?.id]);

  function choose(c: PublicCoupon) {
    setCoupon(c.code);
    toast(`Cupom ${c.code} vai no seu próximo pedido`, 'success');
    if (cart.length) navigate('/pedir/sacola', { state: { checkout: true } });
  }

  async function check(e: FormEvent) {
    e.preventDefault();
    const typed = normalizeCouponCode(code);
    if (typed.length < 3) return setCheckError('Digite o código do cupom');
    setChecking(true);
    setCheckError(null);
    setFound(null);
    try {
      const r = await api<CouponCheck>('/store/coupons/check', {
        method: 'POST',
        json: { code: typed, ...(subtotal > 0 ? { subtotal: fromCents(subtotal) } : {}) },
      });
      setFound(r.coupon);
      if (r.coupon.blocked) setCheckError(r.coupon.blocked);
    } catch (err) {
      setCheckError((err as ApiError).message || 'Não deu para conferir agora');
    } finally {
      setChecking(false);
    }
  }

  const shown = list ?? [];
  const extra = found && !shown.some((c) => c.id === found.id) ? [found] : [];
  return (
    <div className="sf-wrap sf-page cpns">
      <ScreenHeader title="Cupons" back="/pedir" />

      <form className="cpns__form" onSubmit={check}>
        <label className="cpns__field">
          <TicketPercent size={18} aria-hidden />
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setCheckError(null);
            }}
            placeholder="Tem um código? Digite aqui"
            aria-label="Código do cupom"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={24}
            enterKeyHint="go"
          />
        </label>
        <button type="submit" className="cpns__apply" disabled={checking || !code.trim()}>
          {checking ? 'Conferindo…' : 'Conferir'}
        </button>
      </form>
      {checkError && (
        <p className="form-error" role="alert">
          {checkError}
        </p>
      )}

      {coupon && (
        <div className="cpns__chosen" role="status">
          <Check size={16} aria-hidden />
          <span>
            Cupom <strong>{coupon}</strong> vai no seu próximo pedido
          </span>
          <button type="button" className="link" onClick={() => setCoupon(null)}>
            Tirar
          </button>
        </div>
      )}

      {!me && (
        <Link className="cpns__login" to="/pedir/conta">
          <LockKeyhole size={18} aria-hidden />
          <span>
            <strong>Entre na sua conta para usar os cupons</strong>
            <small>Cada cupom vale para a sua conta, no pedido pelo app.</small>
          </span>
        </Link>
      )}

      {list === null && !failed ? (
        <Skeleton variant="cards" />
      ) : failed ? (
        <p className="form-hint">
          Não deu para carregar os cupons agora. Tente de novo em instantes.
        </p>
      ) : shown.length + extra.length === 0 ? (
        <div className="empty-state">
          <TicketPercent size={40} className="cpns__empty-ic" aria-hidden />
          <strong>Nenhum cupom por enquanto</strong>
          <p>Quando a loja lançar uma promoção, ela aparece aqui.</p>
        </div>
      ) : (
        <ul className="cpns__list">
          {[...extra, ...shown].map((c) => (
            <CouponCard key={c.id} c={c} chosen={coupon === c.code} canUse={!!me} onUse={choose} />
          ))}
        </ul>
      )}
      <p className="form-hint cpns__note">
        Um cupom por pedido. Ele não se junta com a troca de pontos. Na loja, mostre o PIN da tela
        de pontos para usar o cupom no balcão.
      </p>
    </div>
  );
}

/** Cupom aplicado (ou sendo conferido) na sacola. */
export type CouponQuote =
  | { kind: 'idle' }
  | { kind: 'checking'; prev: CouponOk | null }
  | CouponOk
  | { kind: 'error'; message: string };
export interface CouponOk {
  kind: 'ok';
  coupon: PublicCoupon;
  discountCents: number;
  freeDelivery: boolean;
}

/** O desconto que vale para o total agora (o último conferido enquanto confere de novo). */
export const couponApplied = (q: CouponQuote): CouponOk | null =>
  q.kind === 'ok' ? q : q.kind === 'checking' ? q.prev : null;

/**
 * Confere o cupom escolhido com a loja a cada mudança da sacola (mínimo, entrega, retirada) e
 * devolve quanto sai. Fica na sacola inteira (não só na finalização): o total bate nos dois passos.
 */
export function useCouponQuote(
  channel: 'delivery' | 'pickup' | 'table' | null | undefined,
  subtotal: number,
  deliveryFee: number,
): CouponQuote {
  const { coupon, account, rules } = useStore();
  const me = account?.customer ?? null;
  const [state, setState] = useState<CouponQuote>({ kind: 'idle' });
  useEffect(() => {
    if (!coupon || !me || !rules.coupons || !channel || channel === 'table' || subtotal <= 0) {
      setState({ kind: 'idle' });
      return;
    }
    let off = false;
    setState((s) => ({ kind: 'checking', prev: couponApplied(s) }));
    const id = window.setTimeout(() => {
      api<CouponCheck>('/store/coupons/check', {
        method: 'POST',
        json: {
          code: coupon,
          subtotal: fromCents(subtotal),
          deliveryFee: fromCents(deliveryFee),
          channel,
        },
      })
        .then((r) => {
          if (off) return;
          const free = r.coupon.kind === 'free_delivery';
          if (r.coupon.blocked || r.discount === null)
            setState({ kind: 'error', message: r.coupon.blocked ?? 'Este cupom não vale agora' });
          else if (free && deliveryFee <= 0)
            setState({ kind: 'error', message: 'A entrega deste pedido já é grátis' });
          else
            setState({
              kind: 'ok',
              coupon: r.coupon,
              discountCents: toCents(r.discount),
              freeDelivery: free,
            });
        })
        .catch((e: ApiError) => {
          if (off) return;
          setState({ kind: 'error', message: e.message || 'Não deu para conferir o cupom' });
        });
    }, 350);
    return () => {
      off = true;
      window.clearTimeout(id);
    };
  }, [coupon, me?.id, subtotal, deliveryFee, channel, rules.coupons]);
  return state;
}

/** Cupom na finalização: o escolhido na aba Cupons já vem aplicado; dá para digitar outro ou tirar. */
export function CouponCheckout({ quote }: { quote: CouponQuote }) {
  const { coupon, setCoupon, account, rules } = useStore();
  const me = account?.customer ?? null;
  const [typed, setTyped] = useState('');
  if (!rules.coupons) return null;
  const ok = quote.kind === 'ok' ? quote : null;
  return (
    <section className="ck-card ck-coupon">
      <h2 className="ck-card__title">
        <TicketPercent size={16} /> Cupom
      </h2>
      {!me ? (
        <p className="form-hint">
          <Link to="/pedir/conta" state={{ back: 'checkout' }}>
            Entre na sua conta
          </Link>{' '}
          para usar um cupom.
        </p>
      ) : coupon ? (
        <div className="ck-coupon__chip" data-state={quote.kind} aria-live="polite">
          <TicketPercent size={18} className="ck-coupon__ic" aria-hidden />
          <span className="ck-coupon__text">
            <strong className="ck-coupon__code">{coupon}</strong>
            <small className="ck-coupon__what">
              {quote.kind === 'checking' || quote.kind === 'idle'
                ? 'Conferindo…'
                : ok
                  ? ok.freeDelivery
                    ? `Entrega grátis neste pedido`
                    : `${ok.coupon.title} · −${brl(fromCents(ok.discountCents))}`
                  : quote.kind === 'error'
                    ? quote.message
                    : ''}
            </small>
          </span>
          <button
            type="button"
            className="ck-coupon__x"
            aria-label="Tirar o cupom"
            onClick={() => setCoupon(null)}
          >
            <X size={18} />
          </button>
        </div>
      ) : (
        <form
          className="ck-coupon__form"
          onSubmit={(e) => {
            e.preventDefault();
            const c = normalizeCouponCode(typed);
            if (c.length >= 3) setCoupon(c);
            setTyped('');
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value.toUpperCase())}
            placeholder="Código do cupom"
            aria-label="Código do cupom"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={24}
            enterKeyHint="done"
          />
          <button type="submit" className="ck-coupon__apply" disabled={typed.trim().length < 3}>
            Aplicar
          </button>
        </form>
      )}
      {me && !coupon && (
        <Link to="/pedir/cupons" className="link ck-coupon__see">
          Ver os cupons da loja
        </Link>
      )}
    </section>
  );
}
