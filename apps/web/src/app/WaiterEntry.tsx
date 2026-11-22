import { Navigate, useLocation } from 'react-router';

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
 * /garcom com sessão aberta: vai direto ao app do garçom (mantendo o ?mesa= do QR). O garçom cai
 * no app dele; o dono ou o gerente entra com a própria conta, sem precisar sair (no app, a faixa
 * de cima mostra com qual conta está e tem Voltar ao painel e Entrar como garçom).
 */
export function WaiterEntry() {
  const { search } = useLocation();
  return <Navigate to={`/garcom/mesas${search}`} replace />;
}
