import { couponHeadline, levelOf, toCents, type LoyaltyLevel } from '@comandou/shared';
import { Gift, KeyRound, Search, TicketPercent } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Button, EmptyState, Modal, Skeleton, useToast } from '../design-system';
import { api, ApiError } from '../lib/api';
import { brl } from '../lib/money';
import './customer-pin.css';

export interface PinReward {
  id: string;
  name: string;
  cost: number;
  kind: 'discount' | 'product';
  amount: string | null;
  productId: string | null;
  productName: string | null;
  productPrice: string | null;
}
export interface PinView {
  customer: { id: string; name: string; phoneEnd: string };
  enabled: boolean;
  mode: 'points' | 'stamps';
  balance: number;
  expiresAt: string | null;
  earned: number;
  levels: LoyaltyLevel[];
  rewards: PinReward[];
}
export interface PinCoupon {
  id: string;
  code: string;
  title: string;
  kind: 'percent' | 'fixed' | 'free_delivery';
  value: string | null;
  maxDiscount: string | null;
  minOrder: string;
  blocked: string | null;
}

const int = (n: number) => n.toLocaleString('pt-BR');
const unitOf = (mode: PinView['mode'], n = 2) =>
  mode === 'stamps' ? (n === 1 ? 'carimbo' : 'carimbos') : n === 1 ? 'ponto' : 'pontos';

/**
 * Balcão: a equipe digita o PIN de 6 números que o cliente mostra na tela de pontos do app e vê
 * quem é (só o fim do celular), o saldo e o nível; troca uma recompensa (desconta os pontos) ou
 * registra o uso de um cupom. O desconto em si é dado no caixa, na venda.
 */
