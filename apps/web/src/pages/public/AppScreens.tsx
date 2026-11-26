import { scheduleText, toCents, type HourSlot } from '@comandou/shared';
import {
  Banknote,
  Bell,
  Bike,
  Check,
  ChevronDown,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  Instagram,
  MapPin,
  MessageCircle,
  Navigation,
  QrCode,
  Send,
  Share2,
  ShieldCheck,
  Smartphone,
  Store,
  TicketPercent,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Mascot, Skeleton, StoreMark, useToast } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import { LoyaltyArt } from './art';
import { useStoreChat } from './chat';
import { useStore } from './context';
import { useLoyalty } from './LoyaltyScreens';
import {
  clearInvite,
  loyaltyRule,
  loyaltyUnit,
  markNoticesSeen,
  PAYMENT_OPTIONS,
  pendingInvite,
  seenNotices,
  type CustomerInfo,
  type LoyaltyOn,
  type PublicAppInfo,
  type PublicMenu,
  type StoreFaq,
  type StoreNotice,
} from './store';
import { Photo, ScreenHeader } from './ui';

const int = (n: number) => n.toLocaleString('pt-BR');
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const hhmm = (t: string) => {
  const [h, m] = t.split(':');
  return m && m !== '00' ? `${Number(h)}h${m}` : `${Number(h)}h`;
};

function waLink(phone: string | null | undefined) {
  const wa = (phone ?? '').replace(/\D/g, '');
  return wa ? `https://wa.me/${wa.length <= 11 ? `55${wa}` : wa}` : null;
}
function mapLink(info: Pick<PublicAppInfo, 'location' | 'address'>, name: string) {
  if (info.location)
    return `https://www.google.com/maps/search/?api=1&query=${info.location.lat},${info.location.lng}`;
  if (info.address)
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${info.address}`)}`;
  return null;
}

// ---------------------------------------------------------------- dados das telas

