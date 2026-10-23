import { ChevronLeft, Heart, Minus, Plus, Trash2 } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { initials } from './store';

/** Foto com proporção fixa, carregamento preguiçoso, fade-in e plano B com iniciais. */
export function Photo({
  src,
  alt,
  ratio = '1 / 1',
  className = '',
  eager,
}: {
  src: string | null;
  alt: string;
  ratio?: string;
  className?: string;
  eager?: boolean;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error');
  const img = useRef<HTMLImageElement>(null);
  const first = useRef(true);
  useEffect(() => {
    // Troca de foto: volta a carregar. Na montagem, a foto pode já ter vindo do cache.
    if (!first.current) setState(src ? 'loading' : 'error');
    first.current = false;
    if (img.current?.complete && img.current.naturalWidth) setState('ok');
  }, [src]);
  return (
    <div className={`ph ${className}`} style={{ aspectRatio: ratio }} data-state={state}>
      {src && state !== 'error' && (
        <img
          ref={img}
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
      {state === 'error' && (
        <span className="ph__fallback" aria-hidden>
          {initials(alt)}
        </span>
      )}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
  size = 'md',
}: {
  value: number;
  onChange(n: number): void;
  min?: number;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`stepper stepper--${size}`}>
      <button
        type="button"
        aria-label="Diminuir"
        onClick={() => onChange(Math.max(min - 1, value - 1))}
        disabled={value <= min - 1}
      >
        {value <= 1 && min === 0 ? <Trash2 size={15} /> : <Minus size={15} />}
      </button>
      <span aria-live="polite" key={value} className="stepper__n">
        {value}
      </span>
      <button type="button" aria-label="Aumentar" onClick={() => onChange(Math.min(50, value + 1))}>
        <Plus size={15} />
      </button>
    </div>
  );
}

/** Interruptor (liga/desliga) com o input nativo por baixo: teclado e leitor de tela funcionam. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="sfswitch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="sfswitch__track" aria-hidden />
    </span>
  );
}

export function Field({
  label,
  children,
  wide,
  hint,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  hint?: ReactNode;
}) {
  return (
    <label className={`f ${wide ? 'f--wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="f__hint">{hint}</small>}
    </label>
  );
}

/** Coração de favorito com "pulo" ao marcar. */
export function HeartButton({
  on,
  onToggle,
  className = '',
}: {
  on: boolean;
  onToggle(): void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`heart ${className}`}
      data-on={on || undefined}
      aria-pressed={on}
      aria-label={on ? 'Tirar dos favoritos' : 'Favoritar'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Heart size={18} />
    </button>
  );
}

/** Topo das telas internas: voltar + título. */
export function ScreenHeader({
  title,
  back = '/pedir',
  actions,
}: {
  title: ReactNode;
  back?: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="screen-head">
      <button
        type="button"
        className="iconbtn"
        aria-label="Voltar"
        onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate(back))}
      >
        <ChevronLeft size={20} />
      </button>
      <h1>{title}</h1>
      <div className="screen-head__actions">{actions}</div>
    </header>
  );
}
