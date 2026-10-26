import type { Delivery } from '../lib/types';

/** Aplicativos de navegação que o entregador pode usar para ir até o cliente. */
export type NavApp = 'waze' | 'google' | 'apple';

export const NAV_APPS: { id: NavApp; label: string }[] = [
  { id: 'waze', label: 'Waze' },
  { id: 'google', label: 'Google Maps' },
  { id: 'apple', label: 'Apple Mapas' },
];

type Dest = Pick<Delivery, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>;

const point = (d: Dest) =>
  d.deliveryLat && d.deliveryLng ? `${d.deliveryLat},${d.deliveryLng}` : null;

/** Rota até o cliente no app escolhido. Usa o ponto do mapa quando existe; senão, o endereço. */
export function navUrl(app: NavApp, d: Dest) {
  const p = point(d);
  const addr = encodeURIComponent(d.deliveryAddress ?? '');
  switch (app) {
    case 'waze':
      return p
        ? `https://waze.com/ul?ll=${p}&navigate=yes`
        : `https://waze.com/ul?q=${addr}&navigate=yes`;
    case 'apple':
      return `https://maps.apple.com/?daddr=${p ? encodeURIComponent(p) : addr}&dirflg=d`;
    default:
      return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${p ? encodeURIComponent(p) : addr}`;
  }
}

const KEY = 'cm-nav-app';

/** O app que o entregador usou por último (sem escolha: Apple Mapas no iPhone, Google nos outros). */
export function preferredNavApp(): NavApp {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'waze' || v === 'google' || v === 'apple') return v;
  } catch {
    /* sem armazenamento */
  }
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'apple' : 'google';
}

export function rememberNavApp(app: NavApp) {
  try {
    localStorage.setItem(KEY, app);
  } catch {
    /* sem armazenamento: vale só agora */
  }
}
