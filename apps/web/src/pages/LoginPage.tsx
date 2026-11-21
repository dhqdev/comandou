import { FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Alert, Button, TextField } from '../design-system';
import { useAuth } from '../app/auth';
import { loginAreaFor } from '../app/role-home';
import { api, ApiError } from '../lib/api';
import { AuthShell, deskFocus, PasswordField, StoreLoginBrand } from './AuthShell';
import { PinPad } from './PinPad';
import { ForgotLink, ForgotPassword } from './ForgotPassword';
import { isStandalone } from '../platform/pwa';

/** E-mail lembrado neste aparelho (a senha nunca é guardada). */
const REMEMBER_KEY = 'cm-login-email';

function rememberedEmail() {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return '';
  }
}

const WHO = {
  waiter: { place: 'Salão', title: 'Acesso do garçom', cta: 'Entrar no salão', pin: 'waiter' },
  kitchen: { place: 'Cozinha', title: 'Acesso da cozinha', cta: 'Entrar na cozinha', pin: null },
  driver: {
    place: 'Entregas',
    title: 'Acesso do entregador',
    cta: 'Entrar nas entregas',
    pin: 'driver',
  },
  attendant: { place: 'Balcão', title: 'Acesso do PDV', cta: 'Entrar no PDV', pin: null },
  cashier: { place: 'Caixa', title: 'Acesso do caixa', cta: 'Entrar no caixa', pin: null },
} as const;

/**
 * Login do restaurante (painel, /garcom, /entregas, /cozinha, /pdv e /caixa). Quem entra fica conectado neste
 * aparelho: a sessão se renova a cada uso, então não precisa entrar de novo. Para trocar de pessoa,
 * use "Sair".
 */
export function LoginPage() {
  const { login, loginWithPin, refresh } = useAuth();
  const { pathname } = useLocation();
  // Cada área tem o seu link (Equipe › Links de acesso); também nas telas de dentro (/garcom/mesas),
  // a sessão que venceu ali volta para o login da mesma área.
  const area = loginAreaFor(pathname);
  const who = area ? WHO[area] : null;
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantMissing, setTenantMissing] = useState(false);
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [desk] = useState(deskFocus);
  /** Garçom e entregador entram pelo PIN; o e-mail e senha fica como alternativa. */
  const [usePassword, setUsePassword] = useState(false);
  /** Esqueci minha senha (código por e-mail). Também abre por /?nova-senha. */
  const [forgot, setForgot] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('nova-senha'),
  );
  const pinApp = who?.pin ?? null;
  /** App instalado que nunca entrou na equipe: quase sempre o cliente que instalou o cardápio. */
  const [customerApp] = useState(() => !who && isStandalone() && !rememberedEmail());

  useEffect(() => {
    api<{ name: string }>('/tenant')
      .then((t) => {
        setTenantName(t.name);
        document.title = t.name; // aba com o nome do restaurante, não "Comandou"
      })
      .catch(() => setTenantMissing(true));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      try {
        localStorage.setItem(REMEMBER_KEY, email.trim());
      } catch {
        /* sem armazenamento: só não lembra o e-mail */
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429)
        setError('Muitas tentativas. Aguarde um minuto e tente de novo.');
      else if (err instanceof ApiError && err.status === 401)
        setError('E-mail ou senha incorretos. Confira e tente de novo.');
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onPin(pin: string) {
    if (!pinApp) return false;
    setError(null);
    try {
      await loginWithPin(pin, pinApp);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429)
        setError(err.message || 'Muitas tentativas. Aguarde um minuto e tente de novo.');
      else if (err instanceof ApiError && err.status === 401)
        setError('PIN incorreto. Confira e tente de novo.');
      else setError((err as Error).message);
      return false;
    }
  }

  const brand = <StoreLoginBrand name={tenantName} />;

  if (forgot)
    return (
      <ForgotPassword
        base="/auth/password-reset"
        brand={brand}
        sub={who?.place}
        initialEmail={email}
        onBack={() => {
          setError(null);
          setForgot(false);
        }}
        onDone={async (em) => {
          try {
            localStorage.setItem(REMEMBER_KEY, em);
          } catch {
            /* sem armazenamento: só não lembra o e-mail */
          }
          // A senha nova já abriu a sessão: carrega quem entrou e segue para o sistema.
          await refresh();
        }}
      />
    );

  if (pinApp && !usePassword)
    return (
      <AuthShell
        brand={brand}
        title={who!.title}
        sub={who?.place}
        help={
          <button
            type="button"
            className="login__link"
            onClick={() => {
              setError(null);
              setUsePassword(true);
            }}
          >
            Entrar com e-mail
          </button>
        }
      >
        {tenantMissing && (
          <Alert tone="warning">
            Restaurante não encontrado neste endereço. Confira o link enviado pelo administrador.
          </Alert>
        )}
        <PinPad onSubmit={onPin} error={error} disabled={tenantMissing} />
      </AuthShell>
    );

  return (
    <AuthShell
      brand={brand}
      title={who?.title ?? 'Entrar'}
      sub={who?.place}
      help={
        pinApp ? (
          <button
            type="button"
            className="login__link"
            onClick={() => {
              setError(null);
              setUsePassword(false);
            }}
          >
            Entrar com PIN
          </button>
        ) : customerApp ? (
          // App instalado antes, quando o cardápio ainda abria aqui: um toque volta para ele.
          <>
            Veio fazer um pedido?{' '}
            <a className="login__link" href="/pedir">
              Abrir o cardápio
            </a>
          </>
        ) : undefined
      }
    >
      {tenantMissing && (
        <Alert tone="warning">
          Restaurante não encontrado neste endereço. Confira o link enviado pelo administrador.
        </Alert>
      )}
      <form onSubmit={onSubmit} className="login__form" noValidate>
        <TextField
          label="E-mail"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={desk && !email}
          required
        />
        <PasswordField
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={desk && !!email}
          required
        />
        <ForgotLink
          onClick={() => {
            setError(null);
            setForgot(true);
          }}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button
          type="submit"
          size="lg"
          block
          loading={busy}
          disabled={!email || !password || tenantMissing}
        >
          {who?.cta ?? 'Entrar'}
        </Button>
      </form>
    </AuthShell>
  );
}
