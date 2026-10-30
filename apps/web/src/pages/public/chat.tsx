import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { useToast } from '../../design-system';
import { api } from '../../lib/api';
import { playSound } from '../../lib/sounds';
import { useStore } from './context';

/** Evento da conversa (o servidor só manda ids; a tela busca as mensagens pela API). */
export type ChatEvent =
  | { type: 'support.message'; chatId: string; messageId: string; sender: string }
  | { type: 'support.read'; chatId: string; by: 'customer' | 'staff' }
  | { type: 'support.typing'; chatId: string; by: 'customer' | 'staff'; name?: string }
  | { type: 'ready' };

interface ChatCtx {
  enabled: boolean;
  unread: number;
  hasChat: boolean;
  /** A conversa existe agora (o aparelho passa a ouvir o tempo real). */
  started(): void;
  refresh(): void;
  /** A tela da conversa está aberta (não conta como não lida nem avisa). */
  setOpen(open: boolean): void;
  listen(fn: (e: ChatEvent) => void): () => void;
}

const Ctx = createContext<ChatCtx>({
  enabled: false,
  unread: 0,
  hasChat: false,
  started: () => undefined,
  refresh: () => undefined,
  setOpen: () => undefined,
  listen: () => () => undefined,
});
export const useStoreChat = () => useContext(Ctx);

/**
 * Estado da conversa com a loja no cardápio: bolinha de não lidas na aba e aviso quando a loja
 * responde com o cliente em outra tela. O tempo real só abre depois que existe uma conversa.
 */
export function StoreChatProvider({ children }: { children: ReactNode }) {
  const { menu, account } = useStore();
  const toast = useToast();
  const enabled = menu.appearance.chatEnabled !== false;
  const [unread, setUnread] = useState(0);
  const [hasChat, setHasChat] = useState(false);
  const open = useRef(false);
  const listeners = useRef(new Set<(e: ChatEvent) => void>());
  const customerId = account?.customer?.id ?? null;

  const refresh = useCallback(() => {
    if (!enabled) return;
    void api<{ unread: number; hasChat: boolean }>('/store/chat/unread')
      .then((r) => {
        setHasChat(r.hasChat);
        setUnread(open.current ? 0 : r.unread);
      })
      .catch(() => undefined);
  }, [enabled]);

  // Ao abrir, ao entrar/sair da conta e ao voltar para a aba.
  useEffect(() => {
    if (account === null) return;
    refresh();
  }, [refresh, account === null, customerId]);
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  // Tempo real da conversa; se cair, confere de tempos em tempos.
  useEffect(() => {
    if (!enabled || !hasChat) return;
    let socket: Socket | null = io({
      path: '/api/ws',
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    let live = false;
    socket.on('ready', () => {
      live = true;
      listeners.current.forEach((l) => l({ type: 'ready' }));
      refresh();
    });
    socket.on('disconnect', () => (live = false));
    socket.on('event', (e: ChatEvent) => {
      listeners.current.forEach((l) => l(e));
      if (e.type === 'support.message' && e.sender !== 'customer') {
        if (open.current && document.visibilityState === 'visible') return;
        setUnread((n) => n + 1);
        playSound('message');
        navigator.vibrate?.([20, 60, 20]);
        if (!open.current) toast('Nova mensagem da loja 💬', 'neutral');
      }
    });
    const poll = window.setInterval(() => {
      if (!live && document.visibilityState === 'visible') {
        refresh();
        listeners.current.forEach((l) => l({ type: 'ready' }));
      }
    }, 15_000);
    return () => {
      window.clearInterval(poll);
      socket?.close();
      socket = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasChat, customerId]);

  const value = useMemo<ChatCtx>(
    () => ({
      enabled,
      unread,
      hasChat,
      started: () => setHasChat(true),
      refresh,
      setOpen: (v) => {
        open.current = v;
        if (v) setUnread(0);
      },
      listen: (fn) => {
        listeners.current.add(fn);
        return () => {
          listeners.current.delete(fn);
        };
      },
    }),
    [enabled, unread, hasChat, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
