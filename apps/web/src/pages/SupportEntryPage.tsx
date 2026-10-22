import { useEffect, useState } from 'react';
import { Alert, Spinner } from '../design-system';
import { api } from '../lib/api';

/**
 * /suporte#<token>: entrada pelo link "Abrir a base do cliente" do painel Super Admin.
 * O token vem no fragmento (#), que não vai para o servidor nem para logs de acesso; é trocado
 * por uma sessão e apagado da barra de endereço.
 */
export function SupportEntryPage() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', '/suporte');
    if (!token) {
      setError('Link de acesso incompleto.');
      return;
    }
    api('/auth/support', { method: 'POST', json: { token } })
      .then(() => window.location.replace('/'))
      .catch(() => setError('Link de acesso inválido ou vencido. Gere outro no painel.'));
  }, []);
  return (
    <div style={{ maxWidth: 480, margin: '15vh auto', padding: 16 }}>
      {error ? <Alert tone="danger">{error}</Alert> : <Spinner label="Entrando" />}
    </div>
  );
}
