import type { BirthdayTheme } from '@comandou/shared';
import { covers, type FontMetrics, textWidth } from './font-metrics';

/**
 * Arte do parabéns (1080 × 1350, retrato 4:5, o tamanho que o WhatsApp mostra inteiro): SVG puro,
 * desenhado aqui e transformado em PNG por `birthday-image.ts`. Quatro estilos com a cor e a logo
 * do restaurante, o primeiro nome do cliente bem grande e, se houver, o presente. O confete e as
 * estrelinhas mudam de lugar conforme o nome (cada cliente recebe uma arte um pouco diferente).
 * É arte para o cliente, não tela de trabalho: aqui valem degradê e enfeite.
 */

export const ART_W = 1080;
export const ART_H = 1350;

export type FontKey = 'body' | 'bold' | 'script' | 'serif';
export type ArtFonts = Record<FontKey, FontMetrics>;

/** Atributos de fonte do SVG (os nomes que estão nos arquivos de assets/fonts). */
const FONT: Record<FontKey, string> = {
  body: 'font-family="Inter" font-weight="500"',
  bold: 'font-family="Inter" font-weight="800"',
  script: 'font-family="Pacifico"',
  serif: 'font-family="Playfair Display" font-weight="700" font-style="italic"',
};

export interface ArtInput {
  theme: BirthdayTheme;
  /** Primeiro nome do cliente (vazio = arte genérica, "Parabéns!"). */
  name: string;
  /** Frase pequena embaixo do nome. */
  line: string;
  restaurant: string;
  /** Cor da marca da loja (#rrggbb); sem ela, o laranja do Comandou. */
  brand?: string | null;
  /** Logo já em PNG ou JPEG (data URI). Sem logo, as iniciais da loja num círculo. */
  logo?: string | null;
  gift?: { title: string; note: string } | null;
}

// ------------------------------------------------------------------ cores

const DEFAULT_BRAND = '#e23a00';
const INK = '#221a14';
type Rgb = [number, number, number];

const rgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const hex = (c: Rgb) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Mistura duas cores (t = 0 fica a primeira, 1 a segunda). */
export function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((v, i) => v + (y[i]! - v) * t) as Rgb);
}

