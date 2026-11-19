import { autoAvatar, type CustomerAvatar } from '@comandou/shared';
import { useId, useState, type ReactNode } from 'react';
import './avatars.css';

/**
 * Avatares do cliente, no mesmo estilo das ilustrações do cardápio (traço escuro, cores
 * chapadas, a cor da loja na roupa ou no boné). Cada um é uma combinação de pele, cabelo,
 * roupa e um detalhe; quem não escolheu ganha um fixo pelo id da conta.
 */

const SKIN = ['#ffd9b8', '#f2c094', '#d9975e', '#a86b3c', '#6e4227'] as const;
const HAIR = {
  preto: '#2b1d16',
  castanho: '#6b3d2a',
  ruivo: '#b5523b',
  loiro: '#e9b44c',
  grisalho: '#b9b2ac',
} as const;
// Roupa, boné e fundo só nos tons da cor da loja (o admin troca a cor e os avatares acompanham).
const BRAND = 'var(--cm-brand-500)';
const ACCENT = 'var(--cm-brand-700)';
const SHIRT_SOFT = 'color-mix(in oklab, var(--cm-brand-500) 45%, #fff)';
const BRAND_SOFT = 'color-mix(in oklab, var(--cm-brand-500) 16%, #fff)';
const BG_2 = 'color-mix(in oklab, var(--cm-brand-500) 9%, #fff)';
const BG_3 = 'color-mix(in oklab, var(--cm-brand-500) 24%, #fff)';

type Hair = 'curto' | 'cacheado' | 'longo' | 'coque' | 'crespo' | 'lateral' | 'nenhum';
type Hat = 'chef' | 'bone' | 'gorro' | 'capacete';
interface Look {
  label: string;
  skin: string;
  hair: Hair;
  hairColor: string;
  hat?: Hat;
  shirt: string;
  bg: string;
  glasses?: boolean;
  beard?: boolean;
  mustache?: boolean;
  earrings?: boolean;
}

export const AVATAR_LOOKS: Record<CustomerAvatar, Look> = {
  curto: {
    label: 'Cabelo curto',
    skin: SKIN[0],
    hair: 'curto',
    hairColor: HAIR.castanho,
    shirt: BRAND,
    bg: BRAND_SOFT,
  },
  cacheado: {
    label: 'Cabelo cacheado',
    skin: SKIN[2],
    hair: 'cacheado',
    hairColor: HAIR.preto,
    shirt: ACCENT,
    bg: BG_2,
  },
  chef: {
    label: 'Chef',
    skin: SKIN[1],
    hair: 'curto',
    hairColor: HAIR.preto,
    hat: 'chef',
    mustache: true,
    shirt: '#ffffff',
    bg: BG_3,
  },
  bone: {
    label: 'Boné',
    skin: SKIN[3],
    hair: 'curto',
    hairColor: HAIR.preto,
    hat: 'bone',
    shirt: SHIRT_SOFT,
    bg: BG_2,
  },
  oculos: {
    label: 'Óculos',
    skin: SKIN[0],
    hair: 'longo',
    hairColor: HAIR.ruivo,
    glasses: true,
    shirt: SHIRT_SOFT,
    bg: BG_3,
  },
  coque: {
    label: 'Coque',
    skin: SKIN[4],
    hair: 'coque',
    hairColor: HAIR.preto,
    earrings: true,
    shirt: ACCENT,
    bg: BG_2,
  },
  barba: {
    label: 'Barba',
    skin: SKIN[1],
    hair: 'lateral',
    hairColor: HAIR.castanho,
    beard: true,
    shirt: ACCENT,
    bg: BG_2,
  },
  gorro: {
    label: 'Gorro',
    skin: SKIN[2],
    hair: 'curto',
    hairColor: HAIR.castanho,
    hat: 'gorro',
    shirt: BRAND,
    bg: BG_3,
  },
  crespo: {
    label: 'Cabelo crespo',
    skin: SKIN[4],
    hair: 'crespo',
    hairColor: HAIR.preto,
    shirt: SHIRT_SOFT,
    bg: BRAND_SOFT,
  },
  capacete: {
    label: 'Capacete',
    skin: SKIN[1],
    hair: 'nenhum',
    hairColor: HAIR.preto,
    hat: 'capacete',
    shirt: ACCENT,
    bg: BG_2,
  },
  grisalho: {
    label: 'Cabelo grisalho',
    skin: SKIN[0],
    hair: 'coque',
    hairColor: HAIR.grisalho,
    glasses: true,
    shirt: SHIRT_SOFT,
    bg: BG_3,
  },
  longo: {
    label: 'Cabelo longo',
    skin: SKIN[1],
    hair: 'longo',
    hairColor: HAIR.loiro,
    shirt: BRAND,
    bg: BG_2,
  },
};

