import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  api,
  ApiError,
  isSuspended,
  Me,
  movedTo,
  SESSION_CHECK_EVENT,
  TENANT_MOVED_EVENT,
  TENANT_SUSPENDED_EVENT,
  warmOfflineCache,
} from '../lib/api';
import {
  cachedMe,
  disableOffline,
  enableOffline,
  forgetMe,
  offlineSnapshot,
  saveMe,
} from '../lib/offline';
import { closeRealtime } from '../lib/realtime';
import { setGuideAccess } from '../design-system/fix-guide';

interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated' | 'unavailable' | 'suspended' | 'moved';
  me?: Me;
  /** Endereço novo do restaurante (quando mudou de servidor). */
  movedTo?: string;
  error?: string;
  login(email: string, password: string): Promise<void>;
  /** Garçom e entregador: só o PIN de 4 números, no app do papel. */
  loginWithPin(pin: string, app: 'waiter' | 'driver'): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Pick<AuthState, 'status' | 'me' | 'error' | 'movedTo'>>({
    status: 'loading',
  });

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>('/auth/me');
      // Liga o modo offline antes das telas pedirem os dados (lib/offline.ts).
      await enableOffline(me.user.id);
      void saveMe(me);
      setState({ status: 'authenticated', me });
      // Depois que a tela abrir, guarda as principais para funcionarem sem internet.
      setTimeout(() => void warmOfflineCache(me.user.id), 3_000);
    } catch (e) {
      // Sem internet: abre com a última sessão guardada neste aparelho, nos dados guardados.
      if (
        e instanceof ApiError &&
        (e.status === 0 || e.status >= 502) &&
        !isSuspended(e.body) &&
        movedTo(e.body) === null
      ) {
        const saved = await cachedMe<Me>();
        if (saved) {
          await enableOffline(saved.user.id);
          setState({ status: 'authenticated', me: saved });
          return;
        }
      }
      if (e instanceof ApiError && e.status === 401) {
        void forgetMe();
        void disableOffline();
        setState({ status: 'anonymous' });
      } else if (e instanceof ApiError && isSuspended(e.body)) setState({ status: 'suspended' });
      else if (e instanceof ApiError && movedTo(e.body) !== null)
        setState({ status: 'moved', movedTo: movedTo(e.body) || undefined });
      else setState({ status: 'unavailable', error: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Suspenso no meio do uso (qualquer chamada à API avisa): fecha o tempo real e mostra o aviso.
  useEffect(() => {
    const onSuspended = () => {
      closeRealtime();
      setState({ status: 'suspended' });
    };
    const onMoved = (e: Event) => {
      closeRealtime();
      setState({ status: 'moved', movedTo: (e as CustomEvent<string>).detail || undefined });
    };
    window.addEventListener(TENANT_SUSPENDED_EVENT, onSuspended);
    window.addEventListener(TENANT_MOVED_EVENT, onMoved);
    return () => {
      window.removeEventListener(TENANT_SUSPENDED_EVENT, onSuspended);
      window.removeEventListener(TENANT_MOVED_EVENT, onMoved);
    };
  }, []);

  // Uma tela recebeu 401: confere a sessão (no máximo a cada 15 s). Acabou mesmo? Volta ao login,
  // em vez de cada tela seguir mostrando "Sessão inválida" e a fila offline ficar parada.
  const status = useRef(state.status);
  status.current = state.status;
  useEffect(() => {
    let last = 0;
    const onCheck = () => {
      if (status.current !== 'authenticated' || Date.now() - last < 15_000) return;
      last = Date.now();
      api('/auth/me').catch((e) => {
        if (!(e instanceof ApiError) || e.status !== 401) return;
        closeRealtime();
        void forgetMe();
        void disableOffline();
        setState({ status: 'anonymous', error: 'Sua sessão terminou. Entre de novo.' });
      });
    };
    window.addEventListener(SESSION_CHECK_EVENT, onCheck);
    return () => window.removeEventListener(SESSION_CHECK_EVENT, onCheck);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      // Fica conectado neste aparelho (a sessão se renova com o uso); "Sair" encerra.
      await api('/auth/login', { method: 'POST', json: { email, password, remember: true } });
      await refresh();
    },
    [refresh],
  );

  const loginWithPin = useCallback(
    async (pin: string, app: 'waiter' | 'driver') => {
      await api('/auth/pin', { method: 'POST', json: { pin, app, remember: true } });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    const pending = offlineSnapshot().pending.length;
    if (
      pending &&
      !window.confirm(
        `${pending === 1 ? 'Uma alteração ainda não foi enviada' : `${pending} alterações ainda não foram enviadas`} para a nuvem. Ela${pending === 1 ? '' : 's'} fica${pending === 1 ? '' : 'm'} guardada${pending === 1 ? '' : 's'} neste aparelho e sobe${pending === 1 ? '' : 'm'} quando você entrar de novo com internet. Sair mesmo assim?`,
      )
    )
      return;
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await forgetMe();
    await disableOffline();
    closeRealtime();
    setState({ status: 'anonymous' });
  }, []);

  // Avisos de erro com o caminho para resolver: precisam saber o que a pessoa pode abrir.
  const me = state.me;
  useEffect(() => {
    setGuideAccess(me ? { perms: me.permissions, role: me.user.role } : null);
    return () => setGuideAccess(null);
  }, [me]);

  return (
    <Ctx.Provider value={{ ...state, login, loginWithPin, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}

export function useCan(permission: string): boolean {
  return useAuth().me?.permissions.includes(permission) ?? false;
}
