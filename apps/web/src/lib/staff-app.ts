/**
 * Qual app da equipe este aparelho usou por último: o do garçom (/garcom) ou o painel. O QR Code
 * da mesa lido pela câmera do celular (fora do app) abre a mesa no mesmo lugar: o dono que está
 * atendendo pelo app do garçom cai no app do garçom, não no Salão do painel.
 */
export type StaffApp = 'garcom' | 'painel';

const KEY = 'cm.staff.app';

export function rememberStaffApp(app: StaffApp) {
  try {
    localStorage.setItem(KEY, app);
  } catch {
    // modo privado: o QR abre no painel, como antes
  }
}

export function lastStaffApp(): StaffApp | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'garcom' || v === 'painel' ? v : null;
  } catch {
    return null;
  }
}

/** Para onde o QR Code da mesa leva quem é da equipe (logado neste aparelho). */
export function staffTableLink(
  tableId: string,
  role: string | undefined,
  last: StaffApp | null = lastStaffApp(),
) {
  const q = `?mesa=${encodeURIComponent(tableId)}`;
  return role === 'waiter' || last === 'garcom' ? `/garcom/mesas${q}` : `/mesas${q}`;
}
