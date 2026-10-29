import { CSSProperties, useEffect, useId, useRef, useState } from 'react';
import type { PandaMood } from './panda-live';
import './panda-buddy.css';

/**
 * Panda de corpo inteiro, desenhado com volume (pelo branco com sombra suave, patas, barriga, nariz
 * brilhante, olhos de vidro). Os olhos seguem o mouse, ele pisca, respira, pula,
 * acena e amassa quando tocam.
 */

/* ---------------------------------------------------------------- movimento */
type Gesture = 'hop' | 'sway' | 'look' | 'shake' | 'nod';
const GESTURES: Record<Gesture, [Keyframe[], number]> = {
  hop: [
    [
      { transform: 'translateY(0) scale(1, 1)' },
      { transform: 'translateY(0) scale(1.05, .93)', offset: 0.15 },
      { transform: 'translateY(-14px) scale(.97, 1.04)', offset: 0.45 },
      { transform: 'translateY(0) scale(1.04, .95)', offset: 0.75 },
      { transform: 'translateY(0) scale(1, 1)' },
    ],
    680,
  ],
  sway: [
    [
      { transform: 'rotate(0)' },
      { transform: 'rotate(-4deg)', offset: 0.25 },
      { transform: 'rotate(3.5deg)', offset: 0.6 },
      { transform: 'rotate(0)' },
    ],
    1400,
  ],
  look: [
    [
      { transform: 'rotate(0)' },
      { transform: 'rotate(-3deg)', offset: 0.3 },
      { transform: 'rotate(3deg)', offset: 0.7 },
      { transform: 'rotate(0)' },
    ],
    1600,
  ],
  shake: [
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-5px)', offset: 0.2 },
      { transform: 'translateX(5px)', offset: 0.4 },
      { transform: 'translateX(-3px)', offset: 0.6 },
      { transform: 'translateX(2px)', offset: 0.8 },
      { transform: 'translateX(0)' },
    ],
    500,
  ],
  nod: [
    [
      { transform: 'translateY(0)' },
      { transform: 'translateY(4px)', offset: 0.3 },
      { transform: 'translateY(0)', offset: 0.6 },
      { transform: 'translateY(3px)', offset: 0.8 },
      { transform: 'translateY(0)' },
    ],
    700,
  ],
};
const POKES: PandaMood[] = ['joy', 'wow', 'wink', 'happy', 'joy'];
const RX = 2.6;
const RY = 2.2;
const calm = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------- cores */
const INK = '#1b1714';
const INK2 = '#37312d';

