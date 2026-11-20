/*
 * Abertura rápida do cardápio do cliente (/pedir).
 *
 * - public/boot.js já pede o cardápio ao servidor enquanto os arquivos do app ainda baixam; a
 *   primeira chamada de api() para o mesmo endereço usa essa resposta (takeBootFetch).
 * - O último cardápio aberto fica guardado no aparelho: ao recarregar, ele aparece na hora e o
 *   novo, quando chega, toma o lugar (preço, foto e loja aberta/fechada sempre do servidor).
 * - O tema escolhido pela loja fica guardado para o esqueleto já abrir na cor certa.
 */

/** Resposta pedida pelo boot.js só vale logo depois de abrir a página. */
const BOOT_FETCH_MAX_AGE_MS = 30_000;
const MENU_KEY = 'cm.menu:';
const THEME_KEY = 'cm.storeTheme';
/** Cardápio guardado há mais tempo que isso não aparece (abre com o esqueleto). */
const MENU_MAX_AGE_MS = 14 * 24 * 3_600_000;
/** Cardápio muito grande não vai para o aparelho (o localStorage tem uns 5 MB por endereço). */
const MENU_MAX_CHARS = 1_500_000;

interface BootFetch {
  path: string;
  at: number;
  res: Promise<Response>;
}

declare global {
  interface Window {
    __cmBootFetch?: BootFetch;
  }
}

/** A resposta que o boot.js já pediu para este endereço (uma vez só), ou null. */
export function takeBootFetch(path: string): Promise<Response> | null {
  const b = typeof window === 'undefined' ? undefined : window.__cmBootFetch;
  if (!b || b.path !== path) return null;
  window.__cmBootFetch = undefined;
  return Date.now() - b.at < BOOT_FETCH_MAX_AGE_MS ? b.res : null;
}

/** Último cardápio aberto neste aparelho para este endereço (/store ou /store?mesa=…). */
export function cachedMenu<T>(path: string, now = Date.now()): T | null {
  try {
    const raw = localStorage.getItem(MENU_KEY + path);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { at?: number; menu?: T };
    if (typeof saved.at !== 'number' || !saved.menu || now - saved.at > MENU_MAX_AGE_MS)
      return null;
    return saved.menu;
  } catch {
    return null;
  }
}

/** Guarda o cardápio que acabou de chegar (sem dado de cliente: é o mesmo para todo mundo). */
export function saveMenu(path: string, menu: unknown, now = Date.now()) {
  try {
    const raw = JSON.stringify({ at: now, menu });
    if (raw.length > MENU_MAX_CHARS) localStorage.removeItem(MENU_KEY + path);
    else localStorage.setItem(MENU_KEY + path, raw);
  } catch {
    /* sem espaço ou navegação privada: abre com o esqueleto */
  }
}

/** Apaga os cardápios guardados (loja fora do ar, limpeza de cache pelo painel). */
export function forgetMenus() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(MENU_KEY)) localStorage.removeItem(k);
    }
  } catch {
    /* sem localStorage */
  }
}

/** Tema da loja guardado (claro/escuro), para abrir já na cor certa; null = o do aparelho. */
export function storeTheme(): 'light' | 'dark' | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

export function rememberStoreTheme(theme: string | null | undefined) {
  try {
    if (theme === 'light' || theme === 'dark') localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    /* sem localStorage */
  }
}

/** Está no cardápio do cliente? (o mesmo teste do boot.js) */
export const isMenuPath = (pathname: string) => /^\/pedir(\/|$)/.test(pathname);
