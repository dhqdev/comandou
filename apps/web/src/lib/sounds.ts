import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Sons da operação. Cada evento tem um toque próprio (sintetizado com Web Audio, sem arquivos),
 * para a equipe saber o que chegou sem olhar a tela. O usuário liga/desliga tudo ou cada som,
 * e escolhe o volume; a escolha fica no aparelho (cada tablet da cozinha tem a sua).
 */
export type SoundKind =
  'order' | 'kitchen' | 'ready' | 'delivery' | 'courier' | 'delivered' | 'bill' | 'cancel';

export const SOUND_INFO: { kind: SoundKind; label: string; hint: string }[] = [
  { kind: 'order', label: 'Novo pedido', hint: 'Pedido do cardápio online esperando aceite' },
  { kind: 'kitchen', label: 'Cozinha', hint: 'Pedido novo entrou na fila de produção' },
  { kind: 'ready', label: 'Pedido pronto', hint: 'A cozinha terminou um pedido' },
  { kind: 'delivery', label: 'Pronto para entrega', hint: 'Pedido esperando um entregador' },
  { kind: 'courier', label: 'Nova corrida', hint: 'Entrega atribuída ao motoboy' },
  { kind: 'delivered', label: 'Entregue', hint: 'O entregador finalizou uma entrega' },
  { kind: 'bill', label: 'Pediu a conta', hint: 'Uma mesa pediu para fechar' },
  { kind: 'cancel', label: 'Cancelamento', hint: 'Cliente pediu para cancelar um pedido' },
];

export interface SoundSettings {
  enabled: boolean;
  volume: number;
  off: SoundKind[];
}

const KEY = 'cm.sounds';
const DEFAULTS: SoundSettings = { enabled: true, volume: 0.7, off: [] };

function read(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      enabled: v.enabled ?? DEFAULTS.enabled,
      volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : DEFAULTS.volume,
      off: Array.isArray(v.off) ? v.off : [],
    };
  } catch {
    return DEFAULTS;
  }
}

let settings = read();
const subs = new Set<() => void>();

export function setSoundSettings(patch: Partial<SoundSettings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* armazenamento indisponível: vale só nesta aba */
  }
  subs.forEach((s) => s());
}

export function toggleSoundKind(kind: SoundKind, on: boolean) {
  const off = settings.off.filter((k) => k !== kind);
  setSoundSettings({ off: on ? off : [...off, kind] });
}

export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => settings,
    () => DEFAULTS,
  );
}

