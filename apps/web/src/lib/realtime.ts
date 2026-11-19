import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { emitRealtimeReady } from './realtime-ready';

export { onRealtimeReady } from './realtime-ready';

/** Áreas sem evento próprio: qualquer gravação nelas avisa as outras telas abertas. */
export type LiveArea = 'finance' | 'customers' | 'team' | 'agenda';

export type RealtimeEvent =
  | { type: 'data.changed'; area: LiveArea }
  | { type: 'order.changed'; orderId: string; status?: string }
  | { type: 'kitchen.changed'; orderId: string }
  | { type: 'kitchen.settings' }
  | { type: 'tab.changed'; tabId: string }
  | { type: 'cash.changed'; sessionId: string }
  | { type: 'menu.changed' }
  | { type: 'channels.changed' }
  // Repasses e o que os pedidos dos aplicativos renderam foram lidos de novo.
  | { type: 'channels.finance' }
  // Avaliações dos aplicativos lidas de novo ou respondidas.
  | { type: 'channels.reviews' }
  | { type: 'ifood.sync'; menuId: string }
  | { type: 'store.changed' }
  | { type: 'stock.changed' }
  | { type: 'delivery.changed'; deliveryId: string }
  | {
      type: 'delivery.location';
      deliveryId: string;
      lat: number;
      lng: number;
      heading: number | null;
      speed: number | null;
      at: string;
    }
  | { type: 'print.changed' }
  | { type: 'fiscal.changed'; documentId: string; orderId: string }
  | { type: 'reservation.changed'; reservationId: string }
  | { type: 'chat.message'; conversationId: string; messageId: string; authorId: string | null }
  | { type: 'chat.changed'; conversationId?: string }
  | { type: 'chat.read'; conversationId: string; userId: string }
  | { type: 'chat.typing'; conversationId: string; userId: string; name: string }
  | { type: 'chat.mural' }
  | { type: 'chat.notice' }
  | { type: 'support.message'; chatId: string; messageId: string; sender: string }
  | { type: 'support.read'; chatId: string; by: 'customer' | 'staff' }
  | { type: 'support.typing'; chatId: string; by: 'customer' | 'staff'; name?: string }
  | { type: 'help.message'; messageId: string; sender: string }
  | { type: 'help.read' };

type Listener = (e: RealtimeEvent) => void;
type StatusListener = (s: RealtimeStatus) => void;
export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/**
 * Uma conexão por aba, compartilhada pelas telas. Eventos são só avisos de "algo mudou":
 * a tela sempre busca o estado oficial pela API. Ao (re)conectar, todas as telas recarregam
 * (reconciliação), porque eventos perdidos durante a queda não são reenviados.
 */
let socket: Socket | null = null;
let status: RealtimeStatus = 'connecting';
const listeners = new Set<Listener>();
const reconnectListeners = new Set<() => void>();
const statusListeners = new Set<StatusListener>();

function setStatus(s: RealtimeStatus) {
  status = s;
  statusListeners.forEach((l) => l(s));
}

function ensureSocket() {
  if (socket || typeof window === 'undefined') return;
  socket = io({ path: '/api/ws', transports: ['websocket', 'polling'], withCredentials: true });
  socket.on('ready', () => {
    setStatus('live');
    reconnectListeners.forEach((l) => l());
    emitRealtimeReady();
  });
  socket.on('disconnect', () => setStatus('offline'));
  socket.on('connect_error', () => setStatus('offline'));
  socket.on('event', (e: RealtimeEvent) => listeners.forEach((l) => l(e)));
}

export function closeRealtime() {
  socket?.close();
  socket = null;
  setStatus('connecting');
}

/**
 * Assina eventos do restaurante. `onEvent` decide se recarrega; `reload` roda em toda (re)conexão.
 */
export function useRealtime(onEvent: Listener, reload?: () => void) {
  const ev = useRef(onEvent);
  const rl = useRef(reload);
  ev.current = onEvent;
  rl.current = reload;
  useEffect(() => {
    ensureSocket();
    const l: Listener = (e) => ev.current(e);
    const r = () => rl.current?.();
    listeners.add(l);
    reconnectListeners.add(r);
    return () => {
      listeners.delete(l);
      reconnectListeners.delete(r);
    };
  }, []);
}

/**
 * Escuta os eventos; com `connect` false, sem abrir a conexão (só ouve se outra tela já abriu).
 */
export function useRealtimeEvents(onEvent: Listener, connect = true) {
  const ev = useRef(onEvent);
  ev.current = onEvent;
  useEffect(() => {
    if (connect) ensureSocket();
    const l: Listener = (e) => ev.current(e);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [connect]);
}

export function useRealtimeStatus(): RealtimeStatus {
  const [s, setS] = useState(status);
  useEffect(() => {
    ensureSocket();
    statusListeners.add(setS);
    setS(status);
    return () => {
      statusListeners.delete(setS);
    };
  }, []);
  return s;
}

/**
 * Tempo de ida e volta até o servidor pela própria conexão do tempo real, em milissegundos.
 * `null` = sem conexão ou sem resposta dentro do prazo.
 */
export function measureRtt(timeoutMs = 4000): Promise<number | null> {
  ensureSocket();
  const s = socket;
  if (!s?.connected) return Promise.resolve(null);
  const started = performance.now();
  return new Promise((resolve) => {
    s.timeout(timeoutMs).emit('rtt', (err: Error | null) =>
      resolve(err ? null : Math.round(performance.now() - started)),
    );
  });
}

/**
 * Escuta as telas que dependem de áreas sem evento próprio (Financeiro, Clientes, Equipe…):
 * recarrega quando alguém grava nelas ou quando chega um dos `also` (ex.: pedido pago muda o
 * financeiro). Várias mudanças seguidas viram uma recarga só, e a tela escondida não recarrega
 * até voltar a aparecer.
 */
export function useLiveData(
  areas: LiveArea[],
  reload: () => void,
  also: RealtimeEvent['type'][] = [],
  ms = 800,
) {
  const pending = useRef(false);
  const rl = useRef(reload);
  rl.current = reload;
  const run = useDebounced(() => {
    if (typeof document !== 'undefined' && document.hidden) pending.current = true;
    else rl.current();
  }, ms);
  const match = useRef<(e: RealtimeEvent) => boolean>(() => false);
  match.current = (e) =>
    (e.type === 'data.changed' && areas.includes(e.area)) || also.includes(e.type);
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && pending.current) {
        pending.current = false;
        rl.current();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  useRealtime(
    (e) => {
      if (match.current(e)) run();
    },
    () => rl.current(),
  );
}

/** Agrupa vários eventos seguidos em uma única recarga. */
export function useDebounced(fn: () => void, ms = 250) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const f = useRef(fn);
  f.current = fn;
  useEffect(
    () => () => {
      if (t.current) clearTimeout(t.current);
    },
    [],
  );
  return () => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => f.current(), ms);
  };
}
