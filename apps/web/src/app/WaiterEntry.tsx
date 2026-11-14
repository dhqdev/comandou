import { Link, Navigate } from 'react-router';
import { Button, Card, EmptyState } from '../design-system';
import { useAuth } from './auth';

/** Endereço de acesso do garçom (/garcom; /garçom também funciona). */
export const WAITER_PATH = '/garcom';

/** /garcom ou /garçom, com ou sem barra no fim (o navegador manda o "ç" codificado). */
export function isWaiterPath(pathname: string): boolean {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    // endereço malformado: compara como veio
  }
  return /^\/gar[cç]om\/?$/i.test(p);
}

/** Telas de dentro do app do garçom (/garcom/mesas, /garcom/pedido/…). */
export function isWaiterAppPath(pathname: string): boolean {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    // endereço malformado: compara como veio
  }
  return /^\/gar[cç]om\//i.test(p);
}

export const waiterLink = () => `${window.location.origin}${WAITER_PATH}`;

/**
 * /garcom com sessão aberta de outra pessoa (o dono testando, por exemplo): ver o app do garçom
 * como ele vê ou sair e entrar como garçom. O garçom mesmo nem chega aqui: cai no app dele.
 */
export function WaiterEntry() {
  const { me, logout } = useAuth();
  if (me?.user.role === 'waiter') return <Navigate to="/garcom/mesas" replace />;
  return (
    <Card>
      <EmptyState
        mascot="joy"
        title="Acesso do garçom"
        description={`Este aparelho está conectado como ${me?.user.name ?? 'outra pessoa'} (${
          me?.user.roleLabel ?? 'sem papel'
        }). Para o garçom entrar com a conta dele, saia desta conta.`}
        action={
          <div className="actions-row" style={{ justifyContent: 'center' }}>
            <Link className="cm-btn cm-btn--secondary" to="/garcom/mesas">
              Ver o app do garçom
            </Link>
            <Button onClick={() => void logout()}>Sair e entrar como garçom</Button>
          </div>
        }
      />
    </Card>
  );
}
