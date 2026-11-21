/**
 * Identidade visual do restaurante: a partir de uma cor principal (e uma de destaque) gera todos
 * os tons --cm-brand-* e --cm-accent-* do design system, nos temas claro e escuro, e troca o
 * ícone da aba. Como as telas só usam os tokens, trocar aqui pinta o cardápio e o sistema inteiro.
 *
 * Os tons são calculados em OKLCH (mesma claridade percebida para qualquer matiz) e ajustados
 * até o contraste passar de 4.5:1 onde há texto: o lojista escolhe qualquer cor sem quebrar a
 * leitura. Sem cor escolhida, valem as cores do Comandou (tokens.css).
 */
import { setBarColor } from './theme';

export type FontStyle = 'padrao' | 'sistema' | 'classica' | 'arredondada';
export type CornerStyle = 'padrao' | 'reto' | 'arredondado';

export interface Branding {
  brandColor: string | null;
  accentColor: string | null;
  fontStyle: FontStyle;
  cornerStyle: CornerStyle;
  faviconUrl: string | null;
  logoUrl: string | null;
  /** As cores valem também no sistema da equipe. */
  staffApp: boolean;
}

export const DEFAULT_BRANDING: Branding = {
  brandColor: null,
  accentColor: null,
  fontStyle: 'padrao',
  cornerStyle: 'padrao',
  faviconUrl: null,
  logoUrl: null,
  staffApp: true,
};

/** Cores do Comandou (para "restaurar padrão" e para a prévia). */
export const COMANDOU_BRAND = '#e23a00';
export const COMANDOU_ACCENT = '#f2b705';

// ------------------------------------------------------------------ cor: sRGB <-> OKLCH
type Rgb = [number, number, number]; // 0..1
type Lch = [number, number, number]; // L 0..1, C, H em graus

const HEX_RE = /^#?([0-9a-f]{6})$/i;
export const isHex = (v: string | null | undefined): v is string => !!v && HEX_RE.test(v);

