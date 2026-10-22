import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';

/** Ícone neutro de prato (cloche) para quando não há foto. */
function DishIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M7 35h34" />
      <path d="M10.5 35a13.5 13.5 0 0 1 27 0" />
      <path d="M24 21.5V18" />
      <path d="M21 18h6" />
    </svg>
  );
}

/**
 * Foto com cara de app de delivery: caixa com proporção fixa (nada pula quando carrega),
 * brilho de carregamento, aparece com fade, lazy por padrão e um prato neutro se não há
 * foto ou se ela falhar. Use em produto, categoria, logo e capa da loja.
 *
 * - ratio: 1 (produto), 4/3 (card), 16/9 ou 3/1 (capa).
 * - fit "contain": foto de produto recortada (fundo transparente), sem cortar nada.
 */
export function SmartImage({
  src,
  alt,
  ratio = 1,
  fit = 'cover',
  radius,
  round,
  eager,
  srcSet,
  sizes,
  fallback,
  className = '',
  style,
}: {
  src?: string | null;
  alt: string;
  ratio?: number;
  fit?: 'cover' | 'contain';
  /** Raio em px; padrão do design system. */
  radius?: number;
  round?: boolean;
  /** Carregar já (imagem do topo da tela). Padrão: lazy. */
  eager?: boolean;
  srcSet?: string;
  sizes?: string;
  fallback?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>(src ? 'loading' : 'error');
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!src) return setState('error');
    const el = img.current;
    // Já em cache: o load aconteceu antes do React ligar o evento.
    if (el?.complete && el.naturalWidth > 0) setState('loaded');
    else setState('loading');
  }, [src]);

  const vars = {
    '--ratio': String(ratio),
    ...(radius !== undefined ? { '--r': `${radius}px` } : {}),
    ...style,
  } as CSSProperties;

  return (
    <div
      className={`cm-img ${fit === 'contain' ? 'cm-img--contain' : ''} ${round ? 'cm-img--round' : ''} ${className}`}
      data-state={state}
      style={vars}
    >
      {src && state !== 'error' && (
        <img
          ref={img}
          src={src}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // Fotos do topo da tela ganham prioridade de rede.
          {...(eager ? { fetchPriority: 'high' as const } : {})}
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      {state === 'error' && (
        <div
          className="cm-img__fallback"
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
        >
          {fallback ?? <DishIcon />}
        </div>
      )}
    </div>
  );
}
