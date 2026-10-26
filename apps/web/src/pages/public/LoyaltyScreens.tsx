import { fromCents } from '@comandou/shared';
import { Check, ChevronRight, Gift } from 'lucide-react';
import { Link } from 'react-router';
import { brl } from '../../lib/money';
import { useStore } from './context';
import {
  CartLine,
  LOYALTY_LABEL,
  loyaltyPoints,
  loyaltyRule,
  loyaltyUnit,
  LoyaltyOn,
  LoyaltyReward,
  rewardDiscount,
} from './store';
import { Photo, ScreenHeader } from './ui';
import './loyalty.css';

const int = (n: number) => n.toLocaleString('pt-BR');
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/** Programa ligado, ou null (carregando ou desligado). */
export function useLoyalty(): LoyaltyOn | null {
  const { loyalty } = useStore();
  return loyalty?.enabled ? loyalty : null;
}

/** Recompensa mais barata que o cliente ainda não alcança (a "próxima meta"). */
function nextGoal(l: LoyaltyOn, balance: number) {
  const sorted = [...l.rewards].sort((a, b) => a.cost - b.cost);
  return sorted.find((r) => r.cost > balance) ?? null;
}

const rewardHint = (r: LoyaltyReward) =>
  r.kind === 'discount'
    ? `Desconto de ${brl(r.amount!)} no pedido`
    : `${r.productName ?? 'Produto'} grátis (vale ${brl(r.amount ?? '0')})`;

/** Faixa discreta no início do cardápio: saldo e a próxima recompensa. */
export function LoyaltyStrip() {
  const l = useLoyalty();
  const { account } = useStore();
  if (!l || !l.rewards.length) return null;
  const acc = l.account;
  const unit = (n: number) => loyaltyUnit(l, n);
  let text: string;
  if (!acc) text = account?.customer ? loyaltyRule(l) : `${loyaltyRule(l)}. Entre para participar`;
  else {
    const goal = nextGoal(l, acc.balance);
    const ready = l.rewards.some((r) => r.cost <= acc.balance);
    text = ready
      ? 'Você já pode trocar uma recompensa'
      : goal
        ? `Faltam ${int(goal.cost - acc.balance)} ${unit(goal.cost - acc.balance)} para ${goal.name}`
        : loyaltyRule(l);
  }
  return (
    <Link className="loy-strip" to="/pedir/fidelidade">
      <span className="loy-strip__icon" aria-hidden>
        <Gift size={18} />
      </span>
      <span className="loy-strip__text">
        <strong>
          {acc ? `${int(acc.balance)} ${unit(acc.balance)}` : 'Programa de fidelidade'}
        </strong>
        <small>{text}</small>
      </span>
      <ChevronRight size={18} aria-hidden />
    </Link>
  );
}

