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

/** Timbres prontos que o usuário pode escolher para qualquer aviso, além do padrão de cada um. */
export type SoundTone =
  'padrao' | 'campainha' | 'marimba' | 'sino' | 'kalimba' | 'alerta' | 'gravado';

export const TONE_INFO: { tone: SoundTone; label: string }[] = [
  { tone: 'padrao', label: 'Padrão' },
  { tone: 'campainha', label: 'Campainha' },
  { tone: 'marimba', label: 'Marimba' },
  { tone: 'sino', label: 'Sinos de vento' },
  { tone: 'kalimba', label: 'Kalimba' },
  { tone: 'alerta', label: 'Alerta forte' },
  { tone: 'gravado', label: 'Som gravado' },
];

/** Avisos que ficam tocando de novo enquanto ninguém resolve (aceitar o pedido, responder o cancelamento). */
export const REPEATING_KINDS: SoundKind[] = ['order', 'cancel'];

export interface SoundSettings {
  enabled: boolean;
  volume: number;
  off: SoundKind[];
  /** Timbre escolhido por aviso (ausente = padrão). */
  tones: Partial<Record<SoundKind, SoundTone>>;
  /** Repetir o aviso até alguém resolver. */
  repeat: boolean;
  /** Intervalo da repetição, em segundos. */
  repeatEvery: number;
  /** Há um som gravado guardado neste aparelho (evita abrir o banco local à toa). */
  recorded: boolean;
}

const KEY = 'cm.sounds';
const DEFAULTS: SoundSettings = {
  enabled: true,
  volume: 0.7,
  off: [],
  tones: {},
  repeat: true,
  repeatEvery: 10,
  recorded: false,
};
export const REPEAT_OPTIONS = [5, 10, 20, 30, 60];

function read(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      enabled: v.enabled ?? DEFAULTS.enabled,
      volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : DEFAULTS.volume,
      off: Array.isArray(v.off) ? v.off : [],
      tones: v.tones && typeof v.tones === 'object' ? v.tones : {},
      repeat: v.repeat ?? DEFAULTS.repeat,
      repeatEvery: REPEAT_OPTIONS.includes(v.repeatEvery as number)
        ? (v.repeatEvery as number)
        : DEFAULTS.repeatEvery,
      recorded: v.recorded === true,
    };
  } catch {
    return DEFAULTS;
  }
}

let settings = read();
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

/** Grava só quando o usuário muda algo (abrir a página não cria nada no aparelho). */
export function setSoundSettings(patch: Partial<SoundSettings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* armazenamento indisponível: vale só nesta aba */
  }
  notify();
}

export function toggleSoundKind(kind: SoundKind, on: boolean) {
  const off = settings.off.filter((k) => k !== kind);
  setSoundSettings({ off: on ? off : [...off, kind] });
}

export function setSoundTone(kind: SoundKind, tone: SoundTone) {
  const tones = { ...settings.tones };
  if (tone === 'padrao') delete tones[kind];
  else tones[kind] = tone;
  setSoundSettings({ tones });
}

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(
    subscribe,
    () => settings,
    () => DEFAULTS,
  );
}

/** Instrumento sintetizado: parciais (múltiplo da frequência, força) e quanto a nota soa. */
export type Instrument = 'bell' | 'marimba' | 'glass' | 'kalimba' | 'soft';

const INSTRUMENTS: Record<Instrument, { partials: [number, number][]; decay: number }> = {
  // Sino de porta: harmônicos quase inteiros, soa longo.
  bell: {
    partials: [
      [1, 1],
      [2, 0.45],
      [3, 0.22],
      [4.2, 0.12],
      [5.4, 0.06],
    ],
    decay: 1,
  },
  // Marimba: fundamental redonda com o 4º harmônico característico, curta.
  marimba: {
    partials: [
      [1, 1],
      [3.93, 0.3],
      [9.2, 0.06],
    ],
    decay: 0.45,
  },
  // Taça/sino de vento: parciais inarmônicos, brilhante.
  glass: {
    partials: [
      [1, 1],
      [2.76, 0.35],
      [5.4, 0.15],
      [8.93, 0.06],
    ],
    decay: 0.9,
  },
  // Kalimba: ataque de dedo e parciais altos que somem rápido.
  kalimba: {
    partials: [
      [1, 1],
      [3, 0.18],
      [5.9, 0.12],
    ],
    decay: 0.6,
  },
  // Senoide pura com leve segundo harmônico.
  soft: {
    partials: [
      [1, 1],
      [2, 0.12],
    ],
    decay: 0.8,
  },
};

