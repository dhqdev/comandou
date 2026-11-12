import { useSyncExternalStore } from 'react';

const KEY = 'pm.releaseSeen';
const subs = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Grava a versão vista só quando a pessoa abre a tela Novidades (nada é gravado antes). */
export function markReleasesSeen() {
  try {
    localStorage.setItem(KEY, __APP_RELEASE__);
  } catch {
    /* armazenamento indisponível */
  }
  subs.forEach((s) => s());
}

export function useHasUnseenRelease(): boolean {
  const seen = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    read,
    () => null,
  );
  return seen !== __APP_RELEASE__;
}
