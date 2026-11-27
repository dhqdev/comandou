import { on } from './http';
import { registerBack } from './routes-back';
import { registerOps } from './routes-ops';
import { registerReports } from './routes-reports';
import { seedDay } from './seed';
import { ME, products, store, TENANT } from './state';

let done = false;

/** Monta o dia da loja de exemplo e liga todas as rotas do servidor de mentira. */
export function registerRoutes() {
  if (done) return;
  done = true;
  seedDay();

  // Quem está usando e a loja.
  on('GET', '/auth/me', () => ME);
  on('GET', '/tenant', () => ({ name: TENANT.name }));
  on('GET', '/store/branding', () => ({
    brandColor: store.brandColor,
    accentColor: store.accentColor,
    fontStyle: store.fontStyle,
    cornerStyle: store.cornerStyle,
    faviconUrl: null,
    logoUrl: '/site/food/logo.webp',
    staffApp: store.brandStaffApp,
  }));
  on('GET', '/store/settings', () => store);
  on('PATCH', '/store/settings', ({ body }) => Object.assign(store, body as object));
  // Preferências de tela (Compacto/Completo do PDV): ficam só nesta visita.
  const prefs: Record<string, unknown> = {};
  on('GET', '/account/prefs', () => ({ prefs }));
  on('PATCH', '/account/prefs', ({ body }) => {
    Object.assign(prefs, body as object);
    return { prefs };
  });
  on('GET', '/search', ({ query }) => {
    const q = (query.get('q') ?? '').trim().toLowerCase();
    return {
      results: q
        ? products
            .filter((p) => p.name.toLowerCase().includes(q))
            .slice(0, 6)
            .map((p) => ({
              kind: 'product',
              id: p.id,
              title: p.name,
              subtitle: `Cardápio · R$ ${p.price.replace('.', ',')}`,
              to: `/cardapio/itens/${p.id}`,
            }))
        : [],
    };
  });

  // Aplicativos de delivery: o exemplo não tem loja ligada.
  on('GET', '/channels/stores/state', () => []);

  registerOps();
  registerBack();
  registerReports();
}