function luminance(h: string) {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** A cor escurecida (ou clareada) até dar leitura sobre o fundo. */
export function readable(color: string, bg: string, min = 4.5) {
  const toward = luminance(bg) > 0.4 ? '#000000' : '#ffffff';
  let c = color;
  for (let i = 0; i < 24 && contrast(c, bg) < min; i++) c = mix(c, toward, 0.1);
  return c;
}

const brandOf = (b?: string | null) =>
  b && /^#[0-9a-f]{6}$/i.test(b) ? b.toLowerCase() : DEFAULT_BRAND;

// ------------------------------------------------------------------ sorteio fixo pelo nome

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ texto

export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const r1 = (n: number) => Math.round(n * 10) / 10;

class Typesetter {
  constructor(readonly fonts: ArtFonts) {}

  width(key: FontKey, text: string, size: number, spacing = 0) {
    return textWidth(this.fonts[key], text, size, spacing);
  }

  /** Maior tamanho (entre min e max) em que o texto cabe na largura (3% de folga do kerning). */
  fit(key: FontKey, text: string, maxWidth: number, max: number, min: number, spacing = 0) {
    const per = this.width(key, text, 100) / 100;
    if (per <= 0) return max;
    const room = maxWidth * 0.97 - Math.max(0, [...text].length - 1) * spacing;
    return Math.max(min, Math.min(max, Math.floor(room / per)));
  }

  /** Corta com reticências o que não cabe nem no tamanho mínimo. */
  clip(key: FontKey, text: string, size: number, maxWidth: number, spacing = 0) {
    if (this.width(key, text, size, spacing) <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && this.width(key, `${t}…`, size, spacing) > maxWidth) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  /** Quebra em até `lines` linhas pelas palavras (a última corta com reticências). */
  wrap(key: FontKey, text: string, size: number, maxWidth: number, lines = 2) {
    const words = text.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (!cur || this.width(key, next, size) <= maxWidth) cur = next;
      else {
        out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
    if (out.length <= lines) return out.map((l) => this.clip(key, l, size, maxWidth));
    const kept = out.slice(0, lines);
    kept[lines - 1] = this.clip(
      key,
      `${kept[lines - 1]} ${out.slice(lines).join(' ')}`,
      size,
      maxWidth,
    );
    return kept;
  }

  /** Só os caracteres que a fonte desenha (emoji e letras de outros alfabetos saem). */
  clean(key: FontKey, text: string) {
    return [...text]
      .filter((ch) => covers(this.fonts[key], ch))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function text(
  key: FontKey,
  x: number,
  y: number,
  size: number,
  fill: string,
  value: string,
  opts: { anchor?: 'start' | 'middle' | 'end'; spacing?: number; extra?: string } = {},
) {
  const sp = opts.spacing ? ` letter-spacing="${opts.spacing}"` : '';
  return `<text x="${r1(x)}" y="${r1(y)}" ${FONT[key]} font-size="${r1(size)}" fill="${fill}" text-anchor="${opts.anchor ?? 'middle'}"${sp}${opts.extra ?? ''}>${esc(value)}</text>`;
}

// ------------------------------------------------------------------ peças

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase('pt-BR'))
    .join('') || 'C';

/** Logo num círculo branco com anel; sem logo, as iniciais da loja. */
function logoBadge(
  t: Typesetter,
  a: ArtInput,
  o: { cx: number; cy: number; r: number; ring: string; ringW: number; fill: string; ink: string },
) {
  const { cx, cy, r } = o;
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r + o.ringW}" fill="${o.ring}"/>`;
  if (a.logo) {
    const s = r * 1.56;
    return `${ring}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff"/>
<clipPath id="logo-clip"><circle cx="${cx}" cy="${cy}" r="${r - 2}"/></clipPath>
<image x="${r1(cx - s / 2)}" y="${r1(cy - s / 2)}" width="${r1(s)}" height="${r1(s)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#logo-clip)" href="${a.logo}"/>`;
  }
  const ini = t.clean('bold', initials(a.restaurant)) || 'C';
  const size = t.fit('bold', ini, r * 1.3, r * 0.9, r * 0.5);
  return `${ring}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill}"/>${text('bold', cx, cy + size * 0.36, size, o.ink, ini)}`;
}

/** Caixa de presente desenhada (sem emoji: a fonte não tem). */
function giftIcon(x: number, y: number, s: number, box: string, ribbon: string) {
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${r1(s)})">
<path d="M-12 -14 C-26 -30 -30 -12 -12 -10 Z M12 -14 C26 -30 30 -12 12 -10 Z" fill="none" stroke="${ribbon}" stroke-width="4" stroke-linejoin="round"/>
<rect x="-24" y="-12" width="48" height="13" rx="3" fill="${box}"/>
<rect x="-20" y="1" width="40" height="27" rx="3" fill="${box}"/>
<rect x="-4" y="-12" width="8" height="40" fill="${ribbon}"/>
</g>`;
}

function balloon(
  x: number,
  y: number,
  rx: number,
  color: string,
  tilt: number,
  stringColor: string,
) {
  const ry = rx * 1.22;
  return `<g transform="rotate(${tilt} ${x} ${y + ry})">
<path d="M${x} ${y + ry + 10} c-16 52 22 96 -6 168" fill="none" stroke="${stringColor}" stroke-width="2.5" stroke-linecap="round"/>
<path d="M${x - 10} ${y + ry + 12} L${x + 10} ${y + ry + 12} L${x} ${y + ry - 4} Z" fill="${color}"/>
<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${r1(ry)}" fill="${color}"/>
<ellipse cx="${r1(x - rx * 0.4)}" cy="${r1(y - ry * 0.38)}" rx="${r1(rx * 0.16)}" ry="${r1(ry * 0.26)}" fill="#ffffff" opacity="0.38" transform="rotate(-24 ${r1(x - rx * 0.4)} ${r1(y - ry * 0.38)})"/>
</g>`;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** O ponto (com uma folga) cai fora de todas as áreas de texto? */
const clear = (x: number, y: number, avoid: Box[], pad = 14) =>
  avoid.every((b) => x < b.x0 - pad || x > b.x1 + pad || y < b.y0 - pad || y > b.y1 + pad);

/** Confete espalhado, nunca em cima do texto. */
function confetti(rand: () => number, n: number, palette: string[], avoid: Box[]) {
  const out: string[] = [];
  let tries = 0;
  while (out.length < n && tries++ < n * 20) {
    const x = rand() * ART_W;
    const y = rand() * ART_H;
    if (!clear(x, y, avoid, 22)) continue;
    const c = palette[Math.floor(rand() * palette.length)]!;
    const rot = Math.round(rand() * 180);
    const kind = rand();
    const op = r1(0.55 + rand() * 0.45);
    if (kind < 0.45)
      out.push(
        `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(12 + rand() * 12)}" height="${r1(6 + rand() * 5)}" rx="2" fill="${c}" opacity="${op}" transform="rotate(${rot} ${r1(x)} ${r1(y)})"/>`,
      );
    else if (kind < 0.75)
      out.push(
        `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(4 + rand() * 6)}" fill="${c}" opacity="${op}"/>`,
      );
    else
      out.push(
        `<path d="M${r1(x)} ${r1(y)} q6 -10 12 0 t12 0 t12 0" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" opacity="${op}" transform="rotate(${rot} ${r1(x)} ${r1(y)})"/>`,
      );
  }
  return out.join('\n');
}

