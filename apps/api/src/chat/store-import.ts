/**
 * Primeiros passos pelo cardápio: o que dá para tirar de uma página (link do cardápio) antes de
 * mandar para a IA, e a limpeza do que a IA devolve sobre a loja (nome, contato, endereço,
 * horário, cores, logo). Funções puras: o serviço (menu-import.service) faz a busca e a chamada.
 */

export interface StoreHourOut {
  day: number;
  open: string;
  close: string;
}
/** Dados da loja lidos do cardápio. Tudo opcional: a pessoa confere antes de aplicar. */
export interface ImportedStore {
  name: string | null;
  about: string | null;
  whatsapp: string | null;
  address: string | null;
  cep: string | null;
  city: string | null;
  state: string | null;
  hours: StoreHourOut[];
  brandColor: string | null;
  accentColor: string | null;
  /** Link (página) ou posição na foto (0–1000: [topo, esquerda, baixo, direita]). */
  logoUrl: string | null;
  logoBox: Box | null;
  coverUrl: string | null;
  faviconUrl: string | null;
}
export type Box = [number, number, number, number];

export const EMPTY_STORE: ImportedStore = {
  name: null,
  about: null,
  whatsapp: null,
  address: null,
  cep: null,
  city: null,
  state: null,
  hours: [],
  brandColor: null,
  accentColor: null,
  logoUrl: null,
  logoBox: null,
  coverUrl: null,
  faviconUrl: null,
};

const UFS = new Set(
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '),
);

const clip = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) || null : null;

export function hexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

const hhmm = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{1,2})(?:[:h](\d{2})?)?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59) return null;
  return `${String(h === 24 ? 0 : h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

export function readBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const n = v.map(Number);
  if (n.some((x) => !Number.isFinite(x) || x < 0 || x > 1000)) return null;
  const [t, l, b, r] = n as Box;
  // Menor que 4% de lado não serve nem de miniatura.
  if (b - t < 40 || r - l < 40) return null;
  return [t, l, b, r];
}

/** Limpa o objeto "store" do modelo. `images` traduz o número da imagem da página no link. */
export function readStore(v: unknown, images: string[] = []): ImportedStore {
  const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const img = (x: unknown) => {
    const i = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
    return Number.isInteger(i) && i >= 0 && i < images.length ? images[i]! : null;
  };
  const hours: StoreHourOut[] = [];
  for (const h of Array.isArray(s.hours) ? s.hours : []) {
    const r = h as Record<string, unknown>;
    const day = Number(r?.day);
    const open = hhmm(r?.open);
    const close = hhmm(r?.close);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !open || !close || open === close) continue;
    if (hours.some((x) => x.day === day && x.open === open)) continue;
    if (hours.length < 21) hours.push({ day, open, close });
  }
  hours.sort((a, b) => a.day - b.day || a.open.localeCompare(b.open));
  const digits = (x: unknown) => (typeof x === 'string' ? x.replace(/\D/g, '') : '');
  let phone = digits(s.whatsapp) || digits(s.phone);
  if (phone.startsWith('55') && phone.length >= 12) phone = phone.slice(2);
  const cep = digits(s.cep);
  const uf = typeof s.state === 'string' ? s.state.trim().toUpperCase() : '';
  const brand = hexColor(s.brandColor);
  const accent = hexColor(s.accentColor);
  return {
    name: clip(s.name, 120),
    about: clip(s.about, 500),
    whatsapp: phone.length >= 10 && phone.length <= 11 ? phone : null,
    address: clip(s.address, 300),
    cep: cep.length === 8 ? cep : null,
    city: clip(s.city, 80),
    state: UFS.has(uf) ? uf : null,
    hours,
    brandColor: brand,
    accentColor: accent && accent !== brand ? accent : null,
    logoUrl: img(s.logo),
    logoBox: readBox(s.logoBox),
    coverUrl: img(s.cover),
    faviconUrl: null,
  };
}

// --------------------------------------------------------------------------- página do link

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ccedil: 'ç',
  atilde: 'ã',
  otilde: 'õ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  acirc: 'â',
  ecirc: 'ê',
  ocirc: 'ô',
  agrave: 'à',
  Ccedil: 'Ç',
  Atilde: 'Ã',
  Aacute: 'Á',
  Eacute: 'É',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
};

const abs = (src: string | null, base: string) => {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null;
  try {
    const u = new URL(src, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

export interface PageInfo {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  themeColor: string | null;
  ogImage: string | null;
  /** Ícones da página, do maior para o menor. */
  icons: string[];
  /** Imagens na ordem em que aparecem; o texto marca a posição com [img N]. */
  images: string[];
  /** Cores mais usadas no CSS da página (sem branco, preto e cinzas). */
  colors: string[];
  jsonLd: string;
  /** Dados que a página carrega em JSON (cardápios feitos em React/Next costumam vir aqui). */
  dataJson: string;
  text: string;
}

const MAX_IMAGES = 400;

function cssColors(html: string): string[] {
  const count = new Map<string, number>();
  const add = (hex: string | null, w = 1) => {
    if (!hex) return;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Cinza, quase branco ou quase preto não diz a cor da marca.
    if (max - min < 28 || max < 40 || min > 225) return;
    count.set(hex, (count.get(hex) ?? 0) + w);
  };
  for (const m of html.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) add(hexColor(m[0]));
  for (const m of html.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) {
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)));
    add(`#${[r, g, b].map((x) => x!.toString(16).padStart(2, '0')).join('')}`);
  }
  // Variáveis com nome de marca valem mais (--primary, --brand, --main-color...).
  for (const m of html.matchAll(
    /--[\w-]*(?:primary|brand|main|theme|accent)[\w-]*\s*:\s*(#[0-9a-f]{3,6})\b/gi,
  ))
    add(hexColor(m[1]), 8);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([c]) => c);
}

