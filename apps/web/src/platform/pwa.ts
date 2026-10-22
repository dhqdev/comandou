/**
 * PWA próprio do painel (admin.<domínio>): outro nome, ícone e cor no manifesto, para instalar
 * "Comandou Admin" na tela inicial separado do app do restaurante. Roda antes do React montar.
 */
export function applyAdminPwa() {
  document.documentElement.dataset.app = 'admin';
  document.title = 'Comandou Admin';
  const set = (selector: string, create: () => HTMLElement, attr: string, value: string) => {
    let el = document.head.querySelector<HTMLElement>(selector);
    if (!el) {
      el = create();
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  };
  const link = (rel: string) => () => Object.assign(document.createElement('link'), { rel });
  const meta = (name: string) => () => Object.assign(document.createElement('meta'), { name });
  set('link[rel="manifest"]', link('manifest'), 'href', '/admin.webmanifest');
  set('link[rel="apple-touch-icon"]', link('apple-touch-icon'), 'href', '/icons/admin-180.png');
  set('link[rel="icon"]', link('icon'), 'href', '/icons/admin-192.png');
  set('meta[name="theme-color"]', meta('theme-color'), 'content', '#0b0c0f');
  set(
    'meta[name="apple-mobile-web-app-capable"]',
    meta('apple-mobile-web-app-capable'),
    'content',
    'yes',
  );
  set('meta[name="mobile-web-app-capable"]', meta('mobile-web-app-capable'), 'content', 'yes');
  set(
    'meta[name="apple-mobile-web-app-status-bar-style"]',
    meta('apple-mobile-web-app-status-bar-style'),
    'content',
    'black-translucent',
  );
  set(
    'meta[name="apple-mobile-web-app-title"]',
    meta('apple-mobile-web-app-title'),
    'content',
    'Comandou Admin',
  );

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
  });
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallPromptEvent | null = null;

export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Android/Chrome: abre o pedido de instalação. iPhone: devolve false (instrução manual). */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  deferred = null;
  return true;
}
