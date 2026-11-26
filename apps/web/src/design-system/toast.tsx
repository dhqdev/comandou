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
import { createPortal } from 'react-dom';
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

/**
 * Janela aberta com showModal deixa o resto da página "inerte": o aviso aparecia por cima dela,
 * mas o X e o botão "Configurar impressão" não respondiam e o aviso parecia travado na tela. Com
 * uma janela aberta, a pilha de avisos vai para dentro da janela de cima (continua na camada de
 * cima, mas agora recebe toque).
 */
function topModal(): HTMLDialogElement | null {
  if (typeof document === 'undefined') return null;
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => {
    try {
      return d.matches(':modal');
    } catch {
      return true;
    }
  });
  return open.at(-1) ?? null;
}

const ToastCtx = createContext<(message: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const drop = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const box = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLDialogElement | null>(null);
  // Enquanto há aviso: acompanha janelas abrindo e fechando para manter a pilha clicável.
  useLayoutEffect(() => {
    if (!toasts.length) return setHost(null);
    const sync = () =>
      setHost((h) => {
        const next = topModal();
        return next === h ? h : next;
      });
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    return () => mo.disconnect();
  }, [toasts.length]);
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
  }, [toasts, host]);
  const push = useCallback(
    (message: string, tone: Tone = 'neutral') => {
      const id = Date.now() + Math.random();
      const quiet = tone !== 'danger' && isMobile();
      const plan = tone === 'danger' ? currentFixPlan(message) : null;
      // Uma pílula por vez: a nova substitui a anterior em vez de empilhar. O mesmo aviso
      // não se repete na pilha (tocar várias vezes em "Imprimir cozinha" mostra um só).
      setToasts((t) => [
        ...(quiet ? t.filter((x) => x.tone === 'danger') : t).filter((x) => x.message !== message),
        { id, message, tone, plan },
      ]);
      // Com o caminho para resolver, fica mais tempo: dá para ler e tocar no botão.
      setTimeout(() => drop(id), quiet ? 1800 : plan ? 9000 : 4000);
    },
    [drop],
  );
  const portal = (node: ReactNode) => (host ? createPortal(node, host) : node);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {portal(
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
                <button
                  className="cm-toast__close"
                  aria-label="Fechar aviso"
                  onClick={() => drop(t.id)}
                >
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
        </div>,
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