/** Lê o HTML do link: metadados, ícones, imagens marcadas no texto, JSON-LD e cores. */
export function extractPage(html: string, url: string): PageInfo {
  const head = html.slice(0, 200_000);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (...keys: string[]) => {
    for (const k of keys)
      for (const t of metas) {
        const n = (attr(t, 'property') ?? attr(t, 'name') ?? '').toLowerCase();
        if (n === k) {
          const c = attr(t, 'content');
          if (c) return c;
        }
      }
    return null;
  };
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  const icons = [...head.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /icon/i.test(attr(t, 'rel') ?? ''))
    .map((t) => {
      const sizes = attr(t, 'sizes') ?? '';
      const px = Number(sizes.match(/(\d+)x\d+/)?.[1] ?? 0);
      const apple = /apple/i.test(attr(t, 'rel') ?? '') ? 180 : 0;
      return { href: abs(attr(t, 'href'), url), size: px || apple || 16 };
    })
    .filter((i): i is { href: string; size: number } => !!i.href && !/\.svg(\?|$)/i.test(i.href))
    .sort((a, b) => b.size - a.size)
    .map((i) => i.href);

  const jsonLd = [
    ...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ]
    .map((m) => m[1]!.trim())
    .join('\n')
    .slice(0, 20_000);
  const dataJson = [
    ...html.matchAll(
      /<script[^>]*(?:id=["']__NEXT_DATA__["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi,
    ),
    ...html.matchAll(
      /window\.__(?:INITIAL_STATE|NUXT|APOLLO_STATE|PRELOADED_STATE)__\s*=\s*([\s\S]*?)<\/script>/gi,
    ),
  ]
    .map((m) => m[1]!.trim())
    .join('\n')
    .slice(0, 120_000);

  const images: string[] = [];
  const index = new Map<string, number>();
  const imgRef = (src: string | null) => {
    if (!src) return '';
    let i = index.get(src);
    if (i === undefined) {
      if (images.length >= MAX_IMAGES) return '';
      i = images.length;
      images.push(src);
      index.set(src, i);
    }
    return ` [img ${i}] `;
  };
  const og = abs(meta('og:image', 'twitter:image'), url);

  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ');
  body = body.replace(/<img\b[^>]*>/gi, (t) => {
    const srcset = attr(t, 'srcset') ?? attr(t, 'data-srcset');
    const best = srcset
      ?.split(',')
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean)
      .pop();
    const src = abs(attr(t, 'data-src') ?? attr(t, 'src') ?? best ?? null, url);
    const alt = attr(t, 'alt');
    return `${imgRef(src)}${alt ? `(${alt}) ` : ''}`;
  });
  // Foto de fundo em estilo inline (cards de produto costumam usar): a marca vem logo depois da tag.
  body = body.replace(
    /<[a-z][^>]*?background(?:-image)?\s*:\s*url\(\s*(?:&quot;|['"])?([^'")&]+)[^>]*>/gi,
    (tag, src: string) => `${tag}${imgRef(abs(decodeEntities(src), url))}`,
  );
  const text = decodeEntities(
    body
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, 150_000);

  // A capa do link entra na lista mesmo fora do corpo da página.
  if (og) imgRef(og);
  return {
    url,
    title: title ? decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, 200) : null,
    description: meta('description', 'og:description'),
    siteName: meta('og:site_name', 'application-name'),
    themeColor: hexColor(meta('theme-color', 'msapplication-tilecolor')),
    ogImage: og,
    icons: icons.slice(0, 6),
    images,
    colors: cssColors(html),
    jsonLd,
    dataJson,
    text,
  };
}

/** Texto que vai para a IA com tudo o que a página mostrou. */
export function pageForModel(p: PageInfo): string {
  const lines = [
    `Link: ${p.url}`,
    p.title && `Título: ${p.title}`,
    p.siteName && `Nome do site: ${p.siteName}`,
    p.description && `Descrição: ${p.description}`,
    p.themeColor && `Cor do tema (theme-color): ${p.themeColor}`,
    p.colors.length && `Cores mais usadas no visual: ${p.colors.join(', ')}`,
    p.ogImage && `Imagem de capa do link (og:image): [img ${p.images.indexOf(p.ogImage)}]`,
    p.jsonLd && `Dados estruturados (JSON-LD):\n${p.jsonLd}`,
    `Texto da página:\n${p.text || '(vazio)'}`,
    p.dataJson && `Dados da página em JSON:\n${p.dataJson}`,
  ];
  return lines.filter(Boolean).join('\n\n');
}

const STORE_FIELDS = `"store":{"name":"nome da loja ou null","about":"frase curta sobre a loja ou null","whatsapp":"telefone ou WhatsApp com DDD ou null","address":"rua, número e bairro ou null","cep":"00000-000 ou null","city":"cidade ou null","state":"UF ou null","hours":[{"day":0,"open":"18:00","close":"23:00"}],"brandColor":"#rrggbb ou null","accentColor":"#rrggbb ou null"LOGO}`;

const STORE_RULES = `Sobre "store":
- Só preencha o que estiver escrito ou visível. Não invente telefone, endereço nem horário.
- "hours": um turno por dia (0 = domingo, 1 = segunda ... 6 = sábado), "open" e "close" em HH:MM. "Seg a sex 11h às 15h" vira 5 turnos. Fechado no dia: não inclua. Sem horário: [].
- "brandColor": a cor principal da marca (a que domina o logo, os títulos ou os botões). "accentColor": uma segunda cor da marca que combine, diferente da principal. Evite branco, preto e cinza; null quando não houver cor de marca clara.
- "address" sem a cidade e a UF (elas vão em "city" e "state").`;

const ITEM_RULES = `Sobre os itens:
- Copie nomes, descrições e preços como estão escritos. Não invente item, descrição nem preço.
- "price" é o preço em reais com ponto e duas casas, sem "R$" (ex.: "24.90"). Sem preço visível: null.
- Item com tamanhos ou variações de preço (P, M, G; 300 ml, 500 ml): crie um item para cada, com o tamanho no nome ("Pizza Calabresa G").
- Use as categorias do próprio cardápio (Lanches, Pizzas, Bebidas...). Se não houver, agrupe pelo tipo do item.
- Nomes com a primeira letra maiúscula, sem tudo em maiúsculas.`;

/** Prompt da leitura de um link (página do cardápio digital, site da loja). */
export const LINK_PROMPT = `Você monta o cadastro de um restaurante brasileiro a partir da página do cardápio dele (texto, dados e imagens da página). As imagens aparecem no texto como [img N], perto do item ou da parte da página a que pertencem.

Responda SOMENTE com JSON neste formato:
{${STORE_FIELDS.replace('LOGO', ',"logo":"número N da imagem do logo ou null","cover":"número N de uma foto boa para capa (ambiente, fachada ou pratos) ou null"')},"categories":[{"name":"Nome da categoria","items":[{"name":"Nome do item","description":"descrição curta ou null","price":"24.90 ou null","image":"número N da foto do item ou null"}]}]}

${STORE_RULES}
- "logo": a imagem [img N] que é o logo da loja (costuma ter "logo" ou o nome da loja no texto alternativo, ou estar no topo). null se não tiver certeza.

${ITEM_RULES}
- "image": o número N da foto que é do próprio item (logo antes ou depois do nome dele). Não use logo, ícone, banner nem a mesma foto em vários itens. Sem foto: null.
- Os dados em JSON costumam ter o cardápio completo (nome, descrição, preço, foto): use-os quando o texto estiver incompleto. Preço em centavos (2490) vira "24.90".
- Página sem cardápio: devolva "categories":[] e o que der da loja.`;

/** Prompt da leitura de uma foto ou PDF nos primeiros passos (itens + dados da loja). */
export const PHOTO_STORE_PROMPT = `Você lê cardápios de restaurantes brasileiros (foto do cardápio, print do cardápio digital, foto de um prato ou PDF) e monta o cadastro da loja.

Responda SOMENTE com JSON neste formato:
{${STORE_FIELDS.replace('LOGO', ',"logoBox":[topo,esquerda,baixo,direita] ou null')},"categories":[{"name":"Nome da categoria","items":[{"name":"Nome do item","description":"descrição curta ou null","price":"24.90 ou null","photo":[topo,esquerda,baixo,direita] ou null}]}]}

${STORE_RULES}
- "logoBox": onde está o logo da loja na imagem, em coordenadas de 0 a 1000 ([topo, esquerda, baixo, direita]). Sem logo: null.

${ITEM_RULES}
- "photo": se o item tem a própria foto do prato na imagem, a caixa dela em coordenadas de 0 a 1000 ([topo, esquerda, baixo, direita]), bem justa no prato. Sem foto própria: null. Nunca use a mesma caixa para dois itens.
- Foto de um único prato, sem texto: devolva um item com o nome mais provável do prato, uma descrição curta do que aparece, "price": null e "photo" com a caixa do prato.
- Se não houver comida, bebida nem cardápio na imagem, devolva "categories":[] e o que der da loja.`;

/** Foto ilustrativa de um item sem foto (modelo de imagem do OpenRouter). */
export const photoPrompt = (name: string, description: string | null, category: string | null) =>
  `Foto profissional de cardápio de delivery, quadrada, do prato "${name}"${category ? ` (categoria ${category})` : ''}${description ? `: ${description}` : ''}. Comida brasileira real e apetitosa, servida em louça simples, luz natural suave, vista de 45 graus, fundo neutro desfocado. Sem texto, sem logo, sem pessoas, sem mãos.`;