/** Ajuda, Avisos, Sobre e A loja vêm juntos de GET /store/app (uma vez por visita). */
let appInfo: Promise<PublicAppInfo> | null = null;
export function useAppInfo() {
  const [info, setInfo] = useState<PublicAppInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    appInfo ??= api<PublicAppInfo>('/store/app');
    appInfo
      .then((i) => live && setInfo(i))
      .catch(() => {
        appInfo = null;
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return { info, failed };
}

function LoadFailed() {
  return (
    <p className="form-hint app-failed">
      Não deu para carregar agora. Confira a internet e tente de novo em instantes.
    </p>
  );
}

// ---------------------------------------------------------------- Notificações (avisos da loja)

const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return 'Hoje';
  if (d === 1) return 'Ontem';
  if (d < 7) return `Há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

function NoticeCard({ n, fresh }: { n: StoreNotice; fresh: boolean }) {
  const { setCoupon, product, rules } = useStore();
  const navigate = useNavigate();
  const item = n.targetType === 'product' && n.target ? product(n.target) : undefined;
  const coupon = n.targetType === 'coupon' && n.target && rules.coupons ? n.target : null;
  return (
    <li className="ntc" data-fresh={fresh || undefined}>
      {n.imageUrl && <Photo src={n.imageUrl} alt="" className="ntc__photo" />}
      <div className="ntc__body">
        <p className="ntc__when">
          {fresh && <span className="ntc__dot" aria-label="Novo" />}
          {ago(n.startsAt || n.createdAt)}
        </p>
        <h2 className="ntc__title">{n.title}</h2>
        {n.body && <p className="ntc__text">{n.body}</p>}
        {item && (
          <button
            type="button"
            className="ntc__go"
            onClick={() => navigate(`/pedir/produto/${item.id}`)}
          >
            Ver {item.name}
          </button>
        )}
        {coupon && (
          <button
            type="button"
            className="ntc__go"
            onClick={() => {
              setCoupon(coupon);
              navigate('/pedir/cupons');
            }}
          >
            <TicketPercent size={16} aria-hidden /> Usar o cupom {coupon}
          </button>
        )}
      </div>
    </li>
  );
}

/** Conta › Notificações: os avisos que a loja publicou (promoções, horários, novidades). */
export function NoticesScreen() {
  const { info, failed } = useAppInfo();
  // O que era novo ao abrir a tela continua marcado enquanto ela está aberta.
  const [seen] = useState(() => new Set(seenNotices()));
  useEffect(() => {
    if (info?.notices.length) markNoticesSeen(info.notices.map((n) => n.id));
  }, [info]);
  return (
    <div className="sf-wrap sf-page app-page">
      <ScreenHeader title="Notificações" back="/pedir/conta" />
      {failed ? (
        <LoadFailed />
      ) : !info ? (
        <Skeleton variant="cards" />
      ) : info.notices.length === 0 ? (
        <div className="empty-state">
          <Bell size={40} className="app-empty-ic" aria-hidden />
          <strong>Nenhum aviso por enquanto</strong>
          <p>Promoções, horários especiais e novidades da loja aparecem aqui.</p>
        </div>
      ) : (
        <ul className="ntc-list">
          {info.notices.map((n) => (
            <NoticeCard key={n.id} n={n} fresh={!seen.has(n.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Pagamento

interface PayWay {
  icon: ReactNode;
  title: string;
  text: string;
}

/** Como a loja recebe: pelo app (PagBank), Pix com comprovante e na entrega ou na retirada. */
function payWays(menu: PublicMenu) {
  const op = menu.onlinePay ?? null;
  const app: PayWay[] = [
    ...(op?.pix
      ? [
          {
            icon: <QrCode />,
            title: 'Pix pelo app',
            text: 'O código aparece logo depois do pedido. A confirmação é automática.',
          },
        ]
      : menu.pix
        ? [
            {
              icon: <QrCode />,
              title: 'Pix pelo app',
              text: 'Pague o QR Code e mande o comprovante pelo acompanhamento do pedido.',
            },
          ]
        : []),
    ...(op?.card
      ? [
          {
            icon: <CreditCard />,
            title: 'Cartão de crédito pelo app',
            text: 'Pago na hora, com segurança. O cartão não fica salvo neste aparelho.',
          },
        ]
      : []),
  ];
  const at = menu.store.acceptsDelivery
    ? menu.store.acceptsPickup
      ? 'na entrega ou na retirada'
      : 'na entrega'
    : 'na retirada';
  const later = PAYMENT_OPTIONS.filter((o) => !(o.value === 'pix' && app.length && menu.pix));
  return { app, at, later };
}

const PAY_ICON: Record<CustomerInfo['paymentMethod'], ReactNode> = {
  pix: <QrCode />,
  credit: <CreditCard />,
  debit: <CreditCard />,
  cash: <Banknote />,
  voucher: <Wallet />,
};

/** Conta › Pagamento: as formas que a loja aceita e a preferida, que já vem marcada no pedido. */
export function PaymentScreen() {
  const { menu, customer, setCustomer } = useStore();
  const toast = useToast();
  const { app, at, later } = payWays(menu);
  return (
    <div className="sf-wrap sf-page app-page">
      <ScreenHeader title="Pagamento" back="/pedir/conta" />
      {app.length > 0 && (
        <section className="app-sec">
          <h2 className="app-sec__title">Pelo app</h2>
          <ul className="app-list">
            {app.map((w) => (
              <li key={w.title} className="app-row">
                <span className="app-row__ic">{w.icon}</span>
                <span className="app-row__text">
                  <strong>{w.title}</strong>
                  <small>{w.text}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="app-sec">
        <h2 className="app-sec__title">Forma preferida, para pagar {at}</h2>
        <p className="form-hint app-sec__hint">
          A que você escolher já vem marcada quando for fazer o pedido.
        </p>
        <div className="app-list" role="radiogroup" aria-label="Forma de pagamento preferida">
          {later.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={customer.paymentMethod === o.value}
              className="app-row app-row--pick"
              onClick={() => {
                setCustomer((c) => ({ ...c, paymentMethod: o.value }));
                toast(`${o.label} fica como preferida`, 'success');
              }}
            >
              <span className="app-row__ic">{PAY_ICON[o.value]}</span>
              <span className="app-row__text">
                <strong>{o.label}</strong>
                {o.value === 'cash' && <small>Avise o troco na finalização</small>}
              </span>
              <span className="app-row__radio" aria-hidden>
                <Check size={14} />
              </span>
            </button>
          ))}
        </div>
      </section>
      <p className="form-hint app-note">
        <ShieldCheck size={16} aria-hidden /> Nenhum cartão fica salvo no app: os dados vão cifrados
        direto para o pagamento, a cada pedido.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- A loja (Escolher loja)

/** Horários da semana, um dia por linha, com hoje marcado. */
function HoursTable({ hours }: { hours: HourSlot[] }) {
  const today = new Date().getDay();
  // Começa na segunda, como o cardápio da loja.
  const days = [1, 2, 3, 4, 5, 6, 0];
  return (
    <dl className="app-hours">
      {days.map((d) => {
        const slots = hours
          .filter((h) => h.day === d)
          .sort((a, b) => a.open.localeCompare(b.open))
          .map((h) => (h.open === h.close ? '24 horas' : `${hhmm(h.open)} às ${hhmm(h.close)}`));
        return (
          <div key={d} className="app-hours__day" data-today={d === today || undefined}>
            <dt>
              {WEEKDAYS[d]}
              {d === today && <small> · hoje</small>}
            </dt>
            <dd>{slots.length ? slots.join(', ') : 'Fechada'}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Horários de hoje ("11h às 15h, 18h às 23h"), ou null sem horário cadastrado. */
function todayHours(hours: HourSlot[]) {
  if (!hours.length) return null;
  const today = new Date().getDay();
  const slots = hours
    .filter((h) => h.day === today)
    .sort((a, b) => a.open.localeCompare(b.open))
    .map((h) => (h.open === h.close ? '24 horas' : `${hhmm(h.open)} às ${hhmm(h.close)}`));
  return slots.length ? slots.join(', ') : 'Fechada hoje';
}

/** Botão redondo das ações rápidas (como chegar, WhatsApp, Instagram, compartilhar). */
function QuickAction({
  href,
  onClick,
  icon,
  label,
}: {
  href?: string;
  onClick?(): void;
  icon: ReactNode;
  label: string;
}) {
  const inner = (
    <>
      <span className="app-quick__ic">{icon}</span>
      <span className="app-quick__label">{label}</span>
    </>
  );
  return href ? (
    <a className="app-quick__btn" href={href} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    <button type="button" className="app-quick__btn" onClick={onClick}>
      {inner}
    </button>
  );
}

/**
 * Conta › A loja: capa com a logo e a situação, ações rápidas (como chegar, WhatsApp, Instagram,
 * compartilhar), como pedir, formas de pagamento, endereço, horário da semana e contato. Cada
 * restaurante tem o próprio app, então "escolher a loja" é conhecer esta.
 */
export function StoresScreen() {
  const { menu } = useStore();
  const { info, failed } = useAppInfo();
  const toast = useToast();
  const r = menu.restaurant;
  const s = menu.store;
  const map = info ? mapLink(info, r.name) : null;
  const wa = waLink(info?.whatsapp ?? r.whatsapp);
  const address = info?.address ?? r.address;
  const about = info?.about ?? r.about;
  const today = info ? todayHours(info.hours) : null;
  const { app, at, later } = payWays(menu);
  const link = `${window.location.origin}/pedir`;
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: r.name, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      toast('Link da loja copiado', 'success');
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError')
        toast('Não deu para compartilhar agora', 'danger');
    }
  }
  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast('Endereço copiado', 'success');
    } catch {
      toast('Não deu para copiar agora', 'danger');
    }
  }
  return (
    <div className="sf-wrap sf-page app-page">
      <ScreenHeader title="A loja" back="/pedir/conta" />
      <section className="app-store" data-cover={r.coverUrl ? true : undefined}>
        {r.coverUrl && (
          <Photo src={r.coverUrl} alt="" ratio="16 / 7" className="app-store__cover" />
        )}
        <div className="app-store__head">
          <StoreMark src={r.logoUrl} size={68} className="app-store__logo" />
          <div className="app-store__text">
            <h2>{r.name}</h2>
            <p className={`status ${s.isOpen ? 'is-open' : 'is-closed'}`}>
              {scheduleText(s.isOpen, s.schedule)}
            </p>
            {today && (
              <p className="app-store__today">
                <Clock size={14} aria-hidden /> Hoje: {today}
              </p>
            )}
          </div>
        </div>
        {menu.appearance.headline && (
          <p className="app-store__headline">{menu.appearance.headline}</p>
        )}
        {about && <p className="app-store__about cm-selectable">{about}</p>}
      </section>
      <nav className="app-quick" aria-label="Ações da loja">
        {map && <QuickAction href={map} icon={<Navigation />} label="Como chegar" />}
        {wa && <QuickAction href={wa} icon={<MessageCircle />} label="WhatsApp" />}
        {info?.instagram && (
          <QuickAction
            href={`https://instagram.com/${encodeURIComponent(info.instagram)}`}
            icon={<Instagram />}
            label="Instagram"
          />
        )}
        <QuickAction onClick={share} icon={<Share2 />} label="Compartilhar" />
      </nav>
      {failed && <LoadFailed />}
      <section className="app-sec">
        <h2 className="app-sec__title">Como pedir</h2>
        <ul className="app-list">
          {s.acceptsDelivery && (
            <li className="app-row">
              <span className="app-row__ic">
                <Bike />
              </span>
              <span className="app-row__text">
                <strong>Entrega</strong>
                <small>
                  {s.deliveryZones
                    ? 'Taxa conforme o bairro'
                    : toCents(s.deliveryFee)
                      ? `Taxa de ${brl(s.deliveryFee)}`
                      : 'Entrega grátis'}
                  {toCents(s.minOrder) > 0 && ` · Pedido mínimo ${brl(s.minOrder)}`}
                </small>
              </span>
            </li>
          )}
          {s.acceptsPickup && (
            <li className="app-row">
              <span className="app-row__ic">
                <Store />
              </span>
              <span className="app-row__text">
                <strong>Retirada</strong>
                <small>Peça pelo app e busque no balcão quando ficar pronto</small>
              </span>
            </li>
          )}
          {s.tables && (
            <li className="app-row">
              <span className="app-row__ic">
                <QrCode />
              </span>
              <span className="app-row__text">
                <strong>Na mesa</strong>
                <small>No restaurante, leia o QR Code da mesa e peça pelo celular</small>
              </span>
            </li>
          )}
          <li className="app-row">
            <span className="app-row__ic">
              <Clock />
            </span>
            <span className="app-row__text">
              <strong>Tempo de preparo{s.acceptsDelivery ? ' e entrega' : ''}</strong>
              <small>
                {s.etaMin}–{s.etaMax} min
              </small>
            </span>
          </li>
        </ul>
      </section>
      <section className="app-sec">
        <h2 className="app-sec__title">Formas de pagamento</h2>
        <Link to="/pedir/conta/pagamento" className="app-card app-pays">
          <span className="app-pays__list">
            {app.map((w) => (
              <span key={w.title} className="app-chip" data-app>
                {w.icon}
                {w.title}
              </span>
            ))}
            {later.map((o) => (
              <span key={o.value} className="app-chip">
                {PAY_ICON[o.value]}
                {o.label}
              </span>
            ))}
          </span>
          <small className="app-pays__hint">
            {app.length ? `Pague pelo app agora, ou ${at}` : `Pague ${at}`}
          </small>
        </Link>
      </section>
      {address && (
        <section className="app-sec">
          <h2 className="app-sec__title">Endereço</h2>
          <div className="app-card app-addr">
            <MapPin size={20} aria-hidden className="app-addr__ic" />
            <p className="cm-selectable">{address}</p>
            <div className="app-actions">
              {map && (
                <a className="app-btn" href={map} target="_blank" rel="noopener noreferrer">
                  <Navigation size={16} aria-hidden /> Abrir no mapa
                </a>
              )}
              <button type="button" className="app-btn" onClick={copyAddress}>
                <Copy size={16} aria-hidden /> Copiar
              </button>
            </div>
          </div>
        </section>
      )}
      <section className="app-sec">
        <h2 className="app-sec__title">Horário de funcionamento</h2>
        {!info ? (
          !failed && <Skeleton variant="list" />
        ) : info.hours.length ? (
          <div className="app-card">
            <HoursTable hours={info.hours} />
          </div>
        ) : (
          <p className="form-hint">
            A loja abre e fecha pelo caixa: a faixa do início mostra se está aberta agora.
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Indique um amigo

function ReferralSteps({ l }: { l: LoyaltyOn }) {
  const ref = l.referral!;
  const unit = (n: number) => loyaltyUnit(l, n);
  return (
    <ol className="ref-steps">
      <li>
        <Share2 size={18} aria-hidden />
        <span>Mande o seu código ou o link para um amigo.</span>
      </li>
      <li>
        <UserPlus size={18} aria-hidden />
        <span>Ele cria a conta aqui no app e digita o código antes do primeiro pedido.</span>
      </li>
      <li>
        <Gift size={18} aria-hidden />
        <span>
          Quando o primeiro pedido dele for concluído,{' '}
          {ref.points > 0 && (
            <>
              você ganha{' '}
              <strong>
                {int(ref.points)} {unit(ref.points)}
              </strong>
            </>
          )}
          {ref.points > 0 && ref.friendPoints > 0 && ' e '}
          {ref.friendPoints > 0 && (
            <>
              ele ganha{' '}
              <strong>
                {int(ref.friendPoints)} {unit(ref.friendPoints)}
              </strong>
            </>
          )}
          .
        </span>
      </li>
    </ol>
  );
}

/** Conta › Indique um amigo: o código para mandar, os convidados e o código de quem convidou. */
export function ReferralScreen() {
  const { account, menu, refreshLoyalty } = useStore();
  const l = useLoyalty();
  const toast = useToast();
  const me = account?.customer ?? null;
  const acc = l?.account ?? null;
  const [typed, setTyped] = useState(() => pendingInvite() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = acc?.referralCode ?? null;
  const link = code ? `${window.location.origin}/pedir?convite=${encodeURIComponent(code)}` : '';
  const unit = (n: number) => (l ? loyaltyUnit(l, n) : 'pontos');

  async function share() {
    if (!code) return;
    const text = `Peça na ${menu.restaurant.name} pelo app e use o meu código ${code} no primeiro pedido.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: menu.restaurant.name, text, url: link });
        return;
      }
    } catch (e) {
      // A pessoa fechou o compartilhar: nada a fazer.
      if ((e as Error).name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${link}`);
      toast('Convite copiado. É só colar na conversa', 'success');
    } catch {
      toast(`Seu código: ${code}`);
    }
  }
  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast(`Código ${code} copiado`, 'success');
    } catch {
      toast(`Seu código: ${code}`);
    }
  }
  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const c = typed.trim().toUpperCase();
    if (c.length < 4) return setError('Digite o código que o seu amigo mandou');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ok: true; friendPoints: number }>('/store/account/referral', {
        method: 'POST',
        json: { code: c },
      });
      clearInvite();
      setTyped('');
      toast(
        r.friendPoints > 0
          ? `Código aceito. Seus ${int(r.friendPoints)} ${unit(r.friendPoints)} entram no primeiro pedido concluído`
          : 'Código aceito',
        'success',
      );
      void refreshLoyalty();
    } catch (err) {
      setError((err as ApiError).message || 'Não deu para usar o código agora');
    } finally {
      setBusy(false);
    }
  }

  if (!l || !l.referral)
    return (
      <div className="sf-wrap sf-page app-page">
        <ScreenHeader title="Indique um amigo" back="/pedir/conta" />
        <div className="empty-state">
          <Users size={40} className="app-empty-ic" aria-hidden />
          <strong>Convite de amigos desligado</strong>
          <p>A loja não está com o convite de amigos agora.</p>
        </div>
      </div>
    );
  const friends = acc?.friends ?? { invited: 0, paid: 0 };
  return (
    <div className="sf-wrap sf-page app-page ref">
      <ScreenHeader title="Indique um amigo" back="/pedir/conta" />
      <section className="ref-hero">
        <LoyaltyArt live className="ref-hero__art" />
        <h2>
          {l.referral.points > 0
            ? `Ganhe ${int(l.referral.points)} ${unit(l.referral.points)} por amigo`
            : `Seu amigo ganha ${int(l.referral.friendPoints)} ${unit(l.referral.friendPoints)}`}
        </h2>
        <p>Chame quem ainda não pede aqui. Quando o primeiro pedido dele for concluído, vale.</p>
      </section>

      {!me ? (
        <Link className="cpns__login" to="/pedir/conta">
          <UserPlus size={18} aria-hidden />
          <span>
            <strong>Entre na sua conta para pegar o seu código</strong>
            <small>O convite fica ligado à sua conta.</small>
          </span>
        </Link>
      ) : (
        <>
          {code && (
            <section className="ref-code">
              <small>Seu código</small>
              <button
                type="button"
                className="ref-code__value cm-selectable"
                onClick={copy}
                aria-label={`Copiar o código ${code}`}
              >
                {code} <Copy size={18} aria-hidden />
              </button>
              <button type="button" className="cta ref-code__share" onClick={share}>
                <Send size={18} aria-hidden /> Mandar convite
              </button>
            </section>
          )}
          <dl className="ref-stats">
            <div>
              <dt>Convidados</dt>
              <dd>{int(friends.invited)}</dd>
            </div>
            <div>
              <dt>Já pediram</dt>
              <dd>{int(friends.paid)}</dd>
            </div>
            <div>
              <dt>Você ganhou</dt>
              <dd>
                {int(friends.paid * l.referral.points)} <small>{unit(2)}</small>
              </dd>
            </div>
          </dl>
        </>
      )}

      <section className="app-sec">
        <h2 className="app-sec__title">Como funciona</h2>
        <ReferralSteps l={l} />
      </section>

      {me && !acc?.referred && (
        <section className="app-sec">
          <h2 className="app-sec__title">Foi convidado por alguém?</h2>
          <form className="cpns__form" onSubmit={sendCode}>
            <label className="cpns__field">
              <TicketPercent size={18} aria-hidden />
              <input
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value.toUpperCase());
                  setError(null);
                }}
                placeholder="Código do amigo"
                aria-label="Código de quem convidou você"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={12}
              />
            </label>
            <button type="submit" className="cpns__apply" disabled={busy || !typed.trim()}>
              {busy ? 'Enviando…' : 'Usar'}
            </button>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
      {me && acc?.referred && (
        <p className="form-hint app-note">
          <Check size={16} aria-hidden /> Você já usou o código de um amigo.
        </p>
      )}
      <p className="form-hint app-note">{loyaltyRule(l)}.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Ajuda (perguntas frequentes)

