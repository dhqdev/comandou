import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

type Tone = 'neutral' | 'success' | 'danger';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

// No celular, confirmações viram uma pílula pequena no topo que some rápido;
// erros continuam no formato cheio e ficam o tempo normal.
const MOBILE = '(max-width: 640px)';
const isMobile = () => typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE).matches;

const ToastCtx = createContext<(message: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Tone = 'neutral') => {
    const id = Date.now() + Math.random();
    const quiet = tone !== 'danger' && isMobile();
    // Uma pílula por vez: a nova substitui a anterior em vez de empilhar.
    setToasts((t) => [
      ...(quiet ? t.filter((x) => x.tone === 'danger') : t),
      { id, message, tone },
    ]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), quiet ? 1800 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="cm-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`cm-toast ${t.tone !== 'neutral' ? `cm-toast--${t.tone}` : ''}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
