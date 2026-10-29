import { CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { PANDA_HEAD } from './mascot';
import './panda-live.css';

/**
 * O panda do Comandou com vida: os olhos seguem o mouse (ou o dedo), passeiam sozinhos quando
 * ninguém mexe, piscam, ele respira, inclina de leve para o lado do ponteiro e, de vez em quando,
 * dá um pulinho, balança ou acena. Ao tocar, amassa e reage. Mesmo desenho do Mascot (viewBox 64).
 */
export type PandaMood =
  'idle' | 'happy' | 'joy' | 'wink' | 'wow' | 'thinking' | 'talking' | 'sleep' | 'sad' | 'dizzy';

const POKES: PandaMood[] = ['joy', 'wow', 'wink', 'happy', 'joy'];
/** Quanto a pupila anda dentro do olho (unidades do viewBox). */
const RX = 1.25;
const RY = 1.05;

type Gesture = 'hop' | 'sway' | 'look' | 'shake' | 'nod';
const GESTURES: Record<Gesture, [Keyframe[], number]> = {
  hop: [
    [
      { transform: 'translateY(0) scale(1, 1)' },
      { transform: 'translateY(0) scale(1.06, .93)', offset: 0.15 },
      { transform: 'translateY(-5px) scale(.97, 1.04)', offset: 0.45 },
      { transform: 'translateY(0) scale(1.05, .95)', offset: 0.75 },
      { transform: 'translateY(0) scale(1, 1)' },
    ],
    620,
  ],
  sway: [
    [
      { transform: 'rotate(0)' },
      { transform: 'rotate(-6deg)', offset: 0.25 },
      { transform: 'rotate(5deg)', offset: 0.6 },
      { transform: 'rotate(0)' },
    ],
    1300,
  ],
  look: [
    [
      { transform: 'rotate(0)' },
      { transform: 'rotate(-4deg)', offset: 0.3 },
      { transform: 'rotate(4deg)', offset: 0.7 },
      { transform: 'rotate(0)' },
    ],
    1600,
  ],
  shake: [
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-2px)', offset: 0.2 },
      { transform: 'translateX(2px)', offset: 0.4 },
      { transform: 'translateX(-1.5px)', offset: 0.6 },
      { transform: 'translateX(1px)', offset: 0.8 },
      { transform: 'translateX(0)' },
    ],
    500,
  ],
  nod: [
    [
      { transform: 'translateY(0)' },
      { transform: 'translateY(1.5px)', offset: 0.3 },
      { transform: 'translateY(0)', offset: 0.6 },
      { transform: 'translateY(1px)', offset: 0.8 },
      { transform: 'translateY(0)' },
    ],
    700,
  ],
};

