import { FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Alert, Button, TextField } from '../design-system';
import { useAuth } from '../app/auth';
import { isWaiterPath } from '../app/WaiterEntry';
import { api, ApiError } from '../lib/api';
import { AuthShell, deskFocus, PasswordField } from './AuthShell';

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

/**
 * Login do restaurante (painel, /garcom, /cozinha e /entregas). Quem entra fica conectado neste
 * aparelho: a sessão se renova a cada uso, então não precisa entrar de novo. Para trocar de pessoa,
 * use "Sair".
 */
export function LoginPage() {
  const { login } = useAuth();
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
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [desk] = useState(deskFocus);

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

  return (
    <AuthShell
      place={[tenantName, who?.place].filter(Boolean).join(' · ') || undefined}
      title={who?.title ?? 'Bem-vindo de volta'}
      sub="Entre uma vez e o aparelho fica conectado."
      help={
        <>
          Esqueceu a senha? Peça ao gerente para trocar em <b>Equipe</b>.
        </>
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
          placeholder="voce@restaurante.com.br"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={desk && !email}
          required
        />
        <PasswordField
          autoComplete="current-password"
          placeholder="Sua senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={desk && !!email}
          required
        />
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
      </form>
    </AuthShell>
  );
}
