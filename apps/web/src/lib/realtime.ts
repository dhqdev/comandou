import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export type RealtimeEvent =
  | { type: 'order.changed'; orderId: string; status?: string }
  | { type: 'kitchen.changed'; orderId: string }
  | { type: 'tab.changed'; tabId: string }
  | { type: 'cash.changed'; sessionId: string }
  | { type: 'menu.changed' }
  | { type: 'stock.changed' }
  | { type: 'delivery.changed'; deliveryId: string }
  | { type: 'print.changed' };

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