const calm = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function LivePanda({
  size = 48,
  mood = 'idle',
  badge,
  title,
  className = '',
  style,
  still,
}: {
  size?: number;
  mood?: PandaMood;
  /** Sobre o quadradinho laranja da marca (logo do topo). */
  badge?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Sem vida (miniaturas). */
  still?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const svg = useRef<SVGSVGElement>(null);
  const pupilL = useRef<SVGGElement>(null);
  const pupilR = useRef<SVGGElement>(null);
  const look = useRef<SVGGElement>(null);
  const lean = useRef<SVGGElement>(null);
  const act = useRef<SVGGElement>(null);
  const lids = useRef<SVGGElement>(null);
  const [poke, setPoke] = useState<PandaMood | null>(null);
  const [squish, setSquish] = useState(0);
  const [wave, setWave] = useState(0);
  const clicks = useRef<number[]>([]);
  const shown: PandaMood = poke ?? mood;
  const dead = still || calm();

  const play = (g: Gesture) => {
    const el = act.current;
    if (!el || dead || typeof el.animate !== 'function') return;
    const [frames, ms] = GESTURES[g];
    el.animate(frames, { duration: ms, easing: 'ease-in-out' });
  };

  // Olhar: segue o ponteiro; parado, passeia sozinho com pulinhos rápidos (como olho de verdade).
  useEffect(() => {
    const el = svg.current;
    if (!el || still) return;
    const set = (x: number, y: number) => {
      const tr = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      if (pupilL.current) pupilL.current.style.transform = tr;
      if (pupilR.current) pupilR.current.style.transform = tr;
      if (look.current)
        look.current.style.transform = `translate(${(x * 0.35).toFixed(2)}px, ${(y * 0.3).toFixed(2)}px)`;
    };
    if (shown === 'thinking') {
      set(-0.9, -0.9);
      return;
    }
    if (shown === 'sleep' || shown === 'dizzy') {
      set(0, 0);
      return;
    }
    let lastMove = 0;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      lastMove = Date.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height * 0.5);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / (r.width * 1.2));
        set((dx / d) * RX * k, (dy / d) * RY * k);
        if (lean.current && !dead)
          lean.current.style.transform = `rotate(${((dx / d) * k * 5).toFixed(2)}deg)`;
      });
    };
    let t: ReturnType<typeof setTimeout>;
    const wander = () => {
      if (Date.now() - lastMove > 2500 && !document.hidden) {
        if (lean.current) lean.current.style.transform = '';
        const r = Math.random();
        if (r < 0.35) set(RX * 0.8, -RY * 0.3);
        else set((Math.random() * 2 - 1) * RX, (Math.random() * 2 - 1) * RY * 0.8);
      }
      t = setTimeout(wander, 800 + Math.random() * 2400);
    };
    set(RX * 0.8, -RY * 0.3);
    t = setTimeout(wander, 1200);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [still, dead, shown]);

  // Piscar: intervalo aleatório, às vezes duas vezes seguidas.
  useEffect(() => {
    const g = lids.current;
    if (!g || dead || shown === 'sleep' || shown === 'joy' || shown === 'dizzy') return;
    let t: ReturnType<typeof setTimeout>;
    const blink = (twice: boolean) => {
      g.classList.add('lp-blinking');
      setTimeout(() => {
        g.classList.remove('lp-blinking');
        if (twice) setTimeout(() => blink(false), 150);
      }, 120);
    };
    const loop = () => {
      if (!document.hidden) blink(Math.random() < 0.25);
      t = setTimeout(loop, 2400 + Math.random() * 3800);
    };
    t = setTimeout(loop, 900 + Math.random() * 2200);
    return () => clearTimeout(t);
  }, [dead, shown]);

  // A reação ao toque some depois de um tempinho.
  useEffect(() => {
    if (!poke) return;
    const t = setTimeout(() => setPoke(null), poke === 'dizzy' ? 2000 : 1100);
    return () => clearTimeout(t);
  }, [poke, squish]);

  // Humor que pede gesto.
  useEffect(() => {
    if (shown === 'joy' || shown === 'happy') play('hop');
    else if (shown === 'wow') play('nod');
    else if (shown === 'dizzy') play('shake');
    else if (shown === 'thinking') play('look');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // Parado, de vez em quando ele faz alguma coisa sozinho.
  useEffect(() => {
    if (dead || size < 28) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      if (!document.hidden && (mood === 'idle' || mood === 'happy')) {
        const r = Math.random();
        if (r < 0.35) play('hop');
        else if (r < 0.6) play('sway');
        else if (r < 0.8) play('look');
        else setWave((n) => n + 1);
      }
      t = setTimeout(loop, 9000 + Math.random() * 12000);
    };
    t = setTimeout(loop, 4000 + Math.random() * 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dead, mood, size]);

  // Acena ao aparecer (só nos grandes).
  useEffect(() => {
    if (!dead && size >= 40 && !badge) setWave(1);
  }, [dead, size, badge]);

  const onPoke = () => {
    if (still) return;
    const now = Date.now();
    clicks.current = [...clicks.current.filter((c) => now - c < 2000), now];
    setSquish((n) => n + 1);
    setPoke(
      clicks.current.length >= 5 ? 'dizzy' : POKES[Math.floor(Math.random() * POKES.length)]!,
    );
  };

  const ink = 'var(--cm-mascot-ink, #1a1613)';
  const face = 'var(--cm-mascot-face, #fff)';
  const shut = { stroke: face, strokeWidth: 1.9, strokeLinecap: 'round' as const, fill: 'none' };
  const big = shown === 'wow';

  const eye = (cx: number, cy: number, side: 'l' | 'r') => {
    if (shown === 'joy' || (shown === 'wink' && side === 'r'))
      return <path d={`M${cx - 2.1} ${cy + 0.7}q2.1-2.6 4.2 0`} {...shut} />;
    if (shown === 'sleep') return <path d={`M${cx - 2.2} ${cy + 0.4}h4.4`} {...shut} />;
    if (shown === 'sad')
      return (
        <g className="lp-eye">
          <circle cx={cx} cy={cy + 0.4} r={2.6} fill={face} />
          <path d={`M${cx - 2.6} ${cy - 2.4}l5 1.4`} stroke={ink} strokeWidth={1.4} />
          <circle cx={cx} cy={cy + 1} r={1.2} fill={ink} />
        </g>
      );
    if (shown === 'dizzy')
      return (
        <path
          d={`M${cx - 1.8} ${cy - 1.8}l3.6 3.6M${cx + 1.8} ${cy - 1.8}l-3.6 3.6`}
          {...shut}
          strokeWidth={1.6}
        />
      );
    return (
      <g className="lp-eye">
        <circle cx={cx} cy={cy} r={big ? 3.4 : 2.9} fill={face} />
        <g className="lp-pupil" ref={side === 'l' ? pupilL : pupilR}>
          <ellipse cx={cx} cy={cy} rx={big ? 1.1 : 0.95} ry={big ? 1.6 : 1.4} fill={ink} />
          <circle cx={cx + 0.45} cy={cy - 0.65} r={0.38} fill={face} opacity={0.9} />
        </g>
      </g>
    );
  };

  const mouth =
    shown === 'wow' || shown === 'dizzy' ? (
      <ellipse cx="40.6" cy="41" rx="1.9" ry="2.3" fill={ink} />
    ) : shown === 'talking' ? (
      <ellipse className="lp-talk" cx="40.6" cy="40.6" rx="2.2" ry="1.6" fill={ink} />
    ) : shown === 'sad' ? (
      <path
        d="M37.6 41.6Q40.8 39.4 43.8 41.4"
        stroke={ink}
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
    ) : shown === 'sleep' ? (
      <path
        d="M38.5 40.6q3 .8 5-1"
        stroke={ink}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    ) : shown === 'joy' || shown === 'happy' ? (
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
    <g className="lp-lean" ref={lean}>
      <g className="lp-act" ref={act}>
        <g className={`lp-life ${size < 32 || dead ? '' : 'lp-breathe'}`}>
          <g className={squish ? `lp-squish lp-squish-${squish % 2}` : 'lp-squish'}>
            {/* Patinhas: escondidas atrás da cabeça, aparecem para acenar. */}
            {!dead && (
              <g className={wave ? 'lp-paws lp-waving' : 'lp-paws'} key={wave}>
                <ellipse className="lp-paw lp-paw-l" cx="12" cy="46" rx="5" ry="4.3" fill={ink} />
                <ellipse className="lp-paw lp-paw-r" cx="53" cy="44" rx="5" ry="4.3" fill={ink} />
              </g>
            )}
            <g className="lp-ears" fill={ink} stroke="var(--cm-mascot-rim, none)" strokeWidth="1.6">
              <circle className="lp-ear lp-ear-l" cx="14" cy="19.9" r="8.2" />
              <circle className="lp-ear lp-ear-r" cx="49.8" cy="17.9" r="8.2" />
            </g>
            <path
              d={PANDA_HEAD}
              fill={face}
              stroke={ink}
              strokeWidth="2.8"
              strokeLinejoin="round"
            />
            <g className="lp-look" ref={look}>
              <ellipse
                cx="22"
                cy="33.7"
                rx="8.8"
                ry="5.9"
                transform="rotate(-40 22 33.7)"
                fill={ink}
              />
              <ellipse
                cx="46.3"
                cy="29.4"
                rx="7.6"
                ry="5.3"
                transform="rotate(30 46.3 29.4)"
                fill={ink}
              />
              <g className="lp-lids" ref={lids}>
                {eye(25.5, 31.9, 'l')}
                {eye(44.9, 28.8, 'r')}
              </g>
              <ellipse
                cx="36.3"
                cy="35.2"
                rx="4.2"
                ry="2.5"
                transform="rotate(-12 36.3 35.2)"
                fill={ink}
              />
              {mouth}
            </g>
            {(shown === 'joy' || shown === 'happy' || shown === 'wink') && (
              <g fill="var(--cm-brand-300, #ff8a5c)" opacity=".55">
                <ellipse cx="17.5" cy="41.5" rx="3" ry="1.6" />
                <ellipse cx="51" cy="37" rx="2.6" ry="1.5" />
              </g>
            )}
          </g>
        </g>
      </g>
      {shown === 'sleep' && (
        <text
          className="lp-zzz"
          x="55"
          y="9"
          fontSize="9"
          fontWeight="800"
          fill="currentColor"
          opacity=".7"
        >
          z
        </text>
      )}
      {shown === 'thinking' && (
        <g className="lp-dots" fill="currentColor">
          <circle cx="54" cy="10" r="1.6" />
          <circle cx="59" cy="6" r="2.1" />
          <circle cx="64.5" cy="1.5" r="2.6" />
        </g>
      )}
    </g>
  );

  return (
    <svg
      ref={svg}
      className={`cm-mascot lp ${badge ? 'cm-mascot--badge lp--badge' : ''} ${dead ? 'lp--still' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: 'visible', ...style }}
      onPointerDown={onPoke}
      data-mood={shown}
    >
      {badge ? (
        <>
          <defs>
            <clipPath id={`lp${uid}`}>
              <rect width="64" height="64" rx="15" />
            </clipPath>
          </defs>
          <rect width="64" height="64" rx="15" fill="var(--cm-brand-500, #e23a00)" />
          <g clipPath={`url(#lp${uid})`}>
            <g transform="translate(1.7 3.6) scale(.92)">{panda}</g>
          </g>
        </>
      ) : (
        <>
          <ellipse
            className="lp-shadow"
            cx="33"
            cy="58"
            rx="20"
            ry="2.6"
            fill="#000"
            opacity=".12"
          />
          {panda}
        </>
      )}
    </svg>
  );
}
