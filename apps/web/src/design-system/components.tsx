import {
  ButtonHTMLAttributes,
  ReactNode,
  InputHTMLAttributes,
  forwardRef,
  useEffect,
  useId,
  useRef,
} from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
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
    'pm-btn',
    `pm-btn--${variant}`,
    size === 'lg' && 'pm-btn--lg',
    block && 'pm-btn--block',
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
      {loading ? <span className="pm-spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  leading?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="pm-field">
      <label className="pm-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className="pm-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <span id={`${inputId}-err`} className="pm-error-text" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={`${inputId}-hint`} className="pm-hint">
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
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyless?: boolean;
}) {
  return (
    <section className="pm-card">
      {(title || actions) && (
        <header className="pm-card__header">
          {title && <h2 className="pm-card__title">{title}</h2>}
          {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
        </header>
      )}
      {bodyless ? children : <div className="pm-card__body">{children}</div>}
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
    <span className={`pm-badge ${tone !== 'neutral' ? `pm-badge--${tone}` : ''}`}>{children}</span>
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
    <div className={`pm-alert pm-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="pm-empty">
      {icon && <div className="pm-empty__icon">{icon}</div>}
      <p className="pm-empty__title">{title}</p>
      {description && <p style={{ margin: 0, maxWidth: 360 }}>{description}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="pm-spinner" aria-hidden />
      <span className="pm-sr-only">{label}</span>
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
  return <div className="pm-skeleton" style={{ height, width }} aria-hidden />;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog ref={ref} className="pm-modal" onClose={onClose} aria-labelledby="pm-modal-title">
      <div className="pm-card__header">
        <h2 id="pm-modal-title" className="pm-card__title">
          {title}
        </h2>
        <Button variant="ghost" onClick={onClose} aria-label="Fechar">
          ✕
        </Button>
      </div>
      <div className="pm-card__body">{children}</div>
      {footer && <div className="pm-modal__footer">{footer}</div>}
    </dialog>
  );
}