/** Perguntas que valem para qualquer loja, montadas com os dados dela (sem FAQ cadastrado). */
function defaultFaq(
  menu: PublicMenu,
  l: LoyaltyOn | null,
  coupons: boolean,
  chat: boolean,
): StoreFaq[] {
  const s = menu.store;
  const out: StoreFaq[] = [];
  const add = (section: string, question: string, answer: string) =>
    out.push({ id: `d${out.length}`, section, question, answer });
  const talk = chat ? 'pela Conversa, na aba Conta' : 'pelo WhatsApp da loja';
  add(
    'Pedidos',
    'Como faço um pedido?',
    'Escolha os itens no cardápio e toque em Adicionar. Na sacola, escolha entrega ou retirada, confira o endereço e a forma de pagamento e toque em Fazer pedido.',
  );
  add(
    'Pedidos',
    'Como acompanho o meu pedido?',
    'Na aba Pedidos você vê cada passo: recebido, em preparo, a caminho e entregue. A tela atualiza sozinha.',
  );
  add(
    'Pedidos',
    'Posso mudar ou cancelar o pedido?',
    `Fale com a loja o quanto antes, ${talk}. Depois que o pedido entra em preparo, a mudança depende da cozinha.`,
  );
  if (s.acceptsDelivery) {
    add(
      'Entrega e retirada',
      'Quanto custa a entrega?',
      s.deliveryZones
        ? 'A taxa depende do bairro: ela aparece na sacola assim que você marca o endereço.'
        : toCents(s.deliveryFee)
          ? `A entrega custa ${brl(s.deliveryFee)}.`
          : 'A entrega é grátis.',
    );
    add(
      'Entrega e retirada',
      'Quanto tempo demora?',
      `Em média de ${s.etaMin} a ${s.etaMax} minutos, conforme o movimento da loja.`,
    );
  }
  add(
    'Entrega e retirada',
    'Posso retirar na loja?',
    s.acceptsPickup
      ? 'Pode. Escolha Retirada na sacola e busque no balcão quando o pedido ficar pronto: o app avisa.'
      : 'Por enquanto a loja faz só a entrega.',
  );
  const { app, at, later } = payWays(menu);
  add(
    'Pagamento',
    'Quais as formas de pagamento?',
    [
      ...app.map((w) => w.title),
      `${later.map((o) => o.label.toLowerCase()).join(', ')} ${at}`,
    ].join('; ') + '.',
  );
  if (l) {
    add(
      'Pontos',
      `Como ganho ${loyaltyUnit(l)}?`,
      `${loyaltyRule(l)}. Eles entram na sua conta quando o pedido é concluído.`,
    );
    add(
      'Pontos',
      `Como uso os meus ${loyaltyUnit(l)}?`,
      'No app, escolha a recompensa na finalização do pedido. Na loja, mostre o PIN da tela de Pontos no balcão.',
    );
    if (l.expiryDays)
      add(
        'Pontos',
        `Os ${loyaltyUnit(l)} vencem?`,
        `Vencem ${l.expiryDays} dias depois do último pedido. Cada pedido novo renova o prazo.`,
      );
  }
  if (coupons)
    add(
      'Cupons',
      'Como uso um cupom?',
      'Na aba Cupons toque em Usar no pedido, ou digite o código na finalização. Vale um cupom por pedido, e ele não se junta com a troca de pontos.',
    );
  add(
    'Conta',
    'Esqueci a minha senha',
    'Na tela de entrar, toque em Esqueci a senha. O código para criar outra chega no seu WhatsApp ou e-mail.',
  );
  add(
    'Conta',
    'Como baixo ou apago os meus dados?',
    'Em Conta › Privacidade e dados você baixa uma cópia de tudo ou pede para apagar a conta.',
  );
  return out;
}

