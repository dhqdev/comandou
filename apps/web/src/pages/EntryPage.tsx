import { useEffect, useState } from 'react';
import { Alert, Button, Spinner } from '../design-system';
import { api } from '../lib/api';

/**
 * /entrar#<token>: chegada de quem acabou de criar o restaurante pelo site. O token (uso único,
 * 1 hora) vem no fragmento, que não vai para o servidor nem para logs; vira uma sessão e some
 * da barra de endereço. Link vencido ou já usado: a pessoa entra com o login do e-mail.
 */
/** O token vale uma vez: o efeito não pode rodar de novo (modo estrito do React em dev). */
let started = false;

export function EntryPage() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (started) return;
    started = true;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', '/entrar');
    if (!token) {
      window.location.replace('/');
      return;
    }
    api('/auth/entry', { method: 'POST', json: { token } })
      .then(() => window.location.replace('/'))
      .catch(() => setFailed(true));
  }, []);
  return (
    <div style={{ maxWidth: 440, margin: '15vh auto', padding: 16, display: 'grid', gap: 16 }}>
      {failed ? (
        <>
          <Alert tone="info">
            Este link já foi usado. Entre com o e-mail e a senha que mandamos para você.
          </Alert>
          <Button onClick={() => window.location.replace('/')}>Ir para a entrada</Button>
        </>
      ) : (
        <Spinner label="Abrindo o seu restaurante" />
      )}
    </div>
  );
}
