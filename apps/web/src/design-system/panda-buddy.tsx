import { CSSProperties, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { PandaMood } from './panda-live';
import './panda-buddy.css';

/**
 * Panda de corpo inteiro, desenhado com volume (pelo branco com sombra suave, patas, barriga, nariz
 * brilhante, olhos de vidro) e com roupinhas. Os olhos seguem o mouse, ele pisca, respira, pula,
 * acena e amassa quando tocam. As roupinhas ficam salvas no aparelho.
 */

export type PandaSlot = 'head' | 'eyes' | 'neck';
export type PandaOutfit = Partial<Record<PandaSlot, string>>;

export const PANDA_ITEMS: { id: string; slot: PandaSlot; label: string }[] = [
  { id: 'chef', slot: 'head', label: 'Chef' },
  { id: 'party', slot: 'head', label: 'Festa' },
  { id: 'crown', slot: 'head', label: 'Coroa' },
  { id: 'beanie', slot: 'head', label: 'Gorro' },
  { id: 'cap', slot: 'head', label: 'Boné' },
  { id: 'santa', slot: 'head', label: 'Papai Noel' },
  { id: 'cowboy', slot: 'head', label: 'Caubói' },
  { id: 'witch', slot: 'head', label: 'Bruxa' },
  { id: 'headphones', slot: 'head', label: 'Fone' },
  { id: 'bow', slot: 'head', label: 'Laço' },
  { id: 'flower', slot: 'head', label: 'Flor' },
  { id: 'halo', slot: 'head', label: 'Auréola' },
  { id: 'glasses', slot: 'eyes', label: 'Óculos' },
  { id: 'sunglasses', slot: 'eyes', label: 'Óculos escuros' },
  { id: 'hearts', slot: 'eyes', label: 'Coração' },
  { id: 'scarf', slot: 'neck', label: 'Cachecol' },
  { id: 'bowtie', slot: 'neck', label: 'Gravatinha' },
  { id: 'tie', slot: 'neck', label: 'Gravata' },
  { id: 'bandana', slot: 'neck', label: 'Bandana' },
  { id: 'pearls', slot: 'neck', label: 'Colar' },
  { id: 'medal', slot: 'neck', label: 'Medalha' },
  { id: 'apron', slot: 'neck', label: 'Avental' },
];

export const PANDA_SLOTS: { id: PandaSlot; label: string }[] = [
  { id: 'head', label: 'Cabeça' },
  { id: 'eyes', label: 'Olhos' },
  { id: 'neck', label: 'Pescoço' },
];

/* ---------------------------------------------------------------- roupinha guardada no aparelho */
const KEY = 'cm-panda-outfit';
const HIDE_KEY = 'cm-panda-hidden';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const readOutfit = (): PandaOutfit => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as PandaOutfit;
    const ok: PandaOutfit = {};
    for (const s of PANDA_SLOTS) {
      const id = raw?.[s.id];
      if (id && PANDA_ITEMS.some((i) => i.slot === s.id && i.id === id)) ok[s.id] = id;
    }
    return ok;
  } catch {
    return {};
  }
};
let outfit: PandaOutfit = readOutfit();
let outfitJson = JSON.stringify(outfit);
let hidden = (() => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
})();

export function setPandaOutfit(o: PandaOutfit) {
  outfit = o;
  outfitJson = JSON.stringify(o);
  try {
    localStorage.setItem(KEY, outfitJson);
  } catch {
    /* sem storage */
  }
  emit();
}
export function usePandaOutfit(): [PandaOutfit, (o: PandaOutfit) => void] {
  useSyncExternalStore(subscribe, () => outfitJson);
  return [outfit, setPandaOutfit];
}
export function setPandaHidden(v: boolean) {
  hidden = v;
  try {
    localStorage.setItem(HIDE_KEY, v ? '1' : '0');
  } catch {
    /* sem storage */
  }
  emit();
}
export function usePandaHidden(): [boolean, (v: boolean) => void] {
  useSyncExternalStore(subscribe, () => hidden);
  return [hidden, setPandaHidden];
}
export function openPandaWardrobe() {
  window.dispatchEvent(new Event('cm:panda-wardrobe'));
}

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

