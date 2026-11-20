import { clearAppCaches } from './fresh-reload';
import { forgetMenus } from './menu-boot';
import { offlineStore } from './offline-store';

/** Última limpeza do painel que este aparelho já fez (por endereço do restaurante). */
const EPOCH_KEY = 'cm.cacheEpoch';
/** O que fica na aba só como atalho de cache (aquecer o offline, tentativa de versão nova). */
const SESSION_CACHE_KEYS = ['cm:offline-warm', 'cm.freshReload'];

let wiping = false;

function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

function readEpoch(): string | null | undefined {
  try {
    return localStorage.getItem(EPOCH_KEY);
  } catch {
    return undefined;
  }
}

function writeEpoch(at: string | null) {
  try {
    localStorage.setItem(EPOCH_KEY, at ?? 'none');
  } catch {
    /* sem localStorage: limpa só pelo aviso na hora */
  }
}

/**
 * Apaga o que o aparelho guarda deste restaurante e recarrega direto do servidor: arquivos do app
 * e o service worker, e as leituras guardadas para usar sem internet. Não apaga a fila do que
 * ainda não subiu (vendas feitas sem internet), o login nem os ajustes do aparelho.
 */
export async function wipeTenantCache(at: string | null): Promise<void> {
  if (wiping) return;
  wiping = true;
  writeEpoch(at);
  forgetMenus();
  try {
    for (const k of SESSION_CACHE_KEYS) sessionStorage.removeItem(k);
  } catch {
    /* sem sessionStorage */
  }
  await within(
    Promise.all([
      clearAppCaches(),
      offlineStore()
        .clear('cache')
        .catch(() => undefined),
    ]),
    4000,
  );
  window.location.reload();
}

/**
 * Ao (re)conectar, o servidor diz quando o painel limpou o cache pela última vez. Se este aparelho
 * ainda não limpou essa vez (estava fechado ou sem internet), limpa agora. Na primeira conexão só
 * guarda a data. Devolve true se vai recarregar.
 */
export function checkCacheEpoch(epoch: string | null | undefined): boolean {
  if (epoch === undefined) return false;
  const seen = readEpoch();
  if (seen === undefined) return false;
  if (seen === null) {
    writeEpoch(epoch);
    return false;
  }
  if (seen === (epoch ?? 'none')) return false;
  if (epoch === null) {
    writeEpoch(null);
    return false;
  }
  void wipeTenantCache(epoch);
  return true;
}
