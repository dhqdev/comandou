import { ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import './side-panel.css';

/**
 * Painel que DESLIZA da direita por cima da tela (mesma API do Modal). Usado na tela inicial de
 * pedidos: "Novo pedido" e o detalhe do pedido abrem aqui sem tirar o quadro de vista.
 * É um <dialog> nativo: Esc fecha, o foco fica preso dentro e o fundo não recebe cliques.
 */
export function SidePanel({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  actions,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  /** Botões extras no cabeçalho, ao lado do fechar. */
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  /** Só fecha se o clique começou e terminou no fundo (arrastar uma seleção para fora não fecha). */
  const downOutside = useRef(false);
  const outside = (e: {
    target: EventTarget;
    currentTarget: HTMLDialogElement;
    clientX: number;
    clientY: number;
  }) => {
    if (e.target !== e.currentTarget) return false;
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`side-panel side-panel--${size}`}
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => {
        downOutside.current = outside(e);
      }}
      onClick={(e) => {
        // Clique no fundo escurecido (fora do painel) fecha.
        if (downOutside.current && outside(e)) onClose();
        downOutside.current = false;
      }}
      aria-labelledby={titleId}
    >
      <div className="side-panel__inner">
        <header className="side-panel__head">
          <h2 id={titleId} className="side-panel__title">
            {title}
          </h2>
          <div className="side-panel__actions">
            {actions}
            <button
              type="button"
              className="side-panel__close"
              onClick={onClose}
              aria-label="Fechar"
              title="Fechar (Esc)"
            >
              <X size={16} aria-hidden />
              <span className="side-panel__close-text">Fechar</span>
              <kbd className="side-panel__kbd">Esc</kbd>
            </button>
          </div>
        </header>
        <div className="side-panel__body">{open ? children : null}</div>
        {footer && <footer className="side-panel__foot">{footer}</footer>}
      </div>
    </dialog>
  );
}
