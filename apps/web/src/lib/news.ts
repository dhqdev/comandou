import type { Release } from '@comandou/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';

/** Quanto tempo uma novidade fica no sininho depois do dia em que saiu. */
export const NEWS_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const KEY = 'pm.newsSeen';
const subs = new Set<() => void>();

/** Fim do dia (hora local) em que a versão saiu. */
function endOfDay(date: string): number {
  return new Date(`${date}T00:00:00`).getTime() + 24 * 60 * 60 * 1000;
}

/** Até quando a versão aparece no sininho: o dia em que saiu e mais 2 dias. Depois some sozinha. */
export function newsExpiresAt(r: Pick<Release, 'date'>): number {
  return endOfDay(r.date) + NEWS_TTL_MS;
}

/** Versões que ainda estão no sininho agora (as mais novas primeiro, como em RELEASES). */
export function recentNews<T extends Pick<Release, 'date'>>(
  releases: readonly T[],
  now: number,
): T[] {
  return releases.filter((r) => {
    const t = newsExpiresAt(r);
    return Number.isFinite(t) && now < t;
  });
}

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

function parse(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Quantas versões vistas guardar. Precisa caber com folga tudo o que aparece no sininho de uma vez:
 * em dias de muitas entregas passam de 50 versões em 3 dias, e um limite curto apagava justamente
 * as mais novas, que voltavam a aparecer como "nova".
 */
const SEEN_MAX = 500;

/** Marca como lidas as versões mostradas. As recém-vistas vão na frente, para nunca serem cortadas. */
export function markNewsSeen(versions: readonly string[]) {
  const all = Array.from(new Set([...versions, ...parse(readRaw())])).slice(0, SEEN_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* armazenamento indisponível */
  }
  subs.forEach((s) => s());
}

/** Versões já vistas no sininho neste aparelho. */
export function useSeenNews(): string[] {
  const raw = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    readRaw,
    () => '[]',
  );
  return parse(raw);
}

/** Hora atual que se atualiza sozinha, para a novidade vencida sumir mesmo com a tela aberta. */
export function useNow(everyMs = 10 * 60 * 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    const wake = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [everyMs]);
  return now;
}
