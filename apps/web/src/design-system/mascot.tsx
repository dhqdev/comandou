import type { CSSProperties } from 'react';

/**
 * O panda do Comandou: cabeça branca com contorno escuro, orelhas e manchas pretas,
 * olhando de lado com um sorriso de canto. Funciona de 16px (favicon) a 160px (telas vazias).
 * Com `badge`, aparece sobre o quadradinho laranja da marca (logo, ícone do app).
 */
export type MascotMood = 'happy' | 'joy' | 'wink' | 'wow' | 'sleep' | 'cook';

/** Contorno da cabeça (viewBox 64×64). */
export const PANDA_HEAD =
  'M7.2 38C7.2 24.5 20 15.8 34.5 15.8C48.5 15.8 58.6 24.5 58.6 38C58.6 49 48 53 32 53C15.5 53 7.2 49 7.2 38Z';

export function Mascot({
  size = 40,
  mood = 'happy',
  title,
  className = '',
  animated,
  badge,
  style,
}: {
  size?: number;
  mood?: MascotMood;
  /** Texto para leitores de tela. Sem título, o desenho é decorativo. */
  title?: string;
  className?: string;
  /** Balança de leve e pisca (telas vazias, carregando). */
  animated?: boolean;
  /** Panda sobre o quadrado laranja da marca. */
  badge?: boolean;
  style?: CSSProperties;
}) {
  const ink = 'var(--cm-mascot-ink, #1a1613)';
  const face = 'var(--cm-mascot-face, #fff)';
  const shut = { stroke: face, strokeWidth: 1.9, strokeLinecap: 'round' as const, fill: 'none' };

  const left =
    mood === 'joy' ? (
      <path d="M23.4 32.6q2.2-2.6 4.4 0" {...shut} />
    ) : mood === 'sleep' ? (
      <path d="M23.3 32.3h4.4" {...shut} />
    ) : (
      <g>
        <circle cx="25.5" cy="31.9" r={mood === 'wow' ? 3.4 : 2.9} fill={face} />
        <ellipse cx="27.4" cy="31.2" rx=".95" ry="1.4" fill={ink} />
      </g>
    );
  const right =
    mood === 'joy' || mood === 'wink' ? (
      <path d="M42.8 29.6q2.1-2.5 4.2 0" {...shut} />
    ) : mood === 'sleep' ? (
      <path d="M42.8 29.2h4.2" {...shut} />
    ) : (
      <g>
        <circle cx="44.9" cy="28.8" r={mood === 'wow' ? 3.4 : 2.9} fill={face} />
        <ellipse cx="46.8" cy="28.3" rx=".95" ry="1.4" fill={ink} />
      </g>
    );
  const mouth =
    mood === 'wow' ? (
      <ellipse cx="40.6" cy="41" rx="1.9" ry="2.3" fill={ink} />
    ) : mood === 'sleep' ? (
      <path
        d="M38.5 40.6q3 .8 5-1"
        stroke={ink}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    ) : mood === 'joy' ? (
      <path
        d="M36.8 39.8Q42.5 42.6 45 37.2Z"
        stroke={ink}
        strokeWidth="2.2"
        strokeLinejoin="round"
        fill={ink}
      />
    ) : (
      <path
        d="M37.5 40.6Q42.5 41.5 44.2 37.6"
        stroke={ink}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    );

  const panda = (
    <g>
      {mood === 'cook' && (
        // Touca de chef: contorno escuro, branco por dentro.
        <g stroke={ink} strokeWidth="2.2" strokeLinejoin="round" fill={face}>
          <path d="M23 17V10.5a5 5 0 0 1 3.6-6.2a6 6 0 0 1 10.8 0a5 5 0 0 1 3.6 6.2V17Z" />
        </g>
      )}
      {/* Orelhas: no escuro ganham um aro discreto para não sumirem no fundo. */}
      <g fill={ink} stroke="var(--cm-mascot-rim, none)" strokeWidth="1.6">
        <circle cx="14" cy="19.9" r="8.2" />
        <circle cx="49.8" cy="17.9" r="8.2" />
      </g>
      <path d={PANDA_HEAD} fill={face} stroke={ink} strokeWidth="2.8" strokeLinejoin="round" />
      <ellipse cx="22" cy="33.7" rx="8.8" ry="5.9" transform="rotate(-40 22 33.7)" fill={ink} />
      <ellipse cx="46.3" cy="29.4" rx="7.6" ry="5.3" transform="rotate(30 46.3 29.4)" fill={ink} />
      <g className={animated && mood !== 'sleep' ? 'cm-mascot__eyes' : undefined}>
        {left}
        {right}
      </g>
      <ellipse cx="36.3" cy="35.2" rx="4.2" ry="2.5" transform="rotate(-12 36.3 35.2)" fill={ink} />
      {mouth}
      {mood === 'sleep' && (
        <text x="55" y="9" fontSize="9" fontWeight="800" fill="currentColor" opacity=".7">
          z
        </text>
      )}
    </g>
  );

  return (
    <svg
      className={`cm-mascot ${badge ? 'cm-mascot--badge' : ''} ${animated ? 'cm-mascot--bob' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: 'visible', ...style }}
    >
      {badge ? (
        <>
          <rect width="64" height="64" rx="15" fill="var(--cm-brand-500, #ea8a0b)" />
          <g transform="translate(1.7 3.6) scale(.92)">{panda}</g>
        </>
      ) : (
        panda
      )}
    </svg>
  );
}

/** Logotipo: panda no quadrado laranja + "comandou". */
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
      <Mascot size={size} badge title={wordmark ? undefined : 'Comandou'} />
      {wordmark && <span className="cm-logo__word">comandou</span>}
    </span>
  );
}