export interface Note {
  /** Início, em segundos, a partir do toque. */
  at: number;
  freq: number;
  /** Quanto a nota soa, em segundos. */
  dur: number;
  /** Instrumento sintetizado (padrão: sino). */
  inst?: Instrument;
  gain?: number;
  /** Frequência final (glissando). */
  to?: number;
}

/* Notas usadas nos toques (Hz). */
const A4 = 440;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const B5 = 987.77;
const C6 = 1046.5;
const D6 = 1174.66;
const E6 = 1318.5;
const G6 = 1567.98;
const C7 = 2093;
const E7 = 2637;

/** Desenho de cada aviso: timbre e ritmo diferentes para não confundir na correria. */
const PATTERNS: Record<SoundKind, Note[]> = {
  // Campainha "dim-dom", duas vezes, com sino de verdade.
  order: [
    { at: 0, freq: E6, dur: 0.9 },
    { at: 0.32, freq: C6, dur: 1.3 },
    { at: 1.05, freq: E6, dur: 0.9 },
    { at: 1.37, freq: C6, dur: 1.5 },
  ],
  // Marimba "tin-tin-tim": pedido entrou na fila.
  kitchen: [
    { at: 0, freq: A5, dur: 0.35, inst: 'marimba' },
    { at: 0.15, freq: A5, dur: 0.35, inst: 'marimba' },
    { at: 0.3, freq: E6, dur: 0.6, inst: 'marimba' },
  ],
  // Arpejo subindo na marimba (dó-mi-sol-dó): "ficou pronto".
  ready: [
    { at: 0, freq: C5, dur: 0.5, inst: 'marimba' },
    { at: 0.11, freq: E5, dur: 0.5, inst: 'marimba' },
    { at: 0.22, freq: G5, dur: 0.5, inst: 'marimba' },
    { at: 0.33, freq: C6, dur: 0.9, inst: 'marimba' },
  ],
  // Dois toques de taça, duas vezes: esperando entregador.
  delivery: [
    { at: 0, freq: G5, dur: 0.6, inst: 'glass' },
    { at: 0.18, freq: D6, dur: 0.9, inst: 'glass' },
    { at: 0.6, freq: G5, dur: 0.6, inst: 'glass' },
    { at: 0.78, freq: D6, dur: 1, inst: 'glass' },
  ],
  // Kalimba subindo: chamada de corrida.
  courier: [
    { at: 0, freq: G5, dur: 0.5, inst: 'kalimba' },
    { at: 0.1, freq: B5, dur: 0.5, inst: 'kalimba' },
    { at: 0.2, freq: D6, dur: 0.5, inst: 'kalimba' },
    { at: 0.3, freq: G6, dur: 0.9, inst: 'kalimba' },
  ],
  // Dois tons suaves: tarefa concluída.
  delivered: [
    { at: 0, freq: B5, dur: 0.5, inst: 'soft', gain: 0.8 },
    { at: 0.14, freq: E6, dur: 0.9, inst: 'soft', gain: 0.8 },
  ],
  // Sininho de caixa registradora.
  bill: [
    { at: 0, freq: C7, dur: 0.35, inst: 'glass', gain: 0.7 },
    { at: 0.08, freq: E7, dur: 0.35, inst: 'glass', gain: 0.7 },
    { at: 0.16, freq: G6 * 2, dur: 0.9, inst: 'glass', gain: 0.7 },
  ],
  // Marimba grave descendo, duas vezes: atenção sem ser estridente.
  cancel: [
    { at: 0, freq: E5, dur: 0.4, inst: 'marimba' },
    { at: 0.16, freq: C5, dur: 0.4, inst: 'marimba' },
    { at: 0.32, freq: A4, dur: 0.7, inst: 'marimba' },
    { at: 0.9, freq: E5, dur: 0.4, inst: 'marimba' },
    { at: 1.06, freq: C5, dur: 0.4, inst: 'marimba' },
    { at: 1.22, freq: A4, dur: 0.8, inst: 'marimba' },
  ],
};

