import { X } from 'lucide-react';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { currentFixPlan, FixSteps, type FixPlan } from './fix-guide';

type Tone = 'neutral' | 'success' | 'danger';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
  /** Erro conhecido: o que fazer e para onde ir. */
  plan?: FixPlan | null;
}

// No celular, confirmações viram uma pílula pequena no topo que some rápido;
// erros continuam no formato cheio e ficam o tempo normal.
const MOBILE = '(max-width: 640px)';
const isMobile = () => typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE).matches;

/** Navegador com "popover" (camada de cima): o aviso aparece por cima das janelas abertas. */
const POPOVER = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

const ToastCtx = createContext<(message: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const drop = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const box = useRef<HTMLDivElement>(null);
  // Janelas e painéis (<dialog> com showModal) ficam na camada de cima do navegador e cobriam o
  // aviso: um erro ao salvar dentro de uma janela não aparecia. Como popover, a pilha de avisos
  // sobe para a camada de cima, por cima da janela que estiver aberta (reabrir põe no topo).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !POPOVER) return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      if (toasts.length) el.showPopover();
    } catch {
      /* fora do documento ou sem suporte: fica como antes */
    }
  }, [toasts]);
  const push = useCallback(
    (message: string, tone: Tone = 'neutral') => {
      const id = Date.now() + Math.random();
      const quiet = tone !== 'danger' && isMobile();
      const plan = tone === 'danger' ? currentFixPlan(message) : null;
      // Uma pílula por vez: a nova substitui a anterior em vez de empilhar. O mesmo erro
      // guiado não se repete na pilha.
      setToasts((t) => [
        ...(quiet ? t.filter((x) => x.tone === 'danger') : t).filter(
          (x) => !(plan && x.message === message),
        ),
        { id, message, tone, plan },
      ]);
      // Com o caminho para resolver, fica mais tempo: dá para ler e tocar no botão.
      setTimeout(() => drop(id), quiet ? 1800 : plan ? 9000 : 4000);
    },
    [drop],
  );
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        ref={box}
        className="cm-toasts"
        aria-live="polite"
        popover={POPOVER ? 'manual' : undefined}
      >
        {toasts.map((t) =>
          t.plan ? (
            <div key={t.id} className="cm-toast cm-toast--danger cm-toast--guide" role="alert">
              <div className="cm-toast__body">
                <p className="cm-fix__error">{t.message}</p>
                <FixSteps plan={t.plan} onGo={() => drop(t.id)} />
              </div>
              <button className="cm-toast__close" aria-label="Fechar" onClick={() => drop(t.id)}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <div
              key={t.id}
              className={`cm-toast ${t.tone !== 'neutral' ? `cm-toast--${t.tone}` : ''}`}
            >
              {t.message}
            </div>
          ),
        )}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
