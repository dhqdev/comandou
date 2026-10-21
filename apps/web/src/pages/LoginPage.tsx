import { FormEvent, useEffect, useState } from 'react';
import { Alert, Button, TextField } from '../design-system';
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
          <div className="brand__mark" aria-hidden>
            P+
          </div>
          <span>PedeMais</span>
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
        <div className="login__quote">
          Pedidos, salão, cozinha e caixa
          <br />
          no mesmo lugar.
        </div>
      </div>
    </div>
  );
}