/* ------------------------------------------------------------------ áudio */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Navegadores só liberam áudio depois de um toque/tecla: o primeiro gesto destrava o contexto,
// e a partir daí os avisos tocam sozinhos.
if (typeof window !== 'undefined') {
  const unlock = () => {
    const c = audio();
    if (c && c.state === 'running') {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

interface Note {
  /** Início, em segundos, a partir do toque. */
  at: number;
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** Frequência final (glissando). */
  to?: number;
}

/** Desenho de cada toque: timbre e ritmo diferentes para não confundir na correria. */
const PATTERNS: Record<SoundKind, Note[]> = {
  // Campainha "plim-plom", duas vezes.
  order: [
    { at: 0, freq: 1318.5, dur: 0.35 },
    { at: 0.28, freq: 1046.5, dur: 0.5 },
    { at: 0.9, freq: 1318.5, dur: 0.35 },
    { at: 1.18, freq: 1046.5, dur: 0.6 },
  ],
  // Três bipes curtos e secos, como impressora de comanda.
  kitchen: [
    { at: 0, freq: 1760, dur: 0.09, type: 'square', gain: 0.35 },
    { at: 0.14, freq: 1760, dur: 0.09, type: 'square', gain: 0.35 },
    { at: 0.28, freq: 1760, dur: 0.16, type: 'square', gain: 0.35 },
  ],
  // Arpejo subindo (dó-mi-sol-dó): "ficou pronto".
  ready: [
    { at: 0, freq: 523.25, dur: 0.22, type: 'triangle' },
    { at: 0.11, freq: 659.25, dur: 0.22, type: 'triangle' },
    { at: 0.22, freq: 783.99, dur: 0.22, type: 'triangle' },
    { at: 0.33, freq: 1046.5, dur: 0.5, type: 'triangle' },
  ],
  // Buzina dupla de moto.
  delivery: [
    { at: 0, freq: 587.33, dur: 0.18, type: 'sawtooth', gain: 0.22 },
    { at: 0, freq: 880, dur: 0.18, type: 'triangle', gain: 0.3 },
    { at: 0.26, freq: 587.33, dur: 0.3, type: 'sawtooth', gain: 0.22 },
    { at: 0.26, freq: 880, dur: 0.3, type: 'triangle', gain: 0.3 },
  ],
  // Subida rápida + dois pings: chamada de corrida.
  courier: [
    { at: 0, freq: 440, to: 1320, dur: 0.25, type: 'triangle' },
    { at: 0.32, freq: 1568, dur: 0.14 },
    { at: 0.5, freq: 1568, dur: 0.22 },
  ],
  // Dois tons suaves descendo: tarefa concluída.
  delivered: [
    { at: 0, freq: 987.77, dur: 0.18, gain: 0.6 },
    { at: 0.14, freq: 1318.5, dur: 0.4, gain: 0.6 },
  ],
  // Sininho de caixa registradora.
  bill: [
    { at: 0, freq: 2093, dur: 0.12, type: 'triangle' },
    { at: 0.08, freq: 2637, dur: 0.12, type: 'triangle' },
    { at: 0.16, freq: 3136, dur: 0.45, type: 'triangle' },
  ],
  // Grave descendo, duas vezes: atenção.
  cancel: [
    { at: 0, freq: 440, to: 300, dur: 0.28, type: 'sawtooth', gain: 0.25 },
    { at: 0.36, freq: 440, to: 220, dur: 0.4, type: 'sawtooth', gain: 0.25 },
  ],
};

const lastPlayed = new Map<SoundKind, number>();

/**
 * Toca o som do evento (se ligado). Vários eventos iguais em sequência viram um só toque.
 * `force` toca mesmo desligado (botão "testar").
 */
export function playSound(kind: SoundKind, force = false) {
  if (!force && (!settings.enabled || settings.off.includes(kind))) return;
  const nowMs = Date.now();
  if (!force && nowMs - (lastPlayed.get(kind) ?? 0) < 1500) return;
  lastPlayed.set(kind, nowMs);
  const c = audio();
  if (!c) return;
  try {
    const master = c.createGain();
    master.gain.value = Math.max(0.05, settings.volume) * 0.6;
    master.connect(c.destination);
    const t0 = c.currentTime + 0.02;
    let end = 0;
    for (const n of PATTERNS[kind]) {
      const o = c.createOscillator();
      const g = c.createGain();
      const start = t0 + n.at;
      const stop = start + n.dur;
      o.type = n.type ?? 'sine';
      o.frequency.setValueAtTime(n.freq, start);
      if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, stop);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(n.gain ?? 0.5, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, stop);
      o.connect(g).connect(master);
      o.start(start);
      o.stop(stop + 0.02);
      end = Math.max(end, n.at + n.dur);
    }
    window.setTimeout(() => master.disconnect(), (end + 0.3) * 1000);
  } catch {
    /* sem áudio: segue só com o aviso visual */
  }
}

/**
 * Toca `kind` quando aparece na lista um id que ainda não estava lá (a primeira carga não toca).
 * Devolve `seen(id)`, para marcar algo que o próprio usuário fez e não tocar o aviso para ele.
 */
export function useArrivalSound(kind: SoundKind, ids: readonly string[] | null | undefined) {
  const known = useRef<Set<string> | null>(null);
  /** Ids marcados pelo próprio usuário, com a hora (valem por 30 s). */
  const mine = useRef(new Map<string, number>());
  const key = ids ? ids.join('|') : null;
  useEffect(() => {
    if (key === null) return;
    const list = key ? key.split('|') : [];
    const prev = known.current;
    const t = Date.now();
    for (const [id, at] of mine.current) if (t - at > 30_000) mine.current.delete(id);
    if (prev && list.some((id) => !prev.has(id) && !mine.current.has(id))) playSound(kind);
    known.current = new Set(list);
  }, [key, kind]);
  return useCallback((id: string) => {
    mine.current.set(id, Date.now());
  }, []);
}
