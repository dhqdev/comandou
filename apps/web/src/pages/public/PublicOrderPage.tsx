import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type PixKeyType,
  type PixReceiptStatus,
  qtyLabel,
} from '@comandou/shared';
import {
  BadgeCheck,
  Bike,
  Check,
  ChefHat,
  CircleCheckBig,
  HandPlatter,
  Hourglass,
  MapPin,
  MessageCircle,
  PackageCheck,
  Store,
  UtensilsCrossed,
  Wallet,
  XCircle,
  Clock3,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CustomerLiveMap, DeliveryCode, type CustomerCourier } from '../../features/CustomerTrack';
import { time } from '../../features/format';
import { api, ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import { BagArt, CookingArt, MotoboyArt, OrdersArt, PickupArt } from './art';
import { InstallHint } from './InstallHint';
import { PixPay, ReceiptPicker, sendReceipt, type ReceiptFile } from './PixPay';
import { OnlineTrack, type OnlinePayView } from './OnlinePay';
import { Photo } from './ui';
import './public.css';

type Step = 'awaiting' | 'accepted' | 'ready' | 'dispatched' | 'completed';
interface PublicOrder {
  restaurant: { name: string; whatsapp: string | null; logoUrl: string | null; chat?: boolean };
  etaMin: number;
  etaMax: number;
  number: number;
  channel: 'delivery' | 'pickup' | 'table';
  /** Mesa do pedido feito pelo QR Code. */
  tableLabel?: string | null;
  /** Mesa em que o cliente busca o pedido pronto no balcão. */
  selfPickup?: boolean;
  /** Pronto e esperando no balcão: o cliente toca em "Já peguei". */
  canPickUp?: boolean;
  step: Step | 'cancelled';
  canCancel: boolean;
  createdAt: string;
  customerName: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  subtotal: string;
  deliveryFee: string;
  discount: string;
  /** Taxa de serviço (pedido de mesa). */
  surcharge?: string;
  total: string;
  paymentHint: PaymentMethod | null;
  changeFor: string | null;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  cancelReason: string | null;
  timeline: Record<Step | 'cancelled', string | null>;
  items: {
    name: string;
    quantity: string;
    unit?: string;
    total: string;
    notes: string | null;
    imageUrl: string | null;
    options: string[];
  }[];
  courier: CustomerCourier | null;
  /** Pix pelo cardápio: código com o que falta pagar e como está o comprovante. */
  pix?: {
    status: PixReceiptStatus;
    amount: string;
    code: string | null;
    payee: { name: string; keyType: PixKeyType; key: string } | null;
    receipt: { status: string; at: string; reason: string | null; amount?: string } | null;
    canSend: boolean;
  } | null;
  /** Pago pelo app (PagBank): cartão ou Pix e como está. */
  online?: OnlinePayView | null;
}

const HERO: Record<
  PublicOrder['step'],
  { icon: typeof Hourglass; tone: string; title: string; text: (o: PublicOrder) => string }
> = {
  awaiting: {
    icon: Hourglass,
    tone: 'var(--cm-warning)',
    title: 'Aguardando o restaurante',
    text: () => 'Seu pedido chegou. Assim que a loja aceitar, ele vai para a cozinha.',
  },
  accepted: {
    icon: ChefHat,
    tone: 'var(--cm-brand-deep)',
    title: 'Pedido em preparo',
    text: (o) =>
      o.channel === 'table'
        ? o.selfPickup
          ? 'A cozinha está preparando. Quando ficar pronto, avisamos aqui.'
          : `A cozinha está preparando. A gente leva na ${atTable(o)}.`
        : `Previsão de ${o.etaMin} a ${o.etaMax} minutos.`,
  },
  ready: {
    icon: PackageCheck,
    tone: 'var(--cm-info)',
    title: 'Pedido pronto',
    text: (o) =>
      o.channel === 'table'
        ? o.selfPickup
          ? 'Quando estiver com ele, toque em "Já peguei".'
          : `O garçom já leva na ${atTable(o)}.`
        : o.channel === 'pickup'
          ? 'Já pode retirar na loja.'
          : 'Separado e esperando o entregador sair.',
  },
  dispatched: {
    icon: Bike,
    tone: 'var(--cm-brand-deep)',
    title: 'Saiu para entrega',
    text: (o) => (o.courier ? `${o.courier.name} está a caminho.` : 'Está a caminho.'),
  },
  completed: {
    icon: CircleCheckBig,
    tone: 'var(--cm-success)',
    title: 'Pedido concluído',
    text: (o) =>
      o.channel === 'pickup'
        ? 'Retirado. Bom apetite!'
        : o.channel === 'table'
          ? o.selfPickup
            ? 'Retirado. Bom apetite!'
            : 'Na mesa. Bom apetite!'
          : 'Entregue. Bom apetite!',
  },
  cancelled: {
    icon: XCircle,
    tone: 'var(--cm-danger)',
    title: 'Pedido cancelado',
    text: (o) => o.cancelReason ?? 'Este pedido foi cancelado.',
  },
};

const atTable = (o: Pick<PublicOrder, 'tableLabel'>) =>
  o.tableLabel ? `Mesa ${o.tableLabel}` : 'sua mesa';

/** Pedido já buscado antes de abrir a tela (vindo da confirmação): abre pronto, sem piscar. */
const warm = new Map<string, PublicOrder>();
export function prefetchOrder(token: string) {
  const base = `/store/orders/${encodeURIComponent(token)}`;
  void api<PublicOrder>(base)
    .then((o) => warm.set(base, o))
    .catch(() => undefined);
}

/**
 * Acompanhamento do pedido. Pelo link (/pedido/:token, sem conta) ou pelo histórico da conta
 * (/pedir/pedidos/:id, com o cookie do cliente).
 */
export function PublicOrderPage() {
  const { token = '', id = '' } = useParams();
  const base = id
    ? `/store/account/orders/${encodeURIComponent(id)}`
    : `/store/orders/${encodeURIComponent(token)}`;
  const [o, setO] = useState<PublicOrder | null>(() => warm.get(base) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      setO(await api<PublicOrder>(base));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.status === 404
          ? 'Não encontramos este pedido. O link pode ter expirado.'
          : 'Sem conexão agora. Vamos tentar de novo sozinhos.',
      );
    }
  }, [base]);

  useEffect(() => {
    void load();
    // Atualiza a cada 8 s e na hora em que o cliente volta para a aba.
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 8_000);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  useEffect(() => {
    if (o) document.title = `Pedido #${o.number} · ${o.restaurant.name}`;
  }, [o]);

  // Ficou pronto com a página aberta: o celular vibra (o cliente pode estar olhando outra coisa).
  const step = o?.step;
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current && lastStep.current !== step && step === 'ready')
      navigator.vibrate?.([120, 60, 120]);
    lastStep.current = step;
  }, [step]);

  async function pickedUp() {
    setPicking(true);
    try {
      await api(`${base}/picked-up`, { method: 'POST' });
      navigator.vibrate?.(12);
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      await load();
      setPicking(false);
    }
  }

  async function cancel() {
    if (!window.confirm('Cancelar este pedido?')) return;
    setCancelling(true);
    try {
      await api(`${base}/cancel`, { method: 'POST' });
      await load();
    } catch (e) {
      window.alert((e as Error).message);
      await load();
    } finally {
      setCancelling(false);
    }
  }

  if (!o)
    return (
      <main className="store store--center">
        {error ? (
          <>
            <Store size={36} />
            <p>{error}</p>
            <Link to="/pedir">Ver o cardápio</Link>
          </>
        ) : (
          <div className="sk" style={{ width: 280, height: 160 }} />
        )}
      </main>
    );

  const hero = HERO[o.step];
  const Icon = hero.icon;
  const steps: { key: Step; label: string; hint?: string }[] = [
    { key: 'awaiting', label: 'Pedido enviado', hint: 'Aguardando a loja aceitar' },
    { key: 'accepted', label: 'Aceito e em preparo' },
    {
      key: 'ready',
      label: o.channel === 'pickup' ? 'Pronto para retirar' : 'Pronto',
    },
    ...(o.channel === 'delivery'
      ? [{ key: 'dispatched' as const, label: 'Saiu para entrega' }]
      : []),
    {
      key: 'completed',
      label:
        o.channel === 'pickup' || (o.channel === 'table' && o.selfPickup)
          ? 'Retirado'
          : o.channel === 'table'
            ? 'Na mesa'
            : 'Entregue',
    },
  ];
  const order: Step[] = steps.map((s) => s.key);
  const curIdx = o.step === 'cancelled' ? -1 : order.indexOf(o.step);
  const phone = o.restaurant.whatsapp?.replace(/\D/g, '');

  const live = o.step !== 'completed' && o.step !== 'cancelled';

  /*
   * Celular: uma coluna (status, código, mapa, resumo, ações). Notebook (public.css): o status e o
   * mapa à esquerda e o resumo com as ações à direita, preso no topo, para caber sem rolar.
   */
  return (
    <main className="store store--track">
      <div className="track">
        <header className="track__top">
          <Photo src={o.restaurant.logoUrl} alt={o.restaurant.name} />
          <strong>{o.restaurant.name}</strong>
          <Link to="/pedir">
            <UtensilsCrossed size={15} aria-hidden /> Cardápio
          </Link>
        </header>

        <div className="track__main">
          <section
            className="track__card track__status"
            style={{ ['--tone' as string]: hero.tone }}
          >
            <div className="track__hero" aria-live="polite">
              {o.step === 'awaiting' ? (
                <OrdersArt live className="track__art" />
              ) : o.step === 'accepted' ? (
                <CookingArt live className="track__art" />
              ) : o.step === 'ready' ? (
                o.channel === 'pickup' ? (
                  <PickupArt live className="track__art" />
                ) : (
                  <BagArt live className="track__art" />
                )
              ) : o.step === 'dispatched' ? (
                <MotoboyArt ride className="track__art" />
              ) : o.step === 'completed' ? (
                <BagArt done live className="track__art" />
              ) : (
                <span className="track__badge" data-live={live ? '' : undefined}>
                  <Icon size={28} />
                </span>
              )}
              <div className="track__head">
                <span className="cm-hint">Pedido #{o.number}</span>
                <h1>
                  {o.step === 'ready' && o.channel === 'table' && o.selfPickup
                    ? 'Pronto! Busque no balcão'
                    : hero.title}
                </h1>
                <p>{hero.text(o)}</p>
              </div>
            </div>

            {o.step !== 'cancelled' && (
              <ol className="steps">
                {steps.map((s, i) => {
                  const state =
                    i < curIdx || o.step === 'completed'
                      ? 'done'
                      : i === curIdx
                        ? 'current'
                        : 'todo';
                  const at = o.timeline[s.key];
                  return (
                    <li key={s.key} className="step" data-state={state}>
                      <span className="step__dot">{state === 'done' && <Check size={14} />}</span>
                      <span className="step__label">
                        {s.label}
                        {state === 'current' && s.hint && <small>{s.hint}</small>}
                      </span>
                      <span className="step__time">{at && state !== 'todo' ? time(at) : ''}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            {o.canPickUp && (
              <button
                type="button"
                className="track__picked"
                onClick={() => void pickedUp()}
                disabled={picking}
              >
                <PackageCheck size={18} /> {picking ? 'Um instante…' : 'Já peguei'}
              </button>
            )}

            {live && <p className="track__live">Esta página se atualiza sozinha</p>}
          </section>

          {error && <p className="form-error">{error}</p>}

          {o.step === 'dispatched' && o.courier && (
            <CustomerLiveMap courier={o.courier} className="track__map" />
          )}
        </div>

        <div className="track__side">
          {o.step === 'dispatched' && o.courier?.code && <DeliveryCode code={o.courier.code} />}

          {o.online && (o.step !== 'cancelled' || o.online.status !== 'expired') && (
            <OnlineTrack online={o.online} base={base} onChange={load} />
          )}
          {o.pix && o.step !== 'cancelled' && (
            <PixTrack pix={o.pix} path={`${base}/pix-receipt`} onSent={load} />
          )}
          {o.pix && o.step === 'cancelled' && o.pix.status !== 'approved' && (
            <PixCancelled pix={o.pix} />
          )}

          <section className="track__card track__sum">
            <h2>Resumo</h2>
            <ul className="track__items">
              {o.items.map((i, n) => (
                <li key={n}>
                  <Photo src={i.imageUrl} alt={i.name} className="track__photo" />
                  <span>{qtyLabel(i.quantity, i.unit)}</span>
                  <span>
                    {i.name}
                    {i.options.length > 0 && <small>{i.options.join(', ')}</small>}
                    {i.notes && <small>Obs.: {i.notes}</small>}
                  </span>
                  <span>{brl(i.total)}</span>
                </li>
              ))}
            </ul>
            <dl className="sum">
              <dt>Subtotal</dt>
              <dd>{brl(o.subtotal)}</dd>
              {o.channel === 'delivery' && (
                <>
                  <dt>Entrega</dt>
                  <dd>{Number(o.deliveryFee) ? brl(o.deliveryFee) : 'Grátis'}</dd>
                </>
              )}
              {Number(o.discount) > 0 && (
                <>
                  <dt>Desconto</dt>
                  <dd>− {brl(o.discount)}</dd>
                </>
              )}
              {Number(o.surcharge ?? 0) > 0 && (
                <>
                  <dt>{o.channel === 'table' ? 'Serviço' : 'Acréscimo'}</dt>
                  <dd>{brl(o.surcharge!)}</dd>
                </>
              )}
              <dt className="sum__total">Total</dt>
              <dd className="sum__total">{brl(o.total)}</dd>
            </dl>
            <div className="track__info">
              {o.paymentHint && (
                <div className="track__row">
                  <Wallet size={15} aria-hidden />
                  <span>
                    Pagamento: {PAYMENT_METHOD_LABELS[o.paymentHint]}
                    {o.changeFor && ` (troco para ${brl(o.changeFor)})`}
                    {o.paymentStatus === 'paid' && ' · pago'}
                  </span>
                </div>
              )}
              {o.deliveryAddress && (
                <div className="track__row">
                  <MapPin size={15} aria-hidden /> <span>{o.deliveryAddress}</span>
                </div>
              )}
              {o.channel === 'pickup' && (
                <div className="track__row">
                  <Store size={15} aria-hidden /> <span>Retirada na loja</span>
                </div>
              )}
              {o.channel === 'table' && (
                <div className="track__row">
                  <HandPlatter size={15} aria-hidden />
                  <span>
                    {atTable(o)}
                    {o.paymentStatus === 'paid'
                      ? ' · pago'
                      : o.pix
                        ? ' · Pix pelo app'
                        : ' · você paga no fim, com o garçom'}
                  </span>
                </div>
              )}
            </div>
          </section>

          <div className="track__actions">
            {/* Pedido da mesa: quem resolve é o garçom (sem conversa nem WhatsApp). */}
            {o.channel === 'table' ? null : o.restaurant.chat ? (
              <Link className="btn-line" to={`/pedir/conversa?pedido=${o.number}`}>
                <MessageCircle size={16} /> Falar com a loja
              </Link>
            ) : (
              phone && (
                <a
                  className="btn-line"
                  href={`https://wa.me/${phone.length <= 11 ? `55${phone}` : phone}?text=${encodeURIComponent(`Olá! Sobre o meu pedido #${o.number}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={16} /> Falar com a loja
                </a>
              )
            )}
            {o.canCancel && (
              <button className="btn-line btn-line--danger" onClick={cancel} disabled={cancelling}>
                <XCircle size={16} /> {cancelling ? 'Cancelando…' : 'Cancelar pedido'}
              </button>
            )}
            {/* Na mesa dá para pedir mais a qualquer hora (vai para a mesma conta). */}
            {(!live || o.channel === 'table') && (
              <Link className="btn-line" to="/pedir">
                {o.channel === 'table' ? 'Pedir mais' : 'Fazer outro pedido'}
              </Link>
            )}
          </div>
        </div>
      </div>
      {/* Esperando a comida: bom momento para sugerir o app (acompanha daqui na próxima vez). */}
      {o.channel !== 'table' && (
        <InstallHint name={o.restaurant.name} logoUrl={o.restaurant.logoUrl} delay={2500} />
      )}
    </main>
  );
}

/** Pedido cancelado que era pago por Pix: o que acontece com o dinheiro do cliente. */
function PixCancelled({ pix }: { pix: NonNullable<PublicOrder['pix']> }) {
  const r = pix.receipt;
  const value = r?.amount ? ` de ${brl(r.amount)}` : '';
  return (
    <section className="track__card track__pix">
      <h2>Pagamento por Pix</h2>
      {pix.status === 'refund_due' ? (
        <p className="pixpay__state">
          <Clock3 size={18} aria-hidden />
          <span>
            <strong>A loja vai devolver o seu Pix</strong>
            <small>
              O pedido foi cancelado com o comprovante enviado. A loja confere o Pix{value} e
              devolve para a sua conta.
            </small>
          </span>
        </p>
      ) : pix.status === 'refunded' ? (
        <p className="pixpay__state" data-tone="ok">
          <BadgeCheck size={18} aria-hidden />
          <span>
            <strong>Pix devolvido</strong>
            <small>A loja informou que devolveu o seu Pix{value}. Confira no app do banco.</small>
          </span>
        </p>
      ) : pix.status === 'rejected' && r ? (
        <p className="pixpay__state" data-tone="bad">
          <XCircle size={18} aria-hidden />
          <span>
            <strong>A loja não encontrou o seu Pix</strong>
            <small>{r.reason ? `Motivo: ${r.reason}. ` : ''}Se você pagou, fale com a loja.</small>
          </span>
        </p>
      ) : (
        <p className="pixpay__state">
          <Clock3 size={18} aria-hidden />
          <span>
            <strong>Pedido cancelado</strong>
            <small>Se você já fez o Pix, fale com a loja para receber de volta.</small>
          </span>
        </p>
      )}
    </section>
  );
}

/** Pagamento por Pix no acompanhamento: pagar, mandar o comprovante e ver o que a loja decidiu. */
function PixTrack({
  pix,
  path,
  onSent,
}: {
  pix: NonNullable<PublicOrder['pix']>;
  path: string;
  onSent(): Promise<void>;
}) {
  const [file, setFile] = useState<ReceiptFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Comprovante já enviado: "mandar outro" fica escondido até o cliente pedir.
  const [again, setAgain] = useState(false);

  async function send() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await sendReceipt(path, file);
      setFile(null);
      setAgain(false);
      await onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const r = pix.receipt;
  const showPay = pix.canSend && (pix.status !== 'submitted' || again);
  return (
    <section className="track__card track__pix">
      <h2>Pagamento por Pix</h2>
      {pix.status === 'approved' ? (
        <p className="pixpay__state" data-tone="ok">
          <BadgeCheck size={18} aria-hidden />
          <span>
            <strong>Pix confirmado pela loja</strong>
            <small>O pagamento do pedido está certo. Bom apetite!</small>
          </span>
        </p>
      ) : pix.status === 'submitted' && r ? (
        <p className="pixpay__state">
          <Clock3 size={18} aria-hidden />
          <span>
            <strong>Comprovante enviado às {time(r.at)}</strong>
            <small>A loja está conferindo. Esta página avisa quando confirmar.</small>
          </span>
        </p>
      ) : pix.status === 'rejected' && r ? (
        <p className="pixpay__state" data-tone="bad">
          <XCircle size={18} aria-hidden />
          <span>
            <strong>A loja recusou o comprovante</strong>
            <small>
              {r.reason ? `Motivo: ${r.reason}. ` : ''}Confira o valor e mande outro, ou fale com a
              loja.
            </small>
          </span>
        </p>
      ) : null}
      {showPay && (
        <PixPay
          code={pix.code}
          amount={pix.amount}
          payee={
            pix.payee
              ? { name: pix.payee.name, keyType: pix.payee.keyType, keyLabel: pix.payee.key }
              : null
          }
          pending="A loja desligou o Pix pelo cardápio. Fale com a loja para pagar."
        >
          <ReceiptPicker value={file} onChange={setFile} disabled={busy} />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="cta pixpay__send"
            disabled={!file || busy}
            onClick={() => void send()}
          >
            {busy ? 'Enviando…' : 'Enviar comprovante'}
          </button>
        </PixPay>
      )}
      {pix.status === 'submitted' && pix.canSend && !again && (
        <button type="button" className="link pixpay__again" onClick={() => setAgain(true)}>
          Mandei o comprovante errado
        </button>
      )}
    </section>
  );
}
