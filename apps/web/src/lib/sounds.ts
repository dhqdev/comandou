import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Sons da operação. Cada evento tem um toque próprio (sintetizado com Web Audio, sem arquivos),
 * para a equipe saber o que chegou sem olhar a tela. O usuário liga/desliga tudo ou cada som,
 * e escolhe o volume; a escolha fica no aparelho (cada tablet da cozinha tem a sua).
 */
export type SoundKind =
  | 'order'
  | 'kitchen'
  | 'ready'
  | 'delivery'
  | 'courier'
  | 'delivered'
  | 'bill'
  | 'cancel';

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

export interface Note {
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

/* ------------------------------------------------------------------ áudio */

/*
 * Como o som sai: cada toque é sintetizado aqui mesmo em um WAV (sem arquivos) e tocado por um
 * elemento <audio>. Não usamos só Web Audio porque o iPhone cala o Web Audio com a chave de
 * silencioso ligada, e o <audio> toca como mídia. Os navegadores só liberam som depois de um
 * gesto: no primeiro toque/clique "abençoamos" alguns elementos tocando um silêncio, e depois
 * eles tocam os avisos sozinhos. Se ainda assim o navegador recusar, cai no Web Audio.
 */

const RATE = 44100;
const POOL_SIZE = 3;
let pool: HTMLAudioElement[] = [];
let poolNext = 0;
let unlocked = false;
let ctx: AudioContext | null = null;

function makeAudio(): HTMLAudioElement | null {
  try {
    const el = new Audio();
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    return el;
  } catch {
    return null;
  }
}

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

/** Codifica amostras (-1..1) como WAV PCM 16 bits mono. */
function toWav(samples: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Forma de onda com fase 0..1. */
function wave(type: OscillatorType, phase: number): number {
  switch (type) {
    case 'square':
      return phase < 0.5 ? 1 : -1;
    case 'triangle':
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    case 'sawtooth':
      return 2 * phase - 1;
    default:
      return Math.sin(2 * Math.PI * phase);
  }
}

const ATTACK = 0.012;
const FLOOR = 0.0001;

/**
 * Sintetiza o toque em amostras, com o mesmo desenho do Web Audio: ataque exponencial curto,
 * queda exponencial até o fim da nota e glissando opcional.
 */
export function renderPattern(notes: Note[], volume: number): Float32Array {
  const end = notes.reduce((m, n) => Math.max(m, n.at + n.dur), 0) + 0.05;
  const out = new Float32Array(Math.ceil(end * RATE));
  const master = Math.max(0.05, volume) * 0.6;
  for (const n of notes) {
    const peak = n.gain ?? 0.5;
    const start = Math.floor(n.at * RATE);
    const len = Math.floor(n.dur * RATE);
    let phase = 0;
    for (let i = 0; i < len && start + i < out.length; i++) {
      const t = i / RATE;
      const freq = n.to ? n.freq * Math.pow(n.to / n.freq, t / n.dur) : n.freq;
      phase = (phase + freq / RATE) % 1;
      const env =
        t < ATTACK
          ? FLOOR * Math.pow(peak / FLOOR, t / ATTACK)
          : peak * Math.pow(FLOOR / peak, (t - ATTACK) / (n.dur - ATTACK));
      out[start + i] += wave(n.type ?? 'sine', phase) * env * master;
    }
  }
  return out;
}

const urls = new Map<string, string>();

function soundUrl(kind: SoundKind, volume: number): string {
  const key = `${kind}:${Math.round(volume * 100)}`;
  let url = urls.get(key);
  if (!url) {
    url = URL.createObjectURL(toWav(renderPattern(PATTERNS[kind], volume)));
    urls.set(key, url);
  }
  return url;
}

let silentUrl: string | null = null;

/** Primeiro gesto: libera os elementos de áudio e o contexto Web Audio. */
function unlock() {
  if (unlocked || typeof window === 'undefined') return;
  unlocked = true;
  try {
    // iOS 17+: trata o som da página como mídia (toca mesmo com a chave de silencioso).
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  } catch {
    /* sem audioSession */
  }
  silentUrl ??= URL.createObjectURL(toWav(new Float32Array(RATE / 20)));
  pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const el = makeAudio();
    if (!el) continue;
    el.src = silentUrl;
    el.play().catch(() => undefined);
    pool.push(el);
  }
  const c = audioContext();
  if (c) {
    // Um buffer mudo dentro do gesto destrava o Web Audio no Safari.
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch {
      /* ignora */
    }
  }
}

if (typeof window !== 'undefined') {
  // pointerdown não conta como gesto no toque (celular): usamos os eventos que contam.
  const onGesture = () => {
    unlock();
    if (unlocked) {
      for (const ev of ['pointerup', 'touchend', 'click', 'keydown'] as const)
        window.removeEventListener(ev, onGesture, true);
    }
  };
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown'] as const)
    window.addEventListener(ev, onGesture, true);
}

/** Toca o mesmo desenho pelo Web Audio (reserva, quando o <audio> é recusado). */
function playWebAudio(kind: SoundKind, volume: number) {
  const c = audioContext();
  if (!c) return;
  const go = () => {
    try {
      const master = c.createGain();
      master.gain.value = Math.max(0.05, volume) * 0.6;
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
        g.gain.setValueAtTime(FLOOR, start);
        g.gain.exponentialRampToValueAtTime(n.gain ?? 0.5, start + ATTACK);
        g.gain.exponentialRampToValueAtTime(FLOOR, stop);
        o.connect(g).connect(master);
        o.start(start);
        o.stop(stop + 0.02);
        end = Math.max(end, n.at + n.dur);
      }
      window.setTimeout(() => master.disconnect(), (end + 0.3) * 1000);
    } catch {
      /* sem áudio: segue só com o aviso visual */
    }
  };
  // Agenda só depois do contexto rodar: antes disso o relógio está parado e o toque se perde.
  if (c.state === 'running') go();
  else
    c.resume()
      .then(() => {
        if (c.state === 'running') go();
      })
      .catch(() => undefined);
}

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
  if (typeof window === 'undefined') return;
  // Chamado de um clique ("Testar"): o próprio clique serve de gesto.
  unlock();
  const volume = settings.volume;
  let el = pool.length ? pool[poolNext++ % pool.length] : makeAudio();
  if (!el) return playWebAudio(kind, volume);
  try {
    el.src = soundUrl(kind, volume);
    el.currentTime = 0;
    const p = el.play();
    if (p) p.catch(() => playWebAudio(kind, volume));
  } catch {
    el = null;
    playWebAudio(kind, volume);
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
