import { Skeleton, useToast } from '../../design-system';
import { fromCents, levelOf, type LoyaltyLevel } from '@comandou/shared';
import { Check, ChevronRight, Gift, KeyRound, RefreshCw, UserPlus } from 'lucide-react';
import { CSSProperties, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import { LoyaltyArt } from './art';
import { CustomerAvatar } from './avatars';
import { useStore } from './context';
import {
  CartLine,
  cartPoints,
  LOYALTY_LABEL,
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
const fullDay = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

/** Programa ligado, ou null (carregando ou desligado). */
export function useLoyalty(): LoyaltyOn | null {
  const { loyalty, rules } = useStore();
  // Cardápio da mesa não mostra fidelidade (regras em store-rules.ts).
  return rules.loyalty && loyalty?.enabled ? loyalty : null;
}

/** Recompensa mais barata que o cliente ainda não alcança (a "próxima meta"). */
export function nextGoal(l: LoyaltyOn, balance: number) {
  const sorted = [...l.rewards].sort((a, b) => a.cost - b.cost);
  return sorted.find((r) => r.cost > balance) ?? null;
}

const rewardHint = (r: LoyaltyReward) =>
  r.kind === 'discount'
    ? `Desconto de ${brl(r.amount!)} no pedido`
    : `${r.productName ?? 'Produto'} grátis (vale ${brl(r.amount ?? '0')})`;

/** Cor do nível (a que a loja escolheu, senão a da loja). */
const levelStyle = (l: LoyaltyLevel | null | undefined) =>
  l?.color ? ({ '--lv': l.color } as CSSProperties) : undefined;

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
      aria-label={`${pct}% do caminho até ${goal.name}`}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * PIN de 6 números que o cliente mostra no balcão: a equipe acha a conta e troca os pontos ou
 * usa o cupom ali mesmo. "Gerar outro" troca o PIN (o de antes deixa de valer).
 */
function PinCard({ pin }: { pin: string }) {
  const { refreshLoyalty } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(true);
  async function renew() {
    setBusy(true);
    try {
      await api('/store/account/loyalty/pin', { method: 'POST' });
      await refreshLoyalty();
      toast('PIN novo pronto. O antigo não vale mais.', 'success');
    } catch (e) {
      toast((e as ApiError).message || 'Não deu para trocar o PIN agora', 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="loy-pin">
      <p className="loy-pin__hint">
        <KeyRound size={15} aria-hidden /> Mostre no balcão para usar seus pontos e cupons na loja
      </p>
      <button
        type="button"
        className="loy-pin__box"
        onClick={() => setShown((v) => !v)}
        aria-label={
          shown ? `Seu PIN: ${pin.split('').join(' ')}. Toque para esconder` : 'Mostrar o PIN'
        }
      >
        <span className="loy-pin__label">Seu PIN</span>
        <span className="loy-pin__digits cm-selectable" aria-hidden>
          {pin.split('').map((d, i) => (
            <b key={i}>{shown ? d : '•'}</b>
          ))}
        </span>
      </button>
      <button type="button" className="link loy-pin__renew" onClick={renew} disabled={busy}>
        <RefreshCw size={14} aria-hidden className={busy ? 'loy-spin' : undefined} /> Gerar outro
        PIN
      </button>
    </div>
  );
}

/** Lista dos níveis: o atual marcado, o que cada um dá e a partir de quantos pontos. */
function Levels({
  l,
  levels,
  current,
}: {
  l: LoyaltyOn;
  levels: LoyaltyLevel[];
  current: LoyaltyLevel | null;
}) {
  const sorted = [...levels].sort((a, b) => a.minPoints - b.minPoints);
  return (
    <ol className="loy-levels">
      {sorted.map((lv) => (
        <li
          key={lv.id}
          className="loy-levels__item"
          data-on={lv.id === current?.id || undefined}
          style={levelStyle(lv)}
        >
          <span className="loy-levels__dot" aria-hidden />
          <span className="loy-levels__text">
            <strong>
              {lv.name}
              {lv.id === current?.id && <small className="loy-levels__you">Você está aqui</small>}
            </strong>
            <small>
              {lv.minPoints > 0
                ? `A partir de ${int(lv.minPoints)} ${loyaltyUnit(l, lv.minPoints)}`
                : 'Ao entrar no programa'}
            </small>
            {lv.perks && <span className="loy-levels__perks">{lv.perks}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Tela de pontos: nível, saldo com o PIN do balcão, recompensas, níveis e extrato. */
export function LoyaltyScreen() {
  const l = useLoyalty();
  const { loyalty, account } = useStore();
  const [allHistory, setAllHistory] = useState(false);
  if (!loyalty)
    return (
      <div className="sf-wrap sf-page">
        <Skeleton variant="cards" />
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
  const me = account?.customer ?? null;
  const unit = (n: number) => loyaltyUnit(l, n);
  const goal = acc ? nextGoal(l, acc.balance) : null;
  const levels = l.levels ?? [];
  const lv = levels.length ? levelOf(levels, acc?.earned ?? 0) : null;
  const history = acc?.history ?? [];
  const shownHistory = allHistory ? history : history.slice(0, 6);
  const title = l.mode === 'stamps' ? 'Carimbos' : 'Pontos';
  return (
    <div className="sf-wrap sf-page loy">
      <ScreenHeader title={title} back="/pedir" />

      {acc && me ? (
        <>
          <section className="loy-me" style={levelStyle(lv?.current)}>
            <div className="loy-me__who">
              <CustomerAvatar customer={me} size={56} className="loy-me__avatar" decorative />
              <span>
                <strong>{me.name.split(' ')[0]}</strong>
                {lv?.current ? (
                  <span className="loy-me__level">{lv.current.name}</span>
                ) : (
                  <small>{loyaltyRule(l)}</small>
                )}
              </span>
            </div>
            {lv && (
              <div className="loy-me__next">
                <div
                  className="loy-bar loy-bar--level"
                  role="progressbar"
                  aria-label="Caminho até o próximo nível"
                  aria-valuenow={lv.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${lv.pct}%` }} />
                </div>
                <p className="loy-me__hint">
                  {lv.next ? (
                    <>
                      Faltam <strong>{int(lv.missing)}</strong> {unit(lv.missing)} para{' '}
                      <strong>{lv.next.name}</strong>
                    </>
                  ) : (
                    'Você está no nível mais alto. Aproveite!'
                  )}
                  {l.levelWindowDays
                    ? ` · contam os ${unit(2)} dos últimos ${l.levelWindowDays} dias`
                    : ''}
                </p>
              </div>
            )}
            {lv?.current?.perks && <p className="loy-me__perks">{lv.current.perks}</p>}
          </section>

          <h2 className="sec__title loy-h2">Saldo</h2>
          <section className="loy-card loy-balance">
            <LoyaltyArt live className="loy-card__art" />
            <strong className="loy-card__balance">
              <Gift size={26} aria-hidden /> {int(acc.balance)} <small>{unit(acc.balance)}</small>
            </strong>
            <Progress l={l} balance={acc.balance} />
            <p className="loy-card__hint">
              {goal
                ? `Faltam ${int(goal.cost - acc.balance)} para ${goal.name}.`
                : l.rewards.length
                  ? 'Você já pode trocar qualquer recompensa.'
                  : ''}
              {acc.pending > 0 && ` +${int(acc.pending)} a receber quando o pedido for concluído.`}
              {acc.expiresAt && ` Valem até ${fullDay(acc.expiresAt)}.`}
            </p>
            {acc.pin && <PinCard pin={acc.pin} />}
          </section>
        </>
      ) : (
        <section className="loy-card">
          <LoyaltyArt live className="loy-card__art" />
          <span className="loy-card__label">Como funciona</span>
          <strong className="loy-card__rule">{loyaltyRule(l)}</strong>
          <p className="loy-card__hint">
            {me
              ? `Seus ${unit(2)} aparecem aqui depois do primeiro pedido concluído.`
              : `Crie sua conta ou entre para juntar ${unit(2)} a cada pedido e usar na loja pelo PIN.`}
          </p>
          {!me && (
            <Link className="cta cta--inline" to="/pedir/conta">
              Entrar ou criar conta
            </Link>
          )}
        </section>
      )}

      {l.rewards.length > 0 && (
        <>
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
                    <small>{ok ? `${rewardHint(r)} · já dá para trocar` : rewardHint(r)}</small>
                  </span>
                  <span className="loy-reward__cost">
                    {int(r.cost)} <small>{unit(r.cost)}</small>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="form-hint loy-note">
            Para trocar, escolha a recompensa ao finalizar o pedido ou mostre o PIN no balcão.
          </p>
        </>
      )}

      {levels.length > 0 && (
        <>
          <h2 className="sec__title loy-h2">Níveis</h2>
          <Levels l={l} levels={levels} current={lv?.current ?? null} />
        </>
      )}

      {l.referral && me && (
        <Link className="loy-invite" to="/pedir/conta/indique">
          <UserPlus size={20} aria-hidden />
          <span>
            <strong>Indique um amigo</strong>
            <small>
              {l.referral.points > 0
                ? `Você ganha ${int(l.referral.points)} ${unit(l.referral.points)} no primeiro pedido dele`
                : `Seu amigo ganha ${int(l.referral.friendPoints)} ${unit(l.referral.friendPoints)}`}
            </small>
          </span>
          <ChevronRight size={18} aria-hidden />
        </Link>
      )}

      {history.length > 0 && (
        <>
          <h2 className="sec__title loy-h2">Extrato</h2>
          <ul className="loy-history">
            {shownHistory.map((e) => (
              <li key={e.id}>
                <span>
                  <strong>
                    {(e.kind === 'redeem' || e.kind === 'store') && e.note
                      ? e.note
                      : LOYALTY_LABEL[e.kind]}
                    {e.orderNumber ? ` · #${e.orderNumber}` : ''}
                  </strong>
                  <small>
                    {day(e.createdAt)}
                    {e.kind === 'store' && ' · no balcão'}
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
          {history.length > shownHistory.length && (
            <button type="button" className="link loy-more" onClick={() => setAllHistory(true)}>
              Ver o extrato todo
            </button>
          )}
        </>
      )}

      <p className="form-hint loy-note">
        {loyaltyRule(l)} em pedidos concluídos (sem a taxa de entrega).
        {l.expiryDays ? ` Os ${unit(2)} vencem após ${l.expiryDays} dias sem pedir.` : ''}
      </p>
    </div>
  );
}

/**
 * Bloco da finalização: mostra quanto o pedido rende e deixa trocar uma recompensa.
 * `value` é o id da recompensa escolhida (ou null). `locked`: por que não dá para trocar agora
 * (ex.: o pedido já usa um cupom).
 */
export function LoyaltyCheckout({
  cart,
  subtotal,
  discount: otherDiscount = 0,
  value,
  onChange,
  locked,
}: {
  cart: CartLine[];
  subtotal: number;
  /** Desconto que já sai do pedido por outro caminho (o cupom). */
  discount?: number;
  value: string | null;
  onChange(id: string | null): void;
  locked?: string | null;
}) {
  const l = useLoyalty();
  const { account, product } = useStore();
  if (!l) return null;
  const acc = l.account;
  const chosen = l.rewards.find((r) => r.id === value);
  const discount = chosen ? (rewardDiscount(chosen, cart, subtotal) ?? 0) : 0;
  const earn = cartPoints(l, cart, product, subtotal - discount - otherDiscount);
  const unit = (n: number) => loyaltyUnit(l, n);
  if (!l.rewards.length && earn <= 0) return null;
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
          {l.rewards.length > 0 && locked ? (
            <p className="form-hint">{locked}</p>
          ) : (
            l.rewards.length > 0 && (
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
            )
          )}
        </>
      )}
    </section>
  );
}
