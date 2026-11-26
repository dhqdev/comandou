import {
  Bell,
  CalendarDays,
  CreditCard,
  Download,
  ChevronRight,
  Info,
  LifeBuoy,
  Store,
  TicketPercent,
  UserPlus,
  Eye,
  EyeOff,
  Gift,
  HandPlatter,
  Loader2,
  LockKeyhole,
  Smartphone,
  Heart,
  KeyRound,
  LogOut,
  MapPin,
  MessageCircle,
  Moon,
  Pencil,
  Plus,
  ReceiptText,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  CSSProperties,
  FormEvent,
  lazy,
  MouseEvent,
  ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { BIRTHDAY_MONTHS, scheduleText } from '@comandou/shared';
import { Link, useLocation, useNavigate } from 'react-router';
import { clickPoint, Mascot, switchTheme, useTheme, useToast, Skeleton } from '../../design-system';
import { SlideTabs } from '../../features/SlideTabs';
import { api, ApiError } from '../../lib/api';
import { maskDocument, onlyDigits } from '../../lib/br-format';
import { datedName, saveJson } from '../../lib/download';
import { AddressArt, LoyaltyArt } from './art';
import { Photo } from './ui';
import { ProfilePhoto } from './ProfilePhoto';
import { useStoreChat } from './chat';
import { useStore } from './context';
import { AddressFields, addressPayload } from './AddressFields';
import { movedAddress } from './AddressEdit';
import type { PinnedQuote } from './store';
import { nextGoal, useLoyalty } from './LoyaltyScreens';
import {
  nextAccountReservation,
  useAccountReservations,
  useReservationConfig,
} from './ReservationScreens';
import {
  AccountOrder,
  AccountState,
  addressLine,
  CustomerAccount,
  fmtPhone,
  LoyaltyOn,
  loyaltyRule,
  loyaltyUnit,
  maskCep,
  maskPhone,
  PAYMENT_OPTIONS,
  pendingInvite,
  SavedAddress,
  seenNotices,
  STEP_LABEL,
} from './store';
import { Field, ScreenHeader, Switch } from './ui';
import { birthdayForm, readBirthday, type BirthdayForm } from '../../lib/birthday';

function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 0 ? 'Sem conexão. Tente de novo.' : err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

/** Quem veio da finalização do pedido (sacola) e precisa voltar para ela depois de entrar. */
type AuthBack = { back?: 'checkout' } | null;

/** Depois de entrar: volta para a finalização com a sacola como estava, ou para a tela anterior. */
function useAfterLogin() {
  const navigate = useNavigate();
  const back = (useLocation().state as AuthBack)?.back;
  return {
    back,
    done: (fallback: () => void) =>
      back === 'checkout'
        ? navigate('/pedir/sacola', { replace: true, state: { checkout: true } })
        : fallback(),
  };
}

/** Entrar ou criar conta (telefone + senha). */
function AuthForms() {
  const { menu, setAccount, customer, rules, table } = useStore();
  const navigate = useNavigate();
  const after = useAfterLogin();
  const toast = useToast();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({
    name: customer.customerName,
    phone: customer.customerPhone,
    email: '',
    cpf: customer.customerCpf ?? '',
    password: '',
    optIn: false,
  });
  const [showPass, setShowPass] = useState(false);
  // Com o WhatsApp da loja ligado, a conta nova só nasce com o código que chegou no celular.
  const [code, setCode] = useState<{ phone: string; value: string } | null>(null);
  const { busy, error, run, setError } = useAsync();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({
      ...f,
      [k]:
        k === 'phone'
          ? maskPhone(e.target.value)
          : k === 'cpf'
            ? maskDocument(e.target.value)
            : e.target.value,
    }));
  const codeStep = mode === 'signup' && code !== null && code.phone === form.phone;

  async function askCode() {
    const r = await run(() =>
      api<{ channel: 'whatsapp' | 'none' }>('/store/account/signup/code', {
        method: 'POST',
        json: { phone: form.phone },
      }),
    );
    if (!r) return false;
    if (r.channel === 'whatsapp') {
      setCode({ phone: form.phone, value: '' });
      toast('Enviamos um código para o seu WhatsApp.', 'success');
      return false;
    }
    return true;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'signup' && !codeStep && !(await askCode())) return;
    const acc = await run(() =>
      api<AccountState>(`/store/account/${mode}`, {
        method: 'POST',
        json:
          mode === 'login'
            ? { phone: form.phone, password: form.password }
            : {
                name: form.name.trim(),
                phone: form.phone,
                email: form.email.trim() || undefined,
                cpf: onlyDigits(form.cpf) || undefined,
                password: form.password,
                marketingOptIn: form.optIn,
                code: codeStep ? code!.value : undefined,
              },
      }),
    );
    if (!acc) return;
    setAccount(acc);
    toast(
      mode === 'login'
        ? `Bem-vindo de volta, ${acc.customer!.name.split(' ')[0]}!`
        : 'Conta criada!',
      'success',
    );
    // Quem veio da sacola volta para finalizar, com tudo o que já tinha escolhido.
    after.done(() => {
      if (window.history.state?.idx > 0) navigate(-1);
    });
  }

  const r = menu.restaurant;
  const loyaltyOn = !!useLoyalty();
  return (
    <div className="auth">
      <div className="auth__hero">
        <span className="auth__logo">
          <Photo src={r.logoUrl} alt={r.name} eager />
        </span>
        <h1>{mode === 'login' ? 'Entre na sua conta' : 'Crie sua conta'}</h1>
        <p>
          {after.back === 'checkout' ? (
            'Entre para continuar o seu pedido.'
          ) : table ? (
            <>
              e peça para a <strong>Mesa {table.label}</strong>
            </>
          ) : (
            <>
              em <strong>{r.name}</strong>
            </>
          )}
        </p>
      </div>
      <div className="auth__card">
        <SlideTabs
          label="Entrar ou criar conta"
          value={mode}
          onChange={(v) => {
            setMode(v);
            setError(null);
          }}
          tabs={[
            { value: 'login', label: 'Entrar' },
            { value: 'signup', label: 'Criar conta' },
          ]}
        />
        <form className="auth__form" onSubmit={submit} key={mode}>
          {mode === 'signup' && (
            <Field label="Seu nome">
              <input
                autoComplete="name"
                required
                maxLength={80}
                value={form.name}
                onChange={set('name')}
              />
            </Field>
          )}
          <Field label="Celular (WhatsApp)">
            <span className="auth__input">
              <Smartphone size={18} aria-hidden />
              <input
                autoComplete="tel"
                inputMode="tel"
                required
                placeholder="(11) 98888-7777"
                value={form.phone}
                onChange={set('phone')}
              />
            </span>
          </Field>
          {mode === 'signup' && (
            <Field label="E-mail (opcional)">
              <input
                type="email"
                autoComplete="email"
                maxLength={254}
                value={form.email}
                onChange={set('email')}
              />
            </Field>
          )}
          {mode === 'signup' && (
            <Field label="CPF (opcional)" hint="Já vai na nota quando você pedir pela mesa.">
              <input
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                maxLength={18}
                value={form.cpf}
                onChange={set('cpf')}
              />
            </Field>
          )}
          <Field
            label="Senha"
            hint={mode === 'signup' ? 'Pelo menos 8 caracteres, sem senha óbvia.' : undefined}
          >
            <span className="auth__input">
              <LockKeyhole size={18} aria-hidden />
              <input
                type={showPass ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'signup' ? 8 : 1}
                value={form.password}
                onChange={set('password')}
              />
              <button
                type="button"
                className="auth__eye"
                aria-label={showPass ? 'Esconder senha' : 'Mostrar senha'}
                aria-pressed={showPass}
                onClick={() => setShowPass((v) => !v)}
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </Field>
          {mode === 'signup' && (
            <label className="ck-toggle">
              <span>Quero receber promoções da loja</span>
              <Switch
                label="Receber promoções"
                checked={form.optIn}
                onChange={(v) => setForm((f) => ({ ...f, optIn: v }))}
              />
            </label>
          )}
          {codeStep && (
            <Field
              label="Código do WhatsApp"
              hint="Mandamos 6 números para o seu WhatsApp. Vale por alguns minutos."
            >
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                value={code!.value}
                onChange={(e) =>
                  setCode((c) => c && { ...c, value: e.target.value.replace(/\D/g, '') })
                }
              />
            </Field>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="cta auth__go" disabled={busy} aria-busy={busy || undefined}>
            {busy ? (
              <Loader2 size={20} className="ck-send__spin" aria-label="Aguarde" />
            ) : mode === 'login' ? (
              'Entrar'
            ) : (
              'Criar minha conta'
            )}
          </button>
          {codeStep && (
            <p className="auth__forgot">
              <button type="button" disabled={busy} onClick={() => void askCode()}>
                Mandar outro código
              </button>
            </p>
          )}
          {mode === 'login' && (
            <p className="auth__forgot">
              <Link to="/pedir/conta/esqueci-senha" state={{ phone: form.phone, back: after.back }}>
                Esqueci minha senha
              </Link>
            </p>
          )}
        </form>
      </div>
      <ul className="auth__perks" aria-label="Com a conta">
        <li>
          <span className="auth__perk-icon">
            <ReceiptText size={17} aria-hidden />
          </span>
          Acompanhe os pedidos
        </li>
        {rules.delivery ? (
          <li>
            <span className="auth__perk-icon">
              <MapPin size={17} aria-hidden />
            </span>
            Endereços salvos
          </li>
        ) : (
          <li>
            <span className="auth__perk-icon">
              <HandPlatter size={17} aria-hidden />
            </span>
            Pedidos da mesa no seu nome
          </li>
        )}
        {/* Na mesa não há favoritos nem fidelidade (store-rules.ts). */}
        {(loyaltyOn || rules.favorites) && (
          <li>
            <span className="auth__perk-icon">
              {loyaltyOn ? <Gift size={17} aria-hidden /> : <Heart size={17} aria-hidden />}
            </span>
            {loyaltyOn ? 'Junte pontos' : 'Seus favoritos'}
          </li>
        )}
      </ul>
    </div>
  );
}

/** Até três fotos sobrepostas no canto do bloco (último pedido, favoritos). */
function PhotoStack({ photos }: { photos: (string | null | undefined)[] }) {
  const list = photos.filter((p): p is string => !!p).slice(0, 3);
  if (!list.length) return null;
  return (
    <span className="acct-stack" aria-hidden>
      {list.map((src, k) => (
        <img key={k} src={src} alt="" loading="lazy" decoding="async" />
      ))}
    </span>
  );
}

/**
 * Bloco da conta (quadrado): ícone em cima (fotos ou o número de novidades no canto), nome e uma
 * linha curta embaixo. Afunda ao tocar e volta com a mola; `--i` escalona a entrada.
 */
function Tile({
  to,
  onClick,
  icon,
  label,
  hint,
  photos,
  count,
  tone,
  i,
}: {
  to?: string;
  onClick?(): void;
  icon: ReactNode;
  label: string;
  hint?: string;
  photos?: (string | null | undefined)[];
  count?: number;
  tone?: 'danger';
  i: number;
}) {
  const inner = (
    <>
      <span className="acct-tile__top">
        <span className="acct-tile__icon">{icon}</span>
        {photos && <PhotoStack photos={photos} />}
        {!!count && (
          <span className="acct-tile__count" aria-label={`${count} novo(s)`}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className="acct-tile__text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </>
  );
  const style = { '--i': i } as CSSProperties;
  return to ? (
    <Link className="acct-tile" to={to} style={style} data-tone={tone}>
      {inner}
    </Link>
  ) : (
    <button type="button" className="acct-tile" style={style} data-tone={tone} onClick={onClick}>
      {inner}
    </button>
  );
}

/** Linha da lista de ajustes (conversa, tema, senha): ícone, nome e, à direita, o estado. */
function Row({
  to,
  icon,
  label,
  count,
  switchOn,
  onClick,
}: {
  to?: string;
  icon: ReactNode;
  label: string;
  count?: number;
  switchOn?: boolean;
  onClick?(e: MouseEvent<HTMLButtonElement>): void;
}) {
  const inner = (
    <>
      <span className="acct-row__icon">{icon}</span>
      <span className="acct-row__label">{label}</span>
      {!!count && (
        <span className="acct-row__count" aria-label={`${count} nova(s)`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
      {switchOn === undefined ? (
        <ChevronRight className="acct-row__chev" aria-hidden />
      ) : (
        <span className="acct-row__switch" aria-hidden />
      )}
    </>
  );
  return to ? (
    <Link className="acct-row" to={to}>
      {inner}
    </Link>
  ) : (
    <button
      type="button"
      className="acct-row"
      onClick={onClick}
      {...(switchOn !== undefined && { role: 'switch', 'aria-checked': switchOn })}
    >
      {inner}
    </button>
  );
}

/** Pedido em andamento há pouco (o mais recente): aparece no topo da conta. */
const LIVE_MS = 12 * 3600_000;
function liveOrder(orders: AccountOrder[] | null) {
  const o = orders?.[0];
  if (!o || o.step === 'completed' || o.step === 'cancelled') return null;
  return Date.now() - new Date(o.createdAt).getTime() < LIVE_MS ? o : null;
}

/** Pedidos da conta, uma vez ao abrir a tela (sem repetir: a aba Pedidos é que acompanha). */
function useAccountOrders(on: boolean) {
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    api<AccountOrder[]>('/store/account/orders')
      .then((o) => live && setOrders(o))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [on]);
  return orders;
}

/** Cartão largo da fidelidade: saldo grande e a barra até a próxima recompensa. */
function LoyaltyTile({ l, i }: { l: LoyaltyOn; i: number }) {
  const acc = l.account;
  const balance = acc?.balance ?? 0;
  const goal = nextGoal(l, balance);
  const pct = goal ? Math.min(100, Math.round((balance / goal.cost) * 100)) : 100;
  return (
    <Link
      className="acct-tile acct-tile--wide acct-loy"
      to="/pedir/fidelidade"
      style={{ '--i': i } as CSSProperties}
    >
      <span className="acct-tile__top">
        <span className="acct-tile__icon">
          <Gift />
        </span>
        <span className="acct-loy__label">Fidelidade</span>
        <ChevronRight className="acct-row__chev" aria-hidden />
      </span>
      <LoyaltyArt live className="acct-loy__art" />
      <span className="acct-loy__balance">
        {balance.toLocaleString('pt-BR')} <small>{loyaltyUnit(l, balance)}</small>
      </span>
      {l.rewards.length > 0 && (
        <span className="acct-loy__bar" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      <small className="acct-loy__hint">
        {!acc
          ? loyaltyRule(l)
          : goal
            ? `Faltam ${(goal.cost - balance).toLocaleString('pt-BR')} para ${goal.name}`
            : l.rewards.length
              ? 'Você já pode trocar uma recompensa'
              : loyaltyRule(l)}
      </small>
    </Link>
  );
}

/**
 * Aba "Conta": formulário de entrada ou o perfil. Foto e nome no topo, o pedido em andamento, a
 * fidelidade e cada tela num quadrado (Minha conta, Notificações, Endereços, Pagamento, Cupons,
 * Indique um amigo, Favoritos, Reservas, Conversa, A loja, Ajuda, Sobre e Sair); tema, senha e
 * privacidade numa lista curta embaixo. Sem a conta, os quadrados que não pedem login seguem.
 */
export function AccountScreen() {
  const { account, logout, menu, rules, favs, customer, coupon } = useStore();
  const chat = useStoreChat();
  const loyalty = useLoyalty();
  const [theme] = useTheme();
  const toast = useToast();
  const me = account?.customer ?? null;
  const orders = useAccountOrders(!!me);
  const reserveCfg = useReservationConfig();
  const reservations = useAccountReservations(!!me && rules.reservations);
  const nextReservation = nextAccountReservation(reservations);
  // Avisos da loja que este aparelho ainda não abriu (número no quadrado Notificações).
  const notices = menu.notices;
  const unseen = useMemo(() => {
    const seen = new Set(seenNotices());
    return (notices ?? []).filter((id) => !seen.has(id)).length;
  }, [notices]);
  const [invite] = useState(pendingInvite);
  if (!account)
    return (
      <div className="sf-wrap sf-page">
        <Skeleton />
      </div>
    );
  const themeRow = menu.appearance.theme === 'auto';
  const dark = theme === 'dark';
  const live = liveOrder(orders);
  const home = account.addresses.find((a) => a.isDefault) ?? account.addresses[0];
  const referral = loyalty?.referral ?? null;
  const unit = (n: number) => (loyalty ? loyaltyUnit(loyalty, n) : 'pontos');
  const payLabel = PAYMENT_OPTIONS.find((o) => o.value === customer.paymentMethod)?.label;
  // Ordem de entrada de cada parte.
  let n = 0;
  const at = (i: number) => ({ '--i': i }) as CSSProperties;
  return (
    <div className="sf-wrap sf-page acct">
      {!me ? (
        <>
          <AuthForms />
          {invite && referral && (
            <p className="acct-invite" style={at(n++)}>
              <UserPlus size={18} aria-hidden />
              <span>
                Você recebeu o convite <strong>{invite}</strong>. Crie a conta e use o código em
                Indique um amigo
                {referral.friendPoints > 0 &&
                  ` para ganhar ${referral.friendPoints.toLocaleString('pt-BR')} ${unit(referral.friendPoints)}`}
                .
              </span>
            </p>
          )}
        </>
      ) : (
        <>
          <header className="acct__hero" style={at(n++)}>
            <ProfilePhoto me={me} size={96} />
            <h1>{me.name}</h1>
            <p>{fmtPhone(me.phone)}</p>
          </header>
          {live && (
            <Link
              className="acct-live"
              to={`/pedir/pedidos/${live.id}`}
              data-step={live.step}
              style={at(n++)}
            >
              <span className="acct-live__dot" aria-hidden />
              <span className="acct-live__text">
                <strong>Pedido #{live.number}</strong>
                <small>{STEP_LABEL[live.step]}</small>
              </span>
              <PhotoStack photos={live.items.map((it) => it.imageUrl)} />
              <ChevronRight className="acct-row__chev" aria-hidden />
            </Link>
          )}
        </>
      )}
      <nav className="acct__grid" aria-label="Minha conta">
        {me && loyalty && <LoyaltyTile l={loyalty} i={n++} />}
        {me && (
          <Tile
            i={n++}
            to="/pedir/conta/dados"
            icon={<UserRound />}
            label="Minha conta"
            hint={me.email ?? 'Nome, e-mail e foto'}
          />
        )}
        <Tile
          i={n++}
          to="/pedir/conta/notificacoes"
          icon={<Bell />}
          label="Notificações"
          hint={
            unseen ? `${unseen} ${unseen === 1 ? 'aviso novo' : 'avisos novos'}` : 'Avisos da loja'
          }
          count={unseen}
        />
        {/* Na mesa não há entrega: endereços ficam para o cardápio online. */}
        {me && rules.delivery && (
          <Tile
            i={n++}
            to="/pedir/conta/enderecos"
            icon={<MapPin />}
            label="Endereços"
            hint={home ? `${home.street}, ${home.number}` : 'Nenhum ainda'}
          />
        )}
        {rules.delivery && (
          <Tile
            i={n++}
            to="/pedir/conta/pagamento"
            icon={<CreditCard />}
            label="Pagamento"
            hint={payLabel ? `Preferida: ${payLabel}` : 'Formas de pagar'}
          />
        )}
        {rules.coupons && (
          <Tile
            i={n++}
            to="/pedir/cupons"
            icon={<TicketPercent />}
            label="Cupons"
            hint={
              coupon
                ? `${coupon} no próximo pedido`
                : menu.coupons
                  ? `${menu.coupons} na loja`
                  : 'Tem um código?'
            }
          />
        )}
        {rules.loyalty && referral && (
          <Tile
            i={n++}
            to="/pedir/conta/indique"
            icon={<UserPlus />}
            label="Indique um amigo"
            hint={
              referral.points > 0
                ? `Ganhe ${referral.points.toLocaleString('pt-BR')} ${unit(referral.points)}`
                : 'Convide quem ainda não pede'
            }
          />
        )}
        {rules.favorites && (
          <Tile
            i={n++}
            to="/pedir/favoritos"
            icon={<Heart />}
            label="Favoritos"
            hint={
              favs.length
                ? `${favs.length} ${favs.length === 1 ? 'item' : 'itens'}`
                : 'Nenhum ainda'
            }
          />
        )}
        {/* Reservas da conta: as do cardápio e as que a loja anotou no cadastro. */}
        {me && rules.reservations && (reserveCfg?.enabled || !!reservations?.length) && (
          <Tile
            i={n++}
            to="/pedir/reservas"
            icon={<CalendarDays />}
            label="Reservas"
            hint={
              nextReservation
                ? new Date(nextReservation.startsAt).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: nextReservation.timeZone,
                  })
                : 'Nenhuma por vir'
            }
          />
        )}
        {chat.enabled && (
          <Tile
            i={n++}
            to="/pedir/conversa"
            icon={<MessageCircle />}
            label="Conversa"
            hint={
              chat.unread
                ? `${chat.unread} ${chat.unread === 1 ? 'resposta nova' : 'respostas novas'}`
                : 'Fale com a loja'
            }
            count={chat.unread}
          />
        )}
        <Tile
          i={n++}
          to="/pedir/conta/loja"
          icon={<Store />}
          label="A loja"
          hint={scheduleText(menu.store.isOpen, menu.store.schedule)}
        />
        <Tile
          i={n++}
          to="/pedir/conta/ajuda"
          icon={<LifeBuoy />}
          label="Ajuda"
          hint="Perguntas frequentes"
        />
        <Tile
          i={n++}
          to="/pedir/conta/sobre"
          icon={<Info />}
          label="Sobre"
          hint={menu.restaurant.name}
        />
        {me && (
          <Tile
            i={n++}
            icon={<LogOut />}
            label="Sair"
            hint="Sair desta conta"
            tone="danger"
            onClick={async () => {
              await logout();
              toast('Você saiu da conta');
            }}
          />
        )}
      </nav>

      {(themeRow || me) && (
        <nav className="acct-list" aria-label="Ajustes" style={at(n++)}>
          {themeRow && (
            <Row
              icon={dark ? <Moon /> : <Sun />}
              label="Tema escuro"
              switchOn={dark}
              onClick={(e) => switchTheme(dark ? 'light' : 'dark', clickPoint(e, e.currentTarget))}
            />
          )}
          {me && <Row to="/pedir/conta/senha" icon={<KeyRound />} label="Trocar senha" />}
          {me && (
            <Row to="/pedir/conta/privacidade" icon={<ShieldCheck />} label="Privacidade e dados" />
          )}
        </nav>
      )}
      <p className="store-foot__brand sf-note">
        <Mascot size={20} badge /> Pedidos online por <strong>Comandou</strong>
      </p>
    </div>
  );
}

/** Garante a conta aberta; sem ela, manda para a tela de entrar. */
function useMe() {
  const { account } = useStore();
  const navigate = useNavigate();
  const out = !!account && !account.customer;
  useEffect(() => {
    if (out) navigate('/pedir/conta', { replace: true });
  }, [out, navigate]);
  return account?.customer ?? null;
}

export function ProfileScreen() {
  const me = useMe();
  // O formulário nasce com a conta já carregada (aberta direto pelo link, ela chega depois).
  return me ? <ProfileForm key={me.id} me={me} /> : null;
}

function ProfileForm({ me }: { me: CustomerAccount }) {
  const { setAccount } = useStore();
  const toast = useToast();
  const [form, setForm] = useState({
    name: me.name,
    email: me.email ?? '',
    cpf: maskDocument(me.cpf ?? ''),
    optIn: me.marketingOptIn,
    birthday: birthdayForm(me),
    greet: !me.birthdayOptOut,
  });
  const { busy, error, run } = useAsync();
  const bday = readBirthday(form.birthday);
  const setBday = (p: Partial<BirthdayForm>) =>
    setForm({ ...form, birthday: { ...form.birthday, ...p } });
  return (
    <div className="sf-wrap sf-page">
      <ScreenHeader title="Meus dados" back="/pedir/conta" />
      <div className="pphoto-row">
        <ProfilePhoto me={me} size={64} />
        <span>
          <strong>Foto do perfil</strong>
          <small>Toque para pôr uma foto ou escolher um avatar.</small>
        </span>
      </div>
      <form
        className="auth__form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (bday.error) return;
          const acc = await run(() =>
            api<AccountState>('/store/account', {
              method: 'PATCH',
              json: {
                name: form.name.trim(),
                email: form.email.trim() || null,
                cpf: onlyDigits(form.cpf) || null,
                marketingOptIn: form.optIn,
                birthday: bday.value,
                birthdayOptOut: !form.greet,
              },
            }),
          );
          if (acc) {
            setAccount(acc);
            toast('Dados salvos', 'success');
          }
        }}
      >
        <Field label="Nome">
          <input
            required
            maxLength={80}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Celular" hint="É o seu login. Para trocar, fale com o restaurante.">
          <input value={fmtPhone(me.phone)} disabled />
        </Field>
        <Field label="E-mail (opcional)">
          <input
            type="email"
            maxLength={254}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="CPF (opcional)" hint="Já vai na nota quando você pedir pela mesa.">
          <input
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            maxLength={18}
            value={form.cpf}
            onChange={(e) => setForm({ ...form, cpf: maskDocument(e.target.value) })}
          />
        </Field>
        <fieldset className="bday">
          <legend>Aniversário (opcional)</legend>
          <div className="bday__fields">
            <Field label="Dia">
              <input
                inputMode="numeric"
                maxLength={2}
                placeholder="DD"
                autoComplete="bday-day"
                value={form.birthday.day}
                onChange={(e) => setBday({ day: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label="Mês">
              <select
                autoComplete="bday-month"
                value={form.birthday.month}
                onChange={(e) => setBday({ month: e.target.value })}
              >
                <option value="">Mês</option>
                {BIRTHDAY_MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ano">
              <input
                inputMode="numeric"
                maxLength={4}
                placeholder="Opcional"
                autoComplete="bday-year"
                value={form.birthday.year}
                onChange={(e) => setBday({ year: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
          </div>
          {bday.error ? (
            <small className="form-error">{bday.error}</small>
          ) : (
            <small className="f__hint">No seu dia, a loja manda um parabéns pelo WhatsApp.</small>
          )}
        </fieldset>
        <label className="ck-toggle">
          <span>Receber parabéns no aniversário</span>
          <Switch
            label="Receber parabéns no aniversário"
            checked={form.greet}
            onChange={(v) => setForm({ ...form, greet: v })}
          />
        </label>
        <label className="ck-toggle">
          <span>Receber promoções da loja</span>
          <Switch
            label="Receber promoções"
            checked={form.optIn}
            onChange={(v) => setForm({ ...form, optIn: v })}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="cta" disabled={busy || !!bday.error}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </div>
  );
}

const AddressPin = lazy(() => import('./AddressPin'));

const EMPTY_ADDR = {
  label: '',
  cep: '',
  street: '',
  number: '',
  district: '',
  city: '',
  state: '',
  complement: '',
  reference: '',
};

export function AddressesScreen() {
  const { account, setAccount, menu } = useStore();
  const me = useMe();
  const toast = useToast();
  const [editing, setEditing] = useState<SavedAddress | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_ADDR);
  // Ponto confirmado no mapa para o endereço do formulário.
  const [pinned, setPinned] = useState<PinnedQuote | null>(null);
  const [pinAsk, setPinAsk] = useState(false);
  const { busy, error, run } = useAsync();
  if (!me || !account) return null;
  const list = account.addresses;

  async function reload() {
    const acc = await api<AccountState>('/store/account');
    setAccount(acc);
  }
  function edit(a: SavedAddress | 'new') {
    setEditing(a);
    setPinned(null);
    setPinAsk(false);
    setForm(
      a === 'new'
        ? EMPTY_ADDR
        : {
            label: a.label ?? '',
            cep: maskCep(a.cep ?? ''),
            city: a.city ?? '',
            state: a.state ?? '',
            street: a.street,
            number: a.number,
            district: a.district,
            complement: a.complement ?? '',
            reference: a.reference ?? '',
          },
    );
  }

  const typedOk = !!(form.street.trim() && form.number.trim() && form.district.trim());
  const moved = editing && editing !== 'new' ? movedAddress(editing, form) : true;
  const savedPoint =
    editing && editing !== 'new' && !moved && editing.lat && editing.lng
      ? { lat: Number(editing.lat), lng: Number(editing.lng) }
      : null;
  // Com áreas de entrega, o endereço só entra com o local confirmado no mapa.
  const needsPin = !!menu.store.deliveryZones && !savedPoint && !pinned;

  if (editing)
    return (
      <div className="sf-wrap sf-page">
        <header className="screen-head">
          <button
            type="button"
            className="iconbtn"
            aria-label="Voltar"
            onClick={() => setEditing(null)}
          >
            <ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <h1>{editing === 'new' ? 'Novo endereço' : 'Editar endereço'}</h1>
          <div />
        </header>
        <form
          className="auth__form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (needsPin) {
              setPinAsk(true);
              return;
            }
            const p = addressPayload(form);
            const body = {
              ...p,
              label: form.label.trim() || null,
              complement: p.complement ?? null,
              reference: p.reference ?? null,
              cep: p.cep ?? null,
              city: p.city ?? null,
              state: p.state ?? null,
              // Ponto confirmado no mapa; endereço mudou sem ponto novo: o antigo sai.
              ...(pinned
                ? { lat: pinned.lat, lng: pinned.lng }
                : editing !== 'new' && moved
                  ? { lat: null, lng: null }
                  : {}),
            };
            const ok = await run(() =>
              editing === 'new'
                ? api('/store/account/addresses', { method: 'POST', json: body })
                : api(`/store/account/addresses/${editing.id}`, { method: 'PATCH', json: body }),
            );
            if (ok) {
              await reload();
              setEditing(null);
              toast('Endereço salvo', 'success');
            }
          }}
        >
          <div className="label-chips" role="radiogroup" aria-label="Tipo">
            {['Casa', 'Trabalho', 'Outro'].map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={form.label === l}
                className="pill"
                onClick={() => setForm((f) => ({ ...f, label: l }))}
              >
                {l}
              </button>
            ))}
          </div>
          <AddressFields
            className="auth__form"
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            city={menu.restaurant.city}
            state={menu.restaurant.state}
          />
          <Suspense fallback={<p className="form-hint">Carregando o mapa…</p>}>
            <AddressPin
              key={editing === 'new' ? 'novo' : editing.id}
              address={typedOk ? form : null}
              saved={savedPoint}
              onChange={(v) => {
                setPinned(v);
                if (v) setPinAsk(false);
              }}
            />
          </Suspense>
          {pinAsk && needsPin && (
            <p className="form-error" role="alert">
              {typedOk
                ? 'Confirme o local no mapa antes de salvar.'
                : 'Preencha rua, número e bairro e confirme o local no mapa.'}
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
          <button className="cta" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar endereço'}
          </button>
        </form>
      </div>
    );

  return (
    <div className="sf-wrap sf-page">
      <ScreenHeader title="Endereços" back="/pedir/conta" />
      {list.length === 0 && (
        <div className="empty-state">
          <AddressArt live className="empty-state__art" />
          <strong>Nenhum endereço salvo</strong>
          <p>Salve sua casa ou trabalho e finalize os pedidos em segundos.</p>
        </div>
      )}
      <ul className="addr-list">
        {list.map((a, i) => (
          <li key={a.id} className="addr-card" style={{ ['--i' as string]: i }}>
            <MapPin size={18} className="addr-card__pin" />
            <div className="addr-card__text">
              <strong>
                {a.label || 'Endereço'}
                {a.isDefault && (
                  <span className="badge-chip badge-chip--inline">
                    <Star size={10} /> Padrão
                  </span>
                )}
              </strong>
              <span>{addressLine(a)}</span>
              {a.complement && <small>{a.complement}</small>}
            </div>
            <div className="addr-card__actions">
              {!a.isDefault && (
                <button
                  type="button"
                  className="iconbtn"
                  aria-label="Usar como padrão"
                  title="Usar como padrão"
                  onClick={async () => {
                    await run(() =>
                      api(`/store/account/addresses/${a.id}`, {
                        method: 'PATCH',
                        json: { isDefault: true },
                      }),
                    );
                    await reload();
                  }}
                >
                  <Star size={16} />
                </button>
              )}
              <button type="button" className="iconbtn" aria-label="Editar" onClick={() => edit(a)}>
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="iconbtn"
                aria-label="Apagar"
                onClick={async () => {
                  if (!window.confirm('Apagar este endereço?')) return;
                  await run(() => api(`/store/account/addresses/${a.id}`, { method: 'DELETE' }));
                  await reload();
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
      <button className="cta cta--ghost" onClick={() => edit('new')} disabled={list.length >= 10}>
        <Plus size={18} /> Adicionar endereço
      </button>
    </div>
  );
}

export function PasswordScreen() {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ next: '' });
  const { busy, error, run } = useAsync();
  if (!me) return null;
  return (
    <div className="sf-wrap sf-page">
      <ScreenHeader title="Trocar senha" back="/pedir/conta" />
      <form
        className="auth__form"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() =>
            api('/store/account/password', { method: 'POST', json: form }),
          );
          if (ok) {
            toast('Senha alterada. Outros aparelhos saíram da conta.', 'success');
            navigate('/pedir/conta', { replace: true });
          }
        }}
      >
        <Field label="Nova senha" hint="Pelo menos 8 caracteres, sem senha óbvia.">
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })}
          />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <button className="cta" disabled={busy}>
          {busy ? 'Salvando…' : 'Trocar senha'}
        </button>
      </form>
    </div>
  );
}

/**
 * Privacidade e dados (LGPD): baixar tudo o que a loja guarda da conta e apagar a conta. Apagar
 * pede a senha e a palavra APAGAR; pedidos e notas ficam na loja sem o nome (prazo fiscal).
 */
export function PrivacyScreen() {
  const me = useMe();
  const { logout } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const exp = useAsync();
  const del = useAsync();
  const [form, setForm] = useState({ password: '', confirm: '' });
  if (!me) return null;
  const ready = form.password.length > 0 && form.confirm.trim().toUpperCase() === 'APAGAR';
  return (
    <div className="sf-wrap sf-page privacy">
      <ScreenHeader title="Privacidade e dados" back="/pedir/conta" />
      <section className="privacy__block">
        <h2>Baixar meus dados</h2>
        <p>
          Um arquivo com o seu cadastro, endereços, pedidos, reservas, pontos, avaliações e
          conversas com a loja.
        </p>
        {exp.error && <p className="form-error">{exp.error}</p>}
        <button
          type="button"
          className="cta cta--inline cta--ghost privacy__btn"
          disabled={exp.busy}
          onClick={async () => {
            const data = await exp.run(() =>
              api<unknown>('/store/account/privacy/export', { method: 'POST' }),
            );
            if (data) {
              saveJson(data, datedName('meus-dados'));
              toast('Arquivo baixado', 'success');
            }
          }}
        >
          {exp.busy ? (
            <Loader2 size={20} className="ck-send__spin" aria-hidden />
          ) : (
            <Download aria-hidden />
          )}
          Baixar meus dados
        </button>
      </section>

      <section className="privacy__block privacy__block--danger">
        <h2>Apagar minha conta</h2>
        <p>
          Apaga o cadastro, os endereços, a foto, os pontos, as avaliações e as conversas. Não dá
          para desfazer.
        </p>
        <p className="privacy__note">
          Os pedidos continuam na loja, sem o seu nome e telefone, porque a lei fiscal pede que
          vendas e notas fiquem guardadas.
        </p>
        <form
          className="auth__form"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await del.run(() =>
              api('/store/account/privacy/erase', { method: 'POST', json: form }),
            );
            if (ok) {
              await logout();
              toast('Sua conta foi apagada', 'success');
              navigate('/pedir', { replace: true });
            }
          }}
        >
          <Field label="Sua senha">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Digite APAGAR para confirmar">
            <input
              autoComplete="off"
              autoCapitalize="characters"
              required
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          </Field>
          {del.error && <p className="form-error">{del.error}</p>}
          <button className="cta cta--danger" disabled={del.busy || !ready}>
            {del.busy ? 'Apagando…' : 'Apagar minha conta'}
          </button>
        </form>
      </section>
    </div>
  );
}

/** Esqueci minha senha: código pelo WhatsApp da loja ou pelo e-mail da conta, e nova senha. */
export function ForgotPasswordScreen() {
  const { menu, setAccount } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const prefill = (useLocation().state as { phone?: string } | null)?.phone ?? '';
  const after = useAfterLogin();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [form, setForm] = useState({ phone: prefill, code: '', password: '' });
  const [viaStore, setViaStore] = useState(false);
  const [sentTo, setSentTo] = useState<'whatsapp' | 'email'>('whatsapp');
  const { busy, error, run } = useAsync();
  const wa = menu.restaurant.whatsapp?.replace(/\D/g, '');

  async function ask(e: FormEvent) {
    e.preventDefault();
    const r = await run(() =>
      api<{ channel: 'whatsapp' | 'email' | 'restaurant' }>('/store/account/password/forgot', {
        method: 'POST',
        json: { phone: form.phone },
      }),
    );
    if (!r) return;
    setViaStore(r.channel === 'restaurant');
    if (r.channel !== 'restaurant') {
      setSentTo(r.channel);
      setStep('code');
      toast(
        r.channel === 'whatsapp'
          ? 'Código enviado para o seu WhatsApp'
          : 'Código enviado para o e-mail da sua conta',
        'success',
      );
    }
  }
  async function reset(e: FormEvent) {
    e.preventDefault();
    const acc = await run(() =>
      api<AccountState>('/store/account/password/reset', { method: 'POST', json: form }),
    );
    if (!acc) return;
    setAccount(acc);
    toast('Senha alterada. Você já está dentro da conta.', 'success');
    after.done(() => navigate('/pedir/conta', { replace: true }));
  }

  return (
    <div className="sf-wrap sf-page">
      <ScreenHeader title="Esqueci minha senha" back="/pedir/conta" />
      {viaStore ? (
        <div className="auth__form">
          <p>
            {menu.restaurant.name} ainda não manda o código automático. Fale com o restaurante e
            peça o código para criar uma nova senha.
          </p>
          {wa && (
            <a
              className="cta"
              href={`https://wa.me/${wa.length <= 11 ? `55${wa}` : wa}`}
              target="_blank"
              rel="noreferrer"
            >
              Chamar no WhatsApp
            </a>
          )}
          <button type="button" className="cta cta--ghost" onClick={() => setStep('code')}>
            Já tenho o código
          </button>
        </div>
      ) : null}
      {!viaStore || step === 'code' ? (
        step === 'phone' ? (
          <form className="auth__form" onSubmit={ask}>
            <p className="form-hint">
              Informe o celular da sua conta. Enviamos um código de 6 dígitos pelo WhatsApp ou para
              o e-mail cadastrado na conta.
            </p>
            <Field label="Celular (WhatsApp)">
              <input
                autoComplete="tel"
                inputMode="tel"
                required
                placeholder="(11) 98888-7777"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })}
              />
            </Field>
            {error && <p className="form-error">{error}</p>}
            <button className="cta" disabled={busy}>
              {busy ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form className="auth__form" onSubmit={reset}>
            <p className="form-hint">
              {sentTo === 'email' && !viaStore
                ? 'Enviamos o código para o e-mail cadastrado na conta (olhe também o spam). '
                : ''}
              Digite o código recebido e escolha a nova senha. O código vale por 15 minutos.
            </p>
            {sentTo === 'email' && !viaStore && wa && (
              <p className="form-hint">
                Não chegou? A conta pode estar sem e-mail.{' '}
                <a
                  href={`https://wa.me/${wa.length <= 11 ? `55${wa}` : wa}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Fale com o restaurante
                </a>{' '}
                e peça o código.
              </p>
            )}
            {viaStore && (
              <Field label="Celular da conta">
                <input
                  inputMode="tel"
                  required
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })}
                />
              </Field>
            )}
            <Field label="Código de 6 dígitos">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label="Nova senha" hint="Pelo menos 8 caracteres, sem senha óbvia.">
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            {error && <p className="form-error">{error}</p>}
            <button className="cta" disabled={busy || form.code.length !== 6}>
              {busy ? 'Salvando…' : 'Trocar senha'}
            </button>
            <button type="button" className="cta cta--ghost" onClick={() => setStep('phone')}>
              Pedir outro código
            </button>
          </form>
        )
      ) : null}
    </div>
  );
}