/* ---------------------------------------------------------------- roupinhas */
function Hat({ id, u }: { id: string; u: string }) {
  const g = (n: string) => `url(#${u}-${n})`;
  switch (id) {
    case 'chef':
      return (
        <g>
          <g fill={g('paper')} stroke="#cfc9c0" strokeWidth="1.6">
            <circle cx="70" cy="22" r="17" />
            <circle cx="130" cy="22" r="17" />
            <circle cx="100" cy="11" r="21" />
            <circle cx="84" cy="30" r="15" />
            <circle cx="116" cy="30" r="15" />
          </g>
          <path
            d="M76 18q6-8 14-6M112 8q8-1 12 6M60 26q2-6 8-8"
            stroke="#e2ddd4"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M66 30h68l-3 20q-31 7-62 0Z"
            fill={g('paper')}
            stroke="#cfc9c0"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M76 36v10M88 37v11M100 37v12M112 37v11M124 36v10"
            stroke="#e4dfd6"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="M66 46q34 7 68 0" stroke="#cfc9c0" strokeWidth="1.6" fill="none" />
        </g>
      );
    case 'party':
      return (
        <g transform="rotate(11 100 40)">
          <path d="M72 46L100 -22L128 46Z" fill={g('pink')} />
          <path d="M72 46L100 -22L128 46Z" fill={g('cone')} />
          <g stroke="#fff" strokeWidth="3.4" strokeLinecap="round" opacity=".85">
            <path d="M92 -3l24 17" />
            <path d="M86 15l30 22" />
            <path d="M80 33l30 22" opacity=".0" />
          </g>
          {[
            [93, 31],
            [110, 22],
            [101, 8],
            [89, 41],
            [119, 38],
          ].map(([x, y], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="2.4"
              fill={['#ffd34d', '#4fa3ff', '#fff', '#2fbf7f', '#ffd34d'][i]}
            />
          ))}
          <path
            d="M72 46q28 9 56 0"
            stroke="#c43b8a"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
          <g fill={g('gold')}>
            {Array.from({ length: 8 }, (_, i) => (
              <ellipse
                key={i}
                cx={100 + Math.cos((i * Math.PI) / 4) * 7}
                cy={-22 + Math.sin((i * Math.PI) / 4) * 7}
                rx="4"
                ry="4"
              />
            ))}
            <circle cx="100" cy="-22" r="6" />
          </g>
        </g>
      );
    case 'crown':
      return (
        <g transform="rotate(-5 100 40)">
          <path
            d="M64 50L58 12L82 30L100 6L118 30L142 12L136 50Z"
            fill={g('gold')}
            stroke="#b47a10"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M66 46L62 20L80 34"
            stroke="#fff"
            strokeOpacity=".65"
            strokeWidth="2.6"
            fill="none"
            strokeLinecap="round"
          />
          <rect
            x="63"
            y="42"
            width="74"
            height="13"
            rx="4"
            fill={g('goldband')}
            stroke="#b47a10"
            strokeWidth="1.8"
          />
          {[
            [58, 12],
            [100, 6],
            [142, 12],
          ].map(([x, y]) => (
            <g key={x}>
              <circle cx={x} cy={y} r="5" fill="#fff6cf" stroke="#d99a1a" strokeWidth="1.4" />
              <circle cx={x! - 1.4} cy={y! - 1.4} r="1.4" fill="#fff" />
            </g>
          ))}
          {[
            [82, '#4f8cf0'],
            [100, '#ef4b5f'],
            [118, '#2fbf7f'],
          ].map(([x, c]) => (
            <g key={x as number}>
              <ellipse
                cx={x as number}
                cy="48.5"
                rx="5"
                ry="4.2"
                fill={c as string}
                stroke="#00000030"
                strokeWidth=".8"
              />
              <circle cx={(x as number) - 1.6} cy="47" r="1.3" fill="#fff" opacity=".85" />
            </g>
          ))}
        </g>
      );
    case 'beanie':
      return (
        <g>
          <path d="M58 56C52 0 148 0 142 56Z" fill={g('blue')} />
          {[72, 82, 92, 100, 108, 118, 128].map((x) => (
            <path
              key={x}
              d={`M${x} 22q${(x - 100) * 0.1} 10 ${(x - 100) * 0.18} 22`}
              stroke="#fff"
              strokeOpacity=".18"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
          ))}
          <path
            d="M72 24q14-12 30-12"
            stroke="#fff"
            strokeOpacity=".5"
            strokeWidth="3.4"
            fill="none"
            strokeLinecap="round"
          />
          <rect x="55" y="44" width="90" height="17" rx="8" fill={g('bluecuff')} />
          {Array.from({ length: 16 }, (_, i) => (
            <rect
              key={i}
              x={60 + i * 5.4}
              y="46.5"
              width="3"
              height="12"
              rx="1.5"
              fill="#000"
              opacity=".14"
            />
          ))}
          <g fill={g('paper')} stroke="#d4cec4" strokeWidth="1.2">
            <circle cx="100" cy="-4" r="11" />
            <circle cx="92" cy="0" r="8" />
            <circle cx="108" cy="0" r="8" />
          </g>
        </g>
      );
    case 'cap':
      return (
        <g>
          <path d="M62 54C60 16 140 16 138 54Z" fill={g('brand')} />
          <path d="M100 18v36" stroke="#000" strokeOpacity=".16" strokeWidth="1.6" />
          <path
            d="M74 30q12-8 24-8"
            stroke="#fff"
            strokeOpacity=".45"
            strokeWidth="3.4"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="100" cy="19" r="3.6" fill="#b3235f" />
          <path d="M60 52q40 12 80 0l6 4q-46 16-92 0Z" fill="#b3235f" />
          <path
            d="M62 53q38 9 76 0"
            stroke="#fff"
            strokeOpacity=".3"
            strokeWidth="1.6"
            fill="none"
          />
          <rect x="88" y="34" width="24" height="12" rx="3" fill="#fff" opacity=".9" />
          <path
            d="M93 44v-6l4 4 3-5 3 5 4-4v6"
            stroke="#e23a00"
            strokeWidth="1.8"
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
      );
    case 'santa':
      return (
        <g>
          <path
            d="M60 52C60 20 100 12 124 22C144 30 150 56 154 74C156 84 144 86 142 76C140 62 134 52 128 46L138 52Z"
            fill={g('red')}
          />
          <path d="M60 52C60 20 100 12 124 22C140 29 146 48 150 66L134 54L60 54Z" fill={g('red')} />
          <path
            d="M74 30q14-10 32-9"
            stroke="#fff"
            strokeOpacity=".4"
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="148" cy="80" r="11" fill={g('paper')} stroke="#d4cec4" strokeWidth="1.2" />
          <circle cx="141" cy="86" r="6" fill={g('paper')} />
          <circle cx="155" cy="86" r="6" fill={g('paper')} />
          <g fill={g('paper')} stroke="#d4cec4" strokeWidth="1.1">
            {Array.from({ length: 11 }, (_, i) => (
              <circle key={i} cx={57 + i * 8.6} cy={52 + Math.sin(i * 1.7) * 1.2} r="9.2" />
            ))}
          </g>
        </g>
      );
    case 'cowboy':
      return (
        <g>
          <path d="M70 46C70 20 82 12 100 16C118 12 130 20 130 46Z" fill={g('leather')} />
          <path
            d="M92 17q8 8 16 0"
            stroke="#5c340f"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M72 38q28 6 56 0v8q-28 6-56 0Z" fill="#4b2a0d" />
          <rect
            x="95"
            y="38"
            width="10"
            height="8"
            rx="2"
            fill="none"
            stroke="#f0c04a"
            strokeWidth="2"
          />
          <path
            d="M40 38C40 60 74 56 100 56C126 56 160 60 160 38C150 48 128 46 100 46C72 46 50 48 40 38Z"
            fill={g('leather')}
            stroke="#5c340f"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M52 46q22 6 48 6"
            stroke="#fff"
            strokeOpacity=".22"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    case 'witch':
      return (
        <g>
          <path
            d="M72 50C76 34 84 22 92 10C96 2 112 -6 132 -2C120 2 112 10 110 20C112 32 122 42 128 50Z"
            fill={g('purple')}
          />
          <path
            d="M90 28q4-10 12-17"
            stroke="#fff"
            strokeOpacity=".28"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M74 42q26-7 52 0l3 9q-29-7-58 0Z" fill="#ff8a2a" />
          <rect
            x="93"
            y="38"
            width="14"
            height="13"
            rx="2.5"
            fill="none"
            stroke="#ffd34d"
            strokeWidth="2.6"
          />
          <ellipse cx="100" cy="52" rx="58" ry="12" fill={g('brim')} />
          <ellipse cx="100" cy="49" rx="48" ry="7" fill="#7a46d0" />
          <path d="M138 2l2 5 5 .8-3.7 3.4 1 5-4.3-2.6-4.3 2.6 1-5-3.7-3.4 5-.8Z" fill="#ffe27a" />
        </g>
      );
    case 'headphones':
      return (
        <g>
          <path
            d="M44 88C40 18 160 18 156 88"
            stroke={g('dark')}
            strokeWidth="9"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M52 62C58 38 80 28 100 28"
            stroke="#fff"
            strokeOpacity=".28"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
          {[42, 158].map((x) => (
            <g key={x}>
              <rect x={x - 11} y="72" width="22" height="38" rx="11" fill={g('dark')} />
              <rect x={x - 6.5} y="79" width="13" height="24" rx="6.5" fill="#8b5cf0" />
              <rect x={x - 3.5} y="82" width="3.6" height="11" rx="1.8" fill="#fff" opacity=".35" />
            </g>
          ))}
        </g>
      );
    case 'bow':
      return (
        <g transform="rotate(14 138 44)">
          <path
            d="M138 44C124 28 112 34 114 46C116 58 128 56 138 44Z"
            fill={g('pink')}
            stroke="#d4408f"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M138 44C152 28 164 34 162 46C160 58 148 56 138 44Z"
            fill={g('pink')}
            stroke="#d4408f"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M120 40q6-4 12 0M156 40q-6-4-12 0"
            stroke="#fff"
            strokeOpacity=".6"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse
            cx="138"
            cy="44"
            rx="7"
            ry="8"
            fill="#ec5fae"
            stroke="#d4408f"
            strokeWidth="1.6"
          />
          <ellipse cx="136" cy="41" rx="2" ry="2.8" fill="#fff" opacity=".6" />
        </g>
      );
    case 'flower':
      return (
        <g transform="translate(136 40)">
          {Array.from({ length: 6 }, (_, i) => (
            <ellipse
              key={i}
              cx="0"
              cy="-10"
              rx="6.5"
              ry="9"
              fill={g('pink')}
              stroke="#d4408f"
              strokeWidth="1.2"
              transform={`rotate(${i * 60})`}
            />
          ))}
          <circle r="6.5" fill="#ffd34d" stroke="#d99a1a" strokeWidth="1.3" />
          <circle cx="-1.8" cy="-1.8" r="1.8" fill="#fff" opacity=".7" />
        </g>
      );
    case 'halo':
      return (
        <g>
          <ellipse
            cx="100"
            cy="14"
            rx="36"
            ry="9"
            fill="none"
            stroke="#f6c241"
            strokeOpacity=".35"
            strokeWidth="11"
          />
          <ellipse cx="100" cy="14" rx="36" ry="9" fill="none" stroke={g('gold')} strokeWidth="5" />
          <path
            d="M72 11q14-6 32-6"
            stroke="#fff"
            strokeOpacity=".8"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    default:
      return null;
  }
}

function EyeWear({ id, u }: { id: string; u: string }) {
  const g = (n: string) => `url(#${u}-${n})`;
  const L = 73;
  const R = 127;
  const Y = 86;
  switch (id) {
    case 'glasses':
      return (
        <g>
          {[L, R].map((x) => (
            <g key={x}>
              <circle cx={x} cy={Y} r="19" fill={g('glass')} />
              <circle cx={x} cy={Y} r="19" fill="none" stroke="#e8e2d6" strokeWidth="3.6" />
              <circle
                cx={x}
                cy={Y}
                r="19"
                fill="none"
                stroke="#fff"
                strokeOpacity=".25"
                strokeWidth="1"
              />
              <path
                d={`M${x - 12} ${Y - 9}q6-7 14-8`}
                stroke="#fff"
                strokeOpacity=".7"
                strokeWidth="2.6"
                fill="none"
                strokeLinecap="round"
              />
            </g>
          ))}
          <path
            d="M92 84q8-5 16 0"
            stroke="#e8e2d6"
            strokeWidth="3.4"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M54 80L40 72M146 80L160 72"
            stroke="#e8e2d6"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </g>
      );
    case 'sunglasses':
      return (
        <g>
          <path
            d="M52 76h96v6c0 14-10 22-22 22c-10 0-17-6-20-14q-6-4-12 0c-3 8-10 14-20 14c-12 0-22-8-22-22Z"
            fill={g('lens')}
            stroke="#0c0c10"
            strokeWidth="3.4"
            strokeLinejoin="round"
          />
          <path d="M60 80l14 0l-10 14l-8 0Z M128 80l14 0l-10 14l-8 0Z" fill="#fff" opacity=".14" />
          <path
            d="M58 79q8-3 18-3"
            stroke="#fff"
            strokeOpacity=".5"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M52 76L40 70M148 76L160 70"
            stroke="#0c0c10"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
        </g>
      );
    case 'hearts':
      return (
        <g>
          {[L, R].map((x) => (
            <g key={x}>
              <path
                d={`M${x} ${Y + 17}C${x - 26} ${Y + 2} ${x - 15} ${Y - 18} ${x} ${Y - 7}C${x + 15} ${Y - 18} ${x + 26} ${Y + 2} ${x} ${Y + 17}Z`}
                fill={g('red')}
                stroke="#a1122a"
                strokeWidth="2.4"
                strokeLinejoin="round"
              />
              <path
                d={`M${x - 14} ${Y - 5}q4-6 9-5`}
                stroke="#fff"
                strokeOpacity=".75"
                strokeWidth="2.6"
                fill="none"
                strokeLinecap="round"
              />
            </g>
          ))}
          <path
            d="M96 80q4-3 8 0"
            stroke="#a1122a"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M52 80L40 72M148 80L160 72"
            stroke="#a1122a"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </g>
      );
    default:
      return null;
  }
}

function NeckWear({ id, u }: { id: string; u: string }) {
  const g = (n: string) => `url(#${u}-${n})`;
  switch (id) {
    case 'scarf':
      return (
        <g>
          <path
            d="M122 140l12 40q6 4 14 0l-6-42Z"
            fill={g('red')}
            stroke="#8c1022"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M129 170l-1 0M133 175h13" stroke="#fff" strokeOpacity=".7" strokeWidth="3" />
          <path d="M130 156h14M133 166h13" stroke="#fff" strokeOpacity=".65" strokeWidth="3.2" />
          <path
            d="M148 183l-1 7M144 184l-1 7M140 183l-1 7M136 182l-1 7M152 182l0 7"
            stroke="#b3142a"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M54 130Q100 160 146 130L142 146Q100 172 58 146Z"
            fill={g('red')}
            stroke="#8c1022"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M62 138q38 22 78 0"
            stroke="#fff"
            strokeOpacity=".7"
            strokeWidth="3.2"
            fill="none"
          />
          <path
            d="M66 148q34 18 68 0"
            stroke="#fff"
            strokeOpacity=".55"
            strokeWidth="3"
            fill="none"
          />
          <path
            d="M60 134q40 18 80 -2"
            stroke="#fff"
            strokeOpacity=".3"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    case 'bowtie':
      return (
        <g>
          <path
            d="M100 142C82 128 70 134 72 146C74 158 88 156 100 142Z"
            fill={g('red')}
            stroke="#8c1022"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M100 142C118 128 130 134 128 146C126 158 112 156 100 142Z"
            fill={g('red')}
            stroke="#8c1022"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M78 140q6-4 14 0M122 140q-6-4-14 0"
            stroke="#fff"
            strokeOpacity=".5"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <rect
            x="93"
            y="134"
            width="14"
            height="16"
            rx="5"
            fill="#d3263c"
            stroke="#8c1022"
            strokeWidth="1.6"
          />
          <path
            d="M96 138v8"
            stroke="#fff"
            strokeOpacity=".55"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      );
    case 'tie':
      return (
        <g>
          <path
            d="M92 138h16l6 12l-6 10l8 28l-16 12l-16-12l8-28l-6-10Z"
            fill={g('navy')}
            stroke="#12275f"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M96 168l2 28M104 168l2 24"
            stroke="#fff"
            strokeOpacity=".22"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M94 134h12l4 8h-20Z"
            fill="#456fd6"
            stroke="#12275f"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M82 134l18 6l18-6l-4 10l-14 4l-14-4Z"
            fill="#f4f1ea"
            stroke="#cfc9c0"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M93 138h14l4 12h-22Z"
            fill={g('navy')}
            stroke="#12275f"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </g>
      );
    case 'bandana':
      return (
        <g>
          <path
            d="M56 130Q100 150 144 130L128 168Q100 190 72 168Z"
            fill={g('red')}
            stroke="#8c1022"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M56 130Q100 150 144 130L142 140Q100 160 58 140Z" fill="#000" opacity=".12" />
          {[
            [82, 150],
            [100, 160],
            [118, 150],
            [92, 170],
            [110, 170],
            [100, 144],
          ].map(([x, y], i) => (
            <g key={i} fill="#fff" opacity=".85">
              <circle cx={x} cy={y} r="2.8" />
              <circle cx={x! + 5} cy={y! + 3} r="1.6" />
            </g>
          ))}
        </g>
      );
    case 'pearls':
      return (
        <g>
          {Array.from({ length: 13 }, (_, i) => {
            const t = i / 12;
            const x = 62 + t * 76;
            const y = 134 + Math.sin(t * Math.PI) * 22;
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="5.4" fill={g('pearl')} stroke="#c9c4d4" strokeWidth=".8" />
                <circle cx={x - 1.6} cy={y - 1.8} r="1.5" fill="#fff" />
              </g>
            );
          })}
        </g>
      );
    case 'medal':
      return (
        <g>
          <path
            d="M80 130L100 168L108 164L90 130Z M120 130L100 168L92 164L110 130Z"
            fill={g('red')}
            stroke="#8c1022"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M82 134l16 28M118 134l-16 28"
            stroke="#fff"
            strokeOpacity=".45"
            strokeWidth="2.2"
          />
          <circle cx="100" cy="176" r="15" fill={g('gold')} stroke="#b47a10" strokeWidth="2" />
          <circle cx="100" cy="176" r="10.5" fill="none" stroke="#b47a10" strokeWidth="1.6" />
          <path
            d="M100 168l2.4 5 5.4.6-4 3.7 1.2 5.4-5-2.8-5 2.8 1.2-5.4-4-3.7 5.4-.6Z"
            fill="#fff6cf"
            stroke="#c98a12"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <path
            d="M90 170q4-6 12-6"
            stroke="#fff"
            strokeOpacity=".7"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    case 'apron':
      return (
        <g>
          <path
            d="M78 134L74 126M122 134L126 126"
            stroke="#3b6fd1"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M72 136h56l6 18l4 46q-38 10-76 0l4-46Z"
            fill={g('apron')}
            stroke="#2b56a8"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <rect
            x="82"
            y="164"
            width="36"
            height="22"
            rx="4"
            fill="none"
            stroke="#2b56a8"
            strokeWidth="1.8"
          />
          <path d="M82 170h36" stroke="#2b56a8" strokeWidth="1.4" />
          <path
            d="M80 144q20 6 40 0"
            stroke="#fff"
            strokeOpacity=".5"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M84 192l-2 4M100 194v5M116 192l2 4"
            stroke="#2b56a8"
            strokeOpacity=".5"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
      );
    default:
      return null;
  }
}

/** Ícone recortado de uma roupinha (grade do guarda-roupa), sem o corpo. */
export function PandaItemIcon({
  id,
  slot,
  size = 56,
}: {
  id: string;
  slot: PandaSlot;
  size?: number;
}) {
  const u = 'i' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const box =
    id === 'bow'
      ? '106 14 64 62'
      : id === 'flower'
        ? '112 14 48 48'
        : id === 'halo'
          ? '56 -8 88 44'
          : slot === 'head'
            ? '34 -34 132 92'
            : slot === 'eyes'
              ? '36 58 128 56'
              : '46 120 108 90';
  return (
    <svg
      width={size}
      height={
        size *
        (slot === 'eyes' ? 0.5 : ['bow', 'flower'].includes(id) ? 0.95 : id === 'halo' ? 0.5 : 0.7)
      }
      viewBox={box}
      aria-hidden
      style={{ overflow: 'visible' }}
    >
      <Defs u={u} />
      {slot === 'head' && <Hat id={id} u={u} />}
      {slot === 'eyes' && <EyeWear id={id} u={u} />}
      {slot === 'neck' && <NeckWear id={id} u={u} />}
    </svg>
  );
}

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
  outfit: outfitProp,
  still,
  title,
  className = '',
  style,
  wave: waveOnMount,
}: {
  size?: number;
  mood?: PandaMood;
  /** Sem isso, usa a roupinha salva neste aparelho. */
  outfit?: PandaOutfit;
  still?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Acena ao aparecer. */
  wave?: boolean;
}) {
  const [saved] = usePandaOutfit();
  const o = outfitProp ?? saved;
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
  const sunglassesUp = o.eyes === 'sunglasses' && shown !== 'idle' && shown !== 'happy';

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
              {/* roupinha do pescoço (a cabeça cobre o alto) */}
              {o.neck && <NeckWear id={o.neck} u={u} />}
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
              {/* óculos */}
              {o.eyes && (
                <g
                  className="pb-wear"
                  style={sunglassesUp ? { transform: 'translateY(-22px) scale(.94)' } : undefined}
                >
                  <EyeWear id={o.eyes} u={u} />
                </g>
              )}
              {/* chapéus e afins */}
              {o.head && <Hat id={o.head} u={u} />}
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
