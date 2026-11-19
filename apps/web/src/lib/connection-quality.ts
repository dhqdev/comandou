import { useEffect, useState } from 'react';
import { measureRtt, RealtimeStatus, useRealtimeStatus } from './realtime';
import { useOnline } from './connectivity';

/** 0 = sem conexão, 4 = excelente (as barrinhas do sinal). */
export type SignalLevel = 0 | 1 | 2 | 3 | 4;

export interface ConnectionQuality {
  level: SignalLevel;
  /** Palavra curta para o topo: Excelente, Boa, Lenta, Ruim, Sem conexão… */
  label: string;
  /** Frase para quem abre o detalhe. */
  hint: string;
  /** Mediana das últimas medições, em ms (null enquanto não mediu ou sem conexão). */
  rtt: number | null;
  /** Medições recentes (null = não respondeu a tempo), da mais antiga para a mais nova. */
  samples: (number | null)[];
  realtime: RealtimeStatus;
  online: boolean;
  /** Tipo de rede informado pelo navegador (wifi, 4g…), quando ele conta. */
  network: string | null;
}

const EVERY_MS = 5000;
const TIMEOUT_MS = 4000;
const KEEP = 6;

/** Tempo de resposta → barrinhas. Medição sem resposta conta como muito lenta. */
export function levelOf(samples: (number | null)[]): { level: SignalLevel; rtt: number | null } {
  const recent = samples.slice(-3);
  if (!recent.length) return { level: 0, rtt: null };
  const ok = recent.filter((v): v is number => v !== null);
  // Duas ou mais sem resposta seguidas: está caindo.
  if (recent.length >= 2 && ok.length <= recent.length - 2) return { level: 1, rtt: null };
  const sorted = recent.map((v) => v ?? TIMEOUT_MS).sort((a, b) => a - b);
  const rtt = sorted[Math.floor(sorted.length / 2)]!;
  const level: SignalLevel = rtt <= 150 ? 4 : rtt <= 350 ? 3 : rtt <= 800 ? 2 : 1;
  return { level, rtt: rtt >= TIMEOUT_MS ? null : rtt };
}

const LABELS: Record<SignalLevel, [string, string]> = {
  4: ['Excelente', 'A conexão está ótima. Tudo atualiza na hora, sem precisar recarregar.'],
  3: ['Boa', 'A conexão está boa. Tudo atualiza sozinho em poucos instantes.'],
  2: ['Lenta', 'A conexão está lenta. As telas ainda atualizam, mas podem demorar um pouco.'],
  1: [
    'Ruim',
    'A conexão está ruim. Se puder, aproxime-se do roteador ou troque de rede. O que for salvo sem internet espera a conexão voltar.',
  ],
  0: ['Sem conexão', ''],
};

// Uma medição por aba, compartilhada por quem mostra o sinal.
let samples: (number | null)[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
const subs = new Set<() => void>();

function notify() {
  subs.forEach((f) => f());
}

async function tick() {
  timer = null;
  if (!subs.size) return;
  if (!document.hidden && !running) {
    running = true;
    const v = await measureRtt(TIMEOUT_MS);
    running = false;
    samples = [...samples, v].slice(-KEEP);
    notify();
  }
  if (subs.size) timer = setTimeout(() => void tick(), EVERY_MS);
}

/** Mede de novo agora, algumas vezes seguidas (botão "Testar agora"). */
export async function testNow(times = 3) {
  for (let i = 0; i < times; i++) {
    const v = await measureRtt(TIMEOUT_MS);
    samples = [...samples, v].slice(-KEEP);
    notify();
  }
}

function networkType(): string | null {
  const c = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } })
    .connection;
  if (!c) return null;
  if (c.type === 'wifi') return 'Wi-Fi';
  if (c.type === 'ethernet') return 'Cabo de rede';
  if (c.type === 'cellular') return `Dados móveis${c.effectiveType ? ` (${c.effectiveType})` : ''}`;
  return null;
}

export function useConnectionQuality(): ConnectionQuality {
  const online = useOnline();
  const realtime = useRealtimeStatus();
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    if (!timer && !running) timer = setTimeout(() => void tick(), 300);
    const onVisible = () => {
      if (!document.hidden && !timer && !running) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      subs.delete(f);
      document.removeEventListener('visibilitychange', onVisible);
      if (!subs.size && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
  // Ao (re)conectar, as medições da queda não valem mais.
  useEffect(() => {
    samples = [];
  }, [realtime]);

  const network = typeof navigator === 'undefined' ? null : networkType();
  if (!online)
    return {
      level: 0,
      label: 'Sem internet',
      hint: 'Este aparelho está sem internet. O que for salvo fica guardado aqui e vai quando a conexão voltar.',
      rtt: null,
      samples,
      realtime,
      online,
      network,
    };
  if (realtime !== 'live')
    return {
      level: 0,
      label: realtime === 'connecting' ? 'Conectando…' : 'Reconectando…',
      hint: 'A internet do aparelho funciona, mas a ligação com o Comandou caiu. Ela volta sozinha e as telas se atualizam quando voltar.',
      rtt: null,
      samples,
      realtime,
      online,
      network,
    };
  const { level, rtt } = levelOf(samples);
  // Conectado e ainda sem medir: mostra como boa até a primeira medição.
  const shown: SignalLevel = samples.length ? (level === 0 ? 1 : level) : 3;
  const [label, hint] = samples.length ? LABELS[shown] : ['Medindo…', 'Medindo a conexão…'];
  return { level: shown, label, hint, rtt, samples, realtime, online, network };
}