/** Estrela de quatro pontas (brilho). */
const sparkle = (x: number, y: number, s: number, fill: string, op = 1) =>
  `<path d="M${r1(x)} ${r1(y - s)} Q${r1(x)} ${r1(y)} ${r1(x + s)} ${r1(y)} Q${r1(x)} ${r1(y)} ${r1(x)} ${r1(y + s)} Q${r1(x)} ${r1(y)} ${r1(x - s)} ${r1(y)} Q${r1(x)} ${r1(y)} ${r1(x)} ${r1(y - s)} Z" fill="${fill}" opacity="${op}"/>`;

/** Bandeirinhas penduradas num cordão (estilo Bolo). */
function bunting(colors: string[], line: string) {
  // Cordão de p0 a p2, passando por (540, 150) no meio (p1 é o ponto de controle).
  const p0 = { x: -30, y: 34 };
  const p1 = { x: 540, y: 266 };
  const p2 = { x: 1110, y: 34 };
  const at = (t: number) => ({
    x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t ** 2 * p2.x,
    y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t ** 2 * p2.y,
  });
  const flags: string[] = [];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const a = at((i + 0.18) / n);
    const b = at((i + 0.82) / n);
    const tip = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 66 };
    flags.push(
      `<path d="M${r1(a.x)} ${r1(a.y)} L${r1(b.x)} ${r1(b.y)} L${r1(tip.x)} ${r1(tip.y)} Z" fill="${colors[i % colors.length]}"/>`,
    );
  }
  return `<path d="M${p0.x} ${p0.y} Q${p1.x} ${p1.y} ${p2.x} ${p2.y}" fill="none" stroke="${line}" stroke-width="3"/>${flags.join('')}`;
}

/** Cobertura que escorre do topo de um andar do bolo. */
function drips(x0: number, x1: number, y: number, color: string, rand: () => number) {
  let d = `M${x0} ${y - 6} H${x1} V${y + 18}`;
  let x = x1;
  while (x > x0 + 8) {
    const w = 34 + rand() * 26;
    const nx = Math.max(x0, x - w);
    const deep = 22 + rand() * 34;
    d += ` C${r1(x - w * 0.15)} ${r1(y + 18 + deep)} ${r1(nx + w * 0.15)} ${r1(y + 18 + deep)} ${r1(nx)} ${y + 18}`;
    x = nx;
  }
  return `<path d="${d} V${y - 6} Z" fill="${color}"/>`;
}

