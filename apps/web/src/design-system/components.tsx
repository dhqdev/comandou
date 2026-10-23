import {
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
  InputHTMLAttributes,
  forwardRef,
  useEffect,
  useId,
  useRef,
} from 'react';
import { X } from 'lucide-react';
import { Mascot, type MascotMood } from './mascot';
import { DateInput } from './pickers';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const cls = [
    'cm-btn',
    `cm-btn--${variant}`,
    size === 'lg' && 'cm-btn--lg',
    size === 'sm' && 'cm-btn--sm',
    icon && (children === undefined || children === null || children === false) && 'cm-btn--icon',
    block && 'cm-btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="cm-spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  leading?: ReactNode;
  /** Classe extra do bloco (rótulo + campo), ex.: largura numa grade. */
  wrapClass?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, type, wrapClass, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={wrapClass ? `cm-field ${wrapClass}` : 'cm-field'}>
      <label className="cm-label" htmlFor={inputId}>
        {label}
      </label>
      {type === 'date' ? (
        <DateInput
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      ) : (
        <input
          ref={ref}
          id={inputId}
          type={type}
          className="cm-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      )}
      {error ? (
        <span id={`${inputId}-err`} className="cm-error-text" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={`${inputId}-hint`} className="cm-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
});

export function Card({
  title,
  actions,
  children,
  bodyless,
  searchId,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyless?: boolean;
  /** Alvo da busca global ("?foco=<id>" rola até o card e o destaca). */
  searchId?: string;
}) {
  return (
    <section className="cm-card" data-search-id={searchId}>
      {(title || actions) && (
        <header className="cm-card__header">
          {title && <h2 className="cm-card__title">{title}</h2>}
          {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
        </header>
      )}
      {bodyless ? children : <div className="cm-card__body">{children}</div>}
    </section>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';
  children: ReactNode;
}) {
  return (
    <span className={`cm-badge ${tone !== 'neutral' ? `cm-badge--${tone}` : ''}`}>{children}</span>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return (
    <div className={`cm-alert cm-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  mascot,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Mostra o mascote no lugar do ícone (telas vazias "amigáveis"). */
  mascot?: MascotMood | boolean;
}) {
  return (
    <div className="cm-empty">
      {mascot ? (
        <Mascot size={56} mood={mascot === true ? 'sleep' : mascot} />
      ) : (
        icon && <div className="cm-empty__icon">{icon}</div>
      )}
      <p className="cm-empty__title">{title}</p>
      {description && <p style={{ margin: 0, maxWidth: 360 }}>{description}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="cm-spinner" aria-hidden />
      <span className="cm-sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: number | string;
}) {
  return <div className="cm-skeleton" style={{ height, width }} aria-hidden />;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  /** O clique só fecha se começou e terminou no fundo (selecionar texto e soltar fora não fecha). */
  const downOnBackdrop = useRef(false);
  const onBackdrop = (e: {
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
      className={`cm-modal cm-modal--${size}`}
      onMouseDown={(e) => {
        downOnBackdrop.current = onBackdrop(e);
      }}
      onClick={(e) => {
        // Clicar fora da janela (no fundo escurecido) fecha.
        if (downOnBackdrop.current && onBackdrop(e)) onClose();
        downOnBackdrop.current = false;
      }}
      // O React propaga "close" de um dialog aninhado para o pai; só reage ao próprio.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby={titleId}
    >
      <div className="cm-card__header">
        <h2 id={titleId} className="cm-card__title">
          {title}
        </h2>
        <Button variant="ghost" onClick={onClose} aria-label="Fechar" icon={<X size={18} />} />
      </div>
      <div className="cm-card__body cm-modal__body">{open ? children : null}</div>
      {footer && <div className="cm-modal__footer">{footer}</div>}
    </dialog>
  );
}