/** Timbres prontos, iguais para qualquer aviso. */
const TONES: Record<Exclude<SoundTone, 'padrao' | 'gravado'>, Note[]> = {
  campainha: PATTERNS.order,
  marimba: [
    { at: 0, freq: G5, dur: 0.45, inst: 'marimba' },
    { at: 0.13, freq: C6, dur: 0.45, inst: 'marimba' },
    { at: 0.26, freq: E6, dur: 0.45, inst: 'marimba' },
    { at: 0.39, freq: G6, dur: 0.45, inst: 'marimba' },
    { at: 0.52, freq: E6, dur: 0.45, inst: 'marimba' },
    { at: 0.65, freq: C6, dur: 0.8, inst: 'marimba' },
  ],
  sino: [
    { at: 0, freq: E6, dur: 1.4, inst: 'glass', gain: 0.6 },
    { at: 0.17, freq: G6, dur: 1.4, inst: 'glass', gain: 0.5 },
    { at: 0.3, freq: C7, dur: 1.4, inst: 'glass', gain: 0.45 },
    { at: 0.52, freq: D6 * 2, dur: 1.6, inst: 'glass', gain: 0.4 },
    { at: 0.7, freq: G6, dur: 1.8, inst: 'glass', gain: 0.4 },
  ],
  kalimba: [
    { at: 0, freq: C6, dur: 0.6, inst: 'kalimba' },
    { at: 0.16, freq: E6, dur: 0.6, inst: 'kalimba' },
    { at: 0.32, freq: G5, dur: 0.6, inst: 'kalimba' },
    { at: 0.48, freq: C6, dur: 0.6, inst: 'kalimba' },
    { at: 0.72, freq: G6, dur: 1, inst: 'kalimba' },
  ],
  // Rápido e insistente, para cozinha barulhenta, mas ainda com timbre de sino.
  alerta: [0, 0.42, 0.84].flatMap((t) => [
    { at: t, freq: A5, dur: 0.3, inst: 'bell' as const },
    { at: t + 0.14, freq: E6, dur: 0.45, inst: 'bell' as const },
  ]),
};

/** Notas que o aviso toca com o timbre escolhido (o gravado volta ao padrão se faltar). */
export function notesFor(kind: SoundKind, tone: SoundTone = 'padrao'): Note[] {
  if (tone === 'padrao' || tone === 'gravado') return PATTERNS[kind];
  return TONES[tone];
}

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

const ATTACK = 0.006;
/** Cauda de eco curto (ambiente), em segundos. */
const TAIL = 0.45;

/**
 * Sintetiza o toque em amostras: cada nota soma os parciais do instrumento, com ataque curto e
 * queda exponencial (parciais altos somem antes, como num sino de verdade). Depois passa por um
 * eco curto que dá corpo e é normalizado, para todo timbre sair com a mesma altura no volume escolhido.
 */
export function renderPattern(notes: Note[], volume: number): Float32Array {
  const end = notes.reduce((m, n) => Math.max(m, n.at + n.dur), 0) + TAIL;
  const out = new Float32Array(Math.ceil(end * RATE));
  for (const n of notes) {
    const spec = INSTRUMENTS[n.inst ?? 'bell'];
    const peak = n.gain ?? 0.6;
    const start = Math.floor(n.at * RATE);
    const len = Math.min(Math.floor(n.dur * RATE), out.length - start);
    // Constante de queda: instrumento de "decay" maior segura a nota por mais tempo.
    const tau = n.dur * (0.15 + 0.15 * spec.decay);
    const phases = spec.partials.map(() => 0);
    for (let i = 0; i < len; i++) {
      const t = i / RATE;
      const freq = n.to ? n.freq * Math.pow(n.to / n.freq, t / n.dur) : n.freq;
      const attack = t < ATTACK ? t / ATTACK : 1;
      // Fade final de 20 ms para não estalar.
      const release = Math.min(1, (len - i) / (0.02 * RATE));
      let sample = 0;
      for (let p = 0; p < spec.partials.length; p++) {
        const [ratio, amp] = spec.partials[p];
        const f = freq * ratio;
        if (f >= RATE / 2) continue;
        phases[p] = (phases[p] + f / RATE) % 1;
        sample +=
          Math.sin(2 * Math.PI * phases[p]) * amp * Math.exp(-t / (tau / (1 + (ratio - 1) * 0.35)));
      }
      out[start + i] += sample * peak * attack * release;
    }
  }
  // Eco curto (duas reflexões), dá a sensação de ambiente sem embolar.
  const d1 = Math.floor(0.083 * RATE);
  const d2 = Math.floor(0.131 * RATE);
  for (let i = out.length - 1; i >= d2; i--) out[i] += out[i - d1] * 0.18 + out[i - d2] * 0.1;
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  const target = Math.max(0.05, Math.min(1, volume)) * 0.9;
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / max) * target;
  return out;
}

