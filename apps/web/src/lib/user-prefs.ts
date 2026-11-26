import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/**
 * Preferências de tela da pessoa neste restaurante (ex.: Compacto/Completo do PDV), salvas na
 * conta (`/account/prefs`): valem em qualquer computador ou navegador em que ela entrar. O
 * navegador guarda uma cópia para abrir já do jeito certo, sem esperar a rede.
 */
type Prefs = Record<string, string | number | boolean>;

let loading: Promise<Prefs> | null = null;
const listeners = new Set<(p: Prefs) => void>();

/** Lê uma vez por visita (todas as telas usam a mesma resposta). */
function loadPrefs(): Promise<Prefs> {
  loading ??= api<{ prefs: Prefs }>('/account/prefs')
    .then((r) => r.prefs ?? {})
    .catch(() => {
      loading = null; // sem rede ou sem sessão: tenta de novo na próxima tela
      return {};
    });
  return loading;
}

const localKey = (key: string) => `cm.pref.${key}`;
function readLocal(key: string, legacyKey?: string): string | null {
  try {
    return (
      localStorage.getItem(localKey(key)) ?? (legacyKey ? localStorage.getItem(legacyKey) : null)
    );
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(localKey(key), value);
  } catch {
    /* sem armazenamento: fica só na conta */
  }
}

/** Para testes: esquece o que já leu. */
export function resetUserPrefs() {
  loading = null;
  listeners.clear();
}

/**
 * Uma preferência de texto com valores conhecidos. `legacyKey`: chave antiga do navegador, lida
 * enquanto a conta ainda não tem a preferência (quem já tinha escolhido não perde a escolha).
 */
export function useUserPref<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  legacyKey?: string,
): [T, (v: T) => void] {
  // `allowed` deve ser uma constante do módulo (senão a leitura roda a cada render).
  const pick = useCallback(
    (v: unknown): T | null => (allowed.includes(v as T) ? (v as T) : null),
    [allowed],
  );
  const [value, setValue] = useState<T>(() => pick(readLocal(key, legacyKey)) ?? fallback);

  useEffect(() => {
    let alive = true;
    const apply = (p: Prefs) => {
      const v = pick(p[key]);
      if (!alive || v === null) return;
      setValue(v);
      writeLocal(key, v);
    };
    listeners.add(apply);
    void loadPrefs().then((p) => {
      const v = pick(p[key]);
      if (v !== null) return apply(p);
      // A conta ainda não tem: leva para lá a escolha que este navegador já tinha.
      const local = pick(readLocal(key, legacyKey));
      if (alive && local !== null && local !== fallback)
        void api('/account/prefs', { method: 'PATCH', json: { [key]: local } }).catch(() => {});
    });
    return () => {
      alive = false;
      listeners.delete(apply);
    };
  }, [key, legacyKey, fallback, pick]);

  const set = useCallback(
    (v: T) => {
      setValue(v);
      writeLocal(key, v);
      const patch = { [key]: v };
      // Outras telas abertas com a mesma preferência acompanham.
      loading = (loading ?? Promise.resolve({})).then((p) => ({ ...p, ...patch }));
      for (const l of listeners) l(patch);
      void api('/account/prefs', { method: 'PATCH', json: patch }).catch(() => {
        /* sem rede: fica no navegador e a próxima escolha tenta de novo */
      });
    },
    [key],
  );
  return [value, set];
}