/** Conta › Ajuda: perguntas frequentes por seção (as da loja ou as de sempre) e o contato. */
export function HelpScreen() {
  const { menu, rules } = useStore();
  const chat = useStoreChat();
  const l = useLoyalty();
  const { info, failed } = useAppInfo();
  const [open, setOpen] = useState<string | null>(null);
  const faq = useMemo(
    () =>
      info?.faq.length
        ? info.faq
        : info || failed
          ? defaultFaq(menu, l, rules.coupons, chat.enabled)
          : null,
    [info, failed, menu, l, rules.coupons, chat.enabled],
  );
  const sections = useMemo(() => {
    const m = new Map<string, StoreFaq[]>();
    for (const f of faq ?? []) m.set(f.section, [...(m.get(f.section) ?? []), f]);
    return [...m];
  }, [faq]);
  const wa = waLink(info?.whatsapp ?? menu.restaurant.whatsapp);
  return (
    <div className="sf-wrap sf-page app-page">
      <ScreenHeader title="Ajuda" back="/pedir/conta" />
      <h2 className="app-big">Perguntas frequentes</h2>
      {!faq ? (
        <Skeleton variant="list" />
      ) : (
        sections.map(([section, items]) => (
          <section key={section} className="app-sec">
            <h3 className="app-sec__title">{section}</h3>
            <div className="faq">
              {items.map((f) => {
                const on = open === f.id;
                return (
                  <div key={f.id} className="faq__item" data-open={on || undefined}>
                    <button
                      type="button"
                      className="faq__q"
                      aria-expanded={on}
                      aria-controls={`faq-${f.id}`}
                      onClick={() => setOpen(on ? null : f.id)}
                    >
                      <span>{f.question}</span>
                      <ChevronDown size={18} aria-hidden className="faq__chev" />
                    </button>
                    {on && (
                      <p id={`faq-${f.id}`} className="faq__a cm-selectable">
                        {f.answer}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      {(chat.enabled || wa) && (
        <section className="app-sec app-help">
          <h2 className="app-sec__title">Ainda precisa de ajuda?</h2>
          <div className="app-actions">
            {chat.enabled && (
              <Link className="app-btn" to="/pedir/conversa">
                <MessageCircle size={16} aria-hidden /> Conversar com a loja
              </Link>
            )}
            {wa && (
              <a className="app-btn" href={wa} target="_blank" rel="noopener noreferrer">
                <Smartphone size={16} aria-hidden /> WhatsApp
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Sobre

/** Conta › Sobre: quem é a loja (texto, Instagram, endereço) e o app. */
export function AboutScreen() {
  const { menu, account } = useStore();
  const { info, failed } = useAppInfo();
  const r = menu.restaurant;
  const about = info?.about ?? r.about;
  const map = info ? mapLink(info, r.name) : null;
  return (
    <div className="sf-wrap sf-page app-page">
      <ScreenHeader title="Sobre" back="/pedir/conta" />
      <section className="app-about">
        {r.coverUrl && <Photo src={r.coverUrl} alt="" className="app-about__cover" />}
        <StoreMark src={r.logoUrl} size={72} className="app-about__logo" />
        <h2>{r.name}</h2>
        {menu.appearance.headline && (
          <p className="app-about__headline">{menu.appearance.headline}</p>
        )}
      </section>
      {failed && <LoadFailed />}
      {!info && !failed ? (
        <Skeleton variant="detail" />
      ) : (
        <>
          {about && <p className="app-about__text cm-selectable">{about}</p>}
          <ul className="app-list">
            {info?.instagram && (
              <li>
                <a
                  className="app-row app-row--link"
                  href={`https://instagram.com/${encodeURIComponent(info.instagram)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="app-row__ic">
                    <Instagram />
                  </span>
                  <span className="app-row__text">
                    <strong>Instagram</strong>
                    <small>@{info.instagram}</small>
                  </span>
                  <ExternalLink size={16} aria-hidden className="app-row__go" />
                </a>
              </li>
            )}
            {(info?.address ?? r.address) && (
              <li>
                {map ? (
                  <a
                    className="app-row app-row--link"
                    href={map}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="app-row__ic">
                      <MapPin />
                    </span>
                    <span className="app-row__text">
                      <strong>Endereço</strong>
                      <small>{info?.address ?? r.address}</small>
                    </span>
                    <ExternalLink size={16} aria-hidden className="app-row__go" />
                  </a>
                ) : (
                  <span className="app-row">
                    <span className="app-row__ic">
                      <MapPin />
                    </span>
                    <span className="app-row__text">
                      <strong>Endereço</strong>
                      <small>{info?.address ?? r.address}</small>
                    </span>
                  </span>
                )}
              </li>
            )}
            {account?.customer && (
              <li>
                <Link className="app-row app-row--link" to="/pedir/conta/privacidade">
                  <span className="app-row__ic">
                    <ShieldCheck />
                  </span>
                  <span className="app-row__text">
                    <strong>Privacidade e dados</strong>
                    <small>Baixe ou apague os seus dados</small>
                  </span>
                </Link>
              </li>
            )}
          </ul>
        </>
      )}
      <p className="store-foot__brand sf-note">
        <Mascot size={20} badge /> Pedidos online por <strong>Comandou</strong> · versão{' '}
        {__APP_VERSION__}
      </p>
    </div>
  );
}
