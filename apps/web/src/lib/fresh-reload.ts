import { APP_BUILD, fetchServerBuild } from './app-version';

/** Build para a qual este navegador já tentou trocar nesta aba (evita recarregar em loop). */
const TRIED_KEY = 'cm.freshReload';

function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

/**
 * Apaga o que o navegador guarda da versão do app: todos os caches do service worker (arquivos
 * pré-baixados) e o próprio service worker. Sessão, tema, carrinho e preferências ficam.
 */
export async function clearAppCaches(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* navegador sem Cache Storage (ex.: aba anônima): nada a limpar */
  }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* sem service worker */
  }
}

/**
 * Limpa os caches e recarrega: a página volta direto do servidor, já na versão nova, e o
 * service worker novo se registra do zero. Se a limpeza travar, recarrega do mesmo jeito.
 */
export async function freshReload(): Promise<void> {
  await within(clearAppCaches(), 4000);
  window.location.reload();
}

/**
 * Ao abrir o app: se o servidor já entrega outra build, este navegador está rodando uma cópia
 * velha do cache (o service worker antigo serviu o index.html). Limpa tudo e recarrega uma vez.
 */
export async function reloadIfStale(): Promise<boolean> {
  const build = await fetchServerBuild();
  if (!build || build === APP_BUILD) return false;
  try {
    if (sessionStorage.getItem(TRIED_KEY) === build) return false;
    sessionStorage.setItem(TRIED_KEY, build);
  } catch {
    // Sem sessionStorage não dá para garantir que não entra em loop: deixa o aviso "Atualizar".
    return false;
  }
  await freshReload();
  return true;
}
