import {
  ButtonHTMLAttributes,
  Children,
  ReactNode,
  InputHTMLAttributes,
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { X } from 'lucide-react';
import { sizedMedia } from '../lib/media-size';
import { type MascotMood } from './mascot';
import { StoreMark } from './store-mark';
import { DateInput, DateTimeInput } from './date-picker';
import { cachedBranding } from './brand';
import { canAnimate, useLiquidDialog } from './liquid';
import { FixSteps, useFixPlan } from './fix-guide';
import { HelpTip, useHelp } from './help-tip';

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
  const help = useHelp(label);
  const labelEl = (
    <label className="cm-label" htmlFor={inputId}>
      {label}
    </label>
  );
  return (
    <div className={wrapClass ? `cm-field ${wrapClass}` : 'cm-field'}>
      {help ? (
        <span className="cm-label-row">
          {labelEl}
          <HelpTip label={label} entry={help} />
        </span>
      ) : (
        labelEl
      )}
      {type === 'date' ? (
        <DateInput
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      ) : type === 'datetime-local' ? (
        <DateTimeInput
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
  // Texto com negrito, código ou link no meio vira um bloco só: solto, cada pedaço virava uma
  // coluna do flex e a frase quebrava em pedaços lado a lado.
  const parts = Children.toArray(children);
  const inline =
    parts.length > 1 && parts.some((c) => typeof c === 'string' || typeof c === 'number');
  return (
    <div className={`cm-alert cm-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {inline ? <span className="cm-alert__text">{children}</span> : children}
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
  /**
   * Telas vazias "amigáveis": a logo do restaurante no lugar do ícone; sem logo, o panda com
   * esse humor.
   */
  mascot?: MascotMood | boolean;
}) {
  return (
    <div className="cm-empty">
      {mascot ? (
        <StoreMark size={56} mood={mascot === true ? 'sleep' : mascot} />
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
 * Ação em andamento (entrar, salvar, enviar, buscar, abrir um link): o ícone da loja pulsando
 * dentro de um anel. Conteúdo carregando usa `Skeleton` (skeleton.tsx), no formato do que vem.
 * Só aparece se a ação demorar (atraso no CSS). `inline` é a versão pequena para dentro de uma
 * linha (ex.: caixa de busca).
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
        <img
          src={sizedMedia(src, 320)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
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
  className,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  /** Classe a mais na janela (janela com miolo próprio, ex.: edição do item no garçom). */
  className?: string;
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
      className={`cm-modal cm-modal--${size}${className ? ` ${className}` : ''}`}
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
