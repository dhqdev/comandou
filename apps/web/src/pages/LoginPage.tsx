import { ChefHat, Eye, EyeOff, LayoutGrid, Lock, Receipt, Truck } from 'lucide-react';
import { FormEvent, KeyboardEvent, ReactNode, useEffect, useState } from 'react';
import { CURRENT_RELEASE } from '@comandou/shared';
import { useLocation } from 'react-router';
import { Alert, Button, Logo, Mascot, TextField, ThemeToggle } from '../design-system';
import { useAuth } from '../app/auth';
import { isWaiterPath } from '../app/WaiterEntry';
import { api, ApiError } from '../lib/api';
import './login.css';

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
  waiter: { place: 'Salão', title: 'Acesso do garçom', cta: 'Entrar no salão' },
  kitchen: { place: 'Cozinha', title: 'Acesso da cozinha', cta: 'Entrar na cozinha' },
  driver: { place: 'Entregas', title: 'Acesso do entregador', cta: 'Entrar nas entregas' },
};

export function LoginPage() {
  const { login } = useAuth();
  // /garcom, /cozinha e /entregas: mesmo login, com textos de quem usa (depois de entrar, cada um
  // cai no próprio app).
  const { pathname } = useLocation();
  const who = isWaiterPath(pathname)
    ? WHO.waiter
    : /^\/cozinha\/?$/.test(pathname)
      ? WHO.kitchen
      : /^\/entregas\/?$/.test(pathname)
        ? WHO.driver
        : null;
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantMissing, setTenantMissing] = useState(false);
  const [email, setEmail] = useState(rememberedEmail);
  const [remember, setRemember] = useState(() => rememberedEmail() !== '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ name: string }>('/tenant')
      .then((t) => setTenantName(t.name))
      .catch(() => setTenantMissing(true));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, email.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        /* sem armazenamento: só não lembra */
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

  const onPasswordKey = (e: KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  return (
    <div className="login">
      <main className="login__panel">
        <header className="login__top">
          <Logo size={32} />
          <ThemeToggle />
        </header>

        <div className="login__body">
          <span className="login__eyebrow">
            <span className="cm-dot" /> {tenantName ?? who?.place ?? 'Painel do restaurante'}
          </span>
          <h1 className="login__title">{who?.title ?? 'Bem-vindo de volta'}</h1>
          <p className="login__sub">
            Entre com o e-mail e a senha que o responsável pelo restaurante cadastrou para você.
          </p>

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
              placeholder="voce@restaurante.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={!email}
              required
            />
            <div className="login__password">
              <TextField
                label="Senha"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={onPasswordKey}
                onKeyDown={onPasswordKey}
                autoFocus={!!email}
                hint={capsLock ? 'Caps Lock está ligado.' : undefined}
                required
              />
              <button
                type="button"
                className="login__reveal"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                title={showPassword ? 'Esconder senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <label className="login__remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Lembrar meu e-mail neste aparelho
            </label>

            {error && <Alert tone="danger">{error}</Alert>}

            <Button
              type="submit"
              size="lg"
              block
              loading={busy}
              disabled={!email || !password || tenantMissing}
            >
              {who?.cta ?? 'Entrar no painel'}
            </Button>
            <p className="login__help">
              Esqueceu a senha? Peça ao gerente para redefinir em <b>Gestão › Equipe</b>.
            </p>
          </form>
        </div>

        <footer className="login__foot">
          <span>
            <Lock size={13} /> Conexão segura
          </span>
          <span>Comandou v{CURRENT_RELEASE.version}</span>
        </footer>
      </main>

      <aside className="login__art" aria-hidden>
        <div className="login__showcase">
          <div className="login__board">
            <div className="login__board-head">
              <span>Hoje</span>
              <span className="login__live">
                <span className="cm-dot cm-dot--pulse" /> ao vivo
              </span>
            </div>
            <div className="login__stats">
              <div>
                <small>Pedidos</small>
                <b>128</b>
              </div>
              <div>
                <small>Faturamento</small>
                <b>R$ 6.940</b>
              </div>
              <div>
                <small>Ticket médio</small>
                <b>R$ 54</b>
              </div>
            </div>
            <ul className="login__orders">
              <Order
                n="#131"
                where="Mesa 4"
                what="2x Burger da casa"
                tag="Na cozinha"
                tone="warn"
              />
              <Order n="#132" where="Delivery" what="Pizza grande" tag="Saiu" tone="info" />
              <Order n="#133" where="Balcão" what="Açaí 500ml" tag="Pronto" tone="ok" />
            </ul>
          </div>
          <Mascot size={96} animated mood="joy" className="login__mascot" />
        </div>

        <div className="login__pitch">
          <h2>
            Pedidos, salão, cozinha e caixa
            <span> no mesmo lugar.</span>
          </h2>
          <ul>
            <Feature icon={<LayoutGrid size={16} />}>Mesas e comandas ao vivo</Feature>
            <Feature icon={<ChefHat size={16} />}>Cozinha ligada ao salão</Feature>
            <Feature icon={<Truck size={16} />}>Delivery e loja online</Feature>
            <Feature icon={<Receipt size={16} />}>Caixa, estoque e relatórios</Feature>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Order(props: {
  n: string;
  where: string;
  what: string;
  tag: string;
  tone: 'warn' | 'info' | 'ok';
}) {
  return (
    <li className="login__order">
      <b>{props.n}</b>
      <span>
        {props.where} · {props.what}
      </span>
      <em className={`login__tag login__tag--${props.tone}`}>{props.tag}</em>
    </li>
  );
}

function Feature({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li>
      <span className="login__feature-icon">{icon}</span>
      {children}
    </li>
  );
}