const urls = new Map<string, string>();

function synthUrl(kind: SoundKind, tone: SoundTone, volume: number): string {
  const key = `${kind}:${tone}:${Math.round(volume * 100)}`;
  let url = urls.get(key);
  if (!url) {
    url = URL.createObjectURL(toWav(renderPattern(notesFor(kind, tone), volume)));
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

/** Toca as mesmas amostras pelo Web Audio (reserva, quando o <audio> é recusado). */
function playWebAudio(notes: Note[], volume: number) {
  const c = audioContext();
  if (!c) return;
  const go = () => {
    try {
      const samples = renderPattern(notes, volume);
      const buffer = c.createBuffer(1, samples.length, RATE);
      buffer.getChannelData(0).set(samples);
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      src.start(c.currentTime + 0.02);
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

/* ------------------------------------------------------------- som gravado */

/*
 * O som gravado (microfone ou arquivo) fica no IndexedDB deste aparelho, nunca no servidor.
 * O banco só é aberto quando o usuário grava ou quando há gravação marcada nos ajustes.
 */

const DB = 'cm-sounds';
const STORE = 'clips';
const CLIP = 'custom';
/** Limite do som gravado: 15 s ou 3 MB. */
export const MAX_RECORD_SECONDS = 15;
export const MAX_CLIP_BYTES = 3 * 1024 * 1024;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Banco local indisponível'));
  });
}

async function dbOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Falha no banco local'));
    });
  } finally {
    db.close();
  }
}

let clipUrl: string | null = null;
let clipLoading: Promise<string | null> | null = null;

/** Endereço local do som gravado (carrega do banco uma vez). */
export function customClipUrl(): Promise<string | null> {
  if (!settings.recorded || typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (clipUrl) return Promise.resolve(clipUrl);
  clipLoading ??= dbOp<Blob | undefined>(
    'readonly',
    (s) => s.get(CLIP) as IDBRequest<Blob | undefined>,
  )
    .then((blob) => {
      clipUrl = blob ? URL.createObjectURL(blob) : null;
      return clipUrl;
    })
    .catch(() => null)
    .finally(() => {
      clipLoading = null;
    });
  return clipLoading;
}

/** Guarda o som gravado e passa a usá-lo no aviso de novo pedido (o usuário pode trocar depois). */
export async function saveCustomClip(blob: Blob) {
  if (blob.size > MAX_CLIP_BYTES) throw new Error('O som passa de 3 MB. Use um trecho mais curto.');
  await dbOp('readwrite', (s) => s.put(blob, CLIP));
  if (clipUrl) URL.revokeObjectURL(clipUrl);
  clipUrl = URL.createObjectURL(blob);
  const first = !settings.recorded;
  setSoundSettings({
    recorded: true,
    tones: first ? { ...settings.tones, order: 'gravado' } : settings.tones,
  });
}

export async function deleteCustomClip() {
  await dbOp('readwrite', (s) => s.delete(CLIP)).catch(() => undefined);
  if (clipUrl) URL.revokeObjectURL(clipUrl);
  clipUrl = null;
  const tones = { ...settings.tones };
  for (const k of Object.keys(tones) as SoundKind[]) if (tones[k] === 'gravado') delete tones[k];
  setSoundSettings({ recorded: false, tones });
}

/** Grava do microfone. Devolve `stop()` para encerrar antes do limite. */
export async function recordFromMic(onDone: (blob: Blob | null, error?: string) => void) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
    throw new Error('Este navegador não grava áudio. Escolha um arquivo de som.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
  });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    window.clearTimeout(limit);
    const blob = chunks.length ? new Blob(chunks, { type: rec.mimeType || chunks[0].type }) : null;
    onDone(blob, blob ? undefined : 'Nada foi gravado.');
  };
  rec.start();
  const limit = window.setTimeout(() => {
    if (rec.state !== 'inactive') rec.stop();
  }, MAX_RECORD_SECONDS * 1000);
  return () => {
    if (rec.state !== 'inactive') rec.stop();
  };
}

/* ---------------------------------------------------------------- tocar */

const lastPlayed = new Map<SoundKind, number>();
/** Até quando a repetição está silenciada (botão "Silenciar"). */
let snoozeUntil = 0;

