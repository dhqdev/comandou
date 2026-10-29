import type { MascotItemId } from '@comandou/shared';

/**
 * Roupinhas do panda: cada peça é uma camada por cima do mesmo desenho (viewBox 64 do
 * LivePanda), com degradê, brilho e o mesmo contorno escuro do panda. As cores vêm dos
 * degradês de PandaDefs (ids com o prefixo `u` de cada panda na tela).
 */
const INK = 'var(--cm-mascot-ink, #1a1613)';
const line = (w: number) => ({
  stroke: INK,
  strokeWidth: w,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
});
const soft = (o: number, w: number) => ({
  fill: 'none',
  stroke: '#fff',
  strokeOpacity: o,
  strokeWidth: w,
  strokeLinecap: 'round' as const,
});

/** Degradês, texturas e padrões das peças e do próprio panda. */
export function PandaDefs({ u }: { u: string }) {
  const lin = (id: string, a: string, b: string, x2 = '0.3') => (
    <linearGradient id={`${u}-${id}`} x1="0" y1="0" x2={x2} y2="1">
      <stop offset="0" stopColor={a} />
      <stop offset="1" stopColor={b} />
    </linearGradient>
  );
  return (
    <defs>
      {/* corpo: luz vindo de cima à direita, sombra quente embaixo e à esquerda */}
      <radialGradient id={`${u}-face`} cx="0.64" cy="0.22" r="0.95" fx="0.66" fy="0.2">
        <stop offset="0" style={{ stopColor: 'var(--cm-mascot-face, #fff)' }} />
        <stop offset="0.5" stopColor="#f8f5f1" />
        <stop offset="0.82" stopColor="#ebe5de" />
        <stop offset="1" stopColor="#dcd4cb" />
      </radialGradient>
      <linearGradient id={`${u}-ink`} x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#3b3430" />
        <stop offset="1" style={{ stopColor: 'var(--cm-mascot-ink, #1a1613)' }} />
      </linearGradient>
      <radialGradient id={`${u}-ground`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#000" stopOpacity="0.2" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${u}-white`} cx="0.35" cy="0.25" r="0.9">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.6" stopColor="#f6f3ef" />
        <stop offset="1" stopColor="#ddd7d0" />
      </radialGradient>
      {lin('red', '#ff5a4f', '#b8181f')}
      {lin('brand', '#ff7a3d', '#d63400', '0.5')}
      {lin('brandDeep', '#e04a10', '#9a2600', '0')}
      {lin('dark', '#4a4650', '#16141a', '0')}
      {lin('cushion', '#ff8a5c', '#d63400', '0')}
      <linearGradient id={`${u}-shade`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0.45" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.16" />
      </linearGradient>
      <linearGradient id={`${u}-under`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.2" />
      </linearGradient>
      <pattern
        id={`${u}-check`}
        width="5"
        height="5"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(-8)"
      >
        <rect width="5" height="5" fill="#d8231d" />
        <rect width="2.5" height="2.5" fill="#fff4ef" opacity=".9" />
        <rect x="2.5" y="2.5" width="2.5" height="2.5" fill="#fff4ef" opacity=".9" />
      </pattern>
      <pattern
        id={`${u}-stripe`}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(75)"
      >
        <rect width="6" height="6" fill="#d8231d" />
        <rect width="2.4" height="6" fill="#fff5f0" />
      </pattern>
    </defs>
  );
}

const CHEF_PUFF =
  'M-12.6 -6.2C-19.8 -7 -21 -18.6 -13.2 -20.2C-12.6 -27.8 -3.8 -30 0.4 -24.8C4.6 -30.4 14.8 -27.8 13.8 -20.2C21.2 -18.8 20.4 -7.2 13 -6.2Z';
const CHEF_BAND = 'M-15.6 -7.2Q0 -10 15.6 -7.2L15.6 -0.6Q0 2.6 -15.6 -0.6Z';
const CAP_CROWN =
  'M-16.4 1.4C-17 -10.2 -9.2 -16.6 0 -16.6C9.6 -16.6 16.8 -10.2 16.4 1.4Q0 -2.2 -16.4 1.4Z';
const SANTA =
  'M-14.6 -3.6C-14.8 -15.6 -6 -24.4 5.4 -24.4C14.4 -24.4 20.6 -18.2 23.4 -9.2C24.2 -6.6 23.2 -4.8 21.4 -5.4C19.8 -10.6 16 -14.8 11.4 -16.2C14.2 -12.4 15.6 -8.2 15.4 -3.6Z';
const HEADBAND = 'M6.2 33C3.4 12.5 18 2.6 33.4 2.6C49.6 2.6 63.6 11.2 60.2 30.4';
const COLLAR =
  'M10.6 45.6C16.6 51.6 25 53.8 33 53.8C42 53.8 50.4 51.4 56 45.4L57 50.6C51 57.4 42.4 59.6 33 59.6C24.2 59.6 15.4 57.2 9.6 50.4Z';
const SCARF =
  'M10.8 46.4C17.4 52.4 25.6 54.4 33 54.4C42.4 54.4 50.4 52 55.8 46.2L56.6 51.2C50.8 57.6 42.4 59.6 33 59.6C24.4 59.6 15.6 57.4 10 51Z';

/** Peça da cabeça: assentada no alto da cabeça, entre as orelhas, com a inclinação do rosto. */
export function WearHead({ id, u }: { id: MascotItemId; u: string }) {
  const url = (n: string) => `url(#${u}-${n})`;
  switch (id) {
    case 'chef':
      return (
        <g transform="translate(35 21) rotate(-6) scale(1.06)">
          <path d={CHEF_PUFF} fill={url('white')} {...line(2)} />
          <path d={CHEF_PUFF} fill={url('shade')} />
          <path
            d="M-6.4 -8Q-8.2 -13.5 -7.2 -19M0.4 -8L0.4 -21.5M7.2 -8Q8.8 -13.5 8 -19"
            fill="none"
            stroke={INK}
            strokeOpacity=".16"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
          <path d="M-14.8 -14.5Q-15 -18.2 -11.6 -18.8" {...soft(1, 1.4)} />
          <path d={CHEF_BAND} fill={url('white')} {...line(2)} />
          <path d={CHEF_BAND} fill={url('shade')} />
          <path
            d="M-13.4 -3.8Q0 -5.6 13.4 -3.8"
            fill="none"
            stroke="#e23a00"
            strokeWidth="1.3"
            strokeLinecap="round"
            opacity=".85"
          />
        </g>
      );
    case 'cap':
      // boné laranja da marca, aba para o lado em que o panda olha
      return (
        <g transform="translate(33.4 19.6) rotate(-7)">
          <path
            d="M5.5 -1.6C14 -3.8 25.5 -2.8 29.2 1.6C25 4.8 14.2 4.4 4.6 2Z"
            fill={url('brandDeep')}
            {...line(2)}
          />
          <path d="M8 -1.2C15 -2.6 23 -2 26.6 0.6" {...soft(0.35, 1)} />
          <path d={CAP_CROWN} fill={url('brand')} {...line(2)} />
          <path d={CAP_CROWN} fill={url('shade')} />
          <path
            d="M0.2 -16.2Q1.6 -8 1 -0.8M-8.6 -14.2Q-9.8 -7 -10 0.2"
            fill="none"
            stroke={INK}
            strokeOpacity=".22"
            strokeWidth="1"
            strokeLinecap="round"
          />
          <path d="M-11.6 -8.6Q-8.4 -13.6 -3 -14.6" {...soft(0.55, 1.5)} />
          <circle cx="0.2" cy="-16.6" r="1.7" fill="#b02a00" {...line(1.2)} />
          <g transform="translate(6.4 -7.6) rotate(4)">
            <rect x="-3.6" y="-2.7" width="7.2" height="5.4" rx="1.6" fill="#fff" />
            <path
              d="M-1.9 -0.6l1.4 1.4 2.4-2.6"
              fill="none"
              stroke="#d63400"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      );
    case 'headset':
      // fone com microfone: arco por cima das orelhas, conchas nas laterais da cabeça
      return (
        <g>
          <path d={HEADBAND} fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
          <path
            d={HEADBAND}
            fill="none"
            stroke={url('dark')}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <path d="M12 15.5Q20 6 31 5" {...soft(0.35, 0.9)} />
          <path
            d="M59.6 37.6C58.6 42.6 53.6 45.6 47.4 45.2"
            fill="none"
            stroke={INK}
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <ellipse cx="46.2" cy="45.1" rx="2.3" ry="1.9" fill={url('dark')} {...line(1.2)} />
          <g transform="rotate(-8 6.4 37)">
            <rect
              x="1.6"
              y="30"
              width="9.6"
              height="14"
              rx="4.6"
              fill={url('dark')}
              {...line(1.6)}
            />
            <rect x="5.4" y="32.6" width="4.2" height="8.8" rx="2.1" fill={url('cushion')} />
          </g>
          <g transform="rotate(-10 59.6 33)">
            <rect
              x="54.8"
              y="26"
              width="9.6"
              height="14"
              rx="4.6"
              fill={url('dark')}
              {...line(1.6)}
            />
            <rect x="56.4" y="28.6" width="4.2" height="8.8" rx="2.1" fill={url('cushion')} />
          </g>
        </g>
      );
    case 'santa':
      // gorro de Papai Noel: ponta cai para o lado, pompom balança quando ele pula
      return (
        <g transform="translate(33.6 20.2) rotate(-6)">
          <path d={SANTA} fill={url('red')} {...line(2)} />
          <path d={SANTA} fill={url('shade')} />
          <path d="M-9.6 -14.8Q-5.6 -21 1.4 -22" {...soft(0.45, 1.5)} />
          <circle
            className="lp-pompom"
            cx="22.6"
            cy="-5.2"
            r="3.9"
            fill={url('white')}
            {...line(1.8)}
          />
          <path
            d="M-16.8 -6.4Q0 -9.4 16.8 -6.4Q19 -3.4 16.8 -0.4Q0 2.8 -16.8 -0.4Q-19 -3.4 -16.8 -6.4Z"
            fill={url('white')}
            {...line(2)}
          />
          <path d="M-14.6 -4.6Q-7 -6.6 0 -6.8M3.6 -6.8Q10 -6.6 14.6 -4.6" {...soft(1, 1.2)} />
          <path
            d="M-15 -1.4Q0 0.8 15 -1.4"
            fill="none"
            stroke="#000"
            strokeOpacity=".1"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </g>
      );
  }
  return null;
}

/** Peça do pescoço: abaixo do queixo, por cima da borda de baixo da cabeça. */
export function WearNeck({ id, u }: { id: MascotItemId; u: string }) {
  const url = (n: string) => `url(#${u}-${n})`;
  switch (id) {
    case 'bandana':
      // lenço xadrez de cozinha, com um nó pequeno na frente
      return (
        <g>
          <path d={COLLAR} fill={url('check')} {...line(1.8)} />
          <path d={COLLAR} fill={url('under')} />
          <g transform="translate(39.6 58.4) rotate(-6)">
            <path d="M-1.6 0.6L-5.4 7.6Q-2.2 8.8 0 6.6Z" fill={url('check')} {...line(1.5)} />
            <path d="M1.4 0.6L5.8 7Q3.2 8.8 0.6 6.8Z" fill={url('check')} {...line(1.5)} />
            <rect x="-3" y="-2.6" width="6" height="5" rx="2.2" fill="#d8231d" {...line(1.5)} />
            <path d="M-1.6 -1.2q1.2-.7 2.6-.3" {...soft(0.6, 0.8)} />
          </g>
        </g>
      );
    case 'bowtie':
      // gravatinha borboleta do garçom
      return (
        <g transform="translate(36.8 54.4) rotate(-7)">
          <path d="M0 0L-8.4 -4.6Q-10.4 0 -8.4 4.6Z" fill={url('brand')} {...line(1.7)} />
          <path d="M0 0L8.4 -4.6Q10.4 0 8.4 4.6Z" fill={url('brand')} {...line(1.7)} />
          <path d="M-6.8 -2.4L-3.2 -0.8M6.8 -2.4L3.2 -0.8" {...soft(0.45, 0.9)} />
          <rect x="-2.3" y="-2.6" width="4.6" height="5.2" rx="1.6" fill="#b02a00" {...line(1.5)} />
        </g>
      );
    case 'scarf':
      // cachecol listrado com uma ponta caindo
      return (
        <g>
          <path
            d="M41.2 55.4L40 63.6Q43.6 65.4 47.6 63.8L47.6 55Z"
            fill={url('stripe')}
            {...line(1.6)}
          />
          <path
            d="M40.2 63.8l-.4 1.8M42.6 64.6l-.2 1.8M45 64.6l.1 1.8M47.4 63.9l.4 1.7"
            stroke="#d8231d"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path d={SCARF} fill={url('stripe')} {...line(1.8)} />
          <path d={SCARF} fill={url('under')} />
        </g>
      );
  }
  return null;
}

/** As peças de pescoço que descem abaixo do queixo (a sombra do chão desce junto). */
export const LOW_NECK: MascotItemId[] = ['bandana', 'scarf'];