export function CustomerPinModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PinView | null>(null);
  const [coupons, setCoupons] = useState<PinCoupon[]>([]);

  function reset() {
    setPin('');
    setView(null);
    setCoupons([]);
    setError(null);
  }
  function close() {
    reset();
    onClose();
  }

  async function look(e?: FormEvent) {
    e?.preventDefault();
    if (!/^\d{6}$/.test(pin)) return setError('O PIN tem 6 números');
    setBusy('look');
    setError(null);
    try {
      const [v, c] = await Promise.all([
        api<PinView>(`/loyalty/pin/${pin}`),
        api<PinCoupon[]>(`/coupons/pin/${pin}`).catch(() => [] as PinCoupon[]),
      ]);
      setView(v);
      setCoupons(c);
    } catch (err) {
      setView(null);
      setError((err as ApiError).message || 'Não deu para buscar o PIN');
    } finally {
      setBusy(null);
    }
  }

  async function redeem(r: PinReward) {
    if (!view) return;
    const what =
      r.kind === 'discount'
        ? `${brl(r.amount ?? '0')} de desconto`
        : `${r.productName ?? 'o produto'} grátis`;
    if (
      !window.confirm(
        `Trocar ${int(r.cost)} ${unitOf(view.mode, r.cost)} de ${view.customer.name} por ${r.name}? Dê ${what} no caixa.`,
      )
    )
      return;
    setBusy(r.id);
    try {
      setView(
        await api<PinView>(`/loyalty/pin/${pin}/redeem`, {
          method: 'POST',
          json: { rewardId: r.id },
        }),
      );
      toast(`Troca feita: dê ${what} no caixa`, 'success');
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function applyCoupon(c: PinCoupon) {
    if (!view) return;
    if (!window.confirm(`Registrar o uso do cupom ${c.code} por ${view.customer.name}?`)) return;
    setBusy(c.id);
    try {
      await api(`/coupons/pin/${pin}/use`, { method: 'POST', json: { couponId: c.id } });
      toast(`Cupom ${c.code} registrado: dê o desconto no caixa`, 'success');
      setCoupons(await api<PinCoupon[]>(`/coupons/pin/${pin}`).catch(() => coupons));
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  const level = view && view.levels.length ? levelOf(view.levels, view.earned) : null;
  const usable = coupons.filter((c) => !c.blocked);
  return (
    <Modal
      open={open}
      title={
        <span className="cpin__title">
          <KeyRound size={18} aria-hidden /> PIN do cliente
        </span>
      }
      onClose={close}
      footer={
        view ? (
          <>
            <Button variant="ghost" onClick={close}>
              Fechar
            </Button>
            <Button variant="secondary" onClick={reset}>
              Outro PIN
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
        )
      }
    >
      {!view ? (
        <form className="cpin__form" onSubmit={look}>
          <p className="cm-hint">
            O cliente abre a tela de pontos do app e mostra o PIN de 6 números. Com ele você troca
            os pontos e usa os cupons aqui no balcão.
          </p>
          <div className="cpin__row">
            <input
              className="cm-input cpin__pin"
              inputMode="numeric"
              autoComplete="off"
              aria-label="PIN de 6 números"
              placeholder="000000"
              maxLength={6}
              value={pin}
              autoFocus
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError(null);
              }}
            />
            <Button
              type="submit"
              icon={<Search size={16} />}
              loading={busy === 'look'}
              disabled={pin.length !== 6}
            >
              Buscar
            </Button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </form>
      ) : (
        <div className="cpin">
          <section className="cpin__who">
            <span className="cpin__name">
              <strong>{view.customer.name}</strong>
              <small>Celular com final {view.customer.phoneEnd}</small>
            </span>
            {level?.current && (
              <span
                className="cpin__level"
                style={level.current.color ? { color: level.current.color } : undefined}
              >
                {level.current.name}
              </span>
            )}
          </section>
          <div className="cpin__balance">
            <span>Saldo</span>
            <strong>
              {int(view.balance)} <small>{unitOf(view.mode, view.balance)}</small>
            </strong>
            {!view.enabled && <small>O programa está pausado: dá para ver, não para trocar.</small>}
          </div>

          <h3 className="cpin__sec">
            <Gift size={16} aria-hidden /> Trocar {unitOf(view.mode)}
          </h3>
          {view.rewards.length === 0 ? (
            <p className="cm-hint">A loja ainda não cadastrou recompensas.</p>
          ) : (
            <ul className="cpin__list">
              {view.rewards.map((r) => {
                const short = view.balance < r.cost;
                return (
                  <li key={r.id}>
                    <span className="cpin__item">
                      <strong>{r.name}</strong>
                      <small>
                        {int(r.cost)} {unitOf(view.mode, r.cost)} ·{' '}
                        {r.kind === 'discount'
                          ? `${brl(r.amount ?? '0')} de desconto`
                          : `${r.productName ?? 'Produto'} grátis`}
                      </small>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={short || !view.enabled || !!busy}
                      loading={busy === r.id}
                      title={short ? `Faltam ${int(r.cost - view.balance)}` : undefined}
                      onClick={() => redeem(r)}
                    >
                      {short ? `Faltam ${int(r.cost - view.balance)}` : 'Trocar'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="cpin__sec">
            <TicketPercent size={16} aria-hidden /> Cupons
          </h3>
          {busy === 'look' ? (
            <Skeleton rows={2} />
          ) : coupons.length === 0 ? (
            <EmptyState
              icon={<TicketPercent size={20} />}
              title="Nenhum cupom valendo"
              description="Os cupons ativos da loja aparecem aqui."
            />
          ) : (
            <ul className="cpin__list">
              {[...usable, ...coupons.filter((c) => c.blocked)].map((c) => (
                <li key={c.id} data-off={c.blocked ? '' : undefined}>
                  <span className="cpin__item">
                    <strong>
                      <code className="cpin__code">{c.code}</code> {couponHeadline(c)}
                    </strong>
                    <small>
                      {c.blocked ??
                        (toCents(c.minOrder) > 0
                          ? `${c.title} · pedido mínimo ${brl(c.minOrder)}`
                          : c.title)}
                    </small>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!c.blocked || !!busy}
                    loading={busy === c.id}
                    onClick={() => applyCoupon(c)}
                  >
                    Usar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
