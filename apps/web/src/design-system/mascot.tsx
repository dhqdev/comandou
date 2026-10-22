import type { CSSProperties } from 'react';

/**
 * "Comandinho", o mascote do Comandou: uma comanda (o papelzinho do pedido) com rosto.
 * Corpo na cor da marca, canto dobrado e base picotada como papel destacado do bloco,
 * olhos e sorriso simples. Funciona de 16px (favicon) a 160px (telas vazias).
 */
export type MascotMood = 'happy' | 'joy' | 'wink' | 'wow' | 'sleep' | 'cook';

/** Corpo da comanda: topo arredondado, base picotada. */
export const MASCOT_BODY =
  'M19 8H40L49 17V52 l-2.125 3 l-2.125 -3 l-2.125 3 l-2.125 -3 l-2.125 3 l-2.125 -3 l-2.125 3 l-2.125 -3 l-2.125 3 l-2.125 -3 l-2.125 3 l-2.125 -3 l-2.125 3 l-2.125 -3 l-2.125 3 l-2.125 -3 V12a4 4 0 0 1 4-4z';
/** Dobrinha do canto do papel. */
export const MASCOT_FOLD = 'M40 8v6a3 3 0 0 0 3 3h6z';

export function Mascot({
  size = 40,
  mood = 'happy',
  title,
  className = '',
  animated,
  style,
}: {
  size?: number;
  mood?: MascotMood;
  /** Texto para leitores de tela. Sem título, o desenho é decorativo. */
  title?: string;
  className?: string;
  /** Balança de leve e pisca (telas vazias, carregando). */
  animated?: boolean;
  style?: CSSProperties;
}) {
  const ink = 'var(--cm-mascot-ink, #1a1613)';
  const eyes =
    mood === 'joy' ? (
      <g stroke={ink} strokeWidth="2.6" strokeLinecap="round" fill="none">
        <path d="M23.5 28q2.5-3.6 5 0" />
        <path d="M34.5 28q2.5-3.6 5 0" />
      </g>
    ) : mood === 'sleep' ? (
      <g stroke={ink} strokeWidth="2.6" strokeLinecap="round">
        <path d="M23.5 27.5h5" />
        <path d="M34.5 27.5h5" />
      </g>
    ) : mood === 'wink' ? (
      <g fill={ink}>
        <ellipse cx="26" cy="27" rx="2.5" ry="3.2" />
        <path d="M34.5 27.5h5" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      </g>
    ) : (
      <g fill={ink} className={animated ? 'cm-mascot__eyes' : undefined}>
        <ellipse cx="26" cy="27" rx="2.5" ry={mood === 'wow' ? 3.7 : 3.2} />
        <ellipse cx="37" cy="27" rx="2.5" ry={mood === 'wow' ? 3.7 : 3.2} />
      </g>
    );
  const mouth =
    mood === 'wow' ? (
      <ellipse cx="31.5" cy="35" rx="2.3" ry="2.7" fill={ink} />
    ) : mood === 'sleep' ? (
      <path d="M29 34.5h5" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
    ) : (
      <path
        d={mood === 'joy' ? 'M27 33q4.5 5.4 9 0z' : 'M27.5 33.5q4 3.8 8 0'}
        stroke={ink}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={mood === 'joy' ? ink : 'none'}
      />
    );
  return (
    <svg
      className={`cm-mascot ${animated ? 'cm-mascot--bob' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: 'visible', ...style }}
    >
      {mood === 'cook' && (
        // Touca de chef para a tela da cozinha: contorno embaixo, branco por cima.
        <g>
          <g stroke="var(--cm-border-strong, #e3ded8)" strokeWidth="2.4">
            <circle cx="26" cy="2.5" r="4" />
            <circle cx="32" cy="0.5" r="4.5" />
            <circle cx="38" cy="2.5" r="4" />
            <rect x="23" y="2" width="18" height="6" />
          </g>
          <g fill="#fff">
            <circle cx="26" cy="2.5" r="4" />
            <circle cx="32" cy="0.5" r="4.5" />
            <circle cx="38" cy="2.5" r="4" />
            <rect x="23" y="2" width="18" height="6" />
          </g>
        </g>
      )}
      <path d={MASCOT_BODY} fill="currentColor" />
      <path d={MASCOT_FOLD} fill="#fff" fillOpacity=".38" />
      {/* Linhas do pedido, como na comanda de papel. */}
      <path
        d="M22 41.5h18M22 46.5h11"
        stroke="#fff"
        strokeOpacity=".5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {eyes}
      {mouth}
      {mood === 'sleep' && (
        <text x="50" y="10" fontSize="9" fontWeight="800" fill="currentColor" opacity=".7">
          z
        </text>
      )}
    </svg>
  );
}

/** Logotipo: mascote + "comandou". */
export function Logo({
  size = 28,
  wordmark = true,
  className = '',
}: {
  size?: number;
  wordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`cm-logo ${className}`} style={{ fontSize: size * 0.64 }}>
      <Mascot size={size} title={wordmark ? undefined : 'Comandou'} />
      {wordmark && <span className="cm-logo__word">comandou</span>}
    </span>
  );
}
