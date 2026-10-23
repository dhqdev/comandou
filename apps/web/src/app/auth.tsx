import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError, isSuspended, Me, TENANT_SUSPENDED_EVENT } from '../lib/api';
import { closeRealtime } from '../lib/realtime';

interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated' | 'unavailable' | 'suspended';
  me?: Me;
  error?: string;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Pick<AuthState, 'status' | 'me' | 'error'>>({
    status: 'loading',
  });

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>('/auth/me');
      setState({ status: 'authenticated', me });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ status: 'anonymous' });
      else if (e instanceof ApiError && isSuspended(e.body)) setState({ status: 'suspended' });
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
    window.addEventListener(TENANT_SUSPENDED_EVENT, onSuspended);
    return () => window.removeEventListener(TENANT_SUSPENDED_EVENT, onSuspended);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      await api('/auth/login', { method: 'POST', json: { email, password } });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    closeRealtime();
    setState({ status: 'anonymous' });
  }, []);

  return <Ctx.Provider value={{ ...state, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}

export function useCan(permission: string): boolean {
  return useAuth().me?.permissions.includes(permission) ?? false;
}
