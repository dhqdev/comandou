import {
  couponDiscount,
  couponHeadline,
  levelOf,
  toCents,
  type OrderChannel,
} from '@comandou/shared';
import { Check, Gift, KeyRound, TicketPercent } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Button, Skeleton } from '../design-system';
import { api, ApiError } from '../lib/api';
import { brl } from '../lib/money';
import type { PinCoupon, PinReward, PinView } from './CustomerPin';
import type { OrderCustomer } from './CustomerPicker';
import './sale-perks.css';

/** Recompensa ou cupom escolhido para a venda (um por pedido, como no cardápio). */
export type SalePerk =
  | { kind: 'reward'; reward: PinReward }
  | { kind: 'coupon'; coupon: PinCoupon };

/** O que a Nova venda precisa saber do pedido para calcular o desconto. */
export interface PerkCart {
  channel: OrderChannel;
  subtotalCents: number;
  feeCents: number;
  /** Preço de uma unidade de cada produto que está no carrinho (sem adicionais). */
  unitByProduct: Map<string, number>;
}

/** Desconto da escolha neste carrinho e o que impede de usar (ou null). */
export function perkQuote(
  perk: SalePerk | null,
  cart: PerkCart,
): { discountCents: number; freeDelivery: boolean; problem: string | null } {
  if (!perk) return { discountCents: 0, freeDelivery: false, problem: null };
  if (perk.kind === 'reward') {
    const r = perk.reward;
    if (r.kind === 'product') {
      const unit = r.productId ? cart.unitByProduct.get(r.productId) : undefined;
      if (unit === undefined)
        return {
          discountCents: 0,
          freeDelivery: false,
          problem: `Coloque ${r.productName ?? 'o produto'} no pedido para usar a recompensa.`,
        };
      return {
        discountCents: Math.min(unit, cart.subtotalCents),
        freeDelivery: false,
        problem: null,
      };
    }
    return {
      discountCents: Math.min(toCents(r.amount ?? '0'), cart.subtotalCents),
      freeDelivery: false,
      problem: null,
    };
  }
  const c = perk.coupon;
  if (cart.subtotalCents < toCents(c.minOrder))
    return {
      discountCents: 0,
      freeDelivery: false,
      problem: `O cupom ${c.code} vale em pedidos a partir de ${brl(c.minOrder)}.`,
    };
  if (c.kind === 'free_delivery') {
    if (cart.channel !== 'delivery')
      return {
        discountCents: 0,
        freeDelivery: false,
        problem: `O cupom ${c.code} vale só na entrega.`,
      };
    if (cart.feeCents <= 0)
      return {
        discountCents: 0,
        freeDelivery: false,
        problem: `Informe a taxa de entrega para usar o cupom ${c.code}.`,
      };
    return { discountCents: cart.feeCents, freeDelivery: true, problem: null };
  }
  return {
    discountCents: couponDiscount(c, cart.subtotalCents, cart.feeCents),
    freeDelivery: false,
    problem: null,
  };
}

const int = (n: number) => n.toLocaleString('pt-BR');
const unitOf = (mode: PinView['mode'], n = 2) =>
  mode === 'stamps' ? (n === 1 ? 'carimbo' : 'carimbos') : n === 1 ? 'ponto' : 'pontos';

type Loaded = PinView & { pin: string };

/**
 * Nova venda, logo abaixo do Cliente (em qualquer tipo de atendimento): escolhido um cliente
 * cadastrado, já mostra o PIN do app dele, o saldo, o nível, as recompensas e os cupons, e deixa
 * usar um deles neste pedido (o desconto entra no total e os pontos saem quando o pedido é
 * lançado; pedido cancelado devolve). Sem cliente, dá para achar a pessoa pelo PIN do app.
 */