function cake(
  t: Typesetter,
  a: ArtInput,
  rand: () => number,
  c: { brand: string; top: string; plate: string; cream: string; onBrand: string },
) {
  const out: string[] = [];
  // Prato.
  out.push(`<ellipse cx="540" cy="1252" rx="350" ry="36" fill="${c.plate}"/>`);
  out.push(
    `<ellipse cx="540" cy="1244" rx="300" ry="22" fill="${mix(c.plate, '#ffffff', 0.45)}"/>`,
  );
  // Andar de baixo, com o nome da loja escrito.
  out.push(`<rect x="300" y="1058" width="480" height="186" rx="26" fill="${c.brand}"/>`);
  out.push(drips(300, 780, 1058, c.cream, rand));
  const name = t.clean('bold', a.restaurant) || 'Parabéns';
  const size = t.fit('bold', name, 420, 46, 26);
  out.push(text('bold', 540, 1196, size, c.onBrand, t.clip('bold', name, size, 420)));
  // Andar de cima.
  out.push(`<rect x="382" y="940" width="316" height="130" rx="22" fill="${c.top}"/>`);
  out.push(drips(382, 698, 940, c.cream, rand));
  for (let i = 0; i < 6; i++)
    out.push(
      `<circle cx="${412 + i * 51}" cy="1040" r="7" fill="${mix(c.top, '#ffffff', 0.55)}"/>`,
    );
  // Velas e chamas.
  for (let i = 0; i < 5; i++) {
    const x = 432 + i * 54;
    const h = 64 + (i % 2) * 10;
    out.push(
      `<rect x="${x - 8}" y="${940 - h}" width="16" height="${h}" rx="5" fill="${i % 2 ? '#fff4d6' : mix(c.brand, '#ffffff', 0.55)}"/>`,
    );
    out.push(
      `<path d="M${x - 8} ${940 - h + 18} l16 -9 M${x - 8} ${940 - h + 38} l16 -9" stroke="${mix(c.brand, '#ffffff', 0.2)}" stroke-width="3"/>`,
    );
    out.push(`<circle cx="${x}" cy="${940 - h - 22}" r="20" fill="#ffd166" opacity="0.28"/>`);
    out.push(
      `<path d="M${x} ${940 - h - 44} C${x + 14} ${940 - h - 24} ${x + 10} ${940 - h - 6} ${x} ${940 - h - 6} C${x - 10} ${940 - h - 6} ${x - 14} ${940 - h - 24} ${x} ${940 - h - 44} Z" fill="#ffb703"/>`,
    );
    out.push(`<ellipse cx="${x}" cy="${940 - h - 16}" rx="4.5" ry="8" fill="#fff1c2"/>`);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ estilos

interface Ctx {
  t: Typesetter;
  a: ArtInput;
  brand: string;
  rand: () => number;
  name: string;
  line: string;
}

/** Nome grande do cliente (vazio = "Parabéns!"). */
function nameOf(t: Typesetter, key: FontKey, a: ArtInput) {
  return t.clean(key, a.name).slice(0, 24) || 'Parabéns!';
}

function giftCard(
  t: Typesetter,
  gift: NonNullable<ArtInput['gift']>,
  o: {
    x: number;
    y: number;
    w: number;
    h: number;
    fill: string;
    stroke?: string;
    titleKey: FontKey;
    title: string;
    note: string;
    box: string;
    ribbon: string;
  },
) {
  const pad = 40;
  const iconW = 86;
  const textX = o.x + pad + iconW;
  const maxW = o.w - pad * 2 - iconW;
  const title = t.clean(o.titleKey, gift.title) || 'Presente';
  let size = t.fit(o.titleKey, title, maxW, 50, 34);
  let lines = [title];
  if (t.width(o.titleKey, title, size) > maxW) {
    size = 36;
    lines = t.wrap(o.titleKey, title, size, maxW, 2);
  }
  const note = t.clip('body', t.clean('body', gift.note), 28, maxW);
  const block = lines.length * size * 1.08 + (note ? 40 : 0);
  let y = o.y + (o.h - block) / 2 + size * 0.82;
  const parts = [
    `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="34" fill="${o.fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="2.5"` : ''}/>`,
    giftIcon(o.x + pad + 30, o.y + o.h / 2 - 2, 1.25, o.box, o.ribbon),
  ];
  for (const l of lines) {
    parts.push(text(o.titleKey, textX, y, size, o.title, l, { anchor: 'start' }));
    y += size * 1.08;
  }
  if (note) parts.push(text('body', textX, y + 4, 28, o.note, note, { anchor: 'start' }));
  return parts.join('\n');
}

function festa(c: Ctx) {
  const { t, a, brand, rand } = c;
  const light = luminance(brand) > 0.45;
  const fg = light ? INK : '#ffffff';
  const soft = light ? mix(INK, brand, 0.3) : mix('#ffffff', brand, 0.22);
  const name = nameOf(t, 'bold', a);
  const nameSize = t.fit('bold', name, 900, 230, 96);
  const shift = a.gift ? 0 : 120;
  const avoid: Box[] = [
    { x0: 440, y0: 76, x1: 640, y1: 260 },
    { x0: 120, y0: 320 + shift, x1: 960, y1: 720 + shift },
    { x0: 160, y0: 1120, x1: 920, y1: 1262 },
    ...(a.gift ? [{ x0: 150, y0: 780, x1: 930, y1: 960 }] : []),
  ];
  const out = [
    `<defs><radialGradient id="glow" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${mix(brand, '#ffffff', 0.2)}"/><stop offset="1" stop-color="${mix(brand, '#000000', 0.12)}"/></radialGradient></defs>`,
    `<rect width="${ART_W}" height="${ART_H}" fill="url(#glow)"/>`,
    confetti(
      rand,
      90,
      ['#ffffff', '#ffd166', mix(brand, '#ffffff', 0.55), mix(brand, '#000000', 0.3), '#8ee3d0'],
      avoid,
    ),
    balloon(925, 170, 62, '#ffd166', 8, soft),
    balloon(1018, 262, 50, mix(brand, '#000000', 0.28), 14, soft),
    balloon(836, 246, 44, '#ffffff', -6, soft),
    balloon(140, 196, 56, '#ffffff', -10, soft),
    balloon(54, 290, 44, '#ffd166', -16, soft),
    logoBadge(t, a, {
      cx: 540,
      cy: 168,
      r: 78,
      ring: light ? INK : '#ffffff',
      ringW: 6,
      fill: mix(brand, '#000000', 0.25),
      ink: '#ffffff',
    }),
    text('script', 540, 405 + shift, 96, fg, 'Feliz aniversário,'),
    text('bold', 540, 612 + shift, nameSize, fg, t.clip('bold', name, nameSize, 920)),
    text('body', 540, 700 + shift, 44, soft, t.clip('body', c.line, 44, 900)),
  ];
  if (a.gift)
    out.push(
      giftCard(t, a.gift, {
        x: 150,
        y: 780,
        w: 780,
        h: 180,
        fill: '#ffffff',
        titleKey: 'bold',
        title: readable(brand, '#ffffff'),
        note: '#6e6259',
        box: brand,
        ribbon: '#ffd166',
      }),
    );
  out.push(text('script', 540, 1176, 40, soft, 'com carinho,'));
  const rest = t.clean('bold', a.restaurant) || 'Seu restaurante';
  const rs = t.fit('bold', rest, 860, 46, 28);
  out.push(text('bold', 540, 1246, rs, fg, t.clip('bold', rest, rs, 880)));
  return out.join('\n');
}

function bolo(c: Ctx) {
  const { t, a, brand, rand } = c;
  const cream = mix(brand, '#ffffff', 0.93);
  const head = readable(brand, cream, 3.2);
  const name = nameOf(t, 'bold', a);
  const nameSize = t.fit('bold', name, 880, 196, 90);
  const shift = a.gift ? 0 : 64;
  const sprinkles: string[] = [];
  const colors = [brand, '#ffb703', '#2ec4b6', mix(brand, '#ffffff', 0.5)];
  for (let i = 0; i < 34; i++) {
    const x = rand() * ART_W;
    const y = 260 + rand() * 1060;
    if (x > 150 && x < 930 && y > 300 && y < 1270) continue;
    sprinkles.push(
      `<rect x="${r1(x)}" y="${r1(y)}" width="22" height="7" rx="3.5" fill="${colors[i % colors.length]}" transform="rotate(${Math.round(rand() * 180)} ${r1(x)} ${r1(y)})"/>`,
    );
  }
  const out = [
    `<rect width="${ART_W}" height="${ART_H}" fill="${cream}"/>`,
    `<circle cx="-40" cy="1120" r="230" fill="${mix(brand, cream, 0.86)}"/>`,
    `<circle cx="1120" cy="560" r="200" fill="${mix(brand, cream, 0.88)}"/>`,
    sprinkles.join('\n'),
    bunting([brand, '#ffb703', '#2ec4b6', mix(brand, '#ffffff', 0.45)], mix(brand, INK, 0.4)),
    logoBadge(t, a, {
      cx: 540,
      cy: 262,
      r: 62,
      ring: brand,
      ringW: 5,
      fill: brand,
      ink: readable('#ffffff', brand, 3),
    }),
    text('script', 540, 440 + shift, 92, head, 'Parabéns,'),
    text('bold', 540, 600 + shift, nameSize, INK, t.clip('bold', name, nameSize, 900)),
    text('body', 540, 668 + shift, 40, '#6e6259', t.clip('body', c.line, 40, 880)),
  ];
  if (a.gift)
    out.push(
      giftCard(t, a.gift, {
        x: 190,
        y: 712,
        w: 700,
        h: 118,
        fill: '#ffffff',
        stroke: mix(brand, cream, 0.6),
        titleKey: 'bold',
        title: readable(brand, '#ffffff'),
        note: '#6e6259',
        box: brand,
        ribbon: '#ffb703',
      }),
    );
  out.push(
    cake(t, a, rand, {
      brand,
      top: mix(brand, '#ffffff', 0.38),
      plate: mix(brand, cream, 0.75),
      cream: '#fffaf3',
      onBrand: readable('#ffffff', brand, 3),
    }),
  );
  return out.join('\n');
}

function elegante(c: Ctx) {
  const { t, a, rand } = c;
  const gold = '#d9b36a';
  const paper = '#cdbfa8';
  const name = nameOf(t, 'serif', a);
  const nameSize = t.fit('serif', name, 860, 200, 92);
  const shift = a.gift ? 0 : 130;
  const avoid: Box[] = [
    { x0: 450, y0: 130, x1: 630, y1: 300 },
    { x0: 110, y0: 320 + shift, x1: 970, y1: 740 + shift },
    { x0: 260, y0: 1140, x1: 820, y1: 1230 },
    ...(a.gift ? [{ x0: 170, y0: 790, x1: 910, y1: 960 }] : []),
  ];
  const stars: string[] = [];
  for (let i = 0, tries = 0; i < 24 && tries < 400; tries++) {
    const x = 90 + rand() * 900;
    const y = 90 + rand() * 1170;
    if (!clear(x, y, avoid, 26)) continue;
    stars.push(sparkle(x, y, 6 + rand() * 18, gold, r1(0.35 + rand() * 0.65)));
    i++;
  }
  const corner = (x: number, y: number) =>
    `<path d="M${x} ${y - 12} L${x + 12} ${y} L${x} ${y + 12} L${x - 12} ${y} Z" fill="${gold}"/>`;
  const out = [
    `<defs>
<radialGradient id="bg" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="#2b2219"/><stop offset="1" stop-color="#110e0b"/></radialGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e3a8"/><stop offset="0.5" stop-color="#c8963e"/><stop offset="1" stop-color="#f1d58c"/></linearGradient>
</defs>`,
    `<rect width="${ART_W}" height="${ART_H}" fill="url(#bg)"/>`,
    `<rect x="44" y="44" width="${ART_W - 88}" height="${ART_H - 88}" rx="6" fill="none" stroke="url(#gold)" stroke-width="3"/>`,
    `<rect x="60" y="60" width="${ART_W - 120}" height="${ART_H - 120}" rx="4" fill="none" stroke="${gold}" stroke-width="1" opacity="0.55"/>`,
    corner(44, 44),
    corner(ART_W - 44, 44),
    corner(44, ART_H - 44),
    corner(ART_W - 44, ART_H - 44),
    stars.join('\n'),
    logoBadge(t, a, {
      cx: 540,
      cy: 214,
      r: 70,
      ring: 'url(#gold)',
      ringW: 4,
      fill: '#1d1712',
      ink: gold,
    }),
    text('serif', 540, 412 + shift, 88, 'url(#gold)', 'Feliz Aniversário'),
    `<path d="M370 ${462 + shift} H516 M564 ${462 + shift} H710" stroke="${gold}" stroke-width="2" opacity="0.8"/>`,
    sparkle(540, 462 + shift, 13, gold),
    text('serif', 540, 640 + shift, nameSize, '#fff8ec', t.clip('serif', name, nameSize, 880)),
    text('body', 540, 718 + shift, 38, paper, t.clip('body', c.line, 38, 860, 1), { spacing: 1 }),
  ];
  if (a.gift)
    out.push(
      giftCard(t, a.gift, {
        x: 170,
        y: 790,
        w: 740,
        h: 170,
        fill: '#1d1712',
        stroke: gold,
        titleKey: 'serif',
        title: '#f3dfa2',
        note: paper,
        box: gold,
        ribbon: '#8a6a2c',
      }),
    );
  out.push(`<path d="M440 1150 H640" stroke="${gold}" stroke-width="1.5" opacity="0.7"/>`);
  const rest = t.clean('body', a.restaurant) || 'Seu restaurante';
  const rs = t.fit('body', rest, 800, 36, 24, 3);
  out.push(text('body', 540, 1214, rs, gold, t.clip('body', rest, rs, 820, 3), { spacing: 3 }));
  return out.join('\n');
}

function simples(c: Ctx) {
  const { t, a, brand, rand } = c;
  const head = readable(brand, '#ffffff', 4.5);
  const name = nameOf(t, 'bold', a);
  const nameSize = t.fit('bold', name, 880, 250, 96);
  const shift = a.gift ? 0 : 110;
  const dots: string[] = [];
  for (let i = 0; i < 14; i++) {
    const ang = rand() * Math.PI * 0.9 + Math.PI * 0.55;
    const d = 430 + rand() * 90;
    dots.push(
      `<circle cx="${r1(1000 + Math.cos(ang) * d)}" cy="${r1(90 + Math.sin(ang) * d)}" r="${r1(5 + rand() * 9)}" fill="${i % 3 ? brand : mix(brand, '#ffffff', 0.55)}"/>`,
    );
  }
  const out = [
    `<rect width="${ART_W}" height="${ART_H}" fill="#ffffff"/>`,
    `<circle cx="1000" cy="90" r="410" fill="${brand}"/>`,
    `<circle cx="1000" cy="90" r="300" fill="${mix(brand, '#ffffff', 0.18)}"/>`,
    `<circle cx="40" cy="1330" r="250" fill="${mix(brand, '#ffffff', 0.86)}"/>`,
    dots.join('\n'),
    logoBadge(t, a, {
      cx: 168,
      cy: 178,
      r: 66,
      ring: mix(brand, '#ffffff', 0.8),
      ringW: 6,
      fill: brand,
      ink: readable('#ffffff', brand, 3),
    }),
    text('body', 100, 600 + shift, 56, head, 'Feliz aniversário,', { anchor: 'start' }),
    text('bold', 96, 800 + shift, nameSize, INK, t.clip('bold', name, nameSize, 900), {
      anchor: 'start',
      spacing: -2,
    }),
    text('body', 100, 880 + shift, 42, '#6b625b', t.clip('body', c.line, 42, 880), {
      anchor: 'start',
    }),
  ];
  if (a.gift)
    out.push(
      giftCard(t, a.gift, {
        x: 96,
        y: 950,
        w: 888,
        h: 160,
        fill: mix(brand, '#ffffff', 0.9),
        titleKey: 'bold',
        title: readable(brand, mix(brand, '#ffffff', 0.9)),
        note: '#6b625b',
        box: brand,
        ribbon: mix(brand, '#ffffff', 0.55),
      }),
    );
  const rest = t.clean('bold', a.restaurant) || 'Seu restaurante';
  const rs = t.fit('bold', rest, 800, 38, 24);
  out.push(`<circle cx="112" cy="${1238 - rs * 0.36}" r="12" fill="${brand}"/>`);
  out.push(text('bold', 140, 1238, rs, INK, t.clip('bold', rest, rs, 820), { anchor: 'start' }));
  return out.join('\n');
}

const THEMES: Record<BirthdayTheme, (c: Ctx) => string> = { festa, bolo, elegante, simples };

/** O SVG da arte, pronto para virar PNG (as fontes vêm de assets/fonts). */
export function birthdayArtSvg(a: ArtInput, fonts: ArtFonts) {
  const t = new Typesetter(fonts);
  const brand = brandOf(a.brand);
  const ctx: Ctx = {
    t,
    a,
    brand,
    rand: rng(`${a.name}|${a.restaurant}|${a.theme}`),
    name: a.name,
    line: t.clean('body', a.line) || 'Hoje o dia é todo seu!',
  };
  const body = (THEMES[a.theme] ?? festa)(ctx);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_W}" height="${ART_H}" viewBox="0 0 ${ART_W} ${ART_H}">\n${body}\n</svg>`;
}
