import {
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
  InputHTMLAttributes,
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { X } from 'lucide-react';
import { Mascot, type MascotMood } from './mascot';
import { DateInput } from './pickers';
import { cachedBranding } from './brand';
import { canAnimate, useLiquidDialog } from './liquid';
import { FixSteps, useFixPlan } from './fix-guide';

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
          {actions && <div className="cm-card__actions">{actions}</div>}
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
  // Erro conhecido (caixa fechado, comanda fechada…): além do erro, o que fazer e onde.
  const plan = useFixPlan(tone !== 'info' && typeof children === 'string' ? children : null);
  if (plan)
    return (
      <div className={`cm-alert cm-alert--${tone} cm-alert--guide`} role="alert">
        <div>
          <p className="cm-fix__error">{children}</p>
          <FixSteps plan={plan} />
        </div>
      </div>
    );
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

/** Ícone da loja (favicon); sem ícone, o logo; sem nenhum, o do Comandou. */
function storeIcon() {
  const b = cachedBranding();
  return b?.faviconUrl || b?.logoUrl || '/favicon.svg';
}

/**
 * O ÚNICO indicador de carregamento do sistema: o ícone da loja pulsando dentro de um anel.
 * Só aparece se a carga demorar (atraso no CSS): troca rápida de tela não pisca nada.
 * `inline` é a versão pequena para dentro de uma linha (ex.: caixa de busca).
 */
export function Spinner({ label = 'Carregando', inline }: { label?: string; inline?: boolean }) {
  return (
    <span role="status" className={`cm-loader${inline ? ' cm-loader--inline' : ''}`}>
      <span className="cm-loader__mark" aria-hidden>
        <img src={storeIcon()} alt="" decoding="async" />
      </span>
      <span className="cm-sr-only">{label}</span>
    </span>
  );
}
/** Mesmo carregamento, ocupando a altura do conteúdo que vai chegar (não pula o layout). */
export function Skeleton({ height = 16 }: { height?: number; width?: number | string }) {
  return (
    <div className="cm-loader-box" style={{ minHeight: height }}>
      <Spinner />
    </div>
  );
}

/**
 * Foto pequena do produto num item de pedido (sacola, PDV, cozinha, garçom). Sem foto, ou se a
 * foto não carregar, mostra a inicial do nome sobre a cor da loja.
 */
export function ItemThumb({
  src,
  name,
  size = 40,
}: {
  src: string | null | undefined;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const show = !!src && !failed;
  return (
    <span
      className="cm-thumb"
      data-empty={show ? undefined : ''}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {show ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        (name.trim()[0] ?? '?').toUpperCase()
      )}
    </span>
  );
}

/** Fileira de fotos dos itens (cartões de pedido); passa de `max` vira "+N". */
export function ItemThumbStrip({
  items,
  max = 5,
  size = 28,
}: {
  items: { key: string; src: string | null | undefined; name: string }[];
  max?: number;
  size?: number;
}) {
  if (!items.length) return null;
  return (
    <span className="cm-thumbs" aria-hidden>
      {items.slice(0, max).map((i) => (
        <ItemThumb key={i.key} src={i.src} name={i.name} size={size} />
      ))}
      {items.length > max && <span className="cm-thumbs__more">+{items.length - max}</span>}
    </span>
  );
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
  title: ReactNode;
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
  // Nasce de quem foi clicado e volta para ele ao fechar (liquid.ts).
  const { shown } = useLiquidDialog(ref, open);
  return (
    <dialog
      ref={ref}
      className={`cm-modal cm-modal--${size}`}
      onCancel={(e) => {
        // Esc: fecha pelo mesmo caminho do X, com a animação de volta.
        if (e.target !== e.currentTarget || !canAnimate(e.currentTarget)) return;
        e.preventDefault();
        onClose();
      }}
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
      <div className="cm-card__body cm-modal__body">{shown ? children : null}</div>
      {footer && <div className="cm-modal__footer">{footer}</div>}
    </dialog>
  );
}