function Defs({ u }: { u: string }) {
  const lin = (id: string, a: string, b: string, x2 = '0.3') => (
    <linearGradient id={`${u}-${id}`} x1="0" y1="0" x2={x2} y2="1">
      <stop offset="0" stopColor={a} />
      <stop offset="1" stopColor={b} />
    </linearGradient>
  );
  return (
    <defs>
      <radialGradient id={`${u}-fur`} cx="0.58" cy="0.22" r="0.95" fx="0.6" fy="0.18">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.45" stopColor="#f6f3ee" />
        <stop offset="0.8" stopColor="#e2ddd5" />
        <stop offset="1" stopColor="#c9c3b9" />
      </radialGradient>
      <radialGradient id={`${u}-belly`} cx="0.5" cy="0.35" r="0.7">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#ece8e0" />
      </radialGradient>
      <radialGradient id={`${u}-black`} cx="0.4" cy="0.25" r="0.9">
        <stop offset="0" stopColor="#4a423c" />
        <stop offset="0.5" stopColor="#26201c" />
        <stop offset="1" stopColor="#14110f" />
      </radialGradient>
      <radialGradient id={`${u}-nose`} cx="0.4" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#5a504a" />
        <stop offset="1" stopColor="#14110f" />
      </radialGradient>
      <radialGradient id={`${u}-eye`} cx="0.4" cy="0.3" r="0.9">
        <stop offset="0" stopColor="#6b4a32" />
        <stop offset="0.5" stopColor="#2b1c12" />
        <stop offset="1" stopColor="#0c0806" />
      </radialGradient>
      <linearGradient id={`${u}-shade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.55" stopColor="#3a2a1a" stopOpacity="0" />
        <stop offset="1" stopColor="#3a2a1a" stopOpacity="0.16" />
      </linearGradient>
      <radialGradient id={`${u}-paper`} cx="0.4" cy="0.3" r="0.9">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#e6e1d8" />
      </radialGradient>
      <radialGradient id={`${u}-pearl`} cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#d5d0e0" />
      </radialGradient>
      {lin('blue', '#79a5fb', '#3557c9', '0.4')}
      {lin('bluecuff', '#4b6fdc', '#2c47a6', '0')}
      {lin('red', '#ff5560', '#b3142a')}
      {lin('pink', '#ffc0e2', '#ec5fae')}
      {lin('gold', '#fff0a8', '#eaa526', '0')}
      {lin('goldband', '#f6c241', '#d68e14', '0')}
      {lin('purple', '#a87cf6', '#4e239a', '0.4')}
      {lin('brim', '#6a39bd', '#3c1a7c', '0')}
      {lin('brand', '#ff8a2a', '#e23a00', '0.8')}
      {lin('dark', '#4a4a54', '#14141a', '0')}
      {lin('leather', '#c98a4b', '#7a4a1e', '0.4')}
      {lin('navy', '#3a63c9', '#1a3480', '0')}
      {lin('apron', '#e6efff', '#b9cdf3', '0.3')}
      <linearGradient id={`${u}-glass`} x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#dbeaff" stopOpacity="0.4" />
        <stop offset="1" stopColor="#a9c8f0" stopOpacity="0.1" />
      </linearGradient>
      <linearGradient id={`${u}-lens`} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#3b3b44" />
        <stop offset="1" stopColor="#0a0a0e" />
      </linearGradient>
      <linearGradient id={`${u}-cone`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0.16" />
        <stop offset="0.5" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.22" />
      </linearGradient>
      <radialGradient id={`${u}-glow`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#000" stopOpacity="0.22" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/* ---------------------------------------------------------------- o panda */
const HEAD =
  'M100 30C142 30 163 54 163 85C163 117 139 135 100 135C61 135 37 117 37 85C37 54 58 30 100 30Z';
const BODY =
  'M100 120C142 120 160 147 158 177C156 200 132 210 100 210C68 210 44 200 42 177C40 147 58 120 100 120Z';

export function PandaBuddy({
  size = 120,
  mood = 'idle',
  still,
  title,
  className = '',
  style,
  wave: waveOnMount,
}: {
  size?: number;
  mood?: PandaMood;
  still?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Acena ao aparecer. */
  wave?: boolean;
}) {
  const u = 'b' + useId().replace(/[^a-zA-Z0-9]/g, '');
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
  const dead = !!still || calm();

  const play = (g: Gesture) => {
    const el = act.current;
    if (!el || dead || typeof el.animate !== 'function') return;
    const [frames, ms] = GESTURES[g];
    el.animate(frames, { duration: ms, easing: 'ease-in-out' });
  };

  // Olhar: segue o ponteiro; parado, passeia sozinho com pulinhos rápidos.
  useEffect(() => {
    const el = svg.current;
    if (!el || still) return;
    const set = (x: number, y: number) => {
      const tr = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      if (pupilL.current) pupilL.current.style.transform = tr;
      if (pupilR.current) pupilR.current.style.transform = tr;
      if (look.current)
        look.current.style.transform = `translate(${(x * 0.9).toFixed(2)}px, ${(y * 0.7).toFixed(2)}px)`;
    };
    if (shown === 'thinking') return set(-RX * 0.8, -RY * 0.9);
    if (shown === 'sleep' || shown === 'dizzy') return set(0, 0);
    let lastMove = 0;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      lastMove = Date.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height * 0.4);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / (r.width * 1.1));
        set((dx / d) * RX * k, (dy / d) * RY * k);
        if (lean.current && !dead)
          lean.current.style.transform = `rotate(${((dx / d) * k * 4).toFixed(2)}deg)`;
      });
    };
    let t: ReturnType<typeof setTimeout>;
    const wander = () => {
      if (Date.now() - lastMove > 2500 && !document.hidden) {
        if (lean.current) lean.current.style.transform = '';
        if (Math.random() < 0.35) set(RX * 0.7, -RY * 0.3);
        else set((Math.random() * 2 - 1) * RX, (Math.random() * 2 - 1) * RY * 0.8);
      }
      t = setTimeout(wander, 800 + Math.random() * 2400);
    };
    set(RX * 0.7, -RY * 0.3);
    t = setTimeout(wander, 1200);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [still, dead, shown]);

  // Piscar.
  useEffect(() => {
    const g = lids.current;
    if (!g || dead || shown === 'sleep' || shown === 'joy' || shown === 'dizzy') return;
    let t: ReturnType<typeof setTimeout>;
    const blink = (twice: boolean) => {
      g.classList.add('pb-blinking');
      setTimeout(() => {
        g.classList.remove('pb-blinking');
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

  useEffect(() => {
    if (!poke) return;
    const t = setTimeout(() => setPoke(null), poke === 'dizzy' ? 2000 : 1100);
    return () => clearTimeout(t);
  }, [poke, squish]);

  useEffect(() => {
    if (shown === 'joy' || shown === 'happy') play('hop');
    else if (shown === 'wow') play('nod');
    else if (shown === 'dizzy') play('shake');
    else if (shown === 'thinking') play('look');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // Parado, de vez em quando faz alguma coisa sozinho.
  useEffect(() => {
    if (dead) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      if (!document.hidden && (mood === 'idle' || mood === 'happy')) {
        const r = Math.random();
        if (r < 0.3) play('hop');
        else if (r < 0.55) play('sway');
        else if (r < 0.75) play('look');
        else setWave((n) => n + 1);
      }
      t = setTimeout(loop, 8000 + Math.random() * 12000);
    };
    t = setTimeout(loop, 4000 + Math.random() * 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dead, mood]);

  useEffect(() => {
    if (!dead && waveOnMount) setWave(1);
  }, [dead, waveOnMount]);

  const onPoke = () => {
    if (still) return;
    const now = Date.now();
    clicks.current = [...clicks.current.filter((c) => now - c < 2000), now];
    setSquish((n) => n + 1);
    setPoke(
      clicks.current.length >= 5 ? 'dizzy' : POKES[Math.floor(Math.random() * POKES.length)]!,
    );
  };

  const g = (n: string) => `url(#${u}-${n})`;
  const big = shown === 'wow';
  const shut = {
    stroke: '#f4f1ea',
    strokeWidth: 3.2,
    strokeLinecap: 'round' as const,
    fill: 'none',
  };

  const eye = (cx: number, cy: number, side: 'l' | 'r') => {
    if (shown === 'joy' || (shown === 'wink' && side === 'r'))
      return <path d={`M${cx - 6} ${cy + 2}q6-8 12 0`} {...shut} />;
    if (shown === 'sleep') return <path d={`M${cx - 6} ${cy}q6 5 12 0`} {...shut} />;
    if (shown === 'dizzy')
      return (
        <path
          d={`M${cx - 4.5} ${cy - 4.5}l9 9M${cx + 4.5} ${cy - 4.5}l-9 9`}
          {...shut}
          strokeWidth={2.8}
        />
      );
    const r = big ? 8.6 : 7.4;
    return (
      <g className="pb-eye">
        <ellipse cx={cx} cy={cy} rx={r} ry={r + 0.8} fill="#fbfaf6" />
        <g className="pb-pupil" ref={side === 'l' ? pupilL : pupilR}>
          <circle
            cx={cx}
            cy={cy + (shown === 'sad' ? 1.6 : 0)}
            r={big ? 5.2 : 4.9}
            fill={g('eye')}
          />
          <circle cx={cx + 1.9} cy={cy - 2.1} r="1.8" fill="#fff" />
          <circle cx={cx - 1.7} cy={cy + 2} r=".9" fill="#fff" opacity=".7" />
        </g>
        {shown === 'sad' && (
          <path
            d={`M${cx - r - 1} ${cy - r + 1}l${side === 'l' ? '' : '-'}${r * 2 + 2} ${5}`}
            stroke={INK}
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
      </g>
    );
  };

  const mouth =
    shown === 'wow' || shown === 'dizzy' ? (
      <ellipse cx="100" cy="121" rx="5.6" ry="6.8" fill="#2a0f12" stroke={INK} strokeWidth="2" />
    ) : shown === 'talking' ? (
      <ellipse
        className="pb-talk"
        cx="100"
        cy="120"
        rx="6.4"
        ry="4.6"
        fill="#2a0f12"
        stroke={INK}
        strokeWidth="2"
      />
    ) : shown === 'sad' ? (
      <path
        d="M90 123q10-9 20 0"
        stroke={INK}
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
      />
    ) : shown === 'sleep' ? (
      <path d="M92 118q8 4 16 0" stroke={INK} strokeWidth="2.8" strokeLinecap="round" fill="none" />
    ) : shown === 'joy' || shown === 'happy' ? (
      <g>
        <path
          d="M86 114q14 20 28 0Z"
          fill="#8a2a36"
          stroke={INK}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <path d="M92 122q8-5 16 0q-8 6-16 0Z" fill="#e8737f" />
      </g>
    ) : (
      <path
        d="M86 115q7 9 14 0q7 9 14 0"
        stroke={INK}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    );

  return (
    <svg
      ref={svg}
      className={`pb ${dead ? 'pb--still' : ''} ${className}`}
      width={size}
      height={(size * 250) / 200}
      viewBox="0 -30 200 250"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ overflow: 'visible', ...style }}
      onPointerDown={onPoke}
      data-mood={shown}
    >
      <Defs u={u} />
      <ellipse className="pb-shadow" cx="100" cy="213" rx="64" ry="8" fill={g('glow')} />
      <g className="pb-lean" ref={lean}>
        <g className="pb-act" ref={act}>
          <g className={`pb-life ${dead ? '' : 'pb-breathe'}`}>
            <g className={squish ? `pb-squish pb-squish-${squish % 2}` : 'pb-squish'}>
              {/* pés */}
              <g>
                <ellipse cx="70" cy="199" rx="27" ry="16" fill={g('black')} />
                <ellipse cx="130" cy="199" rx="27" ry="16" fill={g('black')} />
                <ellipse cx="70" cy="204" rx="11" ry="6.5" fill={INK2} />
                <ellipse cx="130" cy="204" rx="11" ry="6.5" fill={INK2} />
                {[
                  [60, 197],
                  [70, 195],
                  [80, 197],
                ].map(([x, y]) => (
                  <ellipse key={x} cx={x} cy={y} rx="3.2" ry="4" fill={INK2} />
                ))}
                {[
                  [120, 197],
                  [130, 195],
                  [140, 197],
                ].map(([x, y]) => (
                  <ellipse key={x} cx={x} cy={y} rx="3.2" ry="4" fill={INK2} />
                ))}
              </g>
              {/* corpo */}
              <path d={BODY} fill={g('fur')} />
              <path d={BODY} fill={g('shade')} />
              <ellipse cx="100" cy="170" rx="34" ry="30" fill={g('belly')} opacity=".9" />
              {/* braço esquerdo (preto) */}
              <path
                d="M62 132C42 138 30 160 36 190C39 202 56 202 60 190C66 172 72 156 74 142Z"
                fill={g('black')}
              />
              <path
                d="M44 156q-3 14 0 26"
                stroke="#fff"
                strokeOpacity=".16"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
              <ellipse cx="48" cy="192" rx="9" ry="6" fill={INK2} />
              {/* braço direito (acena) */}
              <g className={wave ? 'pb-arm pb-arm--wave' : 'pb-arm'} key={wave}>
                <path
                  d="M138 132C158 138 170 160 164 190C161 202 144 202 140 190C134 172 128 156 126 142Z"
                  fill={g('black')}
                />
                <path
                  d="M156 156q3 14 0 26"
                  stroke="#fff"
                  strokeOpacity=".16"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                />
                <ellipse cx="152" cy="192" rx="9" ry="6" fill={INK2} />
              </g>
              {/* orelhas */}
              <g>
                <circle cx="55" cy="46" r="21" fill={g('black')} />
                <circle cx="145" cy="46" r="21" fill={g('black')} />
                <ellipse cx="57" cy="48" rx="10" ry="9" fill="#4a3f38" />
                <ellipse cx="143" cy="48" rx="10" ry="9" fill="#4a3f38" />
                <path
                  d="M42 36q6-8 16-9"
                  stroke="#fff"
                  strokeOpacity=".18"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M158 36q-6-8-16-9"
                  stroke="#fff"
                  strokeOpacity=".18"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                />
              </g>
              {/* cabeça */}
              <path d={HEAD} fill={g('fur')} />
              <path d={HEAD} fill={g('shade')} />
              <g className="pb-look" ref={look}>
                {/* manchas dos olhos */}
                <ellipse
                  cx="73"
                  cy="88"
                  rx="15"
                  ry="21"
                  transform="rotate(24 73 88)"
                  fill={g('black')}
                />
                <ellipse
                  cx="127"
                  cy="88"
                  rx="15"
                  ry="21"
                  transform="rotate(-24 127 88)"
                  fill={g('black')}
                />
                <g className="pb-lids" ref={lids}>
                  {eye(73, 86, 'l')}
                  {eye(127, 86, 'r')}
                </g>
                {/* focinho */}
                <ellipse cx="100" cy="110" rx="23" ry="17" fill="#fffdf9" />
                <ellipse cx="100" cy="116" rx="21" ry="11" fill="#e8e2d8" opacity=".55" />
                {/* bochechas */}
                {(shown === 'joy' || shown === 'happy' || shown === 'wink' || shown === 'idle') && (
                  <g fill="#ff8a8a" opacity={shown === 'idle' ? 0.22 : 0.45}>
                    <ellipse cx="58" cy="114" rx="9" ry="5" />
                    <ellipse cx="142" cy="114" rx="9" ry="5" />
                  </g>
                )}
                {/* nariz */}
                <path d="M90 101q10-6 20 0q-1 9-10 11q-9-2-10-11Z" fill={g('nose')} />
                <ellipse cx="97" cy="102" rx="4.2" ry="1.8" fill="#fff" opacity=".55" />
                <path d="M100 112v3" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
                {mouth}
                {/* bigodes de pelo */}
                <g stroke="#cfc8bd" strokeWidth="1.2" strokeLinecap="round" opacity=".7">
                  <path d="M52 62q4 3 9 3M148 62q-4 3-9 3" />
                </g>
              </g>
            </g>
          </g>
        </g>
        {shown === 'sleep' && (
          <g className="pb-zzz" fill="currentColor" fontWeight="800" opacity=".7">
            <text x="150" y="22" fontSize="22">
              z
            </text>
            <text x="168" y="2" fontSize="16">
              z
            </text>
          </g>
        )}
        {shown === 'thinking' && (
          <g className="pb-dots" fill="currentColor" opacity=".7">
            <circle cx="160" cy="20" r="4" />
            <circle cx="172" cy="8" r="5.5" />
            <circle cx="188" cy="-8" r="8" />
          </g>
        )}
      </g>
    </svg>
  );
}
