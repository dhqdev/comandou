import {
  formatGrams,
  kgToGrams,
  ONLINE_WEIGHT_MAX_G,
  ONLINE_WEIGHT_MIN_G,
  ONLINE_WEIGHT_STEP_G,
} from '@comandou/shared';
import { ChevronLeft, Heart, Minus, Plus, Trash2 } from 'lucide-react';
import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { type MediaWidth, sizedMedia } from '../../lib/media-size';
import { initials } from './store';
import { useStore } from './context';

/**
 * Fotos que já apareceram nesta visita: voltam na hora, sem o fade de novo. Antes, cada volta ao
 * cardápio montava as fotos em "carregando" e todas piscavam (sumiam e voltavam) de uma vez.
 */
const shown = new Set<string>();
export const photoShown = (src: string) => shown.has(src);

/**
 * Foto com proporção fixa, carregamento preguiçoso, fade-in e plano B com iniciais. Pede a
 * miniatura de 640 px (`w`): cartões, listas e logos não baixam a original de até 1600 px. Só a
 * foto grande (galeria do produto, capa) passa `w="full"`.
 */
export function Photo({
  src: original,
  alt,
  ratio = '1 / 1',
  className = '',
  eager,
  w = 640,
}: {
  src: string | null;
  alt: string;
  ratio?: string;
  className?: string;
  eager?: boolean;
  w?: MediaWidth | 'full';
}) {
  const src = w === 'full' ? original : sizedMedia(original, w);
  // Foto grande cuja miniatura já apareceu (o cartão que abriu o produto): a miniatura fica por
  // baixo enquanto a original chega, em vez do quadro vazio.
  const thumb = w === 'full' ? sizedMedia(original, 640) : null;
  const preview = thumb && thumb !== src && shown.has(thumb) ? thumb : null;
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(
    !src ? 'error' : shown.has(src) ? 'ok' : 'loading',
  );
  // Já estava pronta antes de aparecer (cache): entra sem a transição.
  const [instant, setInstant] = useState(!!src && shown.has(src));
  const img = useRef<HTMLImageElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    // Troca de foto: volta a carregar. Na montagem, a foto pode já ter vindo do cache.
    if (!first.current) {
      setState(!src ? 'error' : shown.has(src) ? 'ok' : 'loading');
      setInstant(!!src && shown.has(src));
    }
    first.current = false;
    if (src && img.current?.complete && img.current.naturalWidth) {
      shown.add(src);
      setState('ok');
      setInstant(true);
    }
  }, [src]);
  return (
    <div
      className={`ph ${className}`}
      style={{ aspectRatio: ratio }}
      data-state={state}
      data-instant={instant || undefined}
    >
      {preview && state === 'loading' && (
        <img className="ph__preview" src={preview} alt="" aria-hidden draggable={false} />
      )}
      {src && state !== 'error' && (
        <img
          ref={img}
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => {
            shown.add(src);
            setState('ok');
          }}
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
  grams,
}: {
  value: number;
  onChange(n: number): void;
  min?: number;
  size?: 'sm' | 'md';
  /** Item vendido por peso: `value` é o peso em kg e o passo é de 50 g (de 100 g a 5 kg). */
  grams?: boolean;
}) {
  if (grams) {
    const g = kgToGrams(value);
    const canRemove = min === 0 && g - ONLINE_WEIGHT_STEP_G < ONLINE_WEIGHT_MIN_G;
    return (
      <div className={`stepper stepper--${size} stepper--weight`}>
        <button
          type="button"
          aria-label="Menos peso"
          onClick={() =>
            g - ONLINE_WEIGHT_STEP_G >= ONLINE_WEIGHT_MIN_G
              ? onChange((g - ONLINE_WEIGHT_STEP_G) / 1000)
              : min === 0 && onChange(0)
          }
          disabled={!canRemove && g - ONLINE_WEIGHT_STEP_G < ONLINE_WEIGHT_MIN_G}
        >
          {canRemove ? <Trash2 size={15} /> : <Minus size={15} />}
        </button>
        <span aria-live="polite" key={g} className="stepper__n">
          {formatGrams(g)}
        </span>
        <button
          type="button"
          aria-label="Mais peso"
          disabled={g + ONLINE_WEIGHT_STEP_G > ONLINE_WEIGHT_MAX_G}
          onClick={() => onChange(Math.min(ONLINE_WEIGHT_MAX_G, g + ONLINE_WEIGHT_STEP_G) / 1000)}
        >
          <Plus size={15} />
        </button>
      </div>
    );
  }
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
  className,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  hint?: ReactNode;
  /** Classe extra (posição do campo na grade do notebook). */
  className?: string;
}) {
  return (
    <label className={['f', wide && 'f--wide', className].filter(Boolean).join(' ')}>
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
  const { rules } = useStore();
  // Quantas vezes a pessoa tocou: o coração só pula no toque (antes pulava toda vez que a lista
  // aparecia, em todos os favoritos de uma vez).
  const [taps, setTaps] = useState(0);
  // Cardápio da mesa não tem favoritos (store-rules.ts).
  if (!rules.favorites) return null;
  return (
    <button
      type="button"
      className={`heart ${className}`}
      data-on={on || undefined}
      data-pop={(on && taps > 0) || undefined}
      aria-pressed={on}
      aria-label={on ? 'Tirar dos favoritos' : 'Favoritar'}
      onClick={(e) => {
        e.stopPropagation();
        setTaps((n) => n + 1);
        onToggle();
      }}
    >
      <Heart key={taps} size={18} />
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