export function SalePerks({
  customer,
  onCustomer,
  perk,
  onPerk,
}: {
  customer: OrderCustomer;
  onCustomer(c: OrderCustomer): void;
  perk: SalePerk | null;
  onPerk(p: SalePerk | null): void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [coupons, setCoupons] = useState<PinCoupon[]>([]);
  const [failed, setFailed] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setCoupons([]);
    setFailed(false);
    if (!customer.id) return;
    let alive = true;
    api<Loaded>(`/loyalty/customers/${customer.id}/pin`)
      .then(async (v) => {
        if (!alive) return;
        setData(v);
        const c = await api<PinCoupon[]>(`/coupons/pin/${v.pin}`).catch(() => []);
        if (alive) setCoupons(c);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [customer.id]);

  async function findByPin(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) return setPinError('O PIN tem 6 números');
    setPinBusy(true);
    setPinError(null);
    try {
      const v = await api<PinView>(`/loyalty/pin/${pin}`);
      onCustomer({ id: v.customer.id, name: v.customer.name, phone: '' });
      setPinOpen(false);
      setPin('');
    } catch (err) {
      setPinError((err as ApiError).message || 'Não deu para buscar o PIN');
    } finally {
      setPinBusy(false);
    }
  }

  if (!customer.id) {
    if (!pinOpen)
      return (
        <button type="button" className="sperk__pin-link" onClick={() => setPinOpen(true)}>
          <KeyRound size={14} aria-hidden /> Cliente com PIN do app
        </button>
      );
    return (
      <form className="sperk__pin-form" onSubmit={findByPin}>
        <input
          className="cm-input sperk__pin-input"
          inputMode="numeric"
          autoComplete="off"
          aria-label="PIN do cliente (6 números)"
          placeholder="PIN"
          maxLength={6}
          value={pin}
          autoFocus
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
            setPinError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setPinOpen(false);
            }
          }}
        />
        <Button type="submit" size="sm" loading={pinBusy} disabled={pin.length !== 6}>
          Buscar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPinOpen(false)}>
          Cancelar
        </Button>
        {pinError && <p className="form-error sperk__pin-error">{pinError}</p>}
      </form>
    );
  }

  if (failed) return null;
  if (!data)
    return (
      <div className="sperk" aria-busy="true">
        <Skeleton rows={2} />
      </div>
    );

  const level = data.levels.length ? levelOf(data.levels, data.earned) : null;
  const rewards = data.enabled ? data.rewards : [];
  const usable = coupons.filter((c) => !c.blocked);
  const chosenReward = perk?.kind === 'reward' ? perk.reward.id : null;
  const chosenCoupon = perk?.kind === 'coupon' ? perk.coupon.id : null;

  return (
    <section className="sperk" aria-label="PIN e recompensas do cliente">
      <div className="sperk__head">
        <span className="sperk__pin" title="PIN do app do cliente">
          <KeyRound size={14} aria-hidden />
          <span className="sperk__pin-label">PIN</span>
          <output className="sperk__pin-value" aria-label="PIN do cliente">
            {data.pin}
          </output>
        </span>
        {level?.current && (
          <span
            className="sperk__level"
            style={level.current.color ? { color: level.current.color } : undefined}
          >
            {level.current.name}
          </span>
        )}
        <span className="sperk__balance">
          <strong className="cm-num">{int(data.balance)}</strong> {unitOf(data.mode, data.balance)}
        </span>
      </div>
      {!data.enabled && (
        <p className="sperk__note">O programa de fidelidade está pausado: os pontos não trocam.</p>
      )}

      {rewards.length > 0 && (
        <>
          <h4 className="sperk__sec">
            <Gift size={14} aria-hidden /> Recompensas
          </h4>
          <ul className="sperk__list">
            {rewards.map((r) => {
              const short = data.balance < r.cost;
              const on = chosenReward === r.id;
              return (
                <li key={r.id} data-on={on || undefined} data-off={short || undefined}>
                  <span className="sperk__item">
                    <strong>{r.name}</strong>
                    <small>
                      {int(r.cost)} {unitOf(data.mode, r.cost)} ·{' '}
                      {r.kind === 'discount'
                        ? `${brl(r.amount ?? '0')} de desconto`
                        : `${r.productName ?? 'Produto'} grátis`}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="sperk__use"
                    aria-pressed={on}
                    disabled={short && !on}
                    onClick={() => onPerk(on ? null : { kind: 'reward', reward: r })}
                  >
                    {on ? (
                      <>
                        <Check size={14} aria-hidden /> Usando
                      </>
                    ) : short ? (
                      `Faltam ${int(r.cost - data.balance)}`
                    ) : (
                      'Usar'
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {usable.length > 0 && (
        <>
          <h4 className="sperk__sec">
            <TicketPercent size={14} aria-hidden /> Cupons
          </h4>
          <ul className="sperk__list">
            {usable.map((c) => {
              const on = chosenCoupon === c.id;
              return (
                <li key={c.id} data-on={on || undefined}>
                  <span className="sperk__item">
                    <strong>
                      <code className="sperk__code">{c.code}</code> {couponHeadline(c)}
                    </strong>
                    <small>
                      {toCents(c.minOrder) > 0
                        ? `${c.title} · pedido mínimo ${brl(c.minOrder)}`
                        : c.title}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="sperk__use"
                    aria-pressed={on}
                    onClick={() => onPerk(on ? null : { kind: 'coupon', coupon: c })}
                  >
                    {on ? (
                      <>
                        <Check size={14} aria-hidden /> Usando
                      </>
                    ) : (
                      'Usar'
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {rewards.length === 0 && usable.length === 0 && data.enabled && (
        <p className="sperk__note">Sem recompensas ou cupons para usar agora.</p>
      )}
    </section>
  );
}