/** Barra de progresso (pontos) ou cartela de carimbos até a próxima recompensa. */
function Progress({ l, balance }: { l: LoyaltyOn; balance: number }) {
  const goal = nextGoal(l, balance) ?? [...l.rewards].sort((a, b) => b.cost - a.cost)[0];
  if (!goal) return null;
  if (l.mode === 'stamps' && goal.cost <= 20)
    return (
      <div className="loy-stamps" aria-label={`${balance} de ${goal.cost} carimbos`}>
        {Array.from({ length: goal.cost }, (_, i) => (
          <span key={i} data-on={i < balance || undefined}>
            {i < balance && <Check size={14} />}
          </span>
        ))}
      </div>
    );
  const pct = Math.min(100, Math.round((balance / goal.cost) * 100));
  return (
    <div
      className="loy-bar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Tela "Fidelidade": saldo, cartela, recompensas e extrato. */
export function LoyaltyScreen() {
  const l = useLoyalty();
  const { loyalty, account } = useStore();
  if (!loyalty)
    return (
      <div className="sf-wrap sf-page">
        <div className="sk sk--banner" />
      </div>
    );
  if (!l)
    return (
      <div className="sf-wrap sf-page">
        <ScreenHeader title="Fidelidade" back="/pedir" />
        <p className="form-hint">Esta loja não tem programa de fidelidade no momento.</p>
      </div>
    );
  const acc = l.account;
  const unit = (n: number) => loyaltyUnit(l, n);
  const goal = acc ? nextGoal(l, acc.balance) : null;
  return (
    <div className="sf-wrap sf-page loy">
      <ScreenHeader title="Fidelidade" back="/pedir/conta" />
      <section className="loy-card">
        {acc ? (
          <>
            <span className="loy-card__label">Seu saldo</span>
            <strong className="loy-card__balance">
              {int(acc.balance)} <small>{unit(acc.balance)}</small>
            </strong>
            <Progress l={l} balance={acc.balance} />
            <p className="loy-card__hint">
              {goal
                ? `Faltam ${int(goal.cost - acc.balance)} para ${goal.name}.`
                : 'Você já pode trocar qualquer recompensa.'}
              {acc.pending > 0 && ` +${int(acc.pending)} a receber quando o pedido for concluído.`}
              {acc.expiresAt && ` Valem até ${day(acc.expiresAt)}.`}
            </p>
          </>
        ) : (
          <>
            <span className="loy-card__label">Como funciona</span>
            <strong className="loy-card__rule">{loyaltyRule(l)}</strong>
            <p className="loy-card__hint">
              {account?.customer
                ? 'Seus pontos aparecem aqui depois do primeiro pedido concluído.'
                : 'Crie sua conta ou entre para juntar pontos a cada pedido.'}
            </p>
            {!account?.customer && (
              <Link className="cta cta--inline" to="/pedir/conta">
                Entrar ou criar conta
              </Link>
            )}
          </>
        )}
      </section>

      <h2 className="sec__title loy-h2">Recompensas</h2>
      <ul className="loy-rewards">
        {l.rewards.map((r) => {
          const ok = !!acc && acc.balance >= r.cost;
          return (
            <li key={r.id} className="loy-reward" data-ok={ok || undefined}>
              {r.kind === 'product' && r.imageUrl ? (
                <Photo src={r.imageUrl} alt={r.name} className="loy-reward__photo" />
              ) : (
                <span className="loy-reward__icon" aria-hidden>
                  <Gift size={18} />
                </span>
              )}
              <span className="loy-reward__text">
                <strong>{r.name}</strong>
                <small>{rewardHint(r)}</small>
              </span>
              <span className="loy-reward__cost">
                {int(r.cost)} <small>{unit(r.cost)}</small>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="form-hint loy-note">
        {loyaltyRule(l)} em pedidos concluídos (sem a taxa de entrega).
        {l.expiryDays ? ` Os ${unit(2)} vencem após ${l.expiryDays} dias sem pedir.` : ''} Para
        trocar, escolha a recompensa ao finalizar o pedido.
      </p>

      {acc && acc.history.length > 0 && (
        <>
          <h2 className="sec__title loy-h2">Extrato</h2>
          <ul className="loy-history">
            {acc.history.map((e) => (
              <li key={e.id}>
                <span>
                  <strong>
                    {e.kind === 'redeem' && e.note ? e.note : LOYALTY_LABEL[e.kind]}
                    {e.orderNumber ? ` · #${e.orderNumber}` : ''}
                  </strong>
                  <small>
                    {day(e.createdAt)}
                    {e.kind === 'adjust' && e.note ? ` · ${e.note}` : ''}
                  </small>
                </span>
                <b data-neg={e.points < 0 || undefined}>
                  {e.points > 0 ? '+' : ''}
                  {int(e.points)}
                </b>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Bloco da finalização: mostra quanto o pedido rende e deixa trocar uma recompensa.
 * `value` é o id da recompensa escolhida (ou null).
 */
export function LoyaltyCheckout({
  cart,
  subtotal,
  value,
  onChange,
}: {
  cart: CartLine[];
  subtotal: number;
  value: string | null;
  onChange(id: string | null): void;
}) {
  const l = useLoyalty();
  const { account } = useStore();
  if (!l || !l.rewards.length) return null;
  const acc = l.account;
  const chosen = l.rewards.find((r) => r.id === value);
  const discount = chosen ? (rewardDiscount(chosen, cart, subtotal) ?? 0) : 0;
  const earn = loyaltyPoints(l, subtotal - discount);
  const unit = (n: number) => loyaltyUnit(l, n);
  return (
    <section className="ck-card">
      <h2 className="ck-card__title">
        <Gift size={16} /> Fidelidade
      </h2>
      {!account?.customer ? (
        <p className="form-hint">
          <Link to="/pedir/conta">Entre na sua conta</Link> para ganhar{' '}
          {earn > 0 ? `${int(earn)} ${unit(earn)}` : unit(2)} com este pedido.
        </p>
      ) : (
        <>
          <p className="form-hint loy-ck__head">
            Você tem <strong>{int(acc?.balance ?? 0)}</strong> {unit(acc?.balance ?? 0)}
            {earn > 0 && (
              <>
                {' '}
                · este pedido rende <strong>+{int(earn)}</strong>
              </>
            )}
          </p>
          <div className="loy-pick" role="radiogroup" aria-label="Usar recompensa">
            <button
              type="button"
              role="radio"
              aria-checked={!value}
              className="loy-pick__opt"
              onClick={() => onChange(null)}
            >
              <span>
                <strong>Não usar agora</strong>
              </span>
            </button>
            {l.rewards.map((r) => {
              const d = rewardDiscount(r, cart, subtotal);
              const short = (acc?.balance ?? 0) < r.cost;
              const disabled = short || d === null;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={value === r.id}
                  disabled={disabled}
                  className="loy-pick__opt"
                  onClick={() => onChange(r.id)}
                >
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {short
                        ? `Faltam ${int(r.cost - (acc?.balance ?? 0))} ${unit(r.cost)}`
                        : d === null
                          ? `Coloque ${r.productName ?? 'o produto'} na sacola`
                          : `−${brl(fromCents(d))}`}
                    </small>
                  </span>
                  <span className="loy-pick__cost">
                    {int(r.cost)} {unit(r.cost)}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