/** Círculos que viram uma forma só (cachos, nuvem do chapéu): contorno por fora, sem riscos dentro. */
function Puffs({ c, fill }: { c: [number, number, number][]; fill: string }) {
  return (
    <>
      {c.map(([x, y, r], i) => (
        <circle key={`o${i}`} cx={x} cy={y} r={r} className="av-ink-fill" strokeWidth="4.4" />
      ))}
      {c.map(([x, y, r], i) => (
        <circle key={`f${i}`} cx={x} cy={y} r={r} fill={fill} />
      ))}
    </>
  );
}

const CURLS: [number, number, number][] = [
  [32, 40, 8],
  [34, 30, 8.5],
  [42, 23, 9],
  [52, 21, 9],
  [61, 25, 8.5],
  [67, 33, 8],
  [69, 42, 7],
];
const AFRO: [number, number, number][] = [
  [50, 34, 24],
  [30, 42, 11],
  [70, 42, 11],
  [36, 22, 12],
  [64, 22, 12],
];

function backHair(l: Look): ReactNode {
  const f = l.hairColor;
  if (l.hat === 'capacete') return null;
  switch (l.hair) {
    case 'longo':
      return (
        <path
          className="av-ink"
          fill={f}
          d="M28 46 C26 26 37 17 50 17 C63 17 74 26 72 46 L75 80 C66 86 34 86 25 80 Z"
        />
      );
    case 'coque':
      return <circle className="av-ink" fill={f} cx="50" cy="15" r="9" />;
    case 'crespo':
      return <Puffs c={AFRO} fill={f} />;
    default:
      return null;
  }
}

function frontHair(l: Look): ReactNode {
  const f = l.hairColor;
  if (l.hat === 'capacete') return null;
  switch (l.hair) {
    case 'curto':
    case 'coque':
      return (
        <path
          className="av-ink"
          fill={f}
          d="M31 45 C29 30 38 21 50 21 C62 21 71 30 69 45 C66 37 60 31 50 31 C42 31 35 36 31 45 Z"
        />
      );
    case 'lateral':
      return (
        <path
          className="av-ink"
          fill={f}
          d="M31 45 C28 29 38 20 51 20 C64 20 72 29 69 45 C66 38 62 33 56 31 C50 36 40 37 31 45 Z"
        />
      );
    case 'longo':
      return (
        <path
          className="av-ink"
          fill={f}
          d="M31 47 C30 30 39 21 50 21 C61 21 70 30 69 47 C65 38 58 32 51 29 C46 35 38 40 31 47 Z"
        />
      );
    case 'cacheado':
      return <Puffs c={CURLS} fill={f} />;
    case 'crespo':
      return (
        <path
          fill={f}
          d="M31 44 C30 32 38 24 50 24 C62 24 70 32 69 44 C64 37 58 34 50 34 C42 34 36 37 31 44 Z"
        />
      );
    default:
      return null;
  }
}

function hat(l: Look): ReactNode {
  switch (l.hat) {
    case 'chef':
      return (
        <>
          <Puffs
            c={[
              [37, 20, 10],
              [50, 13, 12],
              [63, 20, 10],
            ]}
            fill="#fff"
          />
          <rect className="av-ink" fill="#fff" x="32" y="22" width="36" height="13" rx="3" />
        </>
      );
    case 'bone':
      return (
        <>
          <path
            className="av-ink"
            fill={BRAND}
            d="M29 40 C29 25 38 18 50 18 C62 18 71 25 71 40 Z"
          />
          <path
            className="av-ink"
            fill="var(--cm-brand-600)"
            d="M50 40 H82 C85 40 85 45 81 46 H50 Z"
          />
          <circle
            className="av-ink"
            fill="var(--cm-brand-600)"
            cx="50"
            cy="18"
            r="3"
            strokeWidth="2"
          />
          <path className="av-shine" d="M37 30 C39 26 42 24 46 23" />
        </>
      );
    case 'gorro':
      return (
        <>
          <circle className="av-ink" fill="#fff" cx="50" cy="12" r="5.5" />
          <path
            className="av-ink"
            fill={ACCENT}
            d="M29 40 C29 23 38 15 50 15 C62 15 71 23 71 40 Z"
          />
          <rect className="av-ink" fill={ACCENT} x="27" y="35" width="46" height="10" rx="5" />
          <path className="av-rib" d="M36 37 V43 M44 37 V43 M52 37 V43 M60 37 V43 M66 37 V43" />
        </>
      );
    case 'capacete':
      return (
        <>
          <path
            className="av-ink"
            fill="#fff"
            d="M26 52 C25 30 36 17 50 17 C64 17 75 30 74 52 C74 60 70 63 64 63 H36 C30 63 26 60 26 52 Z"
          />
          <path className="av-stripe" d="M30 38 C33 26 41 20 50 19" />
          <path
            className="av-ink"
            fill="var(--av-ink)"
            d="M33 40 H67 C69 40 70 42 70 44 V52 C70 55 68 57 65 57 H35 C32 57 30 55 30 52 V44 C30 42 31 40 33 40 Z"
          />
          <path className="av-visor-shine" d="M38 45 C42 44 48 44 52 45" />
        </>
      );
    default:
      return null;
  }
}

