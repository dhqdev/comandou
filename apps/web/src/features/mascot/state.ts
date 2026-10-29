import { useEffect, useSyncExternalStore } from 'react';
import { cleanOutfit, DEFAULT_MASCOT, type MascotOutfit, type MascotPrefs } from '@comandou/shared';
import { api } from '../../lib/api';

/**
 * Roupinha do panda de quem está logado, compartilhada pelo app inteiro (como no Planejai).
 * Fica salva na conta (API /me/mascot) e no aparelho, por pessoa: o mesmo caixa usado por
 * várias pessoas mostra o panda de cada uma.
 */
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let key = '';
let prefs: MascotPrefs = DEFAULT_MASCOT;

function read(k: string): MascotPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(k) ?? 'null') as Partial<MascotPrefs> | null;
    if (!raw) return DEFAULT_MASCOT;
    return { outfit: cleanOutfit(raw.outfit), stroll: raw.stroll !== false };
  } catch {
    return DEFAULT_MASCOT;
  }
}
function keep() {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    /* sem storage */
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function update(next: MascotPrefs) {
  prefs = next;
  keep();
  emit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void api('/me/mascot', { method: 'PUT', json: prefs }).catch(() => {});
  }, 500);
}

export function useMascot(): MascotPrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}

export function setOutfit(outfit: MascotOutfit) {
  update({ ...prefs, outfit: cleanOutfit(outfit) });
}

export function setStroll(stroll: boolean) {
  update({ ...prefs, stroll });
}

export const WARDROBE_EVENT = 'cm:panda-wardrobe';
export function openWardrobe() {
  window.dispatchEvent(new Event(WARDROBE_EVENT));
}

/** Liga o panda à pessoa logada: abre com o que está no aparelho e confirma com a conta. */
export function useMascotSync(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    key = `cm-panda:${userId}`;
    prefs = read(key);
    emit();
    let alive = true;
    api<MascotPrefs>('/me/mascot')
      .then((r) => {
        if (!alive || !r) return;
        const next = { outfit: cleanOutfit(r.outfit), stroll: r.stroll !== false };
        if (JSON.stringify(next) !== JSON.stringify(prefs)) {
          prefs = next;
          keep();
          emit();
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);
}