function playOn(el: HTMLAudioElement, url: string, volume: number, fallback: () => void) {
  try {
    el.src = url;
    el.volume = volume;
    el.currentTime = 0;
    const p = el.play();
    if (p) p.catch(fallback);
  } catch {
    fallback();
  }
}

/**
 * Toca o som do evento (se ligado). Vários eventos iguais em sequência viram um só toque.
 * `force` toca mesmo desligado (botão "testar"); `tone` testa um timbre antes de escolher.
 */
export function playSound(kind: SoundKind, force = false, tone?: SoundTone) {
  // Chegou outro pendente: tira o "silenciar" para ninguém perder o pedido seguinte.
  if (!force && REPEATING_KINDS.includes(kind)) snoozeUntil = 0;
  emit(kind, force, tone);
}

function emit(kind: SoundKind, force = false, tone?: SoundTone) {
  if (!force && (!settings.enabled || settings.off.includes(kind))) return;
  const nowMs = Date.now();
  if (!force && nowMs - (lastPlayed.get(kind) ?? 0) < 1500) return;
  lastPlayed.set(kind, nowMs);
  if (typeof window === 'undefined') return;
  // Chamado de um clique ("Testar"): o próprio clique serve de gesto.
  unlock();
  const volume = settings.volume;
  const chosen = tone ?? settings.tones[kind] ?? 'padrao';
  const el = pool.length ? pool[poolNext++ % pool.length] : makeAudio();
  const synth = () => {
    const tn = chosen === 'gravado' ? 'padrao' : chosen;
    if (!el) return playWebAudio(notesFor(kind, tn), volume);
    playOn(el, synthUrl(kind, tn, volume), 1, () => playWebAudio(notesFor(kind, tn), volume));
  };
  if (chosen !== 'gravado' || !el) return synth();
  // Som gravado: o volume vai no elemento (se faltar a gravação, toca o padrão).
  void customClipUrl().then((url) =>
    url ? playOn(el, url, Math.max(0.05, volume), synth) : synth(),
  );
}

/* ------------------------------------------------------------ repetição */

/*
 * Avisos que pedem ação (pedido esperando aceite, pedido de cancelamento) tocam de novo a cada
 * `repeatEvery` segundos enquanto houver algo pendente em alguma tela aberta. "Silenciar" pausa
 * por alguns minutos; se aparecer outro pendente, o aviso de chegada toca normalmente.
 */

const ringing = new Map<SoundKind, number>();
let ticker: number | null = null;
let ringingSnapshot = false;

function isRinging() {
  if (Date.now() < snoozeUntil || !settings.enabled || !settings.repeat) return false;
  for (const [kind, n] of ringing) if (n > 0 && !settings.off.includes(kind)) return true;
  return false;
}

function tick() {
  const now = Date.now();
  const r = isRinging();
  if (r !== ringingSnapshot) {
    ringingSnapshot = r;
    notify();
  }
  if (!r) return;
  for (const [kind, n] of ringing) {
    if (n <= 0 || settings.off.includes(kind)) continue;
    if (now - (lastPlayed.get(kind) ?? 0) >= settings.repeatEvery * 1000) emit(kind);
  }
}

function syncTicker() {
  const any = [...ringing.values()].some((n) => n > 0);
  if (any && ticker === null && typeof window !== 'undefined')
    ticker = window.setInterval(tick, 1000);
  if (!any && ticker !== null) {
    window.clearInterval(ticker);
    ticker = null;
  }
  tick();
}

/** Para a repetição por `minutes` minutos (botão "Silenciar"). */
export function snoozeAlarms(minutes = 2) {
  snoozeUntil = Date.now() + minutes * 60_000;
  tick();
}

/** Há aviso repetindo agora (o botão de som pisca e oferece "Silenciar"). */
export function useAlarmRinging(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ringingSnapshot,
    () => false,
  );
}

/** Mantém `kind` tocando de tempos em tempos enquanto `active` for verdadeiro. */
export function useRepeatingSound(kind: SoundKind, active: boolean) {
  useEffect(() => {
    if (!active) return;
    // Começa a contar a partir de agora: o aviso de chegada já tocou (ou toca no primeiro gesto).
    if (!lastPlayed.has(kind))
      lastPlayed.set(kind, Date.now() - settings.repeatEvery * 1000 + 3000);
    ringing.set(kind, (ringing.get(kind) ?? 0) + 1);
    syncTicker();
    return () => {
      ringing.set(kind, (ringing.get(kind) ?? 1) - 1);
      syncTicker();
    };
  }, [kind, active]);
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
