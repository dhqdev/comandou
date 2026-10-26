import {
  ChevronRight,
  Gift,
  Heart,
  KeyRound,
  LogOut,
  MapPin,
  Moon,
  Pencil,
  Plus,
  ReceiptText,
  Star,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { centerOf, Mascot, switchTheme, useTheme, useToast } from '../../design-system';
import { SlideTabs } from '../../features/SlideTabs';
import { api, ApiError } from '../../lib/api';
import { useStore } from './context';
import { AddressFields, addressPayload } from './AddressFields';
import { useLoyalty } from './LoyaltyScreens';
import {
  AccountState,
  addressLine,
  fmtPhone,
  loyaltyUnit,
  maskCep,
  maskPhone,
  SavedAddress,
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

/** Entrar ou criar conta (telefone + senha). */
function AuthForms() {
  const { menu, setAccount, customer } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({
    name: customer.customerName,
    phone: customer.customerPhone,
    email: '',
    password: '',
    optIn: false,
  });
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
    // Quem veio da sacola volta para finalizar.
    if (window.history.state?.idx > 0) navigate(-1);
  }

  return (
    <div className="auth">
      <div className="auth__hero">
        <Mascot size={64} mood="happy" />
        <h1>{mode === 'login' ? 'Entre na sua conta' : 'Crie sua conta'}</h1>
        <p>
          Peça mais rápido em <strong>{menu.restaurant.name}</strong>: seus dados e endereços ficam
          salvos e você acompanha todos os pedidos.
        </p>
      </div>
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
          <input
            autoComplete="tel"
            inputMode="tel"
            required
            placeholder="(11) 98888-7777"
            value={form.phone}
            onChange={set('phone')}
          />
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
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'signup' ? 6 : 1}
            value={form.password}
            onChange={set('password')}
          />
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
        <button className="cta" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar minha conta'}
        </button>
        {mode === 'login' && (
          <p className="form-hint auth__forgot">
            <Link to="/pedir/conta/esqueci-senha" state={{ phone: form.phone }}>
              Esqueci minha senha
            </Link>
          </p>
        )}
      </form>
    </div>
  );
}

function MenuRow({
  to,
  icon,
  label,
  hint,
  onClick,
}: {
  to?: string;
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick?(): void;
}) {
  const inner = (
    <>
      <span className="mrow__icon">{icon}</span>
      <span className="mrow__text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <ChevronRight size={18} className="mrow__chev" />
    </>
  );
  return to ? (
    <Link className="mrow" to={to}>
      {inner}
    </Link>
  ) : (
    <button type="button" className="mrow" onClick={onClick}>
      {inner}
    </button>
  );
}

/** Aba "Conta": formulário de entrada ou o perfil com os atalhos. */
export function AccountScreen() {
  const { account, logout, menu, favs } = useStore();
  const loyalty = useLoyalty();
  const [theme] = useTheme();
  const toast = useToast();
  if (!account)
    return (
      <div className="sf-wrap sf-page">
        <div className="sk sk--banner" />
      </div>
    );
  const me = account.customer;
  return (
    <div className="sf-wrap sf-page">
      {!me ? (
        <AuthForms />
      ) : (
        <>
          <section className="profile">
            <span className="profile__avatar">{me.name[0]!.toUpperCase()}</span>
            <div>
              <h1>{me.name}</h1>
              <p>{fmtPhone(me.phone)}</p>
            </div>
          </section>
          <nav className="mlist" aria-label="Minha conta">
            {loyalty && (
              <MenuRow
                to="/pedir/fidelidade"
                icon={<Gift size={18} />}
                label="Fidelidade"
                hint={
                  loyalty.account
                    ? `${loyalty.account.balance.toLocaleString('pt-BR')} ${loyaltyUnit(loyalty, loyalty.account.balance)}`
                    : 'Junte pontos a cada pedido'
                }
              />
            )}
            <MenuRow
              to="/pedir/pedidos"
              icon={<ReceiptText size={18} />}
              label="Meus pedidos"
              hint="Acompanhe e veja o histórico"
            />
            <MenuRow
              to="/pedir/conta/enderecos"
              icon={<MapPin size={18} />}
              label="Endereços"
              hint={
                account.addresses.length
                  ? `${account.addresses.length} salvo(s)`
                  : 'Nenhum salvo ainda'
              }
            />
            <MenuRow
              to="/pedir/favoritos"
              icon={<Heart size={18} />}
              label="Favoritos"
              hint={favs.length ? `${favs.length} prato(s)` : undefined}
            />
            <MenuRow
              to="/pedir/conta/dados"
              icon={<UserRound size={18} />}
              label="Meus dados"
              hint={me.email ?? 'Nome, e-mail e promoções'}
            />
            <MenuRow to="/pedir/conta/senha" icon={<KeyRound size={18} />} label="Trocar senha" />
          </nav>
        </>
      )}

      <nav className="mlist" aria-label="Preferências">
        {menu.appearance.theme === 'auto' && (
          <MenuRow
            icon={theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
            label={theme === 'dark' ? 'Tema escuro' : 'Tema claro'}
            hint="Toque para trocar"
            onClick={() => {
              const el = document.activeElement;
              switchTheme(theme === 'dark' ? 'light' : 'dark', el ? centerOf(el) : undefined);
            }}
          />
        )}
        {me && (
          <MenuRow
            icon={<LogOut size={18} />}
            label="Sair da conta"
            onClick={async () => {
              await logout();
              toast('Você saiu da conta');
            }}
          />
        )}
      </nav>
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
          <span className="empty-state__icon">
            <MapPin size={26} />
          </span>
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
    navigate('/pedir/conta', { replace: true });
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
