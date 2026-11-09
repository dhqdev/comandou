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
  set('link[rel="apple-touch-icon"]', link('apple-touch-icon'), 'href', '/apple-touch-icon.png');
  set('link[rel="icon"]', link('icon'), 'href', '/favicon.svg');
  set('meta[name="theme-color"]', meta('theme-color'), 'content', '#ffffff');
  set(
    'meta[name="apple-mobile-web-app-capable"]',
    meta('apple-mobile-web-app-capable'),
    'content',
    'yes',
  );
  set('meta[name="mobile-web-app-capable"]', meta('mobile-web-app-capable'), 'content', 'yes');
  // "black" (e não "black-translucent"): com a barra de status translúcida, o iPhone instalado
  // mede a tela mais curta pela altura dessa barra e tudo que fica preso embaixo (o menu de
  // abas) subia e deixava uma faixa vazia. O iPhone guarda esse estilo na instalação; para quem
  // já instalou com a translúcida, a regra de display-mode: standalone em base.css corrige.
  set(
    'meta[name="apple-mobile-web-app-status-bar-style"]',
    meta('apple-mobile-web-app-status-bar-style'),
    'content',
    'black',
  );
  set(
    'meta[name="apple-mobile-web-app-title"]',
    meta('apple-mobile-web-app-title'),
    'content',
    'Comandou Admin',
  );
}

/**
 * Guarda o pedido de instalação do Chrome/Android para mostrar no botão "Instalar app" (painel
 * Super Admin, app do entregador). Roda antes do React montar, em todos os endereços.
 */
export function listenInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    window.dispatchEvent(new Event('cm-installable'));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    try {
      localStorage.setItem(INSTALLED_KEY, '1');
    } catch {
      /* modo privado: só não lembra */
    }
    window.dispatchEvent(new Event('cm-installed'));
  });
}

/** Este navegador já instalou o app (o aviso de instalar não aparece mais). */
const INSTALLED_KEY = 'cm-app-installed';
export function wasInstalled() {
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Chrome/Edge/Android já ofereceu a instalação (dá para abrir o pedido com um toque). */
export const canPromptInstall = () => deferred !== null;

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
