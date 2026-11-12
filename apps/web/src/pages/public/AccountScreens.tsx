import {
  ChevronRight,
  Eye,
  EyeOff,
  Gift,
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
  Star,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-react';
import { CSSProperties, FormEvent, MouseEvent, ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { clickPoint, Mascot, Spinner, switchTheme, useTheme, useToast } from '../../design-system';
import { SlideTabs } from '../../features/SlideTabs';
import { api, ApiError } from '../../lib/api';
import { AddressArt, LoyaltyArt } from './art';
import { Photo } from './ui';
import { ProfilePhoto } from './ProfilePhoto';
import { useStoreChat } from './chat';
import { useStore } from './context';
import { AddressFields, addressPayload } from './AddressFields';
import { nextGoal, useLoyalty } from './LoyaltyScreens';
import {
  AccountOrder,
  AccountState,
  addressLine,
  fmtPhone,
  LoyaltyOn,
  loyaltyRule,
  loyaltyUnit,
  maskCep,
  maskPhone,
  SavedAddress,
  STEP_LABEL,
} from './store';
import { Field, ScreenHeader, Switch } from './ui';

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
  const { menu, setAccount, customer } = useStore();
  const navigate = useNavigate();
  const after = useAfterLogin();
  const toast = useToast();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({
    name: customer.customerName,
    phone: customer.customerPhone,
    email: '',
    password: '',
    optIn: false,
  });
  const [showPass, setShowPass] = useState(false);
  const { busy, error, run, setError } = useAsync();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: k === 'phone' ? maskPhone(e.target.value) : e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
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
                password: form.password,
                marketingOptIn: form.optIn,
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
          <Field label="Senha" hint={mode === 'signup' ? 'Pelo menos 6 caracteres.' : undefined}>
            <span className="auth__input">
              <LockKeyhole size={18} aria-hidden />
              <input
                type={showPass ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'signup' ? 6 : 1}
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
        <li>
          <span className="auth__perk-icon">
            <MapPin size={17} aria-hidden />
          </span>
          Endereços salvos
        </li>
        <li>
          <span className="auth__perk-icon">
            {loyaltyOn ? <Gift size={17} aria-hidden /> : <Heart size={17} aria-hidden />}
          </span>
          {loyaltyOn ? 'Junte pontos' : 'Seus favoritos'}
        </li>
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
 * Bloco da conta: ícone em cima (fotos no canto quando há), nome e uma linha curta embaixo.
 * Afunda ao tocar e volta com a mola; `--i` escalona a entrada.
 */
function Tile({
  to,
  icon,
  label,
  hint,
  photos,
  i,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  hint?: string;
  photos?: (string | null | undefined)[];
  i: number;
}) {
  return (
    <Link className="acct-tile" to={to} style={{ '--i': i } as CSSProperties}>
      <span className="acct-tile__top">
        <span className="acct-tile__icon">{icon}</span>
        {photos && <PhotoStack photos={photos} />}
      </span>
      <span className="acct-tile__text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </Link>
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

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

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
 * Aba "Conta": formulário de entrada ou o perfil. Foto e nome no topo, o pedido em andamento,
 * a fidelidade e as telas em blocos grandes com o que importa de cada uma; conversa, tema e
 * senha numa lista curta; Sair no fim.
 */
export function AccountScreen() {
  const { account, logout, menu, favs, product } = useStore();
  const chat = useStoreChat();
  const loyalty = useLoyalty();
  const [theme] = useTheme();
  const toast = useToast();
  const me = account?.customer ?? null;
  const orders = useAccountOrders(!!me);
  if (!account)
    return (
      <div className="sf-wrap sf-page">
        <Spinner />
      </div>
    );
  const themeRow = menu.appearance.theme === 'auto';
  const dark = theme === 'dark';
  const live = liveOrder(orders);
  const home = account.addresses.find((a) => a.isDefault) ?? account.addresses[0];
  const favPhotos = favs.map((id) => product(id)?.imageUrl);
  // Ordem de entrada de cada parte.
  let n = 0;
  const at = (i: number) => ({ '--i': i }) as CSSProperties;
  return (
    <div className="sf-wrap sf-page acct">
      {!me ? (
        <AuthForms />
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
          <nav className="acct__grid" aria-label="Minha conta">
            {loyalty && <LoyaltyTile l={loyalty} i={n++} />}
            <Tile
              i={n++}
              to="/pedir/pedidos"
              icon={<ReceiptText />}
              label="Pedidos"
              photos={orders?.[0]?.items.map((it) => it.imageUrl)}
              hint={
                orders === null
                  ? undefined
                  : orders.length
                    ? plural(
                        orders.length,
                        'pedido',
                        orders.length >= 50 ? 'pedidos ou mais' : 'pedidos',
                      )
                    : 'Nenhum ainda'
              }
            />
            <Tile
              i={n++}
              to="/pedir/conta/enderecos"
              icon={<MapPin />}
              label="Endereços"
              hint={home ? `${home.street}, ${home.number}` : 'Nenhum ainda'}
            />
            <Tile
              i={n++}
              to="/pedir/favoritos"
              icon={<Heart />}
              label="Favoritos"
              photos={favPhotos}
              hint={favs.length ? plural(favs.length, 'prato', 'pratos') : 'Nenhum ainda'}
            />
            <Tile
              i={n++}
              to="/pedir/conta/dados"
              icon={<UserRound />}
              label="Meus dados"
              hint={me.email ?? 'Nome e e-mail'}
            />
          </nav>
        </>
      )}

      {(chat.enabled || themeRow || me) && (
        <nav className="acct-list" aria-label="Ajuda e ajustes" style={at(n++)}>
          {chat.enabled && (
            <Row
              to="/pedir/conversa"
              icon={<MessageCircle />}
              label="Conversar com a loja"
              count={chat.unread}
            />
          )}
          {themeRow && (
            <Row
              icon={dark ? <Moon /> : <Sun />}
              label="Tema escuro"
              switchOn={dark}
              onClick={(e) => switchTheme(dark ? 'light' : 'dark', clickPoint(e, e.currentTarget))}
            />
          )}
          {me && <Row to="/pedir/conta/senha" icon={<KeyRound />} label="Trocar senha" />}
        </nav>
      )}
      {me && (
        <button
          type="button"
          className="acct__out"
          style={at(n++)}
          onClick={async () => {
            await logout();
            toast('Você saiu da conta');
          }}
        >
          <LogOut aria-hidden /> Sair da conta
        </button>
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
  const { setAccount } = useStore();
  const me = useMe();
  const toast = useToast();
  const [form, setForm] = useState({
    name: me?.name ?? '',
    email: me?.email ?? '',
    optIn: me?.marketingOptIn ?? false,
  });
  const { busy, error, run } = useAsync();
  if (!me) return null;
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
          const acc = await run(() =>
            api<AccountState>('/store/account', {
              method: 'PATCH',
              json: {
                name: form.name.trim(),
                email: form.email.trim() || null,
                marketingOptIn: form.optIn,
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
        <label className="ck-toggle">
          <span>Receber promoções da loja</span>
          <Switch
            label="Receber promoções"
            checked={form.optIn}
            onChange={(v) => setForm({ ...form, optIn: v })}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="cta" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </div>
  );
}

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
  const { busy, error, run } = useAsync();
  if (!me || !account) return null;
  const list = account.addresses;

  async function reload() {
    const acc = await api<AccountState>('/store/account');
    setAccount(acc);
  }
  function edit(a: SavedAddress | 'new') {
    setEditing(a);
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
            const p = addressPayload(form);
            const body = {
              ...p,
              label: form.label.trim() || null,
              complement: p.complement ?? null,
              reference: p.reference ?? null,
              cep: p.cep ?? null,
              city: p.city ?? null,
              state: p.state ?? null,
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
  const [form, setForm] = useState({ current: '', next: '' });
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
        <Field label="Senha atual">
          <input
            type="password"
            autoComplete="current-password"
            required
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
          />
        </Field>
        <Field label="Nova senha" hint="Pelo menos 6 caracteres.">
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
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

/** Esqueci minha senha: código pelo WhatsApp da loja e nova senha. */
export function ForgotPasswordScreen() {
  const { menu, setAccount } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const prefill = (useLocation().state as { phone?: string } | null)?.phone ?? '';
  const after = useAfterLogin();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [form, setForm] = useState({ phone: prefill, code: '', password: '' });
  const [viaStore, setViaStore] = useState(false);
  const { busy, error, run } = useAsync();
  const wa = menu.restaurant.whatsapp?.replace(/\D/g, '');

  async function ask(e: FormEvent) {
    e.preventDefault();
    const r = await run(() =>
      api<{ channel: 'whatsapp' | 'restaurant' }>('/store/account/password/forgot', {
        method: 'POST',
        json: { phone: form.phone },
      }),
    );
    if (!r) return;
    setViaStore(r.channel === 'restaurant');
    if (r.channel === 'whatsapp') {
      setStep('code');
      toast('Código enviado para o seu WhatsApp', 'success');
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
              Informe o celular da sua conta. Enviamos um código de 6 dígitos pelo WhatsApp.
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
              Digite o código recebido e escolha a nova senha. O código vale por 15 minutos.
            </p>
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
            <Field label="Nova senha" hint="Pelo menos 6 caracteres.">
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
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
