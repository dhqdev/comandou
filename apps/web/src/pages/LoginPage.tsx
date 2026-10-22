import { CSSProperties, FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Logo, Mascot, TextField } from '../design-system';
import { useAuth } from '../app/auth';
import { api, ApiError } from '../lib/api';
import './login.css';

export function LoginPage() {
  const { login } = useAuth();
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantMissing, setTenantMissing] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      await login(email, password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429)
        setError('Muitas tentativas. Aguarde um minuto.');
      else if (err instanceof ApiError && err.status === 401)
        setError('E-mail ou senha inválidos.');
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login__panel">
        <div className="login__brand">
          <Logo size={34} />
        </div>
        <h1 className="login__title">
          {tenantName ? `Entrar em ${tenantName}` : 'Bem-vindo de volta'}
        </h1>
        <p className="login__sub">Acesse o painel do seu restaurante.</p>
        {tenantMissing && (
          <Alert tone="warning">
            Restaurante não encontrado neste endereço. Confira o link enviado pelo administrador.
          </Alert>
        )}
        <form onSubmit={onSubmit} className="login__form" noValidate>
          <TextField
            label="E-mail"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <TextField
            label="Senha"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
            Entrar
          </Button>
        </form>
      </div>
      <div className="login__art" aria-hidden>
        <div className="login__tickets">
          <span
            className="login__ticket"
            style={{ '--d': '0s', '--x': '10%', '--r': '-8deg' } as CSSProperties}
          >
            <b>#128</b> Mesa 4 · 2x Burger
          </span>
          <span
            className="login__ticket"
            style={{ '--d': '2.3s', '--x': '52%', '--r': '5deg' } as CSSProperties}
          >
            <b>#129</b> Delivery · Pizza G
          </span>
          <span
            className="login__ticket"
            style={{ '--d': '4.6s', '--x': '28%', '--r': '-2deg' } as CSSProperties}
          >
            <b>#130</b> Balcão · Açaí 500ml
          </span>
        </div>
        <Mascot size={148} animated mood="joy" className="login__mascot" />
        <div className="login__quote">
          Pedidos, salão, cozinha e caixa
          <br />
          <span>no mesmo lugar.</span>
        </div>
      </div>
    </div>
  );
}
