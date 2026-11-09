import { useSyncExternalStore } from 'react';

/**
 * Ajustes deste aparelho da cozinha (ficam só nele): qual cozinha mostra, layout, cor de
 * destaque, tamanho do texto, onde imprimir e de quanto em quanto tempo confere a fila. O que
 * aparece na tela (cronômetro, fotos, abas...) quem decide é o Super Admin.
 */
export type KdsLayout = 'kanban' | 'lista';
export type KdsSize = 'normal' | 'grande' | 'enorme';
export type KdsPrintVia = 'auto' | 'browser' | 'printer';

export interface KdsPrefs {
  /** null = ainda não escolheu; '' = todas as cozinhas; 'none' = itens sem cozinha. */
  kitchen: string | null;
  layout: KdsLayout;
  /** Cor de destaque escolhida no aparelho (null = a cor da cozinha). */
  accent: string | null;
  size: KdsSize;
  printVia: KdsPrintVia;
  /** Segundos entre uma conferência e outra (o tempo real avisa na hora; isto é a garantia). */
  refresh: number;
}

export const REFRESH_OPTIONS = [10, 15, 30, 60] as const;
const KEY = 'cm.kds';
const OLD_KEY = 'pm.kdsSector';
const DEFAULTS: KdsPrefs = {
  kitchen: null,
  layout: 'kanban',
  accent: null,
  size: 'normal',
  printVia: 'auto',
  refresh: 15,
};

const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  list.includes(v as T) ? (v as T) : d;

function read(): KdsPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const v = (raw ? JSON.parse(raw) : {}) as Partial<KdsPrefs>;
    // Aparelhos que já tinham escolhido o setor na versão anterior continuam nele.
    const old = raw ? null : localStorage.getItem(OLD_KEY);
    return {
      kitchen: typeof v.kitchen === 'string' ? v.kitchen : old,
      layout: pick(v.layout, ['kanban', 'lista'], DEFAULTS.layout),
      accent: typeof v.accent === 'string' && /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent : null,
      size: pick(v.size, ['normal', 'grande', 'enorme'], DEFAULTS.size),
      printVia: pick(v.printVia, ['auto', 'browser', 'printer'], DEFAULTS.printVia),
      refresh: REFRESH_OPTIONS.includes(v.refresh as (typeof REFRESH_OPTIONS)[number])
        ? (v.refresh as number)
        : DEFAULTS.refresh,
    };
  } catch {
    return DEFAULTS;
  }
}

let prefs = read();
const subs = new Set<() => void>();

export function setKdsPrefs(patch: Partial<KdsPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* sem armazenamento: vale só nesta aba */
  }
  subs.forEach((s) => s());
}

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function useKdsPrefs(): KdsPrefs {
  return useSyncExternalStore(
    subscribe,
    () => prefs,
    () => DEFAULTS,
  );
}

/** Tempo de espera do cartão: 04:32 até 1 hora; depois 1h05. */
export function waitLabel(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