function hexToRgb(hex: string): Rgb {
  const n = parseInt(HEX_RE.exec(hex)![1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgbToHex(c: Rgb) {
  return `#${c
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function rgbToOklch([r, g, b]: Rgb): Lch {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const H = (Math.atan2(B, A) * 180) / Math.PI;
  return [L, Math.hypot(A, B), H < 0 ? H + 360 : H];
}

function oklchToRgbRaw([L, C, H]: Lch): Rgb {
  const h = (H * Math.PI) / 180;
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const inGamut = (c: Rgb) => c.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH -> #rrggbb, reduzindo a saturação até caber na tela (sRGB). */
function lch(L: number, C: number, H: number) {
  let c = C;
  let rgb = oklchToRgbRaw([L, c, H]);
  while (!inGamut(rgb) && c > 0.002) {
    c *= 0.94;
    rgb = oklchToRgbRaw([L, c, H]);
  }
  return rgbToHex(rgb);
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const INK = '#1a1613';
const WHITE = '#ffffff';
const DARK_SURFACE = '#283141';

/** Mistura duas cores em sRGB (k = quanto da primeira). */
function mix(a: string, b: string, k: number) {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex(x.map((v, i) => v * k + y[i]! * (1 - k)) as Rgb);
}

/** Contraste a partir do qual o texto por cima da cor fica branco (letra em negrito do botão). */
const WHITE_MIN = 3.9;

/** Texto por cima de um fundo colorido: branco sempre que lê bem (verde, azul, vermelho…); escuro
 *  só nas cores claras (amarelo, verde-limão), onde o branco some. */
export const onColor = (bg: string) =>
  contrast(bg, WHITE) >= WHITE_MIN || contrast(bg, INK) < contrast(bg, WHITE) ? WHITE : INK;

/** Escurece (ou clareia) até o contraste com o fundo passar do mínimo. */
function legibleOn(base: Lch, bg: string, min = 4.5, dir: 1 | -1 = -1) {
  const [, C, H] = base;
  let L = base[0];
  let hex = lch(L, C, H);
  for (let i = 0; i < 60 && contrast(hex, bg) < min; i++) {
    L = Math.min(0.98, Math.max(0.05, L + dir * 0.01));
    hex = lch(L, C, H);
  }
  return hex;
}

/** Tons do acento (selos, estrelas, destaques) a partir da cor de destaque. */
function accentTokens(accent: string) {
  const a = rgbToOklch(hexToRgb(accent));
  const a500 = rgbToHex(hexToRgb(accent));
  const light: Record<string, string> = {
    '--cm-accent-300': lch(Math.min(0.94, a[0] + 0.1), a[1] * 0.8, a[2]),
    '--cm-accent-400': lch(Math.min(0.9, a[0] + 0.04), a[1], a[2]),
    '--cm-accent-500': a500,
    '--cm-on-accent': onColor(a500),
  };
  // Escuro: destaque menos vivo, como o resto da paleta.
  const d500 = lch(Math.min(a[0], 0.8), a[1] * 0.78, a[2]);
  const dark: Record<string, string> = {
    '--cm-accent-400': lch(Math.min(a[0] + 0.03, 0.83), a[1] * 0.78, a[2]),
    '--cm-accent-500': d500,
    '--cm-on-accent': onColor(d500),
  };
  return { light, dark };
}

/** Todos os tons --cm-brand-* (claro e escuro) a partir da cor principal. */
export function brandTokens(brand: string) {
  const base = rgbToOklch(hexToRgb(brand));
  const [L, C, H] = base;
  const tint = (l: number, k: number) => lch(l, C * k, H);
  const b500 = rgbToHex(hexToRgb(brand));
  const b600 = lch(Math.max(0.12, L - 0.035), C, H);
  const b700 = legibleOn([Math.min(L, 0.6), C, H], WHITE);
  const b800 = lch(Math.max(0.1, rgbToOklch(hexToRgb(b700))[0] - 0.08), C, H);
  const light: Record<string, string> = {
    '--cm-brand-50': tint(0.975, 0.18),
    '--cm-brand-100': tint(0.945, 0.32),
    '--cm-brand-200': tint(0.89, 0.55),
    '--cm-brand-300': tint(0.82, 0.8),
    '--cm-brand-400': tint(Math.max(L, 0.72), 0.95),
    '--cm-brand-500': b500,
    '--cm-brand-600': b600,
    '--cm-brand-700': b700,
    '--cm-brand-800': b800,
    '--cm-brand-900': tint(0.28, 0.7),
    '--cm-brand-deep': b700,
    '--cm-on-brand': onColor(b600),
    '--cm-link': b700,
  };
  // Escuro: a mesma cor um pouco menos saturada e brilhante (não cansa a vista), fundos com um
  // toque dela e texto colorido clareado até ler bem sobre o cartão escuro.
  const dC = C * 0.78;
  const dL = Math.min(Math.max(L, 0.6), 0.74);
  const d500 = lch(dL, dC, H);
  const d600 = lch(dL - 0.025, dC, H);
  const d700 = legibleOn([Math.max(dL, 0.72), dC, H], DARK_SURFACE, 5, 1);
  const d700L = rgbToOklch(hexToRgb(d700))[0];
  const dark: Record<string, string> = {
    // Fundos com um toque da cor: mistura com o cartão azul-ardósia (não vira marrom/roxo escuro).
    '--cm-brand-50': mix(d500, DARK_SURFACE, 0.1),
    '--cm-brand-100': mix(d500, DARK_SURFACE, 0.16),
    '--cm-brand-200': mix(d500, DARK_SURFACE, 0.26),
    '--cm-brand-300': lch(Math.min(0.86, d700L + 0.06), dC * 0.6, H),
    '--cm-brand-400': lch(Math.min(0.8, dL + 0.04), dC * 0.9, H),
    '--cm-brand-500': d500,
    '--cm-brand-600': d600,
    '--cm-brand-700': d700,
    '--cm-brand-800': lch(Math.min(0.92, d700L + 0.08), dC * 0.7, H),
    '--cm-on-brand': onColor(d600),
    '--cm-link': d700,
    '--cm-focus': `0 0 0 3px color-mix(in oklab, ${d500} 26%, transparent)`,
  };
  return { light, dark };
}

const FONTS: Record<Exclude<FontStyle, 'padrao'>, string> = {
  sistema: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  classica: "ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif",
  arredondada:
    "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', 'Quicksand', system-ui, sans-serif",
};
const CORNERS: Record<Exclude<CornerStyle, 'padrao'>, Record<string, string>> = {
  reto: { xs: '2px', sm: '3px', md: '4px', lg: '6px' },
  arredondado: { xs: '6px', sm: '10px', md: '14px', lg: '18px' },
};

/** CSS que veste a página com a identidade (vazio = visual padrão do Comandou). */
export function brandCss(
  b: Pick<Branding, 'brandColor' | 'accentColor' | 'fontStyle' | 'cornerStyle'>,
  opts: { colors: boolean; shape: boolean },
) {
  const rootVars: Record<string, string> = {};
  let darkVars: Record<string, string> = {};
  if (opts.colors && isHex(b.brandColor)) {
    const t = brandTokens(b.brandColor);
    Object.assign(rootVars, t.light);
    darkVars = t.dark;
  }
  if (opts.colors && isHex(b.accentColor)) {
    const t = accentTokens(b.accentColor);
    Object.assign(rootVars, t.light);
    Object.assign(darkVars, t.dark);
  }
  if (opts.shape && b.fontStyle !== 'padrao' && FONTS[b.fontStyle])
    rootVars['--cm-font'] = FONTS[b.fontStyle];
  if (opts.shape && b.cornerStyle !== 'padrao' && CORNERS[b.cornerStyle])
    for (const [k, v] of Object.entries(CORNERS[b.cornerStyle])) rootVars[`--cm-radius-${k}`] = v;
  const block = (sel: string, vars: Record<string, string>) =>
    Object.keys(vars).length
      ? `${sel}{${Object.entries(vars)
          .map(([k, v]) => `${k}:${v}`)
          .join(';')}}`
      : '';
  // html:root (e html:root[data-theme=dark]) vencem os seletores do tokens.css pela
  // especificidade, sem depender da ordem dos arquivos de estilo. O bloco escuro precisa trazer
  // todos os tons que o tema escuro do Comandou redefine, senão o laranja padrão voltaria.
  return [
    block('html:root', rootVars),
    block("html:root[data-theme='dark']", darkVars),
    Object.keys(darkVars).length
      ? `@media (prefers-color-scheme: dark){${block('html:root:not([data-theme])', darkVars)}}`
      : '',
  ].join('');
}

// ------------------------------------------------------------------ aplicar na página
const STYLE_ID = 'cm-brand';
const CACHE = 'cm-brand';

/** Escreve (ou limpa) o estilo da identidade no <head>. */
export function applyBrandCss(css: string) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) return el?.remove();
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/** Troca o ícone da aba e o do atalho na tela inicial. null volta ao do Comandou. */
export function applyFavicon(url: string | null) {
  const icon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const apple = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  for (const [el, fallback, type] of [
    [icon, '/favicon.svg', 'image/svg+xml'],
    [apple, '/apple-touch-icon.png', ''],
  ] as const) {
    if (!el) continue;
    if (url) {
      el.removeAttribute('type'); // a foto pode ser WebP, JPEG ou PNG
      if (el.getAttribute('href') !== url) el.href = url;
    } else {
      if (type) el.type = type;
      if (el.getAttribute('href') !== fallback) el.href = fallback;
    }
  }
}

/**
 * O app instalado (PWA) lê nome, cor e ícone do manifesto da loja, não o do Comandou. No link do
 * entregador (sem login), o atalho abre no próprio link, e não no login do painel; no cardápio do
 * cliente, abre no cardápio.
 */
export function applyManifest(path = window.location.pathname) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'manifest';
    document.head.appendChild(el);
  }
  const start = /^\/entregador\/[A-Za-z0-9_-]{20,64}$/.test(path)
    ? path
    : /^\/(pedir|pedido|mesa)(\/|$)/.test(path)
      ? '/pedir'
      : null;
  const href = start
    ? `/api/v1/store/manifest?start=${encodeURIComponent(start)}`
    : '/api/v1/store/manifest';
  if (el.getAttribute('href') !== href) el.href = href;
}

/** Última identidade vista neste navegador: pinta antes do primeiro desenho, sem piscar laranja. */
export function cachedBranding(): Branding | null {
  try {
    const raw = localStorage.getItem(CACHE);
    return raw ? { ...DEFAULT_BRANDING, ...(JSON.parse(raw) as Partial<Branding>) } : null;
  } catch {
    return null;
  }
}
export function cacheBranding(b: Branding) {
  try {
    localStorage.setItem(CACHE, JSON.stringify(b));
  } catch {
    /* modo privado: só não guarda */
  }
  window.dispatchEvent(new Event(BRAND_CACHED_EVENT));
}
/** A identidade guardada mudou (a logo do menu lateral escuta para se atualizar). */
export const BRAND_CACHED_EVENT = 'cm-brand-cached';

/** Telas do cliente final (cardápio, pedido, rastreio, mesa): ganham também fonte e cantos. */
export const isCustomerPath = (path: string) => /^\/(pedir|pedido|rastreio|mesa)(\/|$)/.test(path);

/** Aplica a identidade na página atual, conforme a tela (cliente ou equipe). */
export function applyBranding(b: Branding, path = window.location.pathname) {
  const customer = isCustomerPath(path);
  const colors = customer || b.staffApp;
  applyBrandCss(brandCss(b, { colors, shape: customer }));
  // Topo do celular (barra do navegador e área do relógio): no cardápio, a cor do fundo da página.
  setBarColor(customer ? 'page' : 'frame');
  // O ícone da aba é sempre o da loja (login, painel e cardápio), mesmo com as cores desligadas
  // no sistema da equipe: o restaurante não vê o panda do Comandou.
  applyFavicon(b.faviconUrl ?? b.logoUrl);
  applyManifest(path);
}

/** Avisa a página (e a prévia) que a identidade mudou. */
export const BRAND_EVENT = 'cm-brand-changed';