/** Desenho de um avatar (quadrado, recortado em círculo). */
export function AvatarArt({ id, className = '' }: { id: CustomerAvatar; className?: string }) {
  const l = AVATAR_LOOKS[id] ?? AVATAR_LOOKS.curto;
  const clip = useId().replace(/:/g, '');
  const helmet = l.hat === 'capacete';
  return (
    <svg
      className={`av ${className}`}
      viewBox="0 0 100 100"
      aria-hidden
      focusable="false"
      style={{ ['--av-skin' as string]: l.skin }}
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="100" height="100" fill={l.bg} />
        {backHair(l)}
        <path
          className="av-ink"
          fill={l.shirt}
          d="M10 106 C12 82 29 71 50 71 C71 71 88 82 90 106 Z"
        />
        <path className="av-ink av-skin" d="M43 60 V72 C46 76 54 76 57 72 V60 Z" />
        <path className="av-collar" d="M42 73 Q50 82 58 73" />
        {!helmet && (
          <>
            <circle className="av-ink av-skin" cx="31" cy="47" r="5" />
            <circle className="av-ink av-skin" cx="69" cy="47" r="5" />
          </>
        )}
        {l.earrings && (
          <>
            <circle className="av-ink" fill={BRAND} cx="30" cy="55" r="2.6" strokeWidth="1.6" />
            <circle className="av-ink" fill={BRAND} cx="70" cy="55" r="2.6" strokeWidth="1.6" />
          </>
        )}
        <ellipse className="av-ink av-skin" cx="50" cy="44" rx="19" ry="21" />
        {l.beard && (
          <path
            className="av-ink"
            fill={l.hairColor}
            d="M31.5 46 C32 61 40 66 50 66 C60 66 68 61 68.5 46 C66 54 60 56 50 56 C40 56 34 54 31.5 46 Z"
          />
        )}
        {!helmet && (
          <>
            <ellipse className="av-eye" cx="43.5" cy="46" rx="2.3" ry="2.9" />
            <ellipse className="av-eye" cx="56.5" cy="46" rx="2.3" ry="2.9" />
            <circle className="av-blush" cx="38.5" cy="53" r="3.6" />
            <circle className="av-blush" cx="61.5" cy="53" r="3.6" />
          </>
        )}
        {l.mustache && (
          <path
            className="av-ink"
            fill={l.hairColor}
            strokeWidth="1.8"
            d="M42 54.5 C45 51.5 48.5 52 50 54 C51.5 52 55 51.5 58 54.5 C55 57.5 51.5 56.5 50 55.5 C48.5 56.5 45 57.5 42 54.5 Z"
          />
        )}
        <path
          className={l.beard ? 'av-mouth av-mouth--beard' : 'av-mouth'}
          d={helmet ? 'M45 60 Q50 63.5 55 60' : 'M44.5 56 Q50 61 55.5 56'}
        />
        {l.glasses && (
          <g className="av-glasses">
            <circle cx="43.5" cy="46" r="6.2" />
            <circle cx="56.5" cy="46" r="6.2" />
            <path d="M49.7 46 H50.3 M37.3 45 L32 43.5 M62.7 45 L68 43.5" />
          </g>
        )}
        {frontHair(l)}
        {hat(l)}
      </g>
      <circle className="av-rim" cx="50" cy="50" r="48.5" />
    </svg>
  );
}

/** Quem aparece no perfil: a foto (se pôs), o avatar escolhido ou o automático da conta. */
export function avatarOf(c: { id: string; avatar?: string | null }): CustomerAvatar {
  return c.avatar && c.avatar in AVATAR_LOOKS ? (c.avatar as CustomerAvatar) : autoAvatar(c.id);
}

/** Foto ou avatar do cliente, redondo. Se a foto não carregar, cai no avatar. */
export function CustomerAvatar({
  customer,
  size = 40,
  className = '',
  decorative,
}: {
  customer: { id: string; name: string; avatar?: string | null; photoUrl?: string | null };
  size?: number;
  className?: string;
  /** Ao lado do nome (aba, lista): o leitor de tela pula a imagem. */
  decorative?: boolean;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const photo = customer.photoUrl && broken !== customer.photoUrl ? customer.photoUrl : null;
  return (
    <span
      className={`cavatar ${className}`}
      style={{ width: size, height: size }}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Foto de ${customer.name}`}
    >
      {photo ? (
        <img src={photo} alt="" onError={() => setBroken(photo)} decoding="async" />
      ) : (
        <AvatarArt id={avatarOf(customer)} />
      )}
    </span>
  );
}
