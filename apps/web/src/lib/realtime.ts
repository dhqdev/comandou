import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { emitRealtimeReady } from './realtime-ready';
import { checkCacheEpoch, wipeTenantCache } from './tenant-cache';

export { onRealtimeReady } from './realtime-ready';

export type RealtimeEvent =
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
  | { type: 'help.read' }
  // O Super Admin limpou o cache do restaurante: apaga o que o aparelho guardou e recarrega.
  | { type: 'cache.clear'; at: string };

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
  socket.on('ready', (r?: { cacheEpoch?: string | null }) => {
    if (checkCacheEpoch(r?.cacheEpoch)) return;
    setStatus('live');
    reconnectListeners.forEach((l) => l());
    emitRealtimeReady();
  });
  socket.on('disconnect', () => setStatus('offline'));
  socket.on('connect_error', () => setStatus('offline'));
  socket.on('event', (e: RealtimeEvent) => {
    if (e.type === 'cache.clear') return void wipeTenantCache(e.at);
    listeners.forEach((l) => l(e));
  });
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
